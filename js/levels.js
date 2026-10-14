/**
 * 关卡数据 + 无尽模式生成器。
 * 世界坐标 1280x720，y 向下，地面 GROUND_Y = 636，方块/奶蛙坐标都是几何中心。
 */

/**
 * 材质参数。
 * hp 是"标准尺寸"（约 6000 平方像素）下的血量，实际血量按面积缩放；
 * toughness 是"挨打系数"：冰块脆（吃伤害翻倍），石头硬（伤害打对折）。
 */
window.MATERIALS = {
  // density 调轻（约原来的 7 成）：同样的撞击能给物块更大速度，被撞开得更明显。
  // 注意：这里只能调密度，不能去动全局重力——奶蛋弹道、boss 摔伤全是按现在这组重力校准的。
  wood: { density: 0.00115, hp: 150, toughness: 1, friction: 0.5, frictionStatic: 0.8, restitution: 0.06, color: '#c98a4b', colorDark: '#a96b34', sfx: 'crack' },
  ice: { density: 0.0008, hp: 120, toughness: 2.4, friction: 0.19, frictionStatic: 0.8, restitution: 0.16, color: '#a9e6f2', colorDark: '#7cc9dd', sfx: 'glass' },
  // 石头原来是"3~4 发才砸得动"，太重了；现在一发满力能砸掉一大半，胖奶蛋一发碎
  stone: { density: 0.003, hp: 250, toughness: 0.62, friction: 0.62, frictionStatic: 0.85, restitution: 0.04, color: '#a6a29b', colorDark: '#7f7b74', sfx: 'stone' },
};

const GY = 636;
/** 待发高度（弹弓皮兜位置） */
const SLING_Y = 470;
const makeSling = (x) => ({ x, baseY: GY, prongTopY: 442, anchor: { x, y: SLING_Y } });

/** 手工调过的第一关 */
window.LEVEL1 = {
  id: 'l1',
  name: '第一关 · 奶蛙的午睡小屋',
  subtitle: '熟悉一下：拉弓、松手、技能，以及够远的大弧线',
  groundY: GY,
  worldW: 2720,
  launchPoints: [{ x: 186, y: SLING_Y }],
  slingshot: makeSling(186),
  birds: ['naidan', 'dash', 'bomb'],
  blocks: [
    // 一号营地（中距离）：矮门洞小屋，奶蛙在门洞里 + 门口站岗一只
    // （刻意做得矮：远营地要能靠大弧线从它上方飞过去）
    { x: 864, y: 571, w: 34, h: 130, material: 'wood' },
    { x: 988, y: 571, w: 34, h: 130, material: 'wood' },
    { x: 926, y: 489, w: 190, h: 34, material: 'wood' },
    { x: 1180, y: 612, w: 48, h: 48, material: 'wood' },
    // 二号营地（中远距离）：大石头顶着奶蛙（够高，大弧线正好落在头顶）
    { x: 1290, y: 576, w: 84, h: 120, material: 'stone' },
    { x: 1212, y: 612, w: 48, h: 48, material: 'wood' },
    { x: 1382, y: 606, w: 44, h: 60, material: 'ice' },
  ],
  pigs: [
    { x: 926, y: 600, r: 36 },   // 门洞里打盹
    { x: 926, y: 436, r: 36 },   // 屋顶上坐着（一发打塌门洞能一起收拾）
    { x: 1290, y: 480, r: 36 },  // 石头顶上（要越过门洞的大弧线）
  ],
};

// ------------------------------------------------------------------ 无尽模式

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const B = (x, y, w, h, material, extra) => ({ x, y, w, h, material, ...(extra || {}) });
const P = (x, y, r = 36, extra) => ({ x, y, r, ...(extra || {}) });
const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

/**
 * boss 关：先在门口摆一波"前哨"（清完才推进到塔前），再打蹲在阶梯塔最上层的奶皇。
 * 塔腿很脆（一发就断），断了上面整层往下坐，奶皇跟着摔——摔伤是主要解法。
 */
