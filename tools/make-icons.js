// ホーム画面用アイコン（緑の地に白い「¥」）を app/icons/ に PNG で書き出す。
// 使い方: node tools/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(OUT, { recursive: true });
const BG = [0x13, 0x89, 0x5f];

// 点 (x, y) から線分 (ax, ay)-(bx, by) までの距離
function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// 0〜1 の座標で「白く塗るか」を返す（太い ¥）
function white(x, y) {
  const s = 0.05; // 線の太さの半分
  const cx = 0.5, my = 0.5;
  if (segDist(x, y, 0.29, 0.22, cx, my) <= s) return true; // 左の腕
  if (segDist(x, y, 0.71, 0.22, cx, my) <= s) return true; // 右の腕
  if (Math.abs(x - cx) <= s && y >= my && y <= 0.8) return true; // 縦棒
  for (const by of [0.56, 0.67]) if (Math.abs(y - by) <= 0.032 && Math.abs(x - cx) <= 0.2) return true; // 横棒2本
  return false;
}

function png(size) {
  const SS = 4; // 縁をなめらかにするため 4x4 で数える
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let j = 0; j < size; j++) {
    raw[j * (size * 3 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let w = 0;
      for (let a = 0; a < SS; a++)
        for (let b = 0; b < SS; b++) if (white((i + (a + 0.5) / SS) / size, (j + (b + 0.5) / SS) / size)) w++;
      const t = w / (SS * SS);
      const o = j * (size * 3 + 1) + 1 + i * 3;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] + (255 - BG[k]) * t);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB（アルファ無し。App Store 用にもそのまま使える）
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const s of [180, 192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${s}.png`), png(s));
  console.log(`icon-${s}.png`);
}
