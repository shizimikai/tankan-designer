// 3面図（平面図・正面図・右側面図）を SVG 文字列で作る。寸法は mm。
// 配置は第三角法：平面図を正面図の上、右側面図を正面図の右に置く。
//
// 座標の向き（tankan-core.js と同じ）
//   x: 間口方向。前から見ると x=0 が右、x=W が左
//   y: 高さ
//   z: 奥行き方向。z=0 が前面

const COLORS = {
  post: '#4b5563', beam: '#374151', tiebeam: '#374151', ridge: '#374151', king: '#4b5563',
  rafter: '#2f5f8f', purlin: '#7b97b3', tie: '#5f7a3a', brace: '#c96a06', hiuchi: '#c96a06',
};
const LEGEND = [
  ['post', '柱'], ['beam', '桁・陸梁・棟木'], ['rafter', '垂木'], ['purlin', '母屋'], ['tie', '胴つなぎ'], ['brace', '筋交い・火打ち'],
];
const YOFF = { rafter: 0.049, purlin: 0.098 };
const SHEET_W = 1188, SHEET_H = 840; // A3 横の比率（1px ≒ 0.354mm）
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mm = (m) => Math.round(m * 1000).toLocaleString('ja-JP');
const f1 = (v) => Math.round(v * 10) / 10;

