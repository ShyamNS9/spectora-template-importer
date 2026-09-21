import { decodeEntitiesOnce } from './entities'
import { locateColumns, MAPPED_COLUMNS, REQUIRED_COLUMNS, type MappedColumn } from './columns'
import { readFirstSheet, UnreadableFileError } from './xlsx'
import type {
  ImportIssue,
  ImportIssueKind,
  IssueSeverity,
  ParsedComment,
  ParsedSection,
  ParseResult,
} from './types'

export { UnreadableFileError } from './xlsx'

export class NotASpectoraExportError extends Error {}

/** Spreadsheet rows are 1-based and row 1 is the header. */
const FIRST_DATA_ROW = 2

/**
 * Spectora groups an item's comments by type before ordering them, and its
 * "Order (w/i item)" column restarts at zero for each group. Both Spectora's
 * own editor and Hive's imported output present the groups in this sequence.
 *
 * Types we have not seen sort after these, keeping their order of appearance.
 */
const TYPE_ORDER = ['info', 'limit', 'defect']

function typeRank(commentType: string | null): number {
  const index = commentType === null ? -1 : TYPE_ORDER.indexOf(commentType.trim().toLowerCase())
  return index === -1 ? TYPE_ORDER.length : index
}

type IssueDraft = Omit<ImportIssue, 'affectedCount' | 'sample' | 'sourceColumn' | 'sourceRow'> &
  Partial<Pick<ImportIssue, 'affectedCount' | 'sample' | 'sourceColumn' | 'sourceRow'>>

class IssueLog {
  private readonly issues: ImportIssue[] = []

  add(draft: IssueDraft): void {
    this.issues.push({
      sourceColumn: null,
      sourceRow: null,
      affectedCount: 1,
      sample: null,
      ...draft,
    })
  }

  all(): ImportIssue[] {
    return this.issues
  }
}

function splitOptions(value: string): string[] {
  // Spectora stores these as one comma-separated string, which cannot express
  // an option that itself contains a comma. That ambiguity is in the export
  // format, not something the importer can recover; see NOTES.md.
  return value
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option !== '')
}

function parseSeverity(value: string, sourceRow: number, issues: IssueLog): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) {
    issues.add({
      kind: 'unsupported_by_importer',
      severity: 'warning',
      sourceColumn: MAPPED_COLUMNS.severity,
      sourceRow,
      message: `Severity "${trimmed}" is not a number and was not imported. The original value is kept with the comment.`,
      sample: trimmed,
    })
    return null
  }
  return parsed
}

/**
 * Decodes a name and records the change.
 *
 * Correcting "Crawlspace &amp; Structure" to "Crawlspace & Structure" is
 * still rewriting what was in the customer's file. It is the right call, but
 * it is reported rather than done quietly.
 */
function decodeName(value: string, onChange: (before: string, after: string) => void): string {
  const decoded = decodeEntitiesOnce(value)
  if (decoded !== value) onChange(value, decoded)
  return decoded
}

function classifyUnmappedColumn(
  header: string,
  values: string[],
): { kind: ImportIssueKind; severity: IssueSeverity; message: string; count: number; sample: string | null } {
  const filled = values.filter((value) => value.trim() !== '')

  if (filled.length === 0) {
    return {
      kind: 'missing_from_export',
      severity: 'info',
      count: values.length,
      sample: null,
      message: `"${header}" is empty in every row of this export, so there was nothing to import.`,
    }
  }

  const distinct = new Set(filled)
  if (distinct.size === 1 && filled.length === values.length) {
    const only = [...distinct][0]
    return {
      kind: 'degenerate_default',
      severity: 'warning',
      count: filled.length,
      sample: only,
      message:
        `"${header}" holds the identical value ${JSON.stringify(only)} in all ${filled.length} rows. ` +
        `That is a Spectora default rather than anything tuned in this template, so it was not imported. ` +
        `The value is kept with each comment.`,
    }
  }

  return {
    kind: 'unsupported_by_importer',
    severity: 'warning',
    count: filled.length,
    sample: [...distinct][0],
    message:
      `"${header}" carries data in ${filled.length} rows but is not modelled by this importer. ` +
      `Every value is kept verbatim with its comment.`,
  }
}

/**
 * Turns a Spectora HTML-text export into a template tree plus an account of
 * everything that happened on the way.
 *
 * Section and item order are taken from the order rows appear in the file.
 * The export has no column describing it, and the inspector's arrangement is
 * part of what they spent years building.
 */
