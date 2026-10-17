/**
 * 生成创意工坊的首批社区关卡目录。
 * 关卡数据仍然走普通的 WorkshopLevel.pack，目录只保存分享码和展示信息。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
global.window = {};
vm.runInThisContext(await fs.readFile(path.join(root, 'js', 'workshop.js'), 'utf8'), { filename: 'js/workshop.js' });
const W = window.WorkshopLevel;

const gate = (x, material = 'wood') => [
  { x: x - 70, y: 571, w: 34, h: 130, material },
  { x: x + 70, y: 571, w: 34, h: 130, material },
  { x, y: 489, w: 190, h: 34, material },
];

const seeds = [
  {
    name: '门洞午睡',
    author: '小奶糖',
    submittedAt: '2026-10-17T02:20:00.000Z',
    blocks: gate(970),
    pigs: [{ x: 970, y: 600 }],
    birds: ['naidan', 'dash', 'bomb'],
  },
  {
    name: '冰屋叠叠乐',
    author: '夜班奶蛙',
    submittedAt: '2026-10-16T11:40:00.000Z',
    blocks: [
      ...gate(1070, 'ice'),
      { x: 1280, y: 571, w: 90, h: 60, material: 'ice' },
    ],
    pigs: [{ x: 1070, y: 600 }, { x: 1410, y: 600, bonus: true }],
    birds: ['dash', 'split', 'milk', 'bomb'],
  },
  {
    name: '石墙三兄弟',
    author: '阿弹',
    submittedAt: '2026-10-15T08:10:00.000Z',
    blocks: [
      { x: 1030, y: 571, w: 60, h: 130, material: 'stone' },
      { x: 1030, y: 456, w: 60, h: 100, material: 'stone' },
      { x: 1030, y: 389, w: 130, h: 34, material: 'stone' },
      { x: 1220, y: 571, w: 90, h: 60, material: 'wood' },
    ],
    pigs: [{ x: 1380, y: 600 }, { x: 1510, y: 600 }, { x: 1640, y: 600, bonus: true }],
    birds: ['heavy', 'bomb', 'split', 'seek'],
  },
  {
    name: '双段长街',
    author: 'Nora',
    submittedAt: '2026-10-14T13:05:00.000Z',
    stages: 2,
    launchPoints: [{ x: 186, y: 470 }, { x: 1186, y: 470 }],
    blocks: [
      ...gate(930, 'wood'),
      ...gate(1770, 'ice'),
      { x: 1510, y: 571, w: 60, h: 130, material: 'stone' },
    ],
    pigs: [{ x: 930, y: 600 }, { x: 1770, y: 600 }],
    birds: ['naidan', 'dash', 'bomb', 'back'],
  },
  {
    name: '高脚屋',
    author: '摸鱼建筑队',
    submittedAt: '2026-10-13T06:30:00.000Z',
    blocks: [
      { x: 1050, y: 571, w: 34, h: 130, material: 'wood' },
      { x: 1200, y: 571, w: 34, h: 130, material: 'wood' },
      { x: 1125, y: 489, w: 220, h: 34, material: 'wood' },
      { x: 1080, y: 420, w: 30, h: 100, material: 'wood' },
      { x: 1170, y: 420, w: 30, h: 100, material: 'wood' },
      { x: 1125, y: 353, w: 180, h: 34, material: 'ice' },
      { x: 900, y: 571, w: 90, h: 60, material: 'stone' },
    ],
    pigs: [{ x: 1125, y: 600 }, { x: 1125, y: 300, bonus: true }],
    birds: ['split', 'bomb', 'milk', 'seek'],
  },
  {
    name: '三站追击',
    author: '奶蛋工坊',
    submittedAt: '2026-10-12T01:15:00.000Z',
    stages: 3,
    launchPoints: [
      { x: 186, y: 470 },
      { x: 1186, y: 470 },
      { x: 2186, y: 470 },
    ],
    blocks: [
      ...gate(900, 'wood'),
      ...gate(1700, 'stone'),
      ...gate(2450, 'ice'),
    ],
    pigs: [
      { x: 900, y: 600 },
      { x: 1700, y: 600, bonus: true },
      { x: 2450, y: 600 },
    ],
    birds: ['naidan', 'dash', 'bomb', 'split', 'seek'],
  },
  {
    name: '冰桥回廊',
    author: '雪花酥',
    submittedAt: '2026-10-11T09:20:00.000Z',
    blocks: [
      ...gate(980, 'ice'),
      { x: 1220, y: 571, w: 120, h: 30, material: 'ice' },
      { x: 1220, y: 460, w: 30, h: 100, material: 'ice' },
      { x: 1320, y: 460, w: 30, h: 100, material: 'ice' },
      { x: 1270, y: 390, w: 140, h: 30, material: 'ice' },
    ],
    pigs: [{ x: 980, y: 600 }, { x: 1390, y: 600, bonus: true }],
    birds: ['dash', 'split', 'milk', 'bomb'],
  },
  {
    name: '奶蛙哨站',
    author: '弹弓小队',
    submittedAt: '2026-10-10T04:45:00.000Z',
    stages: 2,
    launchPoints: [{ x: 186, y: 470 }, { x: 1186, y: 470 }],
    blocks: [
      ...gate(880, 'wood'),
      { x: 1080, y: 571, w: 90, h: 60, material: 'stone' },
      ...gate(1760, 'stone'),
      { x: 1550, y: 571, w: 90, h: 60, material: 'ice' },
    ],
    pigs: [{ x: 880, y: 600, bonus: true }, { x: 1760, y: 600 }],
    birds: ['naidan', 'heavy', 'bomb', 'back'],
  },
];

const levels = seeds.map((seed) => {
  const def = W.normalize(seed);
  const errors = W.validate(def);
  if (errors.length) throw new Error(`${seed.name} 校验失败：${errors.join('；')}`);
  const code = W.pack(def);
  return {
    id: `seed-${seed.name}`,
    name: def.name,
    author: seed.author,
    submittedAt: seed.submittedAt,
    code,
  };
});

const out = path.join(root, 'workshop', 'levels.json');
await fs.mkdir(path.dirname(out), { recursive: true });
const data = { version: 1, levels };
await fs.writeFile(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
await fs.writeFile(
  path.join(root, 'workshop', 'levels.js'),
  `window.INLINE_WORKSHOP_LEVELS = ${JSON.stringify(data, null, 2)};\n`,
  'utf8'
);
console.log(`写入 ${levels.length} 张社区关卡 → ${out} + levels.js`);
