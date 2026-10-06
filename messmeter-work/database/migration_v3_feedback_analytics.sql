-- MessMeter v3 migration: complete feedback, history, and forecast analytics.
-- Run after migration_v2.sql in Supabase.

alter table public.meal_feedback
  add column if not exists overall integer check (overall between 1 and 5);

create table if not exists public.meal_forecast_logs (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  meal_slot public.meal_slot not null,
  meal_date date not null,
  expected_turnout numeric not null default 0,
  actual_turnout numeric not null default 0,
  accuracy numeric not null default 0,
  learning_factor numeric not null default 1 check (learning_factor between 0.9 and 1.1),
  created_at timestamptz not null default now(),
  unique(hostel_id, meal_slot, meal_date)
);

alter table public.meal_forecast_logs enable row level security;

create policy "forecast readable by authenticated" on public.meal_forecast_logs
  for select to authenticated using (true);

create policy "forecast write by managers" on public.meal_forecast_logs
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create index if not exists idx_meal_forecast_hostel on public.meal_forecast_logs(hostel_id);
create index if not exists idx_meal_forecast_date on public.meal_forecast_logs(meal_date);

-- Keep the historical meal feedback data consistent when the UI emits overall scores.
update public.meal_feedback
set overall = coalesce(overall, 4)
where overall is null;
