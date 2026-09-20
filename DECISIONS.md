# Decisions & open items — IMPI SafetyFile Pro (Phase 1)

Choices made during the build where the brief left room, plus things that need
Shane's input or a credential before the app is fully live. Numbered so other
files can reference them (`see DECISIONS.md item N`).

---

## Addendum 1 (2026-08-30) — multi-file / multi-instance evidence

> Superseded in one respect by Addendum 2 below: the whole backend has since
> moved from Supabase to Neon, so "run it in the Supabase SQL editor" now reads
> "run it in the Neon SQL editor" and the migration itself no longer has a
> data-copy step (there's nothing to copy on a brand-new database) — see
> `neon/migrations/0005_evidence_files.sql`. Everything else below still holds.

- New migration **`0005_evidence_files.sql`**. It adds `evidence_document_files`
  (one-to-many); on Neon this is a fresh table on a fresh database, no data
  migration needed (it originally also copied existing
  `evidence_documents.file_url` into it and dropped that column, back when this
  ran as an ALTER against the live Supabase database).
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

## Addendum 2 (2026-09-19) — backend platform swap: Supabase → Neon

Full swap, not a dual-backend setup. Every place that used to say "Supabase" —
database, auth, file storage, the AI-hints function — now runs on Neon.
Document generation, the design system, numbering, the data model, and every
screen's behaviour are unchanged, as instructed.

**Why the storage half of this took real engineering, not a rename.** Neon
Object Storage's access control is bucket-wide only — a bucket is `private`
(needs one shared S3-style key for every operation) or `public_read`. There is
no per-object or per-folder policy the way Supabase Storage's RLS let a
`storage.objects` policy say "this client's browser may only touch files under
its own folder." Since this is a browser-only SPA, embedding that one shared
key in the public app bundle would have meant any staff member's browser (or
anyone with dev tools open on the deployed site) could read, overwrite, or
delete every client's certificates and generated documents — and it would have
permanently blocked the Phase-2 "client only sees their own files" plan. I
flagged this back before writing any code (per this addendum's own
instruction) and Shane chose "full Neon swap" once Neon's newly-shipped
Functions product gave a clean way to close the gap (below), accepting that
several of the pieces involved are beta.

**Everything here was verified against Neon's live docs during the build**
(not assumed from prior knowledge — Neon shipped a fuller backend suite,
Object Storage + Functions + the current Managed-Better-Auth-based Neon Auth,
in beta between roughly July and September 2026). `@neondatabase/neon-js`
installed at version `0.7.0-beta`, which is its own confirmation of how new
this stack is.

### What actually changed