export function parseSpectoraExport(file: Uint8Array, fileName: string): ParseResult {
  const sheet = readFirstSheet(file)
  const header = sheet[0]

  if (!header || header.length === 0) {
    throw new NotASpectoraExportError('The spreadsheet is empty: no header row was found.')
  }

  const columns = locateColumns(header)
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column))
  if (missing.length > 0) {
    const expected = missing.map((column) => `"${MAPPED_COLUMNS[column]}"`).join(', ')
    throw new NotASpectoraExportError(
      `This spreadsheet is missing the ${expected} column${missing.length > 1 ? 's' : ''}, ` +
        `so it is not a Spectora template export. Use “Export to spreadsheet → Export HTML Text”.`,
    )
  }

  const issues = new IssueLog()
  const rows = sheet.slice(1)
  const at = (row: string[], column: MappedColumn): string => {
    const index = columns.get(column)
    return index === undefined ? '' : (row[index] ?? '')
  }

  const mappedIndexes = new Set(columns.values())
  const unmappedIndexes = header.map((_, index) => index).filter((index) => !mappedIndexes.has(index))

  const sections: ParsedSection[] = []
  const sectionsByName = new Map<string, ParsedSection>()
  const itemsBySectionAndName = new Map<string, { position: number; comments: ParsedComment[]; name: string }>()

  const decoded: Record<string, { count: number; sample: string }> = {}
  const noteDecode = (column: string) => (before: string, after: string) => {
    decoded[column] ??= { count: 0, sample: `${before} → ${after}` }
    decoded[column].count += 1
  }

  // Spectora's declared order per comment, used to restore display order once
  // every row has been read.
  const declaredOrders = new Map<ParsedComment, number | null>()

  let mappedRowCount = 0
  let unmappedRowCount = 0
  let untrimmedNames = 0
  let untrimmedSample: string | null = null
  let typeInterleavedItems = 0

  rows.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + FIRST_DATA_ROW
    const rawSection = at(row, 'sectionName')
    const rawItem = at(row, 'itemName')

    // A row with no section or item cannot be placed in the hierarchy. It is
    // reported with its row number rather than dropped or guessed at.
    if (rawSection.trim() === '' || rawItem.trim() === '') {
      const empty = rawSection.trim() === '' ? MAPPED_COLUMNS.sectionName : MAPPED_COLUMNS.itemName
      const hasContent = row.some((value) => value.trim() !== '')
      unmappedRowCount += 1
      issues.add({
        kind: hasContent ? 'ambiguous' : 'malformed_row',
        severity: hasContent ? 'warning' : 'info',
        sourceRow,
        sourceColumn: empty,
        message: hasContent
          ? `Row ${sourceRow} has no ${empty}, so there is no place in the template to put it. It was not imported.`
          : `Row ${sourceRow} is blank and was skipped.`,
        sample: hasContent ? row.find((value) => value.trim() !== '') ?? null : null,
      })
      return
    }

    for (const [column, value] of [
      [MAPPED_COLUMNS.sectionName, rawSection],
      [MAPPED_COLUMNS.itemName, rawItem],
      [MAPPED_COLUMNS.commentName, at(row, 'commentName')],
    ] as const) {
      if (value !== value.trim() && value.trim() !== '') {
        untrimmedNames += 1
        untrimmedSample ??= `${column}: ${JSON.stringify(value)}`
      }
    }

    const sectionName = decodeName(rawSection, noteDecode(MAPPED_COLUMNS.sectionName))
    const itemName = decodeName(rawItem, noteDecode(MAPPED_COLUMNS.itemName))
    const commentName = decodeName(at(row, 'commentName'), noteDecode(MAPPED_COLUMNS.commentName))

    let section = sectionsByName.get(sectionName)
    if (!section) {
      section = { name: sectionName, position: sections.length, items: [] }
      sections.push(section)
      sectionsByName.set(sectionName, section)
    }

    const itemKey = `${sectionName}\u0000${itemName}`
    let item = itemsBySectionAndName.get(itemKey)
    if (!item) {
      item = { name: itemName, position: section.items.length, comments: [] }
      section.items.push(item)
      itemsBySectionAndName.set(itemKey, item)
    }

    const rawExtras: Record<string, string> = {}
    for (const index of unmappedIndexes) {
      const value = row[index] ?? ''
      if (value.trim() !== '') rawExtras[header[index] || `column ${index + 1}`] = value
    }

    const declaredOrder = at(row, 'order')
    if (declaredOrder.trim() !== '') {
      const orderIndex = columns.get('order')
      rawExtras[orderIndex === undefined ? MAPPED_COLUMNS.order : header[orderIndex]] = declaredOrder
    }
    const parsedOrder = Number.parseInt(declaredOrder.trim(), 10)

    const comment: ParsedComment = {
      name: commentName,
      // Comment bodies are already HTML at this point and are stored exactly
      // as the file had them. Escaping happens when they are rendered.
      bodyHtml: at(row, 'commentText'),
      commentType: at(row, 'commentType').trim() || null,
      answerType: at(row, 'answerType').trim() || null,
      recommendation: at(row, 'recommendation').trim() || null,
      severity: parseSeverity(at(row, 'severity'), sourceRow, issues),
      defaultValue: at(row, 'defaultValue').trim() || null,
      choiceOptions: splitOptions(at(row, 'choiceOptions')),
      unitOptions: splitOptions(at(row, 'unitOptions')),
      // Replaced below, once the whole item is known.
      position: item.comments.length,
      sourceRow,
      rawExtras,
    }

    declaredOrders.set(comment, Number.isFinite(parsedOrder) ? parsedOrder : null)
    item.comments.push(comment)
    mappedRowCount += 1
  })

  // Restore the order the inspector sees. Rows arrive with the types
  // interleaved, so position is assigned only once every comment in an item
  // is known: by type group first, then by Spectora's order within the group,
  // and finally by row so that equal or missing orders stay stable.
  for (const section of sections) {
    for (const item of section.items) {
      const fileOrder = item.comments.map((comment) => comment.sourceRow)
      item.comments.sort((a, b) => {
        const byType = typeRank(a.commentType) - typeRank(b.commentType)
        if (byType !== 0) return byType
        const orderA = declaredOrders.get(a)
        const orderB = declaredOrders.get(b)
        if (orderA !== null && orderA !== undefined && orderB !== null && orderB !== undefined && orderA !== orderB) {
          return orderA - orderB
        }
        return a.sourceRow - b.sourceRow
      })
      item.comments.forEach((comment, index) => {
        comment.position = index
      })
      if (item.comments.some((comment, index) => comment.sourceRow !== fileOrder[index])) {
        typeInterleavedItems += 1
      }
    }
  }

  for (const [column, { count, sample }] of Object.entries(decoded)) {
    issues.add({
      kind: 'normalised',
      severity: 'info',
      sourceColumn: column,
      affectedCount: count,
      sample,
      message: `${count} ${column} value${count === 1 ? '' : 's'} arrived HTML-encoded and were decoded to the text the inspector typed.`,
    })
  }

  if (untrimmedNames > 0) {
    issues.add({
      kind: 'normalised',
      severity: 'info',
      affectedCount: untrimmedNames,
      sample: untrimmedSample,
      message: `${untrimmedNames} name${untrimmedNames === 1 ? '' : 's'} have leading or trailing spaces. They were kept exactly as exported rather than tidied.`,
    })
  }

  if (typeInterleavedItems > 0) {
    issues.add({
      kind: 'normalised',
      severity: 'info',
      sourceColumn: MAPPED_COLUMNS.order,
      affectedCount: typeInterleavedItems,
      message:
        `In ${typeInterleavedItems} item${typeInterleavedItems === 1 ? '' : 's'} the export interleaves informational, ` +
        `limitation and deficiency comments, and restarts its order count for each. They were reordered to the ` +
        `grouping Spectora displays rather than left in row order.`,
    })
  }

  for (const index of unmappedIndexes) {
    const columnHeader = header[index] || `column ${index + 1}`
    const { kind, severity, message, count, sample } = classifyUnmappedColumn(
      columnHeader,
      rows.map((row) => row[index] ?? ''),
    )
    issues.add({ kind, severity, sourceColumn: columnHeader, affectedCount: count, message, sample })
  }

  const itemCount = sections.reduce((total, section) => total + section.items.length, 0)
  const commentCount = sections.reduce(
    (total, section) => total + section.items.reduce((sum, item) => sum + item.comments.length, 0),
    0,
  )

  return {
    template: { name: templateNameFrom(fileName), sections },
    issues: issues.all(),
    stats: {
      sourceRowCount: rows.length,
      mappedRowCount,
      unmappedRowCount,
      sourceColumnCount: header.length,
      mappedColumnCount: columns.size,
      sectionCount: sections.length,
      itemCount,
      commentCount,
    },
  }
}

/**
 * Spectora names its exports after the template plus the export date, e.g.
 * "InterNACHI Residential -2026-09-20.xls". The date and the separator left
 * behind by it are not part of the template's name.
 */
export function templateNameFrom(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[a-z0-9]+$/i, '')
  const withoutDate = withoutExtension.replace(/[\s-]*\d{4}-\d{2}-\d{2}$/, '')
  return withoutDate.trim().replace(/[\s-]+$/, '').trim() || withoutExtension.trim() || 'Imported template'
}
