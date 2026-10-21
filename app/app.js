// 画面の切り替えと5つのタブ（入力・一覧・集計・ランキング・設定）。
const data = Store.load();
const view = document.getElementById("view");
const titleEl = document.getElementById("title");
const TITLES = { input: "入力", list: "一覧", summary: "集計", ranking: "ランキング", settings: "設定" };
const TYPE_NAME = { expense: "支出", income: "収入" };
const COLOR_SLOTS = 8; // 支出の分類のうち固定の色を持つのは先頭8つ

let tab = "input";
let month = today().slice(0, 7); // 一覧と集計で共有する「表示している月」
let draft = { type: "expense", date: today(), cat: null }; // 入力タブの続き
let catType = "expense"; // 設定の分類の切り替え
let query = ""; // 一覧の検索欄
let sumMode = "month"; // 集計の「月／年」
let year = month.slice(0, 4); // 集計の「年」で表示している年
let rankMetric = "streak"; // ランキングで見ている指標

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
// 失敗はすぐ後の「◯◯しました」の案内に上書きされないよう、閉じるまで残る alert で知らせる
function save() {
  const ok = Store.save(data);
  if (!ok) alert("保存できませんでした。端末の空きを確認してください。\n（いまの変更は、アプリを閉じると消えます）");
  else checkSkins();
  return ok;
}
let toastTimer = null;
// undo を渡すと「取り消す」を付け、押せるよう長めに出す
function toast(msg, undo) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.toggle("has-act", !!undo);
  if (undo) {
    const b = h(`<button type="button">取り消す</button>`);
    b.addEventListener("click", () => { t.classList.remove("show", "has-act"); undo(); });
    t.appendChild(b);
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show", "has-act"), undo ? 4500 : 2200);
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
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
  ({ input: renderInput, list: renderList, summary: renderSummary, ranking: renderRanking, settings: renderSettings })[tab]();
}

