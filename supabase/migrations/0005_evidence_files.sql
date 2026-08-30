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

-- Move any existing single file onto the new table, then drop the column.
insert into evidence_document_files (evidence_document_id, file_url, file_name, uploaded_at)
select id, file_url, null, created_at
from evidence_documents
where file_url is not null and btrim(file_url) <> ''
  and not exists (
    select 1 from evidence_document_files f where f.evidence_document_id = evidence_documents.id
  );

alter table evidence_documents drop column if exists file_url;

-- --- RLS (mirrors evidence_documents) ---------------------------------
alter table evidence_document_files enable row level security;

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
