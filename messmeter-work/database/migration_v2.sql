-- MessMeter v2 migration: meal demand, QR tickets, feedback, surplus and compost tracking
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then create type public.ticket_status as enum ('valid','used','expired','cancelled'); end if;
  if not exists (select 1 from pg_type where typname = 'waste_type') then create type public.waste_type as enum ('plate','preparation','spoiled'); end if;
  if not exists (select 1 from pg_type where typname = 'surplus_status') then create type public.surplus_status as enum ('available','claimed','collected','expired','cancelled'); end if;
end $$;

create table if not exists public.meal_settings (
  hostel_id uuid primary key references public.hostels(id) on delete cascade,
  breakfast_open_time time not null default '18:00',
  breakfast_cutoff_time time not null default '22:00',
  lunch_open_time time not null default '06:00',
  lunch_cutoff_time time not null default '08:30',
  snacks_open_time time not null default '10:00',
  snacks_cutoff_time time not null default '14:00',
  dinner_open_time time not null default '13:00',
  dinner_cutoff_time time not null default '15:00',
  safety_buffer_pct numeric not null default 5 check (safety_buffer_pct between 0 and 25),
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_tickets (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  ticket_code text unique not null,
  qr_token text unique not null,
  status public.ticket_status not null default 'valid',
  portion public.portion_type not null default 'full',
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  expires_at timestamptz not null,
  unique(meal_id, student_id)
);

create index if not exists idx_tickets_meal on public.meal_tickets(meal_id);
create index if not exists idx_tickets_student on public.meal_tickets(student_id);

create table if not exists public.meal_feedback (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  taste integer check (taste between 1 and 5),
  quality integer check (quality between 1 and 5),
  quantity integer check (quantity between 1 and 5),
  freshness integer check (freshness between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique(meal_id, student_id)
);

create table if not exists public.food_waste_logs (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete set null,
  waste_type public.waste_type not null,
  kg numeric not null check (kg > 0),
  notes text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.food_rescue_partners (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid references public.hostels(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  whatsapp text,
  service_area text,
  verified boolean not null default false,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.surplus_offers_v2 (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid references public.meals(id) on delete set null,
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  kg numeric not null check (kg > 0),
  description text,
  available_until timestamptz not null,
  status public.surplus_status not null default 'available',
  claimed_by uuid references public.food_rescue_partners(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.compost_batches (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  batch_code text unique not null,
  started_at timestamptz not null default now(),
  input_kg numeric not null default 0 check (input_kg >= 0),
  finished_kg numeric not null default 0 check (finished_kg >= 0),
  farm_used_kg numeric not null default 0 check (farm_used_kg >= 0),
  sold_kg numeric not null default 0 check (sold_kg >= 0),
  sale_revenue numeric not null default 0 check (sale_revenue >= 0),
  status text not null default 'composting' check (status in ('composting','ready','closed')),
  notes text
);

insert into public.meal_settings (hostel_id)
select id from public.hostels
on conflict (hostel_id) do nothing;

alter table public.meal_settings enable row level security;
alter table public.meal_tickets enable row level security;
alter table public.meal_feedback enable row level security;
alter table public.food_waste_logs enable row level security;
alter table public.food_rescue_partners enable row level security;
alter table public.surplus_offers_v2 enable row level security;
alter table public.compost_batches enable row level security;

drop policy if exists "students read own tickets" on public.meal_tickets;
create policy "students read own tickets" on public.meal_tickets for select to authenticated using (student_id = auth.uid() or public.is_manager());
drop policy if exists "students read own feedback" on public.meal_feedback;
create policy "students read own feedback" on public.meal_feedback for select to authenticated using (student_id = auth.uid() or public.is_manager());
drop policy if exists "students create own feedback" on public.meal_feedback;
create policy "students create own feedback" on public.meal_feedback for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "students update own feedback" on public.meal_feedback;
create policy "students update own feedback" on public.meal_feedback for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "managers manage waste" on public.food_waste_logs;
create policy "managers manage waste" on public.food_waste_logs for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "students read rescue partners" on public.food_rescue_partners;
create policy "students read rescue partners" on public.food_rescue_partners for select to authenticated using (verified = true);
drop policy if exists "managers manage rescue partners" on public.food_rescue_partners;
create policy "managers manage rescue partners" on public.food_rescue_partners for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "students read surplus" on public.surplus_offers_v2;
create policy "students read surplus" on public.surplus_offers_v2 for select to authenticated using (true);
drop policy if exists "managers manage surplus" on public.surplus_offers_v2;
create policy "managers manage surplus" on public.surplus_offers_v2 for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "managers manage compost" on public.compost_batches;
create policy "managers manage compost" on public.compost_batches for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists "meal settings readable" on public.meal_settings;
create policy "meal settings readable" on public.meal_settings for select to authenticated using (true);
drop policy if exists "managers manage meal settings" on public.meal_settings;
create policy "managers manage meal settings" on public.meal_settings for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Keep the original surplus table usable by older builds while the v2 table is adopted.
