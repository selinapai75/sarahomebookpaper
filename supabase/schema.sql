-- 家庭收支帳本 - Supabase 資料庫結構
-- 使用方式：打開 Supabase 專案 → SQL Editor → New query → 貼上整份執行

-- 需要 gen_random_uuid()
create extension if not exists "pgcrypto";

-- ========== 1. 記帳明細 entries ==========
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  amount numeric not null check (amount > 0),
  type text not null check (type in ('income','expense')),
  category text not null,
  subcategory text,
  note text,
  currency text not null default 'TWD',
  is_company boolean not null default false,
  reimburse_status text check (reimburse_status in ('pending','reimbursed')),
  created_at timestamptz not null default now()
);

create index if not exists entries_user_date_idx on public.entries (user_id, date);

alter table public.entries enable row level security;

drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own" on public.entries
  for select using (auth.uid() = user_id);

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own" on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own" on public.entries
  for delete using (auth.uid() = user_id);

-- ========== 2. 使用者設定（分類樹 + 預算）user_settings ==========
-- 每個使用者一列，category_tree / budgets 直接存 JSON（結構跟原本 app 一致）
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  category_tree jsonb not null default '{}'::jsonb,
  budgets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "settings_select_own" on public.user_settings;
create policy "settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "settings_insert_own" on public.user_settings;
create policy "settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "settings_update_own" on public.user_settings;
create policy "settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 自動更新 updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