const buildBossLevel = (level, R) => {
  const tier = window.BossLevel.tierOf(level);
  const st = window.BossLevel.STATS[tier];
  const outpostX = 620;   // 第 1 段：前哨营地
  const arenaX = 1950;    // 第 2 段：塔的落脚点（弹弓推进到 1240 之后，对射距离和原来一模一样）
  const blocks = [];
  const pigs = [];

  // ---- 第 1 段：奶皇的前哨。就一块预制件、最多两只奶蛙，别把 boss 战的弹药用在这儿。
  const outposts = PREFABS.filter((p) => p.id === 'arch' || p.id === 'hut' || p.id === 'tower');
  const outpost = shuffle(outposts, R)[0];
  const outpostLeft = outpostX + Math.round(R() * 70);
  const made = outpost.build(outpostLeft, tier, R);
  made.blocks.forEach((b) => blocks.push({ ...b, stage: 0 }));
  made.pigs.slice(0, 2).forEach((p) => pigs.push({ ...p, stage: 0, ...(rollBonus(R) || {}) }));
  if (!pigs.length) pigs.push({ ...P(outpostLeft + 90, GY - 36), stage: 0 });

  // ---- 第 2 段：boss 塔
  const tower = window.BossLevel.tower(arenaX, st.floors, tier);
  tower.blocks.forEach((b) => blocks.push({ ...b, stage: 1 }));
  const bossX = tower.centerX;
  pigs.push({ x: bossX, y: tower.bossY, r: 72, boss: true, hp: st.hp, bossTier: tier, stage: 1 });
  // 塔前摆护卫，别一上来就摸到塔腿（护卫也可能是补给奶蛙）
  pigs.push({ ...P(arenaX - 250, GY - 36, 36), stage: 1, ...(rollBonus(R) || {}) });
  if (tier >= 2) {
    pigs.push({ ...P(arenaX - 380, GY - 36, 36), stage: 1, ...(rollBonus(R) || {}) });
    blocks.push({ ...B(arenaX - 180, GY - 24, 48, 48, 'wood'), stage: 1 });
    blocks.push({ ...B(arenaX - 180, GY - 60, 48, 24, 'wood'), stage: 1 });
  }
  if (tier >= 3) blocks.push({ ...B(arenaX - 470, GY - 40, 40, 80, 'stone'), stage: 1 });

  // 阵容：拆楼优先给爆奶蛋/胖奶蛋，其余随机。多了一段前哨，鸟数也相应多 2 发。
  const pool = window.birdPoolFor(level);
  const pickBird = paint(pool);
  const birds = ['naidan', 'bomb', 'heavy'];
  while (birds.length < st.birds) birds.push(pickBird(R));
  const order = shuffle(birds.slice(1), R);
  const queue = [birds[0], ...order.slice(0, st.birds - 1)];

  return {
    id: `boss-${level}`,
    name: `第 ${level} 关 · BOSS`,
    subtitle: `BOSS · ${window.BOSS_NAME}${tier > 1 ? ` Lv.${tier}` : ''}`,
    groundY: GY,
    // 2800：塔在 1950~2250，右边留 550px 余量；整张图在最小缩放（45%）下一屏能看全
    worldW: 2800,
    // 第 2 段弹弓严格按"离塔 714px"摆：跟原来单段版本的相对几何一模一样（差几像素，
    // 25° 那一发就从"擦过 boss"变成"顺手打断塔腿"，验收里的摔伤对照会直接失效）
    launchPoints: [{ x: 186, y: SLING_Y }, { x: arenaX - 714, y: SLING_Y }],
    slingshot: makeSling(186),
    stageLabels: [outpost.label, '奶皇的塔'],
    mood: 'boss',
    boss: { name: window.BOSS_NAME, tier, hp: st.hp, arenaX, x: bossX, y: tower.bossY, topY: tower.topY, floors: st.floors },
    tier,
    stages: 2,
    birds: queue,
    blocks,
    pigs,
    endless: true,
  };
};
/** Fisher-Yates 洗牌：不能用 sort(() => R() - 0.5)，那个的调用次数由引擎的排序实现决定，
 *  Node 和浏览器的结果会不一样，随机关卡就没法复现、也没法在 Node 侧校验。 */
