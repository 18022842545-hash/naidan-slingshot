/** 临时脚本：用真实鼠标验编辑器的"点一下放东西 / 拖走 / 拖空白平移"。跑完就删。 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8896;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await sleep(1200);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__nai && window.__WorkshopLevel !== null && window.WorkshopLevel, null, { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll('#roster .card').length > 0, null, { timeout: 20000 });
await page.click('#btnWorkshop');
await sleep(200);
await page.click('#btnWkNew');
await sleep(300);

const box = await page.locator('#game').boundingBox();
const scale = Math.min(box.width / 1280, box.height / 720);
const toClient = async (wx, wy) => {
  const c = await page.evaluate(() => window.__nai.state());
  return { x: box.x + (wx - c.camX) * c.camZoom * scale, y: box.y + (wy - c.camY) * c.camZoom * scale };
};
const info = () => page.evaluate(() => window.__nai.workshop.info());

// 1) 在空地上点一下 → 放一块
const before = await info();
const at = await toClient(1180, 560);
await page.mouse.click(at.x, at.y);
await sleep(250);
const afterClick = await info();

// 2) 先选中这块（点它），再拖到别处
const grab = await toClient(1180, 560);
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
for (let i = 1; i <= 6; i++) { await page.mouse.move(grab.x + i * 10, grab.y - i * 4); await sleep(20); }
await page.mouse.up();
await sleep(250);
const afterDrag = await page.evaluate(() => {
  const d = window.__nai.workshop.info();
  const st = window.__nai.state();
  return { blocks: d.blocks, selected: d.selected, firstX: window.__nai.workshop.info().blocks && st };
});
const movedX = await page.evaluate(() => {
  const el = window.__nai.workshop;
  return null;
});
const blockPos = await page.evaluate(() => window.__nai.workshop.info().blocks);

// 3) 拖空白处 → 镜头平移
const camBefore = await page.evaluate(() => window.__nai.state().camX);
const empty = await toClient(300, 240);
await page.mouse.move(empty.x, empty.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(empty.x - i * 22, empty.y); await sleep(18); }
await page.mouse.up();
await sleep(200);
const camAfter = await page.evaluate(() => window.__nai.state().camX);

console.log('点一下放块:', before.blocks, '→', afterClick.blocks);
console.log('拖动后选中:', JSON.stringify(afterDrag.selected), '| 方块数:', afterDrag.blocks);
console.log('拖空白平移: camX', Math.round(camBefore), '→', Math.round(camAfter));
console.log(errs.length ? '❌\n' + errs.slice(0, 5).join('\n') : '✅ 无控制台报错');
await page.screenshot({ path: path.join(root, 'shots', '_wk-real.png') });
await browser.close();
server.kill();
