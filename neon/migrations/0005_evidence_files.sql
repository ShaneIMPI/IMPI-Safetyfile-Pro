-- ===========================================================================
-- IMPI SafetyFile Pro — 0005  Multi-file evidence documents (addendum)
--
-- One evidence_documents row still = one certificate / instance (one issuing
-- body, one certificate number, one expiry). Its file(s) now live one-to-many
-- in evidence_document_files. Naturally-plural checklist items get MULTIPLE
-- evidence_documents rows against the same checklist_item_id — never one row
-- with unrelated certs crammed into its file list.
--
-- Numbering is unchanged: every evidence_documents row still gets its own
-- IMPI-EVD-... reference regardless of file count.
-- ===========================================================================

create table if not exists evidence_document_files (
  id                   uuid primary key default gen_random_uuid(),
  evidence_document_id uuid not null references evidence_documents(id) on delete cascade,
  file_url             text not null,
  file_name            text,
  uploaded_at          timestamptz not null default now()
);

create index if not exists evidence_document_files_parent_idx
  on evidence_document_files (evidence_document_id);

-- NEON NOTE: on Supabase this migration also copied evidence_documents.file_url
-- into this table and dropped that column — needed there because it was an
-- ALTER on a live database with existing rows. This migration set targets a
-- brand-new Neon database (0001_schema.sql never creates that column at all),
-- so there is nothing to migrate; that step is intentionally omitted here.

-- --- RLS (mirrors evidence_documents) ---------------------------------
alter table evidence_document_files enable row level security;
-- Base grant, not just the policy — see 0003_rls.sql's note on
-- "permission denied for table X" being a different failure from RLS.
grant select, insert, update, delete on evidence_document_files to authenticated;

drop policy if exists staff_all on evidence_document_files;
create policy staff_all on evidence_document_files
  for all to authenticated using (is_staff()) with check (is_staff());

-- Phase-2 client scoping: readable / insertable via the parent's client_id.
drop policy if exists client_read on evidence_document_files;
create policy client_read on evidence_document_files
  for select to authenticated
  using (exists (
    select 1 from evidence_documents e
    where e.id = evidence_document_id and e.client_id = current_client_id()
  ));

drop policy if exists client_insert on evidence_document_files;
create policy client_insert on evidence_document_files
  for insert to authenticated
  with check (exists (
    select 1 from evidence_documents e
    where e.id = evidence_document_id and e.client_id = current_client_id()
  ));
