/* audio.js — 桌面 3D 台球 / 斯诺克音效引擎
 *
 * 全部声音用 Web Audio 实时合成：无外部资源、无 fetch、无 base64，所以 index.html
 * 直接 file:// 打开也能出声。模块顶层零副作用（AudioContext 只在 unlock() 或第一次
 * 播放时惰性创建）；Web Audio 不可用时所有方法均为静默 no-op，绝不抛错。
 * ======================================================================== */

/** 音效名常量（play() 用） */
export const SFX = Object.freeze({
  BALL_BALL: 'ballBall',
  BALL_CUSHION: 'ballCushion',
  CUE_STRIKE: 'cueStrike',
  POCKET: 'pocket',
  POCKET_SOFT: 'pocketSoft',
  RAIL_HIT: 'railHit',
  FOUL: 'foul',
  POT: 'pot',
  WIN: 'win',
  LOSE: 'lose',
  UI_CLICK: 'uiClick',
  UI_HOVER: 'uiHover',
});

const MAX_VOICES = 8;            // 同时存活的合成“声部”上限，超了砍最轻的
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const rnd = (a, b) => a + Math.random() * (b - a);

/* -------------------------------------------------------------------------- */
export function createAudio(options = {}) {
  const presetCtx = options && options.context ? options.context : null;

  let ctx = null, master = null, comp = null, softClip = null;
  let convolver = null;        // 共享混响（惰性创建）
  let noiseBuffer = null;      // 共享白噪声（避免每次 new 一段 buffer）
  let shaperCurve = null;      // 蜂鸣器用的过驱动曲线
  let voices = [], voiceSeq = 0;
  let ambience = null, ambienceOn = false;
  let dead = false;            // WebAudio 不可用标记

  const api = {
    enabled: true,
    volume: 0.8,

    unlock,
    setEnabled,
    setVolume,
    play,
    ballBall,
    ballCushion,
    cueStrike,
    pocket,
    pocketSoft,
    railHit,
    foul,
    pot,
    win,
    lose,
    uiClick,
    uiHover,
    setAmbience,
    collisionQueue,
  };

  /* ===== 上下文 / 母线 ===== */

  function makeContext() {
    if (presetCtx) return presetCtx;
    const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
    if (!AC) return null;
    try {
      return new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try { return new AC(); } catch (e2) { return null; }
    }
  }

  /** tanh 过驱动曲线：drive 越大越“方”，out 压住最大输出 */
  function tanhCurve(drive, out, n) {
    const c = new Float32Array(n || 1024);
    const k = Math.tanh(drive);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = (Math.tanh(x * drive) / k) * out;
    }
    return c;
  }

  function ensure() {
    if (dead) return false;
    if (ctx) return true;
    ctx = makeContext();
    if (!ctx) { dead = true; return false; }
    try {
      // 母线链：master -> compressor(限幅) -> softClip -> destination
      master = ctx.createGain();
      master.gain.value = api.enabled ? api.volume : 0;

      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -8;   // dB
      comp.knee.value = 6;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;

      // 压缩器有 attack 时间，密集撞击时仍会有几个采样冲过 0dBFS；这一级 tanh
      // 把过冲压成温暖饱和，保证 20 次同时开撞也不会数字削顶。
      softClip = ctx.createWaveShaper();
      softClip.curve = tanhCurve(1.35, 0.86, 2048);
      softClip.oversample = '2x';

      master.connect(comp);
      comp.connect(softClip);
      softClip.connect(ctx.destination);
    } catch (e) {
      dead = true;
      ctx = null;
      return false;
    }
    if (ambienceOn) startAmbience();
    return true;
  }

  /** 惰性创建并共享卷积混响（IR 用衰减噪声直接填 AudioBuffer，不下载任何东西） */
  function ensureReverb() {
    if (convolver) return convolver;
    try {
      const rate = ctx.sampleRate || 48000;
      const dur = 1.6;
      const pre = Math.floor(rate * 0.006);           // 6ms 预延迟，听起来像有距离
      const len = Math.floor(rate * dur);
      const buf = ctx.createBuffer(2, len, rate);
      const tau = 0.55;                                // 指数衰减时间常数
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        // 用一阶低通把白噪声“压暗”一点，模拟空气和软质墙面吸收高频
        for (let i = 0; i < len; i++) {
          if (i < pre) { d[i] = 0; continue; }
          const t = (i - pre) / rate;
          const env = Math.exp(-t / tau) * (1 - t / dur) * (1 - t / dur);
          const n = Math.random() * 2 - 1;
          lp += 0.42 * (n - lp);                       // 单极点低通
          d[i] = lp * env;
        }
        // 几个离散早期反射，让空间感不只是“一团混响”
        const taps = [0.011, 0.017, 0.023, 0.031, 0.043];
        for (let k = 0; k < taps.length; k++) {
          const idx = pre + Math.floor(rate * taps[k] * (ch ? 1.07 : 1));
          if (idx < len) d[idx] += (k % 2 ? -1 : 1) * 0.35 / (k + 1);
        }
      }
      // 按 L2 范数归一化：让卷积输出的能量级和干声大致相当，方便调 wet
      let sum = 0;
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) sum += d[i] * d[i]; }
      const g = 1 / Math.max(1e-6, Math.sqrt(sum));
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= g; }
      convolver = ctx.createConvolver();
      convolver.buffer = buf;
      convolver.connect(master);
    } catch (e) {
      convolver = null;
    }
    return convolver;
  }

  /** 轻的撞击少送混响：否则安静的一碰会变成“一团房间声” */
  function reverbTaper(amp) {
    return clamp(0.30 + 0.70 * num(amp, 0.5), 0, 1);
  }

  function noiseBuf() {
    if (noiseBuffer) return noiseBuffer;
    const rate = ctx.sampleRate || 48000;
    const len = Math.floor(rate * 2.0);
    const buf = ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  }

  function biquad(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.max(20, Math.min((ctx.sampleRate || 48000) * 0.45, freq));
    if (q != null) f.Q.value = q;
    return f;
  }

  /** 打击型包络：极小 attack + 指数衰减（比线性衰减更“脆”） */
  function env(gainNode, t, peak, attack, decay) {
    const p = Math.max(peak, 1e-4);
    const a = Math.max(attack, 0.0004);
    const g = gainNode.gain;
    g.setValueAtTime(0.00001, t);
    g.exponentialRampToValueAtTime(p, t + a);
    const e = t + a + Math.max(decay, 0.004);
    g.exponentialRampToValueAtTime(0.0003, e);
    g.setValueAtTime(0, e + 0.0015);
    return e;
  }

  /* ===== 声部池：超过 8 个同时发声就丢掉最轻的那个，避免渲染线程爆掉 ===== */

  function beginVoice(amp, pan, send, life) {
    const now = ctx.currentTime;
    voices = voices.filter((v) => v.end > now - 0.03);

    const g = ctx.createGain();
    g.gain.value = 1;
    let out = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(num(pan, 0), -1, 1);
      g.connect(p);
      out = p;
    }
    out.connect(master);

    if (send > 0) {
      const rev = ensureReverb();
      if (rev) {
        const wet = ctx.createGain();
        wet.gain.value = clamp(send, 0, 1);
        out.connect(wet);
        wet.connect(rev);
      }
    }

    const v = {
      id: ++voiceSeq,
      g,
      amp: clamp(num(amp, 0.4), 0.0001, 1.5),
      sources: [],
      end: now + Math.max(0.06, num(life, 0.45)),
      dead: false,
    };
    voices.push(v);

    while (voices.length > MAX_VOICES) {
      let idx = 0;
      for (let i = 1; i < voices.length; i++) {
        if (voices[i].amp < voices[idx].amp) idx = i;
      }
      killVoice(voices.splice(idx, 1)[0], now);
    }
    return v;
  }

  function killVoice(v, now) {
    v.dead = true;
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(Math.max(v.g.gain.value, 0.0001), now);
      v.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.01);
      v.g.gain.setValueAtTime(0, now + 0.014);
    } catch (e) { /* 忽略 */ }
    for (let i = 0; i < v.sources.length; i++) {
      try { v.sources[i].stop(now + 0.02); } catch (e) { /* 已停止 */ }
    }
  }

  /* ===== 基础发声元件（全部挂到某个 voice 上） ===== */

  /** 带包络的噪声段：o = {hp, lp, bp, q, rate} */
  function noiseHit(v, t, peak, attack, decay, o) {
    const opt = o || {};
    const dur = Math.max(attack, 0.0004) + Math.max(decay, 0.004) + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf();
    src.playbackRate.value = clamp(num(opt.rate, 1) * rnd(0.92, 1.08), 0.25, 4);

    let node = src;
    if (opt.hp) { const f = biquad('highpass', opt.hp, num(opt.q, 0.7)); node.connect(f); node = f; }
    if (opt.bp) { const f = biquad('bandpass', opt.bp, num(opt.bq, 1.1)); node.connect(f); node = f; }
    if (opt.lp) { const f = biquad('lowpass', opt.lp, num(opt.lq, 0.8)); node.connect(f); node = f; }

    const g = ctx.createGain();
    node.connect(g);
    g.connect(v.g);
    const e = env(g, t, peak, attack, decay);
    // 每次随机取噪声片段：同一句撞击重复 20 次也不会听成“同一段”
    src.start(t, Math.random() * Math.max(0, src.buffer.duration - dur * 2 - 0.05));
    src.stop(e + 0.03);
    v.sources.push(src); v.end = Math.max(v.end, e + 0.05);
    return g;
  }

  /** 单音：opt = {type, f2, glide, drift, detune} */
  function tone(v, t, f, peak, attack, decay, o) {
    const opt = o || {};
    const osc = ctx.createOscillator();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, f), t);
    if (opt.f2) {
      const end = t + Math.max(0.01, num(opt.glide, decay * 0.9));
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f2), end);
    } else if (opt.drift) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * (1 + opt.drift)), t + Math.max(0.01, decay * 0.8));
    }
    if (opt.detune) osc.detune.value = opt.detune;
    const g = ctx.createGain();
    osc.connect(g); g.connect(v.g);
    const e = env(g, t, peak, attack, decay);
    osc.start(t); osc.stop(e + 0.03);
    v.sources.push(osc); v.end = Math.max(v.end, e + 0.05);
    return osc;
  }

  /* ===== 事件合成 ===== */

  /** 酚醛树脂球对撞：宽带咔哒 + 3 个高 Q 谐振分音 + 低频体感闷响 */
  function ballBall(opts) {
    if (!ensure() || !api.enabled) return;
    const o = opts || {};
    const speed = clamp(num(o.speed, 4), 0, 10);
    const s = speed / 10;
    const amp = 0.34 + 0.66 * Math.pow(s, 0.78);
    // 快球更亮更响、音高略高；每颗球、每次碰撞都 ±3% 抖动
    const pf = (1 + 0.06 * s) * (1 + rnd(-0.03, 0.03));
    const bright = 0.30 + 0.70 * s;
    const v = beginVoice(amp, o.pan, 0.18 * reverbTaper(amp), 0.5);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;   // 别调度在 0 时刻，否则可能爆音

    // 1) 极短宽带 click（2–6 kHz）
    noiseHit(v, t, 0.55 * amp * (0.72 + 0.45 * s), 0.0006, 0.0055 + 0.002 * s, {
      hp: 1600, lp: 6800, q: 0.7, rate: 1.0,
    });
    // 2) 三个高 Q 谐振分音（正弦本身 Q 无穷大，用极快指数衰减模拟模态振铃）
    const parts = [1800, 3200, 4600];
    const pGain = [0.34, 0.24, 0.13];
    const pDec = [0.062, 0.044, 0.030];
    for (let i = 0; i < 3; i++) {
      const f = parts[i] * pf * rnd(0.985, 1.015);
      tone(v, t + i * 0.0004, f, pGain[i] * amp * bright, 0.0006, pDec[i] * rnd(0.85, 1.2), {
        type: 'sine', drift: -0.02,   // 碰撞后瞬间张力释放，频率轻微下滑
      });
    }
    // 3) 150–250 Hz 的球体闷响，给“有重量”的感觉
    tone(v, t, 150 + 100 * s + rnd(-6, 6), 0.28 * amp * (0.5 + 0.5 * s), 0.0012, 0.055 + 0.03 * s, {
      type: 'sine', drift: -0.12,
    });
  }

  /** 库边橡胶：低通噪声 + 120 Hz 闷响，比球碰球暗得多 */
  function ballCushion(opts) {
    if (!ensure() || !api.enabled) return;
    const o = opts || {};
    const s = clamp(num(o.speed, 3), 0, 10) / 10;
    const amp = 0.22 + 0.58 * Math.pow(s, 0.8);
    const v = beginVoice(amp, o.pan, 0.18 * reverbTaper(amp), 0.4);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    // 截止频率跟着撞击力度走：轻碰 700Hz，重碰 1100Hz
    noiseHit(v, t, 0.5 * amp, 0.0015, 0.045 + 0.03 * s, {
      lp: 700 + 400 * s, lq: 0.9, bp: 420, bq: 0.7,
    });
    // 橡胶的“弹”感来自这个 120Hz 的短促低频
    tone(v, t, 118 + 14 * s, 0.34 * amp, 0.002, 0.05 + 0.025 * s, {
      type: 'sine', drift: -0.18,
    });
  }

  /** 皮头击球：高频瞬态 + 皮革中频 + 球杆木材敲击 */
  function cueStrike(opts) {
    if (!ensure() || !api.enabled) return;
    const o = opts || {};
    const p = clamp(num(o.power, 0.5), 0, 1);
    const amp = 0.26 + 0.72 * Math.pow(p, 0.9);
    const v = beginVoice(amp, o.pan, 0.10, 0.4);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    // 1) 击球瞬间的高频“啪”
    noiseHit(v, t, 0.52 * amp, 0.0008, 0.03 + 0.012 * p, { hp: 1800, lp: 9000, q: 0.7 });
    // 2) 皮革皮头的窄中频带（1 kHz 附近），让击球不像纯电子枪声
    noiseHit(v, t + 0.0007, 0.24 * amp, 0.0012, 0.035, { bp: 1050, bq: 1.7 });
    // 3) 球杆木材敲击：两个正弦模态，衰减极快
    const wood = 1 + rnd(-0.02, 0.02);
    tone(v, t, 180 * wood, 0.30 * amp, 0.0009, 0.026, { type: 'sine', drift: -0.05 });
    tone(v, t, 420 * wood, 0.15 * amp, 0.0008, 0.018, { type: 'sine', drift: -0.05 });
    // 4) 很轻的 90 Hz，给桌面一点“扎实”的反馈
    tone(v, t, 92, 0.16 * amp * (0.4 + 0.6 * p), 0.002, 0.045, { type: 'sine', drift: -0.1 });
  }

  /** 落袋：袋口衬垫塑料/皮革咔哒 + 220→70Hz 下坠 + 低频隆隆尾 */
  function pocket(opts) {
    if (!ensure() || !api.enabled) return;
    const o = opts || {};
    const s = clamp(num(o.speed, 4), 0, 10) / 10;
    const amp = 0.42 + 0.58 * s;
    const v = beginVoice(amp, o.pan, 0.18 * reverbTaper(amp), 1.2);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    // 1.2kHz 附近的袋口衬垫“嗒”——再补一个 45ms 后的第二响（球在袋兜里颠一下）
    noiseHit(v, t, 0.44 * amp, 0.0012, 0.045, { bp: 1200, bq: 2.0 });
    noiseHit(v, t + 0.045, 0.22 * amp, 0.002, 0.05, { bp: 980, bq: 1.6, rate: 1.1 });
    // 下坠：220 → 70 Hz，180ms
    tone(v, t + 0.012, 220, 0.42 * amp, 0.004, 0.19, { type: 'sine', f2: 70, glide: 0.18 });
    // 噪声轰隆尾（球滚进袋底的那一下）
    noiseHit(v, t + 0.03, 0.20 * amp, 0.02, 0.42, { lp: 380, lq: 0.9, bp: 160, bq: 0.6 });
  }

  /** 轻轻滚进袋：只有软着陆的闷响和一点塑料壳声 */
  function pocketSoft(opts) {
    if (!ensure() || !api.enabled) return;
    const o = opts || {};
    const v = beginVoice(0.34, o.pan, 0.14, 0.6);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    noiseHit(v, t, 0.16, 0.002, 0.06, { bp: 760, bq: 1.4 });
    tone(v, t + 0.006, 132, 0.24, 0.004, 0.15, { type: 'sine', f2: 88, glide: 0.13 });
    noiseHit(v, t + 0.02, 0.10, 0.015, 0.22, { lp: 420, lq: 0.8, bp: 180, bq: 0.6 });
  }

  /** 球撞袋口颚板，晃晃悠悠的那一声 */
  function railHit(opts) {
    if (!ensure() || !api.enabled) return;
    const o = opts || {};
    const v = beginVoice(0.46, o.pan, 0.16, 0.35);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    noiseHit(v, t, 0.34, 0.0008, 0.022, { bp: 1500, bq: 1.2, hp: 700 });
    tone(v, t, 640 * rnd(0.95, 1.05), 0.20, 0.001, 0.045, { type: 'sine', drift: -0.08 });
    tone(v, t + 0.012, 300 * rnd(0.95, 1.05), 0.12, 0.002, 0.05, { type: 'sine', drift: -0.1 });
  }

  /** 犯规：下行双音蜂鸣，带一点软削波的毛边 */
  function foul() {
    if (!ensure() || !api.enabled) return;
    const v = beginVoice(0.55, 0, 0.12, 0.9);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    // 过驱动曲线：把两路正弦挤成近方波，谐波才像廉价蜂鸣器
    if (!shaperCurve) shaperCurve = tanhCurve(3.2, 0.9);
    const shaped = ctx.createWaveShaper();
    shaped.curve = shaperCurve;
    const lp = biquad('lowpass', 2300, 0.8);
    const g = ctx.createGain();
    shaped.connect(lp);
    lp.connect(g);
    g.connect(v.g);
    const end = env(g, t, 0.5, 0.006, 0.5);   // 整条蜂鸣的包络

    const mk = (freq, peak) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';                 // 由 WaveShaper 负责把正弦“失真”成方波感
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.setValueAtTime(freq * 0.72, t + 0.22);  // 第二段下行
      const og = ctx.createGain();
      og.gain.value = peak;
      osc.connect(og);
      og.connect(shaped);
      osc.start(t);
      osc.stop(end + 0.03);
      v.sources.push(osc);
    };
    mk(324, 0.85);
    mk(328, 0.7);          // 两路轻微失谐 -> 蜂鸣器的拍频
    v.end = Math.max(v.end, end + 0.08);
  }

  /** 合法进球：短促上行确认音 */
  function pot() {
    if (!ensure() || !api.enabled) return;
    const v = beginVoice(0.4, 0, 0.26, 0.8);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;

    tone(v, t, 1046.5, 0.26, 0.002, 0.14, { type: 'sine' });
    tone(v, t, 2093, 0.07, 0.002, 0.09, { type: 'sine' });
    tone(v, t + 0.075, 1568, 0.24, 0.002, 0.26, { type: 'sine' });
    tone(v, t + 0.075, 3136, 0.05, 0.002, 0.16, { type: 'sine' });
  }

  /** 胜利：明亮的上行琶音 + 混响尾 */
  function win() {
    if (!ensure() || !api.enabled) return;
    const v = beginVoice(0.5, 0, 0.32, 2.0);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;
    const notes = [523.25, 659.25, 783.99, 1046.5];   // C5 E5 G5 C6

    for (let i = 0; i < notes.length; i++) {
      const nt = t + i * 0.085;
      const last = i === notes.length - 1;
      const dec = last ? 0.85 : 0.34;
      tone(v, nt, notes[i], last ? 0.24 : 0.19, 0.004, dec, { type: 'triangle' });
      tone(v, nt, notes[i] * 2, last ? 0.07 : 0.055, 0.004, dec * 0.7, { type: 'sine' });
      // 每颗音加一点点五度泛音，听上去更像钟而不是纯正弦
      tone(v, nt, notes[i] * 1.5, 0.05, 0.004, dec * 0.5, { type: 'sine' });
    }
  }

  /** 失败：A 小调下行，音色比胜利暗 */
  function lose() {
    if (!ensure() || !api.enabled) return;
    const v = beginVoice(0.62, 0, 0.22, 1.8);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;
    const notes = [329.63, 261.63, 220.0];            // E4 C4 A3

    for (let i = 0; i < notes.length; i++) {
      const nt = t + i * 0.18;
      const last = i === notes.length - 1;
      tone(v, nt, notes[i], last ? 0.22 : 0.18, 0.012, last ? 0.7 : 0.3, { type: 'triangle' });
      tone(v, nt, notes[i] * 0.5, 0.09, 0.015, last ? 0.6 : 0.28, { type: 'sine' });
    }
    // 底下垫一个缓慢下行的低频，让“输”更有重量
    tone(v, t, 110, 0.12, 0.04, 0.9, { type: 'sine', f2: 82, glide: 0.85 });
  }

  /** UI 点击 */
  function uiClick() {
    if (!ensure() || !api.enabled) return;
    const v = beginVoice(0.20, 0, 0.05, 0.2);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;
    noiseHit(v, t, 0.26, 0.0006, 0.006, { hp: 2800, q: 0.7 });
    tone(v, t, 1600, 0.20, 0.001, 0.018, { type: 'sine', drift: -0.1 });
  }

  /** UI 悬停：更轻 */
  function uiHover() {
    if (!ensure() || !api.enabled) return;
    const v = beginVoice(0.12, 0, 0.03, 0.15);
    if (v.dead) return;
    const t = ctx.currentTime + 0.0015;
    tone(v, t, 2400, 0.16, 0.001, 0.014, { type: 'sine' });
    noiseHit(v, t, 0.10, 0.0005, 0.005, { hp: 4000, q: 0.7 });
  }

  /* ===== 环境底噪（默认关） ===== */

  function startAmbience() {
    if (ambience || !ctx) return;
    try {
      // 极轻的房间底噪：循环噪声过 420Hz 低通 + 很慢的 LFO，避免“死寂”
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf();
      src.loop = true;
      const lp = biquad('lowpass', 420, 0.7);
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(lp);
      lp.connect(g);
      g.connect(master);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.0011;
      lfo.connect(lfoAmt);
      lfoAmt.connect(g.gain);

      // 工频哼声：60Hz 主音 + 二次谐波，各带一点失谐制造缓慢拍频
      const hums = [];
      const humSpec = [[60, 0.00062], [120, 0.00026], [59.6, 0.00022]];
      for (let i = 0; i < humSpec.length; i++) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = humSpec[i][0];
        const og = ctx.createGain();
        og.gain.value = humSpec[i][1];
        o.connect(og);
        og.connect(master);
        o.start();
        hums.push(o);
      }

      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.0050, now + 1.6);  // ≈ -46 dB
      src.start(now);
      lfo.start(now);
      ambience = { src, lfo, g, hums };
      ambienceOn = true;
    } catch (e) {
      ambience = null;
    }
  }

  function stopAmbience() {
    ambienceOn = false;
    const a = ambience;
    ambience = null;
    if (!a || !ctx) return;
    try {
      const now = ctx.currentTime;
      a.g.gain.cancelScheduledValues(now);
      a.g.gain.setValueAtTime(Math.max(a.g.gain.value, 0.0001), now);
      a.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      a.src.stop(now + 0.3);
      a.lfo.stop(now + 0.3);
      for (let i = 0; i < a.hums.length; i++) a.hums[i].stop(now + 0.3);
    } catch (e) { /* 忽略 */ }
  }

  /* ===== 公共 API ===== */

  function unlock() {
    if (!ensure()) return;
    // file:// 下 Safari/Chrome 都要求用户手势后再 resume
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* 忽略 */ }
    }
    if (ambienceOn) startAmbience();
  }

  function setEnabled(on) {
    if (arguments.length === 0) return api.enabled;
    api.enabled = !!on;
    if (ctx && master) {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setTargetAtTime(api.enabled ? api.volume : 0, ctx.currentTime, 0.02);
      } catch (e) {
        master.gain.value = api.enabled ? api.volume : 0;
      }
    }
    return api.enabled;
  }

  function setVolume(v) {
    const val = clamp(num(v, api.volume), 0, 1);
    api.volume = val;
    if (ctx && master) {
      try {
        master.gain.setTargetAtTime(api.enabled ? val : 0, ctx.currentTime, 0.02);
      } catch (e) {
        master.gain.value = api.enabled ? val : 0;
      }
    }
    return val;
  }

  function setAmbience(on) {
    const want = !!on;
    if (!want) { stopAmbience(); return; }
    if (!ensure()) return;
    startAmbience();
  }

  // play() 的别名表：兼容物理引擎常用的 'Collision' / 'Cushion' 之类大写名字
  const NAME_MAP = {
    ballball: ballBall, collision: ballBall, 'ball-ball': ballBall,
    ballcushion: ballCushion, cushion: ballCushion, 'ball-cushion': ballCushion,
    cuestrike: cueStrike, cue: cueStrike,
    pocket, potted: pocket, pocketsoft: pocketSoft,
    railhit: railHit, rail: railHit, jaw: railHit,
    foul, fault: foul, pot, score: pot,
    win, victory: win, lose, defeat: lose,
    uiclick: uiClick, click: uiClick, uihover: uiHover, hover: uiHover,
  };

  function play(name, opts) {
    if (typeof name !== 'string') return;
    const key = name.toLowerCase();
    const fn = Object.prototype.hasOwnProperty.call(NAME_MAP, key) && NAME_MAP[key];
    if (typeof fn === 'function') {
      try { fn(opts || {}); } catch (e) { /* 音效永远不该把游戏搞崩 */ }
    }
  }

  /** 便利函数：把物理引擎的碰撞事件数组翻译成音效 */
  function collisionQueue(events) {
    if (!events || typeof events.length !== 'number') return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e) continue;
      const type = e.type;
      const opts = { speed: e.speed, pan: e.pan };
      if (type === 'Collision') ballBall(opts);
      else if (type === 'Cushion') ballCushion(opts);
      else if (type === 'Pot') {
        // 物理层面的落袋声 = pocket()；如果事件带 scored:true，再补一声得分确认音
        pocket(opts);
        if (e.scored === true) pot();
      }
    }
  }

  return api;
}

