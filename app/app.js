// 画面の切り替えと4つのタブ（入力・一覧・集計・設定）。
const data = Store.load();
const view = document.getElementById("view");
const titleEl = document.getElementById("title");
const TITLES = { input: "入力", list: "一覧", summary: "集計", settings: "設定" };
const TYPE_NAME = { expense: "支出", income: "収入" };
const COLOR_SLOTS = 8; // 支出の分類のうち固定の色を持つのは先頭8つ

let tab = "input";
let month = today().slice(0, 7); // 一覧と集計で共有する「表示している月」
let draft = { type: "expense", date: today(), cat: null }; // 入力タブの続き
let catType = "expense"; // 設定の分類の切り替え

// ---------- 小道具 ----------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const yen = (n) => n.toLocaleString("ja-JP") + "円";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
function dayLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}
function monthTitle(key) {
  const [y, m] = key.split("-").map(Number);
  return `${y}年${m}月`;
}
function shiftMonth(key, n) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function findCat(type, id) {
  return data.categories[type].find((c) => c.id === id);
}
function catName(type, id) {
  const c = findCat(type, id);
  if (!c) return "（不明な分類）";
  return c.deleted ? `${c.name}（削除済み）` : c.name;
}
const activeCats = (type) => data.categories[type].filter((c) => !c.deleted);
function parseAmount(s) {
  const t = String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，\s円]/g, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 99999999 ? n : null;
}
function save() {
  if (!Store.save(data)) toast("保存できませんでした（端末の空きを確認してください）");
}
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function h(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}
function monthEntries(key) {
  return data.entries.filter((e) => e.date.startsWith(key));
}
function totals(entries) {
  let income = 0, expense = 0;
  for (const e of entries) e.type === "income" ? (income += e.amount) : (expense += e.amount);
  return { income, expense };
}
// 支出の分類の色：並び順で先頭8つに固定の色、残りと削除済みは灰色
function expenseColor(id) {
  const i = activeCats("expense").findIndex((c) => c.id === id);
  return i >= 0 && i < COLOR_SLOTS ? `var(--series-${i + 1})` : "var(--series-rest)";
}

// ---------- タブの切り替え ----------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    render();
    window.scrollTo(0, 0);
  });
});

function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  titleEl.textContent = TITLES[tab];
  view.innerHTML = "";
  ({ input: renderInput, list: renderList, summary: renderSummary, settings: renderSettings })[tab]();
}

// ---------- 入力の形（入力タブと修正の画面で共通） ----------
// init = { type, date, cat, amount, memo }。onSave(値) が true を返したら形を空に戻す
function entryForm(init, { onSave, onDelete, saveLabel }) {
  const st = { ...init };
  const box = h(`<form class="entry" novalidate>
    <div class="seg2" role="radiogroup">
      <button type="button" data-type="expense">支出</button>
      <button type="button" data-type="income">収入</button>
    </div>
    <label class="amount"><input name="amount" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="金額"><span>円</span></label>
    <div class="chips" aria-label="分類"></div>
    <div class="row2">
      <label class="field"><span>日付</span><input name="date" type="date" required></label>
      <label class="field grow"><span>メモ</span><input name="memo" maxlength="100" placeholder="任意"></label>
    </div>
    <div class="actions">
      ${onDelete ? '<button type="button" class="btn danger" data-act="delete">削除</button>' : ""}
      <button type="submit" class="btn primary">${saveLabel}</button>
    </div>
  </form>`);
  const amount = box.querySelector("[name=amount]");
  const date = box.querySelector("[name=date]");
  const memo = box.querySelector("[name=memo]");
  amount.value = st.amount ? st.amount.toLocaleString("ja-JP") : "";
  date.value = st.date;
  memo.value = st.memo || "";

  function paint() {
    box.querySelectorAll(".seg2 button").forEach((b) => {
      b.classList.toggle("on", b.dataset.type === st.type);
      b.setAttribute("aria-checked", b.dataset.type === st.type);
    });
    box.classList.toggle("is-income", st.type === "income");
    const chips = box.querySelector(".chips");
    chips.innerHTML = "";
    const list = activeCats(st.type).slice();
    // 修正のとき、削除済みの分類が付いていればそれも選択肢に出す
    const cur = findCat(st.type, st.cat);
    if (cur && cur.deleted) list.push(cur);
    for (const c of list) {
      const b = h(`<button type="button" class="chip${c.id === st.cat ? " on" : ""}">${esc(c.deleted ? c.name + "（削除済み）" : c.name)}</button>`);
      b.addEventListener("click", () => { st.cat = c.id; paint(); });
      chips.appendChild(b);
    }
  }
  box.querySelectorAll(".seg2 button").forEach((b) => {
    b.addEventListener("click", () => {
      if (st.type === b.dataset.type) return;
      st.type = b.dataset.type;
      st.cat = null;
      if (init.onTypeChange) init.onTypeChange(st.type);
      paint();
    });
  });
  // 打ちながら 3 桁ごとのカンマを付ける
  amount.addEventListener("input", () => {
    const n = parseAmount(amount.value);
    if (n != null) amount.value = n.toLocaleString("ja-JP");
  });
  box.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const n = parseAmount(amount.value);
    if (n == null) { toast("金額を 1〜99,999,999 の数字で入れてください"); amount.focus(); return; }
    if (!st.cat) { toast("分類を選んでください"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { toast("日付を入れてください"); return; }
    const ok = onSave({ type: st.type, cat: st.cat, amount: n, date: date.value, memo: memo.value.trim() });
    if (ok) {
      amount.value = ""; memo.value = ""; st.cat = null;
      paint();
    }
  });
  if (onDelete) box.querySelector("[data-act=delete]").addEventListener("click", onDelete);
  paint();
  return box;
}