1. **Database.** `neon/migrations/0001`–`0005` (moved from `supabase/migrations`,
   same file order, same table/column names per the original brief and
   Addendum 1 — nothing in the data model itself changed). Two real edits inside
   them:
   - `profiles.id` and every `*_by`/`created_by` column that references it are
     now **`text`, not `uuid`**, and `profiles.id` has **no foreign key** into
     Neon's own user table. Reason: Neon Auth issues its own user ids in the
     `neon_auth` schema, and Neon's docs explicitly warn that schema's internal
     unique constraints "may change in future updates" and shouldn't be
     hard-FK'd against — `text` safely accepts whatever id format shows up
     (uuid-shaped or not) without risking every insert failing on a type
     mismatch.
   - `auth.uid()` → **`auth.user_id()`** everywhere (the RLS-policy functions
     `is_staff()` / `current_client_id()`). This is Neon's genuine equivalent —
     a JWT-subject accessor exposed via the Neon Data API — not an approximation.
   - The Supabase `handle_new_user` trigger **on `auth.users` is gone**. Neon's
     own docs advise against depending on `neon_auth` internals, and DDL/trigger
     permissions on a Neon-managed schema aren't guaranteed. Replaced with
     `ensure_profile()`, a `SECURITY DEFINER` Postgres function the client calls
     (via the Data API's RPC endpoint) right after sign-in; it reads
     `auth.user_id()` itself server-side, so a caller can only ever create their
     *own* profile row. See `0002_functions.sql`.
   - All Supabase `storage.buckets` / `storage.objects` RLS from `0003_rls.sql`
     is **removed outright** — Neon has no equivalent schema; see item 3 below
     for what replaced it.
2. **Auth.** `src/auth/AuthProvider.jsx` and `LoginPage.jsx` now use Neon Auth
   (`@neondatabase/neon-js`'s single client, `client.auth.*` — signIn.email,
   useSession, signOut) instead of `@supabase/supabase-js`'s `.auth` methods.
   Sign-in still supports password and magic link; magic link needs that plugin enabled in
   the Neon console (Auth → sign-in methods) or it'll error — password always
   works. `profiles.role` (`staff`/`client`) is untouched, exactly as the
   addendum required — only the plumbing that populates and checks it changed.
3. **File storage.** Every upload/download in the app now goes through a new
   Neon Function, **`neon/functions/file-access`**, instead of calling Supabase
   Storage's SDK directly. It verifies the caller's Neon Auth JWT (via `jose` +
   the JWKS endpoint Neon injects), checks their `role`/`client_id` in Postgres
   — same rule the old Storage RLS enforced — and only then mints a short-lived
   presigned S3 URL scoped to exactly one bucket + key. `logos` is the one
   `public_read` bucket, so its read links are just the bucket's public URL, no
   function round-trip. `src/lib/neon.js`'s `uploadFile(bucket, path, file)`
   keeps the **exact same signature and return shape** the app already called
   everywhere (`{ path, url }`), so none of the 13 page files that upload files
   needed to change beyond the import rename — the addendum's "don't re-scope
   other screens" held.
   - Private-file read links are presigned for **7 days**, matching the
     lifetime Supabase's `createSignedUrl` used — same pre-existing caveat as
     before: a link stored and reopened after a week needs a fresh
     `refreshFileUrl()` call (exported from `src/lib/neon.js`, not yet wired
     into any page since no page hit this limitation in practice under Supabase
     either).
   - **Found and fixed during a follow-up review, before Shane hit it:** the two
     Neon Functions had no CORS handling at all (dropped by accident during the
     Deno→Node port — the original Supabase Edge Function explicitly had it).
     Since the app runs on a different origin (GitHub Pages) than the
     Functions, every call would have been silently blocked by the browser.
     Both now answer the CORS preflight and set the headers on every response.
   - **A second, more fundamental gap the same review surfaced:** presigned S3
     uploads/downloads are direct browser↔bucket requests, which need CORS
     configured **on the Object Storage buckets themselves** — a setting this
     app's code cannot express (it's not a Postgres migration or a Function,
     it's a property of the bucket). Without it, every upload in the app would
     fail. This is NOT optional the way item 1 in "Confirm these" below is —
     it's a required manual step, now called out explicitly in README.md §1.3
     with a ready-made policy at `neon/object-storage-cors.json`.
4. **The AI-hints function.** `neon/functions/audit-suggest` replaces the
   Supabase Edge Function 1:1 (same prompt, same Anthropic call, same
   never-auto-finalizes behaviour) — ported from Deno's `Deno.serve()` handler
   to a Neon Function's Fetch-API `export default { fetch(request) {...} }`
   shape, with JWT verification done the same way as `file-access`.
5. **Env vars.** `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are gone.
   Five new browser vars (`VITE_NEON_DATA_API_URL`, `VITE_NEON_AUTH_URL`,
   `VITE_NEON_FILE_FN_URL`, `VITE_NEON_AUDIT_FN_URL`,
   `VITE_NEON_PUBLIC_FILES_URL`) plus function-level secrets
   (`ANTHROPIC_API_KEY` on `audit-suggest`; `AWS_ACCESS_KEY_ID` /
   `AWS_SECRET_ACCESS_KEY` / `AWS_ENDPOINT_URL_S3` / `AWS_REGION` on
   `file-access`) — full list with where to get each value in `.env.example`
   and README.md §1.7.

### Verification note

The web-search pass first suggested a *two-client* shape (a separate
`createClient(dataApiUrl)` for data plus `createAuthClient(authUrl)` for auth)
and a guessed `getAccessToken()` method. Before shipping that, I installed
`@neondatabase/neon-js` and read its actual bundled `README.md`/`llms.txt` —
ground truth, not a secondhand summary — which showed the real shape is **one**
client, `createClient({ auth: { url, adapter }, dataApi: { url } })`, with
`client.auth.*` for sign-in/session and `client.from()`/`client.rpc()` for
data; and that the documented token accessor is **`getJWTToken()`**, not
`getAccessToken`. `src/lib/neon.js` was corrected to match before this shipped.
Left as-is version-pinned only by what's in `package-lock.json` — a
`neon-js` version bump could rename something again, exactly like any beta
dependency.

### Confirm these once your Neon project exists (flagged, not guessed)

Two things are genuinely only visible once a real project exists, isolated to
the two custom Functions — everything else (client/audit/document CRUD, and
sign-in itself) rides on the parts confirmed above:

1. **Env var names Neon auto-injects into a Function**
   (`NEON_AUTH_JWKS_URL`, `NEON_AUTH_BASE_URL`, `AWS_ACCESS_KEY_ID`, etc. inside
   `neon/functions/*/index.js`). These follow Neon's documented conventions and
   the AWS SDK's own standard env var names, but check each function's logs
   after first deploy — if one is missing, add it manually from the connection
   details Neon's console shows for that project.
2. **Function deploy command / URL shape.** Neon Functions shipped roughly two
   months before this was written; README.md §1.4 describes the Console-driven
   flow rather than a pinned CLI command, since I could not verify one command
   syntax confidently enough to hand it to a non-technical user as gospel.

---

## Blockers — need Shane / IMPI to proceed

- **B1. Neon project + Data API + Auth + Object Storage + Functions.**
  ⬆️ SUPERSEDED (2026-09-19) by Addendum 2 — the backend moved from Supabase to
  Neon. I can't create the Neon project or any of its keys. Someone at IMPI
  needs to work through README.md §1.1–1.4: create the project, run the five
  migrations in `neon/migrations/`, enable the Data API + Neon Auth, create the
  five Object Storage buckets, deploy the two `neon/functions/*`, and put the
  five `VITE_NEON_*` values into GitHub Actions secrets (and a local
  `.env.local` for dev).
- **B2. First staff user.** Unchanged in spirit, different platform: sign in
  once (or create a user under Neon Auth in the console) and the app's
  `ensure_profile()` call creates that person's `profiles` row automatically,
  defaulting to `staff`. See README.md §1.2.
- **B3. Anthropic API key for AI-assisted audit.** Optional but recommended.
  Set as a **Neon Function environment variable** on `audit-suggest` (Neon
  Console → Functions → `audit-suggest` → Environment variables → add
  `ANTHROPIC_API_KEY`), never a browser var. Without it the audit screen still
  works — every item is reviewed manually (see item 2 further down).
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
- **B6. GitHub repo + Pages.** ✅ RESOLVED (2026-08-30). Repo is live at
  `shaneimpi/IMPI-Safetyfile-Pro`, Pages source is "GitHub Actions", deploys are
  automatic on push to `main`.

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
- Neon Auth (Managed Better Auth) since Addendum 2 — originally Supabase Auth,
  same shape either way. `profiles.role` is `staff | client`.
  **Only `staff` UI exists.**
- All new auth users become `staff` (Phase-1 is invite-only). The `client` role,
  `profiles.client_id`, and dormant client-scoped RLS policies are all in place
  so Phase 2 needs **no schema rebuild** (brief §4, §8). (Storage's client-scoped
  check now lives in the `file-access` Function instead of storage-layer RLS —
  see Addendum 2 item 3 — everything else about this point is unchanged.)
- Login supports **password or magic link** (magic link needs that plugin
  enabled in the Neon console). No self-service sign-up screen.

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
`logos` (public_read), `uploads` (client safety files under audit), `evidence`,
`generated`, `safety-files` — all private except `logos`. Since Addendum 2,
"staff-only" for the private buckets is enforced by the `file-access` Neon
Function (Neon Object Storage has no storage-layer RLS to enforce it directly —
see Addendum 2). Private-bucket URLs in the app are still **7-day presigned
URLs**, matching the original Supabase behaviour. If a link 404s later,
`refreshFileUrl()` in `src/lib/neon.js` mints a fresh one (not yet wired into
any page — no page has hit this in practice).

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