export function drawSheet(r, meta = {}) {
  const { W, D, H1, H2, Hr, mono, oe, os } = r.dims;
  const maxH = Math.max(H1, H2, mono ? 0 : Hr);
  const Wt = W + 2 * os, Dt = D + 2 * oe, Ht = maxH + 0.3;
  const M = 78, GAP = 120, TITLE = 64;
  const s = Math.min((SHEET_W - 2 * M - GAP) / (Wt + Dt), (SHEET_H - TITLE - 2 * M - GAP) / (Dt + Ht + 0.1));
  const usedW = (Wt + Dt) * s + GAP, usedH = (Dt + Ht + 0.1) * s + GAP;
  const x0 = (SHEET_W - usedW) / 2, y0 = (SHEET_H - TITLE - usedH) / 2;

  // 各図の原点（svg座標）
  const frontLeft = x0, sideLeft = x0 + Wt * s + GAP;
  const topTop = y0, groundY = y0 + Dt * s + GAP + Ht * s;
  // 投影：u は図の横方向（m）、v は高さ（m）
  const PF = (p) => [frontLeft + (W + os - p[0]) * s, groundY - p[1] * s];          // 正面図
  const PS = (p) => [sideLeft + (p[2] + oe) * s, groundY - p[1] * s];               // 右側面図（前が左）
  const PT = (p) => [frontLeft + (W + os - p[0]) * s, topTop + (D + oe - p[2]) * s]; // 平面図（前が下）

  const out = [];
  const sw = Math.max(1.3, 0.0486 * s);
  const line = (a, b, c, w = sw, extra = '') => out.push(`<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${c}" stroke-width="${f1(w * 10) / 10}" stroke-linecap="round"${extra}/>`);
  const text = (x, y, t, o = {}) => out.push(`<text x="${f1(x)}" y="${f1(y)}" font-size="${o.size || 11}" text-anchor="${o.anchor || 'middle'}"${o.rot ? ` transform="rotate(${o.rot} ${f1(x)} ${f1(y)})"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''} fill="${o.fill || '#1f2328'}">${esc(t)}</text>`);

  // 寸法線（水平）：x1〜x2 を y の高さに。refY は測る対象の位置（引き出し線の始点）
  const dimH = (x1, x2, y, label, refY) => {
    if (Math.abs(x2 - x1) < 2) return;
    const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1];
    if (refY != null) { const d = y > refY ? 1 : -1; line([a, refY + 3 * d], [a, y + 4 * d], '#555', 0.6); line([b, refY + 3 * d], [b, y + 4 * d], '#555', 0.6); }
    line([a, y], [b, y], '#555', 0.8);
    line([a - 3, y + 3], [a + 3, y - 3], '#555', 1); line([b - 3, y + 3], [b + 3, y - 3], '#555', 1);
    text((a + b) / 2, y - 4, label, { size: 10.5 });
  };
  const dimV = (y1, y2, x, label, refX) => {
    if (Math.abs(y2 - y1) < 2) return;
    const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1];
    if (refX != null) { const d = x > refX ? 1 : -1; line([refX + 3 * d, a], [x + 4 * d, a], '#555', 0.6); line([refX + 3 * d, b], [x + 4 * d, b], '#555', 0.6); }
    line([x, a], [x, b], '#555', 0.8);
    line([x - 3, a + 3], [x + 3, a - 3], '#555', 1); line([x - 3, b + 3], [x + 3, b - 3], '#555', 1);
    text(x - 5, (a + b) / 2, label, { size: 10.5, rot: -90 });
  };

  // 部材を描く（投影して長さがほぼ0なら丸で描く）
  const drawMembers = (P, order) => {
    const list = [...r.members].sort((m1, m2) => order(m1) - order(m2));
    for (const m of list) {
      const off = YOFF[m.kind] || 0;
      const a = P([m.a[0], m.a[1] + off, m.a[2]]), b = P([m.b[0], m.b[1] + off, m.b[2]]);
      const c = COLORS[m.kind] || '#444';
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) out.push(`<circle cx="${f1(a[0])}" cy="${f1(a[1])}" r="${f1(Math.max(1.6, sw / 2 + 0.6))}" fill="#fff" stroke="${c}" stroke-width="1.1"/>`);
      else line(a, b, c);
    }
  };
  const roofPoly = (P, dashed) => {
    for (const sl of r.slopes) {
      const pts = sl.pts.map((p) => P([p[0], p[1] + 0.13, p[2]]));
      out.push(`<polygon points="${pts.map((q) => q.map(f1).join(',')).join(' ')}" fill="#9fd0f0" fill-opacity="0.18" stroke="#5c8fb3" stroke-width="0.9"${dashed ? ' stroke-dasharray="5 3"' : ''}/>`);
    }
  };
  const slab = (P, u1, u2) => {
    // 正面・側面用のコンクリート（厚さ10cm）と地面線
    const a = P(u1), b = P(u2);
    out.push(`<rect x="${f1(Math.min(a[0], b[0]))}" y="${f1(groundY)}" width="${f1(Math.abs(b[0] - a[0]))}" height="${f1(0.1 * s)}" fill="#e2ded7" stroke="#9a948a" stroke-width="0.8"/>`);
  };

  const posts = r.members.filter((m) => m.kind === 'post');
  const uniq = (arr) => [...new Set(arr.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const xsPost = uniq(posts.map((m) => m.a[0]));
  const zsPost = uniq(posts.map((m) => m.a[2]));
  const rafterXs = uniq(r.members.filter((m) => m.kind === 'rafter').map((m) => m.a[0]));

  // ---------- 正面図 ----------
  slab(PF, [W + 0.2, 0, 0], [-0.2, 0, 0]);
  if (r.roof) roofPoly(PF, false);
  drawMembers(PF, (m) => -m.a[2] - m.b[2]); // 奥のものから
  {
    const yb = groundY + 0.1 * s;
    const xsDraw = xsPost.map((x) => PF([x, 0, 0])[0]);
    if (xsPost.length > 2) for (let i = 0; i < xsDraw.length - 1; i++) dimH(xsDraw[i], xsDraw[i + 1], yb + 22, mm(xsPost[i + 1] - xsPost[i]), yb);
    dimH(xsDraw[0], xsDraw[xsDraw.length - 1], yb + (xsPost.length > 2 ? 46 : 22), mm(W) + '（柱の間）', yb);
    const left = PF([W + os, 0, 0])[0], right = PF([-os, 0, 0])[0];
    dimV(groundY, groundY - H1 * s, left - 24, (mono ? '前 ' : '軒 ') + mm(H1), PF([W, 0, 0])[0]);
    if (mono && Math.abs(H2 - H1) > 0.001) dimV(groundY, groundY - H2 * s, right + 34, '後 ' + mm(H2), PF([0, 0, 0])[0]);
    if (!mono) dimV(groundY, groundY - Hr * s, right + 34, '棟 ' + mm(Hr), PF([0, 0, 0])[0]);
    text((left + right) / 2, yb + (xsPost.length > 2 ? 78 : 54), '正面図（前から見た図）', { size: 13, weight: 700 });
  }

  // ---------- 右側面図 ----------
  slab(PS, [-0.2, 0, -0.2], [0, 0, D + 0.2]);
  if (r.roof) roofPoly(PS, false);
  drawMembers(PS, (m) => -(m.a[0] + m.b[0])); // x の大きい（奥＝左面）ものから
  {
    const yb = groundY + 0.1 * s;
    const zsDraw = zsPost.map((z) => PS([0, 0, z])[0]);
    if (zsPost.length > 2) for (let i = 0; i < zsDraw.length - 1; i++) dimH(zsDraw[i], zsDraw[i + 1], yb + 22, mm(zsPost[i + 1] - zsPost[i]), yb);
    dimH(zsDraw[0], zsDraw[zsDraw.length - 1], yb + (zsPost.length > 2 ? 46 : 22), mm(D) + '（柱の間）', yb);
    // 軒の出（屋根の上側）
    if (oe > 0) {
      const yTop = groundY - (maxH + 0.13) * s - 26;
      const zA = PS([0, 0, -oe])[0], z0 = PS([0, 0, 0])[0], zD = PS([0, 0, D])[0], zB = PS([0, 0, D + oe])[0];
      dimH(zA, z0, yTop, mm(oe)); dimH(z0, zD, yTop, mm(D)); dimH(zD, zB, yTop, mm(oe));
      text((zA + zB) / 2, yTop - 18, '軒の出を含む屋根の奥行き ' + mm(Dt), { size: 10, fill: '#555' });
    }
    const left = PS([0, 0, -oe])[0], right = PS([0, 0, D + oe])[0];
    dimV(groundY, groundY - H1 * s, left - 24, (mono ? '前 ' : '軒 ') + mm(H1), PS([0, 0, 0])[0]);
    if (mono) dimV(groundY, groundY - H2 * s, right + 34, '後 ' + mm(H2), PS([0, 0, D])[0]);
    else dimV(groundY, groundY - Hr * s, right + 34, '棟 ' + mm(Hr), PS([0, 0, D / 2])[0]);
    text(left + 10, groundY + 0.1 * s + 14, '← 前', { size: 10, anchor: 'start', fill: '#777' });
    text(right - 10, groundY + 0.1 * s + 14, '後 →', { size: 10, anchor: 'end', fill: '#777' });
    text((left + right) / 2, yb + (zsPost.length > 2 ? 78 : 54), '右側面図（右から見た図）', { size: 13, weight: 700 });
  }

  // ---------- 平面図 ----------
  {
    const a = PT([W + 0.2, 0, D + 0.2]), b = PT([-0.2, 0, -0.2]);
    out.push(`<rect x="${f1(a[0])}" y="${f1(a[1])}" width="${f1(b[0] - a[0])}" height="${f1(b[1] - a[1])}" fill="#efece6" stroke="#b8b1a6" stroke-width="0.8"/>`);
  }
  drawMembers(PT, (m) => (m.a[1] + m.b[1])); // 低いものから
  if (r.roof) roofPoly(PT, true);
  {
    const left = PT([W + os, 0, 0])[0], right = PT([-os, 0, 0])[0];
    const top = PT([0, 0, D + oe])[1], bottom = PT([0, 0, -oe])[1];
    // 上：屋根の幅と柱の間
    dimH(left, right, top - 46, '屋根の幅 ' + mm(Wt), top);
    dimH(PT([W, 0, 0])[0], PT([0, 0, 0])[0], top - 22, mm(W), top);
    // 垂木の間隔
    if (rafterXs.length > 2) {
      const rx = rafterXs.map((x) => PT([x, 0, 0])[0]);
      for (let i = 0; i < rx.length - 1; i++) dimH(rx[i], rx[i + 1], bottom + 18, mm(rafterXs[i + 1] - rafterXs[i]), bottom);
      text((left + right) / 2, bottom + 34, '↑ 垂木の間隔', { size: 9.5, fill: '#777' });
    }
    // 左：奥行き
    dimV(top, bottom, left - 46, '屋根の奥行 ' + mm(Dt), left);
    dimV(PT([0, 0, D])[1], PT([0, 0, 0])[1], left - 22, mm(D), left);
    text(right + 8, bottom - 4, '前', { size: 10, anchor: 'start', fill: '#777' });
    text(right + 8, top + 10, '後', { size: 10, anchor: 'start', fill: '#777' });
    text((left + right) / 2, bottom + (rafterXs.length > 2 ? 54 : 30), '平面図（上から見た図）', { size: 13, weight: 700 });
  }

  // ---------- 右上の空きに材料の一覧 ----------
  {
    const bx = sideLeft, by = topTop, bw = Math.min(SHEET_W - 40 - bx, 340);
    const lineH = 16, maxLines = Math.floor((Dt * s - 40) / lineH);
    const rows = r.items.map((it) => [`${it.name}${it.spec && it.spec !== 'm' ? ' ' + it.spec : ''}`, `${it.qty.toLocaleString('ja-JP')}${it.spec === 'm' ? 'm' : it.group === '単管' ? '本' : it.name.includes('波板') && !it.name.includes('フック') ? '枚' : '個'}`]);
    if (bw > 180 && maxLines >= 4) {
      const shown = rows.slice(0, maxLines - 1);
      const h = 34 + (shown.length + 1) * lineH;
      out.push(`<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(h)}" fill="#faf9f7" stroke="#d6d1c8" rx="6"/>`);
      text(bx + 12, by + 20, '材料の一覧', { size: 12, anchor: 'start', weight: 700 });
      shown.forEach(([n, q], i) => {
        const y = by + 40 + i * lineH;
        text(bx + 12, y, n, { size: 10.5, anchor: 'start' });
        text(bx + bw - 12, y, q, { size: 10.5, anchor: 'end' });
      });
      if (rows.length > shown.length) text(bx + 12, by + 40 + shown.length * lineH, `ほか ${rows.length - shown.length} 品目`, { size: 10, anchor: 'start', fill: '#777' });
      const yT = by + h - 8;
      text(bx + 12, yT, '概算の材料費', { size: 11, anchor: 'start', weight: 700 });
      text(bx + bw - 12, yT, '¥' + Math.round(r.total).toLocaleString('ja-JP'), { size: 11, anchor: 'end', weight: 700, fill: '#c2410c' });
    }
  }

  // ---------- 表題欄と凡例 ----------
  const ty = SHEET_H - TITLE;
  out.push(`<line x1="20" y1="${ty}" x2="${SHEET_W - 20}" y2="${ty}" stroke="#1f2328" stroke-width="1"/>`);
  text(28, ty + 26, meta.name || '単管パイプ屋根', { size: 16, anchor: 'start', weight: 700 });
  const typeName = mono ? '片流れ' : '切妻';
  text(28, ty + 46, `${typeName}　間口 ${mm(W)} × 奥行 ${mm(D)} × 高さ ${mm(maxH)}　／　単位：mm`, { size: 11, anchor: 'start', fill: '#444' });
  const scale = Math.round(1000 / (s * (420 / SHEET_W)) / 5) * 5;
  text(SHEET_W - 28, ty + 26, `${meta.date || ''}`, { size: 11, anchor: 'end', fill: '#444' });
  text(SHEET_W - 28, ty + 46, `A3横で印刷すると約1/${scale}　（単管パイプ設計ツールで作成）`, { size: 10, anchor: 'end', fill: '#777' });
  let lx = 460;
  for (const [k, t] of LEGEND) {
    out.push(`<line x1="${lx}" y1="${ty + 22}" x2="${lx + 18}" y2="${ty + 22}" stroke="${COLORS[k]}" stroke-width="3" stroke-linecap="round"/>`);
    text(lx + 22, ty + 26, t, { size: 10.5, anchor: 'start' });
    lx += 30 + t.length * 11;
  }
  if (r.roof) {
    out.push(`<rect x="${lx}" y="${ty + 16}" width="18" height="11" fill="#9fd0f0" fill-opacity="0.35" stroke="#5c8fb3" stroke-width="0.9"/>`);
    text(lx + 22, ty + 26, '波板', { size: 10.5, anchor: 'start' });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}" height="${SHEET_H}" font-family="'Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif">`
    + `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>`
    + `<rect x="10" y="10" width="${SHEET_W - 20}" height="${SHEET_H - 20}" fill="none" stroke="#1f2328" stroke-width="1.2"/>`
    + out.join('') + '</svg>';
}
