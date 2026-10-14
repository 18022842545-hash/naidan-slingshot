/**
 * 极简程序化音效（WebAudio 合成，不依赖任何音频素材文件）。
 * 之所以不用现成音效：一来避免引入来源不明的资源，二来随时可调、体积极小。
 */
window.AudioKit = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let whoosh = null;

  const init = () => {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  };

  const now = () => ctx.currentTime;

  const noise = ({ dur = 0.3, gain = 0.4, type = 'bandpass', f0 = 900, f1 = 300, q = 1.2, delay = 0 }) => {
    if (!init()) return;
    const t = now() + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  };

  const tone = ({ freq = 440, dur = 0.2, gain = 0.25, type = 'sine', glide = 0, delay = 0, attack = 0.008 }) => {
    if (!init()) return;
    const t = now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };

  const api = {
    unlock() {
      if (!init()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    stretch(power) {
      tone({ freq: 90 + power * 160, dur: 0.09, gain: 0.05 + power * 0.05, type: 'triangle' });
    },
    /** 弓拉满的一瞬间：只留一声干净提示音 */
    ready() {
      tone({ freq: 1046, dur: 0.2, gain: 0.2, type: 'sine' });
    },
    launch() {
      noise({ dur: 0.42, gain: 0.32, type: 'lowpass', f0: 1600, f1: 260 });
      tone({ freq: 520, glide: 140, dur: 0.28, gain: 0.14, type: 'triangle' });
    },
    flyStart() {
      if (!init() || whoosh) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 700;
      filt.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filt).connect(g).connect(master);
      src.start();
      whoosh = { src, g, filt };
    },
    flyLevel(speed01) {
      if (!whoosh) return;
      const v = Math.max(0, Math.min(1, speed01));
      whoosh.g.gain.value = v * 0.16;
      whoosh.filt.frequency.value = 500 + v * 1400;
    },
    flyStop() {
      if (!whoosh) return;
      const w = whoosh;
      whoosh = null;
      w.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => { try { w.src.stop(); } catch (e) { /* 已停止 */ } }, 220);
    },
    thud(strength = 1) {
      const s = Math.max(0.15, Math.min(1.4, strength));
      tone({ freq: 150 * s, glide: 60, dur: 0.16, gain: 0.3 * s, type: 'sine' });
      noise({ dur: 0.12, gain: 0.16 * s, type: 'bandpass', f0: 420, f1: 160, q: 0.9 });
    },
    crack() {
      noise({ dur: 0.26, gain: 0.34, type: 'bandpass', f0: 2400, f1: 500, q: 1.6 });
      tone({ freq: 300, glide: 120, dur: 0.2, gain: 0.16, type: 'square' });
    },
    glass() {
      noise({ dur: 0.35, gain: 0.26, type: 'highpass', f0: 2600, f1: 5200, q: 0.8 });
      for (let i = 0; i < 3; i++) {
        tone({ freq: 2200 + i * 700, glide: 1400 + i * 400, dur: 0.13, gain: 0.08, type: 'triangle', delay: i * 0.03 });
      }
    },
    stone() {
      noise({ dur: 0.22, gain: 0.3, type: 'bandpass', f0: 700, f1: 180, q: 1.1 });
      tone({ freq: 110, glide: 70, dur: 0.2, gain: 0.22, type: 'sine' });
    },
    pop() {
      tone({ freq: 640, glide: 1500, dur: 0.14, gain: 0.24, type: 'sine' });
      tone({ freq: 320, glide: 900, dur: 0.2, gain: 0.16, type: 'triangle', delay: 0.03 });
    },
    /** 冲刺奶蛋：一段上滑的呼啸 */
    dash() {
      noise({ dur: 0.45, gain: 0.26, type: 'bandpass', f0: 600, f1: 2600, q: 1.1 });
      tone({ freq: 380, glide: 1200, dur: 0.32, gain: 0.16, type: 'sawtooth' });
    },
    /** 分身：三颗音一起往上跳 */
    split() {
      [0, 0.05, 0.1].forEach((d, i) => tone({ freq: 520 + i * 180, glide: 900 + i * 260, dur: 0.18, gain: 0.14, type: 'triangle', delay: d }));
      noise({ dur: 0.2, gain: 0.12, type: 'highpass', f0: 1800, f1: 4200, q: 0.9 });
    },
    /** 爆炸：低频轰鸣 + 高频碎裂 */
    boom() {
      tone({ freq: 120, glide: 34, dur: 0.7, gain: 0.42, type: 'sine' });
      tone({ freq: 78, glide: 28, dur: 0.9, gain: 0.3, type: 'triangle', delay: 0.02 });
      noise({ dur: 0.55, gain: 0.34, type: 'lowpass', f0: 1800, f1: 180, q: 0.7 });
      noise({ dur: 0.3, gain: 0.16, type: 'highpass', f0: 2600, f1: 5200, q: 0.8, delay: 0.02 });
    },
    /** 奶泡落地 */
    plop() {
      tone({ freq: 300, glide: 90, dur: 0.22, gain: 0.24, type: 'sine' });
      noise({ dur: 0.18, gain: 0.14, type: 'bandpass', f0: 900, f1: 260, q: 1.4 });
    },
    /** 回旋奶蛋掉头：先"嘣"一下再往回呼啸 */
    boomer() {
      tone({ freq: 660, glide: 300, dur: 0.16, gain: 0.2, type: 'triangle' });
      tone({ freq: 300, glide: 820, dur: 0.32, gain: 0.14, type: 'sine', delay: 0.09 });
      noise({ dur: 0.4, gain: 0.14, type: 'bandpass', f0: 800, f1: 2400, q: 1.1, delay: 0.05 });
    },
    /** 开场动画的轻提示音 */
    intro(kind = 0) {
      const base = kind === 0 ? 392 : 523;
      tone({ freq: base, dur: 0.3, gain: 0.14, type: 'sine' });
      tone({ freq: base * 1.5, dur: 0.42, gain: 0.1, type: 'triangle', delay: 0.09 });
    },
    /** 过关进入下一关 */
    levelUp() {
      [523, 698, 880, 1174].forEach((f, i) => tone({ freq: f, dur: 0.26, gain: 0.18, type: 'triangle', delay: i * 0.09 }));
    },
    /** boss 登场：一声低吼 */
    roar() {
      tone({ freq: 96, glide: 58, dur: 1.1, gain: 0.4, type: 'sawtooth' });
      tone({ freq: 61, glide: 42, dur: 1.4, gain: 0.34, type: 'triangle', delay: 0.05 });
      noise({ dur: 1.0, gain: 0.2, type: 'lowpass', f0: 900, f1: 140, q: 0.7 });
      tone({ freq: 180, glide: 90, dur: 0.5, gain: 0.12, type: 'square', delay: 0.3 });
    },
    /** boss 被打疼了：闷哼 */
    bossHurt() {
      tone({ freq: 140, glide: 70, dur: 0.34, gain: 0.3, type: 'sawtooth' });
      tone({ freq: 90, glide: 52, dur: 0.42, gain: 0.22, type: 'triangle', delay: 0.04 });
    },
    /** boss 喊帮手（同时回血）：一声低吼往上挑 + 一串阴森的和弦 */
    bossSummon() {
      tone({ freq: 116, glide: 250, dur: 0.55, gain: 0.3, type: 'sawtooth' });
      tone({ freq: 58, glide: 120, dur: 0.6, gain: 0.22, type: 'triangle', delay: 0.03 });
      [392, 466, 587, 698].forEach((f, i) => tone({ freq: f, dur: 0.24, gain: 0.13, type: 'triangle', delay: 0.08 + i * 0.085 }));
      noise({ dur: 0.5, gain: 0.14, type: 'lowpass', f0: 520, f1: 180, q: 0.7, delay: 0.02 });
    },
    /** boss 摔下来：闷响 + 地动 */
    slam() {
      tone({ freq: 74, glide: 30, dur: 0.9, gain: 0.45, type: 'sine' });
      noise({ dur: 0.6, gain: 0.3, type: 'lowpass', f0: 700, f1: 120, q: 0.8 });
      tone({ freq: 120, glide: 48, dur: 0.5, gain: 0.2, type: 'triangle', delay: 0.03 });
    },
    /** boss 死了：拖长的大笑 */
    bossLaugh() {
      const notes = [520, 470, 520, 440, 480, 400, 440, 360];
      notes.forEach((f, i) => {
        tone({ freq: f, glide: f * 0.82, dur: 0.22, gain: 0.2, type: 'triangle', delay: i * 0.17 });
        tone({ freq: f * 0.5, glide: f * 0.4, dur: 0.2, gain: 0.1, type: 'sine', delay: i * 0.17 + 0.02 });
      });
    },
    /** 雷声（boss 关的气氛） */
    thunder() {
      noise({ dur: 1.6, gain: 0.24, type: 'lowpass', f0: 420, f1: 90, q: 0.6 });
      tone({ freq: 58, glide: 34, dur: 1.4, gain: 0.2, type: 'sine', delay: 0.02 });
      noise({ dur: 0.16, gain: 0.2, type: 'highpass', f0: 2400, f1: 5200, q: 0.7 });
    },
    laugh() {
      const base = 520;
      for (let i = 0; i < 4; i++) {
        tone({ freq: base + i * 60, glide: base + 40 + i * 60, dur: 0.1, gain: 0.16, type: 'triangle', delay: i * 0.11 });
      }
    },
    win() {
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => tone({ freq: f, dur: 0.28, gain: 0.22, type: 'triangle', delay: i * 0.11 }));
      noise({ dur: 0.5, gain: 0.1, type: 'highpass', f0: 3000, f1: 6000, delay: 0.1 });
    },
    lose() {
      tone({ freq: 440, glide: 300, dur: 0.3, gain: 0.2, type: 'triangle' });
      tone({ freq: 300, glide: 160, dur: 0.5, gain: 0.2, type: 'triangle', delay: 0.22 });
    },
  };
  return api;
})();
