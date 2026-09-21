import Link from 'next/link'
import { copyTemplateAction, deleteTemplateAction } from './actions'
import { ImportForm } from '@/components/import-form'
import { listTemplates } from '@/lib/db/templates'

export const dynamic = 'force-dynamic'

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

export default async function LibraryPage() {
  const templates = await listTemplates()

  return (
    <div className="flex flex-col gap-10">
      <section className="rounded-lg border border-border bg-surface p-5">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Import a template</h1>
        <p className="mb-4 text-sm text-muted">
          Upload an export and you will get a summary of exactly what came across before you open the template.
        </p>
        <ImportForm />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">
          Templates <span className="font-normal text-muted">({templates.length})</span>
        </h2>

        {templates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
            Nothing imported yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((template) => (
              <li key={template.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/templates/${template.id}`}
                      className="font-medium hover:text-accent hover:underline"
                    >
                      {template.name}
                    </Link>

                    <p className="mt-1 text-sm text-muted">
                      {template.sectionCount} sections · {template.itemCount} items ·{' '}
                      {template.commentCount} comments
                    </p>

                    <p className="mt-1 text-xs text-muted">
                      {template.copiedFromName ? (
                        <>Copied from {template.copiedFromName} · </>
                      ) : template.copiedFromId ? (
                        <>Copy of a template that has since been deleted · </>
                      ) : template.sourceFileName ? (
                        <>From {template.sourceFileName} · </>
                      ) : null}
                      updated {formatDate(template.updatedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {template.sourceFileName && !template.copiedFromId ? (
                      <Link
                        href={`/templates/${template.id}/import`}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft"
                      >
                        Import summary
                      </Link>
                    ) : null}

                    <form action={copyTemplateAction}>
                      <input type="hidden" name="id" value={template.id} />
                      <input type="hidden" name="name" value={`${template.name} (copy)`} />
                      <button
                        type="submit"
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft"
                      >
                        Duplicate
                      </button>
                    </form>

                    {/* Two steps rather than one, so a destructive action is
                        not a single stray click on a template of 392 comments. */}
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-accent-soft">
                        Delete
                      </summary>
                      <form
                        action={deleteTemplateAction}
                        className="absolute right-0 z-10 mt-2 w-60 rounded-md border border-border bg-surface p-3 shadow-lg"
                      >
                        <input type="hidden" name="id" value={template.id} />
                        <p className="mb-3 text-sm">
                          Delete {template.name} and its {template.commentCount} comments? Copies made
                          from it are not affected.
                        </p>
                        <button
                          type="submit"
                          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white"
                        >
                          Delete permanently
                        </button>
                      </form>
                    </details>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
