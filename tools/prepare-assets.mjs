/**
 * 素材预处理：把网上扒来的原始图处理成游戏可直接用的透明 PNG。
 *
 * 两类输入：
 *  1) 已经带 alpha 的官方桌宠切图（奶蛋）——沿用自带蒙版，只修补被抠穿的内部空洞。
 *  2) 白底工作室立绘（奶蛙）——从四边洪水填充去白底，再做 alpha 溢色，避免白边。
 *
 * 用法：node tools/prepare-assets.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const srcDir = path.join(root, 'art-source');
const outDir = path.join(root, 'assets');
const previewDir = path.join(root, 'shots', 'assets-preview');

const rawOf = async (file) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), W: info.width, H: info.height };
};

/**
 * 判据用"亮度 + 黄色分量"而不是单纯饱和度：
 *  - 白底 / 浅灰投影：亮度高、几乎不含黄（奶蛙奶蛋主体是黄奶油色，黄色分量高）
 *  - 主体浅奶油色（252,240,205）：黄色分量 ≈ 41，安全
 */
const yellowCast = (r, g, b) => (r + g) / 2 - b;
const isBackgroundLike = (data, i, minLuma, maxYellow) => {
  const o = i * 4;
  const r = data[o], g = data[o + 1], b = data[o + 2];
  return Math.min(r, g, b) >= minLuma && yellowCast(r, g, b) <= maxYellow;
};

/**
 * 从"已经是透明"或"贴着画布边缘的浅色"出发做洪水填充，
 * 把连通的白色背景 + 浅灰地面投影一起吃掉。
 * bandFrom：只在这个高度的下方做清理（用来保住奶蛋头上那片奶白色帽檐）。
 */
const floodKeyWhite = (data, W, H, alphaIn, { minLuma = 165, maxYellow = 22, bandFrom = 0 } = {}) => {
  const bg = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  const bandTop = Math.floor(H * bandFrom);
  const inBand = (i) => Math.floor(i / W) >= bandTop;
  const seed = (i) => {
    if (!bg[i] && inBand(i) && isBackgroundLike(data, i, minLuma, maxYellow)) {
      bg[i] = 1;
      queue[qt++] = i;
    }
  };
  if (alphaIn) {
    // 自带蒙版的图：透明的像素就是种子
    for (let i = bandTop * W; i < W * H; i++) if (alphaIn[i] <= 24) seed(i);
  }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = bandTop; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % W, y = (i - x) / W;
    const visit = (n) => {
      if (!bg[n] && isBackgroundLike(data, n, minLuma, maxYellow)) {
        bg[n] = 1;
        queue[qt++] = n;
      }
    };
    if (x > 0 && inBand(i - 1)) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (y > 0 && inBand(i - W)) visit(i - W);
    if (y < H - 1) visit(i + W);
  }
  return bg;
};

/**
 * 二阶段清理：工作室立绘脚下那块投影是被黄色环境光照过的暖灰，
 * 亮度够但饱和度不低，单靠"白白净净"判据吃不掉。
 * 这里只在画面最底部一小条里，允许洪水穿过"低饱和中间调"，把投影裙边收干净。
 */
const floodSoftShadow = (data, W, H, bg, { bandFrom = 0.8, maxSat = 36, minLuma = 140 } = {}) => {
  const bandTop = Math.floor(H * bandFrom);
  const queue = new Int32Array(W * H);
  let qt = 0;
  const ok = (i) => {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mn >= minLuma && mx - mn <= maxSat;
  };
  for (let i = bandTop * W; i < W * H; i++) if (bg[i]) queue[qt++] = i;
  let qh = 0;
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % W, y = (i - x) / W;
    const visit = (n) => {
      if (n < bandTop * W) return;
      if (!bg[n] && ok(n)) { bg[n] = 1; queue[qt++] = n; }
    };
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (y > 0) visit(i - W);
    if (y < H - 1) visit(i + W);
  }
  return bg;
};

/** alpha 腐蚀 1px，削掉抗锯齿残留的白边，再高斯羽化回柔和边缘。 */
const refineAlpha = (alpha, W, H) => {
  const eroded = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (alpha[i] < 128) { eroded[i] = 0; continue; }
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || alpha[ny * W + nx] < 128) { all = false; break; }
        }
      }
      eroded[i] = all ? 255 : 0;
    }
  }
  const kernel = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136];
  const blur = (src, dst) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = -2; k <= 2; k++) {
          const nx = Math.min(W - 1, Math.max(0, x + k));
          acc += src[y * W + nx] * kernel[k + 2];
        }
        dst[y * W + x] = acc;
      }
    }
  };
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  blur(eroded, tmp);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let k = -2; k <= 2; k++) {
        const ny = Math.min(H - 1, Math.max(0, y + k));
        acc += tmp[ny * W + x] * kernel[k + 2];
      }
      out[y * W + x] = acc;
    }
  }
  const res = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) res[i] = Math.max(0, Math.min(255, Math.round(out[i])));
  return res;
};

