/**
 * 用基础奶蛋立绘程序化生成几个新形象（同一套毛绒质感，只换配色 + 帽子 + 胸章）。
 * 做法：把"黄色系"像素在 HSL 里转到目标色相（保留明暗，眼睛/鼻子/手这些深色不动），
 * 再把帽子区域的奶白色染成对应颜色，最后在抱枕上贴一个技能胸章。
 *
 * 用法：node tools/make-variants.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcFile = path.join(root, 'assets', 'naidan_idle.png');
const outDir = path.join(root, 'assets');
const previewDir = path.join(root, 'shots', 'assets-preview');

const rgb2hsl = (r, g, b) => {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (mx === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s, l];
};

const hsl2rgb = (h, s, l) => {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(conv(hn + 1 / 3) * 255), Math.round(conv(hn) * 255), Math.round(conv(hn - 1 / 3) * 255)];
};

/** 胸章：画在抱枕上，一眼看出这是什么技能 */
const badges = {
  bolt: `<path d="M52 8 L24 56 h20 l-6 36 L70 42 h-20 z" />`,
  triple: `<circle cx="22" cy="52" r="15"/><circle cx="50" cy="34" r="17"/><circle cx="78" cy="52" r="15"/>`,
  boom: `<circle cx="50" cy="52" r="26" fill="none" stroke-width="9"/><path d="M50 26 q14 -16 4 -26" fill="none" stroke-width="8" stroke-linecap="round"/>`,
  weight: `<rect x="14" y="30" width="72" height="16" rx="8"/><rect x="22" y="52" width="56" height="16" rx="8"/><rect x="30" y="74" width="40" height="16" rx="8"/>`,
  drop: `<path d="M50 12 C74 42 84 54 84 64 a34 34 0 0 1 -68 0 C16 54 26 42 50 12 z"/>`,
  // 掉头箭头：飞出去再拐回来
  uturn: `<path d="M72 72 A 26 26 0 1 0 72 28" fill="none" stroke-width="10" stroke-linecap="round"/><path d="M72 28 l 16 12 h -32 z"/>`,
  // 靶心：朝你点的地方直着冲过去
  reticle: `<circle cx="50" cy="52" r="23" fill="none" stroke-width="9"/><circle cx="50" cy="52" r="7"/><path d="M50 12 v12 M50 80 v12 M10 52 h12 M78 52 h12" stroke-width="9" stroke-linecap="round"/>`,
  nuclear: `<circle cx="50" cy="50" r="7"/><g transform="rotate(0 50 50)"><path d="M50 50 L24 17 A38 38 0 0 1 76 17 Z"/></g><g transform="rotate(120 50 50)"><path d="M50 50 L24 17 A38 38 0 0 1 76 17 Z"/></g><g transform="rotate(240 50 50)"><path d="M50 50 L24 17 A38 38 0 0 1 76 17 Z"/></g>`,
};

const makeBadge = (shape, color) =>
  Buffer.from(
    `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
       <g fill="${color}" stroke="${color}">${shape}</g>
     </svg>`
  );

const makeNuclearBadge = () => Buffer.from(
  `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ng" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff36a"/>
        <stop offset=".35" stop-color="#62ffac"/>
        <stop offset=".7" stop-color="#63d8ff"/>
        <stop offset="1" stop-color="#ff74e8"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="46" fill="#15131f" stroke="url(#ng)" stroke-width="5"/>
    <g fill="url(#ng)">${badges.nuclear}</g>
  </svg>`
);

/**
 * VARIANTS：body = 身体目标色相/饱和增益；hat = 帽子染色；
 * badge = 胸章；scale = 尺寸倍率（胖奶蛋更大只）。
 */
const VARIANTS = [
  {
    key: 'naidan_dash',
    body: { hue: 168, sat: 0.62, light: 1.0 },
    hat: [255, 138, 82],
    badge: { shape: badges.bolt, color: '#ff6a3d', size: 0.30 },
  },
  {
    key: 'naidan_split',
    body: { hue: 205, sat: 0.58, light: 1.04 },
    hat: [126, 214, 160],
    badge: { shape: badges.triple, color: '#2fa6e0', size: 0.30 },
  },
  {
    key: 'naidan_bomb',
    body: { hue: 210, sat: 0.05, light: 0.34 },
    hat: [46, 44, 50],
    hatStroke: '#f4f0e8',
    badge: { shape: badges.boom, color: '#ff9a3c', size: 0.32 },
  },
  {
    key: 'naidan_heavy',
    body: { hue: 50, sat: 0.22, light: 1.22 },
    hat: [226, 92, 88],
    badge: { shape: badges.weight, color: '#c0653c', size: 0.32 },
  },
  {
    key: 'naidan_milk',
    body: { hue: 48, sat: 0.07, light: 1.34 },
    hat: [122, 168, 232],
    badge: { shape: badges.drop, color: '#5aa9e6', size: 0.30 },
  },
  {
    key: 'naidan_back',
    body: { hue: 276, sat: 0.34, light: 1.06 },
    hat: [246, 197, 96],
    badge: { shape: badges.uturn, color: '#7b58c8', size: 0.32 },
  },
  {
    // 制导奶蛋：玫红身体 + 天蓝帽子，胸章是靶心
    key: 'naidan_seek',
    body: { hue: 330, sat: 0.44, light: 1.06 },
    hat: [104, 196, 240],
    badge: { shape: badges.reticle, color: '#e2497f', size: 0.31 },
  },
  {
    key: 'naidan_nuke',
    rainbow: true,
    hat: [154, 84, 224],
    badge: { nuclear: true, size: 0.34 },
  },
];

