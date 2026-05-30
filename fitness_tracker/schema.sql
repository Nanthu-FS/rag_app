-- Vital — Supabase schema. Run this in the Supabase SQL editor.
-- Single-user/local design: one profile row, logs keyed by date.

create table if not exists profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  sex         text,
  age         int,
  height_cm   numeric,
  weight_kg   numeric,
  activity    text,
  goal        text,
  metrics     jsonb,          -- computed targets (bmi, target_kcal, macros, water...)
  coach       jsonb,          -- AI summary + workouts + meal tips
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists water_logs (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references profiles(id) on delete cascade,
  log_date    date not null,
  glasses     int default 0,
  unique (profile_id, log_date)
);

create table if not exists workouts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references profiles(id) on delete cascade,
  log_date    date not null,
  name        text,
  minutes     int,
  kcal        int,
  created_at  timestamptz default now()
);

create table if not exists meals (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references profiles(id) on delete cascade,
  log_date    date not null,
  slot        text,            -- breakfast | lunch | dinner | snack
  food_name   text,
  grams       numeric,
  kcal        numeric,
  protein     numeric,
  carb        numeric,
  fat         numeric,
  created_at  timestamptz default now()
);

-- Demo-friendly RLS: enable + allow anon (single-user local app).
-- Tighten these if you ever deploy multi-user.
alter table profiles   enable row level security;
alter table water_logs enable row level security;
alter table workouts   enable row level security;
alter table meals      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','water_logs','workouts','meals'] loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;
