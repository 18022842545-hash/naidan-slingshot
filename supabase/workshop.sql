-- 奶蛋弹弓社区投稿表
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次。
-- 匿名玩家只能读取已发布关卡、插入新关卡；不能修改或删除已有内容。

create table if not exists public.workshop_levels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  author text not null default '匿名玩家',
  created_at timestamptz not null default now(),
  status text not null default 'published',
  constraint workshop_code_len check (char_length(code) between 40 and 5000),
  constraint workshop_name_len check (char_length(name) between 1 and 30),
  constraint workshop_author_len check (char_length(author) between 1 and 30),
  constraint workshop_status check (status in ('published', 'hidden'))
);

create index if not exists workshop_levels_created_at_idx
  on public.workshop_levels (created_at desc);

alter table public.workshop_levels enable row level security;

drop policy if exists "workshop public read" on public.workshop_levels;
create policy "workshop public read"
  on public.workshop_levels
  for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "workshop anonymous insert" on public.workshop_levels;
create policy "workshop anonymous insert"
  on public.workshop_levels
  for insert
  to anon, authenticated
  with check (
    status = 'published'
    and char_length(code) between 40 and 5000
    and char_length(name) between 1 and 30
    and char_length(author) between 1 and 30
  );

revoke all on table public.workshop_levels from anon, authenticated;
grant select, insert on table public.workshop_levels to anon, authenticated;
