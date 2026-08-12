import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // 開發時如果忘記設定 .env，直接在畫面上提示，比留白畫面好debug
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;line-height:1.6">' +
      '⚠️ 找不到 Supabase 設定。<br>請建立 <code>.env</code> 檔（可參考 <code>.env.example</code>），' +
      '填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY 後重新啟動。' +
      '</div>';
  });
  throw new Error('Missing Supabase env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
