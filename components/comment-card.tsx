import Link from 'next/link'
import { updateCommentAction } from '@/app/actions'
import { renderCommentHtml } from '@/lib/html'
import type { CommentRow } from '@/lib/db/templates'

const TYPE_LABELS: Record<string, { label: string; className: string }> = {
  info: { label: 'Informational', className: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200' },
  limit: { label: 'Limitation', className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  defect: { label: 'Deficiency', className: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200' },
}

/** Spectora documents its category column as -1 low, 0 medium, 1 high. */
const SEVERITY_LABELS: Record<number, string> = { [-1]: 'Low', 0: 'Medium', 1: 'High' }

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${className || 'bg-accent-soft text-muted'}`}>
      {children}
    </span>
  )
}

export function CommentCard({
  comment,
  templateId,
  sectionId,
  editing,
}: {
  comment: CommentRow
  templateId: string
  sectionId: string
  editing: boolean
}) {
  const back = `/templates/${templateId}?section=${sectionId}`
  const type = comment.commentType ? TYPE_LABELS[comment.commentType] : undefined
  const extras = Object.entries(comment.rawExtras)

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          {/* Names are rendered with any leading or trailing spaces intact, so
              quotes make an otherwise invisible difference visible. */}
          <h4 className="font-medium">
            {comment.name === comment.name.trim() ? (
              comment.name
            ) : (
              <>
                {comment.name}
                <span className="ml-1.5 text-xs font-normal text-muted" title="This name has whitespace at one end, kept as exported">
                  ␣
                </span>
              </>
            )}
          </h4>

          {type ? <Badge className={type.className}>{type.label}</Badge> : null}
          {comment.severity !== null ? <Badge>{SEVERITY_LABELS[comment.severity] ?? `Severity ${comment.severity}`}</Badge> : null}
          {comment.recommendation ? <Badge>Recommends: {comment.recommendation}</Badge> : null}
          {comment.defaultValue === 'true' ? <Badge>Selected by default</Badge> : null}
        </div>

        {editing ? null : (
          <Link
            href={`${back}&edit=${comment.id}`}
            scroll={false}
            className="shrink-0 text-sm text-muted hover:text-accent hover:underline"
          >
            Edit
          </Link>
        )}
      </div>

      {editing ? (
        <form action={updateCommentAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="id" value={comment.id} />
          <input type="hidden" name="templateId" value={templateId} />

          <label className="text-xs font-medium text-muted" htmlFor={`name-${comment.id}`}>
            Name
          </label>
          <input
            id={`name-${comment.id}`}
            name="name"
            defaultValue={comment.name}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />

          <label className="mt-1 text-xs font-medium text-muted" htmlFor={`body-${comment.id}`}>
            Comment text
          </label>
          <textarea
            id={`body-${comment.id}`}
            name="bodyHtml"
            defaultValue={comment.bodyHtml}
            rows={8}
            spellCheck={false}
            className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
          />
          <p className="text-xs text-muted">
            Edited as HTML on purpose. A formatting toolbar would rewrite this markup every time it saved,
            which is how imported templates quietly drift away from the original.
          </p>

          <div className="mt-1 flex items-center gap-2">
            <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
              Save
            </button>
            <Link href={back} scroll={false} className="text-sm text-muted hover:underline">
              Cancel
            </Link>
          </div>
        </form>
      ) : (
        <>
          {comment.bodyHtml.trim() === '' ? (
            <p className="mt-1 text-sm text-muted italic">No comment text in the export.</p>
          ) : (
            <div
              className="comment-body mt-1 text-sm"
              // Sanitised immediately above; the stored value is never altered.
              dangerouslySetInnerHTML={{ __html: renderCommentHtml(comment.bodyHtml) }}
            />
          )}

          {comment.choiceOptions.length > 0 ? (
            <p className="mt-2 text-xs text-muted">Options: {comment.choiceOptions.join(' · ')}</p>
          ) : null}
          {comment.unitOptions.length > 0 ? (
            <p className="mt-1 text-xs text-muted">Units: {comment.unitOptions.join(' · ')}</p>
          ) : null}

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-muted hover:text-accent">
              From row {comment.sourceRow ?? '—'}
              {extras.length > 0 ? ` · ${extras.length} columns kept but not modelled` : ''}
            </summary>
            {extras.length > 0 ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-l-2 border-border pl-3 text-xs">
                {extras.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-mono text-muted">{key}</dt>
                    <dd className="font-mono break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 pl-3 text-xs text-muted">Every column for this row was imported.</p>
            )}
          </details>
        </>
      )}
    </li>
  )
}
