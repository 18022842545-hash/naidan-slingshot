/**
 * 快速冒烟：起服务 → 打开页面 → 按脚本点几下 → 截图。
 * 用来在改完代码后马上看一眼画面/日志，比全套 verify 快得多。
 * 用法：node tools/smoke.mjs [脚本名]   例如 node tools/smoke.mjs intro
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'shots');
const PORT = 8852;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const which = process.argv[2] || 'intro';

const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
await sleep(600);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await fs.mkdir(shots, { recursive: true });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__nai && window.__nai.imagesReady(), null, { timeout: 15000 });
await page.screenshot({ path: path.join(shots, 'smoke-title.png') });

const log = (tag, v) => console.log(tag.padEnd(16), JSON.stringify(v));
const shot = (file) => page.screenshot({ path: path.join(shots, file) });
await page.evaluate(() => {
  window.__still = async (limit = 2500) => {
    const t0 = performance.now();
    while (window.__nai.state().maxSpeed >= 0.08 && performance.now() - t0 < limit) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return window.__nai.state().maxSpeed;
  };
});

/** 点开始/无尽之后要过一遍"开局选蛋"面板，脚本随便挑第一颗 */
const startWithPick = async (selector) => {
  await page.click(selector);
  await page.locator('#pickRoster .card').nth(0).click();
  await sleep(140);
};

