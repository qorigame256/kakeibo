// グラフ2種（SVG を文字列で組み立てる）。色は style.css の --series-* を使う。
const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const yen = (n) => n.toLocaleString("ja-JP") + "円";

  function el(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  // ドーナツ：parts = [{ label, value, color }]。押した部分の名前・金額・割合を真ん中に出す
  function donut(container, parts, totalLabel) {
    container.innerHTML = "";
    const total = parts.reduce((s, p) => s + p.value, 0);
    const size = 220, r = 84, w = 30, c = size / 2;
    const svg = el("svg", { viewBox: `0 0 ${size} ${size}`, class: "donut", role: "img", "aria-label": `${totalLabel} ${yen(total)}` });
    const circ = 2 * Math.PI * r;
    const gap = parts.length > 1 ? 2 : 0;
    let offset = 0;
    const segs = [];
    for (const p of parts) {
      const len = (p.value / total) * circ;
      const seg = el("circle", {
        cx: c, cy: c, r, fill: "none", stroke: p.color, "stroke-width": w,
        "stroke-dasharray": `${Math.max(len - gap, 0.5)} ${circ}`,
        "stroke-dashoffset": -offset,
        transform: `rotate(-90 ${c} ${c})`,
        class: "seg",
      });
      svg.appendChild(seg);
      segs.push({ seg, p });
      offset += len;
    }
    const t1 = el("text", { x: c, y: c - 8, "text-anchor": "middle", class: "donut-label" });
    const t2 = el("text", { x: c, y: c + 16, "text-anchor": "middle", class: "donut-value" });
    svg.appendChild(t1); svg.appendChild(t2);
    const showTotal = () => {
      t1.textContent = totalLabel; t2.textContent = yen(total);
      segs.forEach(({ seg }) => seg.classList.remove("dim"));
    };
    let active = null;
    for (const { seg, p } of segs) {
      seg.addEventListener("click", () => {
        if (active === seg) { active = null; return showTotal(); }
        active = seg;
        segs.forEach((s) => s.seg.classList.toggle("dim", s.seg !== seg));
        t1.textContent = p.label;
        t2.textContent = `${yen(p.value)}（${Math.round((p.value / total) * 100)}%）`;
      });
    }
    showTotal();
    container.appendChild(svg);
  }

  // 目盛りの刻み（1, 2, 5 × 10^n）
  function niceStep(max, count) {
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) if (m * mag >= raw) return m * mag;
    return 10 * mag;
  }
  const short = (n) => (n >= 10000 ? (n / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 1 }) + "万" : n.toLocaleString("ja-JP"));

  // 上だけ角の丸い棒（下は軸にくっつける）
  function barPath(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // 月ごとの収入・支出の棒：months = [{ key, label, income, expense }]。押した月の内訳を readout に出す
  function bars(container, readout, months, selectedKey, label) {
    container.innerHTML = "";
    const W = 340, H = 190, left = 34, right = 6, top = 10, bottom = 24;
    const pw = W - left - right, ph = H - top - bottom;
    const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
    const step = niceStep(max, 3);
    const yMax = Math.ceil(max / step) * step;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "bars", role: "img", "aria-label": label });
    for (let v = 0; v <= yMax; v += step) {
      const y = top + ph - (v / yMax) * ph;
      svg.appendChild(el("line", { x1: left, x2: W - right, y1: y, y2: y, class: v === 0 ? "axis" : "grid" }));
      const t = el("text", { x: left - 4, y: y + 3, "text-anchor": "end", class: "tick" });
      t.textContent = short(v);
      svg.appendChild(t);
    }
    const gw = pw / months.length;
    const bw = Math.min(10, (gw - 6) / 2);
    const bands = [];
    months.forEach((m, i) => {
      const gx = left + i * gw;
      const band = el("rect", { x: gx, y: top, width: gw, height: ph, class: "band" });
      svg.appendChild(band);
      const cx = gx + gw / 2;
      const hi = (m.income / yMax) * ph, he = (m.expense / yMax) * ph;
      svg.appendChild(el("path", { d: barPath(cx - bw - 1, top + ph - hi, bw, hi, 3), class: "bar-income" }));
      svg.appendChild(el("path", { d: barPath(cx + 1, top + ph - he, bw, he, 3), class: "bar-expense" }));
      const t = el("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "tick" + (m.key === selectedKey ? " strong" : "") });
      t.textContent = m.label;
      svg.appendChild(t);
      // 押しやすいよう、棒より広い透明の当たり判定を置く
      const hit = el("rect", { x: gx, y: 0, width: gw, height: H, fill: "transparent", class: "hit" });
      hit.addEventListener("click", () => select(i));
      svg.appendChild(hit);
      bands.push(band);
    });
    function select(i) {
      bands.forEach((b, j) => b.classList.toggle("on", j === i));
      const m = months[i];
      const diff = m.income - m.expense;
      readout.innerHTML = `<b>${m.title}</b><br>収入 ${yen(m.income)}　支出 ${yen(m.expense)}　差額 ${diff >= 0 ? "+" : "−"}${yen(Math.abs(diff))}`;
    }
    const si = months.findIndex((m) => m.key === selectedKey);
    select(si >= 0 ? si : months.length - 1);
    container.appendChild(svg);
  }

  return { donut, bars };
})();