const shuffle = (arr, R) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * 补给奶蛙：血量跟普通奶蛙一模一样，只是 25% 概率出现，
 * 打掉它会随机补一颗奶蛋。用生成种子决定，所以同一关每次一样。
 */
window.BONUS_PIG_CHANCE = 0.25;
const rollBonus = (R) => (R() < window.BONUS_PIG_CHANCE ? { bonus: true } : null);

/**
 * 建筑预制件。每个都手工对齐过（每块都严丝合缝落在下一块顶上），
 * 随机生成时只负责挑、拼、错位摆放，不会出现悬空或互相插进去的情况。
 * build(x0, tier, R) 的 x0 是这块地皮的最左边，返回 { blocks, pigs }。
 */
const PREFABS = [
  {
    id: 'arch',
    width: 190,
    label: '门洞小屋',
    build(x0, tier, R) {
      const pillar = tier >= 2 && R() < 0.5 ? 'stone' : 'wood';
      const blocks = [
        B(x0 + 17, GY - 65, 34, 130, pillar),
        B(x0 + 173, GY - 65, 34, 130, pillar),
        B(x0 + 95, GY - 147, 190, 34, 'wood'),
      ];
      const pigs = [P(x0 + 95, GY - 36)];
      if (tier >= 2) {
        blocks.push(B(x0 + 95, GY - 186, 84, 44, 'ice'));
        pigs.push(P(x0 + 95, GY - 244));
      }
      return { blocks, pigs };
    },
  },
  {
    id: 'tower',
    width: 150,
    label: '叠叠塔',
    build(x0, tier, R) {
      const blocks = [
        B(x0 + 66, GY - 15, 130, 30, 'wood'),
        B(x0 + 66, GY - 52, 84, 44, 'ice'),
        B(x0 + 66, GY - 89, 132, 30, tier >= 2 && R() < 0.4 ? 'stone' : 'wood'),
      ];
      const pigs = [P(x0 + 66, GY - 140)];
      if (tier >= 3) {
        // 再加一层：冰砖要正好坐在下面木板的顶面（GY-104 处），奶蛙再坐在冰砖顶面
        blocks.push(B(x0 + 66, GY - 119, 84, 30, 'ice'));
        pigs[0] = P(x0 + 66, GY - 170);
      }
      return { blocks, pigs };
    },
  },
  {
    id: 'hut',
    width: 320,
    label: '三柱大棚',
    build(x0, tier, R) {
      const pillar = tier >= 3 && R() < 0.45 ? 'stone' : 'wood';
      return {
        blocks: [
          B(x0 + 13, GY - 65, 26, 130, pillar),
          B(x0 + 150, GY - 65, 26, 130, pillar),
          B(x0 + 287, GY - 65, 26, 130, pillar),
          B(x0 + 150, GY - 147, 320, 34, R() < 0.5 ? 'wood' : 'ice'),
        ],
        pigs: [P(x0 + 81, GY - 36), P(x0 + 218, GY - 36)],
      };
    },
  },
  {
    id: 'rock',
    width: 170,
    label: '大石头',
    build(x0, tier, R) {
      const blocks = [B(x0 + 42, GY - 60, 84, 120, 'stone')];
      const pigs = [P(x0 + 42, GY - 156)];
      if (tier >= 2) {
        // 木箱要离石头远一点：奶蛙半径 36，站箱子上时不能蹭到石头
        blocks.push(B(x0 + 132, GY - 24, 48, 48, R() < 0.5 ? 'wood' : 'ice'));
        pigs.push(P(x0 + 132, GY - 84));
      }
      return { blocks, pigs };
    },
  },
  {
    id: 'watchtower',
    width: 190,
    label: '瞭望台',
    build(x0, tier, R) {
      const pillar = tier >= 2 ? 'wood' : 'wood';
      const blocks = [
        B(x0 + 17, GY - 100, 34, 200, pillar),
        B(x0 + 137, GY - 100, 34, 200, pillar),
        B(x0 + 77, GY - 215, 190, 30, tier >= 2 && R() < 0.4 ? 'ice' : 'wood'),
      ];
      const pigs = [P(x0 + 77, GY - 266)];
      if (tier >= 3) pigs.push(P(x0 + 77, GY - 36));
      return { blocks, pigs };
    },
  },
  {
    id: 'bridge',
    width: 250,
    label: '牛奶桥',
    build(x0, tier, R) {
      const blocks = [
        B(x0 + 22, GY - 65, 44, 130, 'ice'),
        B(x0 + 228, GY - 65, 44, 130, 'ice'),
        B(x0 + 125, GY - 145, 250, 30, R() < 0.35 && tier >= 2 ? 'stone' : 'wood'),
      ];
      const pigs = [P(x0 + 125, GY - 196)];
      if (tier >= 2) pigs.push(P(x0 + 100, GY - 36));
      return { blocks, pigs };
    },
  },
  {
    id: 'house2',
    width: 240,
    label: '双层小楼',
    build(x0, tier, R) {
      const wall = tier >= 3 && R() < 0.5 ? 'stone' : 'wood';
      const slab = tier >= 2 && R() < 0.5 ? 'stone' : 'wood';
      const blocks = [
        // 一层：两根墙 + 楼板
        B(x0 + 17, GY - 60, 34, 120, wall),
        B(x0 + 223, GY - 60, 34, 120, wall),
        B(x0 + 120, GY - 134, 240, 28, slab),
        // 二层：比一层窄一圈，像真房子
        B(x0 + 40, GY - 198, 34, 100, wall),
        B(x0 + 200, GY - 198, 34, 100, wall),
        B(x0 + 120, GY - 262, 200, 28, 'wood'),
      ];
      const pigs = [P(x0 + 120, GY - 36), P(x0 + 120, GY - 184)];
      if (tier >= 3) {
        // 顶上加个小阁楼，逼玩家往上打
        blocks.push(B(x0 + 120, GY - 284, 120, 16, 'ice'));
        pigs.push(P(x0 + 120, GY - 328));
      }
      return { blocks, pigs };
    },
  },
  {
    id: 'tower3',
    width: 200,
    label: '三层塔楼',
    build(x0, tier, R) {
      const wall = tier >= 2 && R() < 0.45 ? 'stone' : 'wood';
      const blocks = [
        // 一层
        B(x0 + 17, GY - 55, 34, 110, wall),
        B(x0 + 183, GY - 55, 34, 110, wall),
        B(x0 + 100, GY - 123, 200, 26, 'wood'),
        // 二层
        B(x0 + 40, GY - 186, 34, 100, wall),
        B(x0 + 160, GY - 186, 34, 100, wall),
        B(x0 + 100, GY - 249, 160, 26, tier >= 3 ? 'stone' : 'wood'),
        // 三层（更窄，只够放一只）
        B(x0 + 45, GY - 302, 34, 80, wall),
        B(x0 + 155, GY - 302, 34, 80, wall),
        B(x0 + 100, GY - 354, 140, 24, 'wood'),
      ];
      const pigs = [P(x0 + 100, GY - 36), P(x0 + 100, GY - 172)];
      // 顶层那只坐在二层天花板上（GY-262 那面），别算错高度
      if (tier >= 3) pigs.push(P(x0 + 100, GY - 298));
      return { blocks, pigs };
    },
  },
  {
    id: 'housestep',
    width: 260,
    label: '阶梯顶小屋',
    build(x0, tier, R) {
      const wall = tier >= 3 && R() < 0.4 ? 'stone' : 'wood';
      const blocks = [
        B(x0 + 17, GY - 60, 34, 120, wall),
        B(x0 + 225, GY - 60, 34, 120, wall),
        B(x0 + 130, GY - 133, 260, 26, tier >= 2 && R() < 0.5 ? 'stone' : 'wood'),
        B(x0 + 50, GY - 191, 34, 90, wall),
        B(x0 + 210, GY - 191, 34, 90, wall),
        B(x0 + 130, GY - 248, 200, 24, 'wood'),
        // 顶上再收一层，做出"阶梯"轮廓
        B(x0 + 130, GY - 272, 120, 24, 'ice'),
      ];
      const pigs = [P(x0 + 130, GY - 36), P(x0 + 130, GY - 182)];
      return { blocks, pigs };
    },
  },
];

