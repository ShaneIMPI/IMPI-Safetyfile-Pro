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
2. Run each file **in order** against the database. **Prefer `psql` over
   pasting into the Console's SQL Editor** — some of these files are long
   enough that a manual copy-paste has silently truncated mid-file more than
   once in practice, leaving later statements (a whole file's worth, in one
   case) never applied with no error shown. `psql` runs the whole file as one
   unit and stops loudly on a real error instead:
   ```bash
   CONN=$(neonctl connection-string <branch> --project-id <id> --role-name neondb_owner --pooled)
   for f in neon/migrations/000{1,2,3,4,5,6}*.sql; do
     psql "$CONN" -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED at $f"; break; }
   done
   ```
   (`--role-name neondb_owner` matters — that's the admin role with DDL rights;
   the Data API's own `authenticated` role deliberately can't run any of this.)
3. **Verify it actually landed**, not just that no command errored:
   ```bash
   psql "$CONN" -c "select count(*) from pg_policies;"                    # expect 36
   psql "$CONN" -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname !~ '^(armor|crypt|dearmor|decrypt|digest|encrypt|fips_mode|gen_random_bytes|gen_salt|hmac|pgp_)';"  # expect 12 (incl. gen_random_uuid)
   psql "$CONN" -c "select count(*) from information_schema.role_table_grants where grantee='authenticated';"  # expect 85
   ```
   If any of these are lower than expected, re-run the migration files listed
   above — they're all idempotent, safe to run again.

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

The CLI below (`neonctl`, `npm i -g neonctl`, then `neonctl auth`) is what was
actually used to set this project up — every command here has been run for
real against this project, not just written from docs. The Console has
equivalent screens under **Object Storage** if you'd rather click through it.

```bash
export NEON_API_KEY=nak_live_...           # Console > Account settings > API Keys
PROJECT=steep-fog-58474739
BRANCH=br-orange-waterfall-b2bcgbss

neonctl buckets create logos        --access-level public_read --project-id $PROJECT --branch $BRANCH
neonctl buckets create uploads      --project-id $PROJECT --branch $BRANCH   # private is the default
neonctl buckets create evidence     --project-id $PROJECT --branch $BRANCH
neonctl buckets create generated    --project-id $PROJECT --branch $BRANCH
neonctl buckets create safety-files --project-id $PROJECT --branch $BRANCH
```

`VITE_NEON_PUBLIC_FILES_URL` is `https://<your-s3-endpoint>/logos` — get the
endpoint with `neonctl api "/projects/$PROJECT/branches/$BRANCH/storage"`
(look for `s3_endpoint`).

**Then set CORS on all five buckets — do not skip this.** Uploads and file
previews work by the browser talking to the bucket directly with a short-lived
signed link (that's what `file-access` mints). Without a CORS rule allowing
your site's origin, every one of those browser requests is silently blocked
and uploads will fail. A ready-made policy is in `neon/object-storage-cors.json`.

1. Issue a scoped credential for this (Object Storage's own S3-style
   credentials — separate from your Neon API key and from `DATABASE_URL`):
   ```bash
   neonctl credentials create --project-id $PROJECT --branch $BRANCH \
     --name cors-setup --scope storage:read --scope storage:write
   ```
   This prints a `token_id` and an `s3_secret_access_key` **once** — save both.
   Counter-intuitively, **`token_id` is the S3 access key ID** (not the
   `api_token` field the same output also shows — confirmed by testing both;
   only `token_id` authenticates against the S3 endpoint).
2. Apply it to all five buckets (the endpoint needs `--region` and
   `force_path_style` — confirmed by querying `.../branches/$BRANCH/storage`
   directly, which returns `"force_path_style": true`; without setting the
   equivalent `s3.addressing_style = path` in your AWS CLI config, every call
   fails):
   ```bash
   export AWS_ACCESS_KEY_ID=<the token_id above>
   export AWS_SECRET_ACCESS_KEY=<the s3_secret_access_key above>
   aws configure set default.s3.addressing_style path
   ENDPOINT="https://$BRANCH.storage.c-6.eu-central-1.aws.neon.tech"   # from step above, yours will differ

   for b in logos uploads evidence generated safety-files; do
     aws s3api put-bucket-cors --bucket "$b" \
       --cors-configuration file://neon/object-storage-cors.json \
       --endpoint-url "$ENDPOINT" --region eu-central-1
   done
   ```
3. Verify it actually took (don't trust a silent success):
   ```bash
   aws s3api get-bucket-cors --bucket logos --endpoint-url "$ENDPOINT" --region eu-central-1
   ```
   If you ever change the GitHub Pages URL or add a custom domain, add it to
   the `AllowedOrigins` list in `neon/object-storage-cors.json` and re-apply.

### 1.4 Deploy the two Neon Functions

Function slugs are restricted to **1-20 lowercase letters and digits — no
hyphens**, so the deployed names are `fileaccess` and `auditsuggest` (the
repo folders keep the hyphenated names; only the deployed slug is different).
Each function needs its own dependencies installed once before deploying
(the bundler won't fetch them for you):

```bash
cd neon/functions/file-access && npm install && cd ../../..
cd neon/functions/audit-suggest && npm install && cd ../../..

neonctl function deploy fileaccess \
  --project-id $PROJECT --branch $BRANCH \
  --src neon/functions/file-access --runtime nodejs24 \
  --env AWS_ACCESS_KEY_ID=<the storage credential's token_id from 1.3> \
  --env AWS_SECRET_ACCESS_KEY=<its s3_secret_access_key> \
  --env AWS_ENDPOINT_URL_S3="$ENDPOINT" \
  --env AWS_REGION=eu-central-1

neonctl function deploy auditsuggest \
  --project-id $PROJECT --branch $BRANCH \
  --src neon/functions/audit-suggest --runtime nodejs24
  # add --env ANTHROPIC_API_KEY=sk-ant-... here if you want AI hints — see 1.6
```

`DATABASE_URL` / `NEON_AUTH_JWKS_URL` / `NEON_AUTH_BASE_URL` are genuinely
auto-injected — confirmed by calling the deployed function with no auth header
and getting back a clean `{"error":"unauthorised"}` rather than a 500, which
means JWT verification ran successfully.

Each deploy prints an **Invocation Url** — those are `VITE_NEON_FILE_FN_URL`
and `VITE_NEON_AUDIT_FN_URL`. Verify each one actually works before moving on:

```bash
curl -i -X OPTIONS "<invocation url>" -H "Origin: https://<you>.github.io"
# expect: HTTP/2 204 with access-control-allow-* headers present

curl -i -X POST "<invocation url>" -H "content-type: application/json" -d '{}'
# fileaccess expects: 401 {"error":"unauthorised"}
# auditsuggest expects: 200 {"disabled":true,...} if ANTHROPIC_API_KEY isn't set yet, else 400 (bad body)
```

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
