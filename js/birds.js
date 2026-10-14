/**
 * 奶蛋们的档案表：外形、物理参数、伤害倍率，以及"飞行中点一下"能放的技能。
 * 技能参考愤怒的小鸟：冲刺（黄鸟）、分身（蓝鸟）、爆炸（黑鸟）、投奶泡（白鸟），
 * 胖奶蛋走的是"没有技能但一坨下去全塌"的重装路线。
 */
window.BIRDS = {
  naidan: {
    key: 'naidan',
    name: '奶蛋',
    sprite: 'naidan_idle',
    blink: 'naidan_blink',
    r: 29,
    density: 0.0028,
    restitution: 0.34,
    frictionAir: 0.0025,
    damage: 1,
    skill: null,
    tagline: '什么都不用想，撞就完了',
  },
  dash: {
    key: 'dash',
    name: '冲刺奶蛋',
    sprite: 'naidan_dash',
    r: 28,
    density: 0.0026,
    restitution: 0.3,
    frictionAir: 0.002,
    damage: 1,
    skill: 'dash',
    skillName: '冲刺',
    tagline: '点一下 · 朝当前方向猛冲一段',
  },
  split: {
    key: 'split',
    name: '分身奶蛋',
    sprite: 'naidan_split',
    r: 28,
    density: 0.0024,
    restitution: 0.3,
    frictionAir: 0.0024,
    damage: 1.1,
    skill: 'split',
    skillName: '分身',
    tagline: '点一下 · 一分为三',
  },
  bomb: {
    key: 'bomb',
    name: '爆奶蛋',
    sprite: 'naidan_bomb',
    r: 30,
    density: 0.0034,
    restitution: 0.2,
    frictionAir: 0.003,
    damage: 1,
    skill: 'boom',
    skillName: '爆炸',
    tagline: '点一下 · 原地炸开，或者撞上去自己炸',
  },
  heavy: {
    key: 'heavy',
    name: '胖奶蛋',
    sprite: 'naidan_heavy',
    r: 38,
    density: 0.0038,
    restitution: 0.22,
    frictionAir: 0.0028,
    damage: 1.45,
    skill: null,
    tagline: '什么都不用想，压过去',
  },
  milk: {
    key: 'milk',
    name: '奶泡蛋',
    sprite: 'naidan_milk',
    r: 29,
    density: 0.0026,
    restitution: 0.32,
    frictionAir: 0.0026,
    damage: 1,
    skill: 'milk',
    skillName: '投奶泡',
    tagline: '点一下 · 往下丢一颗奶泡炸弹',
  },
  back: {
    key: 'back',
    name: '回旋奶蛋',
    sprite: 'naidan_back',
    r: 29,
    density: 0.0027,
    restitution: 0.3,
    frictionAir: 0.0022,
    damage: 1,
    skill: 'back',
    skillName: '回旋',
    tagline: '点一下 · 掉头往回飞',
  },
  seek: {
    key: 'seek',
    name: '制导奶蛋',
    sprite: 'naidan_seek',
    r: 28,
    density: 0.0027,
    restitution: 0.26,
    frictionAir: 0.0018,
    damage: 1.05,
    skill: 'seek',
    skillName: '制导',
    skillTip: '点屏幕上的位置 · 直着加速冲过去',
    tagline: '点一下 · 朝点到的地方直线加速冲过去',
  },
};

/** 分身奶蛋分出来的小奶蛋 */
window.BIRD_CHILD = {
  rScale: 0.62,
  densityScale: 0.9,
  // 分身个体小、质量轻，靠伤害倍率补回来：三只一起糊上去能拆得动石头
  damage: 1.75,
  spreadDeg: 19,
};

/** 无尽模式抽卡用的权重表（按关卡逐步解锁） */
window.birdPoolFor = (level) => {
  const pool = [
    ['naidan', 3.2],
    ['dash', 2],
    ['split', 2],
    ['milk', 1.2],
    ['back', 1.8],
  ];
  if (level >= 2) pool.push(['seek', 1.5]);
  if (level >= 3) pool.push(['bomb', 1.4]);
  if (level >= 4) pool.push(['heavy', 1.6]);
  if (level >= 6) pool.push(['heavy', 1.2], ['bomb', 0.8]);
  return pool;
};
