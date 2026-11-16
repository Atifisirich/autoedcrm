-- AutoED CRM schema. Idempotent: safe to run on every boot.
-- Every tenant-owned table carries tenant_id; the app filters on it in every query.

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subdomain text not null unique,
  plan text not null default 'growth',
  status text not null default 'trial',
  region text not null default 'in-south',
  pack text not null default 'cbse_day',
  branding jsonb not null default '{}',
  settings jsonb not null default '{}',
  flags jsonb not null default '{}',
  onboarding jsonb not null default '{}',
  wallet_balance numeric(12,2) not null default 0,
  go_live_date date,
  created_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '{}',
  is_system boolean not null default false
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role_id uuid references roles(id),
  platform_role text,
  branch_ids jsonb not null default '[]',
  reports_to uuid,
  status text not null default 'active',
  daily_capacity int not null default 25,
  on_leave boolean not null default false,
  last_login timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  impersonator_id uuid,
  expires_at timestamptz not null
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  city text,
  address text,
  phone text,
  boards jsonb not null default '[]',
  open_hour int not null default 9,
  close_hour int not null default 18,
  visit_capacity int not null default 3,
  active boolean not null default true
);

create table if not exists academic_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  status text not null default 'open',
  is_default boolean not null default false,
  position int not null default 0
);

create table if not exists programmes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  year_id uuid not null references academic_years(id) on delete cascade,
  board text not null,
  grade text not null,
  grade_order int not null default 0,
  capacity int not null default 30,
  min_age_years numeric(4,1),
  age_cutoff date
);

create table if not exists phases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  name text not null,
  position int not null default 0
);

create table if not exists stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  phase_id uuid not null references phases(id) on delete cascade,
  name text not null,
  position int not null default 0,
  color text not null default 'slate',
  probability int not null default 0,
  sla_hours int,
  required_fields jsonb not null default '[]',
  exempt_next_action boolean not null default false,
  is_closed boolean not null default false,
  is_won boolean not null default false,
  active boolean not null default true
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null,
  name text not null,
  cost numeric(12,2) not null default 0,
  active boolean not null default true
);

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  address text,
  locality text,
  pincode text,
  home_language text,
  sibling_in_school boolean not null default false,
  heard_about text,
  inbox_status text not null default 'closed',
  created_at timestamptz not null default now()
);

create table if not exists guardians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  relation text not null default 'Parent',
  mobile text not null,
  alt_mobile text,
  email text,
  occupation text,
  is_primary boolean not null default true,
  consent jsonb not null default '{}',
  language text not null default 'English',
  unique (tenant_id, mobile)
);
create index if not exists guardians_email_idx on guardians (tenant_id, lower(email));

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  dob date,
  gender text,
  current_school text,
  current_grade text,
  special_needs text
);

create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  branch_id uuid not null references branches(id),
  year_id uuid not null references academic_years(id),
  board text,
  grade text,
  stage_id uuid not null references stages(id),
  owner_id uuid not null references users(id),
  score int not null default 0,
  engagement int not null default 0,
  temperature text,
  expected_decision date,
  closure_reason text,
  custom jsonb not null default '{}',
  tags jsonb not null default '[]',
  application_no text,
  public_token text not null default replace(gen_random_uuid()::text, '-', ''),
  reenquired boolean not null default false,
  first_response_at timestamptz,
  last_activity_at timestamptz,
  stage_entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, year_id, branch_id)
);
create index if not exists enquiries_tenant_idx on enquiries (tenant_id, year_id, branch_id, stage_id);
create index if not exists enquiries_owner_idx on enquiries (tenant_id, owner_id);

