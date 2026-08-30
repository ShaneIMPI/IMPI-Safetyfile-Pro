# Decisions & open items — IMPI SafetyFile Pro (Phase 1)

Choices made during the build where the brief left room, plus things that need
Shane's input or a credential before the app is fully live. Numbered so other
files can reference them (`see DECISIONS.md item N`).

---

## Addendum (2026-08-30) — multi-file / multi-instance evidence

- New migration **`0005_evidence_files.sql`** (Shane runs it in the Supabase SQL
  editor like the others). It adds `evidence_document_files` (one-to-many),
  copies any existing `evidence_documents.file_url` into it, and **drops that
  column**. Safe to run once; the data-copy step is idempotent.
- One `evidence_documents` row is still one certificate / instance (one issuing
  body, one number, one expiry) with its own `IMPI-EVD-…` ref — numbering
  untouched. Multiple files per row = front/back or multi-page scan of the *same*
  certificate.
- Naturally-plural checklist items (crew tickets, per-machine certs): the evidence
  modal has **+ Add another certificate**, creating separate `evidence_documents`
  rows against the same `checklist_item_id`, each with its own metadata + files.
- Every evidence display now renders a **list** of entries/files, not one:
  audit workspace (under each evidence item), client page evidence table, final
  assembly (one includable line per file). Document Control Register already had
  one line per `evidence_documents` row — unchanged.
- Out of addendum scope, unchanged: `audits.uploaded_file_url` (audit source
  file), numbering, no OCR / expiry automation. Non-PDF evidence files still
  can't be merged into the assembled PDF (pre-existing pdf-lib limitation).

---

## Blockers — need Shane / IMPI to proceed