// ---------- 入力の形（入力タブと修正の画面で共通） ----------
// init = { type, date, cat, amount, memo }。onSave(値) が true を返したら形を空に戻す
// recurring: true のときは固定費の登録用（日付の代わりに「毎月◯日」と「額が変わる」を出す。init に day・variable）
// preset: true のときはよく使う記録の登録用（日付なし。金額は空でもよく、空なら amount は null）
function entryForm(init, { onSave, onDelete, saveLabel, recurring, preset }) {
  const days = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}日</option>`).join("");
  const st = { ...init };
  const box = h(`<form class="entry" novalidate>
    <div class="seg2" role="radiogroup">
      <button type="button" data-type="expense">支出</button>
      <button type="button" data-type="income">収入</button>
    </div>
    <label class="amount"><input name="amount" inputmode="numeric" autocomplete="off" placeholder="${preset ? "毎回入れる" : "0"}" aria-label="金額"><span>円</span></label>
    <div class="chips" aria-label="分類"></div>
    <div class="row2">
      ${recurring
        ? `<label class="field"><span>毎月</span><select name="day">${days}</select></label>`
        : preset ? "" : '<label class="field"><span>日付</span><input name="date" type="date" required></label>'}
      <label class="field grow"><span>メモ</span><input name="memo" maxlength="100" autocomplete="off" placeholder="${preset ? "ボタンの名前にもなります" : "任意"}"></label>
    </div>
    <div class="memo-sugg" aria-label="前に使ったメモ"></div>
    ${recurring ? `<label class="check"><input type="checkbox" name="variable"><span>毎月額が変わる（目安額で入れて「要確認」を付ける）</span></label>
      <p class="hint">29〜31日を選ぶと、その日が無い月は月末に入ります。</p>` : ""}
    ${preset ? '<p class="hint">金額を空にすると、押したときは分類とメモだけが入り、金額はそのつど入れます。</p>' : ""}
    <div class="actions">
      ${onDelete ? '<button type="button" class="btn danger" data-act="delete">削除</button>' : ""}
      <button type="submit" class="btn primary">${saveLabel}</button>
    </div>
  </form>`);
  const amount = box.querySelector("[name=amount]");
  const date = box.querySelector("[name=date]");
  const memo = box.querySelector("[name=memo]");
  amount.value = st.amount ? st.amount.toLocaleString("ja-JP") : "";
  if (recurring) {
    box.querySelector("[name=day]").value = String(st.day || 1);
    box.querySelector("[name=variable]").checked = !!st.variable;
  } else if (date) {
    date.value = st.date;
  }
  memo.value = st.memo || "";
  let memos = memoIndex();

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
    paintSugg();
  }
  // メモの候補：打っている文字を含む前のメモ（頭が合うものを先に）。空のときは選んだ分類でよく使うメモ
  function paintSugg() {
    const sugg = box.querySelector(".memo-sugg");
    sugg.innerHTML = "";
    const q = memo.value.trim().toLowerCase();
    const all = memos[st.type];
    let list;
    if (q) {
      list = all.filter((m) => m.key.includes(q) && m.key !== q);
      list = [...list.filter((m) => m.key.startsWith(q)), ...list.filter((m) => !m.key.startsWith(q))];
    } else if (st.cat) {
      list = all.filter((m) => m.byCat[st.cat]).sort((a, b) => b.byCat[st.cat] - a.byCat[st.cat]);
    } else {
      list = [];
    }
    for (const m of list.slice(0, 5)) {
      const b = h(`<button type="button" class="sugg">${esc(m.memo)}</button>`);
      b.addEventListener("click", () => {
        memo.value = m.memo;
        // 分類をまだ選んでいなければ、そのメモで最後に使った分類にする
        if (!st.cat && findCat(st.type, m.cat) && !findCat(st.type, m.cat).deleted) st.cat = m.cat;
        paint();
      });
      sugg.appendChild(b);
    }
  }
  memo.addEventListener("input", paintSugg);
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
    const n = preset && !amount.value.trim() ? null : parseAmount(amount.value);
    if (n == null && !(preset && !amount.value.trim())) { toast("金額を 1〜99,999,999 の数字で入れてください"); amount.focus(); return; }
    if (!st.cat) { toast("分類を選んでください"); return; }
    const v = { type: st.type, cat: st.cat, amount: n, memo: memo.value.trim() };
    if (recurring) {
      v.day = Number(box.querySelector("[name=day]").value);
      v.variable = box.querySelector("[name=variable]").checked;
    } else if (!preset) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) { toast("日付を入れてください"); return; }
      v.date = date.value;
    }
    const ok = onSave(v);
    if (ok) {
      amount.value = ""; memo.value = ""; st.cat = null;
      memos = memoIndex(); // いま入れたメモも次から候補に出す
      paint();
    }
  });
  if (onDelete) box.querySelector("[data-act=delete]").addEventListener("click", onDelete);
  // 外から中身を入れる・読む（よく使う記録のボタンと、その登録の画面で使う）
  box.fill = (v) => {
    if (v.type !== st.type && init.onTypeChange) init.onTypeChange(v.type);
    st.type = v.type; st.cat = v.cat;
    if (v.amount) amount.value = v.amount.toLocaleString("ja-JP");
    memo.value = v.memo || "";
    paint();
  };
  box.peek = () => ({ type: st.type, cat: st.cat, amount: parseAmount(amount.value), memo: memo.value.trim() });
  box.refreshMemos = () => { memos = memoIndex(); paintSugg(); };
  paint();
  return box;
}

// メモの一覧（支出・収入ごと）。よく使う順、同じなら最近使った順。byCat は分類ごとに使った回数、cat は最後に使った分類
function memoIndex() {
  const out = { expense: new Map(), income: new Map() };
  for (const e of data.entries) {
    const memo = (e.memo || "").trim();
    if (!memo) continue;
    const map = out[e.type];
    if (!map) continue;
    const key = memo.toLowerCase();
    let m = map.get(key);
    if (!m) map.set(key, (m = { key, memo, n: 0, last: "", cat: e.cat, byCat: {} }));
    m.n++;
    m.byCat[e.cat] = (m.byCat[e.cat] || 0) + 1;
    const when = e.date + (e.createdAt || "");
    if (when > m.last) { m.last = when; m.cat = e.cat; m.memo = memo; }
  }
  const sorted = (map) => [...map.values()].sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));
  return { expense: sorted(out.expense), income: sorted(out.income) };
}

// ---------- 入力タブ ----------
function renderInput() {
  const form = entryForm(
    { ...draft, amount: null, memo: "", onTypeChange: (t) => { draft.type = t; } },
    {
      saveLabel: "記録する",
      onSave: (v) => {
        data.entries.push({ id: Store.newId(), ...v, createdAt: new Date().toISOString() });
        // 保存できなければ記録を取り消し、入力も残す（そのまま押し直せるように）
        if (!save()) { data.entries.pop(); return false; }
        draft = { type: v.type, date: v.date, cat: null };
        toast(`${catName(v.type, v.cat)} ${yen(v.amount)}を記録しました`);
        renderRecent();
        return true;
      },
    }
  );
  form.querySelector("[name=date]").addEventListener("change", (e) => { draft.date = e.target.value; });
  view.appendChild(form);

  // よく使う記録（仕様書 D32）：金額があれば押すだけで記録、無ければ形に分類とメモを入れる
  const psec = h(`<section class="card"><h2>よく使う記録</h2><div class="presets"></div></section>`);
  const pbox = psec.querySelector(".presets");
  for (const p of data.presets) {
    const c = findCat(p.type, p.cat);
    if (!c || c.deleted) continue; // 分類を消したものは、設定で直すまで出さない
    const b = h(`<button type="button" class="preset ${p.type}"><span class="pr-name">${esc(presetName(p))}</span><span class="pr-amt">${p.amount ? (p.type === "income" ? "+" : "") + yen(p.amount) : "金額を入れる"}</span></button>`);
    b.addEventListener("click", () => {
      if (!p.amount) {
        form.fill(p);
        form.querySelector("[name=amount]").focus();
        return;
      }
      const d = form.querySelector("[name=date]").value;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today();
      const e = { id: Store.newId(), type: p.type, date, amount: p.amount, cat: p.cat, memo: p.memo, createdAt: new Date().toISOString() };
      data.entries.push(e);
      if (!save()) { data.entries.pop(); return; }
      renderRecent();
      form.refreshMemos();
      toast(`${date === today() ? "" : dayLabel(date) + "に"}${presetName(p)} ${yen(p.amount)}を記録しました`, () => {
        const i = data.entries.indexOf(e);
        if (i < 0) return;
        data.entries.splice(i, 1);
        save();
        // ほかのタブへ移ったあとに押されたら、その画面を描き直す
        if (psec.isConnected) { renderRecent(); form.refreshMemos(); } else render();
        toast("取り消しました");
      });
    });
    pbox.appendChild(b);
  }
  const add = h(`<button type="button" class="preset add">＋ 登録</button>`);
  // いま形に入れている中身で登録の画面を開く（金額・分類・メモを打ってから押すと楽）
  add.addEventListener("click", () => openPreset(null, form.peek()));
  pbox.appendChild(add);
  if (!data.presets.length) psec.appendChild(h(`<p class="hint">「コンビニ・食費・500円」のような、よく入れる記録をボタンにしておけます。上に入れてから「＋ 登録」を押すと、その中身で登録できます。</p>`));
  view.appendChild(psec);

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
    <span class="er-main"><span class="er-cat">${esc(catName(e.type, e.cat))}${e.check ? '<span class="tag warn">要確認</span>' : e.rec ? '<span class="tag">固定費</span>' : ""}</span>${e.memo ? `<span class="er-memo">${esc(e.memo)}</span>` : ""}</span>
    ${withDate ? `<span class="er-date">${e.date.slice(0, 4) !== today().slice(0, 4) ? e.date.slice(0, 4) + "年" : ""}${esc(dayLabel(e.date))}</span>` : ""}
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
  setTimeout(showSkinNews, 300); // 開いていた画面のあいだに手に入れたスキンを、閉じてから知らせる
}
sheetBack.addEventListener("click", closeSheet);

function openEdit(id) {
  const e = data.entries.find((x) => x.id === id);
  if (!e) return;
  const wrap = h(`<div><div class="sheet-head"><h2>記録の修正</h2><button class="icon-btn" aria-label="閉じる">✕</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  if (e.check) wrap.appendChild(h(`<p class="hint">固定費の目安額で入った記録です。実際の額に直して保存すると「要確認」が消えます。</p>`));
  wrap.appendChild(entryForm(
    { type: e.type, date: e.date, cat: e.cat, amount: e.amount, memo: e.memo },
    {
      saveLabel: "保存",
      onSave: (v) => {
        Object.assign(e, v);
        delete e.check;
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
  const search = h(`<label class="search"><span aria-hidden="true">⌕</span><input type="search" placeholder="メモ・分類名で探す（全期間）" aria-label="記録を探す" enterkeyhint="search"></label>`);
  const input = search.querySelector("input");
  input.value = query;
  view.appendChild(search);
  const body = h(`<div></div>`);
  view.appendChild(body);
  // 打つたびに下だけ描き直す（全体を描き直すと入力中の欄が消えてキーボードが閉じるため）
  input.addEventListener("input", () => { query = input.value; paintList(body); });
  paintList(body);
}

function paintList(body) {
  body.innerHTML = "";
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = data.entries.filter((e) => e.memo.toLowerCase().includes(q) || catName(e.type, e.cat).toLowerCase().includes(q)).sort(byNewest);
    body.appendChild(h(`<p class="hint">「${esc(query.trim())}」を含む記録 ${hits.length} 件</p>`));
    body.appendChild(totalsRow(totals(hits)));
    if (!hits.length) return body.appendChild(h(`<p class="empty">見つかりませんでした。</p>`));
    const box = h(`<section class="day"></section>`);
    for (const e of hits) box.appendChild(entryRow(e, true));
    body.appendChild(box);
    return;
  }
  body.appendChild(monthNav());
  const list = monthEntries(month).sort(byNewest);
  body.appendChild(totalsRow(totals(list)));
  const pending = list.filter((e) => e.check).length;
  if (pending) body.appendChild(h(`<p class="notice">「要確認」の固定費が ${pending} 件あります。押して実際の額に直してください。</p>`));
  if (!list.length) {
    body.appendChild(h(`<p class="empty">${monthTitle(month)}の記録はありません。</p>`));
    return;
  }
  let day = null, group = null;
  for (const e of list) {
    if (e.date !== day) {
      day = e.date;
      const t = totals(list.filter((x) => x.date === day));
      group = h(`<section class="day"><h3><span>${dayLabel(day)}</span><span class="muted">${t.expense ? "支出 " + yen(t.expense) : ""}${t.income ? "　収入 " + yen(t.income) : ""}</span></h3></section>`);
      body.appendChild(group);
    }
    group.appendChild(entryRow(e, false));
  }
}

// ---------- 集計タブ ----------
function yearNav() {
  const nav = h(`<div class="month-nav">
    <button class="icon-btn" data-d="-1" aria-label="前の年">‹</button>
    <span>${year}年</span>
    <button class="icon-btn" data-d="1" aria-label="次の年">›</button>
  </div>`);
  nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { year = String(Number(year) + Number(b.dataset.d)); render(); }));
  if (year !== today().slice(0, 4)) {
    const back = h(`<button class="link">今年へ</button>`);
    back.addEventListener("click", () => { year = today().slice(0, 4); render(); });
    nav.appendChild(back);
  }
  return nav;
}

