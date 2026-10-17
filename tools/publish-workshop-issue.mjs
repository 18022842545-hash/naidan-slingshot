/**
 * GitHub Issue → 社区关卡目录。
 * 只接受已通过 WorkshopLevel.validate 的分享码，内容由仓库带 GITHUB_TOKEN 的 Action 提交。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const title = String(process.env.ISSUE_TITLE || '');
const body = String(process.env.ISSUE_BODY || '');
const author = String(process.env.ISSUE_AUTHOR || '').trim();
const submittedAt = String(process.env.ISSUE_CREATED_AT || new Date().toISOString());

if (!title.startsWith('[工坊投稿]')) {
  console.log('不是工坊投稿，跳过。');
  process.exit(0);
}
if (!author) throw new Error('拿不到投稿者 GitHub 用户名');

global.window = {};
vm.runInThisContext(await fs.readFile(path.join(root, 'js', 'workshop.js'), 'utf8'), { filename: 'js/workshop.js' });
const W = window.WorkshopLevel;

const fenced = [...body.matchAll(/```[^\n]*\n([^\n]+)\n```/g)].map((m) => m[1].trim());
const loose = (body.match(/(?:^|\s)([A-Za-z0-9_-]{60,})/) || [])[1];
const code = [...fenced, loose].find((v) => v && /^[A-Za-z0-9_-]{40,5000}$/.test(v));
if (!code) throw new Error('正文里没有找到有效的分享码');

const def = W.unpack(code);
if (!def) throw new Error('分享码解不开，可能复制时漏了字符');
const errors = W.validate(def);
if (errors.length) throw new Error(`关卡校验失败：${errors.join('；')}`);

const file = path.join(root, 'workshop', 'levels.json');
const catalog = JSON.parse(await fs.readFile(file, 'utf8'));
const levels = Array.isArray(catalog.levels) ? catalog.levels : [];
if (levels.length >= 100) throw new Error('社区目录已达到 100 张上限，请先清理旧关卡');

const id = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
if (levels.some((entry) => entry.id === id || entry.code === code)) {
  console.log(`这张关卡已经在社区目录里：${def.name}`);
  process.exit(0);
}

levels.unshift({
  id,
  name: def.name,
  author: author.slice(0, 30),
  submittedAt,
  code,
});
catalog.version = 1;
catalog.levels = levels;
await fs.writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
await fs.writeFile(
  path.join(root, 'workshop', 'levels.js'),
  `window.INLINE_WORKSHOP_LEVELS = ${JSON.stringify(catalog, null, 2)};\n`,
  'utf8'
);
console.log(`投稿成功：${def.name}，作者 ${author}`);
