-- 付款方式功能 - 資料庫遷移腳本
-- 用途：你的 Supabase 專案是「既有」資料庫（已經有 entries / user_settings 表），
--       schema.sql 裡的 create table if not exists 不會幫已存在的表補欄位，
--       所以用這份腳本補上新欄位即可，不會動到既有資料。
--
-- 使用方式：Supabase 後台 → SQL Editor → New query → 貼上整份執行（可重複執行，安全）

-- 1. entries 表：每一筆記帳紀錄增加「付款方式」欄位
alter table public.entries
  add column if not exists payment_method text;

-- 2. user_settings 表：增加「付款方式清單」欄位（每個使用者自己的清單，可新增/刪除）
alter table public.user_settings
  add column if not exists payment_methods jsonb not null default '["現金","信用卡","轉帳","行動支付"]'::jsonb;

-- 3. 把既有使用者（payment_methods 還是空的）補上預設清單
update public.user_settings
  set payment_methods = '["現金","信用卡","轉帳","行動支付"]'::jsonb
  where payment_methods is null or payment_methods = '[]'::jsonb;