function renderSummary() {
  const isYear = sumMode === "year";
  const seg = h(`<div class="seg2 small"><button data-m="month">月</button><button data-m="year">年</button></div>`);
  seg.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.m === sumMode);
    b.addEventListener("click", () => {
      if (sumMode === b.dataset.m) return;
      sumMode = b.dataset.m;
      if (sumMode === "year") year = month.slice(0, 4); // 年へ切り替えたら、見ていた月の年を出す
      render();
    });
  });
  view.appendChild(seg);
  view.appendChild(isYear ? yearNav() : monthNav());
  const list = isYear ? data.entries.filter((e) => e.date.startsWith(year + "-")) : monthEntries(month);
  const t = totals(list);
  view.appendChild(totalsRow(t));

  // 分類ごとの支出
  const byCat = new Map();
  for (const e of list) if (e.type === "expense") byCat.set(e.cat, (byCat.get(e.cat) || 0) + e.amount);

  if (!isYear) renderBudgets(byCat);
  renderBreakdown(list, t, byCat, isYear ? "この年" : "この月");

  // 推移の棒グラフ：月は選んでいる月までの12か月、年は1月〜12月
  const months = [];
  for (let i = 0; i < 12; i++) {
    const key = isYear ? `${year}-${String(i + 1).padStart(2, "0")}` : shiftMonth(month, i - 11);
    const tt = totals(monthEntries(key));
    const m = Number(key.slice(5));
    months.push({ key, label: !isYear && (m === 1 || i === 0) ? `${key.slice(2, 4)}/${m}` : String(m), title: monthTitle(key), ...tt });
  }
  const selected = isYear ? (today().startsWith(year) ? today().slice(0, 7) : `${year}-12`) : month;
  const msec = h(`<section class="card"><h2>${isYear ? `月ごとの収入と支出（${year}年）` : "収入と支出の推移（12か月）"}</h2>
    <div class="legend-inline"><span><i class="sw" style="background:var(--income)"></i>収入</span><span><i class="sw" style="background:var(--expense)"></i>支出</span></div>
    <div class="bars-wrap"></div><p class="readout"></p></section>`);
  view.appendChild(msec);
  Charts.bars(msec.querySelector(".bars-wrap"), msec.querySelector(".readout"), months, selected, msec.querySelector("h2").textContent);
}

