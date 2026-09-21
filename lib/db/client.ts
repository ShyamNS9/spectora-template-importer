import postgres, { type Sql } from 'postgres'

/**
 * Next.js reloads modules on every edit in development, which would otherwise
 * open a new pool on each change until the database refuses connections.
 */
declare global {
  var spectoraDb: Sql | undefined
}

function connect(): Sql {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.')
  }

  return postgres(url, {
    // Supabase's transaction pooler assigns a different backend per
    // transaction, so a prepared statement created on one is not there for
    // the next. postgres.js prepares by default; this turns that off.
    prepare: false,
    // Each serverless instance keeps its own pool, so a small ceiling per
    // instance keeps the total within the pooler's limit under load.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // Postgres notices are informational only ("extension already exists" and
    // similar). Errors still throw.
    onnotice: () => {},
  })
}

/**
 * Opened on first use rather than at import, so that building the app or
 * running a script that never touches the database does not require
 * DATABASE_URL to be present.
 */
export function db(): Sql {
  globalThis.spectoraDb ??= connect()
  return globalThis.spectoraDb
}
