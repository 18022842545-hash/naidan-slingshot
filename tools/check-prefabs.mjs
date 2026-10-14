/**
 * 预制件几何自检：把每个建筑预制件在 1~3 档难度下都搭一遍，然后检查
 *   1) 方块之间不许重叠
 *   2) 每块要么踩在地面上，要么有东西在它下面顶着（允许"横梁架在两根柱子上"）
 *   3) 奶蛙不许插进方块里，也不许悬空
 * 这类错误（比如某层冰砖忘了贴着下一层）在游戏里表现为"开局自己塌"，肉眼很难看全，
 * 所以做成静态检查，改结构之后跑一下就知道有没有搭歪。
 *
 * 用法：node tools/check-prefabs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = {};
const run = (f) => new Function('window', fs.readFileSync(path.join(root, 'js', f), 'utf8'))(win);
run('birds.js');
run('levels.js');

const GY = 636;
// 用固定序列假装随机，保证每次检查的是同一套组合
const fakeR = (() => {
  let i = 0;
  const seq = [0.12, 0.83, 0.37, 0.94, 0.55, 0.21, 0.68, 0.44, 0.79, 0.03, 0.61, 0.28];
  return () => seq[i++ % seq.length];
})();

const rectOf = (o) => ({
  l: o.x - (o.w !== undefined ? o.w / 2 : o.r),
  r: o.x + (o.w !== undefined ? o.w / 2 : o.r),
  t: o.y - (o.h !== undefined ? o.h / 2 : o.r),
  b: o.y + (o.h !== undefined ? o.h / 2 : o.r),
});
const overlaps = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.6 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.6;
/** 有没有东西在 x 范围内给 y 当底座 */
const hasSupport = (blocks, box) => blocks.some((bl) => {
  const r = rectOf(bl);
  const horizontal = Math.min(r.r, box.r) - Math.max(r.l, box.l) > 2;
  return horizontal && Math.abs(r.t - box.b) <= 1.2;
});

let problems = 0;
const PREFABS = (win.Endless && win.Endless.PREFABS) || null;
if (!PREFABS) {
  console.log('⚠ levels.js 没有导出 PREFABS，跳过检查（把它挂到 window 上即可）');
  process.exit(0);
}

PREFABS.forEach((p) => {
  for (const tier of [1, 2, 3]) {
    fakeR();
    const { blocks, pigs } = p.build(1000, tier, fakeR);
    const name = `${p.label} tier${tier}`;
    // 1) 方块互不重叠
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (overlaps(rectOf(blocks[i]), rectOf(blocks[j]))) {
          problems++;
          console.log(`❌ ${name}: 方块重叠 ${blocks[i].material}(${blocks[i].x},${blocks[i].y}) × ${blocks[j].material}(${blocks[j].x},${blocks[j].y})`);
        }
      }
    }
    // 2) 每块都要有支撑
    blocks.forEach((b) => {
      const box = rectOf(b);
      if (Math.abs(box.b - GY) <= 1.2) return; // 踩在地上
      if (!hasSupport(blocks, box)) {
        problems++;
        console.log(`❌ ${name}: 悬空方块 ${b.material}(${b.x},${b.y},${b.w}x${b.h}) 底边 ${box.b}（地面 ${GY}）`);
      }
    });
    // 3) 奶蛙不许插进方块、也不许悬空
    pigs.forEach((p2) => {
      const box = rectOf(p2);
      blocks.forEach((b) => {
        if (overlaps(box, rectOf(b))) {
          problems++;
          console.log(`❌ ${name}: 奶蛙(${p2.x},${p2.y}) 插进 ${b.material}(${b.x},${b.y})`);
        }
      });
      if (Math.abs(box.b - GY) > 1.2 && !hasSupport(blocks, box)) {
        problems++;
        console.log(`❌ ${name}: 悬空奶蛙(${p2.x},${p2.y}) 底边 ${box.b}（地面 ${GY}）`);
      }
    });
  }
});

console.log(problems ? `\n共 ${problems} 处问题` : `\n✅ ${PREFABS.length} 个预制件 × 3 档难度：没有重叠、没有悬空`);
process.exit(problems ? 1 : 0);
