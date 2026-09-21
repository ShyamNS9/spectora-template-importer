'use client'

import { useActionState } from 'react'
import { importTemplateAction, type ImportState } from '@/app/actions'

const INITIAL: ImportState = { error: null }

export function ImportForm() {
  const [state, action, pending] = useActionState(importTemplateAction, INITIAL)

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="file" className="text-sm font-medium">
        Spectora export
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <input
          id="file"
          type="file"
          name="file"
          accept=".xls,.xlsx"
          required
          disabled={pending}
          className="max-w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent-soft"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Importing…' : 'Import'}
        </button>
      </div>

      <p className="text-sm text-muted">
        In Spectora: Templates → My Templates → ⋮ → Export to spreadsheet → <strong>Export HTML Text</strong>.
        The plain-text export drops links and formatting.
      </p>

      {state.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