// ---------- 入力タブ ----------
function renderInput() {
  const form = entryForm(
    { ...draft, amount: null, memo: "", onTypeChange: (t) => { draft.type = t; } },
    {
      saveLabel: "記録する",
      onSave: (v) => {
        data.entries.push({ id: Store.newId(), ...v, createdAt: new Date().toISOString() });
        save();
        draft = { type: v.type, date: v.date, cat: null };
        toast(`${catName(v.type, v.cat)} ${yen(v.amount)}を記録しました`);
        renderRecent();
        return true;
      },
    }
  );
  form.querySelector("[name=date]").addEventListener("change", (e) => { draft.date = e.target.value; });
  view.appendChild(form);
  const recent = h(`<section class="card"><h2>最近の記録</h2><div class="recent"></div></section>`);
  view.appendChild(recent);
  function renderRecent() {
    const box = recent.querySelector(".recent");
    const list = data.entries.slice().sort(byNewest).slice(0, 5);
    box.innerHTML = "";
    if (!list.length) box.appendChild(h(`<p class="muted">まだ記録はありません。</p>`));
    for (const e of list) box.appendChild(entryRow(e, true));
  }
  renderRecent();
}

function byNewest(a, b) {
  return a.date !== b.date ? (a.date < b.date ? 1 : -1) : String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

function entryRow(e, withDate) {
  const sign = e.type === "income" ? "+" : "";
  const row = h(`<button class="entry-row ${e.type}">
    <span class="dot" style="${e.type === "expense" ? `background:${expenseColor(e.cat)}` : "visibility:hidden"}"></span>
    <span class="er-main"><span class="er-cat">${esc(catName(e.type, e.cat))}</span>${e.memo ? `<span class="er-memo">${esc(e.memo)}</span>` : ""}</span>
    ${withDate ? `<span class="er-date">${esc(dayLabel(e.date))}</span>` : ""}
    <span class="er-amt">${sign}${yen(e.amount)}</span>
  </button>`);
  row.addEventListener("click", () => openEdit(e.id));
  return row;
}

// ---------- 修正の画面（下から出る） ----------
const sheet = document.getElementById("sheet");
const sheetBack = document.getElementById("sheet-back");
function openSheet(content) {
  sheet.innerHTML = "";
  sheet.appendChild(content);
  sheet.hidden = false; sheetBack.hidden = false;
  requestAnimationFrame(() => sheet.classList.add("open"));
}
function closeSheet() {
  sheet.classList.remove("open");
  sheet.hidden = true; sheetBack.hidden = true;
}
sheetBack.addEventListener("click", closeSheet);

function openEdit(id) {
  const e = data.entries.find((x) => x.id === id);
  if (!e) return;
  const wrap = h(`<div><div class="sheet-head"><h2>記録の修正</h2><button class="icon-btn" aria-label="閉じる">✕</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  wrap.appendChild(entryForm(
    { type: e.type, date: e.date, cat: e.cat, amount: e.amount, memo: e.memo },
    {
      saveLabel: "保存",
      onSave: (v) => {
        Object.assign(e, v);
        save(); closeSheet(); render();
        toast("修正しました");
        return false;
      },
      onDelete: () => {
        if (!confirm(`${dayLabel(e.date)} ${catName(e.type, e.cat)} ${yen(e.amount)} を削除しますか？`)) return;
        data.entries.splice(data.entries.indexOf(e), 1);
        save(); closeSheet(); render();
        toast("削除しました");
      },
    }
  ));
  openSheet(wrap);
}

// ---------- 月の切り替え（一覧と集計） ----------
function monthNav() {
  const nav = h(`<div class="month-nav">
    <button class="icon-btn" data-d="-1" aria-label="前の月">‹</button>
    <span>${monthTitle(month)}</span>
    <button class="icon-btn" data-d="1" aria-label="次の月">›</button>
  </div>`);
  nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { month = shiftMonth(month, Number(b.dataset.d)); render(); }));
  if (month !== today().slice(0, 7)) {
    const back = h(`<button class="link">今月へ</button>`);
    back.addEventListener("click", () => { month = today().slice(0, 7); render(); });
    nav.appendChild(back);
  }
  return nav;
}

function totalsRow(t) {
  const diff = t.income - t.expense;
  return h(`<div class="totals">
    <div><span>収入</span><b class="inc">${yen(t.income)}</b></div>
    <div><span>支出</span><b>${yen(t.expense)}</b></div>
    <div><span>差額</span><b class="${diff < 0 ? "neg" : ""}">${diff >= 0 ? "+" : "−"}${yen(Math.abs(diff))}</b></div>
  </div>`);
}

// ---------- 一覧タブ ----------
function renderList() {
  view.appendChild(monthNav());
  const list = monthEntries(month).sort(byNewest);
  view.appendChild(totalsRow(totals(list)));
  if (!list.length) {
    view.appendChild(h(`<p class="empty">${monthTitle(month)}の記録はありません。</p>`));
    return;
  }
  let day = null, group = null;
  for (const e of list) {
    if (e.date !== day) {
      day = e.date;
      const t = totals(list.filter((x) => x.date === day));
      group = h(`<section class="day"><h3><span>${dayLabel(day)}</span><span class="muted">${t.expense ? "支出 " + yen(t.expense) : ""}${t.income ? "　収入 " + yen(t.income) : ""}</span></h3></section>`);
      view.appendChild(group);
    }
    group.appendChild(entryRow(e, false));
  }
}

// ---------- 集計タブ ----------
function renderSummary() {
  view.appendChild(monthNav());
  const list = monthEntries(month);
  const t = totals(list);
  view.appendChild(totalsRow(t));

  // 分類ごとの支出
  const byCat = new Map();
  for (const e of list) if (e.type === "expense") byCat.set(e.cat, (byCat.get(e.cat) || 0) + e.amount);

  // 予算
  const budgeted = activeCats("expense").filter((c) => data.budgets[c.id] > 0);
  const bsec = h(`<section class="card"><h2>予算の残り</h2></section>`);
  if (!budgeted.length) {
    bsec.appendChild(h(`<p class="muted">予算はまだ決めていません。「設定」の「予算」で分類ごとに決められます。</p>`));
  } else {
    let sumB = 0, sumU = 0;
    const rows = budgeted.map((c) => {
      const b = data.budgets[c.id], u = byCat.get(c.id) || 0;
      sumB += b; sumU += u;
      return budgetRow(c.name, u, b);
    });
    rows.forEach((r) => bsec.appendChild(r));
    if (budgeted.length > 1) {
      const total = budgetRow("予算を決めた分類の合計", sumU, sumB);
      total.classList.add("total");
      bsec.appendChild(total);
    }
  }
  view.appendChild(bsec);

  // 内訳のドーナツ
  const dsec = h(`<section class="card"><h2>支出の内訳</h2></section>`);
  if (!t.expense) {
    dsec.appendChild(h(`<p class="muted">この月の支出はありません。</p>`));
  } else {
    const parts = [];
    let rest = 0, restN = 0;
    for (const c of activeCats("expense").slice(0, COLOR_SLOTS)) {
      const v = byCat.get(c.id);
      if (v) parts.push({ label: c.name, value: v, color: expenseColor(c.id) });
    }
    for (const [id, v] of byCat) {
      if (expenseColor(id) === "var(--series-rest)") { rest += v; restN++; }
    }
    if (rest) parts.push({ label: `そのほか（${restN}分類）`, value: rest, color: "var(--series-rest)" });
    const chart = h(`<div class="donut-wrap"></div>`);
    dsec.appendChild(chart);
    Charts.donut(chart, parts, "支出の合計");
    dsec.appendChild(h(`<p class="hint">グラフを押すと、その分類の金額が真ん中に出ます。</p>`));
    const legend = h(`<ul class="legend"></ul>`);
    [...byCat.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, v]) => {
      legend.appendChild(h(`<li><span class="sw" style="background:${expenseColor(id)}"></span><span class="lg-name">${esc(catName("expense", id))}</span><span class="lg-amt">${yen(v)}</span><span class="lg-pct">${Math.round((v / t.expense) * 100)}%</span></li>`));
    });
    dsec.appendChild(legend);
  }
  view.appendChild(dsec);

  // 収入の内訳（表だけ）
  const inc = new Map();
  for (const e of list) if (e.type === "income") inc.set(e.cat, (inc.get(e.cat) || 0) + e.amount);
  if (inc.size) {
    const isec = h(`<section class="card"><h2>収入の内訳</h2><ul class="legend"></ul></section>`);
    [...inc.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, v]) => {
      isec.querySelector("ul").appendChild(h(`<li><span class="lg-name">${esc(catName("income", id))}</span><span class="lg-amt">${yen(v)}</span><span class="lg-pct">${Math.round((v / t.income) * 100)}%</span></li>`));
    });
    view.appendChild(isec);
  }

  // 12か月の推移
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const key = shiftMonth(month, -i);
    const tt = totals(monthEntries(key));
    const m = Number(key.slice(5));
    months.push({ key, label: m === 1 || i === 11 ? `${key.slice(2, 4)}/${m}` : String(m), title: monthTitle(key), ...tt });
  }
  const msec = h(`<section class="card"><h2>収入と支出の推移（12か月）</h2>
    <div class="legend-inline"><span><i class="sw" style="background:var(--income)"></i>収入</span><span><i class="sw" style="background:var(--expense)"></i>支出</span></div>
    <div class="bars-wrap"></div><p class="readout"></p></section>`);
  view.appendChild(msec);
  Charts.bars(msec.querySelector(".bars-wrap"), msec.querySelector(".readout"), months, month);
}

function budgetRow(name, used, budget) {
  const over = used > budget;
  const pct = Math.min(100, (used / budget) * 100);
  return h(`<div class="budget${over ? " over" : ""}">
    <div class="b-top"><span>${esc(name)}</span><span class="b-num">${yen(used)} / ${yen(budget)}</span></div>
    <div class="b-bar"><i style="width:${pct}%"></i></div>
    <div class="b-rest">${over ? `${yen(used - budget)} 超えています` : `残り ${yen(budget - used)}（${Math.round((used / budget) * 100)}% 使用）`}</div>
  </div>`);
}

// ---------- 設定タブ ----------
function renderSettings() {
  // 分類
  const csec = h(`<section class="card"><h2>分類</h2>
    <div class="seg2 small"><button data-type="expense">支出</button><button data-type="income">収入</button></div>
    <ul class="cat-list"></ul>
    <form class="add-cat"><input maxlength="20" placeholder="新しい分類の名前" aria-label="新しい分類の名前"><button class="btn">追加</button></form>
    <p class="hint">名前は押して書き換えられます。削除しても、その分類の過去の記録は残ります。</p>
  </section>`);
  csec.querySelectorAll(".seg2 button").forEach((b) => {
    b.classList.toggle("on", b.dataset.type === catType);
    b.addEventListener("click", () => { catType = b.dataset.type; render(); });
  });
  const ul = csec.querySelector(".cat-list");
  const cats = activeCats(catType);
  cats.forEach((c, i) => {
    const li = h(`<li>
      <input class="cat-name" maxlength="20" value="${esc(c.name)}" aria-label="分類の名前">
      <button class="icon-btn" data-m="-1" aria-label="上へ" ${i === 0 ? "disabled" : ""}>↑</button>
      <button class="icon-btn" data-m="1" aria-label="下へ" ${i === cats.length - 1 ? "disabled" : ""}>↓</button>
      <button class="icon-btn del" aria-label="削除">✕</button>
    </li>`);
    const input = li.querySelector(".cat-name");
    input.addEventListener("change", () => {
      const name = input.value.trim();
      if (!name) { input.value = c.name; return toast("名前を空にはできません"); }
      if (activeCats(catType).some((x) => x !== c && x.name === name)) { input.value = c.name; return toast("同じ名前の分類があります"); }
      c.name = name; save(); toast("名前を変えました");
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    li.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => moveCat(c, Number(b.dataset.m))));
    li.querySelector(".del").addEventListener("click", () => {
      if (cats.length <= 1) return toast("最後の1つは削除できません");
      const n = data.entries.filter((e) => e.type === catType && e.cat === c.id).length;
      if (!confirm(`「${c.name}」を削除しますか？` + (n ? `\nこの分類の記録 ${n} 件は「${c.name}（削除済み）」として残ります。` : ""))) return;
      c.deleted = true;
      delete data.budgets[c.id];
      save(); render();
      toast("削除しました");
    });
    ul.appendChild(li);
  });
  csec.querySelector(".add-cat").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = e.target.querySelector("input");
    const name = input.value.trim();
    if (!name) return;
    if (activeCats(catType).some((x) => x.name === name)) return toast("同じ名前の分類があります");
    data.categories[catType].push({ id: "c" + Store.newId(), name });
    save(); render();
    toast(`「${name}」を足しました`);
  });
  view.appendChild(csec);

  // 予算
  const bsec = h(`<section class="card"><h2>予算（毎月）</h2><p class="hint">支出の分類ごとに、毎月いくらまで使うかを入れます。空にすると予算なしになります。</p><ul class="budget-list"></ul><p class="b-sum"></p></section>`);
  const bl = bsec.querySelector(".budget-list");
  const sumEl = bsec.querySelector(".b-sum");
  const paintSum = () => {
    const s = activeCats("expense").reduce((a, c) => a + (data.budgets[c.id] || 0), 0);
    sumEl.textContent = s ? `合計 ${yen(s)}` : "";
  };
  for (const c of activeCats("expense")) {
    const li = h(`<li><span>${esc(c.name)}</span><label class="yen-input"><input inputmode="numeric" placeholder="なし" value="${data.budgets[c.id] ? data.budgets[c.id].toLocaleString("ja-JP") : ""}" aria-label="${esc(c.name)}の予算"><span>円</span></label></li>`);
    const input = li.querySelector("input");
    input.addEventListener("change", () => {
      if (!input.value.trim()) { delete data.budgets[c.id]; save(); paintSum(); return; }
      const n = parseAmount(input.value);
      if (n == null) { input.value = data.budgets[c.id] ? data.budgets[c.id].toLocaleString("ja-JP") : ""; return toast("金額を数字で入れてください"); }
      data.budgets[c.id] = n;
      input.value = n.toLocaleString("ja-JP");
      save(); paintSum();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
    bl.appendChild(li);
  }
  paintSum();
  view.appendChild(bsec);

  // バックアップ
  const last = data.settings.lastExport;
  const ksec = h(`<section class="card"><h2>バックアップ</h2>
    <p class="hint">記録はこの端末の中だけにあります。機種変更や万一に備えて、ときどき書き出してください。</p>
    <p>記録 ${data.entries.length} 件　／　最後に書き出した日：${last ? esc(last) : "まだありません"}</p>
    <div class="actions"><button class="btn primary" data-act="export">書き出す</button><button class="btn" data-act="import">読み込む</button></div>
    <input type="file" accept="application/json,.json" hidden>
  </section>`);
  ksec.querySelector("[data-act=export]").addEventListener("click", exportData);
  const file = ksec.querySelector("input[type=file]");
  ksec.querySelector("[data-act=import]").addEventListener("click", () => file.click());
  file.addEventListener("change", () => { if (file.files[0]) importData(file.files[0]); file.value = ""; });
  view.appendChild(ksec);
}

function moveCat(c, d) {
  const list = data.categories[catType];
  const active = activeCats(catType);
  const other = active[active.indexOf(c) + d];
  if (!other) return;
  const i = list.indexOf(c), j = list.indexOf(other);
  [list[i], list[j]] = [list[j], list[i]];
  save(); render();
}

async function exportData() {
  const payload = JSON.stringify({ app: "kakeibo", exportedAt: new Date().toISOString(), ...data }, null, 1);
  const name = `家計簿_${today()}.json`;
  const file = new File([payload], name, { type: "application/json" });
  try {
    // iPhone では共有シートが開き、「"ファイル"に保存」や AirDrop で逃がせる
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    data.settings.lastExport = today();
    save(); render();
  } catch (e) {
    if (e.name !== "AbortError") toast("書き出しに失敗しました");
  }
}

async function importData(f) {
  let incoming;
  try {
    incoming = JSON.parse(await f.text());
  } catch (e) {
    return toast("読み込めないファイルです");
  }
  if (!incoming || incoming.app !== "kakeibo" || !Array.isArray(incoming.entries)) return toast("家計簿の書き出しファイルではありません");
  const r = Store.merge(data, incoming);
  save(); render();
  toast(`${r.added} 件を足しました` + (r.skipped ? `（同じ記録 ${r.skipped} 件は飛ばしました）` : "") + (r.broken ? `　壊れた記録 ${r.broken} 件は読めませんでした` : ""));
}

render();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js");
}