/** 找出所有"被前景包围"的透明区域（例如被抠穿的白色抱枕），把它们还原成不透明。 */
const restoreEnclosedHoles = (alpha, W, H, { minArea = 220 } = {}) => {
  const seen = new Uint8Array(W * H);
  let restored = 0;
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || alpha[start] > 24) continue;
    const stack = [start];
    const region = [];
    seen[start] = 1;
    let touchesBorder = false;
    while (stack.length) {
      const i = stack.pop();
      region.push(i);
      const x = i % W, y = (i - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touchesBorder = true;
      const neigh = [];
      if (x > 0) neigh.push(i - 1);
      if (x < W - 1) neigh.push(i + 1);
      if (y > 0) neigh.push(i - W);
      if (y < H - 1) neigh.push(i + W);
      for (const n of neigh) {
        if (!seen[n] && alpha[n] <= 24) { seen[n] = 1; stack.push(n); }
      }
    }
    if (!touchesBorder && region.length >= minArea) {
      for (const i of region) alpha[i] = 255;
      restored += region.length;
    }
  }
  return restored;
};

/** 透明像素向邻近不透明像素借色，防止缩放/边缘出现白边。 */
const bleedColors = (data, alphaRef, W, H, passes = 4) => {
  for (let p = 0; p < passes; p++) {
    const snapshot = data.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (alphaRef[i] > 24) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (alphaRef[j] <= 24) continue;
            r += snapshot[j * 4]; g += snapshot[j * 4 + 1]; b += snapshot[j * 4 + 2]; n++;
          }
        }
        if (n) {
          data[i * 4] = Math.round(r / n);
          data[i * 4 + 1] = Math.round(g / n);
          data[i * 4 + 2] = Math.round(b / n);
        }
      }
    }
  }
};

const writeTransparent = async (data, alpha, W, H, outFile, { height }) => {
  const CH = H;
  const rgba = Buffer.alloc(W * CH * 4);
  for (let i = 0; i < W * CH; i++) {
    rgba[i * 4] = data[i * 4];
    rgba[i * 4 + 1] = data[i * 4 + 1];
    rgba[i * 4 + 2] = data[i * 4 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  bleedColors(data, alpha, W, CH);
  for (let i = 0; i < W * CH; i++) {
    rgba[i * 4] = data[i * 4];
    rgba[i * 4 + 1] = data[i * 4 + 1];
    rgba[i * 4 + 2] = data[i * 4 + 2];
  }
  let img = sharp(rgba, { raw: { width: W, height: CH, channels: 4 } }).png();
  img = img.trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 });
  if (height) img = img.resize({ height, fit: 'inside', withoutEnlargement: false });
  await img.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(outFile);
  return sharp(outFile).metadata();
};

/**
 * 摄影棚立绘最底下那几行总有一条灰白地板/投影。
 * 逐行自下往上判断"角色像素"占比，占比太低就整行抹掉；
 * 再顺手清掉底带里残留的灰白像素（脚边的投影），别伤到饱和的脚。
 */
const cleanBottomBand = (data, alpha, W, H, { band = 0.1, vividRatio = 0.18 } = {}) => {
  const vivid = (i) => {
    const o = i * 4;
    return yellowCast(data[o], data[o + 1], data[o + 2]) > 38 || Math.min(data[o], data[o + 1], data[o + 2]) < 150;
  };
  const bandTop = Math.floor(H * (1 - band));
  const limit = Math.floor(H * 0.9);
  let cleared = 0;
  for (let y = H - 1; y >= limit; y--) {
    let vividCount = 0;
    for (let x = 0; x < W; x++) if (alpha[y * W + x] > 100 && vivid(y * W + x)) vividCount++;
    if (vividCount / W >= vividRatio) break;
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x]) { alpha[y * W + x] = 0; cleared++; }
    }
  }
  for (let y = bandTop; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (alpha[i] < 100) continue;
      const o = i * 4;
      if (yellowCast(data[o], data[o + 1], data[o + 2]) < 26 && Math.min(data[o], data[o + 1], data[o + 2]) > 185) {
        alpha[i] = 0;
        cleared++;
      }
    }
  }
  return cleared;
};

