import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { db } from './client'
import { saveImport } from './import'
import {
  copyTemplate,
  deleteTemplate,
  loadTemplate,
  renameSection,
  updateComment,
} from './templates'
import type { ParseResult } from '../spectora/types'

// Touches a real database, so it is skipped when one is not configured and
// `npm test` still runs everywhere.
const skip = process.env.DATABASE_URL ? false : 'DATABASE_URL is not set'

function templateFixture(name: string): ParseResult {
  return {
    template: {
      name,
      sections: [
        {
          name: 'Roof',
          position: 0,
          items: [
            {
              name: 'Coverings',
              position: 0,
              comments: [
                {
                  name: 'Material',
                  bodyHtml: '<p>Asphalt shingle.</p>',
                  commentType: 'info',
                  answerType: 'text',
                  recommendation: null,
                  severity: null,
                  defaultValue: null,
                  choiceOptions: [],
                  unitOptions: [],
                  position: 0,
                  sourceRow: 2,
                  rawExtras: { 'Last Modified': '09/20/2026' },
                },
                {
                  name: 'Damaged',
                  bodyHtml: '<p>Damaged &amp; worn.</p>',
                  commentType: 'defect',
                  answerType: 'boolean',
                  recommendation: 'pro',
                  severity: 1,
                  defaultValue: null,
                  choiceOptions: [],
                  unitOptions: [],
                  position: 1,
                  sourceRow: 3,
                  rawExtras: {},
                },
              ],
            },
          ],
        },
      ],
    },
    issues: [],
    stats: {
      sourceRowCount: 2,
      mappedRowCount: 2,
      unmappedRowCount: 0,
      sourceColumnCount: 42,
      mappedColumnCount: 12,
      sectionCount: 1,
      itemCount: 1,
      commentCount: 2,
    },
  }
}

const created: string[] = []

async function seedTemplate(name: string): Promise<string> {
  const parsed = templateFixture(name)
  const { templateId } = await saveImport(parsed, {
    name: `${name}.xls`,
    bytes: 4,
    contents: new Uint8Array([1, 2, 3, 4]),
  })
  created.push(templateId)
  return templateId
}

after(async () => {
  if (skip) return
  for (const id of created) await deleteTemplate(id)
  await db().end()
})

test('a copy holds its own rows, not the original’s', { skip }, async () => {
  const originalId = await seedTemplate('Copy source')
  const copyId = await copyTemplate(originalId, 'Copy source (copy)')
  assert.ok(copyId)
  created.push(copyId)

  const original = await loadTemplate(originalId)
  const copy = await loadTemplate(copyId)
  assert.ok(original && copy)

  assert.equal(copy.copiedFromId, originalId)
  assert.notEqual(copy.sections[0].id, original.sections[0].id)
  assert.notEqual(copy.sections[0].items[0].id, original.sections[0].items[0].id)
  assert.notEqual(copy.sections[0].items[0].comments[0].id, original.sections[0].items[0].comments[0].id)

  // Content still matches, including the HTML entity inside a comment body,
  // which must survive a copy untouched.
  assert.equal(copy.sections[0].name, 'Roof')
  assert.equal(copy.sections[0].items[0].comments[1].bodyHtml, '<p>Damaged &amp; worn.</p>')
  assert.equal(copy.sections[0].items[0].comments[1].recommendation, 'pro')
  assert.deepEqual(
    copy.sections[0].items[0].comments[0].rawExtras,
    original.sections[0].items[0].comments[0].rawExtras,
  )
})

test('editing a copy leaves the original alone', { skip }, async () => {
  const originalId = await seedTemplate('Edit isolation')
  const copyId = await copyTemplate(originalId, 'Edit isolation (copy)')
  assert.ok(copyId)
  created.push(copyId)

  const copy = await loadTemplate(copyId)
  assert.ok(copy)

  await renameSection(copy.sections[0].id, 'Roof renamed on the copy')
  await updateComment(copy.sections[0].items[0].comments[0].id, {
    name: 'Material renamed',
    bodyHtml: '<p>Changed on the copy.</p>',
  })

  const original = await loadTemplate(originalId)
  assert.ok(original)
  assert.equal(original.sections[0].name, 'Roof')
  assert.equal(original.sections[0].items[0].comments[0].name, 'Material')
  assert.equal(original.sections[0].items[0].comments[0].bodyHtml, '<p>Asphalt shingle.</p>')

  const edited = await loadTemplate(copyId)
  assert.equal(edited?.sections[0].name, 'Roof renamed on the copy')
  assert.equal(edited?.sections[0].items[0].comments[0].bodyHtml, '<p>Changed on the copy.</p>')
})

test('deleting the original leaves the copy intact', { skip }, async () => {
  const originalId = await seedTemplate('Delete source')
  const copyId = await copyTemplate(originalId, 'Delete source (copy)')
  assert.ok(copyId)
  created.push(copyId)

  await deleteTemplate(originalId)

  const copy = await loadTemplate(copyId)
  assert.ok(copy, 'the copy should survive its original being deleted')
  assert.equal(copy.copiedFromId, null)
  assert.equal(copy.sections[0].items[0].comments.length, 2)
})
