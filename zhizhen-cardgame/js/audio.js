/* ==========================================================================
   audio.js — 纯 WebAudio 程序化音频（零素材文件）
   目标：有实体感的"塑料卡牌 + 电子合成器"混合音色
   ========================================================================== */

const NOTE = {
  A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, G3: 196,
  A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
  F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25,
  D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5
};

// 五声音阶，选牌时音高逐级上行
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicNodes = [];
    this._musicTimer = null;
    this._step = 0;
  }

  /* ---------------- 初始化（必须由用户手势触发） ---------------- */
  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    // 主链：bus → 压缩 → 输出
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // 混响：程序生成脉冲响应
    this.rev = ctx.createConvolver();
    this.rev.buffer = this._makeIR(2.4, 3.2);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.3;
    this.rev.connect(this.revGain);
    this.revGain.connect(this.master);

    // 干声总线（同时送混响）
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.master);
    this.bus.connect(this.rev);

    this.noiseBuf = this._makeNoise(2.0);

    // 淡入，避免爆音
    this.master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 0.7);
    if (ctx.state === 'suspended') ctx.resume();
    this.startMusic();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    if (!this.ctx) return;
    this.muted = !this.muted;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime + 0.2);
    return this.muted;
  }

  /* ---------------- 底层构件 ---------------- */
  _makeNoise(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeIR(sec, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  /** 单个振荡器音符 */
  tone(o = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.15;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.freq || 440), t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur * (o.glide ?? 1));

    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.fCut || 1200, t0);
      if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, t0 + dur);
      f.Q.value = o.q || 1;
      node.connect(f); node = f;
    }

    const g = ctx.createGain();
    const peak = o.gain ?? 0.12;
    const atk = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    if (o.sustain) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * o.sustain), t0 + dur * 0.5);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g);
    g.connect(o.wet ? this.rev : this.bus);

    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
    return { osc, gain: g };
  }

  /** 噪声（咔嗒 / 呼啸 / 摩擦） */
  hiss(o = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.14;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate || 1;

    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.from || 1800, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + dur);
    f.Q.value = o.q ?? 1.2;

    const g = ctx.createGain();
    const peak = o.gain ?? 0.14;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(f); f.connect(g); g.connect(o.wet ? this.rev : this.bus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ---------------- 具体音效 ---------------- */

  // 发牌：塑料摩擦 + 落桌轻响
  deal(i = 0) {
    if (!this.ctx) return;
    const d = Math.min(i, 9) * 0.004;
    this.hiss({ from: 3200, to: 900, dur: 0.075, gain: 0.075, q: 0.8, delay: d });
    this.tone({ freq: 190 + i * 12, to: 120, type: 'triangle', dur: 0.09, gain: 0.055, delay: d + 0.02 });
  }

  hover() {
    this.tone({ freq: 1500, to: 1750, type: 'sine', dur: 0.045, gain: 0.022 });
  }

  // 选牌：音高随选中数量上行
  select(n) {
    const semi = PENTA[Math.min(PENTA.length - 1, n)];
    const f = 392 * Math.pow(2, semi / 12);
    this.tone({ freq: f, to: f * 1.02, type: 'triangle', dur: 0.11, gain: 0.09 });
    this.tone({ freq: f * 2, type: 'sine', dur: 0.07, gain: 0.035 });
    this.hiss({ from: 5000, to: 2200, dur: 0.05, gain: 0.035, q: 1.6 });
  }

  deselect() {
    this.tone({ freq: 520, to: 330, type: 'triangle', dur: 0.1, gain: 0.06 });
  }

  // 出牌：一记低频推动
  play() {
    this.hiss({ from: 700, to: 220, dur: 0.26, gain: 0.13, q: 0.9 });
    this.tone({ freq: 150, to: 54, type: 'sine', dur: 0.3, gain: 0.2 });
    this.tone({ freq: 300, to: 108, type: 'triangle', dur: 0.18, gain: 0.07 });
  }

  // 计分：筹码跳动，音高随序号上行
  chip(i = 0) {
    const f = 1046 * Math.pow(2, (i % 12) / 24);
    this.tone({ freq: f, type: 'square', dur: 0.045, gain: 0.035 });
    this.tone({ freq: f * 1.5, type: 'sine', dur: 0.06, gain: 0.045 });
  }

  // 倍率上升：锯齿扫频
  multUp(v = 1) {
    const base = 180 + Math.min(v, 20) * 22;
    this.tone({ freq: base, to: base * 4.2, type: 'sawtooth', dur: 0.24, gain: 0.055, filter: 'lowpass', fCut: 2400, q: 4 });
    this.tone({ freq: base * 2, to: base * 6, type: 'square', dur: 0.18, gain: 0.025 });
  }

  // 小丑触发：闪亮的琶音
  joker(i = 0) {
    const root = 523.25 * Math.pow(2, (i % 4) / 12);
    [0, 4, 7, 12].forEach((s, k) => {
      this.tone({
        freq: root * Math.pow(2, s / 12), type: 'triangle', dur: 0.26,
        gain: 0.05, delay: k * 0.033, wet: true,
        filter: 'lowpass', fCut: 5200
      });
    });
  }

  // 牌型成立
  handUp(level = 0) {
    const root = 261.63 * Math.pow(2, Math.min(level, 6) / 12);
    [0, 7, 12, 16].forEach((s, k) => {
      this.tone({
        freq: root * Math.pow(2, s / 12), type: 'triangle', dur: 0.5,
        gain: 0.075, delay: k * 0.045, attack: 0.01, wet: true
      });
    });
  }

  // 总分结算：冲击 + 上扫
  slam(power = 1) {
    this.tone({ freq: 220, to: 40, type: 'sine', dur: 0.5, gain: 0.3 });
    this.hiss({ from: 4200, to: 300, dur: 0.5, gain: 0.16, q: 0.6 });
    const n = 5;
    for (let i = 0; i < n; i++) {
      this.tone({
        freq: 440 * Math.pow(2, (i * 3) / 12), type: 'square', dur: 0.12,
        gain: 0.03 + 0.02 * power, delay: 0.03 + i * 0.045, wet: true
      });
    }
  }

  click() {
    this.tone({ freq: 720, to: 560, type: 'square', dur: 0.045, gain: 0.05 });
    this.hiss({ from: 4000, to: 1500, dur: 0.03, gain: 0.03, q: 2 });
  }

  coin() {
    this.tone({ freq: 1318, type: 'square', dur: 0.06, gain: 0.05 });
    this.tone({ freq: 1760, type: 'square', dur: 0.09, gain: 0.045, delay: 0.055, wet: true });
  }

  buy() {
    [0, 4, 7, 12, 16].forEach((s, i) => {
      this.tone({ freq: 392 * Math.pow(2, s / 12), type: 'triangle', dur: 0.3, gain: 0.06, delay: i * 0.05, wet: true });
    });
  }

  win() {
    const seq = [0, 4, 7, 12, 16, 19, 24];
    seq.forEach((s, i) => {
      this.tone({
        freq: 261.63 * Math.pow(2, s / 12), type: 'triangle',
        dur: 0.7, gain: 0.085, delay: i * 0.085, attack: 0.012, wet: true
      });
    });
    this.hiss({ from: 900, to: 6000, dur: 0.6, gain: 0.05, q: 0.7 });
  }

  lose() {
    [0, -2, -5, -9, -14].forEach((s, i) => {
      this.tone({
        freq: 261.63 * Math.pow(2, s / 12), type: 'sawtooth',
        dur: 0.9, gain: 0.06, delay: i * 0.13, wet: true,
        filter: 'lowpass', fCut: 1600, fTo: 400
      });
    });
    this.tone({ freq: 110, to: 42, type: 'sine', dur: 1.2, gain: 0.14, delay: 0.2 });
  }

  // 弃牌：快速甩出
  discard() {
    this.hiss({ from: 2600, to: 400, dur: 0.3, gain: 0.12, q: 0.7 });
    this.tone({ freq: 240, to: 90, type: 'triangle', dur: 0.22, gain: 0.07 });
  }

  /* ---------------- 环境铺底（生成式和弦） ---------------- */
  startMusic() {
    if (this._musicTimer) return;
    const chords = [
      [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3],   // Am7
      [NOTE.F4 / 2, NOTE.A3, NOTE.C4, NOTE.E4], // Fmaj7
      [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3],   // Cmaj7
      [NOTE.G3 / 2, NOTE.B3, NOTE.D4, NOTE.E4]  // G6
    ];
    const playChord = () => {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const ch = chords[this._step % chords.length];
      const t0 = ctx.currentTime + 0.05;
      const dur = 7.4;

      ch.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = f;
        osc.detune.value = (Math.random() - 0.5) * 8;

        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(520, t0);
        flt.frequency.linearRampToValueAtTime(1500, t0 + dur * 0.45);
        flt.frequency.linearRampToValueAtTime(600, t0 + dur);

        const g = ctx.createGain();
        const peak = i === 0 ? 0.05 : 0.028;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 1.5);
        g.gain.linearRampToValueAtTime(peak * 0.6, t0 + dur * 0.7);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

        osc.connect(flt); flt.connect(g); g.connect(this.rev); g.connect(this.bus);
        osc.start(t0); osc.stop(t0 + dur + 0.1);
      });

      this._step++;
    };
    playChord();
    this._musicTimer = setInterval(playChord, 6600);
  }
}

export const sfx = new Sound();