const processStanding = async (src, out, opts) => {
  const { data, W, H } = await rawOf(src);
  const bg = floodKeyWhite(data, W, H, null, { minLuma: 160, maxYellow: 22, ...opts });
  floodSoftShadow(data, W, H, bg, opts.softShadow ?? {});
  const alpha = new Uint8Array(W * H).fill(255);
  for (let i = 0; i < W * H; i++) if (bg[i]) alpha[i] = 0;
  const restored = restoreEnclosedHoles(alpha, W, H);
  const band = cleanBottomBand(data, alpha, W, H);
  const shaped = refineAlpha(alpha, W, H);
  for (let i = 0; i < W * H; i++) alpha[i] = shaped[i];
  const meta = await writeTransparent(data, alpha, W, H, out, opts);
  console.log(`  ${path.basename(out)}  ${meta.width}x${meta.height}  去白底 ${bg.reduce((a, b) => a + b, 0)}px  补洞 ${restored}px  清底带 ${band}px`);
  return out;
};

const processAlphaSprite = async (src, out, opts) => {
  const { data, W, H } = await rawOf(src);
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = data[i * 4 + 3];
  // 官方切图底部带了一层白色摄影棚地面：只处理下半部分，别碰奶白色帽檐
  const bg = floodKeyWhite(data, W, H, alpha, { minLuma: 205, maxYellow: 20, bandFrom: 0.45 });
  floodSoftShadow(data, W, H, bg, { bandFrom: 0.82, maxSat: 46, minLuma: 120 });
  for (let i = 0; i < W * H; i++) if (bg[i]) alpha[i] = 0;
  const restored = restoreEnclosedHoles(alpha, W, H, { minArea: 120 });
  const band = cleanBottomBand(data, alpha, W, H, { band: 0.12, vividRatio: 0.12 });
  const shaped = refineAlpha(alpha, W, H);
  for (let i = 0; i < W * H; i++) alpha[i] = shaped[i];
  const meta = await writeTransparent(data, alpha, W, H, out, opts);
  console.log(`  ${path.basename(out)}  ${meta.width}x${meta.height}  洗地面 ${bg.reduce((a, b) => a + b, 0)}px  补洞 ${restored}px  清底带 ${band}px`);
  return out;
};

const makePreview = async (files, outFile) => {
  const cell = 260;
  const composites = [];
  for (let i = 0; i < files.length; i++) {
    const buf = await sharp(files[i][1])
      .resize({ height: cell - 30, fit: 'inside', withoutEnlargement: false })
      .toBuffer();
    composites.push({ input: buf, left: i * cell + 15, top: cell - 15, gravity: 'southwest' });
  }
  const bgSvg = `<svg width="${files.length * cell}" height="${cell}">
    <defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse">
      <rect width="20" height="20" fill="#5b7fbd"/><rect width="10" height="10" fill="#7fa0d6"/>
      <rect x="10" y="10" width="10" height="10" fill="#7fa0d6"/>
    </pattern></defs>
    <rect width="100%" height="100%" fill="url(#c)"/>
  </svg>`;
  await sharp(Buffer.from(bgSvg))
    .composite(composites.map((c, i) => ({ input: c.input, left: i * cell + 20, top: 15 })))
    .png()
    .toFile(outFile);
  console.log(`预览图 → ${outFile}`);
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  const made = [];

  console.log('奶蛋（沿用自带透明蒙版）：');
  made.push(['奶蛋 idle', await processAlphaSprite(path.join(srcDir, 'naidan_idle.png'), path.join(outDir, 'naidan_idle.png'), { height: 420 })]);
  made.push(['奶蛋 blink', await processAlphaSprite(path.join(srcDir, 'naidan_blink.png'), path.join(outDir, 'naidan_blink.png'), { height: 420 })]);
  made.push(['奶蛋 turn', await processAlphaSprite(path.join(srcDir, 'naidan_turn.png'), path.join(outDir, 'naidan_turn.png'), { height: 420 })]);

  console.log('奶蛙（白底立绘抠图）：');
  made.push(['奶蛙 angry', await processStanding(path.join(srcDir, 'naiwa_angry.png'), path.join(outDir, 'naiwa_angry.png'), { height: 420 })]);
  made.push(['奶蛙 happy', await processStanding(path.join(srcDir, 'naiwa_happy.png'), path.join(outDir, 'naiwa_happy.png'), { height: 420 })]);
  made.push(['奶蛙 sit', await processStanding(path.join(srcDir, 'naiwa_sit.png'), path.join(outDir, 'naiwa_sit.png'), { height: 420 })]);

  await makePreview(made, path.join(previewDir, 'assets-preview.png'));
};

main().catch((e) => { console.error(e); process.exit(1); });
