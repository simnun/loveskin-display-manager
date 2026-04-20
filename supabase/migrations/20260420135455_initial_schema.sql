-- displays
create table displays (
  id text primary key,
  name text not null,
  width integer default 1920,
  height integer default 1080,
  notes text,
  active boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- media
create table media (
  id text primary key,
  display_id text references displays(id) on delete cascade,
  filename text not null,
  original_name text not null,
  type text not null,
  size bigint,
  content_type text,
  uploaded_at timestamptz default now()
);

-- playlist_items (work-in-progress scaletta)
create table playlist_items (
  id uuid primary key default gen_random_uuid(),
  display_id text references displays(id) on delete cascade,
  media_id text references media(id) on delete cascade,
  position integer not null,
  duration integer default 10,
  bg_color text default '#000000'
);

-- published_items (live scaletta on TVs)
create table published_items (
  id uuid primary key default gen_random_uuid(),
  display_id text references displays(id) on delete cascade,
  media_id text references media(id) on delete cascade,
  position integer not null,
  duration integer default 10,
  bg_color text default '#000000'
);

-- RLS
alter table displays enable row level security;
alter table media enable row level security;
alter table playlist_items enable row level security;
alter table published_items enable row level security;

-- authenticated users: full access
create policy "auth full access" on displays for all to authenticated using (true) with check (true);
create policy "auth full access" on media for all to authenticated using (true) with check (true);
create policy "auth full access" on playlist_items for all to authenticated using (true) with check (true);
create policy "auth full access" on published_items for all to authenticated using (true) with check (true);

-- anon: read-only on displays, media, published_items
create policy "anon read" on displays for select to anon using (true);
create policy "anon read" on media for select to anon using (true);
create policy "anon read" on published_items for select to anon using (true);

-- updated_at trigger for displays
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger displays_updated_at
  before update on displays
  for each row execute function update_updated_at();
