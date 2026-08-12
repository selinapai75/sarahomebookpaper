import { supabase } from './supabaseClient.js';

/* ========================================================================
   常數
   ======================================================================== */
const DEFAULT_CATS = {
  income: {
    '薪資': ['本薪', '加班費'],
    '獎金': ['年終獎金', '績效獎金', '其他獎金'],
    '其他收入': ['利息', '退款', '其他']
  },
  expense: {
    '餐飲': ['早餐', '午餐', '晚餐', '飲料點心', '聚餐應酬'],
    '交通': ['大眾運輸', '計程車', '加油', '停車費', '高鐵/機票'],
    '住宿': ['飯店', '民宿'],
    '水電': ['電費', '水費', '瓦斯費', '網路/電信'],
    '教育': ['學費', '書籍', '才藝課程'],
    '醫療': ['門診掛號', '藥局', '保健品'],
    '娛樂': ['電影/展覽', '旅遊', '訂閱服務'],
    '出差': ['機票', '簽證', '雜支'],
    '其他': ['其他']
  }
};

const CAT_ICON = {
  '薪資': '💵', '獎金': '🎁', '其他收入': '💰',
  '餐飲': '🍜', '交通': '🚕', '住宿': '🏨', '水電': '💡', '教育': '📚', '醫療': '🩺', '娛樂': '🎬', '出差': '✈️', '其他': '🧾'
};
const CUR_SYMBOL = { TWD: 'NT$', USD: 'US$', JPY: '¥', CNY: '¥', EUR: '€', HKD: 'HK$', KRW: '₩', SGD: 'S$', OTHER: '' };

/* ========================================================================
   狀態
   ======================================================================== */
let session = null;
let entries = [];
let categoryTree = JSON.parse(JSON.stringify(DEFAULT_CATS));
let budgets = {};
let viewMonth = new Date().getMonth();
let viewYear = new Date().getFullYear();
let currentType = 'expense';
let currentStatus = 'pending';
let editingId = null;
let statsMode = 'month';
let manageType = 'expense';
let authMode = 'login';

const $ = (id) => document.getElementById(id);

/* ========================================================================
   Auth
   ======================================================================== */
function setAuthMode(mode) {
  authMode = mode;
  $('authTabLogin').classList.toggle('active', mode === 'login');
  $('authTabSignup').classList.toggle('active', mode === 'signup');
  $('btnAuthSubmit').textContent = mode === 'login' ? '登入' : '註冊並登入';
  $('authError').style.display = 'none';
  $('authHint').style.display = 'none';
}

function showAuthError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.style.display = 'block';
}

function showAuthHint(msg) {
  const el = $('authHint');
  el.textContent = msg;
  el.style.display = 'block';
}

async function handleAuthSubmit() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authError').style.display = 'none';
  $('authHint').style.display = 'none';

  if (!email || !password) {
    showAuthError('請輸入 Email 與密碼');
    return;
  }
  if (password.length < 6) {
    showAuthError('密碼至少需要 6 個字元');
    return;
  }

  $('btnAuthSubmit').disabled = true;
  try {
    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { showAuthError(translateAuthError(error)); return; }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) { showAuthError(translateAuthError(error)); return; }
      if (data.user && !data.session) {
        showAuthHint('註冊成功！請至信箱點擊驗證連結後再回來登入。');
        setAuthMode('login');
        return;
      }
    }
  } finally {
    $('btnAuthSubmit').disabled = false;
  }
}

function translateAuthError(error) {
  const msg = error?.message || '';
  if (msg.includes('Invalid login credentials')) return 'Email 或密碼不正確';
  if (msg.includes('User already registered')) return '這個 Email 已經註冊過了，改用「登入」';
  if (msg.includes('Password should be')) return '密碼至少需要 6 個字元';
  return msg || '發生錯誤，請稍後再試';
}

async function handleLogout() {
  await supabase.auth.signOut();
}

function showAuthScreen() {
  $('authWrap').style.display = 'flex';
  $('appWrap').style.display = 'none';
  $('fabAdd').style.display = 'none';
}

async function showAppScreen() {
  $('authWrap').style.display = 'none';
  $('appWrap').style.display = 'block';
  $('fabAdd').style.display = 'flex';
  $('coverSub').textContent = session?.user?.email
    ? `${session.user.email}・日常收支・出差海外消費・公司代墊追蹤`
    : '日常收支・出差海外消費・公司代墊追蹤';
  await loadAllData();
}

/* ========================================================================
   資料載入 / 儲存（Supabase）
   ======================================================================== */
