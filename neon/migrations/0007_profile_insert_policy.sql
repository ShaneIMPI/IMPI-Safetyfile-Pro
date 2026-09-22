-- Fix: ensure_profile() (called via neonClient.rpc(...)) fails on this
-- project's live Neon Data API with Postgres error 23502 ("null value in
-- column id of relation profiles") — auth.user_id() evaluates NULL when the
-- function is invoked through the RPC endpoint (POST /rpc/ensure_profile),
-- even though the SAME auth.user_id() reliably returns the caller's real id
-- for ordinary table reads/writes via .from() (confirmed: pre-existing
-- questionnaire_responses and documents rows were inserted successfully
-- under RLS policies keyed on auth.user_id(), and profiles.select/update
-- below already worked). This is specific to the RPC call path on this
-- Neon Auth + Data API version, not a bug in this project's SQL.
--
-- Fix: stop bootstrapping the profile row via RPC. Add a plain INSERT
-- policy instead, scoped to the caller's own id exactly the way
-- own_profile_update already is, and switch the app to a direct
-- .from('profiles').upsert(...) call (src/auth/AuthProvider.jsx). This
-- keeps the same guarantee ensure_profile() was protecting — a client can
-- never create a row for anyone but themselves, because the check itself
-- calls auth.user_id() server-side rather than trusting the row the client
-- sent — while using the .from() code path that's proven reliable here.
--
-- ensure_profile() itself is left in place (harmless, just no longer
-- called from the app) rather than dropped, in case a future SECURITY
-- DEFINER need reintroduces a reason for it.
drop policy if exists own_profile_insert on profiles;
create policy own_profile_insert on profiles
  for insert to authenticated
  with check (id = auth.user_id());
