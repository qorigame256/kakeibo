// ランキング（知り合いどうしの見せ合い。仕様書 D30）。指標の計算と、友だちへ渡す「コード」の作り・読み取り。
// サーバーは使わない。コードに入れるのは計算した数字と名前だけで、記録の中身（日付・メモ・分類）は入れない。
const Ranking = (() => {
  const PREFIX = "KKB1.";
  const NAME_MAX = 12;
  const AMOUNT_MODES = ["exact", "rough", "hidden"]; // 金額の見せ方：詳しく／大まかに（1万円単位）／見せない

  // better: 大きいほど上なら 1、小さいほど上なら -1。period: now＝今の値、month＝今月、prev＝先月の確定値
  const METRICS = [
    { key: "streak", label: "連続記録", period: "now", better: 1, desc: "今日（まだなら昨日）まで、何日続けて記録したか。自動で入った固定費は数えません。" },
    { key: "days", label: "今月の記録日数", period: "month", better: 1, desc: "今月、記録を入れた日の数。自動で入った固定費は数えません。" },
    { key: "save", label: "貯蓄率", period: "prev", better: 1, desc: "先月の収入のうち、使わずに残った割合。収入を記録した人だけが並びます。" },
    { key: "budget", label: "予算達成率", period: "prev", better: 1, desc: "予算を決めた分類のうち、先月予算内に収まった分類の割合。" },
    { key: "cut", label: "節約率", period: "prev", better: 1, desc: "先月の支出が、その前の月より何%減ったか。" },
    { key: "expense", label: "支出額", period: "prev", better: -1, money: true, desc: "先月の支出の合計。少ないほど上です。" },
    { key: "balance", label: "残ったお金", period: "prev", better: 1, money: true, desc: "先月の収入から支出を引いた額。" },
  ];

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function prevDay(s) {
    const [y, m, d] = s.split("-").map(Number);
    return ymd(new Date(y, m - 1, d - 1));
  }
  function shift(key, n) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // 比べる期間：m＝今月、p＝先月
  function context(todayStr) {
    const m = todayStr.slice(0, 7);
    return { m, p: shift(m, -1) };
  }

  // 自分の成績を計算する。amount は金額の見せ方（自分の画面では "exact"）
  function computeCard(data, todayStr, amount) {
    const { m, p } = context(todayStr);
    const pp = shift(m, -2);
    // 記録した日＝手で入れた記録の createdAt の日（端末の時刻）。固定費の自動入力と、createdAt の無い記録は数えない
    const days = new Set();
    for (const e of data.entries) {
      if (e.rec || !e.createdAt) continue;
      const d = new Date(e.createdAt);
      if (!isNaN(d)) days.add(ymd(d));
    }
    let cur = days.has(todayStr) ? todayStr : prevDay(todayStr);
    let streak = 0;
    while (days.has(cur)) { streak++; cur = prevDay(cur); }

    const sum = (key) => {
      const t = { income: 0, expense: 0, byCat: new Map() };
      for (const e of data.entries) {
        if (!e.date.startsWith(key)) continue;
        if (e.type === "income") t.income += e.amount;
        else { t.expense += e.amount; t.byCat.set(e.cat, (t.byCat.get(e.cat) || 0) + e.amount); }
      }
      return t;
    };
    const t = sum(p), t2 = sum(pp);
    const budgeted = data.categories.expense.filter((c) => !c.deleted && data.budgets[c.id] > 0);
    const within = budgeted.filter((c) => (t.byCat.get(c.id) || 0) <= data.budgets[c.id]).length;
    const card = {
      v: 1, id: data.settings.myId || "", name: data.settings.nickname || "", at: todayStr, m, p,
      streak,
      days: [...days].filter((d) => d.startsWith(m)).length,
      save: t.income > 0 ? Math.round(((t.income - t.expense) / t.income) * 100) : null,
      // 支出を1件も記録していない月は「全部予算内」になってしまうので数えない
      budget: budgeted.length && t.expense > 0 ? Math.round((within / budgeted.length) * 100) : null,
      cut: t.expense > 0 && t2.expense > 0 ? Math.round(((t2.expense - t.expense) / t2.expense) * 100) : null,
      expense: t.expense > 0 ? t.expense : null,
      balance: t.income || t.expense ? t.income - t.expense : null,
      amount: AMOUNT_MODES.includes(amount) ? amount : "hidden",
    };
    if (card.amount === "hidden") { card.expense = null; card.balance = null; }
    if (card.amount === "rough") {
      const r = (v) => (v == null ? null : Math.round(v / 10000) * 10000);
      card.expense = r(card.expense); card.balance = r(card.balance);
    }
    return card;
  }

  // ---------- コード（友だちへ渡す文字列） ----------
  function toB64(str) {
    let bin = "";
    for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  }
  function encode(card) {
    return PREFIX + toB64(JSON.stringify(card));
  }
  // 貼られた文章のどこかにあるコードを読む。読めなければ null
  function decode(text) {
    const hit = String(text).match(/KKB1\.([A-Za-z0-9_-]+)/);
    if (!hit) return null;
    try { return normalize(JSON.parse(fromB64(hit[1]))); } catch (e) { return null; }
  }

  // 外から来た成績（コード・バックアップ）を確かめて、決まった形に直す。おかしければ null
  function normalize(c) {
    if (!c || c.v !== 1) return null;
    const intOrNull = (v, lo, hi) => (v == null ? null : Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
    const name = typeof c.name === "string" ? c.name.trim().slice(0, NAME_MAX) : "";
    if (typeof c.id !== "string" || !/^[a-z0-9]{4,24}$/.test(c.id) || !name) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.at) || !/^\d{4}-\d{2}$/.test(c.m) || !/^\d{4}-\d{2}$/.test(c.p)) return null;
    const out = {
      v: 1, id: c.id, name, at: c.at, m: c.m, p: c.p,
      streak: intOrNull(c.streak, 0, 100000), days: intOrNull(c.days, 0, 31),
      save: intOrNull(c.save, -1e9, 100), budget: intOrNull(c.budget, 0, 100), cut: intOrNull(c.cut, -1e9, 100),
      expense: intOrNull(c.expense, 0, 1e12), balance: intOrNull(c.balance, -1e12, 1e12),
      amount: AMOUNT_MODES.includes(c.amount) ? c.amount : "hidden",
    };
    if (Object.values(out).some((v) => v === undefined)) return null;
    if (out.amount === "hidden") { out.expense = null; out.balance = null; }
    return out;
  }

  // 友だちの一覧に足す（同じ id は新しいほうで置き換える）。"added"／"updated"／"older" を返す
  function addFriend(friends, card, receivedAt) {
    const i = friends.findIndex((f) => f.id === card.id);
    if (i < 0) { friends.push({ ...card, receivedAt }); return "added"; }
    if (friends[i].at > card.at) return "older";
    friends[i] = { ...card, receivedAt };
    return "updated";
  }
  // バックアップを読み込んだとき、友だちを足し合わせる。足した・更新した数を返す
  function mergeFriends(friends, incoming) {
    let n = 0;
    for (const f of Array.isArray(incoming) ? incoming : []) {
      const c = normalize(f);
      if (c && addFriend(friends, c, typeof f.receivedAt === "string" ? f.receivedAt : null) !== "older") n++;
    }
    return n;
  }

  // ある指標での1人の値。並べられないときは why（理由）を返す
  function valueOf(card, metric, ctx) {
    if (metric.period === "month" && card.m !== ctx.m) return { why: "今月の数字が未着" };
    if (metric.period === "prev" && card.p !== ctx.p) return { why: "先月の数字が未着" };
    if (metric.money && card.amount === "hidden") return { why: "非公開" };
    const v = card[metric.key];
    return v == null ? { why: "記録が足りない" } : { value: v };
  }
  // people = [{ card, ... }]。値のある人を順位付きで並べ、無い人は後ろに理由付きで付ける（同じ値は同じ順位）
  function rank(people, metric, ctx) {
    const rows = people.map((p) => ({ ...p, ...valueOf(p.card, metric, ctx) }));
    const ranked = rows.filter((r) => r.value != null).sort((a, b) => (b.value - a.value) * metric.better);
    ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1].value === r.value ? ranked[i - 1].rank : i + 1; });
    return [...ranked, ...rows.filter((r) => r.value == null)];
  }

  return { METRICS, NAME_MAX, context, computeCard, encode, decode, normalize, addFriend, mergeFriends, rank };
})();