async function loadAllData() {
  $('entriesList').innerHTML = '<div class="loading-note">帳本讀取中…</div>';
  try {
    const [entriesRes, settingsRes] = await Promise.all([
      supabase.from('entries').select('*').order('date', { ascending: false }),
      supabase.from('user_settings').select('*').maybeSingle()
    ]);

    if (entriesRes.error) throw entriesRes.error;
    entries = (entriesRes.data || []).map(rowToEntry);

    if (settingsRes.error && settingsRes.error.code !== 'PGRST116') throw settingsRes.error;

    if (settingsRes.data) {
      categoryTree = settingsRes.data.category_tree && Object.keys(settingsRes.data.category_tree).length
        ? settingsRes.data.category_tree
        : JSON.parse(JSON.stringify(DEFAULT_CATS));
      budgets = settingsRes.data.budgets || {};
    } else {
      // 第一次登入，建立預設分類設定
      categoryTree = JSON.parse(JSON.stringify(DEFAULT_CATS));
      budgets = {};
      const { error } = await supabase.from('user_settings').insert({
        user_id: session.user.id,
        category_tree: categoryTree,
        budgets: budgets
      });
      if (error) console.error('建立預設設定失敗', error);
    }

    $('storageWarning').style.display = 'none';
  } catch (e) {
    console.error(e);
    entries = [];
    $('storageWarning').style.display = 'block';
    $('storageWarning').textContent = '⚠️ 讀取雲端資料失敗，請檢查網路連線後重新整理頁面。';
  }
  render();
}

function rowToEntry(row) {
  return {
    id: row.id,
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    category: row.category,
    subcategory: row.subcategory || '',
    note: row.note || '',
    currency: row.currency,
    isCompany: row.is_company,
    reimburseStatus: row.reimburse_status || undefined,
    createdAt: row.created_at
  };
}

function entryToRow(e) {
  return {
    date: e.date,
    amount: e.amount,
    type: e.type,
    category: e.category,
    subcategory: e.subcategory || null,
    note: e.note || null,
    currency: e.currency,
    is_company: e.isCompany,
    reimburse_status: e.isCompany ? (e.reimburseStatus || 'pending') : null
  };
}

async function persistCategories() {
  const { error } = await supabase
    .from('user_settings')
    .update({ category_tree: categoryTree })
    .eq('user_id', session.user.id);
  if (error) { console.error(error); showToast('分類儲存失敗，請稍後再試'); }
}

async function persistBudgets() {
  const { error } = await supabase
    .from('user_settings')
    .update({ budgets })
    .eq('user_id', session.user.id);
  if (error) { console.error(error); showToast('預算儲存失敗，請稍後再試'); }
}

