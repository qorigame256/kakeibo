// 銀行口座の残高とクレジットカードの引き落としの計算（仕様書 D36）。画面は app.js。
// カードで払った記録は使った日に支出として数え、引き落としは支出に数えず銀行の残高からだけ引く（二重に数えないため）
const Accounts = (() => {
  const CASH = "cash"; // お金の移動の「現金」側（残高は追わない）

  function shiftKey(key, n) {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // カード c の、月 payKey に引き落とされる分。使った日の範囲 from〜to と、引き落とし日 pay（休日なら後の平日）
  function cycle(c, payKey) {
    const closeKey = shiftKey(payKey, -c.payMonth);
    return {
      key: payKey,
      from: Store.addDays(Store.recDate(shiftKey(closeKey, -1), c.close), 1),
      to: Store.recDate(closeKey, c.close),
      pay: Store.recDue({ day: c.payDay, shift: "after" }, payKey),
    };
  }
  // 日付 date に使った分が引き落とされる月
  function payKeyOf(c, date) {
    const k = date.slice(0, 7);
    const closeKey = date <= Store.recDate(k, c.close) ? k : shiftKey(k, 1);
    return shiftKey(closeKey, c.payMonth);
  }

  const cardEntries = (data, c) => data.entries.filter((e) => e.type === "expense" && e.acct === c.id);
  const billKey = (c, key) => `${c.id}:${key}`;

  // カード c の引き落としの一覧（古い順）。記録のある月から、いま使っている分（締め前）まで。
  // amount は手で直した額があればそれ、無ければ記録の合計（auto）。state は open 締め前／closed 引き落とし前／paid 済み
  function bills(data, c, todayStr) {
    const list = cardEntries(data, c);
    const keys = new Set([payKeyOf(c, todayStr)]);
    for (const e of list) keys.add(payKeyOf(c, e.date));
    for (const k of Object.keys(data.bills)) if (k.startsWith(c.id + ":")) keys.add(k.slice(c.id.length + 1));
    return [...keys].sort().map((key) => {
      const cy = cycle(c, key);
      const auto = list.filter((e) => e.date >= cy.from && e.date <= cy.to).reduce((a, e) => a + e.amount, 0);
      const fixed = data.bills[billKey(c, key)];
      return { ...cy, auto, fixed: fixed ?? null, amount: fixed ?? auto, state: todayStr <= cy.to ? "open" : todayStr < cy.pay ? "closed" : "paid" };
    });
  }

  // 銀行口座 b のお金の出入り（古い順）。b.since（残高を入れた日の朝）から atStr まで。
  // 1件 = { date, amount（入れば +、出れば −）, kind: entry/transfer/bill, ref, label }
  function moves(data, b, atStr) {
    const inRange = (d) => d >= b.since && d <= atStr;
    const out = [];
    for (const e of data.entries) {
      if (e.acct !== b.id || !inRange(e.date)) continue;
      out.push({ date: e.date, amount: e.type === "income" ? e.amount : -e.amount, kind: "entry", ref: e, order: e.createdAt || "" });
    }
    for (const t of data.transfers) {
      if (!inRange(t.date) || (t.from !== b.id && t.to !== b.id)) continue;
      out.push({ date: t.date, amount: t.to === b.id ? t.amount : -t.amount, kind: "transfer", ref: t, order: t.createdAt || "" });
    }
    for (const c of data.accounts) {
      if (c.kind !== "card" || c.bank !== b.id) continue;
      for (const bl of bills(data, c, atStr)) {
        if (bl.amount && inRange(bl.pay)) out.push({ date: bl.pay, amount: -bl.amount, kind: "bill", ref: c, bill: bl, order: "" });
      }
    }
    return out.sort((x, y) => (x.date !== y.date ? (x.date < y.date ? -1 : 1) : x.order.localeCompare(y.order)));
  }

  function balance(data, b, atStr) {
    return moves(data, b, atStr).reduce((a, m) => a + m.amount, b.start);
  }

  // まだ引き落とされていない、口座 b から出るカードの分（引き落とし日の順）
  function upcoming(data, b, todayStr) {
    const out = [];
    for (const c of data.accounts) {
      if (c.kind !== "card" || c.bank !== b.id || c.deleted) continue;
      for (const bl of bills(data, c, todayStr)) if (bl.state !== "paid" && bl.amount) out.push({ card: c, bill: bl });
    }
    return out.sort((x, y) => (x.bill.pay < y.bill.pay ? -1 : 1));
  }

  return { CASH, cycle, bills, moves, balance, upcoming };
})();
