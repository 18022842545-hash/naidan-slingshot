/**
 * 社区关卡：静态精选 + Supabase 匿名投稿 + 免登录共享计数器。
 *
 * 投稿直接写入 Supabase 的 insert-only 表，玩家不需要注册账号；
 * 点赞/游玩数量仍走 Abacus。任一公共接口不可用时都退回本地缓存/静态目录。
 */
window.WorkshopCommunity = (() => {
  const SUPABASE_URL = 'https://buueozmrxfjqcaiqyzhq.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_dN25ruwymHdivLup377eLg_9WTi1cOt';
  const SUPABASE_REST = `${SUPABASE_URL}/rest/v1`;
  const API = 'https://abacus.jasoncameron.dev';
  const NAMESPACE = 'naidan-slingshot-20261017';
  const CACHE_KEY = 'naidan-workshop-community-stats-v1';
  const LIKED_KEY = 'naidan-workshop-liked-v1';
  const PLAYED_KEY = 'naidan-workshop-played-v1';
  const WEEKLY_KEY = 'naidan-workshop-weekly-v1';
  const CACHE_MS = 60 * 1000;
  const rateSlots = [];
  let remoteState = 'unknown'; // unknown | ready | missing | error

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

  /** 周五 24:00（即周六 00:00，北京时间）换榜 */
  const weeklyPeriod = (now = Date.now()) => {
    const offset = 8 * 60 * 60 * 1000;
    const shifted = new Date(now + offset);
    const daysSinceSaturday = (shifted.getUTCDay() + 1) % 7;
    const shiftedMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    const resetMs = shiftedMidnight - offset - daysSinceSaturday * 86400000;
    const labelDate = new Date(resetMs + offset);
    const key = [
      labelDate.getUTCFullYear(),
      String(labelDate.getUTCMonth() + 1).padStart(2, '0'),
      String(labelDate.getUTCDate()).padStart(2, '0'),
    ].join('-');
    return { key, resetMs, nextResetMs: resetMs + 7 * 86400000 };
  };

  const normalizeEntry = (entry) => {
    const code = String(entry.code || '').trim();
    const def = code ? window.WorkshopLevel.unpack(code) : null;
    if (!def) return null;
    return {
      id: String(entry.id || hash(code)),
      code,
      name: String(entry.name || def.name || '未命名关卡').slice(0, 30),
      author: String(entry.author || '匿名玩家').slice(0, 30),
      submittedAt: entry.submittedAt || entry.created_at || 0,
      def,
    };
  };

  const loadStaticCatalog = async () => {
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
    return list.map(normalizeEntry).filter(Boolean);
  };

  const supabaseError = async (res) => {
    let body = null;
    try { body = await res.json(); } catch (e) { /* 非 JSON 错误 */ }
    return body && (body.message || body.error_description) ? String(body.message || body.error_description) : `HTTP ${res.status}`;
  };

  const loadRemoteCatalog = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6500);
    try {
      const url = `${SUPABASE_REST}/workshop_levels?select=id,code,name,author,created_at&status=eq.published&order=created_at.desc&limit=100`;
      const res = await fetch(url, {
        signal: ctrl.signal,
        cache: 'no-store',
        headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
      });
      if (!res.ok) {
        remoteState = res.status === 404 ? 'missing' : 'error';
        throw new Error(await supabaseError(res));
      }
      const rows = await res.json();
      remoteState = 'ready';
      return Array.isArray(rows) ? rows.map(normalizeEntry).filter(Boolean) : [];
    } finally {
      clearTimeout(timer);
    }
  };

  const loadWeeklySnapshot = async (weekKey) => {
    const cached = readObject(WEEKLY_KEY);
    if (cached.key === weekKey && Array.isArray(cached.ids)) return cached.ids;
    try {
      const res = await fetch(`${SUPABASE_REST}/workshop_weekly?week_key=eq.${encodeURIComponent(weekKey)}&select=level_ids&limit=1`, {
        cache: 'no-store',
        headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
      });
      if (res.ok) {
        const rows = await res.json();
        const ids = Array.isArray(rows) && rows[0] && Array.isArray(rows[0].level_ids) ? rows[0].level_ids : null;
        if (ids && ids.length) {
          writeObject(WEEKLY_KEY, { key: weekKey, ids });
          return ids;
        }
      }
    } catch (e) { /* 表还没建或网络不可用时用本机快照 */ }
    return null;
  };

  const saveWeeklySnapshot = async (weekKey, ids) => {
    writeObject(WEEKLY_KEY, { key: weekKey, ids });
    try {
      await fetch(`${SUPABASE_REST}/workshop_weekly`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ week_key: weekKey, level_ids: ids }),
      });
    } catch (e) { /* 本机快照已经保存，远端失败不影响本周展示 */ }
  };

  const loadCatalog = async () => {
    const [local, remote] = await Promise.allSettled([loadStaticCatalog(), loadRemoteCatalog()]);
    const staticLevels = local.status === 'fulfilled' ? local.value : [];
    const remoteLevels = remote.status === 'fulfilled' ? remote.value : [];
    if (local.status === 'rejected' && remote.status === 'rejected') {
      throw local.reason || remote.reason || new Error('社区目录加载失败');
    }
    const seen = new Set();
    const levels = [...remoteLevels, ...staticLevels].filter((entry) => {
      if (seen.has(entry.code)) return false;
      seen.add(entry.code);
      return true;
    });
    levels.remoteState = remoteState;
    return { levels, remoteState };
  };

  /** 匿名投稿：公开的 publishable key + RLS 只允许 insert/select */
  const submitLevel = async (def, author) => {
    const errors = window.WorkshopLevel.validate(def);
    if (errors.length) return { ok: false, error: errors[0] };
    const code = window.WorkshopLevel.pack(def);
    if (code.length > 5000) return { ok: false, error: '这张关卡数据太长，无法投稿' };
    const cleanAuthor = String(author || '').trim().slice(0, 30) || '匿名玩家';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(`${SUPABASE_REST}/workshop_levels`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          code,
          name: def.name,
          author: cleanAuthor,
          status: 'published',
        }),
      });
      if (res.status === 409) return { ok: false, duplicate: true, error: '这张关卡已经在社区里了' };
      if (!res.ok) {
        const message = await supabaseError(res);
        remoteState = res.status === 404 ? 'missing' : 'error';
        return {
          ok: false,
          setup: res.status === 404 || res.status === 401 || res.status === 403,
          error: /违禁|广告联系方式/.test(message) ? '关卡名或用户名包含违禁词/广告联系方式' : message,
        };
      }
      const rows = await res.json();
      const entry = Array.isArray(rows) ? normalizeEntry(rows[0]) : null;
      remoteState = 'ready';
      return { ok: true, entry };
    } catch (e) {
      return { ok: false, error: '连不上投稿服务，稍后再试' };
    } finally {
      clearTimeout(timer);
    }
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
    submitLevel,
    weeklyPeriod,
    loadWeeklySnapshot,
    saveWeeklySnapshot,
    remoteState: () => remoteState,
    loadStats,
    like,
    recordPlay,
    isLiked,
    isPlayed,
  };
})();
