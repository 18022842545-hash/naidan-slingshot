/**
 * 社区关卡：静态目录 + 免登录共享计数器。
 *
 * 目录文件由 GitHub Issue 投稿 + Actions 自动更新；点赞/游玩数量走 Abacus，
 * 不需要账号或自建服务器。计数器接口暂时不可用时退回本地缓存，不阻塞玩游戏。
 */
window.WorkshopCommunity = (() => {
  const API = 'https://abacus.jasoncameron.dev';
  const NAMESPACE = 'naidan-slingshot-20261017';
  const CACHE_KEY = 'naidan-workshop-community-stats-v1';
  const LIKED_KEY = 'naidan-workshop-liked-v1';
  const PLAYED_KEY = 'naidan-workshop-played-v1';
  const CACHE_MS = 60 * 1000;
  const rateSlots = [];

  const readObject = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (e) {
      return {};
    }
  };
  const writeObject = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式 */ }
  };

  /** 把分享码压成短而稳定的计数器 key（不需要服务端索引） */
  const hash = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  };
  const counterKey = (kind, code) => `${kind}-${hash(String(code || ''))}`;

  /** 公共接口限 30 次/10 秒；留 5 次余量给点赞/游玩，避免目录一长就整批 429 */
  const waitRateSlot = async () => {
    for (;;) {
      const now = Date.now();
      while (rateSlots.length && now - rateSlots[0] > 10000) rateSlots.shift();
      if (rateSlots.length < 25) {
        rateSlots.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, Math.max(80, 10050 - (now - rateSlots[0]))));
    }
  };

  const request = async (path, retry = true) => {
    await waitRateSlot();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    try {
      const res = await fetch(`${API}${path}`, { signal: ctrl.signal, cache: 'no-store' });
      if (res.status === 404) return { value: 0 };
      if (res.status === 429 && retry) {
        await new Promise((r) => setTimeout(r, 1300));
        return request(path, false);
      }
      if (!res.ok) throw new Error(`counter ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const getCount = async (kind, code) => {
    const out = await request(`/get/${NAMESPACE}/${counterKey(kind, code)}`);
    return Math.max(0, Number(out && out.value) || 0);
  };
  const hitCount = async (kind, code) => {
    const out = await request(`/hit/${NAMESPACE}/${counterKey(kind, code)}`);
    return Math.max(0, Number(out && out.value) || 0);
  };

  const loadCatalog = async () => {
    let raw = null;
    const embedded = window.INLINE_WORKSHOP_LEVELS;
    if (Array.isArray(embedded) || (embedded && Array.isArray(embedded.levels))) {
      raw = window.INLINE_WORKSHOP_LEVELS;
    } else {
      const res = await fetch('workshop/levels.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`关卡目录 ${res.status}`);
      raw = await res.json();
    }
    const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.levels) ? raw.levels : []);
    return list.map((entry) => {
      const code = String(entry.code || '').trim();
      const def = code ? window.WorkshopLevel.unpack(code) : null;
      if (!def) return null;
      return {
        id: String(entry.id || hash(code)),
        code,
        name: String(entry.name || def.name || '未命名关卡').slice(0, 30),
        author: String(entry.author || '匿名玩家').slice(0, 30),
        submittedAt: entry.submittedAt || 0,
        def,
      };
    }).filter(Boolean);
  };

  const loadStats = async (levels, options = {}) => {
    const cached = readObject(CACHE_KEY);
    const values = {};
    Object.entries(cached.values || {}).forEach(([id, stat]) => {
      values[id] = { likes: Number(stat.likes) || 0, plays: Number(stat.plays) || 0 };
    });
    if (!options.force && cached.at && Date.now() - Number(cached.at) < CACHE_MS) {
      return { values, cached: true };
    }

    const jobs = [];
    levels.forEach((entry) => {
      values[entry.id] = values[entry.id] || { likes: 0, plays: 0 };
      jobs.push(async () => {
        try { values[entry.id].likes = await getCount('like', entry.code); } catch (e) { /* 保留缓存 */ }
      });
      jobs.push(async () => {
        try { values[entry.id].plays = await getCount('play', entry.code); } catch (e) { /* 保留缓存 */ }
      });
    });
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        await job();
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
    writeObject(CACHE_KEY, { at: Date.now(), values });
    return { values, cached: false };
  };

  const liked = () => readObject(LIKED_KEY);
  const played = () => readObject(PLAYED_KEY);
  const isLiked = (code) => !!liked()[code];
  const isPlayed = (code) => !!played()[code];

  const like = async (entry) => {
    if (isLiked(entry.code)) return { ok: true, already: true };
    try {
      const value = await hitCount('like', entry.code);
      const all = liked();
      all[entry.code] = Date.now();
      writeObject(LIKED_KEY, all);
      return { ok: true, value };
    } catch (e) {
      return { ok: false };
    }
  };

  /** 按浏览器去重：同一台设备重复玩同一张图，不会把“游玩人数”刷上去 */
  const recordPlay = async (entry) => {
    if (isPlayed(entry.code)) return { ok: true, already: true };
    try {
      const value = await hitCount('play', entry.code);
      const all = played();
      all[entry.code] = Date.now();
      writeObject(PLAYED_KEY, all);
      return { ok: true, value };
    } catch (e) {
      return { ok: false };
    }
  };

  return {
    cacheKey: CACHE_KEY,
    loadCatalog,
    loadStats,
    like,
    recordPlay,
    isLiked,
    isPlayed,
  };
})();
