'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { saveImport } from '@/lib/db/import'
import {
  copyTemplate,
  deleteTemplate,
  renameItem,
  renameSection,
  renameTemplate,
  updateComment,
} from '@/lib/db/templates'
import { NotASpectoraExportError, parseSpectoraExport, UnreadableFileError } from '@/lib/spectora/parse'

/** Comfortably above the largest export seen (105 KB) without accepting anything. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export type ImportState = { error: string | null }

/**
 * Parses an upload and stores it, or returns a message explaining why not.
 *
 * Failures a user can act on come back as text on the form. Anything else is
 * rethrown: a database being down is not something to summarise as "could not
 * import" on the upload screen.
 */
export async function importTemplateAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a Spectora export to import.' }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.` }
  }

  const contents = new Uint8Array(await file.arrayBuffer())

  let templateId: string
  try {
    const parsed = parseSpectoraExport(contents, file.name)
    const saved = await saveImport(parsed, {
      name: file.name,
      bytes: contents.byteLength,
      contents,
    })
    templateId = saved.templateId
  } catch (error) {
    if (error instanceof UnreadableFileError || error instanceof NotASpectoraExportError) {
      return { error: error.message }
    }
    throw error
  }

  revalidatePath('/')
  // Straight to the import summary rather than the template: the first thing
  // worth seeing is what happened to the file, not the tree.
  redirect(`/templates/${templateId}/import`)
}

export async function copyTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!id) return

  const copyId = await copyTemplate(id, name || 'Untitled copy')
  if (!copyId) return

  revalidatePath('/')
  redirect(`/templates/${copyId}`)
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return

  await deleteTemplate(id)
  revalidatePath('/')
  redirect('/')
}

export async function renameTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '')
  if (!id || name.trim() === '') return

  await renameTemplate(id, name)
  revalidatePath(`/templates/${id}`)
}

export async function renameSectionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const templateId = String(formData.get('templateId') ?? '')
  const name = String(formData.get('name') ?? '')
  if (!id || name.trim() === '') return

  await renameSection(id, name)
  revalidatePath(`/templates/${templateId}`)
}

export async function renameItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const templateId = String(formData.get('templateId') ?? '')
  const name = String(formData.get('name') ?? '')
  if (!id || name.trim() === '') return

  await renameItem(id, name)
  revalidatePath(`/templates/${templateId}`)
}

export async function updateCommentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const templateId = String(formData.get('templateId') ?? '')
  const name = String(formData.get('name') ?? '')
  // Not trimmed or reformatted. The body is stored as the inspector left it,
  // the same way it was stored as the export left it.
  const bodyHtml = String(formData.get('bodyHtml') ?? '')
  if (!id) return

  await updateComment(id, { name, bodyHtml })
  revalidatePath(`/templates/${templateId}`)
}
