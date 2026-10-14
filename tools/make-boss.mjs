/**
 * boss 素材处理：把用户给的手机截图（正面抱臂的胖奶蛙）变成游戏用立绘。
 *
 * 截图里有一堆非角色的东西：状态栏、上下黑边、底部按钮条，所以流程是
 *   1) 自动找出"照片区域"（整行亮度高的那一段，把黑边和状态栏排除）
 *   2) 在照片区域里找角色的包围盒（非白色像素）
 *   3) 裁出来，再走一遍白底抠图（沿用 prepare-assets 的思路：从四边洪水填充 + 溢色 + 羽化）
 *   4) 顺手生成一张"大笑"变体（在嘴的位置贴一张张开的嘴），死亡飞出去那下用它
 *
 * 用法：node tools/make-boss.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'art-source', 'boss_src.jpg');
const outDir = path.join(root, 'assets');
const previewDir = path.join(root, 'shots', 'assets-preview');

const load = async (file) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8Array(data), W: info.width, H: info.height };
};

const lum = (px, i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

/** 一行里"接近白色"的像素占比 */
const whiteRatio = (px, W, y) => {
  let n = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (lum(px, i) > 232) n++;
  }
  return n / W;
};

/** 照片区域 = 连续的行，每行都够亮（截图里的黑白边、状态栏都不满足） */
const findPhotoBand = (px, W, H) => {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < H; y++) {
    if (whiteRatio(px, W, y) > 0.25) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return { top: Math.max(0, top), bottom: Math.min(H - 1, bottom) };
};

/** 角色包围盒：照片区域里既不是白底、也不是灰白阴影的像素 */
const figureBox = (px, W, top, bottom) => {
  let l = W;
  let r = 0;
  let t = bottom;
  let b = top;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const R = px[i];
      const G = px[i + 1];
      const B = px[i + 2];
      const mx = Math.max(R, G, B);
      const mn = Math.min(R, G, B);
      const yellow = (R + G) / 2 - B;
      if (yellow > 26 || mn < 150) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return { l, r, t, b };
};

/** 白底抠图：从四边洪水填充，把连通的白色/浅灰一起清掉 */
const cutout = (px, W, H) => {
  const alpha = new Uint8Array(W * H).fill(255);
  const bgLike = (i) => {
    const R = px[i];
    const G = px[i + 1];
    const B = px[i + 2];
    const mn = Math.min(R, G, B);
    const mx = Math.max(R, G, B);
    return mn >= 196 && mx - mn <= 26;
  };
  const seen = new Uint8Array(W * H);
  const queue = [];
  const seed = (i) => {
    if (!seen[i] && bgLike(i)) {
      seen[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    seed(x);
    seed((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    seed(y * W);
    seed(y * W + W - 1);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % W;
    const y = (i - x) / W;
    const visit = (n) => {
      if (!seen[n] && bgLike(n * 4)) {
        seen[n] = 1;
        queue.push(n);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (y > 0) visit(i - W);
    if (y < H - 1) visit(i + W);
  }
  for (const i of queue) alpha[i] = 0;
  // 边缘羽化：半透明过渡带
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (alpha[i] === 0) continue;
      let near = 0;
      if (alpha[i - 1] === 0) near++;
      if (alpha[i + 1] === 0) near++;
      if (alpha[i - W] === 0) near++;
      if (alpha[i + W] === 0) near++;
      if (near > 0) alpha[i] = 255 - near * 60;
    }
  }
  return alpha;
};

/** 透明像素向邻居借色，防止缩放后出现白边 */
const bleed = (px, alpha, W, H, passes = 3) => {
  for (let p = 0; p < passes; p++) {
    const snap = px.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (alpha[i] > 24) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (alpha[j] <= 24) continue;
            r += snap[j * 4];
            g += snap[j * 4 + 1];
            b += snap[j * 4 + 2];
            n++;
          }
        }
        if (n) {
          px[i * 4] = Math.round(r / n);
          px[i * 4 + 1] = Math.round(g / n);
          px[i * 4 + 2] = Math.round(b / n);
        }
      }
    }
  }
};

