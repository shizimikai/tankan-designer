// 単管パイプ屋根 設計ツール — 計算ロジック
// 座標系: x = 間口(幅)方向, y = 高さ, z = 奥行き方向（z=0 が前面）。単位は m。

export const STD_PIPES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6];
export const SHEETS = [
  { shaku: 6, len: 1.82 }, { shaku: 7, len: 2.12 }, { shaku: 8, len: 2.42 },
  { shaku: 9, len: 2.73 }, { shaku: 10, len: 3.03 }, { shaku: 12, len: 3.64 },
];
export const pipeKey = (s) => 'pp' + String(s).replace('.', '');
export const sheetKey = (shaku) => 'sp' + shaku;

export const DEFAULTS = {
  W: 3.0, D: 3.0, roofType: 'mono', H1: 3.0, H2: 2.6, Hr: 3.5,
  nx: 2, ny: 2, nr: 3,
  oe: 0.2, os: 0.15, ps: 0.7, roofing: true,
  bF: false, bB: true, bL: true, bR: true, braceStyle: 'single', hiuchi: true,
  bFlo: 0.15, bBlo: 0.15, bLlo: 0.15, bRlo: 0.15, // 筋交いの下端の高さ
  bFhi: 0, bBhi: 0, bLhi: 0, bRhi: 0,             // 筋交いの上端の高さ（0 = 桁まで）
  tF: 0, tB: 0, tL: 0, tR: 0,                     // 胴つなぎの高さ（0 = なし）
  margin: 0.1, anchorsPerBase: 4,
  // 単価（円・税込の目安）
  pp1: 900, pp15: 1200, pp2: 1400, pp25: 1700, pp3: 1950, pp35: 2200, pp4: 2400, pp5: 3100, pp6: 3700,
  cFixed: 350, cSwivel: 400, cJoint: 350, cBase: 900, cAnchor: 150, cCap: 60,
  sp6: 1500, sp7: 1750, sp8: 2000, sp9: 2250, sp10: 2500, sp12: 3000,
  cHook: 40, hookPitch: 0.25, sheetWork: 0.58, cRidge: 900,
};

