/**
 * 自动验收：用本机 Chrome（playwright-core 驱动）跑一遍全部玩法，抓截图 + 断言。
 * 覆盖：开场动画、六个奶蛋的技能、第一关可玩性、无尽模式随机生成稳定性与推进、file:// 直开。
 * 用法：node tools/verify.mjs
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'shots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8849;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 往页面里注入"等世界静止"的小工具。
 * 物理本身是确定的，但"重开后固定等 300ms"这种时机不确定（帧率抖动会让结构多/少走几步），
 * 同一个角度两次结果就不一样。等 maxSpeed 归零再开火，验收才不会时好时坏。
 */
const installStill = (page) =>
  page.evaluate(() => {
    window.__still = async (limit = 2500) => {
      const t0 = performance.now();
      while (window.__nai.state().maxSpeed >= 0.08 && performance.now() - t0 < limit) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      return window.__nai.state().maxSpeed;
    };
  });

/**
 * boss 关多了一波"前哨"：要量 boss 的数值，得先按正常流程清掉前哨、推进到塔前那一段。
 * （不直接改 stageIndex，是因为推进本身也是要被验的流程。）
 */
const installBossStage = (page) =>
  page.evaluate(() => {
    window.__toBossStage = async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.clearStage();
      for (let i = 0; i < 320; i++) {
        await wait(16);
        const s = window.__nai.state();
        if (s.stage === s.stageCount && s.state === 'aim') return s.stage;
      }
      return window.__nai.state().stage;
    };
  });

const waitServer = async (url, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise((resolve, reject) => {
        http.get(url, (res) => { res.resume(); resolve(); }).on('error', reject);
      });
      return true;
    } catch (e) {
      await sleep(150);
    }
  }
  return false;
};

