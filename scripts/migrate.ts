/**
 * Applies the SQL files in supabase/migrations in filename order, once each.
 *
 *   npm run migrate
 *
 * Each file runs inside a transaction together with the row recording it, so
 * a migration that fails part way leaves neither half-applied schema nor a
 * record claiming it succeeded.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../lib/db/client'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

async function main() {
  const sql = db()

  await sql`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )
  `

  const applied = new Set(
    (await sql<{ filename: string }[]>`select filename from schema_migrations`).map((row) => row.filename),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  const pending = files.filter((name) => !applied.has(name))
  if (pending.length === 0) {
    console.log(`up to date (${files.length} migration${files.length === 1 ? '' : 's'} applied)`)
    return
  }

  for (const filename of pending) {
    const statements = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
    process.stdout.write(`applying ${filename} ... `)

    await sql.begin(async (tx) => {
      await tx.unsafe(statements)
      await tx`insert into schema_migrations (filename) values (${filename})`
    })

    console.log('done')
  }
}

main()
  .catch((error) => {
    console.error('\nmigration failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db().end()
  })
