-- LED wall control: extend `displays` with TB50 state + create command queue.

alter table displays add column power_state text default 'on';
alter table displays add column brightness integer default 80;
alter table displays add column schedule_on time;
alter table displays add column schedule_off time;
alter table displays add column schedule_enabled boolean default false;
alter table displays add column agent_last_seen timestamptz;
alter table displays add column agent_ip text;
alter table displays add column has_signal boolean;

create table display_commands (
  id uuid primary key default gen_random_uuid(),
  display_id text references displays(id) on delete cascade,
  command text not null,
  payload jsonb,
  status text default 'pending',
  error text,
  created_at timestamptz default now(),
  executed_at timestamptz
);

create index display_commands_pending_idx
  on display_commands (display_id, created_at)
  where status = 'pending';

alter table display_commands enable row level security;

create policy "auth full access" on display_commands
  for all to authenticated using (true) with check (true);
