# 家庭收支帳本

原本是單一 HTML 檔（Claude Artifact 風格），資料存在瀏覽器 `localStorage`。
這個版本改成標準的 Vite 專案，資料改存在 **Supabase**（雲端資料庫），並加上
**登入功能**：每個人註冊帳號後，只會看到、只能存取自己的帳本資料（透過
Supabase Row Level Security 強制隔離），可以直接推上 GitHub、部署到 Vercel。

> 附註：原始檔案裡有一部分按鈕（記一筆、統計分析、上/下個月…）其實漏了
> `addEventListener` 綁定，是不能動的。這次重寫時已經把所有按鈕重新正確綁好。

## 專案結構

```
family-ledger/
├── index.html              # 頁面結構（登入畫面 + 主畫面）
├── src/
│   ├── main.js              # 所有互動邏輯（記帳、分類、統計、登入）
│   ├── style.css             # 樣式（沿用原本的設計）
│   └── supabaseClient.js     # 建立 Supabase client
├── supabase/
│   └── schema.sql             # 資料表 + Row Level Security 政策
├── .env.example
└── package.json
```

## 第一步：設定 Supabase

1. 打開你已經建立好的 Supabase 專案。
2. 左側選單 **SQL Editor** → **New query**，貼上 `supabase/schema.sql`
   的完整內容 → 執行（Run）。這會建立兩張表：
   - `entries`：每一筆收支紀錄
   - `user_settings`：每個使用者的分類樹（category_tree）與預算（budgets）
   
   兩張表都已經打開 **Row Level Security**，並設定政策讓每個人只能讀寫
   `auth.uid() = user_id` 的資料，也就是自己的資料。
3. 左側選單 **Authentication → Providers**，確認 **Email** 是啟用的（預設就是）。
   - 如果你想讓自己人可以「註冊後直接使用、不用等驗證信」，可以到
     **Authentication → Settings** 把 *Confirm email* 關掉（開發/家用情境很常見這樣做）。
     正式上線建議保留開啟，比較安全。
4. 左側選單 **Project Settings → API**，複製：
   - `Project URL`
   - `anon public` key

## 第二步：本機開發

```bash
npm install
cp .env.example .env
# 打開 .env，貼上剛剛複製的 Project URL 和 anon key
npm run dev
```

打開瀏覽器顯示的網址，註冊一個帳號（Email + 密碼）即可開始使用。

## 第三步：推上 GitHub

```bash
git init
git add .
git commit -m "Init family ledger with Supabase"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo名稱>.git
git push -u origin main
```

`.env` 已經被 `.gitignore` 排除，不會被推上去（金鑰不會外洩）。

## 第四步：部署到 Vercel

1. 到 [vercel.com](https://vercel.com) → **Add New Project** → 選剛剛推上去的 GitHub repo。
2. Framework Preset 會自動偵測成 **Vite**，不用改建置設定
   （Build Command: `npm run build`，Output Directory: `dist`）。
3. 在 **Environment Variables** 加入：
   - `VITE_SUPABASE_URL` = 你的 Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = 你的 anon public key
4. 點 **Deploy**，完成後就會拿到一個 `https://xxx.vercel.app` 網址，
   之後 `git push` 到 `main` 會自動重新部署。

## 資料模型

- **entries**（每一筆記帳）：日期、金額、收入/支出、分類、細分類、備註、
  幣別（含海外消費）、是否為公司代墊、請款狀態。
- **user_settings**（每人一列）：`category_tree`（收入/支出的主分類與細分類）、
  `budgets`（各主分類每月預算，只用於支出分類）。

## 功能沿用原版

- 月份瀏覽、當月收入/支出/結餘
- 海外消費依幣別統計、公司代墊待請款總覽
- 統計分析（本月/本年、分類佔比、細分類展開、預算進度、全年趨勢）
- 分類管理（新增/刪除/排序主分類與細分類、搬移細分類到別的主分類、設定預算）
- 匯出/匯入 JSON 備份（匯入時會整批覆蓋雲端上的資料，用來換裝置或做保險備份）

## 與原本 localStorage 版本的差異

| 項目 | 原本 | 這個版本 |
|---|---|---|
| 資料存放 | 瀏覽器 localStorage（單一裝置） | Supabase 雲端資料庫（任何裝置登入都看得到） |
| 多人使用 | 不支援，資料混在一起 | 每個帳號資料互相獨立（RLS 隔離） |
| 換裝置 | 需手動匯出/匯入備份 | 直接登入同一帳號即可，資料自動同步 |
| 按鈕綁定 | 部分按鈕缺少事件綁定，點了沒反應 | 全部重新以 `addEventListener` 正確綁定 |