/* ---- 備份匯出/匯入（仍然可用，作為額外保險） ---- */
function exportBackup() {
  const data = { entries, categoryTree, budgets, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `家庭收支帳本備份_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已下載備份檔案');
}

function triggerImport() {
  $('importFile').click();
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.entries || !data.categoryTree) {
      showToast('備份檔案格式不正確');
      event.target.value = '';
      return;
    }
    if (!confirm('匯入備份會覆蓋雲端上目前的資料，確定要匯入嗎？')) {
      event.target.value = '';
      return;
    }

    showToast('匯入中，請稍候…');

    // 覆蓋分類與預算
    categoryTree = data.categoryTree;
    budgets = data.budgets || {};
    await persistCategories();
    await persistBudgets();

    // 覆蓋 entries：先刪除目前使用者所有紀錄，再整批寫入備份內容
    const { error: delError } = await supabase.from('entries').delete().eq('user_id', session.user.id);
    if (delError) throw delError;

    if (data.entries.length) {
      const rows = data.entries.map((e) => ({ ...entryToRow(e), user_id: session.user.id }));
      const { error: insError } = await supabase.from('entries').insert(rows);
      if (insError) throw insError;
    }

    await loadAllData();
    showToast('已匯入備份資料');
  } catch (e) {
    console.error(e);
    showToast('讀取備份檔案失敗，請確認檔案格式');
  }
  event.target.value = '';
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function fmtMoney(n) {
  return Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

/* ========================================================================
   主畫面 render
   ======================================================================== */
function monthEntries() {
  return entries.filter((e) => {
    const d = new Date(e.date);
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
  });
}

function changeMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  render();
}

function render() {
  $('monthLabel').textContent = `${viewYear} 年 ${viewMonth + 1} 月`;
  const me = monthEntries();

  let income = 0, expense = 0;
  const overseasTotals = {};
  const pendingTotals = {};

  me.forEach((e) => {
    if (e.currency === 'TWD') {
      if (e.type === 'income') income += Number(e.amount);
      else expense += Number(e.amount);
    } else {
      overseasTotals[e.currency] = (overseasTotals[e.currency] || 0) + (e.type === 'expense' ? Number(e.amount) : -Number(e.amount));
    }
    if (e.isCompany && e.reimburseStatus === 'pending') {
      const key = e.currency;
      pendingTotals[key] = (pendingTotals[key] || 0) + Number(e.amount);
    }
  });

  $('sumIncome').textContent = 'NT$ ' + fmtMoney(income);
  $('sumExpense').textContent = 'NT$ ' + fmtMoney(expense);
  $('sumNet').textContent = 'NT$ ' + fmtMoney(income - expense);

  const ovEl = $('overseasChips');
  const ovKeys = Object.keys(overseasTotals);
  ovEl.innerHTML = ovKeys.length
    ? ovKeys.map((c) => `<span class="chip">${CUR_SYMBOL[c] || c} ${fmtMoney(overseasTotals[c])} <span style="opacity:.6">${c}</span></span>`).join('')
    : '<span class="empty-note">本月尚無海外消費紀錄</span>';

  const pdEl = $('pendingChips');
  const pdKeys = Object.keys(pendingTotals);
  pdEl.innerHTML = pdKeys.length
    ? pdKeys.map((c) => `<span class="chip gold">${CUR_SYMBOL[c] || c} ${fmtMoney(pendingTotals[c])} <span style="opacity:.6">${c}</span></span>`).join('')
    : '<span class="empty-note">目前沒有待請款項目</span>';

  renderList(me);
}

function renderList(me) {
  const el = $('entriesList');
  if (me.length === 0) {
    el.innerHTML = `<div class="no-entries"><div class="big">📖</div>這個月還沒有任何紀錄<br>點下方「記一筆」開始記帳</div>`;
    return;
  }
  const sorted = [...me].sort((a, b) => b.date.localeCompare(a.date) || new Date(b.createdAt) - new Date(a.createdAt));
  const groups = {};
  sorted.forEach((e) => { (groups[e.date] = groups[e.date] || []).push(e); });

  let html = '';
  Object.keys(groups).forEach((date) => {
    const d = new Date(date);
    const label = d.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
    let dayIncome = 0, dayExpense = 0;
    groups[date].forEach((e) => {
      if (e.currency === 'TWD') {
        if (e.type === 'income') dayIncome += Number(e.amount); else dayExpense += Number(e.amount);
      }
    });
    html += `<div class="day-group"><div class="day-label"><span>${label}</span><span>${dayIncome ? '+' + fmtMoney(dayIncome) : ''} ${dayExpense ? '-' + fmtMoney(dayExpense) : ''}</span></div>`;
    groups[date].forEach((e) => {
      const icon = CAT_ICON[e.category] || '🏷️';
      const sym = CUR_SYMBOL[e.currency] || e.currency;
      const catLabel = e.subcategory ? `${e.category} › ${e.subcategory}` : e.category;
      let badges = '';
      if (e.currency !== 'TWD') badges += `<span class="stamp">${e.currency}</span>`;
      if (e.isCompany) badges += `<span class="tag ${e.reimburseStatus === 'reimbursed' ? 'done' : ''}">${e.reimburseStatus === 'reimbursed' ? '已請款' : '待請款'}</span>`;
      html += `<div class="entry" data-entry-id="${e.id}">
        <div class="entry-icon ${e.type}">${icon}</div>
        <div class="entry-mid">
          <div class="entry-cat">${catLabel}</div>
          ${e.note ? `<div class="entry-note">${escapeHtml(e.note)}</div>` : ''}
          ${badges ? `<div class="badge-row">${badges}</div>` : ''}
        </div>
        <div class="entry-amt ${e.type}">${e.type === 'income' ? '+' : '-'}${sym}${fmtMoney(e.amount)}</div>
      </div>`;
    });
    html += `</div>`;
  });
  el.innerHTML = html;

  el.querySelectorAll('[data-entry-id]').forEach((node) => {
    node.addEventListener('click', () => editEntry(node.getAttribute('data-entry-id')));
  });
}

function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ========================================================================
   統計分析
   ======================================================================== */
function openStats() {
  statsMode = 'month';
  updateStatsButtons();
  renderStats();
  $('statsOverlay').classList.add('open');
}
function closeStats() {
  $('statsOverlay').classList.remove('open');
}
function setStatsRange(mode) {
  statsMode = mode;
  updateStatsButtons();
  renderStats();
}
function updateStatsButtons() {
  $('statsBtnMonth').classList.toggle('active', statsMode === 'month');
  $('statsBtnYear').classList.toggle('active', statsMode === 'year');
}
function statsChangePeriod(delta) {
  if (statsMode === 'month') {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  } else {
    viewYear += delta;
  }
  render();
  renderStats();
}

function periodEntries() {
  if (statsMode === 'month') return monthEntries();
  return entries.filter((e) => new Date(e.date).getFullYear() === viewYear);
}

function categoryBreakdown(type) {
  const pe = periodEntries().filter((e) => e.type === type && e.currency === 'TWD');
  const totals = {};
  pe.forEach((e) => { totals[e.category] = (totals[e.category] || 0) + Number(e.amount); });
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const rows = Object.keys(totals).map((cat) => ({ cat, amount: totals[cat], pct: total ? totals[cat] / total * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { rows, total };
}

function subcategoryBreakdown(type, mainCat) {
  const pe = periodEntries().filter((e) => e.type === type && e.currency === 'TWD' && e.category === mainCat);
  const totals = {};
  pe.forEach((e) => {
    const key = e.subcategory || '(未分細項)';
    totals[key] = (totals[key] || 0) + Number(e.amount);
  });
  return Object.keys(totals).map((sub) => ({ sub, amount: totals[sub] })).sort((a, b) => b.amount - a.amount);
}

function getBudgetForPeriod(cat) {
  if (!budgets[cat]) return null;
  return statsMode === 'year' ? budgets[cat] * 12 : budgets[cat];
}

function budgetSummary() {
  const { rows } = categoryBreakdown('expense');
  let totalBudget = 0, totalUsed = 0, any = false;
  rows.forEach((r) => {
    const b = getBudgetForPeriod(r.cat);
    if (b) { any = true; totalBudget += b; totalUsed += r.amount; }
  });
  return any ? { totalBudget, totalUsed } : null;
}

function renderCategorySection(type, containerId) {
  const { rows } = categoryBreakdown(type);
  const container = $(containerId);
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty-note">這段期間沒有相關紀錄</div>';
    return;
  }
  container.innerHTML = rows.map((r, i) => {
    const subs = subcategoryBreakdown(type, r.cat);
    const hasMeaningfulSubs = subs.length > 1 || (subs.length === 1 && subs[0].sub !== '(未分細項)');
    const rowId = `statSub_${type}_${i}`;
    const subsHtml = hasMeaningfulSubs ? subs.map((s) => `
      <div class="stat-sub-row"><span>${escapeHtml(s.sub)}</span><span>NT$ ${fmtMoney(s.amount)}</span></div>
    `).join('') : '';

    let budgetHtml = '';
    if (type === 'expense') {
      const budget = getBudgetForPeriod(r.cat);
      if (budget) {
        const usedPct = r.amount / budget * 100;
        const overBudget = usedPct > 100;
        const nearLimit = usedPct >= 80 && usedPct <= 100;
        const barClass = overBudget ? 'over' : (nearLimit ? 'near' : 'ok');
        budgetHtml = `<div class="budget-info">
          <div class="budget-label">
            <span>預算 NT$ ${fmtMoney(budget)}</span>
            <span class="${overBudget ? 'over-text' : ''}">${usedPct.toFixed(0)}%</span>
          </div>
          <div class="budget-track"><div class="budget-fill ${barClass}" style="width:${Math.min(usedPct, 100)}%"></div></div>
          ${overBudget ? `<div class="budget-over-note">已超支 NT$ ${fmtMoney(r.amount - budget)}</div>` : ''}
        </div>`;
      }
    }

    return `<div class="stat-row ${hasMeaningfulSubs ? 'clickable' : ''}" ${hasMeaningfulSubs ? `data-toggle-target="${rowId}"` : ''}>
      <div class="stat-row-top">
        <span class="name">${escapeHtml(r.cat)}${hasMeaningfulSubs ? ' ▾' : ''}</span>
        <span class="amt">NT$ ${fmtMoney(r.amount)}</span>
      </div>
      <div class="stat-bar-track"><div class="stat-bar-fill ${type}" style="width:${r.pct}%"></div></div>
      <div class="stat-pct">${r.pct.toFixed(1)}% 佔${type === 'expense' ? '總支出' : '總收入'}</div>
      ${budgetHtml}
      ${subsHtml ? `<div class="stat-subs" id="${rowId}">${subsHtml}</div>` : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('[data-toggle-target]').forEach((node) => {
    node.addEventListener('click', () => toggleStatSub(node.getAttribute('data-toggle-target')));
  });
}

function toggleStatSub(id) {
  $(id).classList.toggle('open');
}

function renderYearTrend() {
  const monthData = [];
  let maxVal = 0;
  for (let m = 0; m < 12; m++) {
    let inc = 0, exp = 0;
    entries.forEach((e) => {
      const d = new Date(e.date);
      if (d.getFullYear() === viewYear && d.getMonth() === m && e.currency === 'TWD') {
        if (e.type === 'income') inc += Number(e.amount); else exp += Number(e.amount);
      }
    });
    monthData.push({ m, inc, exp });
    maxVal = Math.max(maxVal, inc, exp);
  }
  const html = monthData.map((md) => `
    <div class="trend-row">
      <span class="trend-month">${md.m + 1}月</span>
      <div class="trend-bars">
        <div class="trend-bar-track"><div class="trend-bar-fill income" style="width:${maxVal ? md.inc / maxVal * 100 : 0}%"></div></div>
        <div class="trend-bar-track"><div class="trend-bar-fill expense" style="width:${maxVal ? md.exp / maxVal * 100 : 0}%"></div></div>
      </div>
    </div>
  `).join('');
  $('statsYearTrendList').innerHTML = html;
}

function renderStats() {
  $('statsPeriodLabel').textContent = statsMode === 'month'
    ? `${viewYear} 年 ${viewMonth + 1} 月`
    : `${viewYear} 年`;

  const pe = periodEntries();
  let income = 0, expense = 0;
  pe.forEach((e) => {
    if (e.currency === 'TWD') {
      if (e.type === 'income') income += Number(e.amount); else expense += Number(e.amount);
    }
  });
  $('statsIncome').textContent = 'NT$ ' + fmtMoney(income);
  $('statsExpense').textContent = 'NT$ ' + fmtMoney(expense);
  $('statsNet').textContent = 'NT$ ' + fmtMoney(income - expense);

  const trendWrap = $('statsYearTrendWrap');
  if (statsMode === 'year') {
    trendWrap.style.display = 'block';
    renderYearTrend();
  } else {
    trendWrap.style.display = 'none';
  }

  renderCategorySection('expense', 'statsExpenseCats');
  renderCategorySection('income', 'statsIncomeCats');

  const bs = budgetSummary();
  const bsEl = $('statsBudgetSummary');
  bsEl.innerHTML = bs ? `<div class="budget-overview">${statsMode === 'year' ? '年度' : '本月'}預算總額 NT$ ${fmtMoney(bs.totalBudget)} ・已使用 NT$ ${fmtMoney(bs.totalUsed)}（${(bs.totalUsed / bs.totalBudget * 100).toFixed(0)}%）</div>` : '';
}

/* ========================================================================
   分類管理
   ======================================================================== */
function openCatManager() {
  manageType = 'expense';
  updateManageTypeButtons();
  renderCategoryManager();
  $('catOverlay').classList.add('open');
}
function closeCatManager() {
  $('catOverlay').classList.remove('open');
}
function setManageType(t) {
  manageType = t;
  updateManageTypeButtons();
  renderCategoryManager();
}
function updateManageTypeButtons() {
  $('cmBtnIncome').classList.toggle('active', manageType === 'income');
  $('cmBtnExpense').classList.toggle('active', manageType === 'expense');
}

function renderCategoryManager() {
  const tree = categoryTree[manageType];
  const mains = Object.keys(tree);
  const list = $('catManagerList');
  if (mains.length === 0) {
    list.innerHTML = '<div class="cm-empty">目前沒有分類，請在下方新增</div>';
    return;
  }
  list.innerHTML = mains.map((main, i) => {
    const subs = tree[main];
    const otherMains = mains.filter((m) => m !== main);
    const subsHtml = subs.length ? subs.map((sub, j) => `
      <div class="cm-sub-row">
        <span class="cm-sub-arrows">
          <button type="button" ${j === 0 ? 'disabled' : ''} onclick="window.__ledger.moveSub('${escAttr(main)}',${j},-1)">↑</button>
          <button type="button" ${j === subs.length - 1 ? 'disabled' : ''} onclick="window.__ledger.moveSub('${escAttr(main)}',${j},1)">↓</button>
        </span>
        <span class="cm-sub-name">${escapeHtml(sub)}</span>
        <select class="cm-move-select" onchange="window.__ledger.moveSubToMain('${escAttr(main)}','${escAttr(sub)}', this.value); this.value='';">
          <option value="">移到...</option>
          ${otherMains.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
        </select>
        <button type="button" class="cm-sub-del" onclick="window.__ledger.deleteSub('${escAttr(main)}','${escAttr(sub)}')" aria-label="刪除細分類">✕</button>
      </div>
    `).join('') : '<div class="cm-empty">尚無細分類</div>';

    const budgetHtml = manageType === 'expense' ? `
      <div class="cm-budget-row">
        <span>💰 每月預算</span>
        <input type="number" class="cm-budget-input" min="0" step="1" placeholder="未設定"
          value="${budgets[main] ? budgets[main] : ''}"
          onchange="window.__ledger.setBudget('${escAttr(main)}', this.value)">
      </div>
    ` : '';

    return `<div class="cm-main-card">
      <div class="cm-main-header">
        <span class="cm-arrows">
          <button type="button" ${i === 0 ? 'disabled' : ''} onclick="window.__ledger.moveMain(${i},-1)">↑</button>
          <button type="button" ${i === mains.length - 1 ? 'disabled' : ''} onclick="window.__ledger.moveMain(${i},1)">↓</button>
        </span>
        <span class="cm-main-name">${escapeHtml(main)}</span>
        <button type="button" class="cm-del" onclick="window.__ledger.deleteMain('${escAttr(main)}')">刪除</button>
      </div>
      ${budgetHtml}
      <div class="cm-subs">
        ${subsHtml}
        <div class="cm-add-sub-row">
          <input type="text" id="cmNewSub_${i}" placeholder="新增細分類">
          <button type="button" onclick="window.__ledger.addSubFromManager('${escAttr(main)}', ${i})">新增</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function moveMain(index, dir) {
  const tree = categoryTree[manageType];
  const keys = Object.keys(tree);
  const newIndex = index + dir;
  if (newIndex < 0 || newIndex >= keys.length) return;
  [keys[index], keys[newIndex]] = [keys[newIndex], keys[index]];
  const rebuilt = {};
  keys.forEach((k) => { rebuilt[k] = tree[k]; });
  categoryTree[manageType] = rebuilt;
  await persistCategories();
  renderCategoryManager();
}

async function moveSub(main, subIndex, dir) {
  const arr = categoryTree[manageType][main];
  const newIndex = subIndex + dir;
  if (!arr || newIndex < 0 || newIndex >= arr.length) return;
  [arr[subIndex], arr[newIndex]] = [arr[newIndex], arr[subIndex]];
  await persistCategories();
  renderCategoryManager();
}

async function deleteMain(main) {
  const count = (categoryTree[manageType][main] || []).length;
  const msg = count > 0
    ? `確定要刪除分類「${main}」嗎？其下 ${count} 個細分類也會一併移除（已記錄的帳目金額不會受影響，只是之後選單裡不會再出現）`
    : `確定要刪除分類「${main}」嗎？`;
  if (!confirm(msg)) return;
  delete categoryTree[manageType][main];
  await persistCategories();
  if (budgets[main]) {
    delete budgets[main];
    await persistBudgets();
  }
  renderCategoryManager();
  showToast('已刪除分類「' + main + '」');
}

async function setBudget(main, value) {
  const amount = parseFloat(value);
  if (!amount || amount <= 0) {
    delete budgets[main];
  } else {
    budgets[main] = amount;
  }
  await persistBudgets();
  renderStatsIfOpen();
  showToast(amount > 0 ? `已設定「${main}」每月預算 NT$ ${fmtMoney(amount)}` : `已清除「${main}」的預算`);
}

function renderStatsIfOpen() {
  if ($('statsOverlay').classList.contains('open')) renderStats();
}

async function deleteSub(main, sub) {
  if (!categoryTree[manageType][main]) return;
  categoryTree[manageType][main] = categoryTree[manageType][main].filter((s) => s !== sub);
  await persistCategories();
  renderCategoryManager();
  showToast('已刪除細分類「' + sub + '」');
}

async function moveSubToMain(main, sub, targetMain) {
  if (!targetMain || targetMain === main) return;
  categoryTree[manageType][main] = categoryTree[manageType][main].filter((s) => s !== sub);
  if (!categoryTree[manageType][targetMain]) categoryTree[manageType][targetMain] = [];
  if (!categoryTree[manageType][targetMain].includes(sub)) categoryTree[manageType][targetMain].push(sub);
  await persistCategories();
  renderCategoryManager();
  showToast(`已將「${sub}」移到「${targetMain}」`);
}

async function addMainFromManager() {
  const input = $('cmNewMain');
  const name = input.value.trim();
  if (!name) return;
  if (!categoryTree[manageType][name]) categoryTree[manageType][name] = [];
  input.value = '';
  await persistCategories();
  renderCategoryManager();
  showToast('已新增分類「' + name + '」');
}

async function addSubFromManager(main, index) {
  const input = $('cmNewSub_' + index);
  const name = input.value.trim();
  if (!name || !categoryTree[manageType][main]) return;
  if (!categoryTree[manageType][main].includes(name)) categoryTree[manageType][main].push(name);
  input.value = '';
  await persistCategories();
  renderCategoryManager();
  showToast('已新增細分類「' + name + '」');
}

/* ========================================================================
   記帳表單
   ======================================================================== */
function openForm() {
  editingId = null;
  $('formTitle').textContent = '新增一筆';
  $('btnDeleteEntry').style.display = 'none';
  $('fDate').value = new Date().toISOString().slice(0, 10);
  $('fAmount').value = '';
  $('fNote').value = '';
  $('fOverseas').checked = false;
  $('fCompany').checked = false;
  toggleOverseas();
  setType('expense');
  setReimburseStatus('pending');
  $('overlay').classList.add('open');
}

function closeForm() {
  $('overlay').classList.remove('open');
}

function setType(t) {
  currentType = t;
  $('btnIncome').classList.toggle('active', t === 'income');
  $('btnExpense').classList.toggle('active', t === 'expense');
  $('companyRow').style.display = t === 'expense' ? 'flex' : 'none';
  if (t === 'income') {
    $('fCompany').checked = false;
    toggleCompany();
  }
  const catSel = $('fCategory');
  const mains = Object.keys(categoryTree[t]);
  const current = catSel.value;
  catSel.innerHTML = mains.map((c) => `<option value="${c}">${c}</option>`).join('');
  if (mains.includes(current)) catSel.value = current;
  hideAddCategory();
  hideAddSubcategory();
  onCategoryChange();
}

function onCategoryChange() {
  const main = $('fCategory').value;
  const subSel = $('fSubcategory');
  const current = subSel.value;
  const subs = (categoryTree[currentType][main] || []);
  subSel.innerHTML = '<option value="">(不分細項)</option>' + subs.map((s) => `<option value="${s}">${s}</option>`).join('');
  if (subs.includes(current)) subSel.value = current;
  hideAddSubcategory();
}

function showAddCategory() {
  $('addCatPanel').classList.add('open');
  $('newCatName').value = '';
  $('newCatName').focus();
}
function hideAddCategory() {
  $('addCatPanel').classList.remove('open');
}
async function confirmAddCategory() {
  const name = $('newCatName').value.trim();
  if (!name) return;
  if (!categoryTree[currentType][name]) categoryTree[currentType][name] = [];
  await persistCategories();
  const catSel = $('fCategory');
  catSel.innerHTML = Object.keys(categoryTree[currentType]).map((c) => `<option value="${c}">${c}</option>`).join('');
  catSel.value = name;
  onCategoryChange();
  hideAddCategory();
  showToast('已新增分類「' + name + '」');
}

function showAddSubcategory() {
  $('addSubPanel').classList.add('open');
  $('newSubName').value = '';
  $('newSubName').focus();
}
function hideAddSubcategory() {
  $('addSubPanel').classList.remove('open');
}
async function confirmAddSubcategory() {
  const name = $('newSubName').value.trim();
  const main = $('fCategory').value;
  if (!name || !main) return;
  if (!categoryTree[currentType][main]) categoryTree[currentType][main] = [];
  if (!categoryTree[currentType][main].includes(name)) categoryTree[currentType][main].push(name);
  await persistCategories();
  const subSel = $('fSubcategory');
  const subs = categoryTree[currentType][main];
  subSel.innerHTML = '<option value="">(不分細項)</option>' + subs.map((s) => `<option value="${s}">${s}</option>`).join('');
  subSel.value = name;
  hideAddSubcategory();
  showToast('已新增細分類「' + name + '」');
}

function toggleOverseas() {
  const on = $('fOverseas').checked;
  $('overseasPanel').style.display = on ? 'block' : 'none';
}

function toggleCompany() {
  const on = $('fCompany').checked;
  $('companyPanel').style.display = on ? 'block' : 'none';
}

function setReimburseStatus(s) {
  currentStatus = s;
  $('btnPending').classList.toggle('active', s === 'pending');
  $('btnDone').classList.toggle('active', s === 'reimbursed');
  $('btnDone').classList.toggle('reimbursed', s === 'reimbursed');
}

async function saveEntry() {
  const date = $('fDate').value;
  const amount = parseFloat($('fAmount').value);
  const category = $('fCategory').value;
  const subcategory = $('fSubcategory').value;
  const note = $('fNote').value.trim();
  const overseas = $('fOverseas').checked;
  const currency = overseas ? $('fCurrency').value : 'TWD';
  const isCompany = $('fCompany').checked;

  if (!date || !amount || amount <= 0) {
    showToast('請輸入日期與金額');
    return;
  }

  const draft = {
    date, amount, category, subcategory, note, currency, isCompany,
    type: currentType,
    reimburseStatus: isCompany ? currentStatus : undefined
  };

  $('btnSaveForm').disabled = true;
  try {
    if (editingId) {
      const { error } = await supabase.from('entries').update(entryToRow(draft)).eq('id', editingId);
      if (error) throw error;
      const idx = entries.findIndex((e) => e.id === editingId);
      if (idx > -1) entries[idx] = { ...entries[idx], ...draft };
    } else {
      const { data, error } = await supabase.from('entries').insert(entryToRow(draft)).select().single();
      if (error) throw error;
      entries.push(rowToEntry(data));
    }
    closeForm();
    render();
    showToast(editingId ? '已更新這筆紀錄' : '已記上這筆帳');
  } catch (e) {
    console.error(e);
    showToast('儲存失敗，請稍後再試');
  } finally {
    $('btnSaveForm').disabled = false;
  }
}

function editEntry(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  editingId = id;
  $('formTitle').textContent = '編輯這筆';
  $('btnDeleteEntry').style.display = 'block';
  $('fDate').value = e.date;
  $('fAmount').value = e.amount;
  $('fNote').value = e.note || '';
  $('fOverseas').checked = e.currency !== 'TWD';
  toggleOverseas();
  if (e.currency !== 'TWD') $('fCurrency').value = e.currency;
  setType(e.type);
  $('fCategory').value = e.category;
  onCategoryChange();
  $('fSubcategory').value = e.subcategory || '';
  $('fCompany').checked = !!e.isCompany;
  toggleCompany();
  setReimburseStatus(e.reimburseStatus || 'pending');
  $('overlay').classList.add('open');
}

async function deleteCurrentEntry() {
  if (!editingId) return;
  try {
    const { error } = await supabase.from('entries').delete().eq('id', editingId);
    if (error) throw error;
    entries = entries.filter((e) => e.id !== editingId);
    closeForm();
    render();
    showToast('已刪除');
  } catch (e) {
    console.error(e);
    showToast('刪除失敗，請稍後再試');
  }
}

/* ========================================================================
   事件綁定
   ======================================================================== */
function setupEventListeners() {
  // Auth
  $('authTabLogin').addEventListener('click', () => setAuthMode('login'));
  $('authTabSignup').addEventListener('click', () => setAuthMode('signup'));
  $('btnAuthSubmit').addEventListener('click', handleAuthSubmit);
  $('authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
  $('btnLogout').addEventListener('click', handleLogout);

  // Header / navigation
  $('btnOpenStats').addEventListener('click', openStats);
  $('btnOpenCatManager').addEventListener('click', openCatManager);
  $('btnPrevMonth').addEventListener('click', () => changeMonth(-1));
  $('btnNextMonth').addEventListener('click', () => changeMonth(1));

  // Backup
  $('btnExportBackup').addEventListener('click', exportBackup);
  $('btnTriggerImport').addEventListener('click', triggerImport);
  $('importFile').addEventListener('change', importBackup);

  // FAB / form
  $('fabAdd').addEventListener('click', openForm);
  $('btnIncome').addEventListener('click', () => setType('income'));
  $('btnExpense').addEventListener('click', () => setType('expense'));
  $('fCategory').addEventListener('change', onCategoryChange);
  $('btnShowAddCategory').addEventListener('click', showAddCategory);
  $('btnConfirmAddCategory').addEventListener('click', confirmAddCategory);
  $('btnCancelAddCategory').addEventListener('click', hideAddCategory);
  $('btnShowAddSub').addEventListener('click', showAddSubcategory);
  $('btnConfirmAddSub').addEventListener('click', confirmAddSubcategory);
  $('btnCancelAddSub').addEventListener('click', hideAddSubcategory);
  $('fOverseas').addEventListener('change', toggleOverseas);
  $('fCompany').addEventListener('change', toggleCompany);
  $('btnPending').addEventListener('click', () => setReimburseStatus('pending'));
  $('btnDone').addEventListener('click', () => setReimburseStatus('reimbursed'));
  $('btnDeleteEntry').addEventListener('click', deleteCurrentEntry);
  $('btnCancelForm').addEventListener('click', closeForm);
  $('btnSaveForm').addEventListener('click', saveEntry);

  // Category manager
  $('cmBtnIncome').addEventListener('click', () => setManageType('income'));
  $('cmBtnExpense').addEventListener('click', () => setManageType('expense'));
  $('btnAddMain').addEventListener('click', addMainFromManager);
  $('btnCloseCatManager').addEventListener('click', closeCatManager);

  // Stats
  $('statsBtnMonth').addEventListener('click', () => setStatsRange('month'));
  $('statsBtnYear').addEventListener('click', () => setStatsRange('year'));
  $('btnStatsPrev').addEventListener('click', () => statsChangePeriod(-1));
  $('btnStatsNext').addEventListener('click', () => statsChangePeriod(1));
  $('btnCloseStats').addEventListener('click', closeStats);

  // Overlay 背景點擊關閉
  $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeForm(); });
  $('catOverlay').addEventListener('click', (e) => { if (e.target.id === 'catOverlay') closeCatManager(); });
  $('statsOverlay').addEventListener('click', (e) => { if (e.target.id === 'statsOverlay') closeStats(); });
}

// 分類管理清單是用字串拼接產生的 HTML，裡面用 onclick="window.__ledger.xxx(...)" 呼叫，
// 所以把需要用到的函式掛在 window.__ledger 上。
window.__ledger = { moveMain, moveSub, deleteMain, deleteSub, moveSubToMain, setBudget, addSubFromManager };

/* ========================================================================
   啟動
   ======================================================================== */
async function init() {
  setupEventListeners();

  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) { await showAppScreen(); } else { showAuthScreen(); }

  supabase.auth.onAuthStateChange(async (event, newSession) => {
    session = newSession;
    if (event === 'SIGNED_IN') {
      await showAppScreen();
    } else if (event === 'SIGNED_OUT') {
      entries = [];
      categoryTree = JSON.parse(JSON.stringify(DEFAULT_CATS));
      budgets = {};
      showAuthScreen();
    }
  });
}

init();
