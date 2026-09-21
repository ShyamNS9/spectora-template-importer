import { createHash } from 'node:crypto'
import type { TransactionSql } from 'postgres'
import { db } from './client'
import type { ImportIssue, ParseResult } from '../spectora/types'

/** Rows are sent in batches so a large template does not build one enormous statement. */
const INSERT_BATCH = 500

export type SavedImport = {
  templateId: string
  importRunId: string
}

/**
 * Writes a parsed template and the account of its import.
 *
 * Everything happens in one transaction. A template that is half imported is
 * worse than one that failed: the inspector would have no way to tell which
 * of their comments were missing, and the numbers on the import summary would
 * describe a file rather than what is actually stored.
 */
export async function saveImport(
  parsed: ParseResult,
  file: { name: string; bytes: number; contents: Uint8Array },
): Promise<SavedImport> {
  const sha256 = createHash('sha256').update(file.contents).digest('hex')

  return db().begin(async (tx) => {
    const [template] = await tx<{ id: string }[]>`
      insert into templates (name, source, source_file_name)
      values (${parsed.template.name}, 'spectora_html_text', ${file.name})
      returning id
    `

    await insertTree(tx, template.id, parsed)

    const { stats } = parsed
    const [run] = await tx<{ id: string }[]>`
      insert into import_runs ${tx({
        template_id: template.id,
        file_name: file.name,
        file_sha256: sha256,
        file_bytes: file.bytes,
        source_row_count: stats.sourceRowCount,
        mapped_row_count: stats.mappedRowCount,
        unmapped_row_count: stats.unmappedRowCount,
        source_column_count: stats.sourceColumnCount,
        mapped_column_count: stats.mappedColumnCount,
        section_count: stats.sectionCount,
        item_count: stats.itemCount,
        comment_count: stats.commentCount,
        status: 'succeeded',
      })}
      returning id
    `

    await insertIssues(tx, run.id, parsed.issues)

    return { templateId: template.id, importRunId: run.id }
  })
}

async function insertTree(tx: TransactionSql, templateId: string, parsed: ParseResult): Promise<void> {
  for (const section of parsed.template.sections) {
    const [saved] = await tx<{ id: string }[]>`
      insert into sections (template_id, name, position)
      values (${templateId}, ${section.name}, ${section.position})
      returning id
    `

    for (const item of section.items) {
      const [savedItem] = await tx<{ id: string }[]>`
        insert into items (section_id, name, position)
        values (${saved.id}, ${item.name}, ${item.position})
        returning id
      `

      const rows = item.comments.map((comment) => ({
        item_id: savedItem.id,
        name: comment.name,
        body_html: comment.bodyHtml,
        comment_type: comment.commentType,
        answer_type: comment.answerType,
        recommendation: comment.recommendation,
        severity: comment.severity,
        default_value: comment.defaultValue,
        choice_options: comment.choiceOptions,
        unit_options: comment.unitOptions,
        position: comment.position,
        source_row: comment.sourceRow,
        raw_extras: comment.rawExtras,
      }))

      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await tx`insert into comments ${tx(rows.slice(i, i + INSERT_BATCH))}`
      }
    }
  }
}

async function insertIssues(tx: TransactionSql, importRunId: string, issues: ImportIssue[]): Promise<void> {
  if (issues.length === 0) return

  const rows = issues.map((issue) => ({
    import_run_id: importRunId,
    kind: issue.kind,
    severity: issue.severity,
    source_column: issue.sourceColumn,
    source_row: issue.sourceRow,
    affected_count: issue.affectedCount,
    message: issue.message,
    sample: issue.sample === null ? null : JSON.stringify(issue.sample),
  }))

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await tx`insert into import_issues ${tx(rows.slice(i, i + INSERT_BATCH))}`
  }
}
