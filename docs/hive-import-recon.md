# Hive Inspect — Spectora Importer Recon

Test run on 21/09/2026 against Hive's built-in Spectora importer.
Source file: `InterNACHI Residential -2026-09-20.xls` (actually XLSX), 392 data rows, 42 columns.
Expected from our own parse: 13 sections, 69 items, 392 comments.

Everything below was either seen in the Hive UI or read back from the stored template JSON
(`GET https://inspection.hiveinspect.com/api/templates/{id}`, Bearer auth).

---

## TL;DR for building our importer

1. **Decode HTML entities in section/item names** (they are double-encoded in the source: literal `&amp;`). Hive does NOT — it stores `&amp;` and only hides it because its editor decodes on display. Comment text is single-encoded real HTML: keep as HTML.
2. **Map `pro` → "Qualified Professional"** service. Hive drops all 3 `pro` values (only `monitor` survives).
3. **Don't silently lose numeric/unit info.** Hive has no Number type; `number` answer types become plain Text and unit options (e.g. `Fahrenheit (F), Celsius (C)`) are dropped. At minimum warn; better, turn units into a Multiple Choice or put them in the description.
4. **Show an import summary**: counts per level + a list of everything dropped/changed. Hive shows only a 4-second toast.
5. **Keep the full severity range in mind**: Hive maps Spectora `0` → orange (`major_defect`), `1` → red (`material_defect`); nothing ever lands in the blue/maintenance category.
6. **Trim-or-not decisions should be explicit** (Hive silently trims `"Temperature "` → `"Temperature"`).
7. **Don't rewrite HTML tags unnecessarily** (Hive converts `<strong>` → `<b>`).
8. **Keep an import log** (Hive's import job record 404s within minutes).

---

## 1. Import execution
- Duration ~38.5 s. Async job: `POST /api/v1/templates/import`, then polls `GET /api/v1/templates/import/status/{jobId}` (3 polls).
- UI: full-dialog spinner "Processing Your Template", fixed status text "Downloading and uploading images to our secure cloud" (file has no images), "This may take up to 5 minutes". No step progress.
- Result: toast "Template Imported — Successfully imported template: InterNACHI Residential -2026-09-20" (~4 s). No summary, preview, counts, warnings, or skipped-content report.
- Template name = filename minus extension (date and stray " -" included). Description: "Template imported from Spectora", tag `spectora`.
- Status job endpoint returned 404 "Import job not found" a few minutes later.

## 2. Structural fidelity — PASS
- 13/13 sections, order exact. 69/69 subsections, correct parents. 392/392 fields.
- Types: Information 78, Limitations 12, Defects 302.
- Section/subsection descriptions empty.

## 3. Double-encoding (`&amp;`) — FAIL IN STORAGE, HIDDEN IN UI
| Name | Editor shows | Stored |
|---|---|---|
| Basement, Foundation, Crawlspace & Structure | `&` | `&amp;` |
| Attic, Insulation & Ventilation | `&` | `&amp;` |
| Doors, Windows & Interior | `&` | `&amp;` |
| Siding, Flashing & Trim | `&` | `&amp;` |
| Branch Wiring Circuits, Breakers & Fuses | `&` | `&amp;` |

- Stored: 3 section titles + 21 subsection titles contain `&amp;`. Comment labels clean.
- Opening the imported template immediately shows "You have unsaved changes" with zero edits (the demo template doesn't) — the editor normalises on load; storage is only fixed if the user happens to Save.
- Not verified: whether published reports render `&amp;` (the seeded inspection uses a different template).

## 4. Rich content — PASS (minor rewrite)
- Downspouts Drain Near House: 2 paragraphs kept; link kept, URL intact (80 chars), `target="_blank"` kept. Stored HTML matches source. Category `major_defect`, service `no_recommendation`.
- Homeowner's Responsibility: full text (655 chars stored vs 665 source — difference is exactly `<strong>`→`<b>`). Imported as Checkbox with auto-select ON (`defaultValue: true`).
- Markup: 198 comments with markup (matches). Element counts 244 p / 43 a / 1 b / 1 div (= half of our 488/86/2/2, i.e. our count included closing tags).

## 5. Metadata
- Comment types: correct.
- Severity: `0` → `major_defect` ×281, `1` → `material_defect` ×21. Blank ×90 = info/limitation (no category). UI labels flicker from "Maintenance / Major Defect / Material Defect" to org labels "Maintenance Items / Recommendations / Safety Concerns".
- Recommendation: `monitor` ×1 kept (Exterior > Vegetation… > Negative Grading). `pro` ×3 dropped, though "Qualified Professional" exists among 67 services.
- In Attendance: Multiple Choice, all 4 options kept, none default. Editor edits options as one comma-separated textarea (options containing commas would break).
- Temperature: became `text`; units dropped; `pro` dropped; trailing space trimmed. Other number/text fields also plain Text: AFUE Rating, SEER Rating, Capacity, R-value.
- Answer type mapping observed: boolean → checkbox/recommendation, checkbox → multipleChoices, number → text, text → text.
- Cost estimates (checkbox left off): none imported.

### Stored JSON shape (useful as target model)
```
content: {
  template_id, template_name,
  sections: [{ id, title, description,
    subsections: [{ id, title, description,
      components: [                      // always: Information, Limitations, Recommendations
        { id, title, fields: [
          { id, type: "single", label,
            component: {
              type: "multipleChoices" | "text" | "checkbox" | "recommendation",
              name, defaultText /* HTML */, defaultValue, options?,
              category?: "major_defect" | "material_defect" | (maintenance),
              service?: "no_recommendation" | "monitor" | ...,
              enabled?: false
            } } ] } ] }] }]
}
```
Hive comment types available in the editor: Checkbox Item, Multiple Choice, Text (no Number).

## 6. Editor capabilities
- Rename: section/subsection title field + Save Changes; comment via pencil → Edit Comment dialog.
- Reorder: section ⋮ Move Up/Down; comment up/down arrows (look like expand chevrons); drag handles.
- Duplicate template: templates list ⋮ → Duplicate Template (2 clicks). Also Duplicate Section, Share with Friend.
- Rich text editor: B/I/U, lists, align, colour, link, raw HTML, image, video, table, AI "Generate description".
- No undo, version history, or import log. Only a Save/Discard prompt on leaving.

## 7. Silent changes (no user notification)
1. `&amp;` stored in 24 names; template shows "unsaved changes" on first open.
2. 3/4 recommendations (`pro`) dropped.
3. Number type + unit options dropped.
4. Trailing space trimmed.
5. `<strong>` → `<b>`.
6. Auto-select enabled on Homeowner's Responsibility.
7. Maintenance category never used.
8. Filename used as template name.
9. Import job record disappears within minutes.

## 8. Friction (worst first)
1. Imported template flagged "unsaved changes" on open; leaving forces Save/Discard.
2. Report editor "Publish" actually unpublished a draft (toggle-status endpoint); publish only worked from the report list.
3. Comment reorder arrows look like expand chevrons.
4. Page layout shifts cause mis-clicks.
5. Category labels change after the edit dialog opens.
6. Spinner says it's uploading images when there are none; "up to 5 minutes".
7. Only confirmation is a 4-second toast.
8. Template list takes 5–10 s to load.

## Report writing (task 7)
- Seeded inspection uses Demo Residential Template. Fields become rows: options are toggle chips with "+ Add"; Text fields prefilled from template default text. Save, then Publish (from report list) → "PDF generation started in the background". Credits banner still showed 5 remaining.
