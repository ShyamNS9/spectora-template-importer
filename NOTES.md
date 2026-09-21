# Notes

## The problem as I found it

An inspection company leaving Spectora arrives with a template they have spent
years tuning. The InterNACHI Residential export used here holds 392 written
comments: cause, consequence, remedy, threshold, in wording chosen to be
defensible if it is ever challenged. Nobody retypes that.

So the job is not "read a spreadsheet". It is to move that work across and be
able to tell the customer, honestly and specifically, what arrived and what
did not.

## Three things in the file that shaped everything else

### 1. Names are encoded twice, comment bodies once

A section named `Basement, Foundation, Crawlspace & Structure` is written into
the worksheet XML as `...Crawlspace &amp;amp; Structure`. The XML layer
resolves one level, leaving `&amp;` in the value. Comment bodies are encoded
only once and are already HTML by the time they arrive.

The same file therefore needs opposite treatment in two columns:

```
names   decode once   "Crawlspace &amp; Structure" -> "Crawlspace & Structure"
bodies  do not decode  decoding would turn "&amp;" inside markup into "&"
```

Getting this backwards in either direction corrupts the customer's content
silently. `lib/spectora/entities.ts` decodes exactly one level and never loops
until the string stops changing, because a name that genuinely contains the
text `&amp;` would otherwise be rewritten. Hive's importer does not decode at
all: it stores `&amp;` in 24 section and item names and hides it by decoding
on display.

### 2. Comment order is not row order

The export has a column headed `Order (w/i item)`. It is actually scoped to
the comment type as well as the item, and restarts at zero for each:

```
row 60   order=0   defect   Damaged (General)
row 61   order=0   info     Material            <- restarts
row 62   order=1   defect   Delamination
```

Importing in row order puts `Damaged (General)` first. Spectora shows
`Material` first, because it groups comments into Informational, Limitations
and Deficiencies. 110 of 115 type groups are cleanly sequential; only 27 of 69
item groups are.

Comments are stored by type group and then by Spectora's order within the
group. 27 items in the InterNACHI export and 36 in the Room-by-Room one were
affected. I found this only because the first version reported 257
disagreements between the order column and row order, and that number was too
large to dismiss.

### 3. Some columns hold data that means nothing

`Default Estimate Min` and `Default Estimate Max` are populated in all 392
rows. They hold `10` and `1000` in every single one, including the 78
informational and 12 limitation comments, where a repair cost is meaningless.

That is a Spectora default, not anything the inspector chose. Importing it
would put a `$10–$1,000` estimate on "Weather Conditions" in a report a
homeowner reads.

The importer does not special-case these columns. It measures every unmapped
column and classifies it:

```
empty in every row              -> missing_from_export
one identical value everywhere  -> degenerate_default
varied data, not modelled       -> unsupported_by_importer
```

Run against the file, that rule finds `Default Estimate Min`,
`Default Estimate Max` and `Uses` on its own, and will behave sensibly on a
file nobody has seen.

## Supported input

Spectora's **Export to spreadsheet → Export HTML Text**, saved as `.xls` but
actually an XLSX archive. The plain-text export is not supported: it has
already thrown away the links and formatting that make the import worth doing.

Tolerated within that format:

- columns in any order, and additional columns that did not exist before
- reworded parenthetical hints in headers, e.g. `Category (-1: Low, 0: Med, 1: High)`
- `comment_type` and `answer_type` values outside the documented sets, which
  are stored as text rather than as database enums precisely so that an
  unfamiliar value cannot abort a migration
- workbooks that use a shared string table, which Spectora's own exports do not

Rejected with a specific message: a legacy OLE2 `.xls`, a non-spreadsheet, a
corrupt archive, and a spreadsheet missing the four columns that make it a
template export.

## What happens to all 42 columns

Twelve are modelled: section, item and comment names, comment text, type,
category, multiple-choice options, unit type options, recommendation, order,
answer type and default value.

The other thirty are **kept verbatim** on the comment they belong to, in
`comments.raw_extras`, and reported on the import summary. Unsupported never
means discarded. If the meaning of a column is worked out later, the data is
still there rather than having been dropped at import time.

## Known limitations

- **An option containing a comma cannot be recovered.** Multiple-choice and
  unit options are one comma-separated string in the export. Spectora's format
  cannot express `Smith, Jones & Co` as a single option and neither can
  anything reading it. Hive has the same problem and edits options in one
  comma-separated text box.
- **Section and item ordering is inferred**, because the export contains no
  column for it. First-appearance order is used, which is what the file shows.
- **Sections are identified by name.** A template with two sections of exactly
  the same name would merge them. Neither export does this, including the
  Room-by-Room one with `Bedroom 2` through `Bedroom 6`.
- **Only the first worksheet is read.** Every export seen has one.
- **The comment body is edited as HTML**, not through a formatting toolbar.
  This is deliberate; see below.
- **No reordering in the editor.** `position` is therefore not unique per
  parent, which would otherwise need deferred constraints for a feature that
  is not here.
- **Photo columns are untested against real data.** All twenty are empty in
  both exports, so they are reported as missing from the export. A file that
  populated them would report them as unsupported and keep the URLs, which is
  covered by a test but not by a real file.

## What I left out, and why