const main = async () => {
  await fs.mkdir(previewDir, { recursive: true });
  const { px, W, H } = await load(src);
  const band = findPhotoBand(px, W, H);
  const box = figureBox(px, W, band.top, band.bottom);
  console.log(`照片区域 y=${band.top}..${band.bottom}，角色框 ${box.l},${box.t} → ${box.r},${box.b}`);

  const pad = 6;
  const cl = Math.max(0, box.l - pad);
  const ct = Math.max(0, box.t - pad);
  const cw = Math.min(W - cl, box.r - box.l + pad * 2);
  const ch = Math.min(H - ct, box.b - box.t + pad * 2);
  const cropped = await sharp(src).extract({ left: cl, top: ct, width: cw, height: ch }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cpx = new Uint8Array(cropped.data);
  const CW = cropped.info.width;
  const CH = cropped.info.height;
  const alpha = cutout(cpx, CW, CH);
  bleed(cpx, alpha, CW, CH);

  const rgba = Buffer.alloc(CW * CH * 4);
  for (let i = 0; i < CW * CH; i++) {
    rgba[i * 4] = cpx[i * 4];
    rgba[i * 4 + 1] = cpx[i * 4 + 1];
    rgba[i * 4 + 2] = cpx[i * 4 + 2];
    rgba[i * 4 + 3] = alpha[i];
  }
  const base = sharp(rgba, { raw: { width: CW, height: CH, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 });
  const trimmed = await base.png().toBuffer();
  const meta = await sharp(trimmed).metadata();
  console.log(`裁出角色 ${meta.width}x${meta.height}`);
  const scale = 560 / meta.height;
  const idlePng = await sharp(trimmed)
    .resize({ height: 560 })
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toBuffer();
  await fs.writeFile(path.join(outDir, 'boss_idle.png'), idlePng);
  const idleMeta = await sharp(idlePng).metadata();

  // 大笑变体：在嘴的位置贴一张张开的嘴（比例按立绘算，眼神凶狠一点）
  const bw = idleMeta.width;
  const bh = idleMeta.height;
  const mx = Math.round(bw * 0.5);
  const my = Math.round(bh * 0.218);
  const mw = Math.round(bw * 0.2);
  const mh = Math.round(bh * 0.115);
  const mouth = Buffer.from(
    `<svg width="${bw}" height="${bh}" xmlns="http://www.w3.org/2000/svg">
       <g transform="translate(${mx},${my})">
         <!-- 张开的嘴：上沿贴着原来的嘴线，下沿是圆弧 -->
         <path d="M ${-mw / 2} 0 Q 0 ${mh * 1.75} ${mw / 2} 0 Z" fill="#4f1d27"/>
         <ellipse cx="0" cy="${mh * 0.82}" rx="${mw * 0.27}" ry="${mh * 0.36}" fill="#df7280"/>
         <rect x="${-mw * 0.19}" y="${mh * 0.04}" width="${mw * 0.38}" height="${mh * 0.3}" rx="${mh * 0.1}" fill="#fff8ea"/>
         <path d="M ${-mw / 2 - 3} 0 L ${mw / 2 + 3} 0" stroke="#7b6234" stroke-width="${mh * 0.08}" stroke-linecap="round"/>
       </g>
     </svg>`
  );
  const laugh = await sharp(idlePng)
    .composite([{ input: mouth, left: 0, top: 0 }])
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toBuffer();
  await fs.writeFile(path.join(outDir, 'boss_laugh.png'), laugh);

  const cell = 640;
  const bg = `<svg width="${cell * 2}" height="${cell}" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="c" width="22" height="22" patternUnits="userSpaceOnUse">
      <rect width="22" height="22" fill="#5b7fbd"/><rect width="11" height="11" fill="#7fa0d6"/>
      <rect x="11" y="11" width="11" height="11" fill="#7fa0d6"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#c)"/></svg>`;
  const fit = (buf) => sharp(buf).resize({ height: cell - 40, fit: 'inside' }).toBuffer();
  await sharp(Buffer.from(bg))
    .composite([
      { input: await fit(idlePng), left: 40, top: 20 },
      { input: await fit(laugh), left: cell + 40, top: 20 },
    ])
    .png()
    .toFile(path.join(previewDir, 'boss-preview.png'));

  const size = async (p) => Math.round((await fs.stat(path.join(outDir, p))).size / 1024);
  console.log(`  boss_idle.png ${idleMeta.width}x${idleMeta.height} ${await size('boss_idle.png')}KB`);
  console.log(`  boss_laugh.png ${await size('boss_laugh.png')}KB`);
  console.log(`预览 → ${path.join(previewDir, 'boss-preview.png')}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
