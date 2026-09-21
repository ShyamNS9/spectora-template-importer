# Spectora template importer

Imports a Spectora HTML-text template export into a structured, editable
template, and reports exactly what happened to the file on the way in.

Built for the Hive Inspect Forward Deployed Engineer take-home. See
[NOTES.md](NOTES.md) for the decisions, the limits, and what was left out.

## What it does

- **Import** a Spectora export and get a summary of what came across before
  seeing the template.
- **Edit** template, section, item and comment names, and comment text.
- **Duplicate** a template and edit the copy without touching the original.
- **Store** everything in Postgres as rows, not as a blob of HTML.

## The source file

Both committed exports came from a free Spectora trial:

| File | Template | Where it came from |
| --- | --- | --- |
| `fixtures/InterNACHI Residential -2026-09-20.xls` | InterNACHI Residential | Spectora Template Center, published by Spectora, "All Locations" |
| `fixtures/Room-by-Room Residential Template-2026-09-20.xls` | Room-by-Room Residential Template | Spectora stock template |

Exported on 20 September 2026 via **Templates → My Templates → ⋮ → Export to
spreadsheet → Export HTML Text**. Not the plain-text export, which strips
links and formatting.

The second file is not used by the app. It is committed because it is
structurally different (798 rows, 22 sections, repeated section names) and the
importer is tested against both.

Both files contain only Spectora's own stock content. No customer data.

## Running it

Requires Node 20.9 or newer.

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL
npm run migrate                # create the schema
npm run seed                   # import both committed exports
npm run dev
```

### DATABASE_URL

Any Postgres 14+ database works. With Supabase, take the connection string
from **Connect → Transaction pooler** (port 6543):

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Use the pooler rather than the direct connection. `db.<ref>.supabase.co`
resolves to IPv6 only, which Vercel cannot reach, and transaction mode pools
per transaction rather than per client, which is what serverless needs. The
client sets `prepare: false` because a pooled transaction may land on a
different backend than the one a statement was prepared on.

No credentials are committed. `.env*` is gitignored apart from
`.env.example`, and the app has no end-user login, so no database credential
ever reaches a browser.

## Commands

| Command | |
| --- | --- |
| `npm run dev` | development server |
| `npm run migrate` | apply `supabase/migrations/*.sql` in order, once each |
| `npm run seed` | import the committed exports; skips files already imported |
| `npm run verify` | read every stored template back and compare it against its source file |
| `npm run inspect-export <file>` | print a file's shape without importing it |
| `npm test` | 25 tests; the database ones skip when `DATABASE_URL` is unset |
| `npm run typecheck` | |
| `npm run lint` | |

`npm run verify` is the check behind the import summary's claim that nothing
was lost. It compares the database against the file, not the importer against
itself:

```
InterNACHI Residential: 13 sections, 69 items, 392 comments verified
Room-by-Room Residential Template: 22 sections, 136 items, 798 comments verified
```

## Layout

```
app/                      pages and server actions
  page.tsx                template library and upload
  templates/[id]/         the editor
  templates/[id]/import/  the import summary
components/
lib/spectora/             reading and parsing the export
  xlsx.ts                 worksheet reader
  entities.ts             HTML entity decoding
  columns.ts              which columns are mapped
  parse.ts                export to template tree, plus what changed
lib/db/                   queries, the import transaction, copying
supabase/migrations/      schema
scripts/                  migrate, seed, verify, inspect
fixtures/                 the committed Spectora exports
docs/                     notes from using Hive's own importer
```

## Deployment

Deployed on Vercel. `vercel.json` pins functions to `icn1` (Seoul) to match
the Supabase region; with the two apart, every query crosses an ocean.

Set `DATABASE_URL` in the Vercel project's environment variables, then run
`npm run migrate` and `npm run seed` against the same database from a machine
that can reach it.

## Built on

- [Next.js](https://nextjs.org) 16, React 19, Tailwind CSS 4
- [postgres.js](https://github.com/porsager/postgres) for database access
- [fflate](https://github.com/101arrowz/fflate) to read the XLSX archive
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) for worksheet XML
- [sanitize-html](https://github.com/apostrophecms/sanitize-html) to clean comment HTML when rendering

Everything under `lib/` is written for this project. The worksheet reader is
not a general-purpose spreadsheet library; see NOTES.md for why it is written
here rather than taken off the shelf.