create table if not exists source_touches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid not null references enquiries(id) on delete cascade,
  source_id uuid references sources(id),
  channel text,
  source text,
  campaign text,
  utm jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  enquiry_id uuid references enquiries(id) on delete cascade,
  type text not null,
  actor_id uuid,
  outcome text,
  content text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activities_hh_idx on activities (tenant_id, household_id, created_at desc);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid references enquiries(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  type text not null default 'call_back',
  title text not null,
  due_at timestamptz not null,
  owner_id uuid not null references users(id),
  priority text not null default 'normal',
  status text not null default 'open',
  outcome text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_owner_idx on tasks (tenant_id, owner_id, status, due_at);

create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid not null references enquiries(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  branch_id uuid not null references branches(id),
  type text not null default 'campus_tour',
  slot_at timestamptz not null,
  host_id uuid references users(id),
  status text not null default 'scheduled',
  checked_in_at timestamptz,
  outcome text,
  created_at timestamptz not null default now()
);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid not null unique references enquiries(id) on delete cascade,
  progress int not null default 0,
  answers jsonb not null default '{}',
  declaration boolean not null default false,
  status text not null default 'started',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid not null references enquiries(id) on delete cascade,
  type text not null,
  status text not null default 'pending',
  file_name text,
  reject_reason text,
  verifier_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid not null references enquiries(id) on delete cascade,
  purpose text not null,
  amount numeric(12,2) not null,
  mode text not null default 'link',
  reference text,
  status text not null default 'pending',
  receipt_no text,
  verified_by uuid,
  token text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null,
  name text not null,
  language text not null default 'English',
  category text not null default 'utility',
  body text not null,
  status text not null default 'approved'
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  channel text not null,
  template_id uuid references templates(id),
  audience jsonb not null default '{}',
  status text not null default 'draft',
  stats jsonb not null default '{}',
  cost numeric(12,2) not null default 0,
  created_by uuid,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  enquiry_id uuid references enquiries(id) on delete set null,
  channel text not null,
  direction text not null,
  body text not null,
  status text not null default 'sent',
  fail_reason text,
  campaign_id uuid,
  sender_id uuid,
  is_note boolean not null default false,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_hh_idx on messages (tenant_id, household_id, created_at);

create table if not exists workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recipe_key text,
  name text not null,
  description text,
  trigger text not null,
  conditions jsonb not null default '[]',
  steps jsonb not null default '[]',
  status text not null default 'draft',
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  enquiry_id uuid references enquiries(id) on delete cascade,
  status text not null default 'running',
  entry_stage_id uuid,
  log jsonb not null default '[]',
  test boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_at timestamptz not null,
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued',
  result text,
  created_at timestamptz not null default now()
);

create table if not exists custom_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity text not null default 'enquiry',
  key text not null,
  label text not null,
  type text not null default 'text',
  options jsonb not null default '[]',
  required boolean not null default false,
  sensitive boolean not null default false,
  active boolean not null default true,
  position int not null default 0,
  unique (tenant_id, entity, key)
);

create table if not exists assignment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  position int not null default 0,
  conditions jsonb not null default '{}',
  method text not null default 'round_robin',
  user_ids jsonb not null default '[]',
  pointer int not null default 0,
  active boolean not null default true
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  user_name text,
  action text not null,
  entity text,
  entity_id text,
  summary text,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists audit_idx on audit_events (tenant_id, created_at desc);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  category text not null,
  title text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  shared boolean not null default false,
  query text not null
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  source_id uuid references sources(id),
  last_used timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  url text not null,
  secret text not null,
  events jsonb not null default '[]',
  active boolean not null default true,
  last_status text,
  created_at timestamptz not null default now()
);

create table if not exists wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null,
  category text not null,
  amount numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  file_name text,
  total int not null default 0,
  created int not null default 0,
  duplicates int not null default 0,
  failed int not null default 0,
  status text not null default 'done',
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  batch_id uuid not null references import_batches(id) on delete cascade,
  data jsonb not null,
  status text not null,
  error text,
  match_household_id uuid,
  enquiry_id uuid
);

create table if not exists forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  slug text not null unique,
  name text not null,
  branch_id uuid references branches(id),
  source_id uuid references sources(id),
  fields jsonb not null default '[]',
  thank_you text not null default 'Thank you. Our admissions team will call you shortly.',
  active boolean not null default true,
  submissions int not null default 0
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid,
  kind text not null default 'ticket',
  subject text not null,
  body text,
  status text not null default 'open',
  priority text not null default 'normal',
  reply text,
  created_at timestamptz not null default now()
);

create table if not exists support_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by uuid not null,
  reason text,
  status text not null default 'requested',
  approved_by uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Additions after first release (each statement must stay idempotent) ----------

-- Secrets per tenant (provider tokens), encrypted by the app with APP_SECRET.
create table if not exists tenant_secrets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  value_enc text not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
alter table tenants add column if not exists webhook_key text;
alter table tenants alter column webhook_key set default replace(gen_random_uuid()::text, '-', '');
update tenants set webhook_key = replace(gen_random_uuid()::text, '-', '') where webhook_key is null;
create unique index if not exists tenants_webhook_key_idx on tenants (webhook_key);

alter table messages add column if not exists provider_id text;
alter table messages add column if not exists delivered_at timestamptz;
alter table messages add column if not exists read_at timestamptz;
create index if not exists messages_provider_idx on messages (provider_id);

alter table templates add column if not exists meta_name text;
alter table templates add column if not exists meta_status text;
alter table templates add column if not exists meta_vars jsonb not null default '[]';
alter table templates add column if not exists meta_reason text;

-- Leads received from Meta lead ads, kept so a retried webhook never creates a second enquiry.
create table if not exists meta_leads (
  leadgen_id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  enquiry_id uuid,
  status text not null,
  detail text,
  created_at timestamptz not null default now()
);

-- When hosted on Supabase the public schema is reachable through the auto-generated API.
-- The app talks to Postgres directly, so lock every table it owns down for API roles.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = current_schema() and tableowner = current_user loop
    execute format('alter table %I.%I enable row level security', current_schema(), t.tablename);
  end loop;
end $$;