function renderBudgets(byCat) {
  const budgeted = activeCats("expense").filter((c) => data.budgets[c.id] > 0);
  const bsec = h(`<section class="card"><h2>予算の残り</h2></section>`);
  if (!budgeted.length) {
    bsec.appendChild(h(`<p class="muted">予算はまだ決めていません。「設定」の「予算」で分類ごとに決められます。</p>`));
  } else {
    // 今月だけ「1日あたり使える額」を出す（仕様書 D34）。まだ入っていない今月の固定費は先に引いておく
    const t = today();
    const now = month === t.slice(0, 7);
    const daysLeft = now ? new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() - Number(t.slice(8)) + 1 : 0;
    const planned = new Map();
    if (now) {
      for (const r of data.recurring) {
        if (r.type === "expense" && r.next === month && Store.recDate(r.next, r.day) > t) planned.set(r.cat, (planned.get(r.cat) || 0) + r.amount);
      }
    }
    let sumB = 0, sumU = 0, sumP = 0;
    const rows = budgeted.map((c) => {
      const b = data.budgets[c.id], u = byCat.get(c.id) || 0, pl = planned.get(c.id) || 0;
      sumB += b; sumU += u; sumP += pl;
      return budgetRow(c.name, u, b, now && { daysLeft, planned: pl });
    });
    rows.forEach((r) => bsec.appendChild(r));
    if (budgeted.length > 1) {
      const total = budgetRow("予算を決めた分類の合計", sumU, sumB, now && { daysLeft, planned: sumP });
      total.classList.add("total");
      bsec.appendChild(total);
    }
  }
  view.appendChild(bsec);
}