const paint = (pool) => {
  const total = pool.reduce((s, p) => s + p[1], 0);
  return (r) => {
    let x = r() * total;
    for (const [key, w] of pool) {
      x -= w;
      if (x <= 0) return key;
    }
    return pool[0][0];
  };
};

/**
 * 结构和奶蛙的生成带。地图总长 2720（原来 1360，加长到两倍），
 * 但最右侧要留出射程余量：满力 45° 大约能飞 2100~2300px，再远就打不着了。
 */
/**
 * 奶蛙落位校验：不能跟方块/别的奶蛙重叠，也不能贴世界边界。
 * 圆形和矩形按 AABB 近似算，留 0.8px 容差（正好贴边站着是允许的，那才是稳的摆法）。
 */
const pigFits = (p, blocks, pigs, bandLeft, bandRight) => {
  if (p.x - p.r < bandLeft || p.x + p.r > bandRight) return false;
  const tol = (p.r - 0.8) ** 2;
  for (const b of blocks) {
    // 圆与矩形的最短距离：两个轴各自算"圆心到矩形区间"的间距（圆心在区间内就是 0）
    const dx = Math.max(b.x - b.w / 2 - p.x, 0, p.x - (b.x + b.w / 2));
    const dy = Math.max(b.y - b.h / 2 - p.y, 0, p.y - (b.y + b.h / 2));
    if (dx * dx + dy * dy < tol) return false;
  }
  for (const q of pigs) {
    const need = p.r + q.r - 0.8;
    if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < need * need) return false;
  }
  return true;
};

