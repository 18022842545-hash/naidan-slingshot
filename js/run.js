/**
 * 奶龙快跑：地铁酷跑式的三车道无尽跑酷（伪 3D 透视）。
 * 跟弹弓玩法完全分开：自己的画布、自己的循环、自己的 DOM，只借用 assets/ 里的立绘和 AudioKit 音效。
 * 入口是标题页的「奶龙快跑」按钮（或 #run 链接）；打开时盖在整个页面上，关掉就回到标题页。
 *
 * 玩法：奶蛋沿着三条轨道往前冲，越跑越快。
 *   换道（← → / A D / 左右滑）      跳（↑ / W / 空格 / 上滑 / 点一下）      翻滚（↓ / S / 下滑；空中按 = 急降）
 *   矮栏要跳、高栏要滚、车厢要换道；车厢前面有斜坡的可以直接跑上车顶
 *   踩奶蛙脑袋 +100；从侧面蹭到东西会踉跄一下、奶皇追上来，追着的时候再蹭一次就被抓
 *   泡泡道具：冲刺（飞到天上收奶滴）/ 变胖成大奶蛙（撞碎障碍）/ 奶泡磁铁 / 分身护盾（免死一次）
 *
 * 坐标：x 向右（三条道在 -LANE_W / 0 / +LANE_W），y 向上，z 向前；世界里的东西存绝对 z（wz），
 * 奶蛋永远在 z = dist，镜头在它身后 camZ、高 camY 处往前看。
 */