**A rich-text editor.** This is the one I would defend hardest. A formatting
toolbar normalises markup every time it saves. Hive's importer rewrites
`<strong>` to `<b>` on the way in, and that is exactly the class of silent
change this project exists to avoid. Adding a WYSIWYG editor would make our
own editor the thing that corrupts the template. Editing the HTML directly is
worse for a non-technical inspector and better for their content, and that
trade is worth stating rather than hiding.

**Authentication.** Nothing here is customer data, and adding login would have
cost time without changing what is being assessed. It does have one benefit:
with no user session, no browser ever holds a database credential, so every
query goes through the server. Row-level security is enabled with no policies
so that the project's REST API, which is also switched off, would expose
nothing even if it were turned on.

**Drag-and-drop reordering, template versioning, multi-user editing, an
undo history, and importers for HomeGauge, Home Inspector Pro and Horizon.**
Hive's import dialog offers all three other vendors, so a plugin architecture
was tempting. Without a single file from any of them it would have been one
real implementation and three guesses. The schema and the issue model are
vendor-neutral already; only the column map and about four lines of
Spectora-specific handling would need replacing. Saying where the seam is
seems more useful than building an abstraction around formats I have never
seen.

**An AI model anywhere in the import path.** Hive uses AI well for *writing*
comments. Moving comments that already exist is a fidelity problem, not a
generation problem: a model that paraphrases one comment in 392 has destroyed
the exact thing the customer refused to retype. The parser is deterministic.
AI tools built it; no AI runs inside it.

## How I checked the work

**`npm run verify` reads the database, not the importer.** It loads every
stored template back out, parses the source file again, and compares them
field by field: body HTML, comment type, severity, answer type, recommendation,
options, ordering, source row number and every preserved unmapped value.

```
InterNACHI Residential: 13 sections, 69 items, 392 comments verified
Room-by-Room Residential Template: 22 sections, 136 items, 798 comments verified
```

1,190 comments, no mismatches. The importer reporting that it succeeded is not
evidence; this is.

That script found a bug in itself first. `jsonb` does not preserve key order,
so comparing serialised objects produced 788 false mismatches. Keys are
canonicalised before comparing now. A version that simply did not check
`raw_extras` would have passed silently, which is the failure mode worth
watching for in a verification script.

**25 tests.** Both fixtures end to end, the entity edge cases, the ordering
invariants, column classification, and a workbook built in the test to use a
shared string table, because Spectora's exports never do and that code path
would otherwise ship unexercised. Four failure cases: a plain text file, a
legacy OLE2 workbook, a spreadsheet that is not a template export, and a row
with no section.

Three of them touch a real database: a copy shares no row ids with its
original, editing a copy leaves the original unchanged, and deleting the
original leaves the copy intact. They skip when `DATABASE_URL` is unset.

**Structural agreement with Hive.** Hive's own importer produced 13 sections,
69 items and 392 comments from the same file. So does this one. That is an
independent check that the file is being read correctly.

## Using Hive's importer

I ran the same file through Hive before building. Notes and screenshots are in
[docs/hive-import-recon.md](docs/hive-import-recon.md). Structurally Hive does
well: 13/13 sections in the right order, 69/69 items, 392/392 comments, links
and paragraphs intact.

What it does not do is tell you anything. The only confirmation is a toast
lasting about four seconds with no counts, and the import job record returns
404 within minutes, so there is no record to consult afterwards. Their
documentation tells customers to "keep the old account until every piece is
verified", which puts the verification burden on the person least able to do
it. Six changes are made silently, including storing `&amp;` in 24 names,
dropping three of four `pro` recommendations although a matching service
exists, dropping the `Fahrenheit (F), Celsius (C)` unit options, trimming the
trailing space in `"Temperature "`, and rewriting `<strong>` to `<b>`.

Two things I believed at first and checked before repeating:

- Hive appeared to enable "auto-select" on a comment by itself. It did not:
  row 126 of the source has `Default Value = true`. Hive imported it
  correctly, and this importer now models that column because of it.
- Hive appeared never to use its blue "maintenance" severity. That is an
  artifact of this file, which contains no `-1` values at all, not a defect in
  Hive.

Both are in the recon document as corrections rather than findings.

## AI use

Built with Claude (Claude Code), which the brief encourages. It wrote most of
the code under direction, and was most useful on the parts that needed many
small checks against real data rather than on the parts that needed judgement.
Every design decision here — the schema, the issue taxonomy, deciding that
`Order (w/i item)` was scoped to comment type, choosing not to put a model in
the import path — came out of looking at the file.

The agent prompt used to explore Hive's own importer is in
[docs/hive-recon-prompt.md](docs/hive-recon-prompt.md), and its output is the
recon document. That turned an hour of clicking and screenshotting into one
structured report, and it is the most reusable artifact from the two days.

It also got things wrong, which is the honest part: the two corrections above
came from it, and the `<p>` and `<a>` element counts in its report were
double-counted because they included closing tags. Both were caught by going
back to the file.

Commits have no AI co-author trailer. The disclosure is here instead, where it
can say something useful.

## Time spent

About one working day, roughly seven hours, rather than the two days
suggested. Split approximately: an hour on Spectora and Hive, an hour reading
the export before writing any parser, two and a half hours on the parser and
schema, an hour and a half on persistence and the UI, and an hour on
verification, deployment and these notes.

The hour spent reading the file before writing code was the one that paid off.
Both of the findings that shaped the design came from it, and neither would
have been visible from a passing glance at the spreadsheet.