const buildVariant = async (v) => {
  const { data, info } = await sharp(srcFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const px = new Uint8Array(data);
  const hatTop = Math.floor(H * 0.34); // 帽子大概占上面三分之一

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = px[i + 3];
      if (a < 8) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const [h, s, l] = rgb2hsl(r, g, b);

      if (y < hatTop && s < 0.34) {
        if (v.rainbow) {
          const hue = (x / W * 220 + y / H * 50 + 275) % 360;
          const [nr, ng, nb] = hsl2rgb(hue, 0.72, clamp01(0.28 + l * 0.5));
          px[i] = mix(r, nr, 0.9);
          px[i + 1] = mix(g, ng, 0.9);
          px[i + 2] = mix(b, nb, 0.9);
          continue;
        }
        // 帽子：把奶白布料整体染成帽子色，保留明暗
        const k = clamp01((0.34 - s) / 0.34);
        const shade = 0.55 + l * 0.55;
        px[i] = mix(r, v.hat[0] * shade, k);
        px[i + 1] = mix(g, v.hat[1] * shade, k);
        px[i + 2] = mix(b, v.hat[2] * shade, k);
        continue;
      }
      // 身体：只动黄色系（色相 25~75），其余（深色五官、白抱枕）保持原样
      const isBody = h >= 22 && h <= 82 && s > 0.12;
      if (!isBody) continue;
      if (v.rainbow) {
        const hue = (x / W * 350 + y / H * 90 + 12) % 360;
        const [nr, ng, nb] = hsl2rgb(hue, 0.76, clamp01(l * 1.04));
        px[i] = mix(r, nr, 0.94);
        px[i + 1] = mix(g, ng, 0.94);
        px[i + 2] = mix(b, nb, 0.94);
        continue;
      }
      const targetS = clamp01(s * (v.body.sat / 0.55));
      const targetL = clamp01(l * v.body.light);
      const [nr, ng, nb] = hsl2rgb(v.body.hue, targetS, targetL);
      const blend = 0.92;
      px[i] = mix(r, nr, blend);
      px[i + 1] = mix(g, ng, blend);
      px[i + 2] = mix(b, nb, blend);
    }
  }

  let img = sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 4 } });
  if (v.hatStroke) {
    // 深色帽子容易糊在深色身体上，加一圈亮描边（用 SVG 勾一下帽子轮廓太复杂，改为提亮边缘）
    img = img.modulate({ brightness: 1.02 });
  }
  if (v.badge) {
    const size = Math.round(H * v.badge.size);
    const badgeSource = v.badge.nuclear ? makeNuclearBadge() : makeBadge(v.badge.shape, v.badge.color);
    const badge = await sharp(badgeSource)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const left = Math.round(W * 0.5 - size / 2);
    const top = Math.round(H * 0.68 - size / 2);
    img = sharp(await img.png().toBuffer()).composite([{ input: badge, left, top }]);
  }
  const out = path.join(outDir, `${v.key}.png`);
  await img.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(out);
  return out;
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => Math.round(a * (1 - t) + b * t);

const main = async () => {
  await fs.mkdir(previewDir, { recursive: true });
  const outs = [];
  for (const v of VARIANTS) {
    const out = await buildVariant(v);
    outs.push(out);
    const kb = Math.round((await fs.stat(out)).size / 1024);
    console.log(`  ${path.basename(out)}  ${kb}KB`);
  }

  // 预览：原版 + 5 个新形象，贴棋盘底
  const cell = 220;
  const files = [srcFile, ...outs];
  const layers = [];
  for (let i = 0; i < files.length; i++) {
    const buf = await sharp(files[i]).resize({ height: cell - 30, fit: 'inside' }).toBuffer();
    layers.push({ input: buf, left: i * cell + 20, top: 16 });
  }
  const bg = `<svg width="${files.length * cell}" height="${cell}" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse">
      <rect width="20" height="20" fill="#5b7fbd"/><rect width="10" height="10" fill="#7fa0d6"/>
      <rect x="10" y="10" width="10" height="10" fill="#7fa0d6"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#c)"/></svg>`;
  const previewFile = path.join(previewDir, 'naidan-variants.png');
  await sharp(Buffer.from(bg)).composite(layers).png().toFile(previewFile);
  console.log(`预览图 → ${previewFile}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
