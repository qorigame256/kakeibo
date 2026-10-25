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
      accounts: [], // 銀行口座とカード（仕様書 D36）
      transfers: [], // 口座と現金のあいだのお金の移動（支出・収入には数えない）
      bills: {}, // カードの引き落とし額を手で直したもの（"カードの id:引き落としの月" → 額）
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

  // 残せなかったら、空のデータで上書きして消さないよう、その回は保存を止めて知らせる
  function keepBroken(text) {
    const name = KEY + ".broken." + Date.now();
    const failed = () => { readFailed = true; if (onSaveError) onSaveError(); };
    if (FS) writing = writing.then(() => FS.writeFile({ ...FILE, path: name + ".json", data: text })).catch(failed);
    else try { localStorage.setItem(name, text); } catch (_) { failed(); }
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
        accounts: Array.isArray(d.accounts) ? d.accounts.filter(isAccount) : [],
        transfers: Array.isArray(d.transfers) ? d.transfers.filter(isTransfer) : [],
        bills: cleanBills(d.bills),
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
      // 退避に失敗したと分かるのは書き込みの順番が来てからなので、ここでも確かめる
      writing = writing.then(() => { if (!readFailed) return FS.writeFile({ ...FILE, data: text }); }).catch(() => { if (onSaveError) onSaveError(); });
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
      if (typeof e.acct === "string" && e.acct) add.acct = e.acct;
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
      const add = { id: r.id, type: r.type, cat: r.cat, amount: r.amount, day: r.day, memo: str(r.memo), variable: r.variable === true, shift: r.shift || "none", next: r.next };
      if (typeof r.acct === "string" && r.acct) add.acct = r.acct;
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
      const add = { id: p.id, type: p.type, cat: p.cat, amount: p.amount, memo: str(p.memo) };
      if (typeof p.acct === "string" && p.acct) add.acct = p.acct;
      data.presets.push(add);
      preIds.add(p.id);
    }
    // 口座・カード・お金の移動も今に無い id だけ足し、手で直した引き落とし額は今に無いものだけ入れる
    const accIds = new Set(data.accounts.map((a) => a.id));
    for (const a of arr(incoming.accounts)) {
      if (isAccount(a) && !accIds.has(a.id)) { data.accounts.push(a); accIds.add(a.id); }
    }
    const trIds = new Set(data.transfers.map((t) => t.id));
    for (const t of arr(incoming.transfers)) {
      if (!isTransfer(t) || trIds.has(t.id)) continue;
      data.transfers.push({ id: t.id, date: t.date, amount: t.amount, from: t.from, to: t.to, memo: str(t.memo), createdAt: str(t.createdAt) || null });
      trIds.add(t.id);
    }
    for (const [k, v] of Object.entries(cleanBills(incoming.bills))) if (data.bills[k] == null) data.bills[k] = v;
    return result;
  }

  // 銀行口座：start＝since の日の朝の残高。カード：close＝締め日（31 は月末）、payDay＝引き落とし日、payMonth＝締めの何か月後か、bank＝引き落とし口座
  function isAccount(a) {
    if (!a || typeof a.id !== "string" || typeof a.name !== "string" || !a.name) return false;
    if (a.deleted !== undefined && a.deleted !== true) return false;
    const day = (v) => Number.isInteger(v) && v >= 1 && v <= 31;
    if (a.kind === "bank") return Number.isInteger(a.start) && Math.abs(a.start) <= AMOUNT_MAX && isDate(a.since);
    if (a.kind === "card") return day(a.close) && day(a.payDay) && (a.payMonth === 1 || a.payMonth === 2) && typeof a.bank === "string";
    return false;
  }
  function isTransfer(t) {
    return t && typeof t.id === "string" && isDate(t.date) && isAmount(t.amount) &&
      typeof t.from === "string" && typeof t.to === "string" && t.from !== t.to;
  }
  function cleanBills(b) {
    const out = {};
    if (!b || typeof b !== "object" || Array.isArray(b)) return out;
    for (const [k, v] of Object.entries(b)) {
      if (/^[^:]+:\d{4}-(0[1-9]|1[0-2])$/.test(k) && Number.isInteger(v) && v >= 0 && v <= AMOUNT_MAX) out[k] = v;
    }
    return out;
  }

  // 金額は空（null）でもよい。そのときは押すと入力の形に分類とメモだけ入る
  function isPreset(p) {
    return p && typeof p.id === "string" && (p.type === "expense" || p.type === "income") &&
      typeof p.cat === "string" && (p.amount === null || isAmount(p.amount));
  }

  function isRecurring(r) {
    return r && typeof r.id === "string" && (r.type === "expense" || r.type === "income") &&
      typeof r.cat === "string" && isAmount(r.amount) &&
      Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 && isMonth(r.next) &&
      (r.shift === undefined || SHIFTS.includes(r.shift));
  }
  // 固定費の日が休日のとき：none＝そのまま／before＝前の平日／after＝後の平日（無いものは none）
  const SHIFTS = ["none", "before", "after"];

  // ---------- 固定費 ----------
  // 月 key（YYYY-MM）の day 日。月末を越える日はその月の末日にする
  function recDate(key, day) {
    const [y, m] = key.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return `${key}-${String(Math.min(day, last)).padStart(2, "0")}`;
  }
  // ---------- 休日（土日・祝日・12/31〜1/3） ----------
  // 祝日は 2026 年時点の法律の決まりで計算する（特例で動いた年は合わない。固定費は登録した日から先しか使わないので足りる）
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const holidayCache = new Map();
  function holidays(y) {
    if (holidayCache.has(y)) return holidayCache.get(y);
    const set = new Set();
    // m 月の n 番目の月曜
    const monday = (m, n) => { const w = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - w) % 7) + (n - 1) * 7; };
    const spring = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    const autumn = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
    for (const [m, d] of [[1, 1], [1, monday(1, 2)], [2, 11], [2, 23], [3, spring], [4, 29], [5, 3], [5, 4], [5, 5],
      [7, monday(7, 3)], [8, 11], [9, monday(9, 3)], [9, autumn], [10, monday(10, 2)], [11, 3], [11, 23]]) set.add(ymd(y, m, d));
    const base = [...set].sort();
    for (const s of base) {
      const [, m, d] = s.split("-").map(Number);
      // 振替休日：日曜の祝日のあと、最初の祝日でない日
      if (new Date(y, m - 1, d).getDay() === 0) {
        let n = d + 1;
        while (set.has(ymd(y, m, n))) n++;
        set.add(ymd(y, m, n));
      }
      // 国民の休日：祝日にはさまれた祝日でない日
      const two = new Date(y, m - 1, d + 2);
      if (base.includes(ymd(two.getFullYear(), two.getMonth() + 1, two.getDate())) && !set.has(ymd(y, m, d + 1))) set.add(ymd(y, m, d + 1));
    }
    holidayCache.set(y, set);
    return set;
  }
  function isHoliday(s) {
    const [y, m, d] = s.split("-").map(Number);
    const w = new Date(y, m - 1, d).getDay();
    return w === 0 || w === 6 || (m === 12 && d === 31) || (m === 1 && d <= 3) || holidays(y).has(s);
  }
  function addDays(s, n) {
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(y, m - 1, d + n);
    return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  // 固定費 r の月 key の分が入る日（休日なら shift のとおり前か後の平日へ。月をまたいでもそのまま）
  function recDue(r, key) {
    let s = recDate(key, r.day);
    const step = r.shift === "before" ? -1 : r.shift === "after" ? 1 : 0;
    if (step) while (isHoliday(s)) s = addDays(s, step);
    return s;
  }
  function nextKey(key) {
    const [y, m] = key.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  // 登録した日から見て最初に入る月。その月の日がまだ来ていなければ今月（今日も含む）、過ぎていれば来月。
  // 休日で前の平日へずらすと来月の分も過ぎていることがある（10/31 に登録した「1日・前の平日」の 11月分は 10/30）ので、来るまで進める
  function firstRecMonth(r, todayStr) {
    let key = todayStr.slice(0, 7);
    while (recDue(r, key) < todayStr) key = nextKey(key);
    return key;
  }
  // 今日までに来た固定費の記録を作る。r.next（次に入れる月）を進めるので、消した記録が戻ることはない。作った件数を返す
  function applyRecurring(data, todayStr) {
    let n = 0;
    for (const r of data.recurring) {
      if (!isRecurring(r)) continue;
      while (recDue(r, r.next) <= todayStr) {
        const e = { id: newId(), type: r.type, date: recDue(r, r.next), amount: r.amount, cat: r.cat, memo: r.memo || "", createdAt: new Date().toISOString(), rec: r.id };
        if (r.variable) e.check = true;
        if (r.acct) e.acct = r.acct;
        data.entries.push(e);
        r.next = nextKey(r.next);
        n++;
      }
    }
    return n;
  }

  return { init, load, save, onSaveError: (fn) => { onSaveError = fn; }, newId, merge, fresh, recDate, recDue, nextKey, addDays, isHoliday, firstRecMonth, applyRecurring };
})();