const lin = (a, b, n) => (n < 2 ? [a] : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function stockFor(L, margin) {
  const need = L + margin;
  const max = STD_PIPES[STD_PIPES.length - 1];
  if (need <= max + 1e-9) return { pieces: [STD_PIPES.find((s) => s >= need - 1e-9)], joints: 0 };
  const n = Math.ceil(need / max);
  const s = STD_PIPES.find((v) => v >= need / n - 1e-9);
  return { pieces: Array(n).fill(s), joints: n - 1 };
}

export function sheetPlan(slen) {
  const maxL = SHEETS[SHEETS.length - 1].len;
  const need = slen + 0.05;
  if (need <= maxL) return { sheet: SHEETS.find((s) => s.len >= need), n: 1 };
  let n = 2;
  while ((need + 0.2 * (n - 1)) / n > maxL) n++;
  const each = (need + 0.2 * (n - 1)) / n;
  return { sheet: SHEETS.find((s) => s.len >= each), n };
}

export function compute(input) {
  const p = { ...DEFAULTS, ...input };
  // 旧バージョンの共有URL（胴つなぎの高さが1つだけ）に対応
  if (Number(input?.tieH) > 0) for (const k of ['F', 'B', 'L', 'R']) if (input['t' + k] == null) p['t' + k] = Number(input.tieH);
  const num = (k) => Number(p[k]);
  const W = num('W'), D = num('D');
  const nx = Math.max(2, Math.round(num('nx'))), ny = Math.max(2, Math.round(num('ny')));
  const mono = p.roofType === 'mono';
  const H1 = num('H1'), H2 = mono ? num('H2') : num('H1'), Hr = num('Hr');
  const oe = num('oe'), os = num('os'), ps = Math.max(0.2, num('ps'));
  const margin = num('margin');
  const nr = Math.max(nx, Math.round(num('nr')));
  const xs = lin(0, W, nx), zs = lin(0, D, ny), xr = lin(0, W, nr);

  const members = [];
  const add = (kind, name, a, b) => members.push({ kind, name, a, b, len: dist(a, b) });
  const cl = { fixed: 0, swivel: 0 };
  const warnings = [];
  const hAt = (z) => (mono ? H1 + ((H2 - H1) * z) / D : H1);

  if (!mono && Hr <= H1 + 0.05) {
    warnings.push({ level: 'error', text: '棟の高さが軒の高さ以下です。棟を軒より高くしてください。' });
  }

  // 柱（外周のみ）
  const posts = [];
  xs.forEach((x) => { posts.push([x, 0]); posts.push([x, D]); });
  zs.slice(1, -1).forEach((z) => { posts.push([0, z]); posts.push([W, z]); });
  posts.forEach(([x, z]) => add('post', '柱', [x, 0, z], [x, hAt(z), z]));

  // 桁（前・後）
  add('beam', '桁', [0, H1, 0], [W, H1, 0]);
  add('beam', '桁', [0, H2, D], [W, H2, D]);
  cl.fixed += 2 * nx;

  const slopes = []; // 屋根面: {pts:[4点], slen}
  let purlinCount = 0;
  let slopeRatio;

  if (mono) {
    const s = (H2 - H1) / D;
    slopeRatio = Math.abs(s);
    xr.forEach((x) => add('rafter', '垂木（登り梁）', [x, H1 - s * oe, -oe], [x, H2 + s * oe, D + oe]));
    cl.fixed += 2 * nr;            // 垂木-桁
    cl.swivel += 2 * (ny - 2);     // 側面の中間柱-垂木（斜め）
    const slen = (D + 2 * oe) * Math.sqrt(1 + s * s);
    const n = Math.max(2, Math.ceil((slen - 0.1) / ps) + 1);
    lin(-oe + 0.05, D + oe - 0.05, n).forEach((z) => add('purlin', '母屋', [-os, hAt(z), z], [W + os, hAt(z), z]));
    purlinCount = n;
    cl.fixed += n * nr;            // 母屋-垂木
    slopes.push({
      slen,
      pts: [[-os, hAt(-oe), -oe], [W + os, hAt(-oe), -oe], [W + os, hAt(D + oe), D + oe], [-os, hAt(D + oe), D + oe]],
    });
  } else {
    const half = D / 2, s = (Hr - H1) / half;
    slopeRatio = s;
    const yAt = (z) => (z <= half ? H1 + s * z : H1 + s * (D - z));
    xs.forEach((x) => {
      add('tiebeam', '陸梁', [x, H1, 0], [x, H1, D]);
      add('king', '束', [x, H1, half], [x, Hr, half]);
    });
    xr.forEach((x) => {
      add('rafter', '垂木（登り梁）', [x, H1 - s * oe, -oe], [x, Hr, half]);
      add('rafter', '垂木（登り梁）', [x, Hr, half], [x, H1 - s * oe, D + oe]);
    });
    add('ridge', '棟木', [0, Hr, half], [W, Hr, half]);
    cl.fixed += 2 * nx + 2 * (ny - 2); // 陸梁-柱
    cl.fixed += 2 * nx;                // 束-陸梁, 束-棟木
    cl.fixed += 4 * nr;                // 垂木-桁, 垂木-棟木
    const slen = (half + oe) * Math.sqrt(1 + s * s);
    const n = Math.max(2, Math.ceil((slen - 0.15) / ps) + 1);
    const zf = lin(-oe + 0.05, half - 0.1, n);
    zf.forEach((z) => add('purlin', '母屋', [-os, yAt(z), z], [W + os, yAt(z), z]));
    zf.forEach((z) => add('purlin', '母屋', [-os, yAt(z), D - z], [W + os, yAt(z), D - z]));
    purlinCount = 2 * n;
    cl.fixed += 2 * n * nr;
    const yE = yAt(-oe);
    slopes.push({ slen, pts: [[-os, yE, -oe], [W + os, yE, -oe], [W + os, Hr, half], [-os, Hr, half]] });
    slopes.push({ slen, pts: [[-os, Hr, half], [W + os, Hr, half], [W + os, yE, D + oe], [-os, yE, D + oe]] });
  }

  // 面ごとの定義（前面 z=0 / 後面 z=D / 左面 x=0 / 右面 x=W）
  const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
  const FACES = {
    F: { name: '前面', pts: xs, at: (t, y) => [t, y, 0], top: () => H1 },
    B: { name: '後面', pts: xs, at: (t, y) => [t, y, D], top: () => H2 },
    L: { name: '左面', pts: zs, at: (t, y) => [0, y, t], top: (t) => hAt(t) },
    R: { name: '右面', pts: zs, at: (t, y) => [W, y, t], top: (t) => hAt(t) },
  };

  // 胴つなぎ（面ごとに高さを変えられる。0 で入れない）
  for (const [k, f] of Object.entries(FACES)) {
    const h = num('t' + k);
    if (!(h > 0)) continue;
    const minTop = Math.min(...f.pts.map((t) => f.top(t)));
    if (h >= minTop - 0.15) {
      warnings.push({ level: 'warn', text: `${f.name}の胴つなぎ（${h}m）が桁の高さに近すぎるか超えているため、入れていません。` });
      continue;
    }
    add('tie', '胴つなぎ', f.at(f.pts[0], h), f.at(f.pts[f.pts.length - 1], h));
    cl.fixed += f.pts.length;
  }

  // 筋交い（面ごとに下端・上端の高さを変えられる。上端 0 は桁まで）
  const bTop = 0.12, MIN_RISE = 0.4;
  const X = p.braceStyle === 'x';
  const brace = (a, b) => { add('brace', '筋交い', a, b); cl.swivel += 2; };
  let braceFaces = 0;
  for (const [k, f] of Object.entries(FACES)) {
    if (!truthy(p['b' + k])) continue;
    const lo = Math.max(0.05, num('b' + k + 'lo'));
    const hiIn = num('b' + k + 'hi');
    const hiAt = (t) => (hiIn > 0 ? Math.min(hiIn, f.top(t) - bTop) : f.top(t) - bTop);
    let skipped = 0, placed = 0;
    for (let i = 0; i < f.pts.length - 1; i++) {
      const [a, b] = i % 2 === 0 ? [f.pts[i], f.pts[i + 1]] : [f.pts[i + 1], f.pts[i]];
      const pairs = X ? [[a, b], [b, a]] : [[a, b]];
      for (const [u, v] of pairs) {
        const yv = hiAt(v);
        if (yv - lo < MIN_RISE) { skipped++; continue; }
        brace(f.at(u, lo), f.at(v, yv)); placed++;
      }
    }
    if (skipped) warnings.push({ level: 'warn', text: `${f.name}の筋交いは下端と上端の差が${MIN_RISE * 100}cm未満の区間があるため、その区間には入れていません。` });
    if (placed) braceFaces++;
    if (placed && lo > 1.0) {
      const tieH = num('t' + k);
      if (!(tieH > 0 && Math.abs(tieH - lo) <= 0.3)) {
        warnings.push({ level: 'info', text: `${f.name}の筋交いは${lo}mの高さから出ています。柱の途中から出す場合は、同じ高さに胴つなぎを入れると力が伝わりやすくなります。` });
      }
    }
  }

  // 火打ち（上部の水平な角補強）
  if (truthy(p.hiuchi)) {
    const L = Math.min(0.7, W / 3, D / 3);
    [[0, 0, 1, 1], [W, 0, -1, 1], [0, D, 1, -1], [W, D, -1, -1]].forEach(([cx, cz, dx, dz]) => {
      add('hiuchi', '火打ち', [cx + dx * L, hAt(cz) - 0.05, cz], [cx, hAt(cz + dz * L) - 0.05, cz + dz * L]);
      cl.swivel += 2;
    });
  }

  // 定尺の割り当てと集計
  const groups = new Map();
  const purchase = new Map();
  let joints = 0;
  members.forEach((m, i) => {
    m.id = i;
    m.stock = stockFor(m.len, margin);
    joints += m.stock.joints;
    m.stock.pieces.forEach((s) => purchase.set(s, (purchase.get(s) || 0) + 1));
    const key = m.name + '|' + m.len.toFixed(2);
    m.key = key;
    if (!groups.has(key)) groups.set(key, { key, name: m.name, kind: m.kind, len: m.len, stock: m.stock, count: 0 });
    groups.get(key).count++;
  });
  const order = ['post', 'beam', 'tiebeam', 'king', 'ridge', 'rafter', 'purlin', 'tie', 'brace', 'hiuchi'];
  const memberTable = [...groups.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.len - a.len);

  const bases = posts.length;
  const anchors = bases * num('anchorsPerBase');
  const rafterCount = members.filter((m) => m.kind === 'rafter').length;
  const caps = posts.length + 2 * (2 + purlinCount + (mono ? 0 : 1)) + (mono ? 2 * rafterCount : rafterCount);

  // 屋根材
  const roofWidth = W + 2 * os;
  let roof = null;
  if (truthy(p.roofing)) {
    const across = Math.ceil(roofWidth / num('sheetWork'));
    const sheets = new Map();
    slopes.forEach((sl) => {
      const plan = sheetPlan(sl.slen);
      sheets.set(plan.sheet.shaku, (sheets.get(plan.sheet.shaku) || 0) + across * plan.n);
    });
    const hooks = purlinCount * (Math.ceil(roofWidth / num('hookPitch')) + 1);
    roof = { across, sheets, hooks, ridgeCap: mono ? 0 : roofWidth };
  }

  // 購入リストと費用
  const items = [];
  [...purchase.entries()].sort((a, b) => a[0] - b[0]).forEach(([s, n]) => {
    items.push({ group: '単管', name: `単管パイプ φ48.6`, spec: `${s}m`, qty: n, unit: num(pipeKey(s)) });
  });
  items.push({ group: '金具', name: '直交クランプ', spec: '48.6×48.6', qty: cl.fixed, unit: num('cFixed') });
  items.push({ group: '金具', name: '自在クランプ', spec: '48.6×48.6', qty: cl.swivel, unit: num('cSwivel') });
  if (joints) items.push({ group: '金具', name: '単管ジョイント', spec: '48.6', qty: joints, unit: num('cJoint') });
  items.push({ group: '金具', name: '固定ベース', spec: '48.6', qty: bases, unit: num('cBase') });
  items.push({ group: '金具', name: 'あと施工アンカー', spec: 'M10程度', qty: anchors, unit: num('cAnchor') });
  items.push({ group: '金具', name: '単管キャップ', spec: '48.6', qty: caps, unit: num('cCap') });
  if (roof) {
    [...roof.sheets.entries()].sort((a, b) => a[0] - b[0]).forEach(([shaku, n]) => {
      items.push({ group: '屋根', name: '波板（ポリカ等）', spec: `${shaku}尺`, qty: n, unit: num(sheetKey(shaku)) });
    });
    items.push({ group: '屋根', name: '単管用波板フック', spec: '', qty: roof.hooks, unit: num('cHook') });
    if (roof.ridgeCap) items.push({ group: '屋根', name: '棟包み', spec: 'm', qty: Math.ceil(roof.ridgeCap * 10) / 10, unit: num('cRidge') });
  }
  items.forEach((it) => (it.subtotal = Math.round(it.qty * it.unit)));
  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const pipeCount = [...purchase.values()].reduce((a, b) => a + b, 0);
  const pipeLength = [...purchase.entries()].reduce((a, [s, n]) => a + s * n, 0);

  // 注意事項
  const maxBayX = W / (nx - 1), maxBayZ = D / (ny - 1);
  if (slopeRatio < 0.1 - 1e-9) warnings.push({ level: 'warn', text: `屋根の勾配が約${(slopeRatio * 10).toFixed(1)}/10です。1/10より緩いと雨水が流れにくく、波板の重ね目から漏れやすくなります。` });
  const rafterSpan = W / (nr - 1);
  if (rafterSpan > 1.8 + 1e-9) warnings.push({ level: 'warn', text: `垂木の間隔（母屋が渡る距離）が${rafterSpan.toFixed(2)}mあります。1.8mを超えると母屋がたわみやすいので、垂木を増やしてください。` });
  if (maxBayX > 3.0 + 1e-9) warnings.push({ level: 'warn', text: `間口方向の柱の間隔が${maxBayX.toFixed(2)}mあります。3mを超えると桁がたわみやすいので、柱を増やしてください。` });
  if (maxBayZ > 3.0 + 1e-9) warnings.push({ level: 'warn', text: `奥行き方向の柱の間隔が${maxBayZ.toFixed(2)}mあります。3mを超えると垂木がたわみやすいので、柱を増やしてください。` });
  if (ps > 0.9) warnings.push({ level: 'warn', text: '母屋の間隔が90cmを超えています。波板が風でバタつきやすく、割れやすくなります。' });
  if (braceFaces < 3) warnings.push({ level: 'warn', text: '筋交いのある面が2面以下です。単管は揺れやすいので、少なくとも3面に入れることをおすすめします。' });
  if (W * D > 10 + 1e-9) warnings.push({ level: 'info', text: `床面積が約${(W * D).toFixed(1)}㎡で10㎡を超えます。屋根と柱があると建築物扱いになり、建築確認申請が必要になる場合があります。` });
  else warnings.push({ level: 'info', text: `床面積は約${(W * D).toFixed(1)}㎡です。防火地域・準防火地域でなければ、10㎡以下の増築は建築確認が不要な場合が多いですが、市区町村で確認してください。` });
  warnings.push({ level: 'info', text: 'このツールは部材の数と費用の目安を出すもので、強度計算はしていません。雪の多い地域や風の強い場所では、柱や垂木を増やすなど余裕を持たせてください。' });
  if (Math.max(H1, H2, mono ? 0 : Hr) > 3.5) warnings.push({ level: 'warn', text: '高さが3.5mを超えています。風を強く受けるので、筋交いと胴つなぎをしっかり入れてください。' });

  return {
    params: p, members, memberTable, items, total, clamps: cl, joints, bases, anchors, caps,
    pipeCount, pipeLength, weight: pipeLength * 2.08, roof, slopes, warnings, slopeRatio,
    dims: { W, D, H1, H2, Hr, mono, oe, os },
  };
}
