-- ===========================================================================
-- IMPI SafetyFile Pro — 0003 Row Level Security  (Neon Postgres)
--
-- Phase 1: every authenticated user is `staff` and gets full access.
-- The `client` policies below are written now (scoped to profiles.client_id)
-- so Phase 2 needs no rebuild — they are simply dormant until client users exist.
--
-- NEON NOTE: file storage (logos / uploads / evidence / generated / safety-files)
-- is NOT set up here. Neon Object Storage has no Postgres-visible `storage`
-- schema and no per-object or per-folder policy grammar (bucket access is only
-- "private" or "public_read", set on the bucket itself, not via SQL) — so
-- there is nothing equivalent to Supabase's storage.objects RLS to port.
-- Authorization for private files is enforced instead by the `file-access`
-- Neon Function (neon/functions/file-access), which checks is_staff() / a
-- client's own client_id against Postgres before minting a scoped, short-lived
-- URL. See DECISIONS.md addendum 2 for the full reasoning. Create the buckets
-- themselves via the Neon CLI/console per README.md step 4 (logos =
-- public_read, everything else = private).
-- ===========================================================================

-- View respects underlying table RLS.
alter view document_control_register set (security_invoker = on);
-- A view is its own relation and needs its own SELECT grant regardless of
-- security_invoker — see the grants note below.
grant select on document_control_register to authenticated;

-- "permission denied for table X" is a different failure from RLS filtering
-- rows: it fires when a role has no base GRANT on the table at all, before
-- Postgres ever evaluates a policy. Supabase auto-applies this as part of its
-- RLS tooling; on Neon it has to be done explicitly, so every table below
-- gets both the grant and the policy in the same loop rather than relying on
-- a Neon Console checkbox ("grant public schema access") that may or may not
-- have been ticked.
grant usage on schema public to authenticated;

-- Helper: enable RLS + a blanket staff-all policy + the base grant on a table.
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
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format(
      'create policy staff_all on %I for all to authenticated using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;

-- --- Profiles: a user can always read/update their own row ---------------
-- (Insert is handled entirely by the SECURITY DEFINER ensure_profile() in
-- 0002_functions.sql, which bypasses RLS as the owning role — no insert
-- policy is needed or wanted here, since it must never accept a client-
-- supplied id.)
drop policy if exists own_profile_select on profiles;
create policy own_profile_select on profiles
  for select to authenticated using (id = auth.user_id());

drop policy if exists own_profile_update on profiles;
create policy own_profile_update on profiles
  for update to authenticated using (id = auth.user_id())
  with check (id = auth.user_id() and role = (select role from profiles where id = auth.user_id()));

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
