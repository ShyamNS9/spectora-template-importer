/**
 * Prints the shape of a Spectora export without importing it.
 *
 * Point this at a customer's file before touching the database: it reports
 * what the file actually contains, which columns carry data, and which of the
 * known encoding traps are present. Used while building the importer and
 * useful on its own when a new export does not behave.
 *
 *   npx tsx scripts/inspect-export.ts <file.xls> [...]
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readFirstSheet, UnreadableFileError, type Sheet } from '../lib/spectora/xlsx'

const MAX_DISTINCT = 8

function cell(sheet: Sheet, row: number, column: number): string {
  return sheet[row]?.[column] ?? ''
}

function describeColumn(sheet: Sheet, column: number): string {
  const values = sheet.slice(1).map((_, i) => cell(sheet, i + 1, column))
  const filled = values.filter((value) => value.trim() !== '')
  if (filled.length === 0) return 'empty in every row'

  const distinct = new Set(filled)
  const fill = `${filled.length}/${values.length}`

  if (distinct.size === 1) {
    return `${fill}, one value everywhere: ${JSON.stringify([...distinct][0].slice(0, 40))}`
  }
  if (distinct.size <= MAX_DISTINCT) {
    const counts = [...distinct]
      .map((value) => `${JSON.stringify(value.slice(0, 24))} x${filled.filter((v) => v === value).length}`)
      .join(', ')
    return `${fill}, ${distinct.size} distinct: ${counts}`
  }
  return `${fill}, ${distinct.size} distinct values`
}

function inspect(path: string): void {
  const sheet = readFirstSheet(new Uint8Array(readFileSync(path)))
  const header = sheet[0] ?? []
  const body = sheet.slice(1)

  console.log(`\n${'='.repeat(72)}\n${basename(path)}\n${'='.repeat(72)}`)
  console.log(`${body.length} data rows, ${header.length} columns`)

  const sections: string[] = []
  const items = new Set<string>()
  for (const row of body) {
    const section = row[0] ?? ''
    if (section && !sections.includes(section)) sections.push(section)
    if (section) items.add(`${section}\u0000${row[1] ?? ''}`)
  }
  console.log(`${sections.length} sections, ${items.size} items\n`)

  console.log('Sections in first-appearance order:')
  sections.forEach((name, i) => console.log(`  ${String(i + 1).padStart(2)}. ${name}`))

  console.log('\nColumns:')
  header.forEach((name, i) => {
    console.log(`  [${String(i).padStart(2)}] ${(name || '(unnamed)').slice(0, 44).padEnd(44)} ${describeColumn(sheet, i)}`)
  })

  // Encoding traps worth knowing about before an import, each one a silent
  // corruption if it goes unnoticed.
  const NAME_COLUMNS = [0, 1, 2]
  const hasEntity = (value: string) => /&(amp|lt|gt|quot|apos|nbsp|#x?[0-9a-f]+);/i.test(value)
  const firstMatch = (predicate: (value: string) => boolean) => {
    for (const row of body) {
      const column = NAME_COLUMNS.find((c) => predicate(row[c] ?? ''))
      if (column !== undefined) return row[column]
    }
    return undefined
  }

  const entityNames = body.filter((row) => NAME_COLUMNS.some((c) => hasEntity(row[c] ?? '')))
  const untrimmed = body.filter((row) => NAME_COLUMNS.some((c) => (row[c] ?? '') !== (row[c] ?? '').trim()))
  const nbsp = body.filter((row) => (row[3] ?? '').includes(' '))
  const carriageReturns = body.filter((row) => (row[3] ?? '').includes('\r'))
  const markup = body.filter((row) => /<[a-z]/i.test(row[3] ?? ''))

  console.log('\nEncoding notes:')
  console.log(`  names containing an HTML entity   ${entityNames.length}`)
  if (entityNames.length) console.log(`    e.g. ${JSON.stringify(firstMatch(hasEntity))}`)
  console.log(`  names with untrimmed whitespace   ${untrimmed.length}`)
  if (untrimmed.length) {
    console.log(`    e.g. ${JSON.stringify(firstMatch((value) => value !== value.trim() && value !== ''))}`)
  }
  console.log(`  comment bodies with markup        ${markup.length}`)
  console.log(`  comment bodies with &nbsp;        ${nbsp.length}`)
  console.log(`  comment bodies with CR            ${carriageReturns.length}`)
}

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: npx tsx scripts/inspect-export.ts <file.xls> [...]')
  process.exit(1)
}

for (const path of paths) {
  try {
    inspect(path)
  } catch (error) {
    if (error instanceof UnreadableFileError) {
      console.error(`\n${basename(path)}: ${error.message}`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
