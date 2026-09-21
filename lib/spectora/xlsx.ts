import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

/**
 * Cell text exactly as stored in the file: never trimmed, never coerced to a
 * number, never normalised. A trailing space in a comment name is the
 * inspector's data until we decide otherwise somewhere we can report it.
 */
export type Sheet = string[][]

export class UnreadableFileError extends Error {}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Cell text is data, not markup: trimming it or parsing "0123" into a number
  // would lose the inspector's content before we ever get to look at it.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  // Numeric character references are only decoded with this on. Spectora
  // encodes line breaks inside comment bodies as &#13;&#10;, which without
  // this setting arrive as the literal text "&#13;&#10;" rather than as a
  // line break. It resolves exactly one level, so a doubly-encoded "&amp;amp;"
  // still arrives as "&amp;" for the parser to deal with deliberately.
  htmlEntities: true,
  isArray: (name) => name === 'row' || name === 'c' || name === 'si' || name === 'r',
})

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b)
}

/**
 * Spreadsheet columns are labelled A..Z, AA..AZ, ... Cell references combine
 * that label with a row number, e.g. "AP393".
 */
function columnIndex(cellRef: string): number {
  let index = 0
  for (const char of cellRef) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) break
    index = index * 26 + (code - 64)
  }
  return index - 1
}

/**
 * A text node may be a bare string, or an object when the element carries
 * attributes such as xml:space="preserve". Shared and inline strings may also
 * be split into several <r> runs when parts of the text were styled
 * differently, in which case the full value is the runs concatenated.
 */
function textContent(node: unknown): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')

  const element = node as Record<string, unknown>
  if ('r' in element) return textContent(element.r)
  if ('t' in element) return textContent(element.t)
  if ('#text' in element) return String(element['#text'])
  return ''
}

function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const entry = files['xl/sharedStrings.xml']
  if (!entry) return []

  const parsed = parser.parse(strFromU8(entry)) as {
    sst?: { si?: unknown[] }
  }
  return (parsed.sst?.si ?? []).map(textContent)
}

/**
 * Resolves one cell to its text. The `t` attribute selects how the value is
 * stored, and the cases differ more than they look:
 *
 *   s          - index into the shared string table
 *   inlineStr  - text embedded in the cell itself
 *   str        - a string, nominally a formula result
 *   b          - boolean, stored as 0 or 1
 *   e          - an error value such as #REF!
 *   (absent)   - a number, kept as its literal text
 *
 * Spectora's exports use `str` for every string cell and ship no shared string
 * table at all, which is unusual enough that readers assuming `s` or
 * `inlineStr` return empty strings for the entire sheet.
 */
function cellText(cell: Record<string, unknown>, sharedStrings: string[]): string {
  const type = cell['@t']

  if (type === 'inlineStr') return textContent(cell.is)

  if (type === 's') {
    const index = Number(textContent(cell.v))
    return sharedStrings[index] ?? ''
  }

  return textContent(cell.v)
}

function firstWorksheetPath(files: Record<string, Uint8Array>): string {
  const paths = Object.keys(files)
    .filter((path) => path.startsWith('xl/worksheets/') && path.endsWith('.xml'))
    .sort()

  if (paths.length === 0) {
    throw new UnreadableFileError('The spreadsheet contains no worksheets.')
  }
  return paths[0]
}

/**
 * Reads the first worksheet of an XLSX file into a rectangular grid.
 *
 * Rows and cells are both sparse in the file format: empty trailing cells are
 * simply absent, and a row with no content at all may be skipped entirely.
 * Gaps are filled with empty strings so that a row's array index always
 * matches its spreadsheet column.
 */
export function readFirstSheet(file: Uint8Array): Sheet {
  if (startsWith(file, OLE2_MAGIC)) {
    throw new UnreadableFileError(
      'This is a legacy Excel (.xls) workbook. Spectora exports are XLSX despite ' +
        'their .xls extension, so this file did not come from a Spectora template export.',
    )
  }
  if (!startsWith(file, ZIP_MAGIC)) {
    throw new UnreadableFileError(
      'This file is not a spreadsheet. Expected an XLSX workbook from ' +
        'Spectora’s “Export to spreadsheet → Export HTML Text”.',
    )
  }

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(file)
  } catch {
    throw new UnreadableFileError('The spreadsheet archive is corrupt and could not be opened.')
  }

  const sharedStrings = readSharedStrings(files)
  const parsed = parser.parse(strFromU8(files[firstWorksheetPath(files)])) as {
    worksheet?: { sheetData?: { row?: Record<string, unknown>[] } }
  }

  const rows = parsed.worksheet?.sheetData?.row ?? []
  const grid: Sheet = []

  for (const row of rows) {
    const cells = (row.c ?? []) as Record<string, unknown>[]
    const byColumn = new Map<number, string>()

    for (const cell of cells) {
      const ref = cell['@r']
      if (typeof ref !== 'string') continue
      byColumn.set(columnIndex(ref), cellText(cell, sharedStrings))
    }

    // A row's own index is authoritative: relying on array order would shift
    // every later row if the file skipped an empty one.
    const rowNumber = Number(row['@r'])
    const width = byColumn.size === 0 ? 0 : Math.max(...byColumn.keys()) + 1
    const values = Array.from({ length: width }, (_, i) => byColumn.get(i) ?? '')

    if (Number.isFinite(rowNumber) && rowNumber >= 1) {
      grid[rowNumber - 1] = values
    } else {
      grid.push(values)
    }
  }

  return Array.from(grid, (row) => row ?? [])
}
