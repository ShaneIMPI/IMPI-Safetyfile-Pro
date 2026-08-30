-- ===========================================================================
-- IMPI SafetyFile Pro — 0003 Row Level Security + Storage
--
-- Phase 1: every authenticated user is `staff` and gets full access.
-- The `client` policies below are written now (scoped to profiles.client_id)
-- so Phase 2 needs no rebuild — they are simply dormant until client users exist.
-- ===========================================================================

-- View respects underlying table RLS.
alter view document_control_register set (security_invoker = on);

-- Helper: enable RLS + a blanket staff-all policy on a table.
do $$
declare t text;
begin
  foreach t in array array[
    'clients','profiles','sectors','client_sectors','document_templates',
    'document_template_sectors','checklists','checklist_items','hazard_library',
    'hazard_library_sectors','method_step_library','method_step_library_sectors',
    'library_gap_flags','audits','audit_results','evidence_documents',
    'generated_documents','questionnaire_responses','safety_files','document_counters'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;

-- --- Profiles: a user can always read/update their own row ---------------
drop policy if exists own_profile_select on profiles;
create policy own_profile_select on profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists own_profile_update on profiles;
create policy own_profile_update on profiles
  for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));

-- --- Phase-2 client-role read scoping (dormant until client users exist) --
drop policy if exists client_read_own on clients;
create policy client_read_own on clients
  for select to authenticated
  using (id = current_client_id());

drop policy if exists client_read_audits on audits;
create policy client_read_audits on audits
  for select to authenticated using (client_id = current_client_id());

drop policy if exists client_read_audit_results on audit_results;
create policy client_read_audit_results on audit_results
  for select to authenticated
  using (exists (select 1 from audits a where a.id = audit_id and a.client_id = current_client_id()));

drop policy if exists client_read_generated on generated_documents;
create policy client_read_generated on generated_documents
  for select to authenticated using (client_id = current_client_id());

drop policy if exists client_read_safety_files on safety_files;
create policy client_read_safety_files on safety_files
  for select to authenticated using (client_id = current_client_id());

drop policy if exists client_read_evidence on evidence_documents;
create policy client_read_evidence on evidence_documents
  for select to authenticated using (client_id = current_client_id());
drop policy if exists client_insert_evidence on evidence_documents;
create policy client_insert_evidence on evidence_documents
  for insert to authenticated
  with check (client_id = current_client_id() and status = 'pending_review');

-- Reference data readable by any authenticated user (needed for a client portal later).
do $$
declare t text;
begin
  foreach t in array array['sectors','checklists','checklist_items','document_templates'] loop
    execute format('drop policy if exists anyauth_read on %I', t);
    execute format('create policy anyauth_read on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ===========================================================================
-- Storage buckets
-- ===========================================================================
insert into storage.buckets (id, name, public)
values
  ('logos',        'logos',        true),   -- client logos; embedded in generated docs
  ('uploads',      'uploads',      false),  -- client-supplied safety files being audited
  ('evidence',     'evidence',     false),  -- third-party certificates/evidence
  ('generated',    'generated',    false),  -- generated .docx / .pdf
  ('safety-files', 'safety-files', false)   -- final assembled PDFs
on conflict (id) do nothing;

-- Logos: public read, staff write.
drop policy if exists logos_read on storage.objects;
create policy logos_read on storage.objects
  for select using (bucket_id = 'logos');
drop policy if exists logos_write on storage.objects;
create policy logos_write on storage.objects
  for all to authenticated
  using (bucket_id = 'logos' and is_staff())
  with check (bucket_id = 'logos' and is_staff());

-- Private buckets: staff full access.
do $$
declare b text;
begin
  foreach b in array array['uploads','evidence','generated','safety-files'] loop
    execute format('drop policy if exists %I on storage.objects', b || '_staff_all');
    execute format(
      'create policy %I on storage.objects for all to authenticated using (bucket_id = %L and is_staff()) with check (bucket_id = %L and is_staff())',
      b || '_staff_all', b, b);
  end loop;
end $$;

-- Phase-2: a client user may upload into evidence/<their-client-id>/...
drop policy if exists evidence_client_upload on storage.objects;
create policy evidence_client_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = current_client_id()::text
  );
