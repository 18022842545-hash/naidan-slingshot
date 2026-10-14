/** 把成品的 alpha 通道可视化，方便肉眼检查抠图残留。用法：node tools/debug-alpha.mjs */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2);

const panels = [];
for (const f of files) {
  const file = path.isAbsolute(f) ? f : path.join(root, f);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(info.width * info.height);
  const overMagenta = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    alpha[i] = data[i * 4 + 3];
    const a = data[i * 4 + 3] / 255;
    overMagenta[i * 3] = Math.round(data[i * 4] * a + 255 * (1 - a));
    overMagenta[i * 3 + 1] = Math.round(data[i * 4 + 1] * a + 0 * (1 - a));
    overMagenta[i * 3 + 2] = Math.round(data[i * 4 + 2] * a + 255 * (1 - a));
  }
  panels.push({ name: path.basename(file), width: info.width, height: info.height, alpha, overMagenta });
}

const pad = 12;
const maxH = Math.max(...panels.map((p) => p.height));
const outW = pad + panels.reduce((s, p) => s + p.width * 2 + pad, 0);
const outH = maxH + pad * 2;
const layers = [];
let ox = pad;
for (const p of panels) {
  // 每个素材出两张：贴洋红底看残留 + alpha 灰度图
  layers.push({ input: p.overMagenta, raw: { width: p.width, height: p.height, channels: 3 }, left: ox, top: pad });
  ox += p.width + pad;
  layers.push({ input: p.alpha, raw: { width: p.width, height: p.height, channels: 1 }, left: ox, top: pad });
  ox += p.width + pad;
}

const outFile = path.join(root, 'shots', 'assets-preview', 'alpha-debug.png');
await sharp({ create: { width: outW, height: outH, channels: 3, background: '#202020' } })
  .composite(layers)
  .png()
  .toFile(outFile);
console.log(outFile);