// 支出の内訳（ドーナツと表）と収入の内訳（表だけ）
function renderBreakdown(list, t, byCat, periodName) {
  const dsec = h(`<section class="card"><h2>支出の内訳</h2></section>`);
  if (!t.expense) {
    dsec.appendChild(h(`<p class="muted">${periodName}の支出はありません。</p>`));
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
}

// pace = { daysLeft, planned }（今月のときだけ）。planned はまだ入っていない今月の固定費
function budgetRow(name, used, budget, pace) {
  const over = used > budget;
  const pct = Math.min(100, (used / budget) * 100);
  let perDay = "";
  if (pace && !over) {
    const rest = budget - used - pace.planned;
    const pl = yen(pace.planned);
    if (rest > 0) perDay = `<div class="b-pace">1日あたり <b>${yen(Math.floor(rest / pace.daysLeft))}</b>（今日を入れてあと${pace.daysLeft}日）${pace.planned ? `<br>これから入る固定費 ${pl}を先に引いています` : ""}</div>`;
    else if (rest === 0 && pace.planned) perDay = `<div class="b-pace">残りは、これから入る固定費 ${pl}の分です</div>`;
    else if (pace.planned) perDay = `<div class="b-pace warn">これから入る固定費 ${pl}が入ると、予算を ${yen(-rest)} 超えます</div>`;
  }
  return h(`<div class="budget${over ? " over" : ""}">
    <div class="b-top"><span>${esc(name)}</span><span class="b-num">${yen(used)} / ${yen(budget)}</span></div>
    <div class="b-bar"><i style="width:${pct}%"></i></div>
    <div class="b-rest">${over ? `${yen(used - budget)} 超えています` : `残り ${yen(budget - used)}（${Math.round((used / budget) * 100)}% 使用）`}</div>
    ${perDay}
  </div>`);
}

// ---------- ランキングタブ（仕様書 D30） ----------
const AMOUNT_NAME = { exact: "詳しく", rough: "大まかに", hidden: "見せない" };
function shortDate(s) {
  const [, m, d] = s.split("-").map(Number);
  return `${m}月${d}日`;
}
// 指標の値を表示用の文字にする。rough は1万円単位に丸めた金額
function metricText(metric, v, rough) {
  const man = Math.round(Math.abs(v) / 10000);
  switch (metric.key) {
    case "streak": case "days": return `${v}日`;
    case "save": case "budget": return `${v}%`;
    case "cut": return v >= 0 ? `${v}% 減` : `${-v}% 増`;
    case "expense": return rough ? (man ? `約${man}万円` : "1万円未満") : yen(v);
    case "balance":
      if (rough) return man ? `${v > 0 ? "+" : "−"}約${man}万円` : "±1万円未満";
      return (v > 0 ? "+" : v < 0 ? "−" : "") + yen(Math.abs(v));
  }
}

function renderRanking() {
  const ctx = Ranking.context(today());
  const mine = { ...Ranking.computeCard(data, today(), "exact"), name: data.settings.nickname || "あなた" };
  const people = [{ me: true, card: mine }, ...data.friends.map((f) => ({ me: false, card: f }))];

  const share = h(`<section class="card"><h2>知り合いと見せ合う</h2>
    <p class="hint">自分の成績を「コード」にして LINE などで送り、相手から届いたコードを貼ると、ここに並びます。送るのは名前と指標の数字と使っているスキンだけで、記録の中身は送りません。</p>
    <div class="actions"><button class="btn" data-act="paste">コードを貼る</button><button class="btn primary" data-act="send">自分の成績を送る</button></div>
  </section>`);
  share.querySelector("[data-act=send]").addEventListener("click", openSendCard);
  share.querySelector("[data-act=paste]").addEventListener("click", openPasteCode);
  view.appendChild(share);

  const metric = Ranking.METRICS.find((x) => x.key === rankMetric) || Ranking.METRICS[0];
  const rsec = h(`<section class="card"><div class="chips metric-chips"></div><p class="hint"></p><ol class="rank-list"></ol></section>`);
  for (const x of Ranking.METRICS) {
    const b = h(`<button type="button" class="chip${x === metric ? " on" : ""}">${esc(x.label)}</button>`);
    b.addEventListener("click", () => { rankMetric = x.key; render(); });
    rsec.querySelector(".chips").appendChild(b);
  }
  const period = metric.period === "prev" ? ctx.p : metric.period === "month" ? ctx.m : null;
  rsec.querySelector(".hint").textContent = metric.desc + (period ? `（${monthTitle(period)}の数字）` : "");
  const ol = rsec.querySelector(".rank-list");
  for (const r of Ranking.rank(people, metric, ctx)) {
    ol.appendChild(h(`<li class="${r.me ? "me" : ""}">
      <span class="rk-no${r.rank && r.rank <= 3 ? " top" + r.rank : ""}">${r.rank || "–"}</span>
      <span class="rk-name"><span>${skinDot(r.card.skin)}${esc(r.card.name)}${r.me ? '<span class="tag">自分</span>' : ""}</span>${r.me ? "" : `<span class="rk-sub">${esc(shortDate(r.card.at))}の成績${Skins.has(r.card.skin) ? `・${esc(Skins.get(r.card.skin).name)}` : ""}</span>`}</span>
      <span class="rk-val">${r.value != null ? esc(metricText(metric, r.value, !r.me && r.card.amount === "rough")) : `<span class="muted">${esc(r.why)}</span>`}</span>
    </li>`));
  }
  if (!data.friends.length) rsec.appendChild(h(`<p class="muted">まだ自分だけです。「自分の成績を送る」で知り合いに送り、相手にも送ってもらいましょう。</p>`));
  view.appendChild(rsec);

  if (data.friends.length) {
    const fsec = h(`<section class="card"><h2>友だち（${data.friends.length}人）</h2><ul class="friend-list"></ul>
      <p class="hint">数字を新しくするには、相手にもう一度コードを送ってもらって貼ります。</p></section>`);
    for (const f of data.friends.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"))) {
      const li = h(`<li><span class="fl-name">${esc(f.name)}</span><span class="muted">${esc(shortDate(f.at))}の成績</span><button class="icon-btn del" aria-label="${esc(f.name)}を外す">✕</button></li>`);
      li.querySelector("button").addEventListener("click", () => {
        if (!confirm(`「${f.name}」をランキングから外しますか？`)) return;
        data.friends.splice(data.friends.indexOf(f), 1);
        save(); render();
        toast("外しました");
      });
      fsec.querySelector("ul").appendChild(li);
    }
    view.appendChild(fsec);
  }
}

// 送る前に、名前と自分の id を用意する（id は友だちの端末で同じ人だと分かるための乱数）
function ensureProfile() {
  if (!data.settings.myId) data.settings.myId = Store.newId();
  if (!data.settings.nickname) {
    const n = prompt(`ランキングに出す名前を決めてください（${Ranking.NAME_MAX}文字まで。あとで「設定」で変えられます）`);
    if (!n || !n.trim()) { save(); return false; }
    data.settings.nickname = n.trim().slice(0, Ranking.NAME_MAX);
  }
  save();
  return true;
}

function openSendCard() {
  if (!ensureProfile()) return;
  const card = Ranking.computeCard(data, today(), data.settings.shareAmount);
  const wrap = h(`<div><div class="sheet-head"><h2>送る内容</h2><button class="icon-btn" aria-label="閉じる">✕</button></div>
    <p class="hint">名前「${esc(card.name)}」と、下の数字とスキンだけを送ります。金額の見せ方（いまは「${AMOUNT_NAME[card.amount]}」）は「設定」で変えられます。</p>
    <ul class="legend"></ul>
    <div class="actions"><button class="btn primary" data-act="share">送る</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  for (const m of Ranking.METRICS) {
    const v = card[m.key];
    const text = m.money && card.amount === "hidden" ? "見せない" : v == null ? "記録が足りない" : metricText(m, v, card.amount === "rough");
    wrap.querySelector("ul").appendChild(h(`<li><span class="lg-name">${esc(m.label)}</span><span class="lg-amt">${esc(text)}</span></li>`));
  }
  wrap.querySelector("ul").appendChild(h(`<li><span class="lg-name">スキン</span><span class="lg-amt">${skinDot(card.skin)}${esc(Skins.get(card.skin).name)}</span></li>`));
  wrap.querySelector("[data-act=share]").addEventListener("click", () => shareCard(card, wrap));
  openSheet(wrap);
}

async function shareCard(card, wrap) {
  const text = `家計簿アプリのランキング用の成績です（${card.name}・${shortDate(card.at)}）\n` +
    `アプリの「ランキング」→「コードを貼る」に、このメッセージをまるごと貼ってください。\n` +
    `${Ranking.encode(card)}\nアプリ：${new URL("./", location.href).href}`;
  // iPhone では共有シートが開き、LINE などを選べる
  if (navigator.share) {
    try { await navigator.share({ text }); closeSheet(); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    closeSheet();
    toast("コピーしました。LINE などに貼って送ってください");
    return;
  } catch (e) { /* 下で手でコピーしてもらう */ }
  if (!wrap.querySelector(".code-box")) {
    const ta = h(`<textarea class="code-box" readonly aria-label="送る文章"></textarea>`);
    ta.value = text;
    wrap.appendChild(ta);
    ta.select();
  }
  toast("下の文章を長押ししてコピーしてください");
}

function openPasteCode() {
  const wrap = h(`<div><div class="sheet-head"><h2>コードを貼る</h2><button class="icon-btn" aria-label="閉じる">✕</button></div>
    <p class="hint">友だちから届いたメッセージを、まるごと貼り付けてください。</p>
    <textarea class="code-box" placeholder="ここを長押しして「ペースト」" aria-label="届いたコード"></textarea>
    <div class="actions"><button class="btn primary" data-act="add">追加する</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  wrap.querySelector("[data-act=add]").addEventListener("click", () => {
    const card = Ranking.decode(wrap.querySelector(".code-box").value);
    if (!card) return toast("コードが読み取れませんでした");
    if (card.id === data.settings.myId) return toast("これは自分のコードです");
    const r = Ranking.addFriend(data.friends, card, new Date().toISOString());
    if (r === "older") return toast(`${card.name}さんのもっと新しい成績がもう入っています`);
    save(); closeSheet(); render();
    toast(r === "added" ? `${card.name}さんを追加しました` : `${card.name}さんの成績を新しくしました`);
  });
  openSheet(wrap);
}

// ---------- スキン（仕様書 D31） ----------
let skinNews = []; // 手に入れて、まだ知らせていないスキン
function checkSkins() {
  const got = Skins.check(data, today());
  Store.save(data); // save() を通すとここへ戻ってくるので直接書く（使い始めた日もここで入る）
  if (!got.length) return;
  skinNews.push(...got);
  setTimeout(showSkinNews, 0); // 「記録しました」などの案内のあとに出す
}
function skinDot(id) {
  if (!Skins.has(id)) return "";
  return `<span class="skin-dot" style="background:${Skins.colors(Skins.get(id)).accent}" aria-hidden="true"></span>`;
}
// スキンの見本（小さな画面の絵）
function skinPreview(s) {
  const c = Skins.colors(s);
  return `<span class="sk-prev" style="background:${c.bg};border-color:${c.line}"><span style="background:${c.card};border-color:${c.line}"><i style="background:${c.accent}"></i><b style="background:${c.track}"></b></span></span>`;
}
function useSkin(id) {
  data.settings.skin = id;
  Skins.apply(id);
  save();
}
// 手に入れたスキンを知らせる。ほかの画面が開いているときは、閉じたあとに出す（closeSheet から呼ばれる）
function showSkinNews() {
  if (!skinNews.length || !sheet.hidden) return;
  const list = skinNews;
  skinNews = [];
  const wrap = h(`<div><div class="sheet-head"><h2>新しいスキンを手に入れました</h2><button class="icon-btn" aria-label="閉じる">✕</button></div>
    <ul class="skin-news"></ul><p class="hint">スキンは「設定」でいつでも変えられます。</p></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  for (const s of list) {
    const li = h(`<li>${skinPreview(s)}<span class="sn-main"><b>${esc(s.name)}</b><span class="muted">${esc(s.cond || "")}</span></span><button class="btn primary">使う</button></li>`);
    li.querySelector("button").addEventListener("click", () => {
      useSkin(s.id);
      closeSheet(); render();
      toast(`スキンを「${s.name}」にしました`);
    });
    wrap.querySelector("ul").appendChild(li);
  }
  openSheet(wrap);
}
function renderSkins() {
  const f = Skins.facts(data, today());
  const sec = h(`<section class="card"><h2>スキン</h2><p class="hint">続けて記録したり、友だちと見せ合ったりすると増えます。押すと切り替わります。</p></section>`);
  for (const [kind, label] of Skins.KINDS) {
    // レアスキンは手に入れるまで並べない
    const list = Skins.LIST.filter((s) => s.kind === kind && (!s.rare || Skins.owned(data, s.id)));
    if (!list.length) continue;
    const grid = h(`<div><p class="field-label">${esc(label)}</p><div class="skin-grid"></div></div>`);
    for (const s of list) {
      const have = Skins.owned(data, s.id);
      const on = data.settings.skin === s.id;
      const pr = have ? null : Skins.progress(s, f);
      const b = h(`<button type="button" class="skin${on ? " on" : ""}${have ? "" : " locked"}" ${have ? "" : "aria-disabled=\"true\""}>
        ${skinPreview(s)}
        <span class="sk-name">${have ? "" : "🔒 "}${esc(s.name)}${s.rare ? '<span class="tag">レア</span>' : ""}</span>
        ${on ? '<span class="sk-sub">使用中</span>' : have ? "" : `<span class="sk-sub">${esc(s.cond)}${pr ? `<br>いま ${pr.now}/${pr.need}${esc(pr.unit)}` : ""}</span>`}
      </button>`);
      b.addEventListener("click", () => {
        if (!have) return toast(`条件：${s.cond}`);
        if (on) return;
        useSkin(s.id);
        render();
        toast(`スキンを「${s.name}」にしました`);
      });
      grid.querySelector(".skin-grid").appendChild(b);
    }
    sec.appendChild(grid);
  }
  const secret = Skins.LIST.filter((s) => s.rare && !Skins.owned(data, s.id)).length;
  if (secret) sec.appendChild(h(`<p class="hint">ほかに、条件がひみつのスキンが あと ${secret} 個あります。</p>`));
  view.appendChild(sec);
}

// ---------- 設定タブ ----------
function renderSettings() {
  renderSkins();

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

  // よく使う記録（仕様書 D32）
  const psec = h(`<section class="card"><h2>よく使う記録</h2>
    <p class="hint">入力タブの「よく使う記録」に並ぶボタンです。押して変えたり外したりできます。</p>
    <ul class="preset-list"></ul>
    <div class="actions"><button class="btn" data-act="add-preset">＋ 足す</button></div>
  </section>`);
  const pl = psec.querySelector(".preset-list");
  if (!data.presets.length) pl.appendChild(h(`<li class="muted">まだありません。</li>`));
  data.presets.forEach((p, i) => {
    const li = h(`<li><button class="rec-row ${p.type}">
      <span class="er-main"><span class="er-cat">${esc(presetName(p))}</span>${p.memo ? `<span class="er-memo">${esc(catName(p.type, p.cat))}</span>` : ""}</span>
      <span class="er-amt">${p.amount ? (p.type === "income" ? "+" : "") + yen(p.amount) : '<span class="muted">金額はそのつど</span>'}</span>
    </button>
    <button class="icon-btn" data-m="-1" aria-label="上へ" ${i === 0 ? "disabled" : ""}>↑</button>
    <button class="icon-btn" data-m="1" aria-label="下へ" ${i === data.presets.length - 1 ? "disabled" : ""}>↓</button></li>`);
    li.querySelector(".rec-row").addEventListener("click", () => openPreset(p.id));
    li.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => movePreset(p, Number(b.dataset.m))));
    pl.appendChild(li);
  });
  psec.querySelector("[data-act=add-preset]").addEventListener("click", () => openPreset(null));
  view.appendChild(psec);

  // 固定費
  const rsec = h(`<section class="card"><h2>固定費（毎月）</h2>
    <p class="hint">登録した日が来ると、アプリを開いたときに記録が自動で入ります。登録を変えたり消したりしても、もう入った記録はそのままです。</p>
    <ul class="rec-list"></ul>
    <div class="actions"><button class="btn" data-act="add-rec">＋ 固定費を足す</button></div>
  </section>`);
  const rl = rsec.querySelector(".rec-list");
  const recs = data.recurring.slice().sort((a, b) => a.day - b.day);
  if (!recs.length) rl.appendChild(h(`<li class="muted">まだありません。</li>`));
  for (const r of recs) {
    const li = h(`<li><button class="rec-row ${r.type}">
      <span class="rr-day">${r.day}日</span>
      <span class="er-main"><span class="er-cat">${esc(catName(r.type, r.cat))}${r.variable ? '<span class="tag">額が変わる</span>' : ""}</span>${r.memo ? `<span class="er-memo">${esc(r.memo)}</span>` : ""}</span>
      <span class="er-amt">${r.type === "income" ? "+" : ""}${yen(r.amount)}</span>
    </button></li>`);
    li.querySelector("button").addEventListener("click", () => openRecurring(r.id));
    rl.appendChild(li);
  }
  rsec.querySelector("[data-act=add-rec]").addEventListener("click", () => openRecurring(null));
  view.appendChild(rsec);

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

  // ランキング
  const nsec = h(`<section class="card"><h2>ランキング</h2>
    <label class="field"><span>ランキングに出す名前</span><input name="nick" maxlength="${Ranking.NAME_MAX}" placeholder="未設定（送るときに聞きます）"></label>
    <p class="field-label">金額（支出額・残ったお金）の見せ方</p>
    <div class="seg2 small"><button data-a="exact">詳しく</button><button data-a="rough">大まかに</button><button data-a="hidden">見せない</button></div>
    <p class="hint">「大まかに」は1万円単位に丸めて送ります。「見せない」にすると、金額のランキングには出ません。日数と割合はいつも送ります。変えたあとに送るコードから反映されます。</p>
  </section>`);
  const nick = nsec.querySelector("[name=nick]");
  nick.value = data.settings.nickname || "";
  nick.addEventListener("change", () => {
    data.settings.nickname = nick.value.trim().slice(0, Ranking.NAME_MAX);
    nick.value = data.settings.nickname;
    save(); toast("名前を変えました");
  });
  nick.addEventListener("keydown", (e) => { if (e.key === "Enter") nick.blur(); });
  nsec.querySelectorAll("[data-a]").forEach((b) => {
    b.classList.toggle("on", b.dataset.a === data.settings.shareAmount);
    b.addEventListener("click", () => { data.settings.shareAmount = b.dataset.a; save(); render(); });
  });
  view.appendChild(nsec);

  // バックアップ
  const last = data.settings.lastExport;
  const overdue = backupOverdue();
  const ksec = h(`<section class="card"><h2>バックアップ</h2>
    <p class="hint">記録はこの端末の中だけにあります。機種変更や万一に備えて、ときどき書き出してください。</p>
    <p>記録 ${data.entries.length} 件　／　最後に書き出した日：${last ? esc(last) : "まだありません"}</p>
    ${overdue != null ? `<p class="notice">${last ? `最後に書き出してから ${overdue} 日たっています。` : "まだ一度も書き出していません。"}</p>` : ""}
    <div class="actions"><button class="btn primary" data-act="export">書き出す</button><button class="btn" data-act="import">読み込む</button></div>
    <input type="file" accept="application/json,.json" hidden>
  </section>`);
  ksec.querySelector("[data-act=export]").addEventListener("click", exportData);
  const file = ksec.querySelector("input[type=file]");
  ksec.querySelector("[data-act=import]").addEventListener("click", () => file.click());
  file.addEventListener("change", () => { if (file.files[0]) importData(file.files[0]); file.value = ""; });
  view.appendChild(ksec);
}

// 固定費の登録・変更（id が null なら新しく足す）
function openRecurring(id) {
  const r = id ? data.recurring.find((x) => x.id === id) : null;
  const wrap = h(`<div><div class="sheet-head"><h2>${r ? "固定費の変更" : "固定費を足す"}</h2><button class="icon-btn" aria-label="閉じる">✕</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  const next = h(`<p class="hint"></p>`);
  wrap.appendChild(next);
  const form = entryForm(
    r ? { ...r } : { type: "expense", cat: null, amount: null, memo: "", day: Number(today().slice(8)), variable: false },
    {
      recurring: true,
      saveLabel: r ? "保存" : "登録する",
      onSave: (v) => {
        // まだ来ていない日を選び直したときに、過ぎた月の分をさかのぼって入れないよう、次に入れる月は「今から最初に来る月」より前にしない
        const first = Store.firstRecMonth(v.day, today());
        if (r) {
          Object.assign(r, v);
          if (r.next < first) r.next = first;
        } else {
          data.recurring.push({ id: "r" + Store.newId(), ...v, next: first });
        }
        save(); closeSheet(); render();
        toast(r ? "固定費を変えました" : `固定費を登録しました（最初は ${dayLabel(Store.recDate(first, v.day))}）`);
        runRecurring(); // 今日の日を選んだときは、その場で入れる
        return false;
      },
      onDelete: r ? () => {
        if (!confirm(`固定費「${catName(r.type, r.cat)} ${yen(r.amount)}」の登録を消しますか？\nもう入っている記録は残ります。`)) return;
        data.recurring.splice(data.recurring.indexOf(r), 1);
        save(); closeSheet(); render();
        toast("登録を消しました");
      } : null,
    }
  );
  // 選んだ日から「次に入る日」を出す
  const daySel = form.querySelector("[name=day]");
  const paintNext = () => {
    const d = Number(daySel.value);
    let key = Store.firstRecMonth(d, today());
    if (r && r.next > key) key = r.next;
    next.textContent = `次に入るのは ${monthTitle(key)}${dayLabel(Store.recDate(key, d)).replace(/^\d+月/, "")} です。`;
  };
  daySel.addEventListener("change", paintNext);
  paintNext();
  wrap.appendChild(form);
  openSheet(wrap);
}

// よく使う記録のボタンの名前：メモがあればメモ、無ければ分類名
function presetName(p) {
  return p.memo || catName(p.type, p.cat);
}

// よく使う記録の登録・変更（id が null なら新しく足す。init は入力タブの形の中身）
function openPreset(id, init) {
  const p = id ? data.presets.find((x) => x.id === id) : null;
  const wrap = h(`<div><div class="sheet-head"><h2>${p ? "よく使う記録の変更" : "よく使う記録を登録"}</h2><button class="icon-btn" aria-label="閉じる">✕</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  const start = p ? { ...p } : { type: "expense", cat: null, amount: null, memo: "", ...(init || {}) };
  wrap.appendChild(entryForm(start, {
    preset: true,
    saveLabel: p ? "保存" : "登録する",
    onSave: (v) => {
      if (p) Object.assign(p, v);
      else data.presets.push({ id: "p" + Store.newId(), ...v });
      save(); closeSheet(); render();
      toast(p ? "変えました" : `「${presetName(v)}」を登録しました`);
      return false;
    },
    onDelete: p ? () => {
      if (!confirm(`「${presetName(p)}」をよく使う記録から外しますか？\nもう入れた記録は残ります。`)) return;
      data.presets.splice(data.presets.indexOf(p), 1);
      save(); closeSheet(); render();
      toast("外しました");
    } : null,
  }));
  openSheet(wrap);
}

function movePreset(p, d) {
  const i = data.presets.indexOf(p), j = i + d;
  if (j < 0 || j >= data.presets.length) return;
  [data.presets[i], data.presets[j]] = [data.presets[j], data.presets[i]];
  save(); render();
}

// ---------- 書き出しの催促（仕様書 D35） ----------
const BACKUP_DAYS = 30; // 最後に書き出してから（まだなら使い始めてから）この日数で知らせる
const BACKUP_ASK_AGAIN = 7; // 「あとで」を選んだら、次に知らせるまでの日数
// 書き出していない日数。知らせる時期でなければ null
function backupOverdue() {
  if (!data.entries.length) return null;
  const base = data.settings.lastExport || data.settings.startedAt;
  if (!base) return null;
  const n = daysBetween(base, today());
  return n >= BACKUP_DAYS ? n : null;
}
function maybeAskBackup() {
  const n = backupOverdue();
  if (n == null || !sheet.hidden) return; // ほかの画面が開いていたら、次に開いたときに回す
  const asked = data.settings.backupAskedAt;
  if (asked && daysBetween(asked, today()) < BACKUP_ASK_AGAIN) return;
  data.settings.backupAskedAt = today();
  save();
  const wrap = h(`<div><div class="sheet-head"><h2>バックアップしませんか</h2><button class="icon-btn" aria-label="閉じる">✕</button></div>
    <p>${data.settings.lastExport ? `最後に書き出してから ${n} 日たちました。` : `使い始めてから ${n} 日、まだ一度も書き出していません。`}</p>
    <p class="hint">記録はこの端末の中にしかありません。機種変更や故障のときに消えないよう、ファイルに書き出しておくと安心です（iPhone では「"ファイル"に保存」を選びます）。</p>
    <div class="actions"><button class="btn" data-act="later">あとで</button><button class="btn primary" data-act="export">書き出す</button></div></div>`);
  wrap.querySelector(".icon-btn").addEventListener("click", closeSheet);
  wrap.querySelector("[data-act=later]").addEventListener("click", closeSheet);
  // 共有シートは押した直後でないと開かないので、先に書き出しを始めてから閉じる
  wrap.querySelector("[data-act=export]").addEventListener("click", () => { exportData(); closeSheet(); });
  openSheet(wrap);
}

// 来た固定費を記録に入れる（開いたとき・アプリに戻ってきたとき）
function runRecurring() {
  const n = Store.applyRecurring(data, today());
  if (n) { save(); render(); toast(`固定費を ${n} 件入れました`); }
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
  const nf = Ranking.mergeFriends(data.friends, incoming.friends);
  save(); render();
  toast(`${r.added} 件を足しました` + (r.skipped ? `（同じ記録 ${r.skipped} 件は飛ばしました）` : "") + (r.broken ? `　壊れた記録 ${r.broken} 件は読めませんでした` : "") + (nf ? `　友だち ${nf} 人` : ""));
}

if (!Skins.owned(data, data.settings.skin)) data.settings.skin = "basic";
Skins.apply(data.settings.skin);
render();
runRecurring();
checkSkins();
// スキンの知らせ（setTimeout 0 で出る）が先。出ていれば催促は次に開いたときに回る
setTimeout(maybeAskBackup, 600);
// ホーム画面のアプリは閉じずに裏へ回るだけのことが多いので、戻ってきたときにも確かめる（季節のスキンもここで）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  runRecurring(); checkSkins();
  setTimeout(maybeAskBackup, 600);
});
// ライト／ダークが切り替わったら、スキンの見本も描き直す（色そのものは skins.js が当て直す）
if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js");
}
