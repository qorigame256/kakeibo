// 保存・読み込み・データの初期値。端末の保存場所に触るのはこのファイルだけ
// （App Store 用に包むとき、保存先をここだけ差し替えれば済むようにするため）。
const Store = (() => {
  const KEY = "kakeibo.v1";

  const DEFAULT_CATEGORIES = {
    expense: [
      ["e-food", "食費"], ["e-daily", "日用品"], ["e-transport", "交通"], ["e-housing", "住居"],
      ["e-utility", "水道光熱"], ["e-phone", "通信"], ["e-medical", "医療"], ["e-fun", "娯楽"],
      ["e-clothes", "衣服"], ["e-social", "交際"], ["e-other", "その他"],
    ].map(([id, name]) => ({ id, name })),
    income: [
      ["i-salary", "給料"], ["i-bonus", "賞与"], ["i-extra", "臨時収入"], ["i-other", "その他"],
    ].map(([id, name]) => ({ id, name })),
  };

  function fresh() {
    return {
      version: 1,
      entries: [],
      categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      budgets: {},
      recurring: [],
      settings: { lastExport: null },
    };
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* 読めないときは空で始める */ }
    if (!raw) return fresh();
    try {
      const d = JSON.parse(raw);
      const base = fresh();
      return {
        version: 1,
        entries: Array.isArray(d.entries) ? d.entries : [],
        categories: {
          expense: Array.isArray(d.categories?.expense) ? d.categories.expense : base.categories.expense,
          income: Array.isArray(d.categories?.income) ? d.categories.income : base.categories.income,
        },
        budgets: d.budgets && typeof d.budgets === "object" ? d.budgets : {},
        recurring: Array.isArray(d.recurring) ? d.recurring : [],
        settings: { ...base.settings, ...(d.settings || {}) },
      };
    } catch (e) {
      // 壊れていても上書きで消さないよう、退避してから空で始める
      try { localStorage.setItem(KEY + ".broken." + Date.now(), raw); } catch (_) {}
      return fresh();
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function isEntry(e) {
    return e && typeof e.id === "string" && (e.type === "expense" || e.type === "income") &&
      /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isInteger(e.amount) && e.amount > 0 &&
      typeof e.cat === "string";
  }

  // 読み込んだバックアップを今のデータに足し合わせる。足した件数と飛ばした件数を返す
  function merge(data, incoming) {
    const result = { added: 0, skipped: 0, broken: 0 };
    // 記録が1件も無い端末（機種変更の直後など）では、分類の名前・並び・削除済みの印もバックアップどおりに戻す
    if (data.entries.length === 0) {
      for (const type of ["expense", "income"]) {
        const list = (incoming.categories?.[type] || []).filter((c) => c && typeof c.id === "string" && typeof c.name === "string");
        if (list.some((c) => !c.deleted)) data.categories[type] = list.map((c) => (c.deleted ? { id: c.id, name: c.name, deleted: true } : { id: c.id, name: c.name }));
      }
    }
    const have = new Set(data.entries.map((e) => e.id));
    for (const e of incoming.entries || []) {
      if (!isEntry(e)) { result.broken++; continue; }
      if (have.has(e.id)) { result.skipped++; continue; }
      const add = { id: e.id, type: e.type, date: e.date, amount: e.amount, cat: e.cat, memo: String(e.memo || ""), createdAt: e.createdAt || null };
      if (typeof e.rec === "string") add.rec = e.rec;
      if (e.check === true) add.check = true;
      data.entries.push(add);
      have.add(e.id);
      result.added++;
    }
    for (const type of ["expense", "income"]) {
      const list = data.categories[type];
      const ids = new Set(list.map((c) => c.id));
      for (const c of incoming.categories?.[type] || []) {
        if (c && typeof c.id === "string" && typeof c.name === "string" && !ids.has(c.id)) {
          list.push(c.deleted ? { id: c.id, name: c.name, deleted: true } : { id: c.id, name: c.name });
          ids.add(c.id);
        }
      }
    }
    for (const [id, v] of Object.entries(incoming.budgets || {})) {
      if (data.budgets[id] == null && Number.isInteger(v) && v > 0) data.budgets[id] = v;
    }
    // 固定費は今に無い id だけ足す（同じ id は今の登録のまま）
    const recIds = new Set(data.recurring.map((r) => r.id));
    for (const r of incoming.recurring || []) {
      if (isRecurring(r) && !recIds.has(r.id)) { data.recurring.push({ ...r }); recIds.add(r.id); }
    }
    return result;
  }

  function isRecurring(r) {
    return r && typeof r.id === "string" && (r.type === "expense" || r.type === "income") &&
      typeof r.cat === "string" && Number.isInteger(r.amount) && r.amount > 0 &&
      Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 && /^\d{4}-\d{2}$/.test(r.next);
  }

  // ---------- 固定費 ----------
  // 月 key（YYYY-MM）の day 日。月末を越える日はその月の末日にする
  function recDate(key, day) {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${key}-${String(Math.min(day, last)).padStart(2, "0")}`;
  }
  function nextKey(key) {
    const [y, m] = key.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  // 登録した日から見て最初に入る月。その月の日がまだ来ていなければ今月（今日も含む）、過ぎていれば来月
  function firstRecMonth(day, todayStr) {
    const key = todayStr.slice(0, 7);
    return recDate(key, day) >= todayStr ? key : nextKey(key);
  }
  // 今日までに来た固定費の記録を作る。r.next（次に入れる月）を進めるので、消した記録が戻ることはない。作った件数を返す
  function applyRecurring(data, todayStr) {
    let n = 0;
    for (const r of data.recurring) {
      if (!isRecurring(r)) continue;
      while (recDate(r.next, r.day) <= todayStr) {
        const e = { id: newId(), type: r.type, date: recDate(r.next, r.day), amount: r.amount, cat: r.cat, memo: r.memo || "", createdAt: new Date().toISOString(), rec: r.id };
        if (r.variable) e.check = true;
        data.entries.push(e);
        r.next = nextKey(r.next);
        n++;
      }
    }
    return n;
  }

  return { load, save, newId, merge, fresh, recDate, firstRecMonth, applyRecurring };
})();
