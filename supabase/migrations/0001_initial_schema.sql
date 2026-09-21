-- Core template structure, mirroring Spectora's own hierarchy:
--   template -> section -> item -> comment
--
-- Comment bodies hold HTML. Nothing above that level does: names are plain
-- text, and the tree itself is rows, not markup. Storing a template as a
-- single HTML blob would make it unusable for editing, which is the point of
-- importing it in the first place.

create extension if not exists pgcrypto;

create table templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  source           text not null default 'spectora_html_text',
  source_file_name text,
  -- Set when this template was produced by copying another. Kept as
  -- provenance only: a copy shares no rows with its original, so deleting
  -- the original must not touch the copy.
  copied_from_id   uuid references templates(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table sections (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  name        text not null,
  -- Spectora's export carries no section ordering column; order is implied
  -- purely by row order in the spreadsheet. We capture first-appearance
  -- order here so it survives independently of how rows are later queried.
  position    integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table items (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  name       text not null,
  position   integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table comments (
  id        uuid primary key default gen_random_uuid(),
  item_id   uuid not null references items(id) on delete cascade,
  name      text not null,
  body_html text not null default '',

  -- Vendor-controlled vocabularies, deliberately stored as free text rather
  -- than enums. Observed values are info/limit/defect and
  -- boolean/checkbox/date/number/range/text, but a different Spectora export
  -- may carry values we have not seen, and an unrecognised value must land in
  -- the database as an import note rather than abort the whole import.
  comment_type   text,
  answer_type    text,
  recommendation text,
  -- Spectora documents this as -1 low / 0 medium / 1 high.
  severity       smallint,
  -- Pre-selects the comment when a report is started. Rare in stock templates
  -- but it is a deliberate choice by whoever tuned the template, so it is
  -- modelled rather than treated as vendor metadata.
  default_value  text,

  choice_options text[] not null default '{}',
  unit_options   text[] not null default '{}',

  position   integer not null,
  -- 1-based spreadsheet row this comment came from, so every stored comment
  -- can be traced back to the exact line of the customer's export.
  source_row integer,
  -- Every source column we did not map, kept verbatim. Unsupported must not
  -- mean discarded: if we later learn what a column means, the data is still
  -- here rather than lost at import time.
  raw_extras jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ordering lookups. Intentionally not unique on (parent, position):
-- reordering siblings would then require deferred constraints or shuffling
-- through temporary values, and reordering is out of scope for this build.
create index sections_template_position_idx on sections (template_id, position);
create index items_section_position_idx     on items (section_id, position);
create index comments_item_position_idx     on comments (item_id, position);
create index templates_copied_from_idx      on templates (copied_from_id);


-- One row per attempt to import a file. Records what the file contained and
-- what we made of it, so the result of an import stays inspectable after the
-- upload screen is gone.
create table import_runs (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid references templates(id) on delete cascade,

  file_name   text not null,
  file_sha256 text not null,
  file_bytes  integer not null,

  -- Row accounting. source_row_count excludes the header; the import is only
  -- considered faithful when mapped + unmapped equals it exactly.
  source_row_count   integer not null default 0,
  mapped_row_count   integer not null default 0,
  unmapped_row_count integer not null default 0,

  -- Column accounting, tracked separately: columns and rows are different
  -- axes, and conflating them hides which of the two actually lost data.
  source_column_count integer not null default 0,
  mapped_column_count integer not null default 0,

  section_count integer not null default 0,
  item_count    integer not null default 0,
  comment_count integer not null default 0,

  status        text not null default 'succeeded',
  error_message text,

  created_at timestamptz not null default now()
);

-- Our own closed vocabulary for what happened during an import, so it is an
-- enum: unlike Spectora's values, we control every member.
--
-- The first two are the distinction that matters most when telling a customer
-- what survived a migration, and they are genuinely different things:
--   missing_from_export     - the column exists but this file has no data in it.
--                             Nothing was lost by us; the export never had it.
--   unsupported_by_importer - the file has data and we chose not to model it.
--                             Our limitation, and the raw value is retained in
--                             comments.raw_extras.
create type import_issue_kind as enum (
  'missing_from_export',
  'unsupported_by_importer',
  -- Present in every row with an identical value, i.e. a vendor default rather
  -- than anything the inspector tuned. Reported instead of silently imported.
  'degenerate_default',
  -- We changed a value to store it correctly, e.g. decoding an HTML entity in
  -- a section name. Recorded because a silent correction is still a rewrite.
  'normalised',
  -- A row we could not turn into a comment.
  'malformed_row',
  -- A row whose place in the hierarchy could not be determined.
  'ambiguous'
);

create table import_issues (
  id            uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references import_runs(id) on delete cascade,

  kind     import_issue_kind not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),

  source_column text,
  source_row    integer,
  -- Column-level issues describe many rows at once; carrying the count here
  -- keeps the report readable instead of emitting one row per occurrence.
  affected_count integer not null default 1,

  message text not null,
  sample  jsonb,

  created_at timestamptz not null default now()
);

create index import_runs_template_idx  on import_runs (template_id, created_at desc);
create index import_issues_run_idx     on import_issues (import_run_id, kind);


create or replace function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger templates_set_updated_at before update on templates
  for each row execute function set_updated_at();
create trigger sections_set_updated_at before update on sections
  for each row execute function set_updated_at();
create trigger items_set_updated_at before update on items
  for each row execute function set_updated_at();
create trigger comments_set_updated_at before update on comments
  for each row execute function set_updated_at();


-- The app has no end-user login, so no browser ever holds a database
-- credential: every read and write goes through the Next.js server using the
-- service role key. RLS is enabled with no policies so that the anon key,
-- if it ever leaked, grants nothing. The service role bypasses RLS by design.
alter table templates     enable row level security;
alter table sections      enable row level security;
alter table items         enable row level security;
alter table comments      enable row level security;
alter table import_runs   enable row level security;
alter table import_issues enable row level security;
