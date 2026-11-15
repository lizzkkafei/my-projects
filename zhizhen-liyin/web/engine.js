/* 理音 Liyin Studio — Web Audio 引擎
   负责：走带、合成器音色、鼓机、发送总线、电平表、录音、离线渲染导出
   纯原生 Web Audio，无第三方依赖。 */
window.Engine = (function () {
  "use strict";

  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midiFromName(name) {
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if (!m) return 60;
    const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
    return 12 * (parseInt(m[3], 10) + 1) + NOTE[m[1]] + acc;
  }
  function freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  const state = {
    ctx: null,
    master: null,
    comp: null,
    masterAnalyser: null,
    analyserL: null,
    analyserR: null,
    sendReverb: null,
    sendDelay: null,
    reverb: null,
    delay: null,
    noise: null,
    project: null,
    tracks: {},          // id -> {gain, pan, analyser, revSend, dlySend}
    buffers: {},         // mediaId -> AudioBuffer
    events: [],
    audioRegions: [],
    scheduledAudio: new Set(),
    nextIdx: 0,
    playing: false,
    paused: false,
    startCtxTime: 0,
    startBeat: 0,
    bpm: 72,
    bars: 68,
    cycle: false,
    loopStartBar: 29,
    loopEndBar: 36,
    metro: false,
    countIn: false,
    activeSources: [],
    scheduler: null,
    onTick: null,
    recordStream: null,
    recorder: null,
    recordChunks: [],
    recordAnalyser: null,
    recordStartAt: 0,
    recordSrc: null,
    monitorGain: null,
    monitorOn: false,
    automationActive: false
  };

  function init() {
    if (state.ctx) return state.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    state.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);
    state.master = master;
    state.comp = comp;
    state.masterAnalyser = analyser;

    // 立体声主表：用两路 split 分析
    const split = ctx.createChannelSplitter(2);
    analyser.connect(split);
    const aL = ctx.createAnalyser(); aL.fftSize = 512;
    const aR = ctx.createAnalyser(); aR.fftSize = 512;
    split.connect(aL, 0); split.connect(aR, 1);
    state.analyserL = aL; state.analyserR = aR;

    // 发送：混响 + 延迟
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(2.6, 2.2);
    const rev = ctx.createGain(); rev.gain.value = 0.55;
    conv.connect(rev); rev.connect(master);
    state.reverb = conv;

    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = 0.36;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlyTone = ctx.createBiquadFilter(); dlyTone.type = "lowpass"; dlyTone.frequency.value = 2400;
    delay.connect(dlyTone); dlyTone.connect(fb); fb.connect(delay);
    const dlyOut = ctx.createGain(); dlyOut.gain.value = 0.5;
    delay.connect(dlyOut); dlyOut.connect(master);
    state.delay = delay;

    // 噪声缓冲（鼓）
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    state.noise = buf;

    return ctx;
  }

  function makeImpulse(seconds, decay) {
    const ctx = state.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / seconds, decay) * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    return buf;
  }

  function ensureCtx() {
    init();
    if (state.ctx.state === "suspended") state.ctx.resume();
    return state.ctx;
  }

  /* ── 工程 / 轨道节点 ─────────────────────── */
  function setProject(project) {
    ensureCtx();
    state.project = project;
    state.bpm = project.meta.bpm;
    state.bars = project.meta.bars;
    buildTracks(project.tracks);
    buildEvents(project);
  }

  function buildTracks(tracks) {
    const ctx = state.ctx;
    Object.keys(state.tracks).forEach(id => {
      const t = state.tracks[id];
      try { t.gain.disconnect(); } catch (e) {}
    });
    state.tracks = {};
    tracks.forEach(track => {
      const g = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const an = ctx.createAnalyser(); an.fftSize = 256;
      const rev = ctx.createGain(); rev.gain.value = 0;
      const dly = ctx.createGain(); dly.gain.value = 0;
      if (pan) { g.connect(pan); pan.connect(an); an.connect(state.master); }
      else { g.connect(an); an.connect(state.master); }
      g.connect(rev); rev.connect(state.reverb);
      g.connect(dly); dly.connect(state.delay);
      state.tracks[track.id] = { gain: g, pan, analyser: an, revSend: rev, dlySend: dly };
      applyTrackParams(track);
    });
  }

  /* ── 自动化 ───────────────────────────────── */
  const AUTO_PARAMS = ["volume", "pan", "rev", "dly"];

  /** 取某参数在某拍的值（线性插值，两端保持）。points: [{beat, value}] 已按 beat 升序 */
  function automationValueAt(points, beat) {
    if (!points || !points.length) return null;
    if (beat <= points[0].beat) return points[0].value;
    const last = points[points.length - 1];
    if (beat >= last.beat) return last.value;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (beat >= a.beat && beat <= b.beat) {
        const span = b.beat - a.beat;
        if (span <= 1e-9) return b.value;
        const t = (beat - a.beat) / span;
        return a.value + (b.value - a.value) * t;
      }
    }
    return last.value;
  }

  /** 某轨道某参数是否启用了自动化（>=2 个点） */
  function hasAutomation(track, param) {
    const lane = track.automation && track.automation[param];
    return !!(lane && lane.length >= 2);
  }

  function automationActive(track) {
    return AUTO_PARAMS.some(p => hasAutomation(track, p));
  }

  /** 播放时按当前拍把自动化值写进音频节点 */
  function pumpAutomation(curBeat) {
    if (!state.project) return;
    const now = state.ctx.currentTime;
    state.project.tracks.forEach(track => {
      const n = state.tracks[track.id];
      if (!n) return;
      const vol = automationValueAt(track.automation && track.automation.volume, curBeat);
      if (vol !== null && hasAutomation(track, "volume")) {
        const anySolo = state.project.tracks.some(t => t.solo);
        const muted = track.mute || (anySolo && !track.solo);
        n.gain.gain.setTargetAtTime(muted ? 0 : dbToLinear(vol), now, 0.03);
      }
      const pan = automationValueAt(track.automation && track.automation.pan, curBeat);
      if (pan !== null && hasAutomation(track, "pan") && n.pan) {
        n.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.03);
      }
      const rev = automationValueAt(track.automation && track.automation.rev, curBeat);
      if (rev !== null && hasAutomation(track, "rev")) {
        n.revSend.gain.setTargetAtTime(Math.max(0, Math.min(1, rev)) * 0.5, now, 0.05);
      }
      const dly = automationValueAt(track.automation && track.automation.dly, curBeat);
      if (dly !== null && hasAutomation(track, "dly")) {
        n.dlySend.gain.setTargetAtTime(Math.max(0, Math.min(1, dly)) * 0.45, now, 0.05);
      }
    });
  }

  function applyTrackParams(track) {
    const n = state.tracks[track.id];
    if (!n) return;
    const anySolo = (state.project ? state.project.tracks : []).some(t => t.solo) || false;
    const muted = track.mute || (anySolo && !track.solo);
    // 有自动化的参数由 pumpAutomation 接管，避免互相拉扯
    if (!hasAutomation(track, "volume")) {
      n.gain.gain.setTargetAtTime(muted ? 0 : dbToLinear(track.volume), state.ctx.currentTime, 0.02);
    } else {
      const beat = currentBeat();
      const v = automationValueAt(track.automation.volume, beat);
      n.gain.gain.setTargetAtTime(muted ? 0 : dbToLinear(v), state.ctx.currentTime, 0.02);
    }
    if (n.pan && !hasAutomation(track, "pan")) n.pan.pan.setTargetAtTime(track.pan || 0, state.ctx.currentTime, 0.02);
    if (!hasAutomation(track, "rev")) n.revSend.gain.setTargetAtTime((track.rev || 0) * 0.5, state.ctx.currentTime, 0.05);
    if (!hasAutomation(track, "dly")) n.dlySend.gain.setTargetAtTime((track.dly || 0) * 0.45, state.ctx.currentTime, 0.05);
  }

  function dbToLinear(db) {
    if (db <= -60) return 0;
    return Math.pow(10, db / 20);
  }

  /* ── 事件构建 ─────────────────────────────── */
  function buildEvents(project) {
    const spb = 60 / project.meta.bpm;
    const events = [];
    const audio = [];
    project.tracks.forEach(track => {
      (track.regions || []).forEach(region => {
        const baseBeat = (region.startBar - 1) * 4;
        if (track.type === "audio") {
          audio.push({ trackId: track.id, mediaId: region.mediaId, beat: baseBeat, durBeat: region.lengthBars * 4 });
          return;
        }
        if (track.type === "drum") {
          const rows = region.pattern || project.drumPattern[project.meta.drumKit || "studio"];
          const bars = region.lengthBars;
          for (let b = 0; b < bars; b++) {
            for (let r = 0; r < 4; r++) {
              for (let s = 0; s < 16; s++) {
                if (!rows[r] || !rows[r][s]) continue;
                events.push({
                  beat: baseBeat + b * 4 + s * 0.25,
                  dur: 0.25, pitch: 36 + r, vel: 84,
                  trackId: track.id, instrument: "drum"
                });
              }
            }
          }
          return;
        }
        (region.notes || []).forEach(n => {
          events.push({
            beat: baseBeat + n.start,
            dur: n.dur,
            pitch: n.pitch,
            vel: n.velocity || 80,
            trackId: track.id,
            instrument: track.instrument || "piano"
          });
        });
      });
    });
    events.sort((a, b) => a.beat - b.beat);
    state.events = events;
    state.audioRegions = audio;
    state.nextIdx = 0;
    state.scheduledAudio = new Set();
    return events;
  }

  /* ── 音色合成 ─────────────────────────────── */
  function playVoice(ctx, dest, instrument, pitch, time, dur, vel, sendRev, sendDly) {
    const out = ctx.createGain();
    out.gain.value = vel / 100;
    let node;
    if (instrument === "drum") {
      drumHit(ctx, dest, pitch, time, vel);
      return;
    }
    if (instrument === "pad") {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.10 * (vel / 90), time + 0.55);
      g.gain.linearRampToValueAtTime(0.075 * (vel / 90), time + Math.max(0.6, dur * 0.8));
      g.gain.setTargetAtTime(0, time + Math.max(0.7, dur * 0.85), 0.25);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 1300; f.Q.value = 0.4;
      [0, 7, 12].forEach((iv, i) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freqOf(pitch + iv);
        o.detune.value = (i - 1) * 6;
        const og = ctx.createGain(); og.gain.value = i === 0 ? 0.5 : 0.28;
        o.connect(og); og.connect(f);
        o.start(time); o.stop(time + Math.max(0.8, dur * 0.9) + 1.2);
      });
      f.connect(g); g.connect(out); out.connect(dest);
      if (sendRev) { try { g.connect(sendRev); } catch (e) {} }
      return;
    }
    if (instrument === "bass") {
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 520;
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = freqOf(pitch);
      const o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = freqOf(pitch);
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(f); f.connect(out);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.9 * (vel / 90), time + 0.02);
      g.gain.setTargetAtTime(0.35, time + 0.02, 0.35);
      g.gain.setTargetAtTime(0, time + Math.max(0.12, dur * spb()), 0.12);
      o.start(time); o.stop(time + dur * spb() + 0.5);
      o2.start(time); o2.stop(time + dur * spb() + 0.5);
      out.connect(dest);
      return;
    }
    if (instrument === "lead") {
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600;
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freqOf(pitch);
      const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = freqOf(pitch) * 2;
      const g2 = ctx.createGain(); g2.gain.value = 0.18;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = freqOf(pitch) * 0.006;
      lfo.connect(lfoGain); lfoGain.connect(o.frequency);
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(f); f.connect(out);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.32 * (vel / 90), time + 0.04);
      g.gain.setTargetAtTime(0.18, time + 0.04, 0.2);
      g.gain.setTargetAtTime(0, time + Math.max(0.1, dur * spb()), 0.1);
      o.start(time); o.stop(time + dur * spb() + 0.6);
      o2.start(time); o2.stop(time + dur * spb() + 0.6);
      lfo.start(time); lfo.stop(time + dur * spb() + 0.6);
      out.connect(dest);
      return;
    }
    // piano
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter(); f.type = "lowpass";
    f.frequency.setValueAtTime(Math.min(9000, 2400 + vel * 40), time);
    f.frequency.setTargetAtTime(1200, time + 0.02, 0.6);
    const parts = [[1, 1], [2, 0.42], [3, 0.16], [4, 0.07]];
    parts.forEach(([mult, amp]) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freqOf(pitch) * mult;
      const og = ctx.createGain(); og.gain.value = amp;
      o.connect(og); og.connect(g);
      o.start(time); o.stop(time + dur * spb() + 1.0);
    });
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.34 * (vel / 90), time + 0.004);
    g.gain.setTargetAtTime(0.0001, time + 0.01, 0.5);
    g.connect(f); f.connect(out);
    out.connect(dest);
    if (sendRev) { try { out.connect(sendRev); } catch (e) {} }
  }

  function spb() { return 60 / state.bpm; }

  function drumHit(ctx, dest, pitch, time, vel) {
    const row = pitch - 36;
    const gain = ctx.createGain();
    gain.connect(dest);
    if (row === 0) { // kick
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(130, time);
      o.frequency.exponentialRampToValueAtTime(44, time + 0.12);
      gain.gain.setValueAtTime(0.9 * vel / 90, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      o.connect(gain); o.start(time); o.stop(time + 0.32);
    } else if (row === 1) { // snare
      const src = ctx.createBufferSource(); src.buffer = state.noise;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 1500;
      gain.gain.setValueAtTime(0.5 * vel / 90, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
      src.connect(f); f.connect(gain); src.start(time); src.stop(time + 0.2);
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 180;
      const og = ctx.createGain(); og.gain.setValueAtTime(0.25 * vel / 90, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      o.connect(og); og.connect(gain); o.start(time); o.stop(time + 0.12);
    } else { // hats
      const src = ctx.createBufferSource(); src.buffer = state.noise;
      const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6800;
      const dec = row === 3 ? 0.35 : 0.06;
      gain.gain.setValueAtTime((row === 3 ? 0.22 : 0.16) * vel / 90, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dec);
      src.connect(f); f.connect(gain); src.start(time); src.stop(time + dec + 0.02);
    }
  }

  /* ── 走带 ─────────────────────────────────── */
  function beatToBar(beat) {
    const bar = Math.floor(beat / 4) + 1;
    const beatInBar = Math.floor(beat % 4) + 1;
    const sixteenth = Math.floor((beat % 1) * 4) + 1;
    return { bar, beat: beatInBar, tick: sixteenth };
  }

  function currentBeat() {
    if (!state.playing) return state.startBeat;
    return state.startBeat + (state.ctx.currentTime - state.startCtxTime) * (state.bpm / 60);
  }

  function play(fromBar) {
    ensureCtx();
    const ctx = state.ctx;
    if (state.playing) return;
    if (!state.project) return;
    if (typeof fromBar === "number") state.startBeat = Math.max(0, (fromBar - 1) * 4);
    if (state.startBeat >= state.project.meta.bars * 4) state.startBeat = 0;
    state.nextIdx = 0;
    state.scheduledAudio = new Set();
    state.playing = true;
    state.paused = false;
    const countIn = state.countIn ? 4 : 0;
    state.startCtxTime = ctx.currentTime + 0.1 + countIn * spb();
    state.startBeat -= countIn;
    state.scheduler = setInterval(tick, 25);
    tick();
    if (countIn) {
      for (let i = 0; i < 4; i++) {
        click(state.startCtxTime + i * spb(), i === 0);
      }
    }
  }

  function tick() {
    if (!state.playing) return;
    const ctx = state.ctx;
    const now = ctx.currentTime;
    const lookahead = 0.25;
    const curBeat = state.startBeat + (now - state.startCtxTime) * (state.bpm / 60);
    const horizon = state.startBeat + (now - state.startCtxTime + lookahead) * (state.bpm / 60);

    // 跳过已过时的事件
    while (state.nextIdx < state.events.length && state.events[state.nextIdx].beat < curBeat - 0.05) state.nextIdx++;

    for (let i = state.nextIdx; i < state.events.length; i++) {
      const ev = state.events[i];
      if (ev.beat > horizon) break;
      if (ev.beat < curBeat - 0.05) continue;
      const when = state.startCtxTime + (ev.beat - state.startBeat) * spb();
      scheduleEvent(ev, when);
      state.nextIdx = i + 1;
    }

    // 音频片段（素材池放入的音频 / 录音）
    if (state.audioRegions && state.audioRegions.length) {
      for (const ar of state.audioRegions) {
        const key = ar.trackId + "|" + ar.mediaId + "|" + ar.beat;
        if (state.scheduledAudio.has(key)) continue;
        if (ar.beat >= horizon) continue;
        if (ar.beat < curBeat - 0.25) continue;
        const buf = state.buffers[ar.mediaId];
        const tn = state.tracks[ar.trackId];
        if (!buf || !tn) continue;
        const when = state.startCtxTime + (ar.beat - state.startBeat) * spb();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(tn.gain);
        src.start(Math.max(when, now));
        state.activeSources.push(src);
        state.scheduledAudio.add(key);
      }
    }

    // 自动化曲线
    pumpAutomation(curBeat);

    // 节拍器
    if (state.metro) {
      const beatIdx = Math.floor(curBeat);
      if (beatIdx !== state.metroBeat) {
        state.metroBeat = beatIdx;
        const t = state.startCtxTime + (beatIdx - state.startBeat) * spb();
        if (t > now) click(t, ((beatIdx % 4) + 4) % 4 === 0);
      }
    }

    // 循环
    if (state.cycle) {
      const loopEnd = state.loopEndBar * 4;
      if (curBeat >= loopEnd) {
        stopAllSources();
        state.startBeat = (state.loopStartBar - 1) * 4;
        state.startCtxTime = ctx.currentTime + 0.05;
        state.nextIdx = 0;
      }
    }

    if (state.onTick) state.onTick(beatToBar(Math.max(0, curBeat)), curBeat);
  }

  function scheduleEvent(ev, when) {
    const track = state.tracks[ev.trackId];
    if (!track) return;
    const sendRev = track.revSend, sendDly = track.dlySend;
    playVoice(state.ctx, track.gain, ev.instrument, ev.pitch, when, ev.dur, ev.vel, sendRev, sendDly);
  }

  function click(time, accent) {
    const ctx = state.ctx;
    const o = ctx.createOscillator(); o.type = "square";
    o.frequency.value = accent ? 1600 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
    o.connect(g); g.connect(state.master);
    o.start(time); o.stop(time + 0.04);
  }

  function pause() {
    if (!state.playing) return;
    state.startBeat = currentBeat();
    state.playing = false;
    state.paused = true;
    clearInterval(state.scheduler);
    stopAllSources();
  }

  function stop() {
    state.playing = false;
    state.paused = false;
    clearInterval(state.scheduler);
    stopAllSources();
    state.startBeat = 0;
    state.nextIdx = 0;
    if (state.onTick) state.onTick(beatToBar(0), 0);
  }

  function seek(bar) {
    const wasPlaying = state.playing;
    state.playing = false;
    clearInterval(state.scheduler);
    stopAllSources();
    state.startBeat = Math.max(0, (bar - 1) * 4);
    state.nextIdx = 0;
    if (wasPlaying) {
      state.playing = false;
      play(bar);
    } else if (state.onTick) {
      state.onTick(beatToBar(state.startBeat), state.startBeat);
    }
  }

  function stopAllSources() {
    state.activeSources.forEach(s => { try { s.stop(); } catch (e) {} });
    state.activeSources = [];
  }

  function setCycle(on) { state.cycle = on; }
  function setLoopRange(a, b) { state.loopStartBar = a; state.loopEndBar = b; }
  function setMetro(on) { state.metro = on; }
  function setCountIn(on) { state.countIn = on; }
  function setBpm(bpm) {
    if (state.playing) { pause(); state.bpm = bpm; state.project.meta.bpm = bpm; buildEvents(state.project); play(); }
    else { state.bpm = bpm; if (state.project) { state.project.meta.bpm = bpm; buildEvents(state.project); } }
  }

  function setTrackParam(id, key, value) {
    const track = state.project.tracks.find(t => t.id === id);
    if (!track) return;
    track[key] = value;
    applyTrackParams(track);
  }

  function setTrackMute(id, v) { const t = state.project.tracks.find(t => t.id === id); if (t) { t.mute = v; applyTrackParams(t); state.project.tracks.forEach(applyTrackParams); } }
  function setTrackSolo(id, v) { const t = state.project.tracks.find(t => t.id === id); if (t) { t.solo = v; state.project.tracks.forEach(applyTrackParams); } }

  function getMeters() {
    const ctx = state.ctx;
    if (!ctx) return { master: [0, 0], tracks: {} };
    const read = (an) => {
      if (!an) return 0;
      const arr = new Uint8Array(an.frequencyBinCount);
      an.getByteTimeDomainData(arr);
      let sum = 0;
      for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
      return Math.min(1, Math.sqrt(sum / arr.length) * 2.4);
    };
    const tracks = {};
    Object.keys(state.tracks).forEach(id => { tracks[id] = read(state.tracks[id].analyser); });
    return { master: [read(state.analyserL), read(state.analyserR)], tracks };
  }

  /* ── 录音 ─────────────────────────────────── */
  async function listInputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === "audioinput");
    } catch (e) { return []; }
  }

  async function startRecord() {
    const ctx = ensureCtx();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordStream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    state.recordAnalyser = an;
    const mr = new MediaRecorder(stream);
    state.recorder = mr;
    state.recordChunks = [];
    mr.ondataavailable = e => { if (e.data.size) state.recordChunks.push(e.data); };
    mr.start(80);
    state.recordStartAt = state.playing
      ? currentBeat()
      : state.startBeat;
    if (!state.playing) { play(state.startBeat / 4 + 1); }
    return true;
  }

  function recordLevel() {
    if (!state.recordAnalyser) return 0;
    const an = state.recordAnalyser;
    const arr = new Uint8Array(an.frequencyBinCount);
    an.getByteTimeDomainData(arr);
    let peak = 0;
    for (let i = 0; i < arr.length; i++) peak = Math.max(peak, Math.abs(arr[i] - 128) / 128);
    return Math.min(1, peak * 1.4);
  }

  async function stopRecord() {
    const mr = state.recorder;
    if (!mr) return null;
    const endBeat = state.playing ? currentBeat() : state.startBeat;
    const startBeat = state.recordStartAt;
    await new Promise(res => { mr.onstop = res; mr.stop(); });
    const blob = new Blob(state.recordChunks, { type: mr.mimeType || "audio/webm" });
    const ab = await blob.arrayBuffer();
    let buffer = null;
    try { buffer = await state.ctx.decodeAudioData(ab.slice(0)); } catch (e) { buffer = null; }
    if (state.recordStream) state.recordStream.getTracks().forEach(t => t.stop());
    state.recorder = null; state.recordStream = null; state.recordAnalyser = null;
    const startBar = Math.floor(startBeat / 4) + 1;
    const endBar = Math.max(startBar + 1, Math.ceil(endBeat / 4) + 1);
    return { buffer, blob, startBar, endBar, startBeat, endBeat };
  }

  /* ── 多 take 合成 ───────────────────────────
     把 N 条 take（含偏移）按权重混成一条 AudioBuffer，带软限幅保护。 */
  function mixTakes(takes, opts) {
    const list = (takes || []).filter(t => t && t.buffer && (t.weight === undefined || t.weight > 0));
    if (!list.length) return null;
    const sr = state.ctx ? state.ctx.sampleRate : 48000;
    const alignStart = !!(opts && opts.alignStart);
    const offsets = list.map(t => alignStart ? 0 : Math.max(0, (t.offset || 0)));
    const totalFrames = Math.max(...list.map((t, i) => offsets[i] + t.buffer.length));
    const chans = Math.max(...list.map(t => t.buffer.numberOfChannels));
    const out = new AudioBuffer({ length: totalFrames, numberOfChannels: chans, sampleRate: sr });
    const weightSum = list.reduce((n, t) => n + (t.weight === undefined ? 1 : t.weight), 0) || 1;
    for (let c = 0; c < chans; c++) {
      const dst = out.getChannelData(c);
      list.forEach((t, i) => {
        const src = t.buffer.getChannelData(Math.min(c, t.buffer.numberOfChannels - 1));
        const w = (t.weight === undefined ? 1 : t.weight) / weightSum;
        const off = offsets[i];
        for (let k = 0; k < src.length && off + k < totalFrames; k++) dst[off + k] += src[k] * w;
      });
      // 软限幅：超过 0.95 的部分做 tanh 压缩，避免削波
      for (let k = 0; k < dst.length; k++) {
        const v = dst[k];
        if (v > 0.95 || v < -0.95) dst[k] = Math.tanh(v * 1.1) * 0.95;
      }
    }
    return out;
  }

  /* ── 音频素材加载 ─────────────────────────── */
  async function loadAudio(mediaId, url) {
    ensureCtx();
    if (state.buffers[mediaId]) return state.buffers[mediaId];
    const res = await fetch(url);
    const ab = await res.arrayBuffer();
    const buf = await state.ctx.decodeAudioData(ab);
    state.buffers[mediaId] = buf;
    return buf;
  }

  /* ── 离线渲染 / 导出 ──────────────────────── */
  async function renderOffline(project, fromBar, toBar) {
    const sr = state.ctx ? state.ctx.sampleRate : 48000;
    const bpm = project.meta.bpm;
    const spb = 60 / bpm;
    const startBeat = (fromBar - 1) * 4;
    const endBeat = toBar * 4;
    const durSec = (endBeat - startBeat) * spb + 2;
    const OFFL = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OFFL(2, Math.ceil(durSec * sr), sr);
    // 重放所用节点
    const master = off.createGain(); master.gain.value = 0.9;
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3.5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    master.connect(comp); comp.connect(off.destination);
    const conv = off.createConvolver(); conv.buffer = makeImpulse(2.6, 2.2);
    const rev = off.createGain(); rev.gain.value = 0.55; conv.connect(rev); rev.connect(master);
    const delay = off.createDelay(1.2); delay.delayTime.value = 0.36;
    const fb = off.createGain(); fb.gain.value = 0.32;
    delay.connect(fb); fb.connect(delay);
    const dlyOut = off.createGain(); dlyOut.gain.value = 0.5; delay.connect(dlyOut); dlyOut.connect(master);
    const noise = off.createBuffer(1, sr * 1.2, sr);
    { const dd = noise.getChannelData(0); for (let i = 0; i < dd.length; i++) dd[i] = Math.random() * 2 - 1; }
    const saved = { ctx: state.ctx, noise: state.noise, master: state.master, reverb: state.reverb, delay: state.delay };
    state.ctx = off; state.noise = noise; state.master = master; state.reverb = conv; state.delay = delay;

    const trackGains = {};
    project.tracks.forEach(track => {
      const g = off.createGain();
      const anySolo = project.tracks.some(t => t.solo);
      const muted = track.mute || (anySolo && !track.solo);
      g.gain.value = muted ? 0 : dbToLinear(track.volume);
      const pan = off.createStereoPanner ? off.createStereoPanner() : null;
      const revSend = off.createGain(); revSend.gain.value = (track.rev || 0) * 0.5;
      const dlySend = off.createGain(); dlySend.gain.value = (track.dly || 0) * 0.45;
      if (pan) { pan.pan.value = track.pan || 0; g.connect(pan); pan.connect(master); }
      else g.connect(master);
      g.connect(revSend); revSend.connect(conv);
      g.connect(dlySend); dlySend.connect(delay);
      trackGains[track.id] = { gain: g, revSend, dlySend };

      // 自动化：把曲线排成 AudioParam 的 setValueAtTime 序列（线性插值）
      const schedule = (param, points, transform) => {
        if (!points || points.length < 2) return;
        const sorted = points.slice().sort((a, b) => a.beat - b.beat);
        sorted.forEach(pt => {
          const t = Math.max(0, (pt.beat - startBeat) * spb);
          param.linearRampToValueAtTime(transform(pt.value), t);
        });
      };
      if (hasAutomation(track, "volume")) {
        const pts = track.automation.volume.slice().sort((a, b) => a.beat - b.beat);
        const base = muted ? 0 : 1;
        g.gain.setValueAtTime(muted ? 0 : dbToLinear(automationValueAt(pts, startBeat)), 0);
        pts.forEach(pt => {
          const t = Math.max(0, (pt.beat - startBeat) * spb);
          g.gain.linearRampToValueAtTime(muted ? 0 : dbToLinear(pt.value), t);
        });
      }
      if (pan && hasAutomation(track, "pan")) {
        pan.pan.setValueAtTime(Math.max(-1, Math.min(1, automationValueAt(track.automation.pan, startBeat))), 0);
        track.automation.pan.slice().sort((a, b) => a.beat - b.beat).forEach(pt => {
          pan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, pt.value)), Math.max(0, (pt.beat - startBeat) * spb));
        });
      }
      if (hasAutomation(track, "rev")) {
        revSend.gain.setValueAtTime(Math.max(0, Math.min(1, automationValueAt(track.automation.rev, startBeat))) * 0.5, 0);
        track.automation.rev.slice().sort((a, b) => a.beat - b.beat).forEach(pt => {
          revSend.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, pt.value)) * 0.5, Math.max(0, (pt.beat - startBeat) * spb));
        });
      }
      if (hasAutomation(track, "dly")) {
        dlySend.gain.setValueAtTime(Math.max(0, Math.min(1, automationValueAt(track.automation.dly, startBeat))) * 0.45, 0);
        track.automation.dly.slice().sort((a, b) => a.beat - b.beat).forEach(pt => {
          dlySend.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, pt.value)) * 0.45, Math.max(0, (pt.beat - startBeat) * spb));
        });
      }
    });

    project.tracks.forEach(track => {
      (track.regions || []).forEach(region => {
        const baseBeat = (region.startBar - 1) * 4;
        if (track.type === "audio") {
          const buf = state.buffers[region.mediaId];
          if (!buf) return;
          const src = off.createBufferSource();
          src.buffer = buf;
          const when = (baseBeat - startBeat) * spb;
          src.connect(trackGains[track.id].gain);
          src.start(Math.max(0.001, when));
          return;
        }
        if (track.type === "drum") {
          const rows = region.pattern || project.drumPattern[project.meta.drumKit || "studio"];
          for (let b = 0; b < region.lengthBars; b++) {
            for (let r = 0; r < 4; r++) {
              for (let s = 0; s < 16; s++) {
                if (!rows[r][s]) continue;
                const beat = baseBeat + b * 4 + s * 0.25;
                if (beat < startBeat || beat >= endBeat) continue;
                const when = (beat - startBeat) * spb;
                drumHit(off, trackGains[track.id].gain, 36 + r, when, 84);
              }
            }
          }
          return;
        }
        (region.notes || []).forEach(n => {
          const beat = baseBeat + n.start;
          if (beat < startBeat || beat >= endBeat) return;
          const when = (beat - startBeat) * spb;
          playVoice(off, trackGains[track.id].gain, track.instrument || "piano",
            n.pitch, when, n.dur, n.velocity || 80,
            trackGains[track.id].revSend, trackGains[track.id].dlySend);
        });
      });
    });

    const rendered = await off.startRendering();
    state.ctx = saved.ctx; state.noise = saved.noise; state.master = saved.master;
    state.reverb = saved.reverb; state.delay = saved.delay;
    return rendered;
  }

  /* ── 响度测量（ITU-R BS.1770 简化实现：K 加权 + 400ms 门限块） ── */
  function biquad(data, b0, b1, b2, a1, a2) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      data[i] = y;
    }
  }
  function kWeighting(data, sr) {
    // 高架 +4 dB @ 1.5 kHz
    const A = Math.pow(10, 4 / 40);
    const w0 = 2 * Math.PI * 1500 / sr;
    const cosW = Math.cos(w0), sinW = Math.sin(w0);
    const alpha = sinW / 2 * Math.sqrt((A + 1 / A) * (1 / 1 - 1) + 2);
    const a0 = (A + 1) - (A - 1) * cosW + 2 * Math.sqrt(A) * alpha;
    biquad(data,
      A * ((A + 1) + (A - 1) * cosW + 2 * Math.sqrt(A) * alpha) / a0,
      -2 * A * ((A - 1) + (A + 1) * cosW) / a0,
      A * ((A + 1) + (A - 1) * cosW - 2 * Math.sqrt(A) * alpha) / a0,
      2 * ((A - 1) - (A + 1) * cosW) / a0,
      ((A + 1) - (A - 1) * cosW - 2 * Math.sqrt(A) * alpha) / a0);
    // 高通 38 Hz
    const w1 = 2 * Math.PI * 38 / sr;
    const cos1 = Math.cos(w1), sin1 = Math.sin(w1);
    const alpha1 = sin1 / (2 * 0.5);
    const hpA0 = 1 + alpha1;
    biquad(data,
      (1 + cos1) / 2 / hpA0,
      -(1 + cos1) / hpA0,
      (1 + cos1) / 2 / hpA0,
      -2 * cos1 / hpA0,
      (1 - alpha1) / hpA0);
  }
  function measureLufs(buffer) {
    const sr = buffer.sampleRate;
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = new Float32Array(buffer.getChannelData(c));
      kWeighting(d, sr);
      chans.push(d);
    }
    const block = Math.round(0.4 * sr);
    const hop = Math.round(0.1 * sr);
    const energies = [];
    for (let start = 0; start + block <= buffer.length; start += hop) {
      let sum = 0;
      for (const d of chans) {
        let e = 0;
        for (let i = start; i < start + block; i++) e += d[i] * d[i];
        sum += e / block;
      }
      if (sum > 0) energies.push({ sum, lufs: -0.691 + 10 * Math.log10(sum) });
    }
    if (!energies.length) return { lufs: -70, blocks: 0 };
    const abs = energies.filter(b => b.lufs > -70);
    if (!abs.length) return { lufs: -70, blocks: energies.length };
    const mean = arr => arr.reduce((n, b) => n + b.sum, 0) / arr.length;
    const rel = -0.691 + 10 * Math.log10(mean(abs)) - 10;
    const gated = abs.filter(b => b.lufs > rel);
    const lufs = -0.691 + 10 * Math.log10(mean(gated.length ? gated : abs));
    return { lufs, blocks: energies.length };
  }
  function normalizeLufs(buffer, targetLufs) {
    const before = measureLufs(buffer).lufs;
    let gainDb = targetLufs - before;
    let gain = Math.pow(10, gainDb / 20);
    // 峰值限制：不超过 −1 dBFS（简化的 true-peak 保护）
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    const ceiling = Math.pow(10, -1 / 20);
    if (peak * gain > ceiling) gain = ceiling / Math.max(1e-9, peak);
    const out = new (window.AudioBuffer || Object)({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
    }
    const after = measureLufs(out).lufs;
    return { buffer: out, before, after, gainDb: 20 * Math.log10(gain) };
  }

  function applyGain(buffer, gainDb, ceilingDb) {
    const gain = Math.pow(10, gainDb / 20);
    const out = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < src.length; i++) { const v = src[i] * gain; dst[i] = v; peak = Math.max(peak, Math.abs(v)); }
    }
    const ceiling = Math.pow(10, (ceilingDb === undefined ? -1 : ceilingDb) / 20);
    if (peak > ceiling) {
      const k = ceiling / peak;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = out.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= k;
      }
    }
    return out;
  }

  /* ── 分轨 ZIP（store 方式，无压缩，浏览器原生） ── */
  let CRC_TABLE = null;
  function crc32(data) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      local.set(name, 30);
      parts.push(local, data);
      const cen = new Uint8Array(46 + name.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      central.push(cen);
      offset += local.length + data.length;
    });
    const centralStart = offset;
    let centralSize = 0;
    central.forEach(c => { centralSize += c.length; });
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);
    return new Blob([...parts, ...central, eocd], { type: "application/zip" });
  }

  function encodeWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const view = new DataView(ab);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF"); view.setUint32(4, bytes - 8, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
    view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true); writeStr(36, "data"); view.setUint32(40, len * numCh * 2, true);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  function getPosition() {
    return beatToBar(Math.max(0, currentBeat()));
  }

  /* 试听单个音符（钢琴卷帘 / 步进鼓机用） */
  function audition(instrument, pitch, vel) {
    ensureCtx();
    const t = state.ctx.currentTime + 0.01;
    const track = { gain: state.master };
    if (instrument === "drum") drumHit(state.ctx, state.master, pitch, t, vel || 90);
    else playVoice(state.ctx, state.master, instrument, pitch, t, 0.5, vel || 90, null, null);
  }

  return {
    init, setProject, play, pause, stop, seek, getPosition, currentBeat,
    setBpm, setCycle, setLoopRange, setMetro, setCountIn,
    setTrackParam, setTrackMute, setTrackSolo, getMeters, applyTrackParams,
    startRecord, stopRecord, recordLevel, listInputs, loadAudio, mixTakes,
    renderOffline, encodeWav, audition, buildEvents,
    measureLufs, normalizeLufs, applyGain, makeZip,
    automationValueAt, hasAutomation, automationActive, AUTO_PARAMS, pumpAutomation,
    noteNameToMidi: midiFromName, freqOf,
    state
  };
})();
