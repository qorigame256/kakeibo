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
      friends: [], // ランキングの友だちの成績（仕様書 D30）
      skins: {}, // 手に入れたスキンと手に入れた日（仕様書 D31）
      presets: [], // よく使う記録（仕様書 D32）
      settings: { lastExport: null, nickname: "", myId: null, shareAmount: "hidden", skin: "basic", startedAt: null, backupAskedAt: null },
    };
  }

  // 保存先。ストア版（Capacitor の入れ物の中）は iPhone アプリ用のファイル、それ以外（PWA）は localStorage（仕様書 D24）。
  // iOS は容量が足りないとき、アプリの中のブラウザの保存（localStorage）を消すことがあるため
  const FS = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.Filesystem : null;
  const FILE = { path: KEY + ".json", directory: "LIBRARY", encoding: "utf8" };
  let raw = null; // init() で読んだ中身
  let readFailed = false; // ファイルはあるのに読めなかった。上書きで消さないよう保存を止める
  let writing = Promise.resolve(); // ファイルへの書き込みを順番に並べる
  let onSaveError = null;

  // 起動のときに1回だけ呼ぶ。ファイルの読み込みは待ちが要るので、load() より先にここで読んでおく。
  // ファイルはあるのに読めなかったときだけ false を返す
  async function init() {
    if (!FS) {
      try { raw = localStorage.getItem(KEY); } catch (e) { /* 読めないときは空で始める */ }
      return true;
    }
    try { await FS.stat(FILE); } catch (e) { return true; } // まだ無い（初めて開いた）
    try { raw = (await FS.readFile(FILE)).data; } catch (e) { readFailed = true; }
    return !readFailed;
  }

  function keepBroken(text) {
    const name = KEY + ".broken." + Date.now();
    if (FS) FS.writeFile({ ...FILE, path: name + ".json", data: text }).catch(() => {});
    else try { localStorage.setItem(name, text); } catch (_) {}
  }

  function load() {
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
        friends: Array.isArray(d.friends) ? d.friends : [],
        skins: d.skins && typeof d.skins === "object" && !Array.isArray(d.skins) ? d.skins : {},
        presets: Array.isArray(d.presets) ? d.presets.filter(isPreset) : [],
        settings: { ...base.settings, ...(d.settings || {}) },
      };
    } catch (e) {
      // 壊れていても上書きで消さないよう、退避してから空で始める
      keepBroken(raw);
      return fresh();
    }
  }

  // ファイルへの書き込みは待たずに true を返す。失敗したら onSaveError で渡した関数で知らせる
  function save(data) {
    if (readFailed) return false;
    const text = JSON.stringify(data);
    if (FS) {
      writing = writing.then(() => FS.writeFile({ ...FILE, data: text })).catch(() => { if (onSaveError) onSaveError(); });
      return true;
    }
    try {
      localStorage.setItem(KEY, text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // 読み込むファイルは手で書き換えられていることもあるので、形だけでなく中身（実在する日付・月、金額の上限）も確かめる
  const AMOUNT_MAX = 99999999;
  const str = (v) => (typeof v === "string" ? v : "");
  const arr = (v) => (Array.isArray(v) ? v : []);
  function isDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  }
  const SKIN_ID = /^[a-z0-9-]{1,24}$/;
  const isMonth = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const isAmount = (v) => Number.isInteger(v) && v > 0 && v <= AMOUNT_MAX;
  const isCat = (c) => c && typeof c.id === "string" && typeof c.name === "string";
  const cleanCat = (c) => (c.deleted ? { id: c.id, name: c.name, deleted: true } : { id: c.id, name: c.name });

  function isEntry(e) {
    return e && typeof e.id === "string" && (e.type === "expense" || e.type === "income") &&
      isDate(e.date) && isAmount(e.amount) && typeof e.cat === "string";
  }

  // 読み込んだバックアップを今のデータに足し合わせる。足した件数と飛ばした件数を返す
  function merge(data, incoming) {
    const result = { added: 0, skipped: 0, broken: 0 };
    // 記録が1件も無い端末（機種変更の直後など）では、分類の名前・並び・削除済みの印もバックアップどおりに戻す
    if (data.entries.length === 0) {
      for (const type of ["expense", "income"]) {
        const list = arr(incoming.categories?.[type]).filter(isCat);
        if (!list.some((c) => !c.deleted)) continue;
        // バックアップに無い今の分類は後ろに残す（分類はデータから消さない。先に登録した固定費が使っていることもある）
        const ids = new Set(list.map((c) => c.id));
        data.categories[type] = list.map(cleanCat).concat(data.categories[type].filter((c) => !ids.has(c.id)));
      }
      // ランキングの名前と id も引き継ぐ（id が変わると、友だちの端末で別の人として並んでしまうため）
      const s = incoming.settings && typeof incoming.settings === "object" ? incoming.settings : {};
      if (typeof s.myId === "string" && /^[a-z0-9]{4,24}$/.test(s.myId)) data.settings.myId = s.myId;
      if (typeof s.nickname === "string" && s.nickname) data.settings.nickname = s.nickname;
      if (["exact", "rough", "hidden"].includes(s.shareAmount)) data.settings.shareAmount = s.shareAmount;
      if (typeof s.skin === "string" && SKIN_ID.test(s.skin)) data.settings.skin = s.skin; // 持っているかは画面側で確かめる
    }
    // 手に入れたスキンは足し合わせ、使い始めた日は古いほうにする
    if (incoming.skins && typeof incoming.skins === "object") {
      for (const [id, d] of Object.entries(incoming.skins)) {
        if (SKIN_ID.test(id) && isDate(d) && !data.skins[id]) data.skins[id] = d;
      }
    }
    const started = incoming.settings?.startedAt;
    if (isDate(started) && (!data.settings.startedAt || started < data.settings.startedAt)) data.settings.startedAt = started;
    const have = new Set(data.entries.map((e) => e.id));
    for (const e of arr(incoming.entries)) {
      if (!isEntry(e)) { result.broken++; continue; }
      if (have.has(e.id)) { result.skipped++; continue; }
      const add = { id: e.id, type: e.type, date: e.date, amount: e.amount, cat: e.cat, memo: str(e.memo), createdAt: str(e.createdAt) || null };
      if (typeof e.rec === "string") add.rec = e.rec;
      if (e.check === true) add.check = true;
      data.entries.push(add);
      have.add(e.id);
      result.added++;
    }
    for (const type of ["expense", "income"]) {
      const list = data.categories[type];
      const ids = new Set(list.map((c) => c.id));
      for (const c of arr(incoming.categories?.[type])) {
        if (isCat(c) && !ids.has(c.id)) {
          list.push(cleanCat(c));
          ids.add(c.id);
        }
      }
    }
    if (incoming.budgets && typeof incoming.budgets === "object") {
      for (const [id, v] of Object.entries(incoming.budgets)) {
        if (data.budgets[id] == null && isAmount(v)) data.budgets[id] = v;
      }
    }
    // 固定費は今に無い id だけ足す（同じ id は今の登録のまま）
    const recIds = new Set(data.recurring.map((r) => r.id));
    for (const r of arr(incoming.recurring)) {
      if (!isRecurring(r) || recIds.has(r.id)) continue;
      const add = { id: r.id, type: r.type, cat: r.cat, amount: r.amount, day: r.day, memo: str(r.memo), variable: r.variable === true, next: r.next };
      // 古いバックアップの next のままだと、そのあと入った月の分をまた入れてしまうので、入っている最後の月の次まで進める
      for (const e of data.entries) {
        if (e.rec === r.id && e.date.slice(0, 7) >= add.next) add.next = nextKey(e.date.slice(0, 7));
      }
      data.recurring.push(add);
      recIds.add(r.id);
    }
    // よく使う記録も今に無い id だけ足す
    const preIds = new Set(data.presets.map((p) => p.id));
    for (const p of arr(incoming.presets)) {
      if (!isPreset(p) || preIds.has(p.id)) continue;
      data.presets.push({ id: p.id, type: p.type, cat: p.cat, amount: p.amount, memo: str(p.memo) });
      preIds.add(p.id);
    }
    return result;
  }

  // 金額は空（null）でもよい。そのときは押すと入力の形に分類とメモだけ入る
  function isPreset(p) {
    return p && typeof p.id === "string" && (p.type === "expense" || p.type === "income") &&
      typeof p.cat === "string" && (p.amount === null || isAmount(p.amount));
  }

  function isRecurring(r) {
    return r && typeof r.id === "string" && (r.type === "expense" || r.type === "income") &&
      typeof r.cat === "string" && isAmount(r.amount) &&
      Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 && isMonth(r.next);
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

  return { init, load, save, onSaveError: (fn) => { onSaveError = fn; }, newId, merge, fresh, recDate, firstRecMonth, applyRecurring };
})();
