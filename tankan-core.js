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
  bF: false, bB: true, bL: true, bR: true, hiuchi: true,
  bFs: 'single', bBs: 'single', bLs: 'single', bRs: 'single', // 筋交いの入れ方（面ごと）：single=片筋交い / x=たすき
  bFlo: 0.15, bBlo: 0.15, bLlo: 0.15, bRlo: 0.15, // 筋交いの下端の高さ
  bFhi: 0, bBhi: 0, bLhi: 0, bRhi: 0,             // 筋交いの上端の高さ（0 = 桁まで）
  tF: 0, tB: 0, tL: 0, tR: 0,                     // 胴つなぎの高さ（0 = なし）
  base: 'slab', embed: 0.6, holeD: 0.25, // 基礎：slab=土間に固定 / pincoro=ピンコロ / buried=穴を掘ってコンクリート / driven=打ち込み
  margin: 0.1, anchorsPerBase: 4,
  // 単価（円・税込の目安）
  pp1: 900, pp15: 1200, pp2: 1400, pp25: 1700, pp3: 1950, pp35: 2200, pp4: 2400, pp5: 3100, pp6: 3700,
  cFixed: 350, cSwivel: 400, cJoint: 350, cBase: 900, cAnchor: 150, cCap: 60,
  sp6: 1500, sp7: 1750, sp8: 2000, sp9: 2250, sp10: 2500, sp12: 3000,
  cPincoro: 400, cGravel: 350, cConcrete: 750, cDriveCap: 700,
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
  // 旧バージョン（筋交いの入れ方が全体で1つ）に対応
  if (input?.braceStyle) for (const k of ['F', 'B', 'L', 'R']) if (input['b' + k + 's'] == null) p['b' + k + 's'] = input.braceStyle;
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
    warnings.push({ level: 'error', text: '[[棟]]の高さが、[[軒]]の高さと同じか、それより低くなっています。これでは三角の屋根になりません。「棟の高さ」を「軒の高さ」より大きい数字にしてください。' });
  }

  // 柱（外周のみ）
  const posts = [];
  xs.forEach((x) => { posts.push([x, 0]); posts.push([x, D]); });
  zs.slice(1, -1).forEach((z) => { posts.push([0, z]); posts.push([W, z]); });
  const base = ['slab', 'pincoro', 'buried', 'driven'].includes(p.base) ? p.base : 'slab';
  const embed = base === 'buried' || base === 'driven' ? Math.max(0, num('embed')) : 0;
  const holeD = num('holeD');
  posts.forEach(([x, z]) => add('post', '柱', [x, -embed, z], [x, hAt(z), z]));

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
    L: { name: '右面', pts: zs, at: (t, y) => [0, y, t], top: (t) => hAt(t) },
    R: { name: '左面', pts: zs, at: (t, y) => [W, y, t], top: (t) => hAt(t) },
  };

  // 胴つなぎ（面ごとに高さを変えられる。0 で入れない）
  for (const [k, f] of Object.entries(FACES)) {
    const h = num('t' + k);
    if (!(h > 0)) continue;
    const minTop = Math.min(...f.pts.map((t) => f.top(t)));
    if (h >= minTop - 0.15) {
      warnings.push({ level: 'warn', text: `${f.name}の[[胴つなぎ]]の高さ（${h}m）が、[[桁]]とほぼ同じか、それより上になっています。そこには取り付けられないので、この面の胴つなぎは入れていません。桁より15cm以上低い高さにしてください。` });
      continue;
    }
    add('tie', '胴つなぎ', f.at(f.pts[0], h), f.at(f.pts[f.pts.length - 1], h));
    cl.fixed += f.pts.length;
  }

  // 筋交い（面ごとに下端・上端の高さを変えられる。上端 0 は桁まで）
  const bTop = 0.12, MIN_RISE = 0.4;
  const brace = (a, b) => { add('brace', '筋交い', a, b); cl.swivel += 2; };
  let braceFaces = 0;
  for (const [k, f] of Object.entries(FACES)) {
    if (!truthy(p['b' + k])) continue;
    const X = p['b' + k + 's'] === 'x';
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
    if (skipped) warnings.push({ level: 'warn', text: `${f.name}の[[筋交い]]は、下端と上端の高さの差が${MIN_RISE * 100}cmより小さい区間があるため、その区間には入れていません。筋交いは斜めに長く入れるほど揺れを止める力が強く、差が小さいとほとんど効きません。「筋交いの下端」を下げるか、「筋交いの上端」を上げてください。` });
    if (placed) braceFaces++;
    if (placed && lo > 1.0) {
      const tieH = num('t' + k);
      if (!(tieH > 0 && Math.abs(tieH - lo) <= 0.3)) {
        warnings.push({ level: 'info', text: `${f.name}の[[筋交い]]が、地面の近くではなく柱の途中（高さ${lo}m）から出ています。筋交いは、柱や[[桁]]と三角形を作って揺れを止めます。途中から出すと、揺れたときに筋交いの根元が柱を横から押す形になり、その高さで柱が「く」の字に曲がりやすくなります。同じ高さに[[胴つなぎ]]を入れると、押す力を隣の柱に逃がせます。この面の「胴つなぎの高さ」に ${lo} を入れてみてください。` });
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

  const postCount = posts.length;
  const useBase = base === 'slab' || base === 'pincoro';
  const bases = useBase ? postCount : 0;
  const anchors = bases * (base === 'pincoro' ? Math.min(2, num('anchorsPerBase')) : num('anchorsPerBase')); // ピンコロは小さいので2本まで
  const holeVol = Math.PI * (holeD / 2) ** 2 * embed;           // 穴1つのコンクリート量（m³）
  const concreteBags = base === 'buried' ? Math.ceil((postCount * holeVol) / 0.011) : 0; // 25kg袋 ≒ 0.011m³
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
    items.push({ group: '単管', name: `単管パイプ φ48.6`, term: '単管パイプ', spec: `${s}m`, qty: n, unit: num(pipeKey(s)) });
  });
  items.push({ group: '金具', name: '直交クランプ', term: '直交クランプ', spec: '48.6×48.6', qty: cl.fixed, unit: num('cFixed') });
  items.push({ group: '金具', name: '自在クランプ', term: '自在クランプ', spec: '48.6×48.6', qty: cl.swivel, unit: num('cSwivel') });
  if (joints) items.push({ group: '金具', name: '単管ジョイント', term: '単管ジョイント', spec: '48.6', qty: joints, unit: num('cJoint') });
  if (useBase) {
    items.push({ group: '金具', name: '固定ベース', term: '固定ベース', spec: '48.6', qty: bases, unit: num('cBase') });
    items.push({ group: '金具', name: 'あと施工アンカー', term: 'あと施工アンカー', spec: base === 'pincoro' ? 'M8〜M10' : 'M10程度', qty: anchors, unit: num('cAnchor') });
  }
  items.push({ group: '金具', name: '単管キャップ', term: '単管キャップ', spec: '48.6', qty: caps, unit: num('cCap') });
  if (base === 'pincoro') {
    items.push({ group: '基礎', name: 'ピンコロ（束石）', term: 'ピンコロ', spec: '20cm角', qty: postCount, unit: num('cPincoro') });
    items.push({ group: '基礎', name: '砕石', term: '砕石', spec: '20kg袋', qty: Math.ceil(postCount / 2), unit: num('cGravel') });
  } else if (base === 'buried') {
    items.push({ group: '基礎', name: 'ドライコンクリート', term: 'ドライコンクリート', spec: '25kg袋', qty: concreteBags, unit: num('cConcrete') });
    items.push({ group: '基礎', name: '砕石', term: '砕石', spec: '20kg袋', qty: Math.ceil(postCount / 2), unit: num('cGravel') });
  } else if (base === 'driven') {
    items.push({ group: '基礎', name: '単管打ち込みキャップ', term: '打ち込みキャップ', spec: '道具・1個', qty: 1, unit: num('cDriveCap') });
  }
  if (roof) {
    [...roof.sheets.entries()].sort((a, b) => a[0] - b[0]).forEach(([shaku, n]) => {
      items.push({ group: '屋根', name: '波板（ポリカ等）', term: '波板', spec: `${shaku}尺`, qty: n, unit: num(sheetKey(shaku)) });
    });
    items.push({ group: '屋根', name: '単管用波板フック', term: '波板フック', spec: '', qty: roof.hooks, unit: num('cHook') });
    if (roof.ridgeCap) items.push({ group: '屋根', name: '棟包み', term: '棟包み', spec: 'm', qty: Math.ceil(roof.ridgeCap * 10) / 10, unit: num('cRidge') });
  }
  items.forEach((it) => (it.subtotal = Math.round(it.qty * it.unit)));
  const total = items.reduce((s, it) => s + it.subtotal, 0);
  const pipeCount = [...purchase.values()].reduce((a, b) => a + b, 0);
  const pipeLength = [...purchase.entries()].reduce((a, [s, n]) => a + s * n, 0);

  // 注意事項
  const maxBayX = W / (nx - 1), maxBayZ = D / (ny - 1);
  if (slopeRatio < 0.1 - 1e-9 && (mono || Hr > H1 + 0.05)) {
    const needCm = Math.ceil((mono ? D : D / 2) * 0.1 * 100);
    const how = mono ? `前と後ろの高さの差を${needCm}cm以上にしてください` : `棟と軒の高さの差を${needCm}cm以上にしてください`;
    warnings.push({ level: 'warn', text: `屋根の[[勾配]]が約${(slopeRatio * 10).toFixed(1)}/10です。横に10進むあいだに${(slopeRatio * 10).toFixed(1)}しか下がらない、ということです。1/10より緩いと雨水がうまく流れず、[[波板]]を重ねた部分から雨が漏れやすくなります。${how}（傾きが1/10になる差です）。` });
  }
  const rafterSpan = W / (nr - 1);
  if (rafterSpan > 1.8 + 1e-9) warnings.push({ level: 'warn', text: `[[垂木]]の間隔が${rafterSpan.toFixed(2)}mあります。[[母屋]]は垂木と垂木の間に渡されるので、この間隔が広いと、屋根の重さや雪で母屋が真ん中から下にたわみやすくなります。間隔が1.8m以下になるように「垂木の本数」を増やしてください。` });
  if (maxBayX > 3.0 + 1e-9) warnings.push({ level: 'warn', text: `前と後ろの列で、柱と柱の間が${maxBayX.toFixed(2)}mあります。3mを超えると、柱の上に渡す[[桁]]が真ん中で下にたわみやすくなります。「間口方向の柱の本数」を増やしてください。` });
  if (maxBayZ > 3.0 + 1e-9) warnings.push({ level: 'warn', text: `左右の列で、柱と柱の間が${maxBayZ.toFixed(2)}mあります。3mを超えると、[[垂木]]が真ん中でたわみやすくなります。「奥行き方向の柱の本数」を増やしてください。` });
  if (ps > 0.9) warnings.push({ level: 'warn', text: '[[母屋]]の間隔が90cmを超えています。[[波板]]を支える場所が少ないと、強い風で波板がバタついて割れたり、留め具が外れて飛ばされたりしやすくなります。「母屋の間隔」を60〜90cmにしてください。' });
  if (braceFaces < 3) warnings.push({ level: 'warn', text: `[[筋交い]]が入っている面が${braceFaces}面しかありません。単管を四角に組んだだけだと、横から押されたときに平行四辺形のようにグラグラ傾いてしまいます。この揺れを止められるのは、筋交いが入っている面だけです。出入りする前面を除いた3面には入れるのがおすすめです。` });
  if (W * D > 10 + 1e-9) warnings.push({ level: 'info', text: `床面積が約${(W * D).toFixed(1)}㎡あります。屋根と柱があるものは、小さくても法律上「建物」として扱われます。10㎡を超えると、原則として[[建築確認]]の申請が必要になります。作る前に、市区町村の建築指導課などに相談してください。` });
  else warnings.push({ level: 'info', text: `床面積は約${(W * D).toFixed(1)}㎡です。屋根と柱があるものは、小さくても法律上「建物」として扱われます。ただ、10㎡以下で、防火地域・準防火地域でなければ、[[建築確認]]の申請はいらないことが多いです。念のため、市区町村の建築指導課などで確認してください。` });
  warnings.push({ level: 'info', text: 'このツールは、部材の本数と費用の目安を出すためのものです。「この組み方で雪や風に耐えられるか」という強度の計算はしていません。雪がよく積もる地域や、台風・強風が多い場所では、柱・垂木・筋交いを多めにしてください。不安なときは、工務店などに相談すると安心です。' });
  if (Math.max(H1, H2, mono ? 0 : Hr) > 3.5) warnings.push({ level: 'warn', text: '高さが3.5mを超えています。背が高いほど風を受けたときに大きく揺れ、柱の足元にも大きな力がかかります。[[筋交い]]を4面すべてに入れ、[[胴つなぎ]]も入れてください。' });

  // 基礎についての注意
  const hasLowTie = ['F', 'B', 'L', 'R'].filter((k) => { const t = num('t' + k); return t > 0 && t <= 0.5; }).length >= 3;
  if (base === 'pincoro') {
    warnings.push({ level: 'warn', text: `[[ピンコロ]]は地面に置いてあるだけなので、強い風が屋根の下に吹き込むと、屋根ごと持ち上げられたり、ずれたりすることがあります。ピンコロを半分以上地面に埋める、大きめの[[束石]]にする、などで対策してください。${hasLowTie ? '' : '柱の足元どうしを[[根がらみ]]でつなぐのも効果があります（4面の「胴つなぎの高さ」を0.2くらいにすると根がらみになります）。'}台風が多い地域では、「穴を掘ってコンクリートで固める」方法の方が安心です。` });
  } else if (base === 'buried') {
    const perHole = Math.max(1, Math.round(holeVol / 0.011 * 10) / 10);
    warnings.push({ level: 'info', text: `柱の下を${Math.round(embed * 100)}cm地面に埋めて、まわりを[[ドライコンクリート]]で固めます。穴1つにつき約${perHole}袋（25kg）使う計算です。穴の底には[[砕石]]を敷いて突き固めてください。地面との境目は錆びやすいので、そこに錆止め塗料を塗っておくと長持ちします。` });
    if (embed < 0.5) warnings.push({ level: 'warn', text: `[[根入れ]]が${Math.round(embed * 100)}cmしかありません。浅いと風で柱が抜けたり傾いたりしやすいので、50cm以上（できれば60cm以上）にしてください。` });
  } else if (base === 'driven') {
    warnings.push({ level: 'warn', text: `単管を地面に直接打ち込む方法は手軽ですが、雨で地面がゆるむと柱が沈んだり傾いたりしやすく、屋根付きのものにはあまり向きません。[[根入れ]]は60cm以上にして、${hasLowTie ? '' : '[[根がらみ]]で柱の足元どうしをつなぎ、'}できれば「穴を掘ってコンクリートで固める」方法も検討してください。` });
    if (embed < 0.6) warnings.push({ level: 'warn', text: `[[根入れ]]が${Math.round(embed * 100)}cmしかありません。打ち込みの場合は60cm以上が目安です。` });
  }

  return {
    params: p, members, memberTable, items, total, clamps: cl, joints, bases, anchors, caps, postCount, concreteBags,
    pipeCount, pipeLength, weight: pipeLength * 2.08, roof, slopes, warnings, slopeRatio,
    dims: { W, D, H1, H2, Hr, mono, oe, os, base, embed, holeD },
  };
}
