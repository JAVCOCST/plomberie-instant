create table if not exists public.admin_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  content text not null,
  is_done boolean not null default false,
  done_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_todos enable row level security;

drop policy if exists "users manage own todos" on public.admin_todos;
create policy "users manage own todos" on public.admin_todos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists admin_todos_user_idx on public.admin_todos(user_id, is_done, sort_order);
