// ── pdfmini.js — a tiny PDF writer with NO dependencies (v173) ────────────────────────────────
// Used for the monthly workshop report. A4 landscape, Helvetica (built into every PDF reader), tables that wrap and break across pages,
// JPEG thumbnails (product photos). Text outside Latin-1 (e.g. Amharic) cannot be drawn with the built-in font and is shown as "?".
const W_REG = { 32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 123: 334, 124: 260, 125: 334, 126: 584 };
const W_BLD = { 32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238, 40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 58: 333, 59: 333, 60: 584, 61: 584, 62: 584, 63: 611, 64: 975, 91: 333, 92: 278, 93: 333, 94: 584, 95: 556, 96: 333, 123: 389, 124: 280, 125: 389, 126: 584 };
for (let c = 48; c <= 57; c++) { W_REG[c] = 556; W_BLD[c] = 556; }
const upR = "667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611".split(" ").map(Number);
const upB = "722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611".split(" ").map(Number);
const loR = "556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500".split(" ").map(Number);
const loB = "556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500".split(" ").map(Number);
for (let i = 0; i < 26; i++) { W_REG[65 + i] = upR[i]; W_BLD[65 + i] = upB[i]; W_REG[97 + i] = loR[i]; W_BLD[97 + i] = loB[i]; }

// make a string safe for the built-in font: Latin-1 stays, everything else becomes "?"
function clean(s) {
  let out = "";
  for (const ch of String(s == null ? "" : s)) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) out += " ";
    else if (c >= 32 && c <= 126) out += ch;
    else if (c >= 160 && c <= 255) out += ch;
    else if (c === 0x2013 || c === 0x2014) out += "-";
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c === 0x2022 || c === 0xb7) out += "-";
    else if (c === 0x200d || c === 0xfe0f || (c >= 0x1f000 && c <= 0x1faff) || (c >= 0x2600 && c <= 0x27bf)) out += ""; // emoji
    else out += "?";
  }
  return out.replace(/\s+/g, " ").trim().replace(/\?{2,}/g, "?");
}
const widthOf = (s, size, bold) => { const T = bold ? W_BLD : W_REG; let w = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += T[c] || 556; } return w * size / 1000; };
function wrap(s, maxW, size, bold) { // → array of lines
  s = clean(s); if (!s) return [""];
  const words = s.split(" "), lines = []; let cur = "";
  for (let w of words) {
    while (widthOf(w, size, bold) > maxW) { // a single very long word: cut it
      let n = w.length; while (n > 1 && widthOf(w.slice(0, n), size, bold) > maxW) n--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, n)); w = w.slice(n);
    }
    const t = cur ? cur + " " + w : w;
    if (cur && widthOf(t, size, bold) > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
const esc = s => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const f2 = n => (Math.round(n * 100) / 100).toString();

function jpegInfo(buf) { // → { w, h, comps } or null
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9], progressive: m === 0xc2 };
    i += 2 + len;
  }
  return null;
}

const PAGE_W = 842, PAGE_H = 595, MX = 34, MTOP = 40, MBOT = 38;
const COL = { ink: [0.1, 0.13, 0.12], mute: [0.4, 0.45, 0.43], line: [0.82, 0.85, 0.83], head: [0.06, 0.24, 0.19], band: [0.94, 0.96, 0.95], gold: [0.78, 0.6, 0.2], white: [1, 1, 1], red: [0.7, 0.15, 0.15] };

