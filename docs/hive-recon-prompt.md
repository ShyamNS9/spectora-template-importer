# Recon prompt: Hive's own Spectora importer

The prompt below was given to a browser agent (Claude in Chrome) driving a
signed-in Hive Inspect account. Its output is
[hive-import-recon.md](hive-import-recon.md).

The point of writing it this way rather than clicking through by hand: the
expected numbers were already known from parsing the file locally, so the
agent could be asked to **verify specific claims** instead of describing what
it saw. Every check below has an expected answer, which is what makes the
report worth anything.

Reusable for any competitor import: replace the ground-truth block with the
output of `npm run inspect-export <file>` and the named spot-checks with
whatever your file actually contains.

---

```markdown
# Task: Recon Hive Inspect's Spectora template importer

You are helping with a take-home assignment for a Forward Deployed Engineer
role at Hive Inspect. The assignment is to BUILD a Spectora template importer.
Before building, I need to understand how Hive's own importer behaves — what it
preserves, what it drops, and what it tells the user.

You are operating in my own authenticated Hive Inspect account. Only import and
observe. Do not delete templates, change org settings, or message Hive support.
I have 5 report credits — do not spend more than one.

## Current state

At dashboard.hiveinspect.com/dashboard/templates with the "Import Template"
dialog open: source Spectora, file `InterNACHI Residential -2026-09-20.xls`
(54.14 KB) uploaded, "Import cost estimates" deliberately UNCHECKED.

## GROUND TRUTH — I already parsed this exact file

The file is XLSX despite the .xls extension. 392 data rows, 42 columns.
Verify Hive's import against these numbers:

| Metric | Expected |
|---|---|
| Sections | 13 |
| Items | 69 |
| Comments | 392 |

Section order: Inspection Details, Exterior, Roof, Basement/Foundation/
Crawlspace & Structure, Heating, Cooling, Plumbing, Electrical, Fireplace,
Attic/Insulation & Ventilation, Doors/Windows & Interior, Built-in Appliances,
Garage.

Comment types: defect 302, info 78, limit 12.
Severity: `0` x281, `1` x21, blank x90.
Answer types: boolean 315, checkbox 72, number 4, text 1.
Recommendation column: 4 rows only — `pro` x3, `monitor` x1.
Markup: 244 `<p>`, 43 `<a>`, 1 `<strong>`, 1 `<div>`, across 198 comments.
Cost estimates: all 392 rows hold min=10 / max=1000, which is why that
checkbox is off.

## PRIORITY CHECK — the double-encoding trap

Section and item NAMES are double-encoded in the source: the cell literally
contains `&amp;` where an `&` should be. Comment text is encoded once and is
genuine HTML — a different rule for the same file.

Check these five names character by character and report EXACTLY what is
displayed, `&` or `&amp;`, with a screenshot of each:

- `Basement, Foundation, Crawlspace & Structure`
- `Attic, Insulation & Ventilation`
- `Doors, Windows & Interior`
- `Siding, Flashing & Trim` (item, under Exterior)
- `Branch Wiring Circuits, Breakers & Fuses` (item, under Electrical)

## Tasks

1. **Run the import.** Time it. Note any progress indicator, whether a summary,
   preview or count appears, and whether anything at all is reported about
   skipped or unsupported content.
2. **Verify structure** against the numbers above.
3. **Verify the five names above.**
4. **Verify rich content** on two specific comments:
   - Roof > Roof Drainage Systems > "Downspouts Drain Near House" — two `<p>`
     and a link to thisoldhouse.com with `target="_blank"`. Link intact? URL
     intact? Paragraphs kept?
   - Heating > General > "Homeowner's Responsibility" — contains
     `<strong>It's your job</strong>` in a 665-character body. Bold kept? Text
     complete?
5. **Verify metadata.** Comment types and severity preserved? "In Attendance"
   (options `Home Owner, Client, Client's Agent, Listing Agent`) — all four
   survive? "Temperature " — NOTE THE TRAILING SPACE — source has answer type
   `number`, units `Fahrenheit (F), Celsius (C)`, recommendation `pro`. What
   survived? Was the space trimmed? Confirm no cost estimates were imported.
6. **Assess the editor**, without destructive changes: renaming, reordering,
   duplicating a whole template, the text editor, any undo or import log.
7. Only if 1–6 are done: open the seeded demo inspection, fill a few fields and
   publish the report. Uses one credit.

## Output

A structured report with one section per task, plus:

- **What Hive does NOT tell the user** — anything silently dropped or changed
  with no notification. Be specific.
- **Friction log**, worst first.
- **Screenshots**, with what each one shows.

Be blunt and specific. Exact displayed strings and real numbers beat
impressions. If something cannot be verified in the UI, say so rather than
guessing.
```

---

## What it got wrong

Worth recording, because the failure mode is predictable: the agent reasoned
from Hive's UI without cross-referencing the source file, and was confidently
wrong twice.

- It reported that Hive had enabled "auto-select" on a comment by itself. Row
  126 of the source has `Default Value = true`; Hive imported it correctly.
- It reported that no source value reaches Hive's blue "maintenance" severity.
  True for this file, which contains no `-1` values, but not a defect in Hive.
- Its element counts (488 `<p>`, 86 `<a>`) double-counted closing tags.

Anything it claimed about Hive's *intent* needed checking against the file.
Anything it read directly out of Hive's API held up.
