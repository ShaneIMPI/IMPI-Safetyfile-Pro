# IMPI SafetyFile Pro

Internal, staff-only tool for IMPI Protection Agency to audit client safety files
against sector-specific checklists, generate the IMPI-authored documents, collect
third-party evidence, and assemble a numbered, branded master safety-file PDF.

**Stack:** Vite + React, Supabase (Postgres + Auth + Storage, client-side with RLS),
`docx` for document generation, `pdf-lib` for PDF assembly, GitHub Pages via GitHub
Actions for hosting. No separate backend server (the one server-side piece is an
optional Supabase Edge Function for AI audit hints).

> Read **DECISIONS.md** for choices made, the compliance-score formula, the
> `.docx`→PDF workflow, and the list of things that still need IMPI input.

---

## 1. One-time setup

### 1.1 Supabase

1. Create a project at [supabase.com](https://supabase.com) (region: `eu-west` or
   closest to South Africa).
2. **SQL Editor → New query.** Paste and run each file **in order**:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_functions.sql`
   - `supabase/migrations/0003_rls.sql`
   - `supabase/migrations/0004_seed.sql`  (safe to skip / re-run — it self-skips if data exists)
3. **Authentication → Users → Add user.** Create the first IMPI staff login
   (email + password). It becomes `staff` automatically.
4. **Project Settings → API.** Copy the **Project URL** and the **anon public** key.

### 1.2 Local development

```bash
npm install
cp .env.example .env.local     # then paste your Supabase URL + anon key
npm run dev
```

Open the printed `http://localhost:xxxx/impi-safetyfile-pro/` URL and sign in.

### 1.3 GitHub repo + Pages deploy

1. Create a repo named **`impi-safetyfile-pro`** on GitHub and push this folder to
   `main` (GitHub web UI: "uploading an existing file", or drag-drop the folder).
2. Repo **Settings → Secrets and variables → Actions → New repository secret**,
   add two:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Repo **Settings → Pages → Build and deployment → Source: “GitHub Actions”**
   (not "Deploy from a branch").
4. Every push to `main` now builds and deploys automatically
   (`.github/workflows/deploy.yml`). The site URL appears in the Actions run and
   under Settings → Pages.

If you rename the repo or use a custom domain, set `VITE_BASE` accordingly
(a repo secret/variable) — e.g. `VITE_BASE=/` for a custom domain.

### 1.4 (Optional) AI-assisted audit hints

Needs the Supabase CLI once, then it's self-contained:

```bash
npm i -g supabase
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
supabase functions deploy audit-suggest
```

Without this, the Audit screen works fully — you just review every item by hand
with no AI suggestion. The AI **never** finalizes a finding either way.

---

## 2. Day-to-day workflow

1. **Clients** — add the client, upload their logo, tag their sector(s).
2. **Sectors & Checklists** — the four Phase-1 sectors and their checklists are
   seeded. Add trades / edit checklist items / regulation refs here anytime.
3. **Audits** — new audit → pick client + checklist → upload their existing
   safety file (PDF) → optionally run AI suggestions → confirm every item →
   *Generate Audit Report*.
4. **Gap resolution** (inside the audit) — each confirmed *partial* /
   *non-compliant* item shows a gap action:
   - `generated` item → **Generate document** (opens the Document Builder scoped
     to that client).
   - `evidence` item → **Request / upload evidence** (captures issuing body,
     certificate number, expiry). Accept/reject it on the client page.
5. **Document Builder** — pick client + template → fill the questionnaire → for
   RA / Method Statement, edit the library-assembled lines → *Generate &
   finalize* (produces the numbered `.docx`, files a copy, downloads it).
   Review/edit in Word, "Save as PDF", then upload that PDF in Final Assembly.
6. **Final Assembly** — pick client → order the finalized documents + accepted
   evidence in TOC order → *Assemble* → one bound, page-numbered master PDF with
   an `IMPI-SF-…` reference.
7. **Document Register** — read-only, searchable, CSV-exportable record of every
   document ever produced or filed.

---

## 3. Project layout

```
supabase/migrations/     0001 schema · 0002 functions+numbering · 0003 RLS+storage · 0004 seed catalogue
supabase/functions/      audit-suggest Edge Function (AI hints)
src/theme/tokens.js      design-system single source of truth (colours, fonts, risk bands, IMPI credit line)
src/index.css            same tokens for the UI
src/docgen/shared.js     the docx style toolkit — cover, header, footer, tables, TOC dot-leaders
src/docgen/*.js          riskAssessment · methodStatement · auditReport · safetyFileCover · genericDocument · index (registry)
src/lib/pdf.js           pdfjs text extraction + pdf-lib merge + front-matter PDF
src/lib/supabase.js|db.js Supabase client, storage helpers, query helpers
src/pages/               dashboard · clients · sectors · library · documents · audits · assembly · register
```

## 4. Scripts

| command          | what                                             |
|------------------|-------------------------------------------------|
| `npm run dev`    | local dev server                                |
| `npm run build`  | production build to `dist/` (what CI deploys)   |
| `npm run lint`   | oxlint                                           |
| `npm run preview`| serve the built `dist/` locally                 |
