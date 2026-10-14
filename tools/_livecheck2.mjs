/** 临时脚本：线上验证 boss 笑声素材（能否取到、能否播、单文件版同理）。跑完就删。 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'https://busgm666-cloud.github.io/naidan-slingshot/';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--mute-audio', '--disable-gpu', '--disable-quic'],   // github.io 的 h3 在国内经常被干扰，强制走 TCP
});

const check = async (label, url) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const bad = [];
  await page.addInitScript(() => {
    window.__bootErrors = [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__bootErrors.push('unhandledrejection: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
    });
    window.addEventListener('error', (e) => {
      window.__bootErrors.push('error: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
    });
  });
  page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') bad.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__nai && window.__nai.imagesReady(), null, { timeout: 30000 });
  // imagesReady() 只说明 Image 对象建好了；真正的启动回调要等 13 张图全部 load 完。
  const bootT0 = Date.now();
  await page.waitForFunction(() => document.querySelectorAll('#roster .card').length > 0, null, { timeout: 90000 });
  const bootMs = Date.now() - bootT0;
  // 初始化回调到底跑完没有：角色卡 / 标题页版本号 / 状态 / 音频元素
  const boot = await page.evaluate(() => ({
    rosterCards: document.querySelectorAll('#roster .card').length,
    stampText: document.getElementById('buildStamp') ? document.getElementById('buildStamp').textContent : '(没有这个元素)',
    gameState: window.__nai.state().state,
    hasInlineAudio: typeof window.INLINE_AUDIO,
    laugh: window.__nai.state().bossLaugh,
    audioTags: document.querySelectorAll('audio').length,
    birds: typeof window.BIRDS === 'object' && window.BIRDS ? Object.keys(window.BIRDS).length : String(window.BIRDS),
    levels: typeof window.LEVEL1,
    matter: typeof window.Matter,
    audioKit: typeof window.AudioKit,
    bootErrors: window.__bootErrors,
  }));
  console.log(`  启动自检: ${JSON.stringify(boot)}`);
  console.log(`  启动耗时（等 13 张图加载完）: ${bootMs}ms`);
  await page.waitForFunction(() => window.__nai.state().bossLaugh.ready >= 2, null, { timeout: 15000 }).catch(() => {});
  // 真打一次：把 boss 拉到 boss 段，直接打死看它响不响
  const out = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__nai.loadEndless(10, 1234);
    window.__nai.skipIntro();
    await wait(500);
    window.__nai.clearStage();
    for (let i = 0; i < 200; i++) { await wait(50); const s = window.__nai.state(); if (s.state === 'aim' && s.stage === s.stageCount) break; }
    const before = window.__nai.state().bossLaugh;
    window.__nai.hurtBoss(9999);
    await wait(1200);
    return { build: window.__nai.build, before, after: window.__nai.state().bossLaugh };
  });
  console.log(`【${label}】${url}`);
  console.log(`  版本: ${out.build}`);
  console.log(`  笑声素材: 击杀前 ready=${out.before.ready} → 击杀后 attempts=${out.after.attempts} plays=${out.after.plays}`);
  console.log(bad.length ? `  ❌ ${bad.length} 条报错: ${bad.slice(0, 3).join(' | ')}` : '  ✅ 无报错 / 无 404');
  await page.close();
};

await check('本地单文件版', pathToFileURL(path.join(root, 'dist', '奶蛋弹弓-单文件.html')).href);
await check('线上站点', SITE);
await browser.close();