- **B1. Supabase project.** I can't create the Supabase project or its keys.
  Someone at IMPI needs to: create a project, run the four migrations in
  `supabase/migrations/`, and put `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
  into GitHub Actions secrets (and a local `.env.local` for dev). Steps in README.
- **B2. First staff user.** After the migrations, create a user in Supabase Auth
  (Authentication → Users → Add user). The `handle_new_user` trigger makes them
  `staff` automatically. That's the login for the deployed app.
- **B3. Anthropic API key for AI-assisted audit.** Optional but recommended.
  Set as a Supabase **Edge Function secret**, never a browser var:
  `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` then
  `supabase functions deploy audit-suggest`. Without it the audit screen still
  works — every item is reviewed manually (see item 2).
- **B4. The four approved reference documents.** ✅ RESOLVED (2026-08-30). Shane
  supplied all four (`/reference-docs/`). `src/theme/tokens.js` + `src/docgen/*`
  are now matched to them: gold strap `SAFETY FILE DOCUMENT` / `AUDIT REPORT` /
  `COMPILED SAFETY FILE` at 10pt +20 tracking; 22pt navy titles; 10pt body;
  section headings 13pt navy with a navy bottom-rule; doc-control table 3000/6000
  twips with `F4F5F7` label cells and colon-suffixed labels; RA register is the
  14-column `No. | Activity | Hazard | Who/What May Be Harmed | Existing Controls
  | A | B | C | D | R | Risk Rating | Additional Controls | Res. R | ALARP` layout
  on a landscape section (cover stays portrait); footer is one line —
  credit left, `Page X of Y` right, grey rule above — on every page including the
  cover.
- **B5. IMPI + client logos.** The footer credit line is text (done). Client
  logos are uploaded per-client in the app. No IMPI logo asset is needed given
  the "small footer credit only" rule.
- **B6. GitHub repo + Pages.** Repo isn't created yet (the working dir isn't a
  git repo). README has the exact click-path; Pages source must be
  **"GitHub Actions"**.

---

## Decisions made

### 1. Document numbering
- Sequence numbers are **zero-padded to 3 digits** (`...-2026-007`). Brief didn't
  specify width.
- `client_code` auto-generates as the **compacted uppercase alphanumerics of the
  company name, first 6 chars** (`"ABC Rigging" → "ABCRIG"`), de-duplicated with a
  numeric suffix. It's an **editable field** on the client — override it if the
  mnemonic is poor.
- A **revision is a new `generated_documents` row** with `parent_document_id` set;
  the trigger reuses the parent's `seq` and bumps `Rev`. This keeps full history
  and immutable file URLs. `IMPI-RA-ABCRIG-2026-007-Rev2`.
- Evidence renewals get a **fresh EVD sequence number**, never a revision (per brief).
- Numbering is a **Postgres trigger + counter table** (`document_counters`), so it
  is collision-free even with concurrent inserts. Nothing is numbered client-side.

### 2. AI-assisted audit — architecture
- The brief says "no separate backend server". A **Supabase Edge Function**
  (`audit-suggest`) is used because it's part of Supabase, not a separate server,
  and it's the only safe way to call Anthropic without exposing the API key in the
  browser.
- PDF **text extraction is client-side** (`pdfjs-dist`). Only the extracted text +
  the checklist go to the function.
- The function returns a **suggested** status + rationale per item. It is written
  to `audit_results.ai_suggested_status` / `ai_rationale`. **It never sets
  `status` and never counts toward the score.** A staff member must pick a status
  and press **Confirm** (which stamps `reviewed_by` / `reviewed_at`); only then
  does `recompute_audit_score` include it. This enforces brief §7.
- If the key is absent the function returns `{ disabled: true }` and the UI tells
  the auditor to work manually. No degradation of correctness, just no hints.

### 3. Compliance score formula
Weighted by `checklist_items.severity_weight` (1–5). `compliant` = full weight,
`partial` = half, `non_compliant` = 0, `not_applicable` = excluded from the
denominator, **unreviewed = excluded from the denominator**. So the score always
reflects only what a human has signed off. Change the weights in
`0002_functions.sql` → `recompute_audit_score` if IMPI wants a different rule.

### 4. `.docx` generation vs. PDF assembly — the real gap
- Generated documents are produced as **`.docx`** (per brief, using the `docx`
  library and the shared toolkit) so staff can review/edit in Word.
- Final assembly needs **PDFs** to merge. There is no reliable pure-browser
  `.docx → .pdf` converter. So:
  - `generated_documents` has both `file_url` (.docx) and `pdf_url`.
  - In **Final Assembly**, each finalized generated document shows an
    **"Upload PDF"** action. The staff workflow is: generate .docx → review/edit
    in Word → "Save as PDF" → upload the PDF back. Assembly then merges the PDFs.
  - The master **cover + Table of Contents front matter is rendered directly as a
    PDF** (`src/lib/pdf.js` → `buildFrontMatterPdf`) so it always merges cleanly.
    `src/docgen/safetyFileCover.js` (the .docx version) is kept for standalone use.
  - Merge + running page numbers use **`pdf-lib`** (`mergePdfs`).
- **Decision — CONFIRMED by Shane 2026-08-30:** "generate .docx → tidy in Word →
  Save As PDF → re-upload" is the Phase-1 workflow. No conversion service.

### 5. Auth & roles
- Supabase Auth. `profiles.role` is `staff | client`. **Only `staff` UI exists.**
- All new auth users become `staff` (Phase-1 is invite-only). The `client` role,
  `profiles.client_id`, and dormant client-scoped RLS policies + storage policies
  are all in place so Phase 2 needs **no schema rebuild** (brief §4, §8).
- Login supports **password or magic link**. No self-service sign-up screen.

### 6. `questionnaire_schema` shape
Stored as a JSONB **array of field definitions**. Supported `type`s:
`text, textarea, date, number, select, multiselect, repeater,
select_dynamic, multiselect_dynamic`. `*_dynamic` fields pull their options from
the hazard/method library filtered by the client's sectors (`source` =
`hazard_library.activity` or `method_step_library.activity_type`). `repeater`
fields carry a `fields: [...]` sub-schema. Renderer: `QuestionnaireForm.jsx`.
Seed templates in `0004_seed.sql` use this shape — adjust freely in the DB.

### 7. Hazard / method library — scaling loop
- RA/MS generation pulls library rows by sector + questionnaire answers, into an
  **editable table** in the Document Builder. Staff edit before generating.
- If the library doesn't fit, **"Library doesn't fit — flag gap"** writes a
  `library_gap_flags` row. In *Hazard / Method Library → Gap flags*, staff draft a
  proper entry and **approve** it — which creates the permanent, sector-tagged
  library row. This is treated as the core mechanism, not an edge case (brief §7).

### 8. Risk residual score
The RA register shows an **indicative** Residual R = one band lower than R (min 1).
It's clearly labelled as indicative in the generated document. Staff can overwrite
per line before generating. No separate residual A/B/C/D captured in Phase 1 —
add columns to `hazard_library` + the editor later if IMPI wants full residual
scoring.

### 9. Storage buckets
`logos` (public), `uploads` (client safety files under audit), `evidence`,
`generated`, `safety-files` — all private except `logos`, all staff-only in RLS.
Private-bucket URLs in the app are **7-day signed URLs**. If a link 404s later,
re-open the record to refresh it. (Phase 2: swap to a download proxy.)

### 10. Tech specifics
- **HashRouter**, not BrowserRouter — GitHub Pages has no rewrite rules, so this
  avoids 404s on refresh/deep-link with no `404.html` hack.
- Vite `base` = `/impi-safetyfile-pro/`. Override with `VITE_BASE=/` for a custom
  domain.
- Heavy pages (docx/pdf) are `React.lazy` code-split so login/dashboard are light.
- No test suite in Phase 1. `npm run lint` (oxlint) + `npm run build` are the gates.

### 11. Out of scope — confirmed not built
Client portal UI, deeper pre-flagging automation, quotations/invoicing, and **any
billing/pricing fields on the schema** (brief §8). `severity_weight` is an audit
scoring weight, not a price.
