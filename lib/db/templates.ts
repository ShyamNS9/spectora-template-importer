import { db } from './client'

export type CommentRow = {
  id: string
  name: string
  bodyHtml: string
  commentType: string | null
  answerType: string | null
  recommendation: string | null
  severity: number | null
  defaultValue: string | null
  choiceOptions: string[]
  unitOptions: string[]
  position: number
  sourceRow: number | null
  rawExtras: Record<string, string>
}

export type ItemRow = { id: string; name: string; position: number; comments: CommentRow[] }
export type SectionRow = { id: string; name: string; position: number; items: ItemRow[] }

export type TemplateRow = {
  id: string
  name: string
  sourceFileName: string | null
  copiedFromId: string | null
  copiedFromName: string | null
  createdAt: Date
  updatedAt: Date
}

export type TemplateTree = TemplateRow & { sections: SectionRow[] }

export type TemplateSummary = TemplateRow & {
  sectionCount: number
  itemCount: number
  commentCount: number
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  return db()<TemplateSummary[]>`
    select
      t.id,
      t.name,
      t.source_file_name                     as "sourceFileName",
      t.copied_from_id                       as "copiedFromId",
      original.name                          as "copiedFromName",
      t.created_at                           as "createdAt",
      t.updated_at                           as "updatedAt",
      count(distinct s.id)::int              as "sectionCount",
      count(distinct i.id)::int              as "itemCount",
      count(c.id)::int                       as "commentCount"
    from templates t
    left join templates original on original.id = t.copied_from_id
    left join sections s on s.template_id = t.id
    left join items    i on i.section_id = s.id
    left join comments c on c.item_id = i.id
    group by t.id, original.name
    order by t.created_at desc
  `
}

/**
 * Loads a whole template in three queries rather than one per section and
 * item, then assembles the tree in memory. A template of a few hundred
 * comments is small; the query count is what would hurt.
 */
export async function loadTemplate(id: string): Promise<TemplateTree | null> {
  const sql = db()

  const [template] = await sql<TemplateRow[]>`
    select
      t.id,
      t.name,
      t.source_file_name as "sourceFileName",
      t.copied_from_id   as "copiedFromId",
      original.name      as "copiedFromName",
      t.created_at       as "createdAt",
      t.updated_at       as "updatedAt"
    from templates t
    left join templates original on original.id = t.copied_from_id
    where t.id = ${id}
  `
  if (!template) return null

  const sections = await sql<{ id: string; name: string; position: number }[]>`
    select id, name, position from sections
    where template_id = ${id}
    order by position, id
  `

  const items = await sql<{ id: string; section_id: string; name: string; position: number }[]>`
    select i.id, i.section_id, i.name, i.position
    from items i
    join sections s on s.id = i.section_id
    where s.template_id = ${id}
    order by i.position, i.id
  `

  const comments = await sql<(CommentRow & { itemId: string })[]>`
    select
      c.id,
      c.item_id        as "itemId",
      c.name,
      c.body_html      as "bodyHtml",
      c.comment_type   as "commentType",
      c.answer_type    as "answerType",
      c.recommendation,
      c.severity,
      c.default_value  as "defaultValue",
      c.choice_options as "choiceOptions",
      c.unit_options   as "unitOptions",
      c.position,
      c.source_row     as "sourceRow",
      c.raw_extras     as "rawExtras"
    from comments c
    join items i    on i.id = c.item_id
    join sections s on s.id = i.section_id
    where s.template_id = ${id}
    order by c.position, c.id
  `

  const commentsByItem = new Map<string, CommentRow[]>()
  for (const { itemId, ...comment } of comments) {
    const list = commentsByItem.get(itemId) ?? []
    list.push(comment)
    commentsByItem.set(itemId, list)
  }

  const itemsBySection = new Map<string, ItemRow[]>()
  for (const item of items) {
    const list = itemsBySection.get(item.section_id) ?? []
    list.push({
      id: item.id,
      name: item.name,
      position: item.position,
      comments: commentsByItem.get(item.id) ?? [],
    })
    itemsBySection.set(item.section_id, list)
  }

  return {
    ...template,
    sections: sections.map((section) => ({
      ...section,
      items: itemsBySection.get(section.id) ?? [],
    })),
  }
}

/**
 * Duplicates a template so the copy can be edited without touching the
 * original.
 *
 * Every row is inserted fresh with a new id: the copy shares no section, item
 * or comment with the template it came from, so an edit to one cannot reach
 * the other. Only copied_from_id records where it came from, and that is set
 * null rather than cascaded if the original is ever deleted.
 *
 * Each level's new ids are generated in a CTE before anything is inserted, so
 * old and new rows can be paired without relying on insertion order or on
 * position being unique, neither of which the schema guarantees. That also
 * lets the whole tree be copied in one statement.
 */
export async function copyTemplate(id: string, newName: string): Promise<string | null> {
  return db().begin(async (tx) => {
    const [copy] = await tx<{ id: string }[]>`
      insert into templates (name, source, source_file_name, copied_from_id)
      select ${newName}, source, source_file_name, id
      from templates where id = ${id}
      returning id
    `
    if (!copy) return null

    await tx`
      with new_sections as (
        select id as old_id, gen_random_uuid() as new_id, name, position
        from sections
        where template_id = ${id}
      ),
      inserted_sections as (
        insert into sections (id, template_id, name, position)
        select new_id, ${copy.id}, name, position from new_sections
      ),
      new_items as (
        select i.id as old_id, gen_random_uuid() as new_id, s.new_id as section_id, i.name, i.position
        from items i
        join new_sections s on s.old_id = i.section_id
      ),
      inserted_items as (
        insert into items (id, section_id, name, position)
        select new_id, section_id, name, position from new_items
      )
      insert into comments (
        item_id, name, body_html, comment_type, answer_type, recommendation,
        severity, default_value, choice_options, unit_options, position,
        source_row, raw_extras
      )
      select
        i.new_id, c.name, c.body_html, c.comment_type, c.answer_type, c.recommendation,
        c.severity, c.default_value, c.choice_options, c.unit_options, c.position,
        c.source_row, c.raw_extras
      from comments c
      join new_items i on i.old_id = c.item_id
    `

    return copy.id
  })
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  await db()`update templates set name = ${name} where id = ${id}`
}

export async function renameSection(id: string, name: string): Promise<void> {
  await db()`update sections set name = ${name} where id = ${id}`
}

export async function renameItem(id: string, name: string): Promise<void> {
  await db()`update items set name = ${name} where id = ${id}`
}

export async function updateComment(
  id: string,
  fields: { name: string; bodyHtml: string },
): Promise<void> {
  await db()`
    update comments
    set name = ${fields.name}, body_html = ${fields.bodyHtml}
    where id = ${id}
  `
}

export async function deleteTemplate(id: string): Promise<void> {
  await db()`delete from templates where id = ${id}`
}