if (which === 'showcase') {
  // 给 README 抓几张有代表性的图：技能飞行中 / 分身 / 爆炸 / 奶泡 / 无尽关卡
  await startWithPick('#btnStart');
  await page.evaluate(() => window.__nai.skipIntro());
  const take = async (type, delay, act, file, waitAfter = 120) => {
    await page.evaluate((t) => window.__nai.sandbox(t), type);
    await page.evaluate(() => window.__still());
    await page.evaluate(() => window.__nai.shoot(8, 1));
    await sleep(delay);
    if (act) await page.evaluate(() => window.__nai.activateSkill());
    await sleep(waitAfter);
    await shot(file);
    log(file, await page.evaluate(() => {
      const s = window.__nai.state();
      return { bird: s.currentBird, inFlight: s.inFlight, bombs: s.bombs, chip: s.skillChipOn };
    }));
  };
  await take('dash', 320, false, 'smoke-show-dash-ready.png', 0);
  await take('dash', 300, true, 'smoke-show-dash.png', 90);
  await take('split', 300, true, 'smoke-show-split.png', 150);
  await take('bomb', 430, true, 'smoke-show-bomb.png', 80);
  await take('milk', 320, true, 'smoke-show-milk.png', 70);
  // 制导奶蛋：飞一半点一个指定位置，拍下靶心和"直线冲过去"这一下
  await page.evaluate(() => window.__nai.sandbox('seek'));
  await page.evaluate(() => window.__still());
  await page.evaluate(() => window.__nai.shoot(8, 1));
  await sleep(280);
  await page.evaluate(() => {
    const s = window.__nai.state();
    window.__nai.activateSkill({ x: s.bird.x + 430, y: 250 });
  });
  await sleep(220);
  await shot('smoke-show-seek.png');
  log('smoke-show-seek.png', await page.evaluate(() => {
    const s = window.__nai.state();
    return { bird: s.currentBird, seek: s.seek, marks: s.aimMarks };
  }));
  await sleep(1200);
  for (const lv of [2, 5, 8]) {
    await page.evaluate(([l, s]) => window.__nai.loadEndless(l, s), [lv, 4242]);
    await page.evaluate(() => window.__nai.skipIntro());
    await page.evaluate(() => window.__still());
    await shot(`smoke-endless-${lv}.png`);
    log(`无尽第${lv}关`, await page.evaluate(() => {
      const s = window.__nai.state();
      return { pigs: s.pigsAlive, blocks: s.blocksAlive, birds: s.birdQueue.length + 1, name: s.levelName };
    }));
  }
  // 长关卡缩到最小：一眼看完三段地图
  await page.evaluate(() => window.__nai.loadEndless(8, 4242));
  await page.evaluate(() => window.__nai.skipIntro());
  await page.evaluate(() => window.__still());
  await page.evaluate(() => window.__nai.setZoom(0.45));
  await sleep(500);
  await shot('smoke-zoom-whole.png');
  log('全图', await page.evaluate(() => {
    const s = window.__nai.state();
    return { world: s.worldW, stages: s.stageCount, zoom: s.camZoom, pigs: s.pigsAlive, blocks: s.blocksAlive };
  }));
  // 多层房子：挑几个确定会出现楼房种子的关卡，抓一张近景
  for (const [lv, seed, name] of [[2, 4242, 'house-a'], [4, 555, 'house-b']]) {
    await page.evaluate(([l, s]) => window.__nai.loadEndless(l, s), [lv, seed]);
    await page.evaluate(() => window.__nai.skipIntro());
    await page.evaluate(() => window.__nai.setZoom(1.25));
    await page.evaluate(async () => {
      await window.__still();
      // 把镜头挪到结构那一侧，把楼拍全
      const xs = window.__nai.state().blockPositions.map((b) => b.x);
      if (xs.length) window.__nai.setZoom(1.15);
      return true;
    });
    await shot(`smoke-${name}.png`);
    log(`楼房 ${lv}关`, await page.evaluate(() => {
      const s = window.__nai.state();
      return { pigs: s.pigsAlive, blocks: s.blocksAlive, birds: s.birdQueue.length + 1 };
    }));
  }
} else if (which === 'boss') {
  // boss 关全流程：特写 → 竞技场 → 摔 → 大笑飞出
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await page.evaluate(() => { window.__nai.loadEndless(10, 777); window.__nai.startIntro(false); });
  await wait(2400);
  await shot('smoke-boss-cutin.png');
  log('特写', await page.evaluate(() => {
    const s = window.__nai.state();
    return { label: s.introLabel, zoom: s.camZoom };
  }));
  await page.evaluate(() => window.__nai.skipIntro());
  await wait(2200);
  await page.evaluate(() => window.__nai.setZoom(0.55));   // 缩远一点，让"前哨 + 远处的塔"同框
  await wait(500);
  await shot('smoke-boss-outpost.png');   // 第 1 段：门口的前哨
  await page.evaluate(() => window.__nai.setZoom(1));
  await wait(200);
  log('前哨', await page.evaluate(() => {
    const s = window.__nai.state();
    return { stage: s.stage, pigs: s.stagePigs, sling: s.slingX };
  }));
  // boss 关第一段是"前哨"，拍竞技场之前先按正常流程清掉它、推进到塔前
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__nai.clearStage();
    for (let i = 0; i < 320; i++) {
      await wait(16);
      const s = window.__nai.state();
      if (s.stage === s.stageCount && s.state === 'aim') return;
    }
  });
  await page.evaluate(() => window.__still());
  await wait(600);
  await shot('smoke-boss-arena.png');
  log('竞技场', await page.evaluate(() => {
    const b = window.__nai.bossInfo();
    return { boss: b.name, hp: b.hp, legs: b.legs, bar: b.barWidth };
  }));
  await page.evaluate(() => window.__nai.breakTower());
  await wait(2600);
  await shot('smoke-boss-fall.png');
  log('摔下来', await page.evaluate(() => {
    const b = window.__nai.bossInfo();
    return { hp: b.hp, bar: b.barWidth, last: b.lastImpact };
  }));
  // boss 技能：第 3 发会喊帮手 + 回血，拍一张
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => window.__nai.shoot(85, 1));   // 往天上打，不碰东西，只看技能
    await sleep(120);
    await page.evaluate(() => window.__nai.forceEnd());
    await sleep(1100);
  }
  await sleep(300);
  await shot('smoke-boss-summon.png');
  log('召唤', await page.evaluate(() => {
    const b = window.__nai.bossInfo();
    return { hp: b.hp, summons: b.summons, pigs: window.__nai.state().pigsAlive };
  }));
  for (let k = 0; k < 12; k++) {
    const info = await page.evaluate(() => window.__nai.bossInfo());
    if (!info.boss || info.hp <= 0) break;
    if (info.legs > 0) await page.evaluate(() => window.__nai.breakTower());
    else await page.evaluate(() => window.__nai.shoot(6, 1));
    await wait(2500);
  }
  // 收尾：剩下的血直接结算，专门拍"大笑飞出画面"那一下
  const rest = await page.evaluate(() => window.__nai.bossInfo());
  if (rest.boss && rest.hp > 0) await page.evaluate(() => window.__nai.hurtBoss(9999));
  await wait(260);
  await page.screenshot({ path: path.join(shots, 'smoke-boss-laugh.png') });
  await wait(520);
  await page.screenshot({ path: path.join(shots, 'smoke-boss-laugh2.png') });
  log('倒下', await page.evaluate(() => ({ score: window.__nai.state().score, boss: window.__nai.bossInfo().boss })));
} else if (which === 'charge') {
  // 满弓特效：真的用鼠标把弓拉到最满
  await startWithPick('#btnStart');
  await page.evaluate(() => window.__nai.skipIntro());
  const box = await page.locator('#game').boundingBox();
  const cam = await page.evaluate(() => window.__nai.state());
  const scale = Math.min(box.width / 1280, box.height / 720);
  const ax = box.x + (186 - cam.camX) * scale;
  const ay = box.y + (470 - cam.camY) * scale;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(ax - i * 9, ay + i * 4.2);
    await sleep(28);
  }
  await sleep(420);
  log('满弓', await page.evaluate(() => {
    const s = window.__nai.state();
    return { power: s.pullPower, charge: s.charge, shake: Math.round(s.camZoom * 100) / 100 };
  }));
  await shot('smoke-charge-full.png');
  await sleep(180);
  await shot('smoke-charge-full2.png');
  await page.mouse.up();
  await sleep(500);
  await shot('smoke-charge-release.png');
}

