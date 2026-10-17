/**
 * 创意工坊的数据层（纯函数，不碰 DOM、不碰引擎）。
 *
 * 关卡本来就是纯数据（跟 levels.js 里 LEVEL1 / Endless.generate 的产物同一种形状），
 * 所以这里只干四件事：
 *   1. normalize —— 把编辑器随手拼出来的对象收拾成字段齐全、坐标取整的合法 def
 *   2. validate  —— 找出"放歪了/打不到/插进方块里"这种没法玩的情况
 *   3. pack/unpack —— 关卡 ↔ 一段短码（塞进链接 #level=… 里发给别人）
 *   4. toJSON/fromJSON —— 关卡 ↔ 文件（给人看、给以后的书架用）
 */
window.WorkshopLevel = (() => {
  const GROUND_Y = 636;
  const SLING_Y = 470;
  const MATS = ['wood', 'ice', 'stone'];
  const BIRDS = ['naidan', 'dash', 'split', 'bomb', 'heavy', 'milk', 'back', 'seek'];
  const LIMITS = { blocks: 200, pigs: 40, birds: 10, worldW: [2400, 6200], stages: [1, 3] };

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const snap = (v, step = 10) => Math.round(v / step) * step;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angleStep = Math.PI / 12; // 15°
  const normalizeAngle = (v) => {
    const a = Math.round(num(v, 0) / angleStep) * angleStep;
    return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  };
  const aabbOf = (b) => {
    const c = Math.abs(Math.cos(b.angle || 0));
    const s = Math.abs(Math.sin(b.angle || 0));
    return { halfW: (b.w * c + b.h * s) / 2, halfH: (b.w * s + b.h * c) / 2 };
  };

  const blank = () => ({
    id: `custom-${Date.now().toString(36)}`,
    name: '我的关卡',
    subtitle: '玩家自制',
    groundY: GROUND_Y,
    worldW: 2720,
    launchPoints: [{ x: 186, y: SLING_Y }],
    birds: ['naidan', 'dash', 'bomb'],
    blocks: [],
    pigs: [],
    custom: true,
  });

  /** 收拾成合法 def；顺带按方块/奶蛙的位置算好它们属于第几段 */
  const normalize = (input = {}) => {
    const stageCount = clamp(Math.round(num(input.stages, (input.launchPoints || []).length || 1)), LIMITS.stages[0], LIMITS.stages[1]);
    const given = Array.isArray(input.launchPoints) ? input.launchPoints : [];
    // 关卡自己带了合法的弹弓位置（无尽模式生成的那种）就照用；数量对不上（编辑器里刚改过分段数）才重算
    const launchPoints = given.length === stageCount
      ? given.slice(0, LIMITS.stages[1]).map((p) => ({ x: snap(num(p.x, 186)), y: num(p.y, SLING_Y) }))
      : Array.from({ length: stageCount }, (_, s) => ({ x: 186 + s * 1000, y: SLING_Y }));
    const blocks = (Array.isArray(input.blocks) ? input.blocks : []).slice(0, LIMITS.blocks).map((b) => ({
      x: snap(num(b.x, 400)),
      y: snap(num(b.y, GROUND_Y - 60)),
      w: clamp(snap(num(b.w, 90)), 20, 420),
      h: clamp(snap(num(b.h, 60)), 16, 200),
      material: MATS.includes(b.material) ? b.material : 'wood',
      angle: normalizeAngle(b.angle),
    }));
    const pigs = (Array.isArray(input.pigs) ? input.pigs : []).slice(0, LIMITS.pigs).map((p) => {
      const pig = {
        x: snap(num(p.x, 600)),
        y: snap(num(p.y, GROUND_Y - 36)),
        r: clamp(snap(num(p.r, 36)), 20, 72),
      };
      if (p.bonus) pig.bonus = true;
      return pig;
    });
    const maxX = Math.max(
      600,
      ...blocks.map((b) => b.x + b.w / 2),
      ...pigs.map((p) => p.x + p.r)
    );
    const worldW = clamp(snap(Math.max(num(input.worldW, 0), maxX + 700)), LIMITS.worldW[0], LIMITS.worldW[1]);
    // 属于第几段：按"离它最近的、在它左边的弹弓"来分（编辑器里随便摆，这里自动归档）
    const stageOf = (x) => Math.max(0, launchPoints.filter((p) => p.x <= x).length - 1);
    blocks.forEach((b) => { b.stage = stageOf(b.x); });
    pigs.forEach((p) => { p.stage = stageOf(p.x); });
    const birds = (Array.isArray(input.birds) && input.birds.length ? input.birds : ['naidan', 'dash', 'bomb'])
      .filter((k) => BIRDS.includes(k))
      .slice(0, LIMITS.birds);
    return {
      id: String(input.id || `custom-${Date.now().toString(36)}`),
      name: String(input.name || '我的关卡').slice(0, 24),
      subtitle: '玩家自制 · 创意工坊',
      groundY: GROUND_Y,
      worldW,
      launchPoints,
      stages: stageCount,
      birds: birds.length ? birds : ['naidan'],
      blocks,
      pigs,
      custom: true,
    };
  };

  const circleHitsRect = (p, b) => {
    const a = -(b.angle || 0);
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) < b.w / 2 + p.r * 0.8 && Math.abs(ly) < b.h / 2 + p.r * 0.8;
  };
  const cornersOf = (b) => {
    const c = Math.cos(b.angle || 0);
    const s = Math.sin(b.angle || 0);
    const hw = b.w / 2;
    const hh = b.h / 2;
    return [
      [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
    ].map(([x, y]) => ({ x: b.x + x * c - y * s, y: b.y + x * s + y * c }));
  };
  /** 旋转矩形 SAT：支持任意 15° 角度；刚好贴边不算重叠 */
  const blocksOverlap = (a, b) => {
    const ca = cornersOf(a);
    const cb = cornersOf(b);
    const axes = [
      { x: Math.cos(a.angle || 0), y: Math.sin(a.angle || 0) },
      { x: -Math.sin(a.angle || 0), y: Math.cos(a.angle || 0) },
      { x: Math.cos(b.angle || 0), y: Math.sin(b.angle || 0) },
      { x: -Math.sin(b.angle || 0), y: Math.cos(b.angle || 0) },
    ];
    const project = (points, axis) => {
      const values = points.map((p) => p.x * axis.x + p.y * axis.y);
      return { min: Math.min(...values), max: Math.max(...values) };
    };
    return axes.every((axis) => {
      const pa = project(ca, axis);
      const pb = project(cb, axis);
      return !(pa.max <= pb.min + 0.5 || pb.max <= pa.min + 0.5);
    });
  };

  /** 返回一组"没法玩"的原因；空数组 = 可以玩 */
  const validate = (def) => {
    const errs = [];
    const stageCount = def.launchPoints.length;
    if (!def.pigs.length) errs.push('至少放一只奶蛙，不然一开局就赢了');
    if (!def.blocks.length) errs.push('至少放一个方块，不然没有可拆的东西');
    if (def.birds.length < 2) errs.push('奶蛋至少给 2 发，1 发基本打不过');
    if (def.pigs.length > LIMITS.pigs) errs.push(`奶蛙最多 ${LIMITS.pigs} 只`);
    if (def.blocks.length > LIMITS.blocks) errs.push(`方块最多 ${LIMITS.blocks} 块`);
    def.pigs.forEach((p, i) => {
      const slingX = def.launchPoints[clamp(p.stage || 0, 0, stageCount - 1)].x;
      const tag = `第 ${i + 1} 只奶蛙`;
      if (p.x - slingX < 160) errs.push(`${tag}离弹弓太近了（这一段的弹弓在 x=${slingX}）`);
      if (p.x - slingX > 1500) errs.push(`${tag}离它那一段的弹弓超过 1500px，基本打不到`);
      if (p.x > def.worldW - 100) errs.push(`${tag}跑出地图右边了`);
      if (p.y > def.groundY - p.r + 8) errs.push(`${tag}陷进地里了`);
      if (def.blocks.some((b) => circleHitsRect(p, b))) errs.push(`${tag}和方块叠在一起了`);
    });
    def.blocks.forEach((b, i) => {
      const box = aabbOf(b);
      if (b.x - box.halfW < -40) errs.push(`第 ${i + 1} 个方块跑出地图左边了`);
      if (b.x + box.halfW > def.worldW + 40) errs.push(`第 ${i + 1} 个方块跑出地图右边了`);
    });
    for (let i = 0; i < def.blocks.length; i++) {
      for (let j = i + 1; j < def.blocks.length; j++) {
        if (blocksOverlap(def.blocks[i], def.blocks[j])) {
          errs.push(`第 ${i + 1} 个和第 ${j + 1} 个方块叠在一起了`);
        }
      }
    }
    for (let i = 0; i < def.pigs.length; i++) {
      for (let j = i + 1; j < def.pigs.length; j++) {
        const a = def.pigs[i];
        const b = def.pigs[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.8) {
          errs.push(`第 ${i + 1} 只和第 ${j + 1} 只奶蛙叠在一起了`);
        }
      }
    }
    return errs;
  };

  // ---- 短码：short-key JSON → base64url（放进 #level=… 里） ----
  /** 软提示（不阻止试玩）：方块得踩在东西上，不然一开局就自己掉下来 */
  const warnings = (def) => {
    const out = [];
    const supported = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      def.blocks.forEach((b, i) => {
        if (supported.has(i)) return;
        const box = aabbOf(b);
        const bottom = b.y + box.halfH;
        const onGround = Math.abs(bottom - def.groundY) <= 6;
        const onBlock = def.blocks.some((o, j) => supported.has(j)
          && Math.abs(o.y - aabbOf(o).halfH - bottom) <= 6
          && Math.abs(o.x - b.x) < (aabbOf(o).halfW + box.halfW) - 6);
        if (onGround || onBlock) { supported.add(i); changed = true; }
      });
    }
    const floating = def.blocks.length - supported.size;
    if (floating > 0) out.push(`有 ${floating} 块方块悬空，开局会掉下来`);
    return out;
  };

  const toPack = (def) => ({
    v: 1,
    n: def.name,
    w: def.worldW,
    s: def.launchPoints.map((p) => [p.x, p.y]),
    b: def.blocks.map((b) => [b.x, b.y, b.w, b.h, MATS.indexOf(b.material), Math.round((b.angle || 0) * 180 / Math.PI)]),
    p: def.pigs.map((p) => [p.x, p.y, p.r, p.bonus ? 1 : 0]),
    k: def.birds.map((k) => BIRDS.indexOf(k)),
  });
  const fromPack = (o) => normalize({
    name: o.n,
    worldW: o.w,
    launchPoints: (o.s || []).map(([x, y]) => ({ x, y })),
    blocks: (o.b || []).map(([x, y, w, h, m, angle]) => ({
      x, y, w, h, material: MATS[m] || 'wood',
      angle: angle === undefined ? 0 : Number(angle) * Math.PI / 180,
    })),
    pigs: (o.p || []).map(([x, y, r, b]) => ({ x, y, r, bonus: !!b })),
    birds: (o.k || []).map((i) => BIRDS[i]).filter(Boolean),
    stages: (o.s || []).length,
  });

  const b64url = (bin) => btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

  /** def → 分享码（utf-8 安全） */
  const pack = (def) => b64url(encodeURIComponent(JSON.stringify(toPack(normalize(def)))).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  /** 分享码 → def；解不开就返回 null */
  const unpack = (code) => {
    try {
      const json = decodeURIComponent([...unb64url(String(code).trim())].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
      return fromPack(JSON.parse(json));
    } catch (e) {
      return null;
    }
  };

  const toJSON = (def) => JSON.stringify({ formatVersion: 1, ...toPack(normalize(def)) }, null, 1);
  /** 文件/粘贴内容 → def（既认 JSON，也认分享码） */
  const fromJSON = (text) => {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.startsWith('{')) {
      try {
        const o = JSON.parse(t);
        return o.formatVersion ? fromPack(o) : normalize(o);
      } catch (e) {
        return null;
      }
    }
    return unpack(t);
  };

  return {
    GROUND_Y, SLING_Y, MATS, BIRDS, LIMITS, blank, normalize, validate, warnings,
    blocksOverlap, circleHitsBlock: circleHitsRect,
    pack, unpack, toPack, fromPack, toJSON, fromJSON,
  };
})();
