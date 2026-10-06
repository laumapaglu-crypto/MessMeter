create extension if not exists pgcrypto;

create type public.diet_type as enum ('Veg','Non-veg');
create type public.account_status as enum ('pending','approved','rejected');
create type public.user_role as enum ('student','mess_manager','warden','campus_admin');
create type public.meal_slot as enum ('breakfast','lunch','snacks','dinner');
create type public.meal_status as enum ('planned','rsvp_open','cooking','served');
create type public.rsvp_response as enum ('eating','skipping');
create type public.portion_type as enum ('full','half');

create table if not exists public.hostels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  strength integer not null default 0 check (strength >= 0),
  type text not null check (type in ('boys','girls','pg'))
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  roll_no text unique not null,
  email text not null,
  hostel_id uuid references public.hostels(id),
  floor text,
  room text,
  phone text,
  diet public.diet_type not null default 'Veg',
  language text not null default 'English' check (language in ('English','Hindi')),
  status public.account_status not null default 'pending',
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid references auth.users(id) on delete cascade,
  role public.user_role not null default 'student',
  primary key(user_id, role)
);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  weekday integer not null check (weekday between 0 and 6),
  slot public.meal_slot not null,
  main_dish text not null,
  full_text text not null,
  options text[] not null default '{}',
  nonveg_item text,
  popularity numeric not null default 60 check (popularity between 0 and 100),
  cost_per_plate numeric not null default 0
);

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  hostel_id uuid not null references public.hostels(id) on delete cascade,
  meal_date date not null,
  slot public.meal_slot not null,
  menu_item_id uuid references public.menu_items(id),
  status public.meal_status not null default 'planned',
  cooked integer not null default 0 check (cooked >= 0),
  served integer not null default 0 check (served >= 0),
  leftover_kg numeric not null default 0 check (leftover_kg >= 0),
  predicted_plates integer not null default 0 check (predicted_plates >= 0),
  notes text,
  unique(hostel_id, meal_date, slot)
);

create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  response public.rsvp_response not null,
  portion public.portion_type not null default 'full',
  option text,
  rating text check (rating in ('liked','disliked')),
  updated_at timestamptz not null default now(),
  unique(meal_id, student_id)
);

create index if not exists idx_meals_date on public.meals(meal_date);
create index if not exists idx_rsvps_meal on public.rsvps(meal_id);
create index if not exists idx_rsvps_student on public.rsvps(student_id);

create or replace function public.has_role(required_role public.user_role)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required_role
  );
$$;

create or replace function public.is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('mess_manager','campus_admin')
  );
$$;

alter table public.hostels enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.menu_items enable row level security;
alter table public.meals enable row level security;
alter table public.rsvps enable row level security;

create policy "hostels readable by authenticated"
on public.hostels for select to authenticated using (true);

create policy "own profile read"
on public.profiles for select to authenticated using (id = auth.uid() or public.is_manager());

create policy "own profile update"
on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "manager profile access"
on public.profiles for all to authenticated
using (public.is_manager())
with check (public.is_manager());

create policy "roles visible to self or manager"
on public.user_roles for select to authenticated
using (user_id = auth.uid() or public.is_manager());

create policy "menu readable"
on public.menu_items for select to authenticated using (true);

create policy "manager menu write"
on public.menu_items for all to authenticated
using (public.is_manager())
with check (public.is_manager());

create policy "meals readable"
on public.meals for select to authenticated using (
  hostel_id = (select hostel_id from public.profiles where id = auth.uid())
  or public.is_manager()
);

create policy "manager meals write"
on public.meals for all to authenticated
using (public.is_manager())
with check (public.is_manager());

create policy "own rsvp"
on public.rsvps for select to authenticated using (student_id = auth.uid() or public.is_manager());

create policy "own rsvp insert"
on public.rsvps for insert to authenticated with check (student_id = auth.uid());

create policy "own rsvp update"
on public.rsvps for update to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

create policy "manager rsvp read"
on public.rsvps for select to authenticated using (public.is_manager());
