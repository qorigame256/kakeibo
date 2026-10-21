// スキン（画面の色の着せ替え。仕様書 D31）。一覧・色・手に入れる条件の判定と、色の当て方。
// 変えるのは画面の地の色だけ。グラフと分類の色は変えない（分類の色を覚えている人が迷わないように）。
const Skins = (() => {
  const KINDS = [
    ["start", "最初から"], ["record", "記録"], ["friend", "知り合い"], ["rank", "ランキング"], ["season", "季節"], ["other", "その他"],
  ];
  // 色は [背景, 枠, 線, 強調色, 棒の地, 切り替えの選ばれた側] をライト・ダークの順に。強調色の上の文字色は明るさから決める
  // need: 進み具合の目標（数で表せるものだけ）。rare: 手に入れるまで並ばず、条件も見せない（どれをレアにするかは仕様書 U3。今は AI の仮置き）
  const LIST = [
    // いつもの：style.css の :root と同じ色（見本の表示用。当てるときは style.css に任せる）
    { id: "basic", name: "いつもの", kind: "start", light: ["#f6f5f2", "#fcfcfb", "#e4e2dc", "#2a78d6", "#e9e7e1", "#ffffff"], dark: ["#151514", "#1f1f1d", "#34332f", "#3987e5", "#2e2d2a", "#4a4945"] },
    { id: "midori", name: "みどり", kind: "start", light: ["#f2f6f1", "#fbfdfa", "#dce6da", "#1f8a5b", "#e2ebe0", "#ffffff"], dark: ["#111612", "#1a211b", "#2d382e", "#3aa874", "#273028", "#3c4a3d"] },
    { id: "mono", name: "モノクロ", kind: "start", light: ["#f4f4f4", "#ffffff", "#e0e0e0", "#2b2b2b", "#e6e6e6", "#ffffff"], dark: ["#111111", "#1c1c1c", "#333333", "#d6d6d6", "#2a2a2a", "#474747"] },

    { id: "tamago", name: "たまご", kind: "record", cond: "初めて手で記録する", need: 1, value: (f) => f.totalDays, light: ["#fbf7ec", "#fffdf7", "#ece3cf", "#8a5a2b", "#efe7d5", "#ffffff"], dark: ["#17140e", "#221e16", "#3b3427", "#c08850", "#2d2820", "#4a4234"] },
    { id: "sora", name: "そら", kind: "record", cond: "7日続けて記録する", need: 7, value: (f) => f.maxStreak, unit: "日", light: ["#eff6f9", "#fbfdfe", "#d8e6eb", "#0a7fa8", "#e0ecf0", "#ffffff"], dark: ["#0e1518", "#162024", "#29383e", "#2a9fc8", "#212e33", "#38494f"] },
    { id: "lavender", name: "ラベンダー", kind: "record", cond: "30日続けて記録する", need: 30, value: (f) => f.maxStreak, unit: "日", light: ["#f5f3fa", "#fdfcff", "#e3def0", "#6a4fc7", "#e9e5f3", "#ffffff"], dark: ["#141219", "#1d1a24", "#332e40", "#8f78e8", "#2a2635", "#463f56"] },
    { id: "platinum", name: "プラチナ", kind: "record", cond: "100日続けて記録する", need: 100, value: (f) => f.maxStreak, unit: "日", light: ["#f2f4f6", "#fcfdfe", "#dde2e7", "#4f6378", "#e4e8ec", "#ffffff"], dark: ["#121417", "#1b1e22", "#2f343a", "#8fa3b8", "#272b30", "#41474f"] },
    { id: "azuki", name: "あずき", kind: "record", cond: "記録した日が通算100日（途切れても数えます）", need: 100, value: (f) => f.totalDays, unit: "日", light: ["#f8f1f2", "#fffbfb", "#ead7db", "#8e2f45", "#efdfe2", "#ffffff"], dark: ["#170f11", "#22171a", "#3d2a2f", "#c95a73", "#2f2125", "#4c363c"] },
    { id: "kon", name: "紺", kind: "record", cond: "3か月続けて、予算を決めた分類を全部守る", need: 3, value: (f) => f.budgetRun, unit: "か月", light: ["#f1f3f9", "#fcfdff", "#dbe0ee", "#1f3f8f", "#e2e6f1", "#ffffff"], dark: ["#0e1119", "#161b27", "#293145", "#5b7fd8", "#212939", "#36405a"] },
    { id: "aotake", name: "青竹", kind: "record", cond: "3か月続けて黒字（収入 − 支出がプラス）", need: 3, value: (f) => f.blackRun, unit: "か月", light: ["#eef6f3", "#fafdfc", "#d4e6df", "#00796b", "#dcebe5", "#ffffff"], dark: ["#0c1613", "#14211d", "#253a33", "#26a593", "#1e2e29", "#32483f"] },

    { id: "yuyake", name: "夕焼け", kind: "friend", cond: "友だちのコードを初めて貼る", need: 1, value: (f) => f.friends, unit: "人", light: ["#fbf3ee", "#fffaf7", "#f0dbcd", "#c4481f", "#f3e3d8", "#ffffff"], dark: ["#18110d", "#241a14", "#402e23", "#e8693b", "#31241c", "#4f3b2f"] },
    { id: "wakakusa", name: "若草", kind: "friend", cond: "友だちを3人並べる", need: 3, value: (f) => f.friends, unit: "人", light: ["#f4f8ec", "#fcfef8", "#e0e9cf", "#4f7f10", "#e6eed7", "#ffffff"], dark: ["#11150b", "#1a2012", "#2f3a20", "#7cb33a", "#262f1a", "#3e4b2c"] },
    // 本当に送ったかはアプリから分からないので、「送る内容」を開いたとき（そこで作る myId があるか）で見る
    { id: "budou", name: "ぶどう", kind: "friend", cond: "自分のコードを初めて送る", test: (f) => f.sent, light: ["#f7f1f8", "#fefbfe", "#e8d9eb", "#7b2d8e", "#ede0ef", "#ffffff"], dark: ["#150f17", "#201824", "#3a2b3f", "#b867d0", "#2c2131", "#47354e"] },

    { id: "kin", name: "金", kind: "rank", cond: "どれか1つの指標で1位になる（友だち1人以上と比べて）", test: (f) => f.firsts >= 1, light: ["#faf6e8", "#fffdf5", "#ebe2c3", "#8f6c00", "#efe7cc", "#ffffff"], dark: ["#16130a", "#201c10", "#3b331c", "#d4ad2a", "#2c2715", "#4a4226"] },
    { id: "yozora", name: "夜空", kind: "rank", rare: true, cond: "3つの指標で同時に1位になる", test: (f) => f.firsts >= 3, light: ["#eeedf7", "#fbfbff", "#d9d7ea", "#3b2f8f", "#e1dff0", "#ffffff"], dark: ["#0b0a1a", "#15142b", "#2b2950", "#d4af37", "#1f1e3a", "#3a3866"] },

    // 季節：その期間中にアプリを開いたときだけ（月-日。端末の日付）
    { id: "shogatsu", name: "正月", kind: "season", from: "01-01", to: "01-14", light: ["#fbf5ee", "#fffcf7", "#efdfcc", "#c8102e", "#f2e6d6", "#ffffff"], dark: ["#170d0c", "#241514", "#422624", "#e8434f", "#321d1c", "#523230"] },
    { id: "sakura", name: "桜", kind: "season", from: "03-25", to: "04-14", light: ["#fdf3f5", "#fffafb", "#f3dde3", "#b8476d", "#f6e4e9", "#ffffff"], dark: ["#180f12", "#25171c", "#422a32", "#e07a9c", "#32212a", "#503641"] },
    { id: "himawari", name: "ひまわり", kind: "season", from: "08-01", to: "08-21", light: ["#fdf8e3", "#fffdf2", "#f1e6b6", "#a85600", "#f3eac3", "#ffffff"], dark: ["#171407", "#221e0e", "#3e3719", "#f0a020", "#2d2812", "#4b4322"] },
    { id: "momiji", name: "紅葉", kind: "season", from: "11-10", to: "11-30", light: ["#f8efe6", "#fffaf4", "#ecd8c4", "#9c3a12", "#f0e0d0", "#ffffff"], dark: ["#170f0a", "#231812", "#40291d", "#e0602a", "#302018", "#4e3426"] },
    { id: "yuki", name: "雪", kind: "season", from: "12-10", to: "12-31", light: ["#f3f6f9", "#ffffff", "#dde4ec", "#3b6e99", "#e3e9f0", "#ffffff"], dark: ["#0f1318", "#171d24", "#2a3440", "#7aa8d4", "#222a34", "#38444f"] },

    { id: "olive", name: "オリーブ", kind: "other", cond: "バックアップを初めて書き出す", test: (f) => f.exported, light: ["#f5f5ec", "#fdfdf8", "#e3e3cf", "#62621a", "#e9e9d8", "#ffffff"], dark: ["#13130c", "#1d1d14", "#343424", "#b5b552", "#29291c", "#41412e"] },
    { id: "champagne", name: "シャンパン", kind: "other", rare: true, cond: "使い始めて1年", test: (f) => f.anniversary, light: ["#faf5f0", "#fffdfb", "#eadfd4", "#9a5b4b", "#efe5dc", "#ffffff"], dark: ["#16110f", "#211a17", "#3c302b", "#d79a85", "#2e2522", "#4a3c37"] },
  ];
  for (const s of LIST) {
    if (s.kind === "season") s.cond = `${md(s.from)}〜${md(s.to)}にアプリを開く`;
  }
  const byId = new Map(LIST.map((s) => [s.id, s]));
  const VARS = ["--bg", "--card", "--line", "--accent", "--track", "--seg-on"];

  function md(s) {
    const [m, d] = s.split("-").map(Number);
    return `${m}月${d}日`;
  }
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const nextDay = (s) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + 1)); };
  const shift = (key, n) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

  function get(id) { return byId.get(id) || byId.get("basic"); }
  function owned(data, id) {
    const s = byId.get(id);
    return !!s && (s.kind === "start" || !!data.skins[id]);
  }

  // 条件の判定に使う数をまとめて出す
  function facts(data, todayStr) {
    const days = [...Ranking.recordDays(data)].sort();
    let maxStreak = 0, run = 0, prev = null;
    for (const d of days) {
      run = prev && nextDay(prev) === d ? run + 1 : 1;
      if (run > maxStreak) maxStreak = run;
      prev = d;
    }
    // 終わった月ごとの合計（最初の記録の月から先月まで）
    const cur = todayStr.slice(0, 7);
    const sums = new Map();
    for (const e of data.entries) {
      const k = e.date.slice(0, 7);
      if (k >= cur) continue;
      const t = sums.get(k) || { income: 0, expense: 0, byCat: new Map() };
      if (e.type === "income") t.income += e.amount;
      else { t.expense += e.amount; t.byCat.set(e.cat, (t.byCat.get(e.cat) || 0) + e.amount); }
      sums.set(k, t);
    }
    // 予算は今の予算で数える（予算は月ごとに変えないため）。支出の無い月は続きが切れる
    const budgeted = data.categories.expense.filter((c) => !c.deleted && data.budgets[c.id] > 0);
    let budgetRun = 0, blackRun = 0, b = 0, k = 0;
    const months = [...sums.keys()].sort();
    for (let m = months[0]; m && m < cur; m = shift(m, 1)) {
      const t = sums.get(m);
      const ok = t && budgeted.length && t.expense > 0 && budgeted.every((c) => (t.byCat.get(c.id) || 0) <= data.budgets[c.id]);
      b = ok ? b + 1 : 0; if (b > budgetRun) budgetRun = b;
      k = t && t.income - t.expense > 0 ? k + 1 : 0; if (k > blackRun) blackRun = k;
    }
    // 1位になった指標の数（その指標で数字のある友だちが1人以上いるときだけ）
    let firsts = 0;
    if (data.friends.length) {
      const ctx = Ranking.context(todayStr);
      const people = [{ me: true, card: Ranking.computeCard(data, todayStr, "exact") }, ...data.friends.map((c) => ({ me: false, card: c }))];
      for (const metric of Ranking.METRICS) {
        const rows = Ranking.rank(people, metric, ctx);
        if (rows.some((r) => r.me && r.rank === 1) && rows.some((r) => !r.me && r.value != null)) firsts++;
      }
    }
    const started = data.settings.startedAt;
    return {
      totalDays: days.length, maxStreak, budgetRun, blackRun, firsts,
      friends: data.friends.length,
      sent: !!data.settings.myId,
      exported: !!data.settings.lastExport,
      anniversary: !!started && todayStr >= `${Number(started.slice(0, 4)) + 1}${started.slice(4)}`,
      md: todayStr.slice(5),
    };
  }

  function met(s, f) {
    if (s.kind === "start") return true;
    if (s.kind === "season") return f.md >= s.from && f.md <= s.to;
    if (s.test) return s.test(f);
    return s.value(f) >= s.need;
  }

  // 条件を満たしたスキンを手に入れる。新しく手に入れたスキンの一覧を返す（保存は呼ぶ側）
  function check(data, todayStr) {
    // 使い始めた日：最初の記録を入れた日。記録の無いうちは初めて開いた日
    let first = data.settings.startedAt || todayStr;
    for (const e of data.entries) {
      const d = e.createdAt ? new Date(e.createdAt) : null;
      if (d && !isNaN(d) && ymd(d) < first) first = ymd(d);
    }
    data.settings.startedAt = first;
    const f = facts(data, todayStr);
    const got = [];
    for (const s of LIST) {
      if (s.kind === "start" || data.skins[s.id] || !met(s, f)) continue;
      data.skins[s.id] = todayStr;
      got.push(s);
    }
    return got;
  }

  // 一覧の表示用：手に入れていないふつうのスキンの進み具合（数で表せるものだけ）
  function progress(s, f) {
    if (!s.need) return null;
    return { now: Math.min(s.value(f), s.need), need: s.need, unit: s.unit || "" };
  }

  // ---------- 色を当てる ----------
  const darkMQ = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const isDark = () => !!(darkMQ && darkMQ.matches);
  // 強調色の上の文字：白で読みにくい明るい強調色には黒っぽい字
  function inkOn(hex) {
    const lum = (i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lum(1) + 0.7152 * lum(3) + 0.0722 * lum(5);
    return 1.05 / (L + 0.05) >= 3.4 ? "#ffffff" : "#111111";
  }
  // 見本の表示用の色（今の明るさの設定で）
  function colors(s, dark = isDark()) {
    const c = s[dark ? "dark" : "light"];
    return { bg: c[0], card: c[1], line: c[2], accent: c[3], track: c[4], seg: c[5], ink: inkOn(c[3]) };
  }
  let current = "basic";
  function apply(id) {
    current = byId.has(id) ? id : "basic";
    const root = document.documentElement.style;
    const s = get(current);
    for (const v of [...VARS, "--accent-ink"]) root.removeProperty(v);
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (current === "basic") {
      metas.forEach((m) => { if (m.dataset.base) m.content = m.dataset.base; });
      return;
    }
    const c = s[isDark() ? "dark" : "light"];
    VARS.forEach((v, i) => root.setProperty(v, c[i]));
    root.setProperty("--accent-ink", inkOn(c[3]));
    // 画面の上の帯（時計などのところ）の色も背景に合わせる
    metas.forEach((m) => {
      if (!m.dataset.base) m.dataset.base = m.content;
      m.content = s[(m.media || "").includes("dark") ? "dark" : "light"][0];
    });
  }
  if (darkMQ && darkMQ.addEventListener) darkMQ.addEventListener("change", () => apply(current));

  return { LIST, KINDS, get, owned, facts, check, progress, colors, apply, has: (id) => byId.has(id) };
})();
