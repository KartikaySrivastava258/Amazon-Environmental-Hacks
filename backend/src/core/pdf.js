// A small, dependency-free PDF 1.4 writer for brand reports. Same code in Lambda, the browser demo and tests.
// It uses the standard Helvetica fonts (no embedding), so text is limited to WinAnsi/Latin: the report is
// written in English, like the CSV export (docs/I18N.md section 4). Layout: A4 pages, headings, paragraphs,
// key/value lists, tables with wrapped cells and repeated headers, horizontal bar charts and banners.

const A4 = { w: 595.28, h: 841.89 };
const M = { l: 48, r: 48, t: 56, b: 60 };
const CONTENT_W = A4.w - M.l - M.r;

// Glyph widths (1/1000 em) for ASCII 32..126, from the Adobe Helvetica and Helvetica-Bold AFM metrics.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** Text the standard fonts can draw: common typography mapped to ASCII, anything else replaced. */
export function sanitize(s) {
  return String(s ?? '')
    .replace(/₹\s?/g, 'Rs ')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u00b7]/g, '-')
    .replace(/\u00d7/g, 'x')
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/[\r\t]/g, ' ')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

export function textWidth(s, size, bold = false) {
  const table = bold ? BOLD : HELV;
  let w = 0;
  for (const ch of sanitize(s)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? table[c - 32] : 556;
  }
  return (w * size) / 1000;
}