(() => {
  const H = 540;
  const VIEW_MIN = 960;
  const VIEW_MAX = 1600;
  const FAR = 110;
  const LANE_W = 2;
  const STEP = 1000 / 60;
  const GRAVITY = 0.022;
  const JUMP_V = 0.27;
  const PLAYER_H = 1.5;
  const ROLL_H = 0.7;
  const ROLL_FRAMES = 38;
  const TRAIN_H = 2.4;
  const BEST_KEY = 'naidan-run-best-v2';

  const POWERS = {
    dash: { sprite: 'naidan_dash', name: '冲刺', tip: '冲刺！飞上天收奶滴', frames: 300, color: '#ff8a5b' },
    heavy: { sprite: 'naiwa_happy', name: '大奶蛙', tip: '变身大奶蛙！一路撞碎障碍', frames: 420, color: '#d9902f' },
    milk: { sprite: 'naidan_milk', name: '奶泡磁铁', tip: '奶泡磁铁！奶滴自己飞过来', frames: 540, color: '#5fb8e8' },
    split: { sprite: 'naidan_split', name: '分身护盾', tip: '分身护盾！免死一次', frames: 0, color: '#9b7be0' },
  };

  // ---------------------------------------------------------------- 素材 / 工具
  const ASSET_BASE = window.ASSET_BASE || 'assets/';
  const SPRITES = ['naidan_idle', 'naidan_blink', 'naidan_dash', 'naidan_heavy', 'naidan_milk', 'naidan_split', 'naiwa_angry', 'naiwa_happy', 'boss_idle', 'boss_laugh'];
  const IMG = {};
  const loadSprites = () =>
    SPRITES.forEach((k) => {
      if (IMG[k]) return;
      const im = new Image();
      im.src = (window.INLINE_ASSETS && window.INLINE_ASSETS[k]) || ASSET_BASE + k + '.png';
      IMG[k] = im;
    });
  const sfx = (name, ...args) => {
    try {
      if (window.AudioKit && typeof window.AudioKit[name] === 'function') window.AudioKit[name](...args);
    } catch (e) { /* 音效出错不影响游戏 */ }
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const loadBest = () => {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
  };
  const saveBest = (v) => {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* 隐私模式存不了就算了 */ }
  };

  // ---------------------------------------------------------------- DOM
  const css = `
  #runScreen { position: fixed; inset: 0; z-index: 60; background: #3a2a1f; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
  #runScreen canvas { box-shadow: none; border-radius: 0; touch-action: none; }
  #runHud { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; }
  #runScreen .iconBtn { width: auto; padding: 0 12px; }
  #runPanelWrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(58,42,31,.28); }
  #runPanel .keys { display: grid; grid-template-columns: auto auto; gap: 4px 14px; justify-content: center; text-align: left; font-size: 14px; color: #6b5444; margin: 10px 0; }
  #runPanel .keys b { color: var(--jam-dark); }
  #runPanel .stats { display: flex; gap: 18px; justify-content: center; font-size: 14px; color: #6b5444; }
  #runPanel .stats b { display: block; font-size: 20px; color: var(--ink); }
  #runPanel .rec { color: #e2632f; font-weight: 800; }
  #runPanel .submit { display: flex; gap: 8px; justify-content: center; margin-top: 14px; }
  #runPanel .submit input { width: 150px; padding: 8px 12px; border-radius: 12px; border: 2px solid rgba(74,53,39,.2); font-size: 15px; font-family: inherit; color: var(--ink); background: #fff; }
  #runPanel .submit button { padding: 8px 14px; font-size: 14px; }
  #runPanel .msg { min-height: 1.4em; font-size: 13px; margin: 6px 0 0; }
  #runPanel .tabs { display: flex; gap: 8px; justify-content: center; margin-bottom: 8px; }
  #runPanel .tabs button { padding: 6px 16px; font-size: 14px; }
  #runPanel .board { list-style: none; margin: 0; padding: 0; max-height: min(46vh, 420px); overflow-y: auto; min-width: min(78vw, 360px); text-align: left; }
  #runPanel .board li { display: grid; grid-template-columns: 2.2em 1fr auto 4.8em; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 10px; font-size: 14px; color: #6b5444; }
  #runPanel .board li:nth-child(odd) { background: rgba(74,53,39,.05); }
  #runPanel .board li.me { background: rgba(255,138,91,.18); }
  #runPanel .board .rk { font-weight: 800; color: var(--jam-dark); text-align: center; }
  #runPanel .board .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
  #runPanel .board .sc { font-weight: 800; color: var(--ink); }
  #runPanel .board .mt { font-size: 12px; text-align: right; }
  `;

  let el = null;
  const buildDom = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'runScreen';
    root.className = 'hide';
    root.innerHTML = `
      <canvas id="runCanvas"></canvas>
      <div id="runHud">
        <button class="iconBtn small" id="runBack" title="回主菜单">← 主菜单</button>
        <button class="iconBtn small" id="runPause" title="暂停（P）">⏸</button>
        <button class="iconBtn small" id="runSound" title="音效开关">🔊</button>
      </div>
      <div id="runPanelWrap"><div class="panel" id="runPanel"></div></div>`;
    document.body.appendChild(root);
    const $ = (id) => document.getElementById(id);
    el = {
      root, canvas: $('runCanvas'), back: $('runBack'), pause: $('runPause'), sound: $('runSound'),
      wrap: $('runPanelWrap'), panel: $('runPanel'),
    };
    ctx = el.canvas.getContext('2d');
  };

  // ---------------------------------------------------------------- 状态
  let ctx = null;
  let viewW = VIEW_MIN;
  let viewH = H;
  let horizon = 150;
  let focal = 520;
  let camY = 3.2;
  let camZ = -5.5;
  let nearZ = camZ + 0.9;
  let scale = 1;
  let dpr = 1;
  let active = false;
  let phase = 'ready'; // ready | run | pause | dead
  let raf = 0;
  let last = 0;
  let acc = 0;
  let g = null;
  let panelPrimary = null;

  const newGame = () => ({
    t: 0,
    dist: 0,
    speed: 0.3,
    coinCount: 0,
    stomps: 0,
    smashes: 0,
    p: { lane: 0, x: 0, prevX: 0, fromLane: 0, y: 0, vy: 0, onGround: true, roll: 0, invuln: 0, land: 0, spin: 0, morph: 0 },
    power: { dash: 0, heavy: 0, milk: 0, shield: false },
    gap: 0.4,       // 暗黑奶皇离你多远：0 = 被抓，1 = 甩得老远；开局就在身后
    slow: 0,        // 减速剩余帧数（踩进泥坑 / 撞上路障锥）
    obstacles: [],  // { type: low|high|train|ramp|frog, lane, wz, len, h, vz }
    coins: [],
    items: [],
    fx: [],
    debris: [],
    genZ: 40,
    nextItem: 260,
    shake: 0,
    toast: null,
    deathT: 0,
    deathReason: '',
    milestone: 0,
  });

  const meters = () => Math.floor(g.dist);
  const score = () => meters() + g.coinCount * 10 + g.stomps * 100 + g.smashes * 50;
  const toast = (text, color = '#e2632f') => { g.toast = { text, color, t: 110 }; };
  const laneX = (lane) => lane * LANE_W;
  const difficulty = () => clamp(g.dist / 3000, 0, 1);

  // ---------------------------------------------------------------- 关卡生成（一排一排往前摆）
  const coinLine = (lane, wz, n, y = 0.6, gap = 2.4) => {
    for (let i = 0; i < n; i++) g.coins.push({ lane, wz: wz + i * gap, y });
  };
  const coinArc = (lane, wz, top = 2.1) => {
    for (let i = 0; i < 5; i++) g.coins.push({ lane, wz: wz - 3 + i * 1.5, y: 0.6 + Math.sin((i / 4) * Math.PI) * (top - 0.6) });
  };
  const obstacle = (type, lane, wz, extra = {}) => {
    const base = {
      low: { len: 0.5, h: 1.0 },
      high: { len: 0.5, h: 2.3, bottom: 1.05 },
      frog: { len: 0.7, h: 0.95 },
      puddle: { len: 3.4, h: 0.05 },
      cone: { len: 0.5, h: 0.8 },
      train: { len: 14, h: TRAIN_H },
      ramp: { len: 6, h: TRAIN_H },
    }[type];
    g.obstacles.push({ type, lane, wz, vz: 0, ...base, ...extra });
  };
  const gapAfterTrain = () => 10 + g.speed * 50;
  const gapShort = () => 9 + g.speed * 28;
  const otherLanes = (lane) => [-1, 0, 1].filter((l) => l !== lane);

  const PATTERNS = [
    { w: 3, min: 0.04, make: (z) => {
      const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5).slice(0, randInt(1, 2));
      lanes.forEach((l) => { obstacle('puddle', l, z); coinArc(l, z + 1.7); });
      return 4 + gapShort();
    } },
    { w: 2, min: 0.1, make: (z) => {
      const free = randInt(-1, 1);
      otherLanes(free).forEach((l) => { obstacle('cone', l, z); obstacle('cone', l, z + 3); });
      coinLine(free, z - 2, 4);
      return 4 + gapShort();
    } },
    { w: 2, min: 0, make: (z) => {
      coinLine(randInt(-1, 1), z, 8);
      return 8 * 2.4 + gapShort();
    } },
    { w: 4, min: 0, make: (z) => {
      const lane = randInt(-1, 1);
      const len = rand(12, 20);
      const ramp = Math.random() < 0.4;
      if (ramp) {
        obstacle('ramp', lane, z);
        obstacle('train', lane, z + 6, { len });
        coinLine(lane, z + 7, Math.floor(len / 2.4), TRAIN_H + 0.6);
      } else {
        obstacle('train', lane, z, { len });
        coinLine(pick(otherLanes(lane)), z, 6);
      }
      return (ramp ? 6 : 0) + len + gapAfterTrain();
    } },
    { w: 3, min: 0.05, make: (z) => {
      const free = randInt(-1, 1);
      const len = rand(12, 18);
      otherLanes(free).forEach((l, i) => {
        if (i === 0 && Math.random() < 0.35) {
          obstacle('ramp', l, z);
          obstacle('train', l, z + 6, { len });
        } else {
          obstacle('train', l, z + rand(0, 4), { len });
        }
      });
      if (difficulty() > 0.3 && Math.random() < 0.5) {
        obstacle(pick(['low', 'high', 'puddle']), free, z + len * 0.5);
      } else {
        coinLine(free, z, Math.floor(len / 2.4));
      }
      return 10 + len + gapAfterTrain();
    } },
    { w: 3, min: 0, make: (z) => {
      const kinds = difficulty() > 0.15 ? ['low', 'high', 'frog'] : ['low', 'high'];
      const lanes = difficulty() > 0.2 ? [-1, 0, 1] : [randInt(-1, 1)];
      lanes.forEach((l) => {
        const k = pick(kinds);
        obstacle(k, l, z);
        if (k === 'low' || k === 'frog') coinArc(l, z);
      });
      return gapShort();
    } },
    { w: 2, min: 0.25, make: (z) => {
      const lane = randInt(-1, 1);
      obstacle('train', lane, z + 30, { len: 12, vz: -(0.1 + difficulty() * 0.08), moving: true });
      coinLine(pick(otherLanes(lane)), z, 10);
      return 30 + 12 + gapAfterTrain();
    } },
    { w: 2, min: 0.1, make: (z) => {
      const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5).slice(0, randInt(1, 2));
      lanes.forEach((l, i) => obstacle('frog', l, z + i * 4));
      coinLine(lanes[0], z + 1.5, 3, 1.9, 1.5);
      return 8 + gapShort();
    } },
  ];

  const generate = () => {
    while (g.genZ < g.dist + FAR) {
      if (g.genZ >= g.nextItem) {
        g.items.push({ lane: randInt(-1, 1), wz: g.genZ + 4, type: pick(Object.keys(POWERS)) });
        g.genZ += 14;
        g.nextItem = g.genZ + rand(320, 520);
        continue;
      }
      const d = difficulty();
      const pool = PATTERNS.filter((p) => p.min <= d);
      let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
      let pat = pool[0];
      for (const p of pool) { r -= p.w; if (r <= 0) { pat = p; break; } }
      g.genZ += pat.make(g.genZ);
    }
  };

  // ---------------------------------------------------------------- 玩家动作
  const changeLane = (dir) => {
    const P = g.p;
    const next = clamp(P.lane + dir, -1, 1);
    if (next === P.lane) {
      g.shake = 4;
      sfx('thud', 0.2);
      return;
    }
    P.fromLane = P.lane;
    P.lane = next;
    sfx('stretch', 0.3);
  };
  const jump = () => {
    const P = g.p;
    if (!P.onGround || g.power.dash > 0) return;
    P.vy = JUMP_V * (g.power.heavy > 0 ? 1.08 : 1);
    P.onGround = false;
    P.roll = 0;
    sfx('launch');
  };
  const roll = () => {
    const P = g.p;
    if (g.power.dash > 0) return;
    if (!P.onGround) P.vy = Math.min(P.vy, -0.42); // 空中按下 = 急降，落地接着滚
    P.roll = ROLL_FRAMES;
    sfx('plop');
  };

  // ---------------------------------------------------------------- 特效
  const puff = (x, y, wz, n, color) => {
    for (let i = 0; i < n; i++) {
      g.fx.push({ x: x + rand(-0.4, 0.4), y, wz, vx: rand(-0.03, 0.03), vy: rand(0.02, 0.06), vz: rand(-0.05, 0.05), r: rand(0.12, 0.25), life: 1, decay: rand(0.03, 0.05), color });
    }
  };
  const sparkle = (x, y, wz, color = '#fff') => {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      g.fx.push({ x, y, wz, vx: Math.cos(a) * 0.05, vy: Math.sin(a) * 0.05 + 0.02, vz: g.speed * 0.6, r: 0.1, life: 1, decay: 0.06, color });
    }
  };
  const smash = (o) => {
    o.dead = true;
    if (o.type !== 'cone') g.smashes++;
    g.shake = 10;
    if (o.type === 'frog') {
      g.debris.push({ kind: 'frog', x: laneX(o.lane), y: 0, wz: g.dist + 1, vx: rand(-0.1, 0.1), vy: 0.32, vz: 0.6, rot: 0, vr: rand(0.15, 0.3) });
      sfx('pop');
    } else {
      const n = o.type === 'train' ? 6 : 3;
      for (let i = 0; i < n; i++) {
        g.debris.push({ kind: o.type, x: laneX(o.lane) + rand(-0.6, 0.6), y: rand(0.3, o.h), wz: g.dist + 1, vx: rand(-0.12, 0.12), vy: rand(0.15, 0.35), vz: rand(0.5, 0.9), rot: 0, vr: rand(-0.3, 0.3) });
      }
      // 车厢被撞碎就整列消失，免得变胖结束时身子还卡在车厢里
      sfx(o.type === 'train' || o.type === 'ramp' ? 'stone' : 'crack');
    }
  };

  const die = (reason) => {
    if (phase !== 'run') return;
    phase = 'dead';
    g.deathReason = reason;
    g.deathT = 0;
    g.shake = 18;
    g.gap = 0;
    sfx('lose');
    sfx('laugh');
  };

  /** 正面撞上：道具能扛就扛，扛不住就倒 */
  const crash = (o, reason) => {
    const P = g.p;
    if (g.power.dash > 0 || g.power.heavy > 0) return smash(o);
    if (P.invuln > 0) return;
    if (g.power.shield) {
      g.power.shield = false;
      P.invuln = 90;
      smash(o);
      sfx('glass');
      toast('护盾碎了！', '#9b7be0');
      return;
    }
    die(reason);
  };

  /** 侧面蹭到：弹回原来那条道，奶皇追上来；追着的时候再蹭一次就被抓 */
  const stumble = () => {
    const P = g.p;
    if (g.power.dash > 0 || g.power.heavy > 0 || P.invuln > 0) return;
    if (g.gap < 0.35) {
      die('被暗黑奶皇抓住了');
      return;
    }
    P.lane = P.fromLane;
    P.x = P.prevX;
    g.gap = 0.12;
    g.shake = 8;
    P.invuln = 30;
    sfx('thud', 0.6);
    sfx('roar');
    toast('小心！暗黑奶皇追上来了', '#7b2d8e');
  };

  const activate = (type) => {
    const def = POWERS[type];
    if (type === 'split') g.power.shield = true;
    else g.power[type] = def.frames;
    if (type === 'heavy') { g.p.morph = 20; puff(g.p.x, 0.8, g.dist + 0.3, 12, '#ffe58a'); sfx('roar'); }
    if (type === 'dash') {
      g.p.roll = 0;
      // 天上铺一条奶滴给它收
      for (let i = 0; i < 28; i++) g.coins.push({ lane: [-1, 0, 1][Math.floor(i / 7) % 3], wz: g.dist + 10 + i * 2.8, y: 3.8, sky: true });
      sfx('dash');
    } else {
      sfx('levelUp');
    }
    toast(def.tip, def.color);
  };

  // ---------------------------------------------------------------- 每帧逻辑
  const step = () => {
    g.t++;
    const P = g.p;
    const pw = g.power;

    if (phase === 'dead') {
      g.deathT++;
      stepFx();
      if (g.deathT === 70) showDead();
      return;
    }

    const base = 0.3 + 0.32 * (1 - Math.exp(-g.dist / 2500));
    g.speed = base * (pw.dash > 0 ? 1.6 : 1) * (g.slow > 0 && pw.dash <= 0 ? 0.55 : 1);
    g.dist += g.speed;

    if (Math.floor(g.dist / 500) > g.milestone) {
      g.milestone = Math.floor(g.dist / 500);
      toast(`${g.milestone * 500} 米！越跑越快了`);
      sfx('levelUp');
    }

    if (pw.dash > 0 && --pw.dash === 0) { P.invuln = 90; P.onGround = false; P.vy = 0; }
    if (pw.heavy > 0 && --pw.heavy === 0) { P.invuln = 60; P.morph = 20; puff(P.x, 0.8, g.dist + 0.3, 10, '#ffe58a'); toast('变回奶蛋了', '#d9902f'); }
    if (pw.milk > 0) pw.milk--;
    if (P.invuln > 0) P.invuln--;
    if (P.morph > 0) P.morph--;
    if (P.land > 0) P.land--;
    // 追兵：正常跑会慢慢甩开，减速时被追近，追到了就抓住你
    if (g.slow > 0) { g.slow--; g.gap -= 0.0026; } else g.gap = Math.min(1, g.gap + (pw.dash > 0 ? 0.004 : 0.0013));
    if (g.gap <= 0) return die('被暗黑奶皇抓住了');
    if (P.roll > 0 && P.onGround) P.roll--;

    // 横向：滑向目标车道
    P.prevX = P.x;
    const tx = laneX(P.lane);
    P.x += clamp((tx - P.x) * 0.32, -0.42, 0.42);
    if (Math.abs(tx - P.x) < 0.02) P.x = tx;

    // 竖直
    const prevY = P.y;
    if (pw.dash > 0) {
      P.y += (3.2 - P.y) * 0.08;
      P.vy = 0;
      P.onGround = false;
    } else {
      P.vy -= GRAVITY * (P.roll > 0 && !P.onGround ? 1.6 : 1);
      P.y += P.vy;
    }

    for (const o of g.obstacles) if (o.vz) o.wz += o.vz;

    // 落脚点：地面 / 斜坡 / 车顶
    const latHit = (o, x) => !o.dead && Math.abs(x - laneX(o.lane)) < 0.95;
    const zHit = (o) => o.wz < g.dist + 0.35 && o.wz + o.len > g.dist - 0.35;
    let floor = 0;
    for (const o of g.obstacles) {
      if (!latHit(o, P.x) || !zHit(o)) continue;
      if (o.type === 'ramp') {
        const h = o.h * clamp((g.dist - o.wz) / o.len, 0, 1);
        if (P.y >= h - 0.45) floor = Math.max(floor, h);
      } else if (o.type === 'train') {
        if (prevY >= o.h - 0.4) floor = Math.max(floor, o.h);
      }
    }
    if (pw.dash <= 0) {
      if (P.y <= floor && P.vy <= 0) {
        if (!P.onGround && P.vy < -0.15) {
          P.land = 8;
          puff(P.x, floor, g.dist + 0.3, 5, '#e8d2b4');
          sfx('thud', 0.3);
        }
        P.y = floor;
        P.vy = 0;
        P.onGround = true;
      } else if (P.y > floor + 0.05) {
        P.onGround = false;
      }
    }

    // 障碍
    const top = P.y + (P.roll > 0 ? ROLL_H : PLAYER_H) * (pw.heavy > 0 ? 1.2 : 1);
    for (const o of g.obstacles) {
      if (o.dead || !zHit(o) || !latHit(o, P.x)) continue;
      if (o.type === 'puddle') {
        // 奶油泥坑：踩进去就减速，跳过去没事
        if (P.y < 0.2 && pw.dash <= 0 && pw.heavy <= 0) {
          if (g.slow <= 0) { toast('踩进奶油泥坑，减速！', '#b07a3c'); sfx('plop'); }
          g.slow = Math.max(g.slow, 70);
          if (g.t % 4 === 0) puff(P.x, 0.1, g.dist + 0.2, 1, '#fff3d6');
        }
        continue;
      }
      if (o.type === 'cone') {
        // 路障锥：撞飞它，自己减速
        if (P.y < o.h) {
          smash(o);
          if (pw.dash <= 0 && pw.heavy <= 0) { g.slow = Math.max(g.slow, 75); toast('撞翻路障，减速！', '#e2632f'); }
        }
        continue;
      }
      const sideways = !latHit(o, P.prevX);
      let blocked = false;
      if (o.type === 'train') blocked = P.y < o.h - 0.4;
      else if (o.type === 'ramp') blocked = false;
      else if (o.type === 'low') blocked = P.y < o.h;
      else if (o.type === 'high') blocked = top > o.bottom && P.y < o.h;
      else if (o.type === 'frog') {
        if (P.y >= o.h * 0.6 && P.vy < 0 && pw.dash <= 0) {
          o.dead = true;
          g.stomps++;
          P.vy = 0.22;
          P.onGround = false;
          puff(laneX(o.lane), 0.2, g.dist + 0.5, 6, '#ffe58a');
          g.debris.push({ kind: 'squash', x: laneX(o.lane), y: 0, wz: o.wz, life: 30 });
          sfx('pop');
          toast('踩扁 +100', '#d9902f');
          continue;
        }
        blocked = P.y < o.h;
      }
      if (!blocked) continue;
      if (sideways) stumble();
      else crash(o, {
        train: '一头撞上了车厢',
        low: '被矮栏绊倒了，该跳的',
        high: '撞到高栏了，该翻滚的',
        frog: '被奶蛙绊倒了',
      }[o.type]);
      if (phase !== 'run') return;
    }

    // 奶滴 / 道具
    const cy = P.y + 0.7;
    for (const c of g.coins) {
      if (c.taken) continue;
      const dz = c.wz - g.dist;
      if (pw.milk > 0 && dz < 22 && dz > -1 && !c.sky) {
        c.pull = true;
      }
      if (c.pull) {
        c.x = (c.x === undefined ? laneX(c.lane) : c.x);
        c.x += (P.x - c.x) * 0.25;
        c.y += (cy - c.y) * 0.25;
        c.wz += (g.dist - c.wz) * 0.25;
      }
      const cx = c.x === undefined ? laneX(c.lane) : c.x;
      if (Math.abs(c.wz - g.dist) < 0.7 && Math.abs(cx - P.x) < 0.9 && Math.abs(c.y - cy) < 1.1) {
        c.taken = true;
        g.coinCount++;
        sparkle(cx, c.y, c.wz);
        if (g.coinCount % 3 === 0) sfx('pop');
      }
    }
    for (const it of g.items) {
      if (it.taken) continue;
      if (Math.abs(it.wz - g.dist) < 0.8 && Math.abs(laneX(it.lane) - P.x) < 1 && P.y < 2.6) {
        it.taken = true;
        sparkle(laneX(it.lane), 1.2, it.wz, POWERS[it.type].color);
        activate(it.type);
      }
    }

    stepFx();

    const behind = g.dist - 8;
    g.obstacles = g.obstacles.filter((o) => o.wz + o.len > behind && !(o.dead && o.type !== 'train'));
    g.coins = g.coins.filter((c) => !c.taken && c.wz > behind);
    g.items = g.items.filter((i) => !i.taken && i.wz > behind);
    generate();
  };

  const stepFx = () => {
    if (g.shake > 0) g.shake *= 0.85;
    if (g.shake < 0.3) g.shake = 0;
    if (g.toast && --g.toast.t <= 0) g.toast = null;
    for (const f of g.fx) { f.x += f.vx; f.y += f.vy; f.wz += f.vz; f.vy -= 0.004; f.life -= f.decay; }
    g.fx = g.fx.filter((f) => f.life > 0);
    for (const d of g.debris) {
      if (d.kind === 'squash') { d.life--; continue; }
      d.x += d.vx; d.y += d.vy; d.wz += d.vz; d.vy -= 0.02; d.rot += d.vr;
    }
    g.debris = g.debris.filter((d) => (d.kind === 'squash' ? d.life > 0 : d.y > -3));
  };

  // ---------------------------------------------------------------- 透视投影
  let camX = 0;
  const proj = (x, y, wz) => {
    const d = Math.max(0.05, wz - g.dist - camZ);
    const s = focal / d;
    return { x: viewW / 2 + (x - camX) * s, y: horizon + (camY - y) * s, s };
  };
  const quad = (a, b, c, d) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
  };
  const clipNear = (wz) => Math.max(wz, g.dist + nearZ);

  // ---------------------------------------------------------------- 绘制
  const drawSprite = (key, cx, bottom, height, opts = {}) => {
    const im = typeof key === 'string' ? IMG[key] : key;
    if (typeof key !== 'string') key = 'naidan';
    const c = ctx;
    c.save();
    c.translate(cx, bottom - height / 2);
    if (opts.rot) c.rotate(opts.rot);
    c.scale((opts.flip ? -1 : 1) * (opts.sx || 1), opts.sy || 1);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    if (im && im.complete && im.naturalWidth) {
      const w = (height * im.naturalWidth) / im.naturalHeight;
      c.drawImage(im, -w / 2, -height / 2, w, height);
    } else {
      c.fillStyle = key.startsWith('naiwa') || key.startsWith('boss') ? '#f6d44a' : '#ffe9a8';
      c.beginPath();
      c.ellipse(0, 0, height * 0.38, height * 0.5, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };

  /**
   * 立绘最底下那一条是两只脚。量出它们的位置和颜色（每张图只量一次），
   * 跑的时候把原图的脚裁掉、换成两只会交替抬起的脚。画布被污染（file:// 外链图）就照原图画。
   */
  const FEET = {};
  const feetOf = (key) => {
    if (FEET[key] !== undefined) return FEET[key];
    const im = IMG[key];
    if (!im || !im.complete || !im.naturalWidth) return null;
    let info = null;
    try {
      const w = im.naturalWidth, h = im.naturalHeight;
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const c = cv.getContext('2d');
      c.drawImage(im, 0, 0);
      const px = c.getImageData(0, 0, w, h).data;
      let minY = h, maxY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 2) {
          if (px[(y * w + x) * 4 + 3] > 60) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
      }
      const cut = Math.round(minY + (maxY - minY) * 0.91);
      const sides = [0, 1].map(() => ({ n: 0, x: 0, r: 0, g: 0, b: 0, x0: w, x1: 0 }));
      for (let y = cut; y <= maxY; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (px[i + 3] < 160) continue;
          const sd = sides[x < w / 2 ? 0 : 1];
          sd.n++; sd.x += x; sd.r += px[i]; sd.g += px[i + 1]; sd.b += px[i + 2];
          if (x < sd.x0) sd.x0 = x;
          if (x > sd.x1) sd.x1 = x;
        }
      }
      if (sides[0].n > 20 && sides[1].n > 20) {
        info = {
          cut: cut / h,
          mid: (cut + maxY) / 2 / h,
          ry: ((maxY - cut) / h) * 0.75,
          feet: sides.map((sd) => ({
            x: sd.x / sd.n / w - 0.5,
            rx: Math.max(0.05, Math.min(0.16, (sd.x1 - sd.x0) / 2 / w)),
            color: `rgb(${(sd.r / sd.n) | 0},${(sd.g / sd.n) | 0},${(sd.b / sd.n) | 0})`,
          })),
        };
      }
    } catch (e) { info = null; }
    FEET[key] = info;
    return info;
  };

  /** 暗黑奶皇：把奶皇立绘压一层暗紫色（只做一次） */
  const darkOf = (key) => {
    const dk = 'dark_' + key;
    if (IMG[dk]) return dk;
    const im = IMG[key];
    if (!im || !im.complete || !im.naturalWidth) return key;
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    const c = cv.getContext('2d');
    c.drawImage(im, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(52,14,78,.62)';
    c.fillRect(0, 0, cv.width, cv.height);
    cv.naturalWidth = cv.width;
    cv.naturalHeight = cv.height;
    cv.complete = true;
    IMG[dk] = cv;
    return dk;
  };

  /** 带两只脚的立绘。step = 步伐相位（null = 脚不动），tuck = 空中缩脚 */
  const drawRunner = (key, cx, bottom, height, opts = {}, step = null, tuck = false) => {
    const info = feetOf(key);
    const im = IMG[key];
    if (!info || (step === null && !tuck)) return drawSprite(key, cx, bottom, height, opts);
    const c = ctx;
    const w = (height * im.naturalWidth) / im.naturalHeight;
    c.save();
    c.translate(cx, bottom - height / 2);
    if (opts.rot) c.rotate(opts.rot);
    c.scale(opts.sx || 1, opts.sy || 1);
    if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
    c.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight * info.cut, -w / 2, -height / 2, w, height * info.cut);
    info.feet.forEach((f, i) => {
      // 一只脚抬起来（离镜头近一点、显大一点），另一只踩地，交替着来
      const lift = tuck ? (i ? 0.35 : 0.8) : Math.max(0, Math.sin(step + i * Math.PI));
      const k = 1 + lift * 0.22;
      const fx = f.x * w * (1 - lift * 0.1);
      const fy = (info.mid - 0.5) * height - lift * height * 0.11;
      c.fillStyle = f.color;
      c.beginPath();
      c.ellipse(fx, fy, f.rx * w * k, info.ry * height * k, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.beginPath();
      c.ellipse(fx - f.rx * w * 0.25, fy - info.ry * height * 0.3, f.rx * w * 0.45 * k, info.ry * height * 0.35 * k, 0, 0, Math.PI * 2);
      c.fill();
    });
    c.restore();
  };

  const roundRect = (x, y, w, h, r) => {
    const c = ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };

  const drawBackground = () => {
    const c = ctx;
    const sky = c.createLinearGradient(0, 0, 0, horizon + 40);
    sky.addColorStop(0, '#ffe7c2');
    sky.addColorStop(1, '#ffcfa0');
    c.fillStyle = sky;
    c.fillRect(0, 0, viewW, viewH);
    c.fillStyle = 'rgba(255,248,230,.85)';
    c.beginPath();
    c.arc(viewW * 0.78 - camX * 6, 70, 36, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,253,247,.92)';
    for (let i = 0; i < 5; i++) {
      const span = viewW + 300;
      const x = ((((i * 389) - g.t * 0.15 - camX * 10) % span) + span) % span - 150;
      const y = 30 + ((i * 53) % 80);
      const s = 0.55 + ((i * 37) % 10) / 25;
      c.beginPath();
      c.ellipse(x, y, 60 * s, 20 * s, 0, 0, Math.PI * 2);
      c.ellipse(x + 38 * s, y - 11 * s, 40 * s, 24 * s, 0, 0, Math.PI * 2);
      c.fill();
    }
    const hills = (k, base, amp, color) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(0, viewH);
      for (let x = 0; x <= viewW + 20; x += 20) {
        const wx = x + camX * k * 40;
        c.lineTo(x, base - Math.sin(wx * 0.006) * amp - Math.sin(wx * 0.017 + 1.3) * amp * 0.4);
      }
      c.lineTo(viewW, viewH);
      c.fill();
    };
    hills(0.3, horizon + 4, 18, '#ffe2bd');
    hills(0.6, horizon + 14, 10, '#fbd6a6');
    // 两侧草地
    c.fillStyle = '#a9d67f';
    c.fillRect(0, horizon + 14, viewW, viewH);
  };

  const drawTrack = () => {
    const c = ctx;
    const z0 = g.dist + nearZ;
    const z1 = g.dist + FAR;
    // 路基
    c.fillStyle = '#d6b48c';
    quad(proj(-3.4, 0, z0), proj(3.4, 0, z0), proj(3.4, 0, z1), proj(-3.4, 0, z1));
    c.fill();
    // 枕木
    c.fillStyle = '#9b6b45';
    const tieGap = 1.6;
    for (let wz = Math.ceil(z0 / tieGap) * tieGap; wz < z1; wz += tieGap) {
      for (const l of [-1, 0, 1]) {
        const x = laneX(l);
        const a = proj(x - 0.85, 0, wz), b = proj(x + 0.85, 0, wz), d = proj(x - 0.85, 0, wz + 0.35), e = proj(x + 0.85, 0, wz + 0.35);
        if (a.s < 6) continue;
        quad(a, b, e, d);
        c.fill();
      }
    }
    // 铁轨
    c.fillStyle = '#8c8f96';
    for (const l of [-1, 0, 1]) {
      for (const off of [-0.55, 0.55]) {
        const x = laneX(l) + off;
        quad(proj(x - 0.05, 0.05, z0), proj(x + 0.05, 0.05, z0), proj(x + 0.05, 0.05, z1), proj(x - 0.05, 0.05, z1));
        c.fill();
      }
    }
    // 两边的栏杆柱
    c.fillStyle = '#c98a4f';
    const postGap = 6;
    for (let wz = Math.ceil(z0 / postGap) * postGap; wz < z1; wz += postGap) {
      for (const x of [-3.9, 3.9]) {
        const b = proj(x, 0, wz), t = proj(x, 1.1, wz);
        if (b.s < 5) continue;
        const w = Math.max(2, b.s * 0.14);
        c.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
      }
    }
    // 远处雾一下，接上地平线
    const fog = c.createLinearGradient(0, horizon, 0, horizon + 40);
    fog.addColorStop(0, 'rgba(255,214,170,.9)');
    fog.addColorStop(1, 'rgba(255,214,170,0)');
    c.fillStyle = fog;
    c.fillRect(0, horizon, viewW, 40);
  };

  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v * k), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };

  const drawBox = (x0, x1, y0, y1, za, zb, color) => {
    const c = ctx;
    const zA = clipNear(za);
    if (zb <= zA) return null;
    const p = (x, y, z) => proj(x, y, z);
    // 侧面（只画朝镜头的那一面）
    if (x1 < camX) {
      c.fillStyle = shade(color, 0.78);
      quad(p(x1, y0, zA), p(x1, y1, zA), p(x1, y1, zb), p(x1, y0, zb));
      c.fill();
    } else if (x0 > camX) {
      c.fillStyle = shade(color, 0.78);
      quad(p(x0, y0, zA), p(x0, y1, zA), p(x0, y1, zb), p(x0, y0, zb));
      c.fill();
    }
    if (y1 < camY) {
      c.fillStyle = shade(color, 1.1);
      quad(p(x0, y1, zA), p(x1, y1, zA), p(x1, y1, zb), p(x0, y1, zb));
      c.fill();
    }
    const fa = p(x0, y1, zA), fb = p(x1, y0, zA);
    c.fillStyle = color;
    c.fillRect(fa.x, fa.y, fb.x - fa.x, fb.y - fa.y);
    return { x: fa.x, y: fa.y, w: fb.x - fa.x, h: fb.y - fa.y, front: za >= zA };
  };

  const drawTrain = (o) => {
    const x = laneX(o.lane);
    const f = drawBox(x - 0.9, x + 0.9, 0, o.h, o.wz, o.wz + o.len, o.moving ? '#e8735a' : '#f2a65a');
    if (!f || !f.front) return;
    const c = ctx;
    // 车头：窗户、条纹、车灯
    c.fillStyle = '#fff3dc';
    roundRect(f.x + f.w * 0.12, f.y + f.h * 0.14, f.w * 0.76, f.h * 0.3, Math.max(2, f.w * 0.06));
    c.fill();
    c.fillStyle = '#7bb6d9';
    roundRect(f.x + f.w * 0.17, f.y + f.h * 0.18, f.w * 0.66, f.h * 0.22, Math.max(2, f.w * 0.05));
    c.fill();
    c.fillStyle = '#fff6e4';
    c.fillRect(f.x, f.y + f.h * 0.58, f.w, f.h * 0.07);
    c.fillStyle = o.moving && g.t % 20 < 10 ? '#fff27a' : '#ffe7a8';
    for (const k of [0.2, 0.8]) {
      c.beginPath();
      c.arc(f.x + f.w * k, f.y + f.h * 0.78, Math.max(2, f.w * 0.07), 0, Math.PI * 2);
      c.fill();
    }
  };

  const drawRamp = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const za = clipNear(o.wz);
    const zb = o.wz + o.len;
    if (zb <= za) return;
    const hA = o.h * ((za - o.wz) / o.len);
    const l0 = proj(x - 0.9, 0, za), r0 = proj(x + 0.9, 0, za);
    const l1 = proj(x - 0.9, hA, za), r1 = proj(x + 0.9, hA, za);
    const l2 = proj(x - 0.9, o.h, zb), r2 = proj(x + 0.9, o.h, zb);
    const lb = proj(x - 0.9, 0, zb), rb = proj(x + 0.9, 0, zb);
    c.fillStyle = '#b97a45';
    if (x + 0.9 < camX) { c.beginPath(); c.moveTo(r0.x, r0.y); c.lineTo(r1.x, r1.y); c.lineTo(r2.x, r2.y); c.lineTo(rb.x, rb.y); c.fill(); }
    if (x - 0.9 > camX) { c.beginPath(); c.moveTo(l0.x, l0.y); c.lineTo(l1.x, l1.y); c.lineTo(l2.x, l2.y); c.lineTo(lb.x, lb.y); c.fill(); }
    c.fillStyle = '#d9a066';
    quad(l1, r1, r2, l2);
    c.fill();
    c.strokeStyle = 'rgba(138,85,48,.6)';
    c.lineWidth = Math.max(1, l1.s * 0.03);
    for (let k = 0.15; k < 1; k += 0.2) {
      const zz = o.wz + o.len * k;
      if (zz < za) continue;
      const a = proj(x - 0.9, o.h * k, zz), b = proj(x + 0.9, o.h * k, zz);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
  };

  const drawBarrier = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const zz = clipNear(o.wz);
    const bottom = o.type === 'high' ? o.bottom : 0.35;
    const topY = o.type === 'high' ? o.h : o.h;
    // 两根柱子
    for (const px of [x - 0.8, x + 0.8]) {
      const b = proj(px, 0, zz), t = proj(px, topY, zz);
      c.fillStyle = '#7d6a5c';
      const w = Math.max(2, b.s * 0.1);
      c.fillRect(b.x - w / 2, t.y, w, b.y - t.y);
    }
    // 红白条纹板
    const a = proj(x - 0.9, topY, zz), b = proj(x + 0.9, o.type === 'high' ? bottom : bottom, zz);
    const boardTop = a.y;
    const boardH = o.type === 'high' ? b.y - a.y : (b.y - a.y) * 0.55;
    const w = b.x - a.x;
    c.save();
    roundRect(a.x, boardTop, w, boardH, Math.max(2, a.s * 0.06));
    c.clip();
    c.fillStyle = '#fff6e4';
    c.fillRect(a.x, boardTop, w, boardH);
    c.fillStyle = '#e2632f';
    const stripe = Math.max(6, a.s * 0.35);
    for (let i = -2; i < w / stripe + 2; i += 2) {
      c.beginPath();
      c.moveTo(a.x + i * stripe, boardTop + boardH);
      c.lineTo(a.x + (i + 1) * stripe, boardTop + boardH);
      c.lineTo(a.x + (i + 2) * stripe, boardTop);
      c.lineTo(a.x + (i + 1) * stripe, boardTop);
      c.fill();
    }
    c.restore();
  };

  const drawPuddle = (o) => {
    const c = ctx;
    const x = laneX(o.lane);
    const za = clipNear(o.wz), zb = o.wz + o.len;
    if (zb <= za) return;
    const zm = (za + zb) / 2;
    const a = proj(x, 0.02, za), b = proj(x, 0.02, zb), m = proj(x, 0.02, zm);
    c.fillStyle = '#f3d9a6';
    c.beginPath();
    c.ellipse(m.x, (a.y + b.y) / 2, 0.85 * m.s * 1.05, Math.max(2, (a.y - b.y) / 2), 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff3d6';
    c.beginPath();
    c.ellipse(m.x, (a.y + b.y) / 2, 0.7 * m.s, Math.max(1.5, (a.y - b.y) / 2.6), 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 3; i++) {
      const k = (i + 1) / 4;
      const p = proj(x + (i - 1) * 0.35, 0.05, za + (zb - za) * k);
      c.beginPath();
      c.arc(p.x, p.y - Math.abs(Math.sin(g.t * 0.1 + i)) * 0.08 * p.s, Math.max(1, 0.09 * p.s), 0, Math.PI * 2);
      c.fill();
    }
  };

  const drawCone = (o) => {
    const c = ctx;
    const b = proj(laneX(o.lane), 0, clipNear(o.wz));
    const hh = o.h * b.s, ww = 0.32 * b.s;
    c.fillStyle = '#ff7a3d';
    c.beginPath();
    c.moveTo(b.x - ww, b.y);
    c.lineTo(b.x + ww, b.y);
    c.lineTo(b.x + ww * 0.18, b.y - hh);
    c.lineTo(b.x - ww * 0.18, b.y - hh);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff6e4';
    c.fillRect(b.x - ww * 0.62, b.y - hh * 0.55, ww * 1.24, hh * 0.14);
    c.fillStyle = '#c95a2a';
    c.fillRect(b.x - ww * 1.25, b.y - hh * 0.07, ww * 2.5, hh * 0.07);
  };

  const drawDrop = (x, y, s, t, seed) => {
    const c = ctx;
    const k = (s * 0.5) / 24;
    if (k < 0.08) return;
    const bob = Math.sin(t * 0.1 + seed) * 3 * k;
    c.save();
    c.translate(x, y + bob);
    c.scale(k, k);
    c.beginPath();
    c.moveTo(0, -13);
    c.bezierCurveTo(7, -4, 10, 2, 10, 5);
    c.arc(0, 5, 10, 0, Math.PI);
    c.bezierCurveTo(-10, 2, -7, -4, 0, -13);
    c.fillStyle = '#fffdf7';
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = '#8fc7ec';
    c.stroke();
    c.fillStyle = 'rgba(143,199,236,.55)';
    c.beginPath();
    c.arc(-3.5, 4, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };

  const drawShadow = (x, y, wz, r) => {
    const p = proj(x, y, wz);
    ctx.fillStyle = 'rgba(90,60,30,.22)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * p.s, r * p.s * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawPlayer = () => {
    const P = g.p;
    const pw = g.power;
    const c = ctx;
    const heavy = pw.heavy > 0;
    const frog = heavy && pw.dash <= 0;
    let key = 'naidan_idle';
    if (pw.dash > 0) key = 'naidan_dash';
    else if (frog) key = 'naiwa_angry';
    else if (pw.milk > 0) key = 'naidan_milk';
    else if (g.t % 200 < 8) key = 'naidan_blink';
    const wz = g.dist;
    const hUnits = PLAYER_H * (frog ? 1.4 : 1) * (P.morph > 0 ? 1 + Math.sin(P.morph * 0.6) * 0.12 : 1);
    const foot = proj(P.x, P.y, wz);
    const hPx = hUnits * foot.s;
    let sxk = 1, syk = 1, rot = 0, bob = 0;
    const rolling = P.roll > 0;
    if (phase === 'dead') {
      rot = Math.min(1, g.deathT / 20) * 1.4;
    } else if (rolling) {
      sxk = 1.15; syk = 0.55; rot = (g.t * 0.5) % (Math.PI * 2) * 0 + Math.sin(g.t * 0.6) * 0.2;
    } else if (P.onGround) {
      bob = -Math.abs(Math.sin(g.t * 0.21)) * hPx * 0.05;
      rot = Math.sin(g.t * 0.16) * 0.06;
      if (P.land > 0) { syk = 1 - P.land * 0.025; sxk = 1 + P.land * 0.02; }
    } else {
      rot = (P.x - P.prevX) * 0.6;
    }
    rot += (laneX(P.lane) - P.x) * -0.08;
    // 影子落在脚下的地面/车顶
    let floor = 0;
    for (const o of g.obstacles) {
      if (o.dead || Math.abs(P.x - laneX(o.lane)) > 0.95 || o.wz > wz || o.wz + o.len < wz) continue;
      if (o.type === 'train' && P.y >= o.h - 0.4) floor = Math.max(floor, o.h);
      if (o.type === 'ramp') floor = Math.max(floor, o.h * clamp((wz - o.wz) / o.len, 0, 1));
    }
    if (phase !== 'dead') drawShadow(P.x, floor, wz, 0.55 * (heavy ? 1.3 : 1) * (1 - clamp((P.y - floor) / 5, 0, 0.6)));
    if (pw.dash > 0) {
      for (let i = 1; i <= 3; i++) {
        const tp = proj(P.x, P.y - i * 0.05, wz - i * 0.8);
        drawSprite(key, tp.x, tp.y, hUnits * tp.s, { alpha: 0.2 - i * 0.05 });
      }
    }
    if (pw.milk > 0) {
      c.strokeStyle = `rgba(95,184,232,${0.25 + Math.sin(g.t * 0.2) * 0.1})`;
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(foot.x, foot.y - hPx * 0.45, hPx * 0.75, hPx * 0.62, 0, 0, Math.PI * 2);
      c.stroke();
    }
    const alpha = P.invuln > 0 && Math.floor(P.invuln / 4) % 2 ? 0.45 : 1;
    // 地上跑 = 两只脚交替迈；空中缩脚；翻滚 / 倒下照原图
    const runStep = phase !== 'dead' && !rolling && P.onGround ? g.t * 0.42 : null;
    const tuck = phase !== 'dead' && !rolling && !P.onGround;
    drawRunner(key, foot.x, foot.y + bob, hPx, { sx: sxk, sy: syk, rot, alpha }, runStep, tuck);
    if (pw.shield) {
      c.strokeStyle = 'rgba(155,123,224,.65)';
      c.fillStyle = 'rgba(155,123,224,.12)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(foot.x, foot.y - hPx * 0.5, hPx * 0.62, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  };

  const drawChaser = () => {
    // 一直看得见：离得远 = 贴着镜头、只在屏幕下沿露出个脑袋；越追越近就跑到奶蛋身边
    const BOSS_H = 2.3;
    const dNear = -camZ - 1.0;
    const dFar = clamp(((camY - BOSS_H) * focal) / Math.max(40, viewH - 150 - horizon), 1.2, dNear - 0.5);
    const wz = g.dist + camZ + dFar + (dNear - dFar) * (1 - clamp(g.gap, 0, 1));
    const p = proj(g.p.x * 0.6 - 1.25, 0, wz);
    const key = darkOf(phase === 'dead' ? 'boss_laugh' : 'boss_idle');
    const h = BOSS_H * p.s;
    // 暗紫色气场
    const aura = ctx.createRadialGradient(p.x, p.y - h * 0.5, h * 0.1, p.x, p.y - h * 0.5, h * 0.75);
    aura.addColorStop(0, 'rgba(160,40,200,.35)');
    aura.addColorStop(1, 'rgba(160,40,200,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(p.x - h, p.y - h * 1.3, h * 2, h * 1.6);
    drawRunner(key, p.x, p.y + Math.abs(Math.sin(g.t * 0.2)) * -8, h, { rot: Math.sin(g.t * 0.2) * 0.05 }, phase === 'dead' ? null : g.t * 0.4);
  };

  const drawHud = () => {
    const c = ctx;
    const font = (w, px) => `${w} ${px}px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`;
    c.save();
    c.textBaseline = 'top';
    c.fillStyle = 'rgba(255,246,228,.88)';
    roundRect(16, 14, 230, 76, 18);
    c.fill();
    c.font = font(800, 30);
    c.fillStyle = '#e2632f';
    c.fillText(`${meters()} 米`, 32, 22);
    c.font = font(700, 16);
    c.fillStyle = '#6b5444';
    c.fillText(`奶滴 ${g.coinCount}   得分 ${score()}`, 32, 62);
    let y = 102;
    for (const k of ['dash', 'heavy', 'milk']) {
      const left = g.power[k];
      if (left <= 0) continue;
      const def = POWERS[k];
      c.fillStyle = 'rgba(255,246,228,.88)';
      roundRect(16, y, 230, 26, 13);
      c.fill();
      c.fillStyle = def.color;
      roundRect(18, y + 2, 226 * (left / def.frames), 22, 11);
      c.fill();
      c.fillStyle = '#4a3527';
      c.font = font(700, 13);
      c.fillText(def.name, 28, y + 6);
      y += 32;
    }
    if (g.power.shield) {
      c.fillStyle = 'rgba(255,246,228,.88)';
      roundRect(16, y, 120, 26, 13);
      c.fill();
      c.fillStyle = '#9b7be0';
      c.font = font(700, 13);
      c.fillText('🛡 分身护盾', 28, y + 6);
    }
    if (g.gap < 0.6 && phase === 'run') {
      const bw = 220, bx = viewW / 2 - bw / 2, by = 100;
      const k = 1 - g.gap / 0.6;
      c.globalAlpha = 0.5 + k * 0.5;
      c.fillStyle = 'rgba(40,20,50,.75)';
      roundRect(bx, by, bw, 30, 15);
      c.fill();
      c.fillStyle = g.t % 20 < 10 && k > 0.6 ? '#ff4d6d' : '#b04ad0';
      roundRect(bx + 3, by + 3, (bw - 6) * k, 24, 12);
      c.fill();
      c.fillStyle = '#fff';
      c.font = font(700, 13);
      c.textAlign = 'center';
      c.fillText(g.slow > 0 ? '减速中！暗黑奶皇逼近' : '暗黑奶皇在追你', viewW / 2, by + 8);
      c.textAlign = 'left';
      c.globalAlpha = 1;
    }
    if (g.toast) {
      const a = Math.min(1, g.toast.t / 20);
      c.globalAlpha = a;
      c.font = font(800, 26);
      c.textAlign = 'center';
      c.lineWidth = 6;
      c.strokeStyle = '#fff6e4';
      const ty = 146 - (1 - a) * 10;
      c.strokeText(g.toast.text, viewW / 2, ty);
      c.fillStyle = g.toast.color;
      c.fillText(g.toast.text, viewW / 2, ty);
    }
    c.restore();
  };

  const render = () => {
    const c = ctx;
    camX += (g.p.x * 0.55 - camX) * 0.2;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    c.save();
    if (g.shake) c.translate(rand(-g.shake, g.shake) * 0.5, rand(-g.shake, g.shake) * 0.5);
    drawBackground();
    drawTrack();

    // 远的先画、近的后画；奶蛋自己按 z = dist 插进去
    const list = [];
    // 奶蛋正踩在上面的斜坡/车厢要排在它前面画，不然车头会盖住它的脚（"穿模"）
    const P = g.p;
    const under = (o) => {
      if (o.wz > g.dist + 0.4 || o.wz + o.len < g.dist - 0.4 || Math.abs(P.x - laneX(o.lane)) > 1.3) return false;
      if (o.type === 'ramp') return P.y >= o.h * clamp((g.dist - o.wz) / o.len, 0, 1) - 0.5;
      if (o.type === 'train') return P.y >= o.h - 0.5;
      return false;
    };
    for (const o of g.obstacles) {
      if (o.dead || o.wz >= g.dist + FAR || o.wz + o.len <= g.dist + nearZ) continue;
      list.push({ z: o.type === 'puddle' ? o.wz + o.len : under(o) ? g.dist + 0.01 : clipNear(o.wz), o });
    }
    for (const cn of g.coins) if (cn.wz > g.dist + nearZ && cn.wz < g.dist + FAR) list.push({ z: cn.wz, coin: cn });
    for (const it of g.items) if (it.wz > g.dist + nearZ && it.wz < g.dist + FAR) list.push({ z: it.wz, item: it });
    for (const d of g.debris) if (d.wz > g.dist + nearZ) list.push({ z: d.wz, debris: d });
    list.push({ z: g.dist, player: true });
    list.sort((a, b) => b.z - a.z || (a.player ? 1 : -1));

    for (const e of list) {
      if (e.player) { drawPlayer(); continue; }
      if (e.o) {
        const o = e.o;
        if (o.type === 'train') drawTrain(o);
        else if (o.type === 'ramp') drawRamp(o);
        else if (o.type === 'frog') {
          const p = proj(laneX(o.lane), 0, o.wz);
          const hop = Math.abs(Math.sin(g.t * 0.14 + o.lane)) * 0.15;
          drawShadow(laneX(o.lane), 0, o.wz, 0.45);
          drawSprite('naiwa_angry', p.x, p.y - hop * p.s, 1.05 * p.s);
        } else if (o.type === 'puddle') drawPuddle(o);
        else if (o.type === 'cone') drawCone(o);
        else drawBarrier(o);
      } else if (e.coin) {
        const cn = e.coin;
        const p = proj(cn.x === undefined ? laneX(cn.lane) : cn.x, cn.y, cn.wz);
        drawDrop(p.x, p.y, p.s, g.t, cn.wz);
      } else if (e.item) {
        const it = e.item;
        const def = POWERS[it.type];
        const y = 1.2 + Math.sin(g.t * 0.08 + it.wz) * 0.15;
        const p = proj(laneX(it.lane), y, it.wz);
        const r = 0.7 * p.s;
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.strokeStyle = def.color;
        c.lineWidth = Math.max(2, r * 0.1);
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        drawSprite(def.sprite, p.x, p.y + r * 0.78, r * 1.55);
      } else if (e.debris) {
        const d = e.debris;
        const p = proj(d.x, d.y, d.wz);
        if (d.kind === 'squash') {
          drawSprite('naiwa_happy', p.x, p.y, 1.05 * p.s, { sx: 1.3, sy: 0.35, alpha: Math.min(1, d.life / 10) });
        } else if (d.kind === 'frog') {
          drawSprite('naiwa_happy', p.x, p.y, 1.05 * p.s, { rot: d.rot });
        } else {
          c.save();
          c.translate(p.x, p.y);
          c.rotate(d.rot);
          c.fillStyle = d.kind === 'train' || d.kind === 'ramp' ? '#f2a65a' : '#e2632f';
          const s = 0.5 * p.s;
          c.fillRect(-s / 2, -s / 2, s, s);
          c.restore();
        }
      }
    }
    drawChaser();
    for (const f of g.fx) {
      const p = proj(f.x, f.y, f.wz);
      c.globalAlpha = Math.max(0, f.life);
      c.fillStyle = f.color;
      c.beginPath();
      c.arc(p.x, p.y, Math.max(1, f.r * p.s * (0.5 + f.life * 0.5)), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
    drawHud();
  };

  // ---------------------------------------------------------------- 循环 / 尺寸
  const fit = () => {
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect >= 1.2) {
      // 横屏：固定 540 高，宽度跟着屏幕拉
      viewH = H;
      viewW = clamp(Math.round(aspect * H), VIEW_MIN, VIEW_MAX);
      focal = 520;
      horizon = 150;
      camY = 3.2;
      camZ = -5.5;
    } else {
      // 竖屏（手机）：固定 540 宽，往下长；焦距收一点让三条道刚好铺满宽度，奶蛋放在屏幕下方 3/4 处
      viewW = H;
      viewH = clamp(Math.round(H / aspect), H, 1200);
      focal = 400;
      camY = 3.6;
      camZ = -4.2;
      horizon = Math.round(viewH * 0.36);
    }
    nearZ = camZ + 0.9;
    scale = Math.min(window.innerWidth / viewW, window.innerHeight / viewH);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(viewW * scale * dpr);
    el.canvas.height = Math.round(viewH * scale * dpr);
    el.canvas.style.width = `${Math.round(viewW * scale)}px`;
    el.canvas.style.height = `${Math.round(viewH * scale)}px`;
    if (g) render();
  };

  const frame = (t) => {
    if (!active) return;
    const dt = Math.min(64, t - last);
    last = t;
    if (phase === 'run' || phase === 'dead') {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 5) {
        step();
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    render();
    raf = requestAnimationFrame(frame);
  };

  // ---------------------------------------------------------------- 面板
  const showPanel = (html, primary) => {
    el.panel.innerHTML = html;
    el.wrap.classList.remove('hide');
    panelPrimary = primary;
    el.panel.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => ACTIONS[b.dataset.act]());
    });
  };
  const hidePanel = () => {
    el.wrap.classList.add('hide');
    panelPrimary = null;
  };

  const KEYS_HTML = `
    <div class="keys">
      <b>换道</b><span>← → / A D（手机左右滑）</span>
      <b>跳</b><span>↑ / W / 空格（手机上滑或点一下）</span>
      <b>翻滚</b><span>↓ / S（手机下滑；空中按 = 急降）</span>
      <b>车厢</b><span>换道躲开，前面有斜坡的能跑上车顶</span>
      <b>减速</b><span>奶油泥坑要跳过去，路障锥要躲开，踩到撞到都会减速</span>
      <b>暗黑奶皇</b><span>一直在后面追；减速、侧面蹭到都会被它追近，追上就输</span>
    </div>`;

  const showReady = () => {
    phase = 'ready';
    const best = loadBest();
    showPanel(`
      <h2>奶龙快跑</h2>
      <p class="big">暗黑奶皇追来了，沿着铁轨快跑！</p>
      ${KEYS_HTML}
      ${best ? `<p>最高分 <b>${best}</b></p>` : ''}
      <div class="row"><button data-act="start">开跑！</button><button class="ghost" data-act="board">排行榜</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'start');
  };

  const showPause = () => {
    if (phase !== 'run') return;
    phase = 'pause';
    showPanel(`
      <h2>暂停中</h2>
      <p>已经跑了 ${meters()} 米</p>
      <div class="row"><button data-act="resume">继续</button><button class="ghost" data-act="start">重新开始</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'resume');
  };

  const showDead = () => {
    const s = score();
    if (!g.result) {
      const best = loadBest();
      g.result = { record: s > best, best: Math.max(best, s) };
      if (g.result.record) { saveBest(s); sfx('win'); }
    }
    const canSubmit = s > 0 && !g.submitted;
    showPanel(`
      <h2>${esc(g.deathReason)}</h2>
      <p class="big">${s} 分</p>
      ${g.result.record ? '<p class="rec">新纪录！</p>' : `<p>最高分 ${g.result.best}</p>`}
      <div class="stats">
        <div><b>${meters()}</b>米</div><div><b>${g.coinCount}</b>奶滴</div><div><b>${g.stomps}</b>踩扁</div><div><b>${g.smashes}</b>撞碎</div>
      </div>
      ${canSubmit ? `<div class="submit"><input id="runName" maxlength="12" placeholder="填个昵称上榜" autocomplete="off" value="${esc(loadName())}" /><button data-act="submit">上传成绩</button></div>` : ''}
      <p class="msg" id="runMsg">${g.submitted ? esc(g.submitted) : ''}</p>
      <div class="row"><button data-act="start">再跑一次</button><button class="ghost" data-act="board">排行榜</button><button class="ghost" data-act="menu">回主菜单</button></div>`, 'start');
  };

  // ---------------------------------------------------------------- 排行榜（Supabase，免登录，填昵称就能上榜）
  // 表结构见 supabase/run_scores.sql；表还没建好时只显示"排行榜还没开通"，不影响游戏。
  const SUPABASE_REST = 'https://buueozmrxfjqcaiqyzhq.supabase.co/rest/v1';
  const SUPABASE_KEY = 'sb_publishable_dN25ruwymHdivLup377eLg_9WTi1cOt';
  const NAME_KEY = 'naidan-run-name-v1';
  const loadName = () => {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  };
  const saveName = (v) => {
    try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* 隐私模式 */ }
  };
  /** 本周一 0 点（北京时间）对应的 ISO 时间 */
  const weekStart = () => {
    const bj = new Date(Date.now() + 8 * 3600e3);
    const day = (bj.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() - day) - 8 * 3600e3).toISOString();
  };
  const rest = async (path, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      return await fetch(`${SUPABASE_REST}${path}`, {
        ...opts,
        signal: ctrl.signal,
        cache: 'no-store',
        headers: { apikey: SUPABASE_KEY, Accept: 'application/json', ...(opts.headers || {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const fetchBoard = async (weekly) => {
    let path = '/run_scores?select=name,score,meters&order=score.desc&limit=300';
    if (weekly) path += `&created_at=gte.${encodeURIComponent(weekStart())}`;
    try {
      const res = await rest(path);
      if (res.status === 404) return { missing: true };
      if (!res.ok) return { error: true };
      const rows = await res.json();
      // 同一个昵称只留最好的一次
      const seen = new Set();
      const list = [];
      for (const r of rows) {
        if (seen.has(r.name)) continue;
        seen.add(r.name);
        list.push(r);
        if (list.length >= 50) break;
      }
      return { list };
    } catch (e) {
      return { error: true };
    }
  };
  const submitScore = async (name) => {
    try {
      const res = await rest('/run_scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name, score: score(), meters: meters(), coins: g.coinCount }),
      });
      if (res.ok) return { ok: true };
      if (res.status === 404) return { error: '排行榜还没开通（等作者在 Supabase 建表）' };
      const text = await res.text();
      return { error: /违禁|广告/.test(text) ? '昵称包含违禁词或联系方式' : '上传失败，稍后再试' };
    } catch (e) {
      return { error: '连不上排行榜，稍后再试' };
    }
  };

  let boardFrom = 'ready';
  let boardWeekly = false;
  const showBoard = async (weekly = boardWeekly) => {
    if (phase === 'ready' || phase === 'dead') boardFrom = phase;
    boardWeekly = weekly;
    phase = 'board';
    const head = `
      <h2>奶龙快跑排行榜</h2>
      <div class="tabs"><button class="${weekly ? 'ghost' : ''}" data-act="boardAll">总榜</button><button class="${weekly ? '' : 'ghost'}" data-act="boardWeek">本周</button></div>`;
    const foot = '<div class="row"><button class="ghost" data-act="boardBack">返回</button></div>';
    showPanel(`${head}<div id="runBoard"><p>加载中…</p></div>${foot}`, 'boardBack');
    const res = await fetchBoard(weekly);
    if (phase !== 'board' || boardWeekly !== weekly) return; // 等的时候已经切走了
    const box = document.getElementById('runBoard');
    if (!box) return;
    if (res.missing) { box.innerHTML = '<p>排行榜还没开通，等作者建好表就能用啦</p>'; return; }
    if (res.error) { box.innerHTML = '<p>连不上排行榜，稍后再试</p>'; return; }
    if (!res.list.length) { box.innerHTML = `<p>${weekly ? '本周' : ''}还没有人上榜，快去跑一把！</p>`; return; }
    const me = loadName();
    box.innerHTML = `<ol class="board">${res.list.map((r, i) => `
      <li class="${r.name === me ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.name)}</span><span class="sc">${r.score}</span><span class="mt">${r.meters} 米</span></li>`).join('')}</ol>`;
  };

  const resetGame = () => {
    g = newGame();
    g.coinCount = 0;
    camX = 0;
    generate();
  };

  const ACTIONS = {
    start: () => {
      resetGame();
      hidePanel();
      phase = 'run';
      last = performance.now();
      acc = 0;
      sfx('ready');
    },
    resume: () => {
      hidePanel();
      phase = 'run';
      last = performance.now();
    },
    menu: () => close(),
    board: () => showBoard(false),
    boardAll: () => showBoard(false),
    boardWeek: () => showBoard(true),
    boardBack: () => {
      phase = boardFrom;
      if (boardFrom === 'dead') showDead();
      else showReady();
    },
    submit: async () => {
      const input = document.getElementById('runName');
      const msg = document.getElementById('runMsg');
      const btn = el.panel.querySelector('[data-act="submit"]');
      const name = (input ? input.value : '').trim();
      const say = (t) => { if (msg) msg.textContent = t; };
      if (!name) return say('先填个昵称');
      if (name.length > 12) return say('昵称最多 12 个字');
      const mod = window.WorkshopModeration && window.WorkshopModeration.check(name);
      if (mod && !mod.ok) return say(`昵称${mod.reason}`);
      saveName(name);
      if (btn) btn.disabled = true;
      say('上传中…');
      const res = await submitScore(name);
      if (phase !== 'dead') return;
      if (res.ok) {
        g.submitted = `已上传：${name} · ${score()} 分`;
        showDead();
      } else {
        if (btn) btn.disabled = false;
        say(res.error);
      }
    },
  };

  // ---------------------------------------------------------------- 输入
  const act = (action) => {
    if (!active) return;
    sfx('unlock');
    if (phase !== 'run') return;
    if (action === 'left') changeLane(-1);
    else if (action === 'right') changeLane(1);
    else if (action === 'jump') jump();
    else if (action === 'roll') roll();
  };

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ArrowDown: 'roll', KeyS: 'roll',
  };
  const onKeyDown = (e) => {
    if (!active) return;
    // 跑酷开着的时候，弹弓那边的快捷键（空格放技能、Enter 开局、R 重开……）全部截住
    e.stopImmediatePropagation();
    if (e.target && e.target.tagName === 'INPUT') {
      // 输昵称的时候别把空格/回车当成"开跑"；回车 = 上传
      if (e.code === 'Enter') { e.preventDefault(); ACTIONS.submit(); }
      return;
    }
    if (phase !== 'run') {
      if ((e.code === 'Space' || e.code === 'Enter') && panelPrimary) { e.preventDefault(); if (!e.repeat) ACTIONS[panelPrimary](); }
      else if (e.code === 'Escape' && phase === 'pause') ACTIONS.resume();
      return;
    }
    if (KEYMAP[e.code]) { e.preventDefault(); if (!e.repeat) act(KEYMAP[e.code]); }
    else if (e.code === 'KeyP' || e.code === 'Escape') showPause();
  };
  const onKeyUp = (e) => { if (active) e.stopImmediatePropagation(); };

  // 触屏：滑动方向 = 动作，轻点 = 跳
  let swipe = null;
  const bindInput = () => {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    el.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
    });
    el.canvas.addEventListener('pointermove', (e) => {
      if (!swipe || swipe.id !== e.pointerId || swipe.done) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.hypot(dx, dy) < 28) return;
      swipe.done = true;
      if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right');
      else act(dy < 0 ? 'jump' : 'roll');
    });
    const end = (e) => {
      if (swipe && swipe.id === e.pointerId && !swipe.done && e.type === 'pointerup') act('jump');
      swipe = null;
    };
    el.canvas.addEventListener('pointerup', end);
    el.canvas.addEventListener('pointercancel', end);
    el.back.addEventListener('click', () => close());
    el.pause.addEventListener('click', () => (phase === 'pause' ? ACTIONS.resume() : showPause()));
    el.sound.addEventListener('click', () => {
      if (!window.AudioKit) return;
      syncSoundLabel(window.AudioKit.toggle());
    });
    window.addEventListener('resize', () => active && fit());
    document.addEventListener('visibilitychange', () => { if (document.hidden && active) showPause(); });
  };

  const syncSoundLabel = (muted) => {
    const label = muted ? '🔇' : '🔊';
    el.sound.textContent = label;
    const main = document.getElementById('btnSound');
    if (main) main.textContent = label;
  };

  // ---------------------------------------------------------------- 打开 / 关闭
  const open = () => {
    if (!el) { buildDom(); bindInput(); }
    loadSprites();
    active = true;
    el.root.classList.remove('hide');
    syncSoundLabel(!!(window.AudioKit && window.AudioKit.muted));
    resetGame();
    fit();
    showReady();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  };
  const close = () => {
    active = false;
    cancelAnimationFrame(raf);
    if (el) el.root.classList.add('hide');
  };

  const hook = () => {
    const btn = document.getElementById('btnRun');
    if (btn) btn.addEventListener('click', open);
    // 直接带 #run 打开：分享出去的链接点开就是跑酷
    if (location.hash === '#run') open();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();

  window.NailongRun = { open, close, state: () => g, phase: () => phase, act };
})();
