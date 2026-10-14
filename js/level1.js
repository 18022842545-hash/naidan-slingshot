/**
 * 第一关关卡数据。世界坐标 1280x720，y 向下。
 * 所有方块/奶蛙的坐标都是"几何中心"，方便和 Matter 的 Body 对应。
 */
window.LEVEL1 = {
  title: '第一关 · 奶蛙的午睡小屋',
  groundY: 636,
  birds: 3,
  slingshot: { x: 186, baseY: 636, prongTopY: 442, anchor: { x: 186, y: 470 } },
  camera: { min: 0, max: 640 },
  blocks: [
    // 主体小屋：两根木柱 + 一根横梁，梁下住着一只奶蛙（开口留得够宽，平射能打进去）
    { x: 864, y: 571, w: 34, h: 130, material: 'wood' },
    { x: 988, y: 571, w: 34, h: 130, material: 'wood' },
    { x: 926, y: 489, w: 190, h: 34, material: 'wood' },
    // 房顶上叠的冰砖小台子
    { x: 926, y: 450, w: 84, h: 44, material: 'ice' },
    { x: 926, y: 413, w: 132, h: 30, material: 'wood' },
    // 右侧大石头（要宽过奶蛙身子，不然圆屁股会慢慢溜下去）
    { x: 1096, y: 576, w: 84, h: 120, material: 'stone' },
    // 门口的小木箱
    { x: 1042, y: 612, w: 48, h: 48, material: 'wood' },
  ],
  pigs: [
    { x: 926, y: 600, r: 36 },   // 梁下打盹
    { x: 926, y: 362, r: 36 },   // 塔顶坐着
    { x: 1096, y: 480, r: 36 },  // 石头顶上晒太阳
  ],
};

/**
 * 材质参数。
 * hp 是"标准尺寸"（约 6000 平方像素）下的血量，实际血量按面积缩放；
 * toughness 是"挨打系数"：冰块脆（吃伤害翻倍），石头硬（伤害打对折）。
 */
window.MATERIALS = {
  wood: { density: 0.0016, hp: 150, toughness: 1, friction: 0.62, restitution: 0.06, color: '#c98a4b', colorDark: '#a96b34', sfx: 'crack' },
  ice: { density: 0.0011, hp: 120, toughness: 2.4, friction: 0.24, restitution: 0.16, color: '#a9e6f2', colorDark: '#7cc9dd', sfx: 'glass' },
  stone: { density: 0.0042, hp: 330, toughness: 0.46, friction: 0.78, restitution: 0.04, color: '#a6a29b', colorDark: '#7f7b74', sfx: 'stone' },
};
