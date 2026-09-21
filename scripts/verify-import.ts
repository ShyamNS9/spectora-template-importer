/**
 * Compares stored templates against the files they were imported from.
 *
 *   npm run verify
 *
 * Reads each template back out of the database, parses its source file again,
 * and checks the two agree on structure, ordering and every comment's text.
 * This is the evidence behind the import summary's claim that nothing was
 * lost: it reads the database, not the importer's own report of itself.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../lib/db/client'
import { parseSpectoraExport } from '../lib/spectora/parse'
import { loadTemplate } from '../lib/db/templates'

type Failure = { where: string; expected: string; actual: string }

/**
 * jsonb does not keep the key order it was given, so raw_extras comes back
 * ordered differently from the object that was stored. Keys are sorted before
 * comparing, which checks the contents without asserting an order Postgres
 * never promised.
 */
function canonical(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => canonical(entry)))

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries.map(([key, entry]) => [key, canonical(entry)]))
}

function compare(failures: Failure[], where: string, expected: unknown, actual: unknown): void {
  const e = canonical(expected)
  const a = canonical(actual)
  if (e !== a) failures.push({ where, expected: e, actual: a })
}

async function main() {
  const sql = db()

  const templates = await sql<{ id: string; name: string; source_file_name: string | null }[]>`
    select id, name, source_file_name
    from templates
    where copied_from_id is null
    order by created_at
  `

  if (templates.length === 0) {
    console.log('no imported templates to verify')
    return
  }

  let totalFailures = 0

  for (const row of templates) {
    if (!row.source_file_name) continue

    const path = join(process.cwd(), 'fixtures', row.source_file_name)
    let contents: Uint8Array
    try {
      contents = new Uint8Array(readFileSync(path))
    } catch {
      console.log(`${row.name}: source file not in fixtures/, skipped`)
      continue
    }

    const source = parseSpectoraExport(contents, row.source_file_name)
    const stored = await loadTemplate(row.id)
    if (!stored) continue

    const failures: Failure[] = []

    compare(failures, 'section count', source.template.sections.length, stored.sections.length)

    source.template.sections.forEach((expectedSection, s) => {
      const actualSection = stored.sections[s]
      if (!actualSection) {
        failures.push({ where: `section ${s}`, expected: expectedSection.name, actual: 'missing' })
        return
      }

      compare(failures, `section ${s} name`, expectedSection.name, actualSection.name)
      compare(failures, `section ${s} item count`, expectedSection.items.length, actualSection.items.length)

      expectedSection.items.forEach((expectedItem, i) => {
        const actualItem = actualSection.items[i]
        if (!actualItem) {
          failures.push({ where: `${expectedSection.name} > item ${i}`, expected: expectedItem.name, actual: 'missing' })
          return
        }

        compare(failures, `${expectedSection.name} > item ${i} name`, expectedItem.name, actualItem.name)
        compare(
          failures,
          `${expectedSection.name} > ${expectedItem.name} comment count`,
          expectedItem.comments.length,
          actualItem.comments.length,
        )

        expectedItem.comments.forEach((expectedComment, c) => {
          const actualComment = actualItem.comments[c]
          const at = `${expectedSection.name} > ${expectedItem.name} > [${c}]`
          if (!actualComment) {
            failures.push({ where: at, expected: expectedComment.name, actual: 'missing' })
            return
          }

          compare(failures, `${at} name`, expectedComment.name, actualComment.name)
          compare(failures, `${at} body`, expectedComment.bodyHtml, actualComment.bodyHtml)
          compare(failures, `${at} type`, expectedComment.commentType, actualComment.commentType)
          compare(failures, `${at} severity`, expectedComment.severity, actualComment.severity)
          compare(failures, `${at} answer type`, expectedComment.answerType, actualComment.answerType)
          compare(failures, `${at} recommendation`, expectedComment.recommendation, actualComment.recommendation)
          compare(failures, `${at} choices`, expectedComment.choiceOptions, actualComment.choiceOptions)
          compare(failures, `${at} units`, expectedComment.unitOptions, actualComment.unitOptions)
          compare(failures, `${at} source row`, expectedComment.sourceRow, actualComment.sourceRow)
          compare(failures, `${at} extras`, expectedComment.rawExtras, actualComment.rawExtras)
        })
      })
    })

    const comments = source.template.sections.reduce(
      (total, section) => total + section.items.reduce((sum, item) => sum + item.comments.length, 0),
      0,
    )

    if (failures.length === 0) {
      console.log(
        `${row.name}: ${stored.sections.length} sections, ` +
          `${stored.sections.reduce((n, s) => n + s.items.length, 0)} items, ${comments} comments verified against ${row.source_file_name}`,
      )
    } else {
      totalFailures += failures.length
      console.log(`${row.name}: ${failures.length} mismatches`)
      for (const failure of failures.slice(0, 10)) {
        console.log(`  ${failure.where}\n    file: ${failure.expected.slice(0, 90)}\n    db  : ${failure.actual.slice(0, 90)}`)
      }
      if (failures.length > 10) console.log(`  ... and ${failures.length - 10} more`)
    }
  }

  if (totalFailures > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('verify failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db().end()
  })