window.Endless = {
  buildBoss: (level, R) => buildBossLevel(level, R),
  /** 暴露出来给 tools/check-prefabs.mjs 做几何自检 */
  PREFABS,
  makeSling,
  SLING_Y,
  /** 同一局同一个 seed + 同一关号，生成结果完全一样（可复现、好测试） */
  generate(level, seed = 1) {
    const R = mulberry32((seed >>> 0) * 2654435761 + level * 40503);
    if (window.BossLevel.isBoss(level)) return buildBossLevel(level, R);
    const tier = level <= 3 ? 1 : level <= 7 ? 2 : 3;
    // 关卡越难：分段越多、地图越长（每段就是一次"推进"，跟愤怒的小鸟一样）。
    // 注意：拉长地图靠"多一段"，不靠"把奶蛙摆远"——每段内部都保持紧凑。
    // 分段上限 3 波：再往后的难度全部堆在"单波次"里（更多奶蛙、更硬的方块、更厚的血量）。
    const stageCount = clampInt(1 + Math.floor((level - 1) / 3), 1, 3);
    const segLen = clampInt(1240 + level * 22, 1280, 1400);
    const worldW = clampInt(520 + segLen * stageCount, 2200, 6200);
    const perStage = Math.floor(worldW / stageCount);
    const pigBudgetTotal = Math.min(2 + Math.floor(level / 2), 12);
    const basePigs = Math.floor(pigBudgetTotal / stageCount);
    const sparePigs = pigBudgetTotal % stageCount;
    const wantPrefabs = clampInt(1 + Math.floor(level / 5), 2, 4);
    // 12 关之后不再加段落，改成"结构更厚"：方块血量按关卡往上加
    const hpScale = level <= 12 ? 1 : 1 + Math.min(1.2, (level - 12) * 0.05);

    const blocks = [];
    const pigs = [];
    const launchPoints = [];
    const stageLabels = [];

    for (let s = 0; s < stageCount; s++) {
      const segStart = s * perStage;
      const launchX = segStart + 200;
      launchPoints.push({ x: launchX, y: SLING_Y });
      // 这一段的生成带：离弹弓 420 起步，最远不超过 1420（保持紧凑，别为了地图长把奶蛙摊开）
      const bandLeft = launchX + 420;
      const bandRight = Math.min(segStart + perStage - 120, launchX + 1420, worldW - 160);
      const bandW = bandRight - bandLeft;
      const budget = basePigs + (s < sparePigs ? 1 : 0);

      // 从预制件里挑：宽度加间隔不能超出这一段的地皮，奶蛙数量够了就收手
      const order = shuffle(PREFABS, R);
      const picked = [];
      let used = 0;
      let pigCount = 0;
      for (const p of order) {
        if (picked.length >= wantPrefabs) break;
        const gap = 40 + Math.round(R() * 50);
        const need = used === 0 ? p.width : used + gap + p.width;
        if (need > bandW) continue;
        picked.push(p);
        used = need;
        pigCount += p.build(0, tier, R).pigs.length;
        if (pigCount >= budget && picked.length >= 1) break;
      }
      if (!picked.length) picked.push(PREFABS[0]);
      stageLabels.push(...picked.map((p) => p.label));

      const stageBlocks = [];
      const rawPigs = [];
      let x = bandLeft;
      let structureRight = bandLeft;
      picked.forEach((p, i) => {
        const made = p.build(x, tier, R);
        made.blocks.forEach((b) => {
          if (hpScale > 1) b.hpScale = hpScale;
          stageBlocks.push(b);
        });
        rawPigs.push(...made.pigs);
        structureRight = x + p.width;
        // 间距随机一点，别排得像栅栏
        x += p.width + (i < picked.length - 1 ? 40 + Math.round(R() * 50) : 0);
      });

      // 先收下预制件自带的奶蛙，再按预算补位。补位点只在"结构前后的空地"里挑，绝不摆在房子内部。
      const stagePigs = [];
      const fits = (p, list) => pigFits(p, stageBlocks, list, bandLeft - 160, Math.min(bandRight + 120, worldW - 60));
      for (const p of rawPigs) {
        if (stagePigs.length >= budget) break;
        if (fits(p, stagePigs)) stagePigs.push(p);
      }
      const slots = [];
      for (let sx = launchX + 300; sx <= bandLeft - 30; sx += 26) slots.push(sx);
      for (let sx = structureRight + 46; sx <= bandRight + 90; sx += 26) slots.push(sx);
      const shuffled = shuffle(slots, R);
      for (const sx of shuffled) {
        if (stagePigs.length >= budget) break;
        const p = P(sx, GY - 36);
        if (fits(p, stagePigs)) stagePigs.push(p);
      }
      if (!stagePigs.length) stagePigs.push(P(bandLeft + 40, GY - 36));

      // 25% 概率把普通奶蛙变成"补给奶蛙"（打掉补一颗奶蛋）；boss 不参与
      stagePigs.forEach((p) => {
        if (!p.bonus && R() < window.BONUS_PIG_CHANCE) p.bonus = true;
      });

      stageBlocks.forEach((b) => { b.stage = s; blocks.push(b); });
      stagePigs.forEach((p) => { p.stage = s; pigs.push(p); });
    }

    const birdCount = Math.min(3 + Math.floor((level - 1) / 3), 8);
    const pickBird = paint(window.birdPoolFor(level));
    const birds = ['naidan'];
    for (let i = 1; i < birdCount; i++) birds.push(pickBird(R));
    if (level >= 3 && R() < 0.5) birds[1] = 'dash';

    return {
      id: `endless-${level}`,
      name: `第 ${level} 关`,
      subtitle: stageCount > 1 ? `${stageCount} 段推进 · ${worldW} 米长图` : `单段 · ${worldW} 米长图`,
      groundY: GY,
      worldW,
      launchPoints,
      slingshot: makeSling(launchPoints[0].x),
      stageLabels,
      stages: stageCount,
      birds,
      blocks,
      pigs,
      endless: true,
      tier,
    };
  },
};

