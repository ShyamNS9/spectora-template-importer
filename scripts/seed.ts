/**
 * Imports the committed Spectora exports so a fresh database opens with
 * something to look at.
 *
 *   npm run seed
 *
 * Skips a file that has already been imported, identified by its checksum, so
 * running it twice does not produce duplicate templates.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { db } from '../lib/db/client'
import { saveImport } from '../lib/db/import'
import { parseSpectoraExport } from '../lib/spectora/parse'

const FIXTURES = [
  'InterNACHI Residential -2026-09-20.xls',
  'Room-by-Room Residential Template-2026-09-20.xls',
]

async function main() {
  const sql = db()

  for (const fixture of FIXTURES) {
    const path = join(process.cwd(), 'fixtures', fixture)
    const contents = new Uint8Array(readFileSync(path))
    const sha256 = createHash('sha256').update(contents).digest('hex')

    const existing = await sql<{ id: string }[]>`
      select id from import_runs where file_sha256 = ${sha256} limit 1
    `
    if (existing.length > 0) {
      console.log(`${basename(path)}: already imported, skipping`)
      continue
    }

    const parsed = parseSpectoraExport(contents, basename(path))
    const { templateId } = await saveImport(parsed, {
      name: basename(path),
      bytes: contents.byteLength,
      contents,
    })

    const { stats } = parsed
    console.log(
      `${parsed.template.name}: ${stats.sectionCount} sections, ${stats.itemCount} items, ` +
        `${stats.commentCount} comments, ${parsed.issues.length} notes -> ${templateId}`,
    )
  }
}

main()
  .catch((error) => {
    console.error('seed failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db().end()
  })