class Doc {
  constructor(opt = {}) {
    this.title = clean(opt.title || "Report"); this.footer = clean(opt.footer || "");
    this.pages = []; this.images = []; this.imgMap = new Map();
    this.newPage();
  }
  newPage() { this.cur = { ops: [], imgs: new Set() }; this.pages.push(this.cur); this.y = PAGE_H - MTOP; }
  room(h) { if (this.y - h < MBOT) this.newPage(); }
  color(c, stroke) { return `${f2(c[0])} ${f2(c[1])} ${f2(c[2])} ${stroke ? "RG" : "rg"}`; }
  rect(x, y, w, h, fill) { this.cur.ops.push(`${this.color(fill)} ${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)} re f`); }
  hline(x1, x2, y, c = COL.line, w = 0.5) { this.cur.ops.push(`${this.color(c, true)} ${w} w ${f2(x1)} ${f2(y)} m ${f2(x2)} ${f2(y)} l S`); }
  text(x, y, s, size = 9, bold = false, c = COL.ink) { s = clean(s); if (!s) return; this.cur.ops.push(`BT ${this.color(c)} /${bold ? "F2" : "F1"} ${size} Tf ${f2(x)} ${f2(y)} Td (${esc(s)}) Tj ET`); }
  gap(h) { this.y -= h; }
  title1(text, sub) {
    this.room(70); const h = 52;
    this.rect(0, PAGE_H - h - 6, PAGE_W, h + 6, COL.head);
    this.rect(0, PAGE_H - h - 9, PAGE_W, 3, COL.gold);
    this.text(MX, PAGE_H - 30, text, 20, true, COL.white);
    if (sub) this.text(MX, PAGE_H - 46, sub, 10, false, [0.86, 0.92, 0.89]);
    this.y = PAGE_H - h - 28;
  }
  h2(text, note) {
    this.room(46); this.gap(6);
    this.rect(MX, this.y - 4, 4, 16, COL.gold);
    this.text(MX + 11, this.y, text, 13, true, COL.head);
    if (note) this.text(MX + 11 + widthOf(clean(text), 13, true) + 10, this.y, note, 9, false, COL.mute);
    this.gap(20);
  }
  para(s, size = 9, c = COL.mute) { for (const l of wrap(s, PAGE_W - 2 * MX, size, false)) { this.room(size + 4); this.text(MX, this.y, l, size, false, c); this.gap(size + 3); } this.gap(4); }
  empty(s) { this.room(20); this.text(MX + 6, this.y, s, 9, false, COL.mute); this.gap(18); }
  stats(items) { // [[label, value], ...] drawn as boxes in rows of up to 5
    const per = 5, gapX = 8, bw = (PAGE_W - 2 * MX - gapX * (per - 1)) / per, bh = 44;
    for (let i = 0; i < items.length; i += per) {
      this.room(bh + 8);
      items.slice(i, i + per).forEach((it, k) => {
        const x = MX + k * (bw + gapX), y = this.y - bh;
        this.rect(x, y, bw, bh, COL.band); this.rect(x, y, 3, bh, COL.gold);
        this.text(x + 12, y + 24, String(it[1]), 17, true, COL.head);
        this.text(x + 12, y + 9, it[0], 8, false, COL.mute);
      });
      this.gap(bh + 8);
    }
    this.gap(4);
  }
  image(buf) { // → image id or null
    const info = jpegInfo(buf); if (!info || ![1, 3].includes(info.comps) || info.w < 1 || info.h < 1) return null;
    const key = buf.length + ":" + buf.slice(0, 64).toString("hex") + buf.slice(-32).toString("hex");
    if (this.imgMap.has(key)) return this.imgMap.get(key);
    const id = this.images.length; this.images.push({ buf, ...info }); this.imgMap.set(key, id); return id;
  }
  // cols: [{ h, w (relative weight), align?, bold? }]  rows: [[cell | {t, bold, color}] , ...]  opt.thumbs: array of image buffers (or null) aligned with rows → first column becomes the photo
  table(cols, rows, opt = {}) {
    const total = PAGE_W - 2 * MX, thumb = opt.thumbs ? 34 : 0, pad = 4, size = 8;
    const wsum = cols.reduce((a, c) => a + (c.w || 1), 0), avail = total - (thumb ? thumb + pad * 2 : 0);
    const cw = cols.map(c => avail * (c.w || 1) / wsum);
    const header = () => {
      this.room(24 + 20); const h = 16, y = this.y - h + 4;
      this.rect(MX, y - 3, total, h, COL.head);
      let x = MX + (thumb ? thumb + pad * 2 : 0);
      if (thumb) this.text(MX + pad, y + 2, "Photo", 7.5, true, COL.white);
      cols.forEach((c, i) => { this.text(x + pad, y + 2, c.h, 7.5, true, COL.white); x += cw[i]; });
      this.y = y - 6;
    };
    header();
    rows.forEach((row, ri) => {
      const cells = row.map((cell, i) => { const o = typeof cell === "object" && cell ? cell : { t: cell }; return { ...o, lines: wrap(o.t == null ? "" : String(o.t), cw[i] - pad * 2, size, !!(o.bold || cols[i].bold)) }; });
      const lines = Math.max(1, ...cells.map(c => c.lines.length));
      const h = Math.max(lines * 10 + 6, thumb ? thumb + 4 : 0);
      if (this.y - h < MBOT) { this.newPage(); header(); }
      const top = this.y;
      if (ri % 2 === 0) this.rect(MX, top - h + 3, total, h, COL.band);
      let x = MX;
      if (thumb) {
        const id = opt.thumbs[ri] ? this.image(opt.thumbs[ri]) : null;
        if (id != null) { const im = this.images[id], s = Math.min((thumb) / im.w, (thumb) / im.h), dw = im.w * s, dh = im.h * s; this.cur.imgs.add(id); this.cur.ops.push(`q ${f2(dw)} 0 0 ${f2(dh)} ${f2(MX + pad + (thumb - dw) / 2)} ${f2(top - 2 - dh - (thumb - dh) / 2 + 1)} cm /Im${id} Do Q`); }
        x += thumb + pad * 2;
      }
      cells.forEach((c, i) => {
        c.lines.forEach((l, li) => {
          const bold = !!(c.bold || cols[i].bold), tw = widthOf(l, size, bold);
          const tx = cols[i].align === "right" ? x + cw[i] - pad - tw : cols[i].align === "center" ? x + (cw[i] - tw) / 2 : x + pad;
          this.text(tx, top - 7 - li * 10, l, size, bold, c.color || COL.ink);
        });
        x += cw[i];
      });
      this.hline(MX, MX + total, top - h + 3);
      this.y = top - h;
    });
    this.gap(10);
  }
  build() { // → Buffer
    const objs = []; const add = s => { objs.push(s); return objs.length; }; // 1-based ids
    const catalog = add(null), pagesRoot = add(null), f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), f2o = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imgIds = this.images.map(im => add({ stream: im.buf, dict: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comps === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>` }));
    const n = this.pages.length, kids = [];
    this.pages.forEach((p, i) => {
      const foot = [`BT ${this.color(COL.mute)} /F1 7.5 Tf ${MX} 20 Td (${esc(this.footer)}) Tj ET`, `BT ${this.color(COL.mute)} /F1 7.5 Tf ${PAGE_W - MX - 50} 20 Td (Page ${i + 1} / ${n}) Tj ET`, `${this.color(COL.line, true)} 0.5 w ${MX} 30 m ${PAGE_W - MX} 30 l S`].join("\n");
      const body = Buffer.from(p.ops.join("\n") + "\n" + foot, "latin1");
      const content = add({ stream: body, dict: `<< /Length ${body.length} >>` });
      const xo = [...p.imgs].map(id => `/Im${id} ${imgIds[id]} 0 R`).join(" ");
      kids.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2o} 0 R >> ${xo ? `/XObject << ${xo} >>` : ""} >> /Contents ${content} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
    objs[pagesRoot - 1] = `<< /Type /Pages /Count ${n} /Kids [${kids.map(k => k + " 0 R").join(" ")}] >>`;
    const info = add(`<< /Title (${esc(this.title)}) /Producer (AMBAR Furniture mini app) >>`);
    const parts = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")], offs = []; let pos = parts[0].length;
    objs.forEach((o, i) => {
      offs.push(pos);
      const head = Buffer.from(`${i + 1} 0 obj\n`, "latin1");
      let body;
      if (typeof o === "string") body = Buffer.from(o + "\n", "latin1");
      else body = Buffer.concat([Buffer.from(o.dict + "\nstream\n", "latin1"), o.stream, Buffer.from("\nendstream\n", "latin1")]);
      const piece = Buffer.concat([head, body, Buffer.from("endobj\n", "latin1")]);
      parts.push(piece); pos += piece.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offs.map(o => String(o).padStart(10, "0") + " 00000 n \n")].join("");
    parts.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
    return Buffer.concat(parts);
  }
}
module.exports = { Doc, clean };
