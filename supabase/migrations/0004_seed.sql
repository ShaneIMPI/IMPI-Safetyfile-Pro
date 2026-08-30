-- ===========================================================================
-- IMPI SafetyFile Pro — 0004 seed (Section 6 catalogue)
-- Idempotent: the whole block is skipped once `sectors` has any row.
-- Regulation references use SA OHS Act 85/1993 and its regulations + relevant SANS.
-- ===========================================================================

do $$
declare
  s_events uuid; s_constr uuid; s_wh uuid; s_factory uuid;
  cl_events uuid; cl_constr uuid; cl_wh uuid; cl_factory uuid;
  cl uuid;
  h uuid;
begin
  if exists (select 1 from sectors limit 1) then
    raise notice 'IMPI seed: sectors already present, skipping seed.';
    return;
  end if;

  -- ---------------------------------------------------------------- Sectors
  insert into sectors (name, description) values
    ('Events — Contractor Safety Files',
     'Contractor safety files for event trades: riggers, exhibition stand builders, stage crews, tent/marquee crews, temporary event fencing. Grounded in SANS 10366. NOT event-organiser / JOC documents.')
    returning id into s_events;
  insert into sectors (name, description) values
    ('Construction',
     'Construction Regulations 2014 safety files: H&S plan, s37(2) mandatary agreement, appointments, fall protection, inspections.')
    returning id into s_constr;
  insert into sectors (name, description) values
    ('Warehousing / Logistics',
     'Warehouse and distribution safety files: MHE operator control, pedestrian/vehicle separation, racking inspection, dock safety.')
    returning id into s_wh;
  insert into sectors (name, description) values
    ('Factories / Manufacturing',
     'Manufacturing safety files: GMR appointments, machine-specific risk assessments, LOTO, HCS/SDS, permit-to-work, guarding.')
    returning id into s_factory;

  -- ------------------------------------------------------- Document templates
  -- Generated (IMPI-authored).
  insert into document_templates (name, type_code, source_type, description, questionnaire_schema) values
    ('OHS Policy Statement', 'POL', 'generated',
     'Signed occupational health & safety policy statement on client letterhead.',
     '[{"key":"ceo_name","label":"CEO / accountable person","type":"text","required":true},
       {"key":"policy_date","label":"Policy date","type":"date","required":true},
       {"key":"review_cycle","label":"Review cycle","type":"select","options":["Annual","Biennial"],"default":"Annual"}]'),

    ('Legal Appointments Register', 'LAR', 'generated',
     'Register of statutory appointments (16.1/16.2, SHE Rep, First Aiders, Fire Fighters, Incident Investigator, GMR 2.1 where applicable).',
     '[{"key":"ceo_16_1","label":"16.1 Assignee (CEO / top management)","type":"text","required":true},
       {"key":"appointees","label":"Appointees","type":"repeater","fields":[
          {"key":"name","label":"Name","type":"text"},
          {"key":"role","label":"Appointment","type":"select","options":["16.2 Assignee","SHE Representative","First Aider","Fire Fighter","Incident Investigator","GMR 2.1 Supervisor","GMR 2.7a","Construction Supervisor (CR 8.1)","Fall Protection Plan Developer"]},
          {"key":"effective_date","label":"Effective date","type":"date"}]}]'),

    ('General / Baseline Risk Assessment', 'RA', 'generated',
     'Baseline or activity-specific risk assessment. A x B x C x D = R register assembled from the hazard library filtered by sector + activities.',
     '[{"key":"assessment_type","label":"Assessment type","type":"select","options":["Baseline","Activity-specific"],"required":true},
       {"key":"activities","label":"Activities / tasks in scope","type":"multiselect_dynamic","source":"hazard_library.activity","required":true},
       {"key":"site_description","label":"Site description","type":"textarea"},
       {"key":"assessor_name","label":"Assessor","type":"text","required":true},
       {"key":"assessment_date","label":"Assessment date","type":"date","required":true}]'),

    ('Method Statement', 'MS', 'generated',
     'Safe work method statement for a specific activity. Steps assembled from the method-step library filtered by activity type.',
     '[{"key":"activity_type","label":"Activity","type":"select_dynamic","source":"method_step_library.activity_type","required":true},
       {"key":"scope","label":"Scope of work","type":"textarea","required":true},
       {"key":"supervisor","label":"Responsible supervisor","type":"text","required":true},
       {"key":"plant_equipment","label":"Plant & equipment","type":"textarea"},
       {"key":"ppe","label":"PPE required","type":"textarea"}]'),

    ('Emergency Plan', 'EMP', 'generated',
     'Site emergency plan: scenarios, evacuation, assembly points, emergency contacts, roles.',
     '[{"key":"assembly_point","label":"Primary assembly point","type":"text","required":true},
       {"key":"nearest_hospital","label":"Nearest hospital","type":"text"},
       {"key":"site_contacts","label":"Emergency contacts","type":"repeater","fields":[
          {"key":"role","label":"Role","type":"text"},{"key":"name","label":"Name","type":"text"},{"key":"phone","label":"Phone","type":"text"}]}]'),

    ('Fall Protection Plan', 'FPP', 'generated',
     'Fall protection plan for work at height (Construction Reg 10 / GSR 13A).',
     '[{"key":"competent_person","label":"Fall Protection Plan developer","type":"text","required":true},
       {"key":"work_at_height_tasks","label":"Work-at-height tasks","type":"textarea","required":true},
       {"key":"rescue_plan","label":"Rescue plan summary","type":"textarea","required":true}]'),

    ('PPE Policy & Issue Register', 'PPE', 'generated',
     'PPE policy plus issue register template (GSR 2, Construction Reg 9).',
     '[{"key":"ppe_matrix","label":"Role / PPE matrix","type":"repeater","fields":[
          {"key":"role","label":"Role","type":"text"},{"key":"ppe","label":"PPE items","type":"text"}]}]'),

    ('Construction Health & Safety Plan', 'CHSP', 'generated',
     'Construction Regulations 2014 site-specific H&S plan.',
     '[{"key":"principal_contractor","label":"Principal contractor","type":"text","required":true},
       {"key":"client_agent","label":"Client / agent","type":"text"},
       {"key":"project_scope","label":"Project scope","type":"textarea","required":true},
       {"key":"high_risk_work","label":"High-risk construction work present","type":"multiselect","options":["Excavations","Work at height","Structures","Demolition","Scaffolding","Cranes / lifting","Confined space","Hot work"]}]'),

    ('Section 37(2) Mandatary Agreement', 'S372', 'generated',
     'Agreement between employer/client and mandatary per OHS Act s37(2).',
     '[{"key":"mandatary","label":"Mandatary (contractor)","type":"text","required":true},
       {"key":"client_party","label":"Client / employer party","type":"text","required":true},
       {"key":"scope","label":"Scope covered","type":"textarea","required":true},
       {"key":"agreement_date","label":"Agreement date","type":"date","required":true}]'),

    ('Audit Report', 'AUD', 'generated',
     'Safety file audit report: compliance status per checklist item with category scoring and regulation references. Generated from an audit record.',
     '[]');

  -- Evidence (third-party issued; IMPI files, never authors). Catalogue codes are
  -- descriptive; evidence numbering always uses the EVD sequence (see 0002).
  insert into document_templates (name, type_code, source_type, description, questionnaire_schema) values
    ('Structural Engineer''s Certificate & Calculations', 'ENGCERT', 'evidence',
     'Engineer''s certificate + calculations for temporary demountable structures (SANS 10366 / SANS 10085). Third-party issued.', '[]'),
    ('Trade Competency Certificate', 'COMPCERT', 'evidence',
     'Rigger tickets, forklift / crane operator, working-at-height, first aid, etc. Third-party issued.', '[]'),
    ('Letter of Good Standing (COIDA)', 'LOGS', 'evidence',
     'Compensation Fund / licensed insurer letter of good standing. Third-party issued.', '[]'),
    ('Tax Clearance / Tax Compliance Status', 'TAX', 'evidence',
     'SARS tax compliance status PIN / certificate. Third-party issued.', '[]'),
    ('Public Liability Insurance', 'PLI', 'evidence',
     'Public liability insurance schedule / certificate. Third-party issued.', '[]'),
    ('Electrical Certificate of Compliance', 'COC', 'evidence',
     'Electrical CoC per Electrical Installation Regulations. Third-party issued by a registered person.', '[]'),
    ('Racking Inspection Report', 'RACK', 'evidence',
     'Annual racking inspection by a competent inspector (SEMA / SARI). Insurance / best-practice driven.', '[]'),
    ('MHE / Machinery Load Test & Inspection', 'LOADTEST', 'evidence',
     'Lifting equipment / MHE load test and inspection certificate (DMR 18). Third-party issued.', '[]');

  -- All universal + generated templates apply to every sector; specific ones tagged below.
  insert into document_template_sectors (document_template_id, sector_id)
  select dt.id, s.id
  from document_templates dt
  cross join sectors s
  where dt.type_code in ('POL','LAR','RA','MS','EMP','PPE','AUD','LOGS','TAX','PLI','COMPCERT')
  on conflict do nothing;

  insert into document_template_sectors (document_template_id, sector_id)
  select dt.id, x.sid from document_templates dt
  join (values
    ('FPP', s_events),('FPP', s_constr),('FPP', s_factory),
    ('CHSP', s_constr),('S372', s_constr),
    ('ENGCERT', s_events),
    ('COC', s_events),('COC', s_constr),('COC', s_factory),('COC', s_wh),
    ('RACK', s_wh),('LOADTEST', s_wh),('LOADTEST', s_events),('LOADTEST', s_factory)
  ) as x(code, sid) on x.code = dt.type_code
  on conflict do nothing;

  -- ------------------------------------------------------------- Checklists
  insert into checklists (sector_id, name, description) values
    (s_events, 'Events Contractor Safety File — Audit Checklist', 'SANS 10366-aligned contractor safety file checklist.')
    returning id into cl_events;
  insert into checklists (sector_id, name, description) values
    (s_constr, 'Construction Safety File — Audit Checklist', 'Construction Regulations 2014 safety file checklist.')
    returning id into cl_constr;
  insert into checklists (sector_id, name, description) values
    (s_wh, 'Warehousing / Logistics Safety File — Audit Checklist', 'Warehouse & distribution safety file checklist.')
    returning id into cl_wh;
  insert into checklists (sector_id, name, description) values
    (s_factory, 'Factory / Manufacturing Safety File — Audit Checklist', 'Manufacturing safety file checklist.')
    returning id into cl_factory;

  -- --------------------------------------- Universal baseline items (every checklist)
  foreach cl in array array[cl_events, cl_constr, cl_wh, cl_factory] loop
    insert into checklist_items (checklist_id, category, item_text, required_document_type_id, source_type, severity_weight, regulation_reference, sort_order) values
    (cl,'Policy','Signed OHS Policy Statement (current, on letterhead)', (select id from document_templates where type_code='POL'),'generated',4,'OHS Act s7; GAR 4',10),
    (cl,'Legal Appointments','Legal Appointments Register — 16.1/16.2 assignees', (select id from document_templates where type_code='LAR'),'generated',5,'OHS Act s16(1)/16(2); GAR 2',20),
    (cl,'Legal Appointments','SHE Representative(s) appointed and trained', (select id from document_templates where type_code='LAR'),'generated',3,'OHS Act s17; GAR 6-7',30),
    (cl,'Legal Appointments','First Aider(s) appointed; valid certificates on file', (select id from document_templates where type_code='COMPCERT'),'evidence',4,'GSR 3(4)',40),
    (cl,'Emergency Preparedness','First aid provision: stocked box(es) and register', null,'generated',3,'GSR 3',50),
    (cl,'Risk Management','General / Baseline Risk Assessment (current, signed)', (select id from document_templates where type_code='RA'),'generated',5,'OHS Act s8; GAR 5; Construction Reg 9',60),
    (cl,'Emergency Preparedness','Emergency Plan (scenarios, evacuation, assembly, contacts)', (select id from document_templates where type_code='EMP'),'generated',4,'GSR 3; Construction Reg 29; SANS 10400-T',70),
    (cl,'Incident Management','Incident / Injury Register (COIDA WCl.2 / Annexure 1)', null,'evidence',3,'COID Act 130/1993 s39',80),
    (cl,'Training','Training & Induction records (site induction, toolbox talks)', null,'generated',3,'OHS Act s8(2)(e); Construction Reg 7',90),
    (cl,'PPE','PPE Policy & Issue Register', (select id from document_templates where type_code='PPE'),'generated',3,'GSR 2; Construction Reg 9',100),
    (cl,'Legal','Legal Register / list of applicable legislation', null,'generated',2,'OHS Act s8',110),
    (cl,'Consultation','SHE Committee minutes / communication register', null,'generated',2,'OHS Act s19-20',120),
    (cl,'Financial / Statutory','Letter of Good Standing (COIDA) — valid', (select id from document_templates where type_code='LOGS'),'evidence',5,'COID Act 130/1993 s80',130),
    (cl,'Financial / Statutory','Tax Clearance / Tax Compliance Status — valid', (select id from document_templates where type_code='TAX'),'evidence',2,'Tax Administration Act',140),
    (cl,'Financial / Statutory','Public Liability Insurance — current schedule', (select id from document_templates where type_code='PLI'),'evidence',3,'Contractual / common law',150);
  end loop;

  -- --------------------------------------------------- Events-specific items
  insert into checklist_items (checklist_id, category, item_text, required_document_type_id, source_type, severity_weight, regulation_reference, sort_order) values
  (cl_events,'Contractor Documents','Contractor H&S Policy Statement', (select id from document_templates where type_code='POL'),'generated',3,'SANS 10366 cl.5; OHS Act s7',200),
  (cl_events,'Risk Management','Activity-specific Risk Assessment (rigging / stand build / stage / tent / fencing)', (select id from document_templates where type_code='RA'),'generated',5,'SANS 10366; GAR 5',210),
  (cl_events,'Method Statements','Method Statement for the specific activity', (select id from document_templates where type_code='MS'),'generated',4,'SANS 10366 cl.7',220),
  (cl_events,'Structures','Structural Engineer''s Certificate & Calculations (temporary demountable structures)', (select id from document_templates where type_code='ENGCERT'),'evidence',5,'SANS 10366; SANS 10085; SANS 10400',230),
  (cl_events,'Legal Appointments','On-site appointments: Site Supervisor and certified Rigging Foreman', (select id from document_templates where type_code='LAR'),'generated',4,'OHS Act s16(2); GSR',240),
  (cl_events,'Competency','Trade competency certificates (rigger tickets, forklift/crane operator, work-at-height)', (select id from document_templates where type_code='COMPCERT'),'evidence',5,'DMR 18; GSR 13A; SANS 10366',250),
  (cl_events,'Lifting','Lifting equipment pre-use inspection register', null,'generated',4,'DMR 18',260),
  (cl_events,'Work at Height','Fall Protection Plan', (select id from document_templates where type_code='FPP'),'generated',5,'GSR 13A; Construction Reg 10',270),
  (cl_events,'Lifting','Lifting equipment load-test / inspection certificates', (select id from document_templates where type_code='LOADTEST'),'evidence',4,'DMR 18',280),
  (cl_events,'Training','Toolbox talk / site induction records (crew-specific)', null,'generated',2,'Construction Reg 7; SANS 10366',290);

  -- ----------------------------------------------- Construction-specific items
  insert into checklist_items (checklist_id, category, item_text, required_document_type_id, source_type, severity_weight, regulation_reference, sort_order) values
  (cl_constr,'Plan','Construction Health & Safety Plan (site-specific)', (select id from document_templates where type_code='CHSP'),'generated',5,'Construction Reg 7',200),
  (cl_constr,'Legal Appointments','Section 37(2) Mandatary Agreement', (select id from document_templates where type_code='S372'),'generated',5,'OHS Act s37(2)',210),
  (cl_constr,'Legal Appointments','Site HSE organogram & construction appointments (CR 8.1, 8.7, supervisors)', (select id from document_templates where type_code='LAR'),'generated',4,'Construction Reg 8',220),
  (cl_constr,'Work at Height','Fall Protection Plan (competent person)', (select id from document_templates where type_code='FPP'),'generated',5,'Construction Reg 10',230),
  (cl_constr,'Emergency Preparedness','Site-specific Emergency Plan', (select id from document_templates where type_code='EMP'),'generated',4,'Construction Reg 29',240),
  (cl_constr,'Inspections','Daily / weekly / monthly inspection checklists; plant & tool registers', null,'generated',3,'Construction Reg 3(5); DMR',250),
  (cl_constr,'Training','Toolbox talk & site induction records', null,'generated',2,'Construction Reg 7',260),
  (cl_constr,'Site Management','Site Rules document', null,'generated',2,'Construction Reg 5(1)(l)',270),
  (cl_constr,'Electrical','Electrical Certificate of Compliance (temporary / permanent installation)', (select id from document_templates where type_code='COC'),'evidence',4,'Electrical Installation Regulations 7',280);

  -- ------------------------------------------- Warehousing-specific items
  insert into checklist_items (checklist_id, category, item_text, required_document_type_id, source_type, severity_weight, regulation_reference, sort_order) values
  (cl_wh,'Machinery','Forklift / driven-machinery operator certification register', (select id from document_templates where type_code='COMPCERT'),'evidence',5,'DMR 18',200),
  (cl_wh,'Traffic Management','Pedestrian / vehicle traffic separation plan', null,'generated',4,'GSR 8; DMR',210),
  (cl_wh,'Signage','Warehouse safety signage register (SANS 1186)', null,'generated',2,'GSR 8; SANS 1186',220),
  (cl_wh,'Storage','Racking inspection report (SEMA / SARI competent inspector)', (select id from document_templates where type_code='RACK'),'evidence',4,'GSR 8; SANS 10366 (best practice)',230),
  (cl_wh,'Procedures','Loading dock safety procedure', (select id from document_templates where type_code='MS'),'generated',3,'GSR 8',240),
  (cl_wh,'Risk Management','Warehouse-specific Risk Assessment', (select id from document_templates where type_code='RA'),'generated',5,'GAR 5',250),
  (cl_wh,'Machinery','MHE load test & inspection certificates', (select id from document_templates where type_code='LOADTEST'),'evidence',4,'DMR 18',260),
  (cl_wh,'Electrical','Electrical Certificate of Compliance', (select id from document_templates where type_code='COC'),'evidence',3,'Electrical Installation Regulations 7',270);

  -- ------------------------------------------- Factory-specific items
  insert into checklist_items (checklist_id, category, item_text, required_document_type_id, source_type, severity_weight, regulation_reference, sort_order) values
  (cl_factory,'Legal Appointments','GMR 2.1 Machinery Supervisor appointment', (select id from document_templates where type_code='LAR'),'generated',5,'General Machinery Regulations 2(1)',200),
  (cl_factory,'Legal Appointments','GMR 2.7(a) appointment (competent person, where applicable)', (select id from document_templates where type_code='LAR'),'generated',3,'General Machinery Regulations 2(7)(a)',210),
  (cl_factory,'Risk Management','Machine-specific risk assessments', (select id from document_templates where type_code='RA'),'generated',5,'GAR 5; GSR 2A',220),
  (cl_factory,'Energy Control','Lock-out / Tag-out procedure', (select id from document_templates where type_code='MS'),'generated',5,'GMR 3; GSR 2A',230),
  (cl_factory,'Hazardous Substances','Hazardous Chemical Substances register / SDS file', null,'evidence',4,'HCS Regulations 2021 (Reg for Hazardous Chemical Agents)',240),
  (cl_factory,'Permit to Work','Permit-to-work system (hot work, confined space)', (select id from document_templates where type_code='MS'),'generated',4,'GSR 5; DMR; ERW',250),
  (cl_factory,'Guarding','Machine guarding inspection checklist', null,'generated',4,'GMR 3; GSR 2A',260),
  (cl_factory,'Maintenance','Planned maintenance / PPM schedule register', null,'generated',2,'GMR 3; DMR',270),
  (cl_factory,'Electrical','Electrical Certificate of Compliance', (select id from document_templates where type_code='COC'),'evidence',4,'Electrical Installation Regulations 7',280);

  -- ================================================= Hazard library
  -- Universal
  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Manual handling','Musculoskeletal injury from lifting/carrying','Workers','Team lifting for >25kg; mechanical aids; training in kinetic handling; limit carry distances.',3,3,2,1,'Ergonomics Regulations 2019')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) select h, id from sectors;

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Housekeeping / access','Slips, trips and falls on the same level','Workers, visitors','Designated walkways; cable management; spill response; adequate lighting; keep routes clear.',3,3,2,1,'GSR 2; Facilities Regulations')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) select h, id from sectors;

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Use of hand & portable power tools','Cuts, entanglement, electric shock','Workers','Pre-use inspection; guards in place; correct tool for task; RCD-protected supply; competent operators; PPE.',3,3,3,1,'GSR 2A; DMR; Electrical Machinery Regs')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) select h, id from sectors;

  -- Events
  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Rigging & work at height','Fall from height / dropped objects','Riggers, crew, public below','Fall protection plan; certified riggers; twin-lanyard 100% tie-off; exclusion zones; tool tethers; engineer-approved rig plot.',4,4,4,2,'GSR 13A; SANS 10366; DMR 18')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_events);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Temporary demountable structure erection','Structural collapse of stage / tent / stand','Crew, performers, public','Engineer certificate & calculations; wind-management plan with load-out triggers; ballast/anchoring per design; competent build crew; sign-off before occupation.',5,5,5,3,'SANS 10366; SANS 10085; SANS 10400')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_events);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Motor / chain hoist operation','Load drop / crush from mechanical failure','Crew below load','Rated & load-tested hoists (DMR 18 certificates); secondary safety (steel); pull-test; no persons under suspended loads; competent operators.',4,4,4,2,'DMR 18; SANS 10366')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_events);

  -- Construction
  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Work on scaffold / edge','Fall from height','Workers','Fall protection plan; inspected scaffold with handover certificate; edge protection; harness + anchor where guardrails not feasible; competent scaffold erector.',4,4,4,2,'Construction Reg 10 & 16')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_constr);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Excavation','Collapse / engulfment; strike on services','Workers in trench','Permit; shoring/battering/benching per competent person; located services (dial-before-dig); barricading; safe access; daily inspection.',4,4,5,2,'Construction Reg 13')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_constr);

  -- Warehouse
  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Forklift operation in shared aisles','Pedestrian struck by MHE','Pedestrians, operators','Segregated walkways & barriers; give-way rules; speed limits; blue-spot/alarms; hi-vis; licensed operators; daily checklists.',4,4,4,2,'DMR 18; GSR 8')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_wh);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Racking storage','Racking collapse / falling stock','Workers near racking','Load notices & SWL; annual SEMA/SARI inspection; rack-leg protectors; damage reporting & quarantine; no overloading; competent installer.',3,4,4,2,'GSR 8; SANS 10366 (best practice)')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_wh);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Loading / offloading at dock','Trailer creep / fall from dock edge','Workers, drivers','Wheel chocks & trailer restraint; dock-lock interlock; edge protection & barriers; traffic-light control; exclusion during reversing.',3,4,3,2,'GSR 8; DMR')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_wh);

  -- Factory
  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Operating fixed production machinery','Entanglement / amputation at in-running nips','Operators, cleaners','Fixed & interlocked guarding; LOTO for setting/cleaning/maintenance; two-hand controls where relevant; GMR 2.1 supervision; competency training.',4,4,5,2,'GMR 2 & 3; GSR 2A')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_factory);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Handling hazardous chemical substances','Exposure — inhalation / skin / eye injury','Workers','SDS file & register; substitution where possible; LEV & ventilation; compatible storage & bunding; PPE per SDS; medical surveillance; spill kit & training.',3,4,4,2,'HCS Regulations 2021')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_factory);

  insert into hazard_library (activity, hazard, who_may_be_harmed, standard_controls, default_a, default_b, default_c, default_d, regulation_reference) values
  ('Hot work / confined space entry','Fire / explosion / asphyxiation','Workers, standby','Permit-to-work; gas testing & continuous monitoring; ventilation; standby person & rescue plan; fire watch 30 min post-work; isolation.',4,4,5,2,'GSR 5; DMR; ERW')
  returning id into h;
  insert into hazard_library_sectors (hazard_library_id, sector_id) values (h, s_factory);

  -- ================================================= Method-step library
  insert into method_step_library (activity_type, step_description, key_hazards_controls, responsible_role_default, sort_hint) values
  ('Site establishment','Confirm scope, permits and authority to access; conduct site induction for all crew; establish welfare, first aid and emergency arrangements.','Unauthorised access; unfamiliar hazards — induction, sign-in register, permits.','Site Supervisor',10),
  ('Site establishment','Demarcate work area and exclusion zones; erect barriers and signage; brief adjacent parties.','Public / other trades entering work zone — barricading, signage, communication.','Site Supervisor',20),
  ('Rigging (event)','Survey venue and confirm rig plot against structural drawings and engineer''s certificate; inspect all rigging hardware and hoists (with valid load-test certificates).','Overload / uncertified equipment — engineer sign-off, DMR 18 certificates, pre-use inspection.','Rigging Foreman',30),
  ('Rigging (event)','Install ground-supported or flown structure per design; competent riggers on 100% tie-off; no persons beneath suspended loads; independent safety on motors.','Fall from height; dropped load — fall protection plan, exclusion zones, secondary safeties.','Rigging Foreman',40),
  ('Rigging (event)','Proof-load / function-test; complete rig sign-off checklist; hand over to production only after competent-person inspection.','Undetected defect — documented inspection & sign-off before use.','Rigging Foreman',50),
  ('Work at height','Confirm fall protection plan; select anchor points; inspect harnesses and lanyards; establish rescue plan and equipment on site.','Fall; suspension trauma — twin lanyard, rated anchors, prompt rescue capability.','Fall Protection Plan Developer',30),
  ('Lifting operation','Appoint lifting team; confirm load weight, path and SWL of equipment; exclude the lift zone; use tag lines; competent operator and banksman.','Load drop; struck-by — exclusion zone, rated gear, competent team, no personnel under load.','Lifting Supervisor',30),
  ('Lock-out / Tag-out','Identify all energy sources; shut down; isolate and lock each source; dissipate stored energy; verify zero energy before work.','Unexpected start-up; stored energy — personal locks, tags, try-out test.','GMR 2.1 Supervisor',30),
  ('Lock-out / Tag-out','On completion: clear tools and personnel, remove locks in reverse order by each holder only, restore energy and function-test guards.','Premature re-energisation — each worker removes own lock, controlled restart.','GMR 2.1 Supervisor',40),
  ('Loading / offloading (warehouse)','Position vehicle; apply brakes, chocks and trailer restraint / dock lock; confirm dock-leveller condition; control pedestrian access during operation.','Trailer creep; fall from edge; pedestrian struck — restraint, edge protection, exclusion.','Warehouse Supervisor',30),
  ('Demobilisation','Remove waste and materials; inspect area for damage/hazards left behind; restore barriers; sign off area as safe and hand back.','Residual hazards; slips/trips — housekeeping, final inspection, handover record.','Site Supervisor',90);

  -- Tag method steps to sectors. Universal activity types go to every sector;
  -- the rest are sector-specific. 'Work at height' / 'Lifting operation' are
  -- universal, so they are NOT re-added per sector below.
  insert into method_step_library_sectors (method_step_library_id, sector_id)
  select m.id, s.id from method_step_library m cross join sectors s
  where m.activity_type in ('Site establishment','Work at height','Lifting operation','Demobilisation')
  on conflict do nothing;
  insert into method_step_library_sectors (method_step_library_id, sector_id)
  select m.id, s_events from method_step_library m where m.activity_type = 'Rigging (event)'
  on conflict do nothing;
  insert into method_step_library_sectors (method_step_library_id, sector_id)
  select m.id, s_factory from method_step_library m where m.activity_type = 'Lock-out / Tag-out'
  on conflict do nothing;
  insert into method_step_library_sectors (method_step_library_id, sector_id)
  select m.id, s_wh from method_step_library m where m.activity_type = 'Loading / offloading (warehouse)'
  on conflict do nothing;

  raise notice 'IMPI seed: complete.';
end $$;
