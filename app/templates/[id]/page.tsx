import Link from 'next/link'
import { notFound } from 'next/navigation'
import { renameItemAction, renameSectionAction, renameTemplateAction } from '@/app/actions'
import { CommentCard } from '@/components/comment-card'
import { loadSection, loadTemplateOutline } from '@/lib/db/templates'

export const dynamic = 'force-dynamic'

export default async function TemplatePage({ params, searchParams }: PageProps<'/templates/[id]'>) {
  const { id } = await params
  const { section: sectionParam, edit } = await searchParams

  const selectedId = typeof sectionParam === 'string' ? sectionParam : undefined
  const editingId = typeof edit === 'string' ? edit : undefined

  // When the URL already names a section, its contents do not depend on the
  // outline, so both can be fetched at once instead of one after the other.
  const [template, preloaded] = await Promise.all([
    loadTemplateOutline(id),
    selectedId ? loadSection(selectedId) : null,
  ])
  if (!template) notFound()

  const section = template.sections.find((candidate) => candidate.id === selectedId) ?? template.sections[0]
  // The preloaded contents are only used once the section id is confirmed to
  // belong to this template.
  const items = !section
    ? []
    : section.id === selectedId && preloaded
      ? preloaded
      : await loadSection(section.id)

  const commentCount = template.commentCount

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-accent hover:underline">
          ← All templates
        </Link>

        <form action={renameTemplateAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={template.id} />
          <input
            name="name"
            defaultValue={template.name}
            aria-label="Template name"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight hover:border-border focus:border-border focus:bg-surface"
          />
          <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft">
            Rename
          </button>
        </form>

        <p className="mt-1 px-2 text-sm text-muted">
          {template.sections.length} sections · {commentCount} comments
          {template.copiedFromName ? <> · copied from {template.copiedFromName}</> : null}
          {template.sourceFileName && !template.copiedFromId ? (
            <>
              {' '}
              ·{' '}
              <Link href={`/templates/${template.id}/import`} className="text-accent hover:underline">
                import summary
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(200px,260px)_1fr]">
        <nav aria-label="Sections" className="md:sticky md:top-6 md:self-start">
          <ol className="flex flex-col gap-0.5">
            {template.sections.map((candidate) => {
              const active = candidate.id === section?.id
              return (
                <li key={candidate.id}>
                  <Link
                    href={`/templates/${template.id}?section=${candidate.id}`}
                    scroll={false}
                    className={`flex items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm ${
                      active ? 'bg-accent-soft font-medium text-accent' : 'hover:bg-accent-soft'
                    }`}
                  >
                    <span className="min-w-0">{candidate.name}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{candidate.commentCount}</span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </nav>

        {section ? (
          <div className="flex min-w-0 flex-col gap-5">
            <form action={renameSectionAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={section.id} />
              <input type="hidden" name="templateId" value={template.id} />
              <input
                name="name"
                defaultValue={section.name}
                aria-label="Section name"
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold tracking-tight hover:border-border focus:border-border focus:bg-surface"
              />
              <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft">
                Rename
              </button>
            </form>

            {items.map((item) => (
              <section key={item.id} className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border px-4 py-2.5">
                  <form action={renameItemAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="templateId" value={template.id} />
                    <input
                      name="name"
                      defaultValue={item.name}
                      aria-label="Item name"
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-medium hover:border-border focus:border-border focus:bg-background"
                    />
                    <span className="text-xs text-muted">
                      {item.comments.length} {item.comments.length === 1 ? 'comment' : 'comments'}
                    </span>
                    <button type="submit" className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent-soft">
                      Rename
                    </button>
                  </form>
                </div>

                <ul className="divide-y divide-border">
                  {item.comments.map((comment) => (
                    <CommentCard
                      key={comment.id}
                      comment={comment}
                      templateId={template.id}
                      sectionId={section.id}
                      editing={comment.id === editingId}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">This template has no sections.</p>
        )}
      </div>
    </div>
  )
}
