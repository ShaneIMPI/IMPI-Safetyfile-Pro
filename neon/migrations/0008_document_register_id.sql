-- Delete Clients & Documents addendum: the register needs a row id to act
-- on (document_ref alone isn't enough to issue a delete). CREATE OR REPLACE
-- VIEW can only append columns at the end, not reorder/insert them, so `id`
-- goes last rather than next to document_ref.
create or replace view document_control_register as
  select
    g.document_ref,
    coalesce(g.title, dt.name)               as document_title,
    'generated'::source_type                 as source_type,
    g.revision,
    g.client_id,
    coalesce(g.prepared_by_name, '')         as prepared_by,
    coalesce(g.reviewed_by_name, '')         as reviewed_by,
    coalesce(g.approved_by_name, '')         as approved_by,
    g.status::text                           as status,
    coalesce(g.revision_date, g.generated_at::date) as doc_date,
    g.id                                      as id
  from generated_documents g
  join document_templates dt on dt.id = g.document_template_id
  union all
  select
    e.document_ref,
    coalesce(e.title, e.issuing_body, 'Evidence document'),
    'evidence'::source_type,
    null::int,
    e.client_id,
    coalesce(e.issuing_body, '')             as prepared_by,
    ''                                        as reviewed_by,
    ''                                        as approved_by,
    e.status::text,
    e.issue_date,
    e.id                                      as id
  from evidence_documents e;
