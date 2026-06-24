-- LED wall control: extend `displays` with TB50 state + create command queue.
-- Idempotent so it can be rerun safely.

alter table displays add column if not exists power_state text default 'on';
alter table displays add column if not exists brightness integer default 80;
alter table displays add column if not exists schedule_on time;
alter table displays add column if not exists schedule_off time;
alter table displays add column if not exists schedule_enabled boolean default false;
alter table displays add column if not exists agent_last_seen timestamptz;
alter table displays add column if not exists agent_ip text;
alter table displays add column if not exists has_signal boolean;

create table if not exists display_commands (
  id uuid primary key default gen_random_uuid(),
  display_id text references displays(id) on delete cascade,
  command text not null,
  payload jsonb,
  status text default 'pending',
  error text,
  created_at timestamptz default now(),
  executed_at timestamptz
);

create index if not exists display_commands_pending_idx
  on display_commands (display_id, created_at)
  where status = 'pending';

alter table display_commands enable row level security;

drop policy if exists "auth full access" on display_commands;
create policy "auth full access" on display_commands
  for all to authenticated using (true) with check (true);