// ------------------------------------------------------------------ boss 关

/**
 * 每 10 关一个 boss：巨奶蛙「奶皇」。
 * 场地是一栋"可拆的阶梯塔"：奶皇蹲在最上层，你把下面几层的腿打断一层，它就往下摔一层，
 * 摔伤是主要解法（直接怼它伤害打对折）。塔层数随 boss 档位增加。
 */
window.BOSS_NAME = '奶皇';
/** boss 的碰撞半径（比奶蛙大一圈，立绘也按这个放大） */
const BOSS_R = 72;
window.BossLevel = {
  isBoss: (level) => level % 10 === 0,
  tierOf: (level) => clampInt(level / 10, 1, 3),
  /** 各档数值：血量、直接伤害折扣、爆炸折扣、摔伤系数、塔层数、鸟数 */
  STATS: {
    // fall 是把"下坠速度"换算成伤害的系数：一次整层塌 ≈ 300~480 伤害，
    // 所以 boss 基本都是摔死的，直怼只是补刀（这也是"摔伤是主要解法"的落地）
    // blast 是"爆炸对它生效多少"：贴身炸一下约等于一发直怼，不然带着爆奶蛋开局就能秒 boss
    // 血量是照"打得完、但要打满"反推的。两条约束：
    // 1) 塌方是主要解法：整座塔塌下来（连着两层楼板砸）实测能砸掉 500~700 血，
    //    所以血量要抬到"一次整层塌 ≈ 五到六成血"这个手感上——血太少的话两发就收工了。
    // 2) 它每 3 发回 25% 血：总伤害预算得是血量的 1.5~1.75 倍，
    //    只靠平射直怼（约 150 一发）是打不完的，必须把塔拆下来砸它。
    // birds 里包含"打前哨那一波"的消耗：前哨最多两只奶蛙，一般一到两发就清得掉
    // 血量 = 加强版（1400 / 1500 / 1600）的 70%；塌方系数同理一起收 7 折 ——
    // 这俩必须同进退：只降血量的话，两次塌方加起来（1000+）会直接把 boss 砸死，又变成"三发结束"。
    1: { hp: 980, direct: 0.5, blast: 0.28, fall: 77, floors: 2, birds: 9, guards: 1 },
    2: { hp: 1050, direct: 0.46, blast: 0.26, fall: 80, floors: 3, birds: 9, guards: 1 },
    3: { hp: 1120, direct: 0.42, blast: 0.24, fall: 84, floors: 3, birds: 10, guards: 2 },
  },
  /** 塔身：从地面往上摞，每层两根腿 + 一块楼板；返回 { blocks, bossY, topY } */
  tower(x0, floors, tier) {
    const blocks = [];
    const legW = 40;
    const slabH = 28;
    let y = GY; // 当前层的落脚面
    for (let f = 0; f < floors; f++) {
      const legH = f === 0 ? 120 : 96; // 越往上越矮，免得塔顶出画
      const inset = 30 + f * 20;
      const span = 300 - f * 40;
      // 腿必须脆：塌方靠的是"整层自由落体砸下来"，木头一发就断才砸得狠。
      // （试过把底层换成石头：塔是塌了，但落得太"温柔"，boss 的下坠速度根本不够触发摔伤判定，
      //   结果摔伤完全失效、反倒让这一关没法打。）
      const legs = tier >= 3 && f === floors - 1 ? 'stone' : f === 0 ? 'wood' : (tier >= 2 ? 'wood' : 'ice');
      blocks.push(B(x0 + inset + legW / 2, y - legH / 2, legW, legH, legs));
      blocks.push(B(x0 + inset + span - legW / 2, y - legH / 2, legW, legH, legs));
      y -= legH;
      blocks.push(B(x0 + inset + span / 2, y - slabH / 2, span, slabH, f === floors - 1 ? 'wood' : (tier >= 2 ? 'stone' : 'wood')));
      y -= slabH;
    }
    // centerX：最上层楼板的中心，boss 要正正好摆在这上面，不然它会先滑一下
    const lastInset = 30 + (floors - 1) * 20;
    const lastSpan = 300 - (floors - 1) * 40;
    return { blocks, topY: y, bossY: y - BOSS_R, centerX: x0 + lastInset + lastSpan / 2, width: 300 };
  },
};