if (which === 'intro') {
  await startWithPick('#btnStart');
  for (const t of [200, 900, 1800, 2800, 3600, 4600]) {
    await sleep(t === 200 ? 200 : 800);
    const s = await page.evaluate(() => window.__nai.state());
    log(`t+${t}ms`, { state: s.state, zoom: s.camZoom, camX: Math.round(s.camX), label: s.introLabel });
    await page.screenshot({ path: path.join(shots, `smoke-intro-${t}.png`) });
  }
  await sleep(600);
  const s2 = await page.evaluate(() => window.__nai.state());
  log('after intro', { state: s2.state, zoom: s2.camZoom, queue: s2.birdQueue, cur: s2.currentBird });
  await page.screenshot({ path: path.join(shots, 'smoke-aim.png') });
} else if (which === 'skills') {
  await startWithPick('#btnStart');
  await page.evaluate(() => window.__nai.skipIntro());
  const types = await page.evaluate(() => window.__nai.birdTypes());
  console.log('角色表', JSON.stringify(types, null, 0));
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__nai.shoot(18, 1));
    await sleep(420);
    const before = await page.evaluate(() => window.__nai.state());
    const used = await page.evaluate(() => window.__nai.activateSkill());
    await sleep(500);
    const after = await page.evaluate(() => window.__nai.state());
    log(`shot${i} ${before.currentBird}`, { skillBtn: used, inFlight: after.inFlight, bombs: after.bombs, pigs: after.pigsAlive });
    await page.screenshot({ path: path.join(shots, `smoke-skill-${i}.png`) });
    await page.waitForFunction(() => ['aim', 'over', 'clearing'].includes(window.__nai.state().state), null, { timeout: 20000 }).catch(() => {});
    await sleep(900);
  }
} else if (which === 'endless') {
  await startWithPick('#btnEndless');
  // 保险：万一第 1 关之后又冒出面版，脚本也能一路推下去（玩家玩的时候只在开局问一次）
  await page.evaluate(() => window.__nai.setAutoPick(true));
  await page.evaluate(() => window.__nai.skipIntro());
  let guard = 0;
  while (guard++ < 4) {
    const s = await page.evaluate(() => window.__nai.state());
    if (s.state === 'over') break;
    log(`关卡 ${s.endlessLevel}`, { name: s.levelName, pigs: s.pigsAlive, blocks: s.blocksAlive, birds: s.birdQueue.length + 1, cur: s.currentBird, score: s.score });
    await page.screenshot({ path: path.join(shots, `smoke-endless-${s.endlessLevel}.png`) });
    await page.evaluate(() => window.__nai.forceWin());
    await page.waitForFunction(() => ['aim', 'over', 'clearing'].includes(window.__nai.state().state), null, { timeout: 20000 }).catch(() => {});
    await sleep(2400);
  }
  const end = await page.evaluate(() => window.__nai.state());
  log('结束', { level: end.endlessLevel, score: end.totalScore, state: end.state });
}

console.log(errors.length ? '❌ 控制台错误:\n' + errors.join('\n') : '✅ 无控制台错误');
await browser.close();
server.kill();