const main = async () => {
  await fs.mkdir(shots, { recursive: true });
  const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${PORT}/`;
  const problems = [];
  const report = { base, problems, shots: [] };
  let browser;
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(shots, name) });
    report.shots.push(name);
  };

  try {
    if (!(await waitServer(base))) throw new Error('静态服务器没起来');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--disable-gpu'] });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
    });

    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__nai && window.__nai.imagesReady(), null, { timeout: 20000 });
    await installStill(page);
    await installBossStage(page);
    const imgs = await page.evaluate(() => window.__nai.imageStatus());
    report.images = imgs;
    Object.entries(imgs).forEach(([k, w]) => { if (!w) problems.push(`素材没加载出来：${k}`); });
    const roster = await page.locator('#roster .card').count();
    report.rosterCards = roster;
    if (roster < 8) problems.push(`标题页角色一览只有 ${roster} 个（应该有 8 个奶蛋）`);
    // 版本戳：file:// 打开时页面不会自己刷新，靠它确认看的是不是最新那份
    const build = await page.evaluate(() => ({
      build: window.__nai.build,
      stamp: document.getElementById('buildStamp') ? document.getElementById('buildStamp').textContent : '',
    }));
    report.build = build;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(build.build))) problems.push(`window.__nai.build 版本戳不对（${build.build}）`);
    if (!build.stamp.includes(build.build)) problems.push(`标题页没显示版本号（${build.stamp}）`);
    await shot(page, '00-title.png');

    // ---------------------------------------------------------- 地图尺寸与自由缩放
    const worldInfo = await page.evaluate(() => {
      const s = window.__nai.state();
      return { worldW: s.worldW, zoomRange: window.__nai.zoomRange() };
    });
    report.world = worldInfo;
    if (worldInfo.worldW !== 2720) problems.push(`地图长度应该是 2720（原来的两倍），实际 ${worldInfo.worldW}`);
    const zoomProbe = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      window.__nai.setZoom(0.45);
      await wait(120);
      out.far = window.__nai.state();
      window.__nai.setZoom(1.7);
      await wait(120);
      out.near = window.__nai.state();
      window.__nai.setZoom(1);
      await wait(120);
      out.normal = window.__nai.state();
      return { far: { zoom: out.far.camZoom, camX: Math.round(out.far.camX), camY: Math.round(out.far.camY) }, near: out.near.camZoom, normal: out.normal.camZoom };
    });
    report.zoomProbe = zoomProbe;
    if (Math.abs(zoomProbe.far.zoom - 0.45) > 0.01) problems.push(`缩到最小时 zoom 应该是 0.45，实际 ${zoomProbe.far.zoom}`);
    if (Math.abs(zoomProbe.near - 1.7) > 0.01) problems.push(`放到最大时 zoom 应该是 1.7，实际 ${zoomProbe.near}`);
    if (Math.abs(zoomProbe.normal - 1) > 0.001) problems.push('按回 100% 时镜头没复位');

    // ---------------------------------------------------------- 开局选蛋：每关多带一颗，开局让玩家挑
    const pickCards = await page.locator('#pickRoster .card').count();
    await page.click('#btnStart');
    await sleep(280);
    const picking = await page.evaluate(() => window.__nai.state());
    report.pickPanel = { cards: pickCards, state: picking.state, shown: picking.pickShown, birdsLeft: picking.birdsLeft };
    await shot(page, '00b-pick.png');
    if (pickCards < 8) problems.push(`开局选蛋面板只有 ${pickCards} 张卡（8 个奶蛋都该能挑）`);
    if (picking.state !== 'pick' || !picking.pickShown) problems.push('点了"第一关"没有先弹开局选蛋面板');
    if (picking.birdsLeft !== 4) problems.push(`面板上该显示 4 发（第一关原本 3 发 +1），实际 ${picking.birdsLeft}`);
    // 点第 4 张卡（爆奶蛋）当首发
    await page.locator('#pickRoster .card').nth(3).click();
    await sleep(320);
    const picked = await page.evaluate(() => window.__nai.state());
    report.pickResult = {
      state: picked.state,
      shown: picked.pickShown,
      currentBird: picked.currentBird,
      birdsLeft: picked.birdsLeft,
      levelBirds: picked.levelBirds,
    };
    if (picked.pickShown) problems.push('选完奶蛋之后面板没关掉');
    if (picked.currentBird !== 'bomb') problems.push(`挑中的奶蛋没排到队首首发（首发是 ${picked.currentBird}）`);
    if (picked.levelBirds[0] !== 'bomb' || picked.levelBirds.length !== 4) {
      problems.push(`这一关的阵容不对：${picked.levelBirds.join('、')}`);
    }
    if (picked.birdsLeft !== 4) problems.push(`选完之后这一关该有 4 发奶蛋，实际 ${picked.birdsLeft}`);

    // ---------------------------------------------------------- 开场动画
    await sleep(120);
    const introA = await page.evaluate(() => window.__nai.state());
    await shot(page, '01-intro-ally.png');
    report.introStart = { state: introA.state, zoom: introA.camZoom, label: introA.introLabel };
    if (introA.state !== 'intro') problems.push('点了"第一关"之后没有进开场动画');
    if (introA.camZoom < 1.2) problems.push(`开场没有拉近镜头（zoom=${introA.camZoom}）`);
    if (introA.introLabel !== '我方') problems.push(`开场第一段应该展示我方，实际是 ${introA.introLabel}`);
    // 镜头应该从左边（我方）移到右边（敌方）
    await page.waitForFunction(() => window.__nai.state().introLabel === '敌方', null, { timeout: 8000 }).catch(() => {});
    const introB = await page.evaluate(() => window.__nai.state());
    report.introEnemy = { zoom: introB.camZoom, camX: Math.round(introB.camX), label: introB.introLabel };
    await shot(page, '02-intro-enemy.png');
    if (introB.introLabel !== '敌方') problems.push('开场没有切到"敌方"那一段');
    if (introB.camX < 200) problems.push(`开场镜头没有往敌方那边移动（camX=${introB.camX}）`);
    // 跳过 + 自然结束
    await page.evaluate(() => window.__nai.skipIntro());
    await sleep(200);
    const introC = await page.evaluate(() => window.__nai.state());
    report.introEnd = { state: introC.state, zoom: introC.camZoom, camX: Math.round(introC.camX) };
    if (introC.state !== 'aim') problems.push('跳过开场之后没有进入瞄准状态');
    if (Math.abs(introC.camZoom - 1) > 0.02) problems.push('跳过开场之后镜头没有回到 1.0 倍');

    // ---------------------------------------------------------- 等候区奶蛋的待机动作
    const idle = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const samples = [];
      for (let i = 0; i < 70; i++) {
        samples.push(window.__nai.state().queueIdle);
        await wait(45);
      }
      return samples;
    });
    const firstSlot = idle.map((s) => s[0]).filter(Boolean);
    const poseKeys = new Set(firstSlot.map((p) => `${p.dy}|${p.deg}|${p.air}`));
    const minDy = Math.min(...firstSlot.map((p) => p.dy));
    const maxDeg = Math.max(...idle.flat().filter(Boolean).map((p) => Math.abs(p.deg)));
    report.queueIdle = { samples: firstSlot.length, distinctPoses: poseKeys.size, minDy: Math.round(minDy * 10) / 10, maxDeg };
    await shot(page, '03b-queue-idle.png');
    if (firstSlot.length < 2) problems.push('等候区没有待发奶蛋，待机动作没法验证');
    if (poseKeys.size < 8) problems.push(`等候的奶蛋像是在站着不动（3 秒里只有 ${poseKeys.size} 种姿态）`);
    if (minDy > -18) problems.push(`等候的奶蛋没有跳起来（最高只抬了 ${Math.abs(minDy).toFixed(1)}px）`);
    if (maxDeg < 90) problems.push(`等候的奶蛋没有翻滚（最大旋转只有 ${maxDeg}°）`);

    // ---------------------------------------------------------- 第一关：结构与可玩性
    const settleA = await page.evaluate(() => window.__nai.state());
    await sleep(2400);
    const settleB = await page.evaluate(() => window.__nai.state());
    const drift = Math.max(
      0,
      ...settleA.blockPositions.map((b, i) => {
        const nb = settleB.blockPositions[i];
        return nb ? Math.hypot(nb.x - b.x, nb.y - b.y) : 999;
      }),
      ...settleA.pigPositions.map((p, i) => {
        const np = settleB.pigPositions[i];
        return np ? Math.hypot(np.x - p.x, np.y - p.y) : 999;
      })
    );
    report.initialDrift = Math.round(drift * 10) / 10;
    if (drift > 6) problems.push(`开局结构不稳定，2.4 秒内位移 ${drift.toFixed(1)}px`);
    if (settleB.blockPositions.length !== settleA.blockPositions.length) {
      problems.push('开局就有方块自己碎了（出生位置有悬空，摔落伤害把自己砸坏了）');
    }

    // 物块摔落伤害：落差越大掉血越多，冰块会直接摔碎
    const fallDamage = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const test = async (material, w, h, height) => {
        window.__nai.loadEndless(1, 5);
        window.__nai.skipIntro();
        await window.__still();
        const info = window.__nai.dropTest(material, w, h, height);
        await wait(2200);
        const after = window.__nai.state().blockPositions[info.index];
        return { max: info.hp, left: after ? after.hp : 0, gone: !after };
      };
      return {
        low: await test('wood', 90, 60, 60),
        high: await test('wood', 90, 60, 320),
        ice: await test('ice', 90, 60, 320),
      };
    });
    report.fallDamage = fallDamage;
    const lostRatio = (r) => (r.gone ? 1 : (r.max - r.left) / r.max);
    if (lostRatio(fallDamage.high) < 0.5) {
      problems.push(`木块从 320px 摔下来只掉 ${(lostRatio(fallDamage.high) * 100).toFixed(0)}% 血，摔落伤害没生效`);
    }
    if (lostRatio(fallDamage.low) > 0.15) {
      problems.push(`木块从 60px 摔下来就掉 ${(lostRatio(fallDamage.low) * 100).toFixed(0)}% 血，太敏感了`);
    }
    if (!fallDamage.ice.gone) problems.push('冰块从 320px 摔下来居然没碎');
    // 上面用了 loadEndless 会让 mode 变成无尽模式，回到手工第一关再继续后面的用例
    await page.evaluate(() => {
      window.__nai.start('level1');
      window.__nai.skipIntro();
    });
    await sleep(300);
    await shot(page, '03-aim.png');

    // 拖弓预览 + 真实鼠标发射
    const box = await page.locator('#game').boundingBox();
    const toClient = async (wx, wy) => {
      const cam = await page.evaluate(() => window.__nai.state());
      const zoom = cam.camZoom;
      const scale = Math.min(box.width / 1280, box.height / 720);
      return { x: box.x + (wx - cam.camX) * zoom * scale, y: box.y + (wy - cam.camY) * zoom * scale };
    };
    const anchor = await toClient(186, 470);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    // 一直拉到满弓：这里要顺便验证"满弓力量特效"确实亮起来了
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(anchor.x - i * 12, anchor.y + i * 7);
      await sleep(30);
    }
    await sleep(420);
    const charged = await page.evaluate(() => window.__nai.state());
    report.chargeFx = { power: charged.pullPower, charge: charged.charge };
    if (charged.pullPower < 0.95) problems.push(`拖拽没能拉满弓（power=${charged.pullPower}）`);
    if (charged.charge < 0.6) problems.push(`拉满弓之后力量特效没起来（charge=${charged.charge}）`);
    await shot(page, '04-drag.png');
    await page.mouse.up();
    await sleep(320);
    await shot(page, '05-fly.png');
    await page.waitForFunction(() => window.__nai.state().state !== 'fly', null, { timeout: 20000 });
    await sleep(1200);
    await shot(page, '06-after-shot.png');

    // 多角度扫射（先跳过开场）
    const sweep = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const angles = [-2, 0, 2, 8, 12, 14, 16, 20];
      const out = [];
      for (const a of angles) {
        while (window.__nai.state().state === 'intro') window.__nai.skipIntro();
        window.__nai.restart();
        window.__nai.skipIntro();
        await window.__still();
        const blocksBefore = window.__nai.state().blocksAlive; // 别写死方块数：第一关改过结构
        window.__nai.shoot(a, 1);
        for (let i = 0; i < 340; i++) {
          await wait(16);
          const s = window.__nai.state();
          if (s.state === 'over' || s.state === 'aim') break;
        }
        const s = window.__nai.state();
        out.push({ angle: a, pigsKilled: 3 - s.pigsAlive, blocksBroken: blocksBefore - s.blocksAlive, score: s.score, left: s.pigPositions.map((p) => `${p.x},${p.y}`) });
      }
      return out;
    });
    report.sweep = sweep;
    const killers = sweep.filter((s) => s.pigsKilled > 0).length;
    const best = sweep.slice().sort((a, b) => b.score - a.score)[0];
    report.sweepSummary = { anglesThatKill: killers, best };
    if (killers < 4) problems.push(`8 个角度里只有 ${killers} 个能打掉奶蛙，可玩性太低`);
    if (best.blocksBroken === 0) problems.push('所有角度都没打碎任何方块，破坏反馈缺失');
    if (best.blocksBroken < 1) problems.push('一发连一块方块都没拆掉，破坏反馈缺失');

    // 三星线：两发通关是否可行
    const twoShot = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const candidates = [[0, 14], [0, 16], [2, 14], [-2, 14], [8, 16], [0, 12]];
      const out = [];
      for (const [a1, a2] of candidates) {
        while (window.__nai.state().state === 'intro') window.__nai.skipIntro();
        window.__nai.restart();
        window.__nai.skipIntro();
        await window.__still();
        for (const a of [a1, a2]) {
          window.__nai.shoot(a, 1);
          for (let i = 0; i < 340; i++) {
            await wait(16);
            const s = window.__nai.state();
            if (s.state === 'over' || s.state === 'aim') break;
          }
          if (window.__nai.state().state === 'over') break;
          await wait(720);
        }
        const s = window.__nai.state();
        out.push({ line: `${a1}°+${a2}°`, cleared: s.pigsAlive === 0, score: s.score });
        if (s.pigsAlive === 0) break;
      }
      return out;
    });
    report.twoShot = twoShot;
    if (!twoShot.some((t) => t.cleared)) problems.push(`没找到两发通关的线路（试了 ${twoShot.map((t) => t.line).join('、')}），三星阈值可能拿不到`);

    // 三发全空 → 判负
    const lose = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.restart();
      window.__nai.skipIntro();
      await window.__still();
      for (let k = 0; k < 6; k++) {
        // 往正上方打：直接飞出屏幕被回收，绝对碰不到结构
        // （以前打左墙那种"空枪"现在会弹回来把拱门撞塌，已经不算是空枪了）
        window.__nai.shoot(85, 1);
        for (let i = 0; i < 700; i++) {
          await wait(16);
          const s = window.__nai.state();
          if (s.state === 'over' || s.state === 'aim') break;
        }
        const s = window.__nai.state();
        if (s.state === 'over') break;
        await wait(780);
      }
      return window.__nai.state();
    });
    report.loseTest = { state: lose.state, pigsAlive: lose.pigsAlive };
    if (lose.state !== 'over') problems.push('三发全空之后没有进入结算，回合流程卡住了');
    if (lose.pigsAlive !== 3) problems.push(`三发全空居然打掉了奶蛙（剩 ${lose.pigsAlive} 只），判定有问题`);
    await shot(page, '07-lose.png');

    // ---------------------------------------------------------- 六个奶蛋的技能
    const skillTests = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = [];
      const types = ['naidan', 'dash', 'split', 'bomb', 'heavy', 'milk', 'back', 'seek'];
      for (const type of types) {
        window.__nai.sandbox(type);
        await window.__still();
        window.__nai.shoot(6, 1);
        // 爆奶蛋要飞到木头墙边上再炸才看得出破坏力，其他技能在半空放
        await wait(type === 'bomb' ? 430 : 250);
        const before = window.__nai.state();
        const used = window.__nai.activateSkill();
        await wait(90);
        const mid = window.__nai.state();
        await wait(420);
        const soon = window.__nai.state();
        await wait(2200);
        const after = window.__nai.state();
        out.push({
          type,
          used,
          speedBefore: before.bird ? before.bird.v : 0,
          speedMid: mid.bird ? mid.bird.v : 0,
          inFlightMid: mid.inFlight,
          bombsMid: mid.bombs,
          bombsAfter: after.bombs,
          blocksBefore: before.blocksAlive,
          blocksAfter: after.blocksAlive,
          pigsBefore: before.pigsAlive,
          pigsAfter: after.pigsAlive,
          shockwave: mid.explosions,
          vxBefore: before.bird ? before.bird.vx : 0,
          vxMid: mid.bird ? mid.bird.vx : 0,
          xMid: mid.bird ? mid.bird.x : 0,
          xSoon: soon.bird ? soon.bird.x : 0,
        });
      }
      return out;
    });
    report.skillTests = skillTests;
    const byType = Object.fromEntries(skillTests.map((t) => [t.type, t]));

    // 清障能力：密集横排墙体上，一发要能顺着速度连拆（撞碎后保留速度的"穿透"）
    const plowTest = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const run = async (type, angle) => {
        window.__nai.sandbox(type);
        await window.__still();
        const before = window.__nai.state().blocksAlive;
        window.__nai.shoot(angle, 1);
        for (let i = 0; i < 330; i++) {
          await wait(16);
          if (window.__nai.state().state !== 'fly') break;
        }
        await wait(900);
        return before - window.__nai.state().blocksAlive;
      };
      return { naidan: await run('naidan', 6), heavy: await run('heavy', 2) };
    });
    report.plowTest = plowTest;
    if (plowTest.naidan < 2) problems.push(`奶蛋一发平射只拆掉 ${plowTest.naidan} 块（穿透没生效）`);
    if (plowTest.heavy < 3) problems.push(`胖奶蛋一发只拆掉 ${plowTest.heavy} 块（它应该一发清掉整排）`);

    // 奶泡炸弹威力 / 分身伤害
    const skillPower = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      /**
       * 奶泡蛋按"飞过 x 就把奶泡丢下去"来放技能。
       * 以前这里等固定 380ms，可是 380ms 里物理走了几步取决于帧率，
       * 于是奶泡有时丢在墙前面——这条断言就会时绿时红。改成看位置。
       */
      const run = async (type, delay, untilX = 0) => {
        window.__nai.sandbox(type);
        await window.__still();
        const before = window.__nai.state().blocksAlive;
        window.__nai.shoot(4, 1);
        if (untilX) {
          for (let i = 0; i < 90; i++) {
            await wait(16);
            const s = window.__nai.state();
            if (s.state !== 'fly' || !s.bird || s.bird.x >= untilX) break;
          }
        } else {
          await wait(delay);
        }
        window.__nai.activateSkill();
        await wait(2600);
        return before - window.__nai.state().blocksAlive;
      };
      return { milk: await run('milk', 380, 880), split: await run('split', 300) };
    });
    report.skillPower = skillPower;
    if (skillPower.milk < 1) problems.push('奶泡炸弹没炸掉任何方块（威力还是不够）');
    if (skillPower.split < 3) problems.push(`分身三只一起只拆掉 ${skillPower.split} 块（伤害太低）`);

    // 制导奶蛋：朝"点到的那个位置"直线加速飞过去
    const seekAim = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.sandbox('seek');
      await window.__still();
      window.__nai.shoot(6, 1);
      await wait(200);
      const before = window.__nai.state();
      // 目标点：正前方偏上的空域（沙盒那块墙在下面，不会挡到）
      const target = { x: before.bird.x + 520, y: 250 };
      const used = window.__nai.activateSkill(target);
      const justAfter = window.__nai.state();
      const path = [];
      for (let i = 0; i < 18; i++) {
        await wait(16);
        const s = window.__nai.state();
        if (s.bird) path.push([s.bird.x, s.bird.y, s.seek ? 1 : 0, s.bird.v]);
      }
      const guided = path.filter((p) => p[2]);
      const g0 = guided[0] || path[0];
      const g1 = guided[guided.length - 1] || path[path.length - 1];
      const dx = g1[0] - g0[0];
      const dy = g1[1] - g0[1];
      const L = Math.hypot(dx, dy) || 1;
      const dev = Math.max(...(guided.length ? guided : [g0]).map((p) => Math.abs((p[0] - g0[0]) * dy - (p[1] - g0[1]) * dx) / L));
      const want = Math.hypot(target.x - before.bird.x, target.y - before.bird.y) || 1;
      return {
        used,
        dir: justAfter.seek ? { nx: justAfter.seek.nx, ny: justAfter.seek.ny } : null,
        wantN: { x: Math.round(((target.x - before.bird.x) / want) * 1000) / 1000, y: Math.round(((target.y - before.bird.y) / want) * 1000) / 1000 },
        straight: Math.round(dev * 10) / 10,
        guidedFrames: guided.length,
        maxV: Math.max(...path.map((p) => p[3] || 0)),
        marks: justAfter.aimMarks,
      };
    });
    report.seekAim = seekAim;
    if (!seekAim.used) problems.push('制导奶蛋的技能没生效');
    if (!seekAim.dir) problems.push('制导奶蛋点完之后没有进入制导状态');
    else {
      const d = Math.hypot(seekAim.dir.nx - seekAim.wantN.x, seekAim.dir.ny - seekAim.wantN.y);
      if (d > 0.02) problems.push(`制导方向不是朝点击的位置（${JSON.stringify(seekAim.dir)} vs ${JSON.stringify(seekAim.wantN)}）`);
    }
    if (seekAim.straight > 3) problems.push(`制导不是一条直线（最大偏移 ${seekAim.straight}px）`);
    if (seekAim.guidedFrames < 4) problems.push(`制导只撑了 ${seekAim.guidedFrames} 帧，太短了`);
    if (seekAim.maxV < 26) problems.push(`制导没有加速（最高才 ${seekAim.maxV} 像素/帧）`);
    if (!seekAim.marks) problems.push('点完之后没有在点击位置留下靶心标记');

    // 奶蛋落地之后不许"越转越快"
    // 根因：飞行姿态是直接写 body.angle 的，而 Matter 的速度是从"这一帧和上一帧的位置/角度差"
    // 推出来的——只改 angle 不改 anglePrev，等于每帧都在告诉它"我刚转了这么多"，
    // 角速度就这么一格一格叠上去；落地之后 airFriction 只有 0.0025，几乎停不下来。
    const spinTest = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.sandbox('naidan');
      await window.__still();
      // 朝地面打一发（-25°）：落地、弹两下、滚到停，正好量"停稳之后还在不在转"
      window.__nai.shoot(-25, 1);
      const rows = [];
      let restAv = null;
      for (let i = 0; i < 200; i++) {
        await wait(16);
        const s = window.__nai.state();
        if (!s.bird) break;
        rows.push({ av: s.bird.av, y: s.bird.y, v: s.bird.v });
        // 滚到基本停下：这一下的角速度必须也归零，否则就是"停不下来地打转"
        if (i > 24 && s.bird.v < 0.3 && s.bird.y > 580) { restAv = s.bird.av; break; }
      }
      const abs = rows.map((r) => Math.abs(r.av));
      return {
        samples: abs.length,
        peak: abs.length ? Math.round(Math.max(...abs) * 1000) / 1000 : 0,
        restAv: restAv === null ? null : Math.round(Math.abs(restAv) * 1000) / 1000,
      };
    });
    report.spinTest = spinTest;
    if (spinTest.peak > 0.3) problems.push(`奶蛋转得太凶（角速度峰值 ${spinTest.peak} 弧度/帧，上限 0.3）`);
    if (spinTest.restAv !== null && spinTest.restAv > 0.03) {
      problems.push(`奶蛋停下来之后还在打转（静止时角速度 ${spinTest.restAv} 弧度/帧）`);
    }

    // 补给奶蛙：出现率 25%，打掉补一颗奶蛋
    const bonus = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let total = 0;
      let marked = 0;
      let found = null;
      for (let l = 1; l <= 40; l++) {
        for (const seed of [1, 7, 99, 1234, 2026]) {
          const d = window.__nai.endless(l, seed);
          total += d.pigs.length;
          marked += d.pigs.filter((p) => p.bonus).length;
          if (!found && l === 1 && d.pigs.some((p) => p.bonus)) found = { l, seed };
        }
      }
      let effect = null;
      if (found) {
        const def = window.__nai.endless(found.l, found.seed);
        const bonusCount = def.pigs.filter((p) => p.bonus).length;
        window.__nai.loadEndless(found.l, found.seed);
        window.__nai.skipIntro();
        await window.__still();
        const ammoBefore = window.__nai.state().birdQueue.length + 1;
        window.__nai.clearStage();
        await wait(1500);
        effect = { level: found.l, bonusCount, ammoBefore, ammoAfter: window.__nai.state().birdQueue.length + 1 };
      }
      return { rate: Math.round((marked / total) * 1000) / 1000, total, marked, effect };
    });
    report.bonusPig = bonus;
    if (bonus.rate < 0.18 || bonus.rate > 0.32) problems.push(`补给奶蛙出现率 ${(bonus.rate * 100).toFixed(1)}%，偏离 25% 太多`);
    if (!bonus.effect) problems.push('找不到带补给奶蛙的关卡');
    else if (bonus.effect.ammoAfter - bonus.effect.ammoBefore !== bonus.effect.bonusCount) {
      problems.push(`打掉补给奶蛙没按数量补奶蛋（补了 ${bonus.effect.ammoAfter - bonus.effect.ammoBefore}，应该有 ${bonus.effect.bonusCount}）`);
    }

    // 波次上限 3，之后的难度堆在单波次里
    const waveRule = await page.evaluate(() =>
      [1, 4, 7, 10, 13, 20, 26].map((l) => {
        const d = window.__nai.endless(l, 2026);
        const scales = d.blocks.map((b) => b.hpScale || 1);
        return { level: l, stages: d.stages, worldW: d.worldW, pigs: d.pigs.length, blocks: d.blocks.length, hpScale: Math.max(...scales) };
      })
    );
    report.waveRule = waveRule;
    const over = waveRule.filter((r) => r.stages > 3);
    if (over.length) problems.push(`有关卡超过 3 波：${over.map((r) => `第${r.level}关(${r.stages}波)`).join('、')}`);
    const l7w = waveRule.find((r) => r.level === 7);
    const l26w = waveRule.find((r) => r.level === 26);
    if (!l7w || !l26w || l7w.stages !== 3 || l26w.stages !== 3) problems.push('高关卡没有用满（且不超过）3 波');
    else {
      if (!(l26w.pigs > l7w.pigs)) problems.push(`高关卡的奶蛙数没继续增长（第7关 ${l7w.pigs}，第26关 ${l26w.pigs}）`);
      if (!(l26w.hpScale > l7w.hpScale)) problems.push(`高关卡的方块没变厚（第7关 ×${l7w.hpScale}，第26关 ×${l26w.hpScale}）`);
    }
    if (byType.naidan.used) problems.push('基础奶蛋不该有技能，但 activateSkill 返回了 true');
    if (byType.heavy.used) problems.push('胖奶蛋不该有技能，但 activateSkill 返回了 true');
    if (!byType.dash.used || byType.dash.speedMid <= byType.dash.speedBefore) problems.push('冲刺技能没生效（速度没变快）');
    if (!byType.split.used || byType.split.inFlightMid < 3) problems.push('分身技能没生效（飞行中的奶蛋没变 3 只）');
    if (!byType.bomb.used || byType.bomb.blocksAfter >= byType.bomb.blocksBefore) problems.push('爆炸技能没炸掉任何方块');
    if (!byType.bomb.shockwave) problems.push('爆炸没有冲击波表现（explosions 一直是 0）');
    if (!byType.milk.used || byType.milk.bombsMid < 1) problems.push('投奶泡技能没生效（没有奶泡炸弹生成）');
    if (byType.milk.bombsAfter !== 0) problems.push('奶泡炸弹落地之后没有炸掉');
    if (!byType.back.used) problems.push('回旋奶蛋的技能没生效');
    if (!byType.seek.used) problems.push('制导奶蛋的技能没生效');
    else {
      if (!(byType.back.vxBefore > 0 && byType.back.vxMid < 0)) {
        problems.push(`回旋没有掉头（vx ${byType.back.vxBefore} → ${byType.back.vxMid}）`);
      }
      if (!(byType.back.xSoon < byType.back.xMid - 40)) {
        problems.push(`回旋之后没有真的往回飞（x ${byType.back.xMid} → ${byType.back.xSoon}）`);
      }
    }
    await shot(page, '08-skill-sandbox.png');

    // ---------------------------------------------------------- 无尽模式：随机生成稳定性
    const genStability = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = [];
      for (const seed of [7, 12345]) {
        for (const lv of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
          const info = window.__nai.loadEndless(lv, seed);
          const a = window.__nai.state();
          await wait(2200);
          const b = window.__nai.state();
          const drift = Math.max(
            0,
            ...a.blockPositions.map((p, i) => (b.blockPositions[i] ? Math.hypot(b.blockPositions[i].x - p.x, b.blockPositions[i].y - p.y) : 999)),
            // boss 是个 144px 宽的大圆，落座时会自然滑十几像素，所以单独量
            ...a.pigPositions.map((p, i) => {
              if (i === a.bossIndex) return 0;
              return b.pigPositions[i] ? Math.hypot(b.pigPositions[i].x - p.x, b.pigPositions[i].y - p.y) : 999;
            })
          );
          const bossDrift = a.bossIndex >= 0 && b.pigPositions[a.bossIndex]
            ? Math.hypot(b.pigPositions[a.bossIndex].x - a.pigPositions[a.bossIndex].x, b.pigPositions[a.bossIndex].y - a.pigPositions[a.bossIndex].y)
            : 0;
          const xs = a.blockPositions.map((p) => p.x);
          const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
          const far = xs.length ? Math.max(...xs) : 0;
          // 每只奶蛙按"它自己那一段的弹弓"来量距离，不然多段关卡会被误判成射程外
          const pigFar = Math.max(
            0,
            ...a.pigPositions.map((p, i) => {
              const st = a.pigStages ? a.pigStages[i] : 0;
              return p.x - (a.launchPoints[st] ?? a.launchPoints[0]);
            })
          );
          out.push({
            seed, level: lv, drift: Math.round(drift * 10) / 10, pigs: info.pigs, blocks: info.blocks, birds: info.birds,
            structure: b.levelName, span: Math.round(span), far: Math.round(far),
            worldW: b.worldW, stages: b.stageCount, slingX: b.slingX, stagePigDist: Math.round(pigFar),
            bossDrift: Math.round(bossDrift * 10) / 10,
          });
        }
      }
      return out;
    });
    report.genStability = genStability;
    const badGen = genStability.filter((g) => g.drift > 8);
    if (badGen.length) {
      problems.push(`有 ${badGen.length} 个随机关卡开局自己就散了：${badGen.map((g) => `seed${g.seed}-第${g.level}关(${g.drift}px)`).join('、')}`);
    }
    const badBoss = genStability.filter((g) => g.bossDrift > 20);
    if (badBoss.length) problems.push(`boss 落座时滑得太多：${badBoss.map((g) => `第${g.level}关(${g.bossDrift}px)`).join('、')}`);
    const pigCounts = genStability.filter((g) => g.seed === 7).map((g) => g.pigs);
    const spans = genStability.filter((g) => g.seed === 7).map((g) => g.span);
    const worlds = genStability.filter((g) => g.seed === 7).map((g) => g.worldW);
    const stages = genStability.filter((g) => g.seed === 7).map((g) => g.stages);
    report.endlessRamp = { pigCounts, birdCounts: genStability.filter((g) => g.seed === 7).map((g) => g.birds), spans, worlds, stages };
    if (!(pigCounts[7] > pigCounts[0])) problems.push(`无尽模式难度没往上走（第1关 ${pigCounts[0]} 只奶蛙，第8关 ${pigCounts[7]} 只）`);
    if (!(worlds[7] > worlds[0])) problems.push(`地图没有随关卡变长（第1关 ${worlds[0]}，第8关 ${worlds[7]}）`);
    if (!(stages[7] > stages[0])) problems.push(`关卡分段数没有随难度增加（第1关 ${stages[0]} 段，第8关 ${stages[7]} 段）`);
    // 拉长地图只许靠"多分段"，不许把奶蛙摊远：每段内奶蛙离弹弓最远 1500px
    const tooFar = genStability.filter((g) => g.stagePigDist > 1500);
    if (tooFar.length) problems.push(`有奶蛙被摆得离本段弹弓太远：${tooFar.map((g) => `seed${g.seed}-第${g.level}关(${g.stagePigDist}px)`).join('、')}`);
    const tooTight = genStability.filter((g) => g.stagePigDist < 260);
    if (tooTight.length) problems.push(`有奶蛙几乎贴着弹弓：${tooTight.map((g) => `seed${g.seed}-第${g.level}关(${g.stagePigDist}px)`).join('、')}`);
    const tooWide = genStability.filter((g) => g.stages === 1 && g.span > 900);
    if (tooWide.length) problems.push(`单段关卡的结构摊得太开：${tooWide.map((g) => `seed${g.seed}-第${g.level}关(${g.span}px)`).join('、')}`);
    await shot(page, '09-endless-level.png');

    // ---------------------------------------------------------- 长关卡分段推进
    const stageFlow = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(7, 4242);
      window.__nai.skipIntro();
      await window.__still();
      const out = [];
      const snap = () => {
        const s = window.__nai.state();
        return { stage: s.stage, stageCount: s.stageCount, slingX: s.slingX, stagePigs: s.stagePigs, state: s.state };
      };
      out.push(snap());
      for (let k = 0; k < 3; k++) {
        window.__nai.clearStage();
        await wait(2600);
        out.push(snap());
      }
      return out;
    });
    report.stageFlow = stageFlow;
    if (stageFlow[0].stageCount < 2) problems.push(`高关卡应该是多段推进，第 7 关只有 ${stageFlow[0].stageCount} 段`);
    for (let i = 1; i < Math.min(stageFlow.length, 3); i++) {
      if (stageFlow[i].slingX <= stageFlow[i - 1].slingX) problems.push(`清完第 ${i} 段后弹弓没有往前推（${stageFlow[i - 1].slingX} → ${stageFlow[i].slingX}）`);
      if (stageFlow[i].state !== 'aim') problems.push(`推进到第 ${i + 1} 段后没有回到瞄准状态（${stageFlow[i].state}）`);
    }
    await shot(page, '09b-stage-advance.png');

    // ---------------------------------------------------------- 转波次时手上还攥着拖拽
    // 回归：清掉这一段后的 0.95 秒里玩家就开始拉弓，弹弓推进到下一段之后才松手。
    // 以前这一下会拿"上一段的拉弓位置"去减"新弹弓位置"，算出一个反向的巨大拉力——
    // 奶蛋直接倒着甩出去（实测 vx 冲到 160 像素/帧）。
    const dragAcrossStage = await page.evaluate(async () => {
      window.__nai.loadEndless(4, 4242);
      window.__nai.skipIntro();
      await window.__still();
      return window.__nai.state();
    });
    const dragFrom = await toClient(dragAcrossStage.slingX, 470);
    const birdBefore = {
      cur: dragAcrossStage.currentBird,
      total: dragAcrossStage.birdQueue.length + 1,   // 弓上那颗 + 队列
      left: dragAcrossStage.birdsLeft,
      // 这一段里的补给奶蛙会被 clearStage 打掉，每只正当地补一颗奶蛋——算进预期里，
      // 免得把"补给"误判成"凭空多出来的"
      bonus: dragAcrossStage.pigBonus.filter((b, i) => b && dragAcrossStage.pigStages[i] === 0).length,
    };
    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(dragFrom.x - i * 14, dragFrom.y + i * 9);
      await sleep(24);
    }
    await page.evaluate(() => window.__nai.clearStage());   // 0.95 秒后推进到第 2 段
    await sleep(1500);
    const midAdvance = await page.evaluate(() => window.__nai.state());
    await sleep(1500);                                      // 等新奶蛋上弓
    const heldAt = await page.evaluate(() => window.__nai.state());
    await page.mouse.up();
    await sleep(420);
    const afterRelease = await page.evaluate(() => window.__nai.state());
    report.dragAcrossStage = {
      midStage: midAdvance.stage,
      midState: midAdvance.state,
      stageAtRelease: heldAt.stage,
      slingX: heldAt.slingX,
      pullPower: heldAt.pullPower,
      birdBefore,
      birdAfter: { cur: heldAt.currentBird, total: heldAt.birdQueue.length + 1, left: heldAt.birdsLeft, bonus: birdBefore.bonus },
      stateAfterRelease: afterRelease.state,
      birdX: afterRelease.bird ? afterRelease.bird.x : null,
      birdVx: afterRelease.bird ? afterRelease.bird.vx : null,
    };
    if (midAdvance.stage !== 2) problems.push('转波次用例没推进到第 2 段（用例本身没跑起来）');
    if (heldAt.pullPower > 0.02) problems.push(`转波次之后手上那一拖没作废（pullPower=${heldAt.pullPower}）`);
    // 回归：拉弓被转波次打断时，手里那颗必须**原样留着**——不能凭空消失、更不能白吃一颗
    if (heldAt.currentBird !== birdBefore.cur) {
      problems.push(`转波次把弓上那颗换掉了（${birdBefore.cur} → ${heldAt.currentBird}）`);
    }
    const wantTotal = birdBefore.total + birdBefore.bonus;   // 弓上+队列，加上这一段补给奶蛙的奖励
    if (heldAt.birdQueue.length + 1 !== wantTotal) {
      problems.push(`转波次把奶蛋数改了（弓上+队列应该是 ${wantTotal}，实际 ${heldAt.birdQueue.length + 1}）`);
    }
    if (heldAt.birdsLeft !== birdBefore.left + birdBefore.bonus) {
      problems.push(`转波次把弹药数改了（应该是 ${birdBefore.left + birdBefore.bonus}，实际 ${heldAt.birdsLeft}）`);
    }
    if (afterRelease.state !== 'aim') problems.push(`转波次后松手把奶蛋发射出去了（状态 ${afterRelease.state}）`);
    if (afterRelease.bird && Math.abs(afterRelease.bird.x - afterRelease.slingX) > 40) {
      problems.push(`转波次后松手把奶蛋甩走了（x=${afterRelease.bird.x}，弹弓在 ${afterRelease.slingX}）`);
    }

    // ---------------------------------------------------------- 爆奶蛋：点屏幕引爆 + 转波次
    // 回归：爆奶蛋要靠"点一下屏幕"引爆，而这一下很容易和"转波次 / 换下一颗"撞上。
    // 以前这种情况会留下一颗奶蛋挂在引爆时点到的位置上（静态刚体不掉、也没人收），
    // 而且下一颗还会拿它残留的拉弓位置去算拉力（反向发射）。
    const bombLevel = await page.evaluate(() => {
      for (let lv = 2; lv <= 12; lv++) {
        const d = window.__nai.endless(lv, 4242);
        const i = d.birds.indexOf('bomb');
        if (i > 0 && d.stages >= 2 && i <= 6) return { level: lv, index: i, birds: d.birds };
      }
      return null;
    });
    report.bombExplode = { picked: bombLevel };
    if (!bombLevel) problems.push('找不到"队里有爆奶蛋 + 两段推进"的关卡，点屏引爆用例没跑');
    else {
      const bs = await page.evaluate(async (lv) => {
        window.__nai.loadEndless(lv, 4242);
        window.__nai.skipIntro();
        await window.__still();
        return window.__nai.state();
      }, bombLevel.level);
      // 点队列里那颗爆奶蛋 → 它立刻上弓
      const sl = bs.queueSlots[bombLevel.index - 1];
      const slotAt = await toClient(sl.x, sl.y - 30);
      await page.mouse.click(slotAt.x, slotAt.y);
      await sleep(220);
      const onSling = await page.evaluate(() => window.__nai.state());
      if (onSling.currentBird !== 'bomb') problems.push(`点队列里的爆奶蛋没上弓（现在是 ${onSling.currentBird}）`);
      // 打出去
      const bombAnchor = await toClient(onSling.slingX, 470);
      await page.mouse.move(bombAnchor.x, bombAnchor.y);
      await page.mouse.down();
      await page.mouse.move(bombAnchor.x - 95, bombAnchor.y + 55);
      await sleep(90);
      await page.mouse.up();
      // 飞一半点屏幕引爆，同时把这一段清掉（引爆和转波次撞在一起）
      await sleep(240);
      const tapAt = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.38 };
      await page.mouse.click(tapAt.x, tapAt.y);
      await page.evaluate(() => window.__nai.clearStage());
      for (let i = 0; i < 200; i++) {
        await sleep(50);
        const s = await page.evaluate(() => window.__nai.state());
        if (s.state === 'aim' && (s.stage === 2 || s.stage === s.stageCount)) break;
      }
      await sleep(500);
      const settled = await page.evaluate(() => {
        const s = window.__nai.state();
        return { stage: s.stage, state: s.state, slingX: s.slingX, birds: s.birdBodies, currentBird: s.currentBird };
      });
      report.bombExplode.after = settled;
      const idle = settled.birds.filter((b) => !b.launched);
      if (idle.length > 1) problems.push(`引爆+转波次之后场上留了 ${idle.length} 颗没发射的奶蛋：${JSON.stringify(idle)}`);
      const stray = idle.filter((b) => Math.abs(b.x - settled.slingX) > 60);
      if (stray.length) {
        problems.push(`引爆之后有奶蛋卡在别的位置（${stray.map((b) => `${b.x}≠${settled.slingX}`).join('、')}）`);
      }
      if (settled.state === 'aim' && settled.birds.length === 0) problems.push('引爆+转波次之后弓上没有奶蛋了');
    }

    // ---------------------------------------------------------- boss 关（每 10 关）
    // 回归：推进到下一段的瞬间奶蛋刚好用光，不能卡在 settling 不动
    const stageDrain = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      const settle = async (maxMs) => {
        for (let i = 0; i < maxMs / 100; i++) {
          await wait(100);
          const s = window.__nai.state();
          if (s.state === 'over' || s.state === 'clearing' || s.state === 'aim' || s.state === 'intro') return { state: s.state, ms: i * 100 };
        }
        return { state: window.__nai.state().state, ms: null };
      };
      // (a) 清掉这一段 + 同时把奶蛋清零，后面还有奶蛙 → 应该判负，不能卡住
      window.__nai.loadEndless(4, 4242);
      window.__nai.skipIntro();
      await window.__still();
      window.__nai.clearStage();
      window.__nai.drainBirds();
      out.afterDrain = window.__nai.state().state;
      const a = await settle(6000);
      out.hung = a.ms === null;
      out.settledMs = a.ms;
      out.finalState = a.state;
      out.endTitle = document.getElementById('endTitle').textContent;
      // (b) 反过来：最后一段清空且没弹了 → 应该判胜（进入下一关）
      window.__nai.loadEndless(4, 4242);
      window.__nai.skipIntro();
      await window.__still();
      window.__nai.clearStage();
      await wait(2600);
      out.midStage = window.__nai.state().stage;
      window.__nai.clearStage();
      window.__nai.drainBirds();
      const b = await settle(6000);
      out.lastStage = { state: b.state, ms: b.ms };
      return out;
    });
    report.stageDrain = stageDrain;
    if (stageDrain.hung) problems.push(`推进时奶蛋刚好用光会卡住（状态一直停在 ${stageDrain.finalState}）`);
    if (stageDrain.finalState !== 'over') problems.push(`没弹了、后面还有奶蛙，应该判负，实际 ${stageDrain.finalState}`);
    if (stageDrain.lastStage.ms === null) problems.push(`最后一段清空后没有结算（状态 ${stageDrain.lastStage.state}）`);

    const bossGen = await page.evaluate(() => {
      const out = [];
      for (const lv of [10, 20, 30, 15]) {
        const d = window.__nai.endless(lv, 1234);
        const boss = d.pigs.find((p) => p.boss);
        const legs = d.blocks.filter((b) => b.w === 40).length;
        out.push({
          level: lv,
          isBoss: !!boss,
          tier: d.boss ? d.boss.tier : 0,
          hp: boss ? boss.hp : 0,
          birds: d.birds.length,
          floors: d.boss ? d.boss.floors : 0,
          legs,
          mood: d.mood || 'day',
          stages: d.stages,
          launchPoints: d.launchPoints.map((p) => p.x),
          prePigs: d.pigs.filter((p) => (p.stage || 0) === 0).length,
          bossStage: boss ? boss.stage : -1,
          lastStagePigs: d.pigs.filter((p) => (p.stage || 0) === d.stages - 1).length,
        });
      }
      return out;
    });
    report.bossGen = bossGen;
    const bossLevels = bossGen.filter((g) => g.isBoss);
    const normalLevels = bossGen.filter((g) => !g.isBoss);
    if (bossLevels.length !== 3) problems.push(`第 10/20/30 关应该是 boss 关，实际只有 ${bossLevels.length} 个`);
    if (normalLevels.some((g) => g.isBoss)) problems.push('非整十关卡不该出现 boss');
    if (!(bossLevels[0].hp < bossLevels[1].hp && bossLevels[1].hp < bossLevels[2].hp)) {
      problems.push(`boss 血量没随档位递增：${bossLevels.map((b) => b.hp).join('/')}`);
    }
    if (!(bossLevels[0].birds >= 8)) problems.push(`boss 关的奶蛋太少（${bossLevels[0].birds} 发），没有容错空间`);
    if (bossLevels.some((b) => b.mood !== 'boss' || b.floors < 2)) problems.push('boss 关缺少压迫感气氛或可拆的塔');
    // 前哨那一波：boss 关必须是"前哨 + boss"两段，boss 只能在最后一段，前哨 1~2 只奶蛙
    if (bossLevels.some((b) => b.stages !== 2)) {
      problems.push(`boss 关应该有 2 段（前哨 + boss），实际 ${bossLevels.map((b) => b.stages).join('/')}`);
    }
    if (bossLevels.some((b) => b.bossStage !== 1)) problems.push('boss 没有站在最后一段（应该在第 2 段）');
    if (bossLevels.some((b) => b.prePigs < 1 || b.prePigs > 2)) {
      problems.push(`前哨的奶蛙数不对（${bossLevels.map((b) => b.prePigs).join('/')}，应该是 1~2 只）`);
    }
    if (bossLevels.some((b) => b.launchPoints.length !== 2)) problems.push('boss 关的推进点不是两个');
    if (bossLevels.some((b) => !(b.lastStagePigs >= 2))) problems.push('boss 那一段的奶蛙太少（boss 之外还得有护卫）');

    // 前哨清完之后要能推进到塔前那一段，而且对射距离不能被改掉
    const bossAdvance = await page.evaluate(async () => {
      window.__nai.loadEndless(10, 1234);
      window.__nai.skipIntro();
      await window.__still();
      const before = window.__nai.state();
      await window.__toBossStage();
      await window.__still();
      const after = window.__nai.state();
      const boss = window.__nai.bossInfo();
      return {
        stageBefore: before.stage,
        prePigsBefore: before.stagePigs,
        stageAfter: after.stage,
        stagePigsAfter: after.stagePigs,
        slingX: after.slingX,
        bossAlive: boss.boss,
        bossHp: boss.hp,
        distToBoss: Math.round(boss.x - after.slingX),
      };
    });
    report.bossAdvance = bossAdvance;
    if (bossAdvance.stageBefore !== 1 || bossAdvance.prePigsBefore < 1) problems.push('boss 关开局不是从"前哨"那一段开始的');
    if (bossAdvance.stageAfter !== 2) problems.push(`清完前哨之后没推进到第 2 段（停在 ${bossAdvance.stageAfter}）`);
    if (bossAdvance.stagePigsAfter < 1) problems.push(`推进之后那一段没有奶蛙了（${bossAdvance.stagePigsAfter} 只）`);
    if (!bossAdvance.bossAlive || bossAdvance.bossHp <= 0) problems.push('推进到下一段之后 boss 没了');
    if (Math.abs(bossAdvance.distToBoss - 890) > 60) {
      problems.push(`推进之后离 boss 的距离变了（${bossAdvance.distToBoss}px，原来是 890px）`);
    }

    // 特写：开场动画里应该有 BOSS 标签 + 猛推近的镜头
    const cutIn = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(10, 1234);
      window.__nai.startIntro(false);
      const seen = { label: null, maxZoom: 0 };
      for (let i = 0; i < 44; i++) {
        await wait(120);
        const s = window.__nai.state();
        if (s.introLabel === 'BOSS') seen.label = 'BOSS';
        seen.maxZoom = Math.max(seen.maxZoom, s.camZoom);
        if (!s.introLabel && seen.label) break;
      }
      const out = { ...seen, barShown: window.__nai.bossInfo().barShown };
      window.__nai.skipIntro();
      await wait(200);
      return out;
    });
    report.bossCutIn = cutIn;
    if (cutIn.label !== 'BOSS') problems.push('boss 关的开场没有出现 BOSS 特写标签');
    if (cutIn.maxZoom < 2) problems.push(`boss 特写没有推近镜头（最大 zoom=${cutIn.maxZoom}）`);
    if (!cutIn.barShown) problems.push('boss 关没有显示血条');
    await shot(page, '13-boss-arena.png');

    // 摔伤 > 直怼：验证"摔伤是主要解法"
    const bossDamage = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(10, 1234);
      window.__nai.skipIntro();
      await window.__still();
      await window.__toBossStage();
      await window.__still();       // 推进时前哨会散架，等它落定再取基准
      const start = window.__nai.bossInfo();
      const blocks0 = window.__nai.state().blocksAlive;
      // 1) 直怼：高抛一发，落在 boss 身上（不碰塔腿）。
      //    角度要挑"正落在它身上"的：25° 那种擦着边缘的角度，boss 落座时多滑几像素就会变成"顺手打断塔腿"，
      //    同一发弹药能打出 165~560 的血，验收就会随机变红。
      window.__nai.shoot(30, 1);
      for (let i = 0; i < 300; i++) {
        await wait(16);
        if (window.__nai.state().state !== 'fly') break;
      }
      await wait(900);
      const afterDirect = window.__nai.bossInfo();
      const blocksAfterDirect = window.__nai.state().blocksAlive;
      // 2) 摔伤：打断塔腿，让它整层塌下来
      window.__nai.breakTower();
      await wait(2800);
      const afterFall = window.__nai.bossInfo();
      return {
        maxHp: start.maxHp,
        direct: start.hp - afterDirect.hp,
        towerIntact: blocksAfterDirect === blocks0, // 直怼那一发有没有顺手动到塔
        fall: afterDirect.hp - afterFall.hp,
        fallPeak: afterFall.lastImpact && afterFall.lastImpact.vDown,
        fallKind: afterFall.lastImpact && afterFall.lastImpact.kind,
        barWidth: afterDirect.barWidth,
      };
    });
    report.bossDamage = bossDamage;
    // 摔伤要明显比"一发直怼"划算
    if (!bossDamage.towerIntact) problems.push('直怼那一发顺手把塔腿也打掉了，摔伤对照不成立');
    if (!(bossDamage.fall > bossDamage.direct * 1.6)) {
      problems.push(`摔伤没明显高于直怼（一发直怼 ${bossDamage.direct}，一次塌方 ${bossDamage.fall}）`);
    }

    // 开局能带爆奶蛋了：得确认"贴着炸"不能绕过 boss 的减伤，不然摔伤就不是主要解法了
    const bossBlast = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(10, 1234);
      window.__nai.skipIntro();
      await window.__still();
      const hp0 = window.__nai.bossInfo().hp;
      const probe = window.__nai.boomAtBoss();
      await wait(150);
      const info = window.__nai.bossInfo();
      return { hp0, probe, hpAfter: info.hp, k: info.blastK };
    });
    report.bossBlast = bossBlast;
    if (!(bossBlast.k > 0 && bossBlast.k < 1)) problems.push(`boss 没有爆炸折扣（blastK=${bossBlast.k}）`);
    if (!(bossBlast.probe.dmg > 0)) problems.push('爆炸打在 boss 身上没有掉血（折扣算过头了）');
    if (bossBlast.probe.dmg > bossDamage.fall * 0.6) {
      problems.push(`贴身爆炸对 boss 生效太多（${bossBlast.probe.dmg} 伤害，一次整层塌方才 ${bossDamage.fall}）`);
    }

    // boss 技能：每打出去 3 发奶蛋，喊一只奶蛙站到跟前 + 回 25% 血
    const bossSkill = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitAim = async () => {
        for (let i = 0; i < 60; i++) {
          if (window.__nai.state().state === 'aim') return true;
          await wait(40);
        }
        return false;
      };
      const missShot = async () => {          // 往天上打：不碰任何东西，只看 boss 的血量变化
        await waitAim();                      // 上一发结算完、新奶蛋上了弓才接着打，不然 shoot() 会被拒掉
        window.__nai.shoot(85, 1);
        await wait(60);
        window.__nai.forceEnd();
        await waitAim();
      };
      window.__nai.loadEndless(10, 1234);
      window.__nai.skipIntro();
      await window.__still();
      await window.__toBossStage();
      await window.__still();
      const maxHp = window.__nai.bossInfo().maxHp;
      // (a) 前两发：只记账，不召唤
      await missShot();
      await missShot();
      const afterTwo = window.__nai.bossInfo();
      // (b) 第三发：把血压到 100，看它回多少、叫不叫得来帮手
      window.__nai.hurtBoss(window.__nai.bossInfo().hp - 100);
      const lowHp = window.__nai.bossInfo().hp;
      const pigsBefore = window.__nai.state().pigsAlive;
      await missShot();
      const afterThree = window.__nai.bossInfo();
      const st = window.__nai.state();
      const summonPos = st.pigPositions[st.pigPositions.length - 1];
      const summonStage = st.pigStages[st.pigStages.length - 1];
      await wait(900);
      const settled = window.__nai.state();
      // (c) 快满血时：回血必须被封顶，不能溢出（先把血压到"只差 1 点满血"）
      window.__nai.hurtBoss(window.__nai.bossInfo().hp - (maxHp - 1));
      const nearFull = window.__nai.bossInfo().hp;
      await missShot();
      await missShot();
      await missShot();
      const capped = window.__nai.bossInfo();
      // (d) 第三只：同时存活的护卫有上限（2 只），不然塔倒了之后会变成"永远够不着 boss"的死局
      const pigsBefore3 = window.__nai.state().pigsAlive;
      await missShot();
      await missShot();
      await missShot();
      const third = window.__nai.bossInfo();
      const pigsAfter3 = window.__nai.state().pigsAlive;
      return {
        maxHp,
        twoShots: { shots: afterTwo.shots, summons: afterTwo.summons },
        lowHp,
        afterThree: { shots: afterThree.shots, summons: afterThree.summons, hp: afterThree.hp, x: afterThree.x },
        heal: afterThree.hp - lowHp,
        pigsBefore,
        pigsAfter: st.pigsAlive,
        summonPos,
        summonStage,
        summonHp: st.pigHp[st.pigHp.length - 1],
        settledHp: settled.pigHp[settled.pigHp.length - 1],
        nearFull,
        cappedHp: capped.hp,
        cappedSummons: capped.summons,
        thirdSummons: third.summons,
        thirdGuardDelta: pigsAfter3 - pigsBefore3,
      };
    });
    report.bossSkill = bossSkill;
    const wantHeal = Math.round(bossSkill.maxHp * 0.25);
    if (bossSkill.twoShots.summons !== 0) problems.push('boss 前两发就召唤了（应该每 3 发才来一次）');
    if (bossSkill.twoShots.shots !== 2) problems.push(`boss 的发射计数不对（两发之后记成 ${bossSkill.twoShots.shots}）`);
    if (bossSkill.afterThree.summons !== 1) problems.push('打到第 3 发 boss 没有召唤奶蛙');
    if (Math.abs(bossSkill.heal - wantHeal) > 2) problems.push(`boss 回血量不对（回了 ${bossSkill.heal}，25% 应该是 ${wantHeal}）`);
    if (bossSkill.pigsAfter !== bossSkill.pigsBefore + 1) problems.push('召唤没真的多出一只奶蛙');
    if (bossSkill.summonStage !== 1) problems.push(`召唤来的奶蛙不在 boss 那一段（stage=${bossSkill.summonStage}），那它就不会挡住通关`);
    if (!(bossSkill.summonPos && Math.abs(bossSkill.summonPos.y - 600) < 30)) {
      problems.push(`召唤的奶蛙没站在地面上（y=${bossSkill.summonPos && bossSkill.summonPos.y}）`);
    }
    if (bossSkill.summonPos && Math.abs(bossSkill.summonPos.x - bossSkill.afterThree.x) < 100) {
      problems.push('召唤的奶蛙叠在 boss 身上了');
    }
    if (!(bossSkill.summonPos && bossSkill.summonPos.x > 1200 && bossSkill.summonPos.x < 1900)) {
      problems.push(`召唤的奶蛙站位不对（x=${bossSkill.summonPos && bossSkill.summonPos.x}），应该在塔前那片空地`);
    }
    if (bossSkill.settledHp !== 85) problems.push(`召唤来的奶蛙出生就被压伤了（hp=${bossSkill.settledHp}）`);
    if (bossSkill.cappedHp !== bossSkill.maxHp) {
      problems.push(`回血没有被封顶（${bossSkill.nearFull} → ${bossSkill.cappedHp}，满血是 ${bossSkill.maxHp}）`);
    }
    if (bossSkill.cappedSummons !== 2) problems.push(`第 6 发时应该召唤第 2 只（现在是 ${bossSkill.cappedSummons}）`);
    if (bossSkill.thirdSummons !== 3) problems.push(`第 9 发时应该记到第 3 次召唤（现在是 ${bossSkill.thirdSummons}）`);
    if (bossSkill.thirdGuardDelta !== 0) {
      problems.push(`第 3 次召唤又多放了护卫（场上 +${bossSkill.thirdGuardDelta}），会把 boss 堵死`);
    }
    // 注：血量整体抬高之后（见 levels.js 的注释），"一次塌方"占满血的比例从六成降到三成左右，
    // 但**相对关系**没变：它仍是最大的单发（≥2 倍直怼），而且只靠平射是打不完的。
    if (bossDamage.fall < bossDamage.maxHp * 0.25) {
      problems.push(`一次整层塌掉的血太少（${bossDamage.fall}/${bossDamage.maxHp}），摔伤撑不起主要解法`);
    }
    if (!(bossDamage.fall > bossDamage.direct * 2)) {
      problems.push(`塌方没到直怼的 2 倍（塌方 ${bossDamage.fall}，直怼 ${bossDamage.direct}）`);
    }
    if (!/^\d/.test(String(bossDamage.barWidth))) problems.push('boss 血条没跟着掉血更新');
    await shot(page, '14-boss-fall.png');

    // 打死 boss：大笑飞出 + 3 万分
    const bossKill = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const sleep16 = async (n) => { for (let i = 0; i < n; i++) await wait(16); };
      window.__nai.loadEndless(10, 1234);
      window.__nai.skipIntro();
      await window.__still();
      await window.__toBossStage();
      await window.__still();
      const before = window.__nai.state().score;
      // 会打塔的玩家：先打断底层腿（整层塌），再打上层腿（第二次塌）——
      // 塔只塌得了一次的话是打不完的，这关的难度就在"塌两次 + 补刀"
      const falls = [];
      for (let k = 0; k < 2; k++) {
        window.__nai.shoot(6, 1);
        for (let i = 0; i < 300; i++) {
          await wait(16);
          if (window.__nai.state().state !== 'fly') break;
        }
        window.__nai.breakTower();
        await wait(2600);
        falls.push(window.__nai.bossInfo().hp);
      }
      const hpAfterFall = falls[0];
      // 然后在"它回血之前"补刀：10° 这条线能越过废墟打到地上的 boss（实测 6~18° 都行，24° 会飞过头）
      let shots = 0;
      for (let k = 0; k < 10; k++) {
        const info = window.__nai.bossInfo();
        if (!info.boss || info.hp <= 0 || window.__nai.state().state === 'over') break;
        window.__nai.shoot(10, 1);
        for (let i = 0; i < 260; i++) {
          await wait(16);
          if (window.__nai.state().state !== 'fly') break;
        }
        await wait(700);
        shots += 1;
      }
      await sleep16(70);
      return {
        before,
        after: window.__nai.state().score,
        boss: window.__nai.bossInfo(),
        state: window.__nai.state().state,
        hpAfterFall,
        falls,
        shots,
      };
    });
    report.bossKill = bossKill;
    if (bossKill.boss.boss) problems.push('boss 打不死（血量还没清零）');
    if (bossKill.after - bossKill.before < 30000) problems.push(`boss 击杀分数不对（${bossKill.after - bossKill.before}）`);
    await shot(page, '15-boss-dead.png');

    // 容错：boss 关打不过要给一次重打机会
    const bossRetry = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(10, 1234);
      window.__nai.skipIntro();
      await window.__still();
      const hpBefore = window.__nai.bossInfo().hp;
      window.__nai.drainBirds();
      await wait(1000);
      const failed = window.__nai.state().state;
      const retryUsed = window.__nai.bossInfo().retryUsed;
      const note = document.getElementById('endTitle').textContent;
      window.__nai.__retryShotReady = true;
      window.__nai.clickAgain();
      await wait(700);
      window.__nai.skipIntro();
      await wait(300);
      const after = window.__nai.bossInfo();
      const st = window.__nai.state();
      window.__nai.drainBirds();
      await wait(1000);
      return {
        failed,
        retryUsed,
        note,
        hpBefore,
        hpAfterRetry: after.hp,
        birdsAfterRetry: st.birdQueue.length + 1,
        stageAfterRetry: st.stage,
        finalState: window.__nai.state().state,
        finalTitle: document.getElementById('endTitle').textContent,
      };
    });
    report.bossRetry = bossRetry;
    if (bossRetry.failed !== 'over') problems.push('boss 关打不过时没有进结算');
    if (!bossRetry.retryUsed) problems.push('boss 关没有给重打机会');
    if (bossRetry.hpAfterRetry !== bossRetry.hpBefore) problems.push(`重打之后 boss 血量没重置（${bossRetry.hpAfterRetry}/${bossRetry.hpBefore}）`);
    if (bossRetry.birdsAfterRetry < 8) problems.push(`重打之后奶蛋没补满（${bossRetry.birdsAfterRetry} 发）`);
    if (bossRetry.stageAfterRetry !== 1) problems.push(`重打之后没有从前哨那一段重新开始（第 ${bossRetry.stageAfterRetry} 段）`);
    if (bossRetry.finalState !== 'over' || /还站着/.test(bossRetry.finalTitle)) problems.push('第二次失败之后还在给重打机会（应该结束整局）');
    await shot(page, '16-boss-retry.png');

    // ---------------------------------------------------------- 无尽模式：推进与失败
    const endlessFlow = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(1, 999);
      const log = [];
      for (let k = 0; k < 3; k++) {
        const s = window.__nai.state();
        log.push({ level: s.endlessLevel, pigs: s.pigsAlive, blocks: s.blocksAlive, birds: s.birdQueue.length + 1, score: s.score, name: s.levelName });
        window.__nai.forceWin();
        await wait(3400);
      }
      const mid = window.__nai.state();
      // 现在把这一关打空，看会不会判失败
      for (let k = 0; k < 8; k++) {
        while (window.__nai.state().state === 'intro') window.__nai.skipIntro();
        if (window.__nai.state().state === 'over') break;
        window.__nai.shoot(178, 0.8);
        for (let i = 0; i < 700; i++) {
          await wait(16);
          const s = window.__nai.state();
          if (s.state === 'over' || s.state === 'aim' || s.state === 'clearing') break;
        }
        await wait(800);
      }
      return { log, mid: { level: mid.endlessLevel, score: mid.totalScore }, end: window.__nai.state() };
    });
    report.endlessFlow = {
      levels: endlessFlow.log,
      reached: endlessFlow.mid.level,
      score: endlessFlow.mid.score,
      endState: endlessFlow.end.state,
      endNote: endlessFlow.end.endlessLevel,
    };
    if (endlessFlow.mid.level !== 4) problems.push(`无尽模式通关三关后应该在第 4 关，实际第 ${endlessFlow.mid.level} 关`);
    if (endlessFlow.score <= 0) problems.push('无尽模式没有累计分数');
    if (endlessFlow.end.state !== 'over') problems.push('无尽模式奶蛋打完没有结束对局');
    await shot(page, '10-endless-over.png');

    // ---------------------------------------------------------- 开局选蛋：一局只问第 1 关
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__nai && window.__nai.imagesReady(), null, { timeout: 20000 });
    await installStill(page); // reload 会把注入的小工具冲掉，重新装一遍
    await page.click('#btnEndless');
    await sleep(320);
    const ep1 = await page.evaluate(() => {
      const s = window.__nai.state();
      const base = window.__nai.endless(s.endlessLevel, s.matchSeed).birds.length;
      return { state: s.state, shown: s.pickShown, birdsLeft: s.birdsLeft, expect: base + 1, level: s.endlessLevel };
    });
    report.endlessPick = { first: ep1 };
    await shot(page, '09b-pick-endless.png');
    if (ep1.state !== 'pick' || !ep1.shown) problems.push('无尽模式第 1 关没有弹开局选蛋面板');
    if (ep1.birdsLeft !== ep1.expect) problems.push(`无尽第 1 关面板上该显示 ${ep1.expect} 发，实际 ${ep1.birdsLeft}`);
    // 面板上点画布空白处 / 敲空格都不该把它点没
    await page.mouse.click(260, 700);
    await page.keyboard.press('Space');
    await sleep(200);
    const stillPicking = await page.evaluate(() => window.__nai.state());
    if (stillPicking.state !== 'pick') problems.push(`在选蛋面板上乱点就把面板跳过了（状态变成 ${stillPicking.state}）`);
    await page.locator('#pickRoster .card').nth(3).click(); // 第 4 张 = 爆奶蛋
    await sleep(220);
    const er1 = await page.evaluate(() => window.__nai.state());
    if (er1.currentBird !== 'bomb') problems.push(`无尽模式挑的奶蛋没排到队首（首发是 ${er1.currentBird}）`);
    if (er1.pickChoice !== 'bomb') problems.push(`没有记住这一局挑的奶蛋（pickChoice=${er1.pickChoice}）`);
    await page.evaluate(() => window.__nai.skipIntro());
    const ep2 = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.forceWin();
      await wait(3800);
      const s = window.__nai.state();
      const base = window.__nai.endless(s.endlessLevel, s.matchSeed).birds.length;
      return {
        state: s.state,
        shown: s.pickShown,
        level: s.endlessLevel,
        birdsLeft: s.birdsLeft,
        expect: base + 1,
        lead: s.currentBird,
        levelBirds: s.levelBirds,
      };
    });
    report.endlessPick.second = ep2;
    if (ep2.level !== 2) problems.push(`无尽模式清场后没进第 2 关（现在第 ${ep2.level} 关）`);
    if (ep2.shown || ep2.state === 'pick') problems.push('选过一次之后，无尽模式的下一关还在弹选蛋面板（应该只在第 1 关问）');
    if (ep2.birdsLeft !== ep2.expect) problems.push(`无尽第 2 关该有 ${ep2.expect} 发奶蛋，实际 ${ep2.birdsLeft}`);
    if (ep2.lead !== ep2.levelBirds[0]) problems.push('第 2 关的首发不是关卡原本的那颗');
    if (ep2.levelBirds[ep2.levelBirds.length - 1] !== 'bomb') {
      problems.push(`第 2 关没有自动带上开局挑的爆奶蛋（阵容 ${ep2.levelBirds.join('、')}）`);
    }

    // ---------------------------------------------------------- 点等候区里的奶蛋 = 让它先上弓
    const qs = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__nai.loadEndless(6, 4242);
      window.__nai.skipIntro();
      await window.__still();
      const s = window.__nai.state();
      return { slots: s.queueSlots, cur: s.currentBird, birdsLeft: s.birdsLeft, levelBirds: s.levelBirds };
    });
    report.queueClick = { before: { cur: qs.cur, slots: qs.slots.map((s) => s.type) } };
    const target = qs.slots[2];
    if (!target) problems.push('等候区里只有两颗奶蛋，点选测试没得做');
    else {
      const at = await toClient(target.x, target.y - 30);
      await page.mouse.move(at.x, at.y);   // 先悬停：鼠标要变成"能点"的手型
      await sleep(160);
      const hv = await page.evaluate(() => ({ hover: window.__nai.state().queueHover, cursor: document.getElementById('game').style.cursor }));
      if (hv.hover !== 2) problems.push(`鼠标悬到等候区第 3 颗上没认出可点（queueHover=${hv.hover}）`);
      if (hv.cursor !== 'pointer') problems.push('悬在等候区的奶蛋上时光标没变成手型');
      await page.mouse.click(at.x, at.y);
      await sleep(260);
      const after = await page.evaluate(() => {
        const s = window.__nai.state();
        return { cur: s.currentBird, queue: s.birdQueue, birdsLeft: s.birdsLeft, levelBirds: s.levelBirds };
      });
      report.queueClick.after = { cur: after.cur, queue: after.queue };
      if (after.cur !== target.type) problems.push(`点了等候区的 ${target.type} 之后没上弓（现在架上的是 ${after.cur}）`);
      if (after.queue[2] !== qs.cur) problems.push(`换弹之后原来那颗没退回队里（队里是 ${after.queue.join('、')}）`);
      if (after.birdsLeft !== qs.birdsLeft) problems.push(`换弹把弹药数改了（${qs.birdsLeft} → ${after.birdsLeft}）`);
      if (after.levelBirds.length !== qs.levelBirds.length) problems.push('换弹把这一关的阵容改了');
      await shot(page, '09c-queue-swap.png');
    }

    // ---------------------------------------------------------- file:// 直开
    for (const [label, target, file] of [
      ['源码版', path.join(root, 'index.html'), '11-file-source.png'],
      ['单文件版', path.join(root, 'dist', '奶蛋弹弓-单文件.html'), '12-file-single.png'],
    ]) {
      try {
        await fs.access(target);
      } catch (e) {
        if (label === '单文件版') { problems.push('单文件版还没打包，先跑 npm run build'); continue; }
      }
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 760 } });
      p2.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
      p2.on('console', (m) => { if (m.type() === 'error') problems.push(`[${label}] console.error: ${m.text()}`); });
      await p2.goto(pathToFileURL(target).href, { waitUntil: 'load' });
      await p2.waitForFunction(() => window.__nai && window.__nai.imagesReady(), null, { timeout: 20000 });
      const status = await p2.evaluate(() => ({
        images: window.__nai.imageStatus(),
        canvas: document.querySelector('canvas').width > 0,
        roster: document.querySelectorAll('#roster .card').length,
      }));
      await p2.click('#btnStart');
      await p2.locator('#pickRoster .card').nth(0).click(); // 单文件版也要能走完"开局选蛋"
      await sleep(700);
      const st = await p2.evaluate(() => window.__nai.state());
      await p2.screenshot({ path: path.join(shots, file) });
      report.shots.push(file);
      const imagesOk = Object.values(status.images).every((w) => w > 0);
      report[label] = { canvas: status.canvas, roster: status.roster, images: imagesOk, state: st.state };
      if (!imagesOk || !status.canvas || status.roster < 8) problems.push(`[${label}] file:// 直接打开时初始化不完整`);
      if (st.state !== 'intro' && st.state !== 'aim') problems.push(`[${label}] 点了开始之后状态不对（${st.state}）`);
      await p2.close();
    }

    report.ok = problems.length === 0;
    await fs.writeFile(path.join(shots, 'verify-report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          problems,
          intro: report.introStart && report.introEnemy && report.introEnd,
          initialDrift: report.initialDrift,
          sweepKillers: report.sweepSummary && report.sweepSummary.anglesThatKill,
          threeStar: twoShot.filter((t) => t.cleared).map((t) => `${t.line}=${t.score}`),
          skills: skillTests.map((t) => `${t.type}:${t.used ? '技能生效' : '无技能'}`),
          endlessRamp: report.endlessRamp,
          genBad: badGen.map((g) => `${g.seed}/${g.level}:${g.drift}px`),
          endless: report.endlessFlow,
        },
        null,
        2
      )
    );
    if (!report.ok) process.exitCode = 1;
  } catch (e) {
    problems.push('致命错误: ' + e.message);
    console.error(JSON.stringify({ ok: false, problems }, null, 2));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
};

main();
