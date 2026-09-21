import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadImportRun, type ImportIssueRow } from '@/lib/db/import'
import type { ImportIssueKind } from '@/lib/spectora/types'

export const dynamic = 'force-dynamic'

/**
 * How each kind is presented. The wording matters more than it looks: the
 * question an inspector is actually asking is "did I lose anything", and
 * these are the honest answers to it.
 */
const KINDS: Record<ImportIssueKind, { title: string; blurb: string }> = {
  malformed_row: {
    title: 'Could not be read',
    blurb: 'Rows in the file that could not be turned into a comment.',
  },
  ambiguous: {
    title: 'Could not be placed',
    blurb: 'Rows with content but no section or item to file them under, so they were not imported.',
  },
  degenerate_default: {
    title: 'Left out as a Spectora default',
    blurb:
      'Columns holding one identical value in every row. That is a default from Spectora rather than anything tuned in this template, so it was not imported. The values are still attached to each comment.',
  },
  unsupported_by_importer: {
    title: 'Kept but not modelled',
    blurb:
      'Columns carrying real data that this importer does not have a field for. Every value is stored with its comment, so nothing is lost.',
  },
  normalised: {
    title: 'Changed on the way in',
    blurb: 'Corrections made during import. Listed because a silent fix is still a change to your file.',
  },
  missing_from_export: {
    title: 'Not in the export',
    blurb:
      'Columns Spectora includes but left empty for this template. There was nothing to import, and nothing was lost.',
  },
}

const ORDER: ImportIssueKind[] = [
  'malformed_row',
  'ambiguous',
  'degenerate_default',
  'unsupported_by_importer',
  'normalised',
  'missing_from_export',
]

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-sm font-medium">{label}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  )
}

function IssueGroup({ kind, issues }: { kind: ImportIssueKind; issues: ImportIssueRow[] }) {
  const { title, blurb } = KINDS[kind]
  const rows = issues.reduce((total, issue) => total + issue.affectedCount, 0)

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
          {title}
          <span className="text-sm font-normal text-muted">
            {issues.length} {issues.length === 1 ? 'note' : 'notes'} · {rows.toLocaleString()} values
          </span>
        </h3>
        <p className="mt-1 text-sm text-muted">{blurb}</p>
      </div>

      <ul className="divide-y divide-border">
        {issues.map((issue) => (
          <li key={issue.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {issue.sourceColumn ? (
                <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs">
                  {issue.sourceColumn}
                </code>
              ) : null}
              {issue.sourceRow ? <span className="text-xs text-muted">row {issue.sourceRow}</span> : null}
            </div>
            <p className="mt-1 text-sm">{issue.message}</p>
            {issue.sample ? (
              <p className="mt-1 font-mono text-xs break-all text-muted">example: {issue.sample}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default async function ImportReviewPage({ params }: PageProps<'/templates/[id]/import'>) {
  const { id } = await params
  const result = await loadImportRun(id)
  if (!result) notFound()

  const { run, issues } = result
  const accounted = run.mappedRowCount + run.unmappedRowCount === run.sourceRowCount
  const grouped = ORDER.map((kind) => ({ kind, issues: issues.filter((issue) => issue.kind === kind) })).filter(
    (group) => group.issues.length > 0,
  )

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-accent hover:underline">
          ← All templates
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">{run.templateName}</h1>
        <p className="mt-1 text-sm text-muted">
          Imported from <span className="font-mono">{run.fileName}</span> ·{' '}
          {(run.fileBytes / 1024).toFixed(0)} KB ·{' '}
          {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(run.createdAt)}
        </p>
      </div>

      {/* The headline claim, stated as arithmetic rather than reassurance. */}
      <section
        className={`rounded-lg border p-5 ${
          accounted
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950'
            : 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950'
        }`}
      >
        <h2 className="font-semibold">
          {accounted
            ? `All ${run.sourceRowCount.toLocaleString()} rows in your file are accounted for`
            : 'Some rows in your file are unaccounted for'}
        </h2>
        <p className="mt-1 font-mono text-sm">
          {run.mappedRowCount.toLocaleString()} imported + {run.unmappedRowCount.toLocaleString()} reported
          below = {run.sourceRowCount.toLocaleString()} rows in the file
        </p>
        <p className="mt-2 text-sm">
          Every row either became a comment or is listed on this page. Checksum{' '}
          <span className="font-mono text-xs">{run.fileSha256.slice(0, 16)}…</span>
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sections" value={run.sectionCount.toLocaleString()} />
        <Stat label="Items" value={run.itemCount.toLocaleString()} />
        <Stat label="Comments" value={run.commentCount.toLocaleString()} hint="one per row of the export" />
        <Stat
          label="Columns modelled"
          value={`${run.mappedColumnCount} of ${run.sourceColumnCount}`}
          hint="the rest are stored with each comment"
        />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">What happened to your file</h2>
        {grouped.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            Nothing to report: every column was imported as it was.
          </p>
        ) : (
          grouped.map((group) => <IssueGroup key={group.kind} kind={group.kind} issues={group.issues} />)
        )}
      </div>

      <div>
        <Link
          href={`/templates/${run.templateId}`}
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Open the template
        </Link>
      </div>
    </div>
  )
}
