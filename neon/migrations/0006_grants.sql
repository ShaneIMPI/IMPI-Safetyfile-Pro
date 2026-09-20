-- ===========================================================================
-- IMPI SafetyFile Pro — 0006  Base table grants for the `authenticated` role
--
-- "permission denied for table X" is a DIFFERENT failure from RLS filtering
-- rows: it fires when the executing role has no base GRANT on the table at
-- all, before Postgres ever evaluates a row policy. Supabase auto-applies
-- these grants as part of its RLS tooling; that step didn't get carried into
-- 0003_rls.sql / 0005_evidence_files.sql when this project moved to Neon —
-- the policies in those files are correct (they already target `authenticated`,
-- Neon's confirmed Data API role — see DECISIONS.md addendum 2), but nothing
-- had granted that role SELECT/INSERT/UPDATE/DELETE on the underlying tables.
--
-- This does not depend on and does not replace RLS — a role can have a full
-- table grant and still see zero rows if a policy filters everything out.
-- Run this once; it's idempotent (plain GRANT statements are safe to repeat).
-- ===========================================================================

grant usage on schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','profiles','sectors','client_sectors','document_templates',
    'document_template_sectors','checklists','checklist_items','hazard_library',
    'hazard_library_sectors','method_step_library','method_step_library_sectors',
    'library_gap_flags','audits','audit_results','evidence_documents',
    'evidence_document_files','generated_documents','questionnaire_responses',
    'safety_files','document_counters'
  ] loop
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- The register is a view (security_invoker, so it still runs under the
-- caller's own RLS on the underlying tables) — but a view is its own
-- relation and needs its own SELECT grant regardless of that setting.
grant select on document_control_register to authenticated;
