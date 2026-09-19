-- ===========================================================================
-- IMPI SafetyFile Pro — 0002 functions, numbering, triggers
-- ===========================================================================

-- --- Auth helpers (Neon Auth / Neon Data API) --------------------------
-- auth.user_id() is provided by Neon's Data API (pg_session_jwt extension) —
-- it reads the `sub` claim of the caller's Neon Auth JWT. It is Neon's direct
-- equivalent of Supabase's auth.uid(), except it returns the JWT subject as
-- TEXT rather than a Postgres uuid, which is why profiles.id is text (see
-- the NEON NOTE in 0001_schema.sql).
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.user_id() and p.role = 'staff');
$$;

create or replace function current_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from profiles where id = auth.user_id();
$$;

-- Idempotently create the caller's own profile row on first login.
--
-- NEON NOTE: there is deliberately no database trigger on the Neon Auth user
-- table (equivalent to Supabase's `handle_new_user` trigger on `auth.users`).
-- Two reasons: (1) Neon's own docs advise against taking a hard dependency on
-- the internals of the `neon_auth` schema, and DDL/trigger permissions on a
-- Neon-managed schema aren't guaranteed; (2) `auth.user_id()` — the only
-- caller-scoped identity available inside Postgres — is only populated on an
-- authenticated Data API request, not inside a plain insert trigger context.
-- Instead the client calls this function (as a Data API RPC call) right after
-- sign-in; see src/auth/AuthProvider.jsx. SECURITY DEFINER + reading
-- auth.user_id() server-side means a caller can only ever create/touch THEIR
-- OWN profile row, never someone else's — no additional RLS insert policy is
-- needed because this is the only insert path.
create or replace function ensure_profile(p_full_name text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (auth.user_id(), p_full_name)
  on conflict (id) do nothing;
end $$;

-- --- Client code generation -----------------------------------------
-- Compact uppercase alphanumerics of the company name, first 6 chars,
-- de-duplicated with a numeric suffix. Admin can override the field. (DECISIONS.md item 1)
create or replace function gen_client_code(p_name text)
returns text language plpgsql as $$
declare base text; candidate text; n int := 0;
begin
  base := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(base) < 3 then base := rpad(base, 3, 'X'); end if;
  base := left(base, 6);
  candidate := base;
  while exists (select 1 from clients where client_code = candidate) loop
    n := n + 1;
    candidate := left(base, greatest(1, 6 - length(n::text))) || n::text;
  end loop;
  return candidate;
end $$;

create or replace function clients_before_insert()
returns trigger language plpgsql as $$
begin
  if new.client_code is null or btrim(new.client_code) = '' then
    new.client_code := gen_client_code(new.company_name);
  else
    new.client_code := upper(regexp_replace(new.client_code, '[^A-Za-z0-9]', '', 'g'));
  end if;
  return new;
end $$;

create trigger trg_clients_before_insert
  before insert on clients
  for each row execute function clients_before_insert();

-- --- Sequence allocation -------------------------------------------
create or replace function next_doc_seq(p_client uuid, p_type text, p_year int)
returns int language plpgsql as $$
declare v int;
begin
  insert into document_counters (client_id, type_code, year, last_seq)
  values (p_client, p_type, p_year, 1)
  on conflict (client_id, type_code, year)
  do update set last_seq = document_counters.last_seq + 1
  returning last_seq into v;
  return v;
end $$;

-- --- generated_documents numbering --------------------------------
-- IMPI-<TYPE>-<CLIENTCODE>-<YEAR>-<SEQ>-Rev<N>  (SEQ zero-padded to 3)
-- A revision (parent_document_id set) reuses the parent SEQ and bumps Rev.
create or replace function generated_documents_before_insert()
returns trigger language plpgsql as $$
declare v_code text; v_type text; v_year int;
begin
  select client_code into v_code from clients where id = new.client_id;
  select type_code  into v_type from document_templates where id = new.document_template_id;
  v_year := extract(year from coalesce(new.generated_at, now()))::int;

  if new.parent_document_id is not null then
    select seq, revision + 1 into new.seq, new.revision
      from generated_documents where id = new.parent_document_id;
  end if;

  if new.doc_year is null then new.doc_year := v_year; end if;
  if new.seq is null then new.seq := next_doc_seq(new.client_id, v_type, new.doc_year); end if;
  if new.revision is null then new.revision := 1; end if;

  new.document_ref := format('IMPI-%s-%s-%s-%s-Rev%s',
    v_type, v_code, new.doc_year, lpad(new.seq::text, 3, '0'), new.revision);
  return new;
end $$;

create trigger trg_generated_documents_before_insert
  before insert on generated_documents
  for each row execute function generated_documents_before_insert();

-- --- evidence_documents numbering ---------------------------------
-- IMPI-EVD-<CLIENTCODE>-<YEAR>-<SEQ>. Renewals get a fresh SEQ (never a revision).
create or replace function evidence_documents_before_insert()
returns trigger language plpgsql as $$
declare v_code text; v_year int;
begin
  select client_code into v_code from clients where id = new.client_id;
  v_year := extract(year from now())::int;
  if new.doc_year is null then new.doc_year := v_year; end if;
  if new.seq is null then new.seq := next_doc_seq(new.client_id, 'EVD', new.doc_year); end if;
  new.document_ref := format('IMPI-EVD-%s-%s-%s',
    v_code, new.doc_year, lpad(new.seq::text, 3, '0'));
  return new;
end $$;

create trigger trg_evidence_documents_before_insert
  before insert on evidence_documents
  for each row execute function evidence_documents_before_insert();

-- --- safety_files numbering --------------------------------------
-- IMPI-SF-<CLIENTCODE>-<YEAR>-<SEQ>
create or replace function safety_files_before_insert()
returns trigger language plpgsql as $$
declare v_code text; v_year int;
begin
  select client_code into v_code from clients where id = new.client_id;
  v_year := extract(year from now())::int;
  if new.doc_year is null then new.doc_year := v_year; end if;
  if new.seq is null then new.seq := next_doc_seq(new.client_id, 'SF', new.doc_year); end if;
  new.document_ref := format('IMPI-SF-%s-%s-%s',
    v_code, new.doc_year, lpad(new.seq::text, 3, '0'));
  return new;
end $$;

create trigger trg_safety_files_before_insert
  before insert on safety_files
  for each row execute function safety_files_before_insert();

-- --- Audit score (CONFIRMED results only) ------------------------
-- Weighted: compliant = 1.0, partial = 0.5, non_compliant = 0, N/A excluded.
-- Unreviewed items (status IS NULL / reviewed_at IS NULL) are excluded from the
-- denominator, so the score reflects only what a human has signed off. (brief §7)
create or replace function recompute_audit_score(p_audit uuid)
returns void language plpgsql as $$
declare v_num numeric := 0; v_den numeric := 0;
begin
  select
    coalesce(sum(case ar.status
        when 'compliant' then ci.severity_weight
        when 'partial' then ci.severity_weight * 0.5
        else 0 end), 0),
    coalesce(sum(case when ar.status in ('compliant','partial','non_compliant')
        then ci.severity_weight else 0 end), 0)
  into v_num, v_den
  from audit_results ar
  join checklist_items ci on ci.id = ar.checklist_item_id
  where ar.audit_id = p_audit
    and ar.reviewed_at is not null
    and ar.status is not null;

  update audits
     set overall_score = case when v_den = 0 then null else round(100 * v_num / v_den, 2) end
   where id = p_audit;
end $$;

create or replace function audit_results_after_write()
returns trigger language plpgsql as $$
begin
  perform recompute_audit_score(coalesce(new.audit_id, old.audit_id));
  return null;
end $$;

create trigger trg_audit_results_after_write
  after insert or update or delete on audit_results
  for each row execute function audit_results_after_write();

-- --- updated timestamps not needed elsewhere; kept minimal on purpose ---
