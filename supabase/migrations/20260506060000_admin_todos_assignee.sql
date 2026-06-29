-- Profiles mirror of auth.users so we can list assignable team members
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "auth read profiles" on public.profiles;
create policy "auth read profiles" on public.profiles
  for select to authenticated using (true);

drop policy if exists "self update profile" on public.profiles;
create policy "self update profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing users
insert into public.profiles (id, email, full_name)
select id, email, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email,'@',1))
from auth.users
on conflict (id) do nothing;

-- Extend admin_todos for assignment
alter table public.admin_todos add column if not exists assignee_id uuid references auth.users(id) on delete set null;
alter table public.admin_todos add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Default assignee_id to user_id for existing rows so old todos remain visible to their owner
update public.admin_todos set assignee_id = user_id where assignee_id is null;
update public.admin_todos set created_by = user_id where created_by is null;

-- Replace RLS: authenticated can see all todos (team visibility), manage if creator or assignee
drop policy if exists "users manage own todos" on public.admin_todos;

drop policy if exists "todos select all auth" on public.admin_todos;
create policy "todos select all auth" on public.admin_todos
  for select to authenticated using (true);

drop policy if exists "todos insert auth" on public.admin_todos;
create policy "todos insert auth" on public.admin_todos
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "todos update creator or assignee" on public.admin_todos;
create policy "todos update creator or assignee" on public.admin_todos
  for update to authenticated
  using (auth.uid() = created_by or auth.uid() = assignee_id or auth.uid() = user_id)
  with check (true);

drop policy if exists "todos delete creator" on public.admin_todos;
create policy "todos delete creator" on public.admin_todos
  for delete to authenticated
  using (auth.uid() = created_by or auth.uid() = user_id);

create index if not exists admin_todos_assignee_idx on public.admin_todos(assignee_id, is_done);
