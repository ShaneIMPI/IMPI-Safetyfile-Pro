# IMPI SafetyFile Pro

Internal, staff-only tool for IMPI Protection Agency to audit client safety files
against sector-specific checklists, generate the IMPI-authored documents, collect
third-party evidence, and assemble a numbered, branded master safety-file PDF.

**Stack:** Vite + React, Neon Postgres + Neon Auth (client-side with RLS),
`docx` for document generation, `pdf-lib` for PDF assembly, GitHub Pages via GitHub
Actions for hosting. No separate backend server — the two server-side pieces are
small Neon Functions: an optional AI audit-hints function, and a required
file-access broker that mints scoped, short-lived links for private files (Neon
Object Storage has no per-file access policy, so this is what keeps other
clients' certificates from being readable by a shared key — see DECISIONS.md
addendum 2 for the full reasoning).

> Read **DECISIONS.md** for choices made, the compliance-score formula, the
> `.docx`→PDF workflow, and the list of things that still need IMPI input —
> **addendum 2 especially**, since several Neon pieces below are beta products
> only a few months old and a couple of exact names may need a one-line fix
> once you're looking at your own Neon console.

---

## 1. One-time setup

### 1.1 Create the Neon project

1. Create a project at [neon.com](https://neon.com) (free plan). Pick a region
   close to South Africa if offered (Frankfurt/EU is the closest current option).
2. Neon Console → **SQL Editor**. Paste and run each file **in order**:
   - `neon/migrations/0001_schema.sql`
   - `neon/migrations/0002_functions.sql`
   - `neon/migrations/0003_rls.sql`
   - `neon/migrations/0004_seed.sql` (safe to skip / re-run — it self-skips if data exists)
   - `neon/migrations/0005_evidence_files.sql`

### 1.2 Turn on the Data API + Neon Auth

1. Neon Console → your project → **Data API**. Enable it, choose **Managed
   Better Auth** as the auth provider when asked, and tick "grant public schema
   access" if offered (0003 already sets up the exact RLS policies this needs).
   Copy the **Data API URL** shown — this is `VITE_NEON_DATA_API_URL`.
2. Neon Console → your project → **Auth**. This is Neon Auth (Managed Better
   Auth). Copy its endpoint URL — this is `VITE_NEON_AUTH_URL`.
3. In the Auth section, create your first staff login (email + password) — or
   sign up once through the running app itself once it's deployed; either way,
   the first time you sign in the app calls a database function that creates
   your `profiles` row automatically, defaulting to `staff`.

### 1.3 Create the Object Storage buckets

Neon Console → your project → **Object Storage** (or `neon buckets create` if
you're using the CLI). Create five buckets exactly named:

| Bucket | Access |
|---|---|
| `logos` | **public_read** |
| `uploads` | private |
| `evidence` | private |
| `generated` | private |
| `safety-files` | private |

Copy the **public URL** shown for the `logos` bucket — that's
`VITE_NEON_PUBLIC_FILES_URL`. Also generate an **Object Storage access key**
(Console → Object Storage → Access keys) — you'll need it in step 1.4.

**Then set CORS on all five buckets — do not skip this.** Uploads and file
previews work by the browser talking to the bucket directly with a short-lived
signed link (that's what `file-access` mints). Without a CORS rule allowing
your site's origin, every one of those browser requests is silently blocked
and uploads will fail. A ready-made policy is in
`neon/object-storage-cors.json` — apply it via whichever of these your Neon
Console offers first:

- Console → Object Storage → bucket → **CORS** (if there's a settings tab for it), or
- the AWS CLI pointed at your Neon endpoint, once per bucket:
  ```bash
  aws s3api put-bucket-cors --bucket logos \
    --cors-configuration file://neon/object-storage-cors.json \
    --endpoint-url $AWS_ENDPOINT_URL_S3
  ```
  (repeat for `uploads`, `evidence`, `generated`, `safety-files`; the access
  key from above needs to be set as your AWS CLI credentials first). If you
  ever change the GitHub Pages URL or add a custom domain, add it to the
  `AllowedOrigins` list in that file and re-apply.

### 1.4 Deploy the two Neon Functions

These live in `neon/functions/audit-suggest/` and `neon/functions/file-access/`.
Neon Functions are new enough that the exact deploy command may differ slightly
from what's below — the Neon Console's **Functions** section has a "deploy a
function" flow with instructions matched to your account; follow that if it
doesn't match exactly.

1. Neon Console → your project → **Functions** → create a function named
   `file-access`, pointing at `neon/functions/file-access/` in this repo (it
   has its own `package.json` with the two dependencies it needs).
2. Set its environment variables (Functions → `file-access` → Environment
   variables): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_ENDPOINT_URL_S3`, `AWS_REGION` — the Object Storage access key from
   step 1.3. `DATABASE_URL` / `NEON_AUTH_JWKS_URL` / `NEON_AUTH_BASE_URL` should
   already be there automatically; if the function's logs show it can't find
   one of those four, add it manually from the connection details Neon shows you.
3. Repeat for a function named `audit-suggest`, pointing at
   `neon/functions/audit-suggest/`. This one is optional — see step 1.6.
4. Copy each function's URL — `VITE_NEON_FILE_FN_URL` and `VITE_NEON_AUDIT_FN_URL`.

### 1.5 Local development

```bash
npm install
cp .env.example .env.local     # then paste the five Neon URLs from steps 1.2-1.4
npm run dev
```

Open the printed `http://localhost:5173/` URL and sign in.

### 1.6 (Optional) AI-assisted audit hints

The `audit-suggest` function only needs one more thing: an Anthropic API key
(console.anthropic.com → Settings → API keys), set as a Function environment
variable named `ANTHROPIC_API_KEY` (Neon Console → Functions → `audit-suggest`
→ Environment variables) — **never** as a `VITE_` variable, or it would ship
into the public app bundle.

Without this, the Audit screen still works fully — you just review every item
by hand with no AI suggestion. The AI **never** finalizes a finding either way.

### 1.7 GitHub repo + Pages deploy

The repo already exists and Pages is already live for this project
(`shaneimpi/IMPI-Safetyfile-Pro`) — this is only for reference or a fresh clone.

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**,
   add all five:
   - `VITE_NEON_DATA_API_URL`
   - `VITE_NEON_AUTH_URL`
   - `VITE_NEON_FILE_FN_URL`
   - `VITE_NEON_AUDIT_FN_URL`
   - `VITE_NEON_PUBLIC_FILES_URL`

   (Cross-check this list against `.github/workflows/deploy.yml`'s `env:` block
   — every `${{ secrets.X }}` referenced there needs a matching secret.)
2. Repo → **Settings → Pages → Build and deployment → Source: "GitHub Actions"**
   (not "Deploy from a branch").
3. Push to `main` — the workflow builds and deploys automatically. The site URL
   appears in the Actions run and under Settings → Pages.

The deployed base path is derived automatically from the repo name in CI
(`GITHUB_REPOSITORY`), so it always matches the case-sensitive Pages URL
`https://<user>.github.io/<repo>/`. For a custom domain, set a repo variable
`VITE_BASE=/`.

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
     certificate number, expiry; multiple files/entries per item — see
     DECISIONS.md addendum 1). Accept/reject it on the client page.
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
neon/migrations/         0001 schema · 0002 functions+numbering · 0003 RLS · 0004 seed catalogue · 0005 evidence files
neon/functions/          audit-suggest (AI hints) · file-access (private-file broker) — both Neon Functions
src/theme/tokens.js      design-system single source of truth (colours, fonts, risk bands, IMPI credit line)
src/index.css            same tokens for the UI
src/docgen/shared.js     the docx style toolkit — cover, header, footer, tables, TOC dot-leaders
src/docgen/*.js          riskAssessment · methodStatement · auditReport · safetyFileCover · genericDocument · index (registry)
src/lib/pdf.js           pdfjs text extraction + pdf-lib merge + front-matter PDF
src/lib/neon.js|db.js    Neon Data API + Auth client, storage helpers (via file-access), query helpers
src/pages/               dashboard · clients · sectors · library · documents · audits · assembly · register
```

## 4. Scripts

| command          | what                                             |
|------------------|-------------------------------------------------|
| `npm run dev`    | local dev server                                |
| `npm run build`  | production build to `dist/` (what CI deploys)   |
| `npm run lint`   | oxlint                                           |
| `npm run preview`| serve the built `dist/` locally                 |
