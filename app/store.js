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
      data.entries.push({ id: e.id, type: e.type, date: e.date, amount: e.amount, cat: e.cat, memo: String(e.memo || ""), createdAt: e.createdAt || null });
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
    return result;
  }

  return { load, save, newId, merge, fresh };
})();
