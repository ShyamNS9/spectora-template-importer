import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { NotASpectoraExportError, parseSpectoraExport, templateNameFrom } from './parse'
import { UnreadableFileError } from './xlsx'
import type { ParsedComment } from './types'

const INTERNACHI = 'fixtures/InterNACHI Residential -2026-09-20.xls'
const ROOM_BY_ROOM = 'fixtures/Room-by-Room Residential Template-2026-09-20.xls'

function parseFixture(path: string) {
  return parseSpectoraExport(new Uint8Array(readFileSync(path)), path.split('/').pop()!)
}

function everyComment(sections: ReturnType<typeof parseFixture>['template']['sections']): ParsedComment[] {
  return sections.flatMap((section) => section.items.flatMap((item) => item.comments))
}

/**
 * Builds a minimal workbook that stores its text in a shared string table.
 * Spectora's own exports never use one, so without this the reader's shared
 * string path would go untested until a different export arrived.
 */
function workbookWithSharedStrings(rows: string[][]): Uint8Array {
  const strings = [...new Set(rows.flat())]
  const index = new Map(strings.map((value, i) => [value, i]))
  const column = (n: number) => String.fromCharCode(65 + n)

  const sheet =
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">` +
          row.map((value, c) => `<c r="${column(c)}${r + 1}" t="s"><v>${index.get(value)}</v></c>`).join('') +
          `</row>`,
      )
      .join('') +
    `</sheetData></worksheet>`

  const sst =
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    strings.map((value) => `<si><t>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('') +
    `</sst>`

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/sharedStrings.xml': strToU8(sst),
  })
}

test('imports every row of the InterNACHI export', () => {
  const { stats } = parseFixture(INTERNACHI)

  assert.equal(stats.sourceRowCount, 392)
  assert.equal(stats.sectionCount, 13)
  assert.equal(stats.itemCount, 69)
  assert.equal(stats.commentCount, 392)
  // The invariant the import summary reports: nothing may go unaccounted for.
  assert.equal(stats.mappedRowCount + stats.unmappedRowCount, stats.sourceRowCount)
  assert.equal(stats.unmappedRowCount, 0)
})

test('imports every row of a structurally different export', () => {
  const { stats } = parseFixture(ROOM_BY_ROOM)

  assert.equal(stats.sourceRowCount, 798)
  assert.equal(stats.sectionCount, 22)
  assert.equal(stats.itemCount, 136)
  assert.equal(stats.mappedRowCount + stats.unmappedRowCount, stats.sourceRowCount)
})

test('keeps sections in the order the file presents them', () => {
  const { template } = parseFixture(INTERNACHI)

  assert.deepEqual(
    template.sections.slice(0, 4).map((section) => section.name),
    ['Inspection Details', 'Exterior', 'Roof', 'Basement, Foundation, Crawlspace & Structure'],
  )
  template.sections.forEach((section, index) => assert.equal(section.position, index))
})

test('decodes the doubly encoded entities in names', () => {
  const { template } = parseFixture(INTERNACHI)
  const names = template.sections.flatMap((section) => [section.name, ...section.items.map((item) => item.name)])

  assert.ok(names.includes('Basement, Foundation, Crawlspace & Structure'))
  assert.ok(names.includes('Siding, Flashing & Trim'))
  assert.ok(!names.some((name) => name.includes('&amp;')))
})

test('leaves comment HTML exactly as exported', () => {
  const comments = everyComment(parseFixture(INTERNACHI).template.sections)

  const downspouts = comments.find((comment) => comment.name === 'Downspouts Drain Near House')
  assert.ok(downspouts)
  assert.ok(downspouts.bodyHtml.includes('href="https://www.thisoldhouse.com/how-to/how-to-drain-downspout-water-flow-away-house"'))
  assert.ok(downspouts.bodyHtml.includes('target="_blank"'))

  // Hive rewrites <strong> to <b> on import; a faithful import does not.
  const homeowner = comments.find((comment) => comment.name === "Homeowner's Responsibility")
  assert.ok(homeowner)
  assert.ok(homeowner.bodyHtml.includes('<strong>'))
  assert.equal(homeowner.bodyHtml.length, 665)
})

test('preserves whitespace in names instead of tidying it', () => {
  const comments = everyComment(parseFixture(INTERNACHI).template.sections)

  assert.ok(comments.some((comment) => comment.name === 'Temperature '))
})

test('keeps the fields Spectora exports and Hive drops', () => {
  const comments = everyComment(parseFixture(INTERNACHI).template.sections)

  const temperature = comments.find((comment) => comment.name === 'Temperature ')
  assert.ok(temperature)
  assert.equal(temperature.answerType, 'number')
  assert.deepEqual(temperature.unitOptions, ['Fahrenheit (F)', 'Celsius (C)'])
  assert.equal(temperature.recommendation, 'pro')

  const attendance = comments.find((comment) => comment.name === 'In Attendance')
  assert.deepEqual(attendance?.choiceOptions, ['Home Owner', 'Client', "Client's Agent", 'Listing Agent'])

  const homeowner = comments.find((comment) => comment.name === "Homeowner's Responsibility")
  assert.equal(homeowner?.defaultValue, 'true')
})

test('restores the grouped order Spectora displays', () => {
  const { template } = parseFixture(INTERNACHI)
  const coverings = template.sections
    .find((section) => section.name === 'Roof')!
    .items.find((item) => item.name === 'Coverings')!

  // The file interleaves types; the informational comment belongs first.
  assert.equal(coverings.comments[0].name, 'Material')
  assert.equal(coverings.comments[0].commentType, 'info')

  for (const section of template.sections) {
    for (const item of section.items) {
      item.comments.forEach((comment, index) => assert.equal(comment.position, index))

      const seen = new Set<string>()
      let previous = ''
      for (const comment of item.comments) {
        const type = comment.commentType ?? ''
        assert.ok(!(type !== previous && seen.has(type)), `types interleaved in ${section.name} > ${item.name}`)
        seen.add(type)
        previous = type
      }
    }
  }
})

test('keeps unmapped columns on the comment rather than dropping them', () => {
  const comments = everyComment(parseFixture(INTERNACHI).template.sections)
  const extras = comments[0].rawExtras

  assert.ok('Last Modified' in extras)
  assert.ok('Default Estimate Min' in extras)
  assert.ok(comments.every((comment) => !('' in comment.rawExtras)))
})

test('reports empty, degenerate and unmodelled columns separately', () => {
  const { issues } = parseFixture(INTERNACHI)
  const find = (column: string) => issues.find((issue) => issue.sourceColumn === column)

  assert.equal(find('Default Photo 1')?.kind, 'missing_from_export')
  assert.equal(find('Default Estimate Min')?.kind, 'degenerate_default')
  assert.equal(find('Default Estimate Min')?.sample, '10')
  assert.equal(find('Last Modified')?.kind, 'unsupported_by_importer')
  assert.ok(issues.some((issue) => issue.kind === 'normalised'))
})

test('reads workbooks that use a shared string table', () => {
  const file = workbookWithSharedStrings([
    ['Section Name', 'Item Name', 'Comment Name', 'Comment Text'],
    ['Roof', 'Coverings', 'Damaged', '<p>Damaged.</p>'],
  ])

  const { template, stats } = parseSpectoraExport(file, 'shared.xlsx')
  assert.equal(stats.commentCount, 1)
  assert.equal(template.sections[0].items[0].comments[0].bodyHtml, '<p>Damaged.</p>')
})

test('rejects a spreadsheet that is not a template export', () => {
  const file = workbookWithSharedStrings([
    ['Invoice Number', 'Client', 'Amount'],
    ['INV-1', 'Acme', '100'],
  ])

  assert.throws(() => parseSpectoraExport(file, 'invoices.xlsx'), NotASpectoraExportError)
})

test('rejects files that are not spreadsheets at all', () => {
  assert.throws(() => parseSpectoraExport(strToU8('just some text'), 'notes.txt'), UnreadableFileError)

  const legacyXls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
  assert.throws(() => parseSpectoraExport(legacyXls, 'old.xls'), UnreadableFileError)
})

test('reports rows that cannot be placed instead of silently skipping them', () => {
  const file = workbookWithSharedStrings([
    ['Section Name', 'Item Name', 'Comment Name', 'Comment Text'],
    ['Roof', 'Coverings', 'Damaged', '<p>Damaged.</p>'],
    ['', '', 'Orphaned comment', '<p>No section.</p>'],
  ])

  const { stats, issues } = parseSpectoraExport(file, 'partial.xlsx')

  assert.equal(stats.mappedRowCount, 1)
  assert.equal(stats.unmappedRowCount, 1)
  assert.equal(stats.mappedRowCount + stats.unmappedRowCount, stats.sourceRowCount)

  const ambiguous = issues.find((issue) => issue.kind === 'ambiguous')
  assert.equal(ambiguous?.sourceRow, 3)
  assert.equal(ambiguous?.severity, 'warning')
})

test('derives a template name from Spectora’s export filename', () => {
  assert.equal(templateNameFrom('InterNACHI Residential -2026-09-20.xls'), 'InterNACHI Residential')
  assert.equal(templateNameFrom('Room-by-Room Residential Template-2026-09-20.xls'), 'Room-by-Room Residential Template')
  assert.equal(templateNameFrom('template.xlsx'), 'template')
})