/** Greedy word wrap to `width` points. Words longer than a line are broken. */
export function wrap(s, width, size, bold = false) {
  const lines = [];
  for (const para of sanitize(s).split('\n')) {
    let cur = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (textWidth(word, size, bold) > width) {
        let k = word.length - 1;
        while (k > 1 && textWidth(word.slice(0, k), size, bold) > width) k--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(word.slice(0, k));
        word = word.slice(k);
      }
      const next = cur ? `${cur} ${word}` : word;
      if (textWidth(next, size, bold) <= width) cur = next;
      else { if (cur) lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return lines;
}

const esc = (s) => sanitize(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const num = (n) => (Math.round(n * 100) / 100).toString();
const COLORS = { ink: [0.11, 0.17, 0.42], text: [0.13, 0.13, 0.13], muted: [0.38, 0.38, 0.38], red: [0.76, 0.12, 0.23], leaf: [0.07, 0.42, 0.26], amber: [0.6, 0.38, 0.0], line: [0.8, 0.8, 0.8], bar: [0.11, 0.17, 0.42], barBg: [0.92, 0.92, 0.9], warnBg: [1, 0.94, 0.88], synBg: [0.99, 0.9, 0.9], okBg: [0.9, 0.96, 0.91] };
const rgb = (c, op) => `${(COLORS[c] || COLORS.text).map(num).join(' ')} ${op}`;

class Layout {
  constructor(footer) {
    this.pages = [];
    this.footer = footer;
    this.newPage();
  }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = A4.h - M.t; }
  ensure(h) { if (this.y - h < M.b) { this.newPage(); return true; } return false; }
  text(x, y, s, size, { bold = false, color = 'text' } = {}) {
    this.ops.push(`BT ${rgb(color, 'rg')} /${bold ? 'F2' : 'F1'} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${esc(s)}) Tj ET`);
  }
  rect(x, y, w, h, color) { this.ops.push(`${rgb(color, 'rg')} ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`); }
  line(x1, y1, x2, y2, color = 'line', width = 0.6) { this.ops.push(`${rgb(color, 'RG')} ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`); }
  // Block drawing
  para(s, { size = 10, bold = false, color = 'text', gap = 4, indent = 0, lead = 1.35 } = {}) {
    const lines = wrap(s, CONTENT_W - indent, size, bold);
    const lh = size * lead;
    for (const ln of lines) {
      this.ensure(lh);
      this.y -= lh;
      this.text(M.l + indent, this.y + size * 0.25, ln, size, { bold, color });
    }
    this.y -= gap;
  }
  heading(s, level) {
    const size = level === 1 ? 20 : level === 2 ? 14 : 11.5;
    const before = level === 1 ? 0 : level === 2 ? 14 : 8;
    this.ensure(before + size * 2.6);
    this.y -= before;
    this.para(s, { size, bold: true, color: level === 3 ? 'text' : 'ink', gap: level === 2 ? 2 : 3, lead: 1.25 });
    if (level === 2) { this.line(M.l, this.y, A4.w - M.r, this.y, 'line', 0.8); this.y -= 6; }
  }
  banner(s, tone) {
    const size = 10;
    const lines = wrap(s, CONTENT_W - 20, size, true);
    const h = lines.length * size * 1.35 + 14;
    this.ensure(h + 6);
    this.y -= h;
    this.rect(M.l, this.y, CONTENT_W, h, tone === 'syn' ? 'synBg' : tone === 'ok' ? 'okBg' : 'warnBg');
    this.rect(M.l, this.y, 3, h, tone === 'syn' ? 'red' : tone === 'ok' ? 'leaf' : 'amber');
    lines.forEach((ln, i) => this.text(M.l + 12, this.y + h - 7 - (i + 1) * size * 1.35 + size * 0.3, ln, size, { bold: true, color: tone === 'syn' ? 'red' : tone === 'ok' ? 'leaf' : 'amber' }));
    this.y -= 8;
  }
  kv(rows) {
    const size = 9.5;
    const kw = 160;
    for (const [k, v] of rows) {
      const lines = wrap(v, CONTENT_W - kw, size);
      const lh = size * 1.35;
      this.ensure(lh * lines.length);
      lines.forEach((ln, i) => {
        this.y -= lh;
        if (i === 0) this.text(M.l, this.y + 2.5, k, size, { bold: true, color: 'muted' });
        this.text(M.l + kw, this.y + 2.5, ln, size);
      });
    }
    this.y -= 6;
  }
  table(cols, rows, { size = 8.6 } = {}) {
    const widths = cols.map((c) => c.w * CONTENT_W);
    const pad = 3;
    const lh = size * 1.3;
    const cellLines = (row, bold) => row.map((cell, i) => wrap(cell, widths[i] - pad * 2, size, bold));
    const drawRow = (row, bold) => {
      const cl = cellLines(row, bold);
      const h = Math.max(...cl.map((l) => l.length)) * lh + pad * 2;
      const broke = this.ensure(h);
      if (broke && !bold) drawRow(cols.map((c) => c.label), true);
      this.y -= h;
      if (bold) this.rect(M.l, this.y, CONTENT_W, h, 'barBg');
      let x = M.l;
      cl.forEach((lines, i) => {
        lines.forEach((ln, k) => {
          const tw = textWidth(ln, size, bold);
          const tx = cols[i].align === 'right' ? x + widths[i] - pad - tw : x + pad;
          this.text(tx, this.y + h - pad - (k + 1) * lh + size * 0.3, ln, size, { bold });
        });
        x += widths[i];
      });
      this.line(M.l, this.y, A4.w - M.r, this.y);
    };
    this.ensure(lh * 3);
    drawRow(cols.map((c) => c.label), true);
    for (const r of rows) drawRow(r.map((x) => String(x ?? '')), false);
    this.y -= 8;
  }
  bars(items, { size = 9 } = {}) {
    const labelW = 170;
    const valW = 70;
    const barW = CONTENT_W - labelW - valW - 10;
    const max = Math.max(...items.map((i) => i.value), 0.0001);
    for (const it of items) {
      const lh = size * 1.7;
      this.ensure(lh);
      this.y -= lh;
      const label = wrap(it.label, labelW - 6, size)[0];
      this.text(M.l, this.y + 4, label, size);
      this.rect(M.l + labelW, this.y + 2, barW, size, 'barBg');
      this.rect(M.l + labelW, this.y + 2, Math.max(1, (it.value / max) * barW), size, it.tone === 'red' ? 'red' : 'bar');
      const tw = textWidth(it.text, size, true);
      this.text(A4.w - M.r - tw, this.y + 4, it.text, size, { bold: true });
    }
    this.y -= 8;
  }
  spacer(h) { this.y -= h; }
}

/**
 * Render { title, info: { title, subject, created }, footer, blocks } to PDF bytes (Uint8Array).
 * blocks: { h1|h2|h3|p|small|banner|kv|table|bars|spacer|pagebreak }.
 */
export function renderPdf(doc) {
  const L = new Layout(doc.footer);
  for (const b of doc.blocks) {
    if (b.h1) L.heading(b.h1, 1);
    else if (b.h2) L.heading(b.h2, 2);
    else if (b.h3) L.heading(b.h3, 3);
    else if (b.p != null) L.para(b.p, { color: b.color || 'text' });
    else if (b.small != null) L.para(b.small, { size: 8.5, color: 'muted' });
    else if (b.banner) L.banner(b.banner, b.tone);
    else if (b.kv) L.kv(b.kv);
    else if (b.table) L.table(b.table.cols, b.table.rows);
    else if (b.bars) L.bars(b.bars);
    else if (b.spacer) L.spacer(b.spacer);
    else if (b.pagebreak) L.newPage();
  }
  const total = L.pages.length;
  L.pages.forEach((ops, i) => {
    const y = 30;
    ops.push(`${rgb('line', 'RG')} 0.6 w ${num(M.l)} ${num(y + 12)} m ${num(A4.w - M.r)} ${num(y + 12)} l S`);
    const left = sanitize(doc.footer || '');
    const right = `Page ${i + 1} of ${total}`;
    ops.push(`BT ${rgb('muted', 'rg')} /F1 7.5 Tf 1 0 0 1 ${num(M.l)} ${num(y)} Tm (${esc(left)}) Tj ET`);
    ops.push(`BT ${rgb('muted', 'rg')} /F1 7.5 Tf 1 0 0 1 ${num(A4.w - M.r - textWidth(right, 7.5))} ${num(y)} Tm (${esc(right)}) Tj ET`);
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (page, content) pairs.
  const objs = [];
  const pageIds = L.pages.map((_, i) => 6 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const d = new Date(doc.info?.created || 0);
  const pdfDate = `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  objs[5] = `<< /Title (${esc(doc.info?.title || doc.title || 'Report')}) /Subject (${esc(doc.info?.subject || '')}) /Producer (Punarnava) /Creator (Punarnava) /CreationDate (${pdfDate}) >>`;
  L.pages.forEach((ops, i) => {
    const content = ops.join('\n');
    objs[pageIds[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4.w)} ${num(A4.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objs[pageIds[i] + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  // Everything above is ASCII, so string offsets are byte offsets.
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** Bytes → base64, without Buffer (browser demo) or with it (Lambda/Node). */
export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(bin);
}
