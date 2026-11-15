/* 理音 Liyin Studio — 应用主逻辑
   工程状态 / 编排渲染 / 钢琴卷帘 / 步进鼓机 / 混音台 / 导出 / 录音 / 撤销 / 自动保存 */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const SAVE_KEY = "liyin.project.v1";
  const DPR = window.devicePixelRatio || 1;

  const App = {
    project: null,
    view: "arrange",
    dockTab: "piano",
    barW: 34,
    selectedRegionId: null,
    selectedNote: null,
    playBar: 1,
    follow: true,
    cycle: false,
    metro: false,
    countIn: false,
    undoStack: [],
    redoStack: [],
    saving: false,
    recState: { armed: false, recording: false, meterRaf: null },
    drag: null,
    pianoView: { regionId: null, pxPerBeat: 26, rowH: 14, minPitch: 45, maxPitch: 84, scroll: { x: 0, y: 0 } },
    score: { part: "lead", zoom: 1, chords: true, sections: true, follow: true, dpr: 2 },
    auto: { trackId: "lead", param: "volume" },
    ace: { busy: false, base: "http://127.0.0.1:8001" },
    lastSave: Date.now()
  };
  window.App = App;

  /* ═══ 工程构建 ═══════════════════════════ */
  function buildDefaultProject() {
    const d = window.LIYIN;
    const chords = d.chords.slice();
    const tracks = [];
    const seeds = d.trackSeeds;
    const trackById = {};
    seeds.forEach(s => { trackById[s.id] = Object.assign({}, s); });

    // 钢琴：琶音
    const pNotes = [];
    for (let bar = 1; bar <= d.meta.bars; bar++) {
      const v = d.VOICING[chords[bar - 1]];
      const pat = [0, 1, 2, 1, 0, 1, 2, 1];
      pat.forEach((idx, i) => {
        pNotes.push({ pitch: v.notes[idx], start: (bar - 1) * 4 + i * 0.5, dur: 0.55, velocity: 52 + (i % 2) * 6 });
      });
    }
    // 弦乐：整小节铺底
    const padNotes = [];
    for (let bar = 1; bar <= d.meta.bars; bar++) {
      const v = d.VOICING[chords[bar - 1]];
      v.notes.forEach(p => padNotes.push({ pitch: p, start: (bar - 1) * 4, dur: 3.8, velocity: 40 }));
    }
    // 贝斯
    const bassNotes = [];
    for (let bar = 1; bar <= d.meta.bars; bar++) {
      const v = d.VOICING[chords[bar - 1]];
      bassNotes.push({ pitch: v.bass, start: (bar - 1) * 4, dur: 1.9, velocity: 72 });
      bassNotes.push({ pitch: v.bass + 7 <= 55 ? v.bass + 7 : v.bass, start: (bar - 1) * 4 + 2, dur: 1.8, velocity: 58 });
    }
    // 旋律
    const leadNotes = [];
    const addLine = (line, bar) => {
      line.forEach(([off, name, dur]) => {
        leadNotes.push({ pitch: Engine.noteNameToMidi(name), start: (bar - 1) * 4 + off, dur, velocity: 78 });
      });
    };
    d.placement.v1.forEach((b, i) => addLine(d.lines.v[i], b));
    d.placement.v2.forEach((b, i) => addLine(d.lines.v[i], b));
    d.placement.v3.forEach((b, i) => addLine(d.lines.v[i], b));
    d.placement.pre.forEach((b, i) => addLine(d.lines.pre[i], b));
    d.placement.ch1.forEach((b, i) => addLine(d.lines.ch[i], b));
    d.placement.ch2.forEach((b, i) => addLine(d.lines.ch[i], b));
    d.placement.bridge.forEach((b, i) => addLine(d.lines.bridge[i], b));
    d.placement.outro.forEach((b, i) => addLine(d.lines.outro[i], b));
    // 间奏用主歌旋律
    addLine(d.lines.v[0], 37);
    addLine(d.lines.v[1], 39);

    const mkTrack = (id, extra) => Object.assign({
      id, volume: -6, pan: 0, mute: false, solo: false, rev: 0.18, dly: 0.05,
      regions: []
    }, trackById[id], extra);

    tracks.push(mkTrack("vocal", { type: "audio", regions: [], volume: -4, rev: 0.25, dly: 0.1 }));
    tracks.push(mkTrack("piano", { type: "midi", instrument: "piano", volume: -8, regions: [{ id: "r-piano", startBar: 1, lengthBars: d.meta.bars, notes: pNotes }] }));
    tracks.push(mkTrack("pad", { type: "midi", instrument: "pad", volume: -12, regions: [{ id: "r-pad", startBar: 1, lengthBars: d.meta.bars, notes: padNotes }] }));
    tracks.push(mkTrack("bass", { type: "midi", instrument: "bass", volume: -9, regions: [{ id: "r-bass", startBar: 1, lengthBars: d.meta.bars, notes: bassNotes }] }));
    tracks.push(mkTrack("lead", { type: "midi", instrument: "lead", volume: -7, regions: [{ id: "r-lead", startBar: 1, lengthBars: d.meta.bars, notes: leadNotes }] }));
    tracks.push(mkTrack("drums", {
      type: "drum", volume: -8, rev: 0.12, dly: 0,
      regions: [{ id: "r-drums", startBar: 29, lengthBars: 28, pattern: JSON.parse(JSON.stringify(d.drumPattern.studio)) }]
    }));

    return {
      meta: { title: "镜湖", bpm: d.meta.bpm, key: d.meta.key, keyLabel: d.meta.keyLabel, sig: d.meta.sig, bars: d.meta.bars, drumKit: "studio" },
      sections: d.sections.map(s => Object.assign({}, s)),
      chords,
      lyrics: d.lyrics,
      media: d.media.map(m => Object.assign({}, m)),
      drumPattern: d.drumPattern,
      tracks,
      ai: { style: "folk", prompt: "", fit: 72, creative: 45, density: 40, vocal: "male" },
      updatedAt: Date.now()
    };
  }

  function loadProject() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) { saved = null; }
    if (saved && saved.tracks && saved.meta) {
      if (!saved.media) saved.media = window.LIYIN.media;
      if (!saved.drumPattern) saved.drumPattern = window.LIYIN.drumPattern;
      if (!saved.ai) saved.ai = { style: "folk", prompt: "", fit: 72, creative: 45, density: 40, vocal: "male" };
      if (!saved.chords) saved.chords = window.LIYIN.chords.slice();
      App.project = saved;
    } else {
      App.project = buildDefaultProject();
    }
  }

  function snapshot() { return JSON.parse(JSON.stringify(App.project)); }
  function pushUndo(label) {
    App.undoStack.push({ label: label || "编辑", data: snapshot() });
    if (App.undoStack.length > 40) App.undoStack.shift();
    App.redoStack = [];
    updateSaveState(true);
  }
  function undo() {
    if (!App.undoStack.length) return toast("没有可撤销的操作");
    const cur = snapshot();
    const item = App.undoStack.pop();
    App.redoStack.push({ label: item.label, data: cur });
    App.project = item.data;
    refreshAll(true);
    toast("撤销：" + item.label);
  }
  function redo() {
    if (!App.redoStack.length) return toast("没有可重做的操作");
    const cur = snapshot();
    const item = App.redoStack.pop();
    App.undoStack.push({ label: item.label, data: cur });
    App.project = item.data;
    refreshAll(true);
    toast("重做：" + item.label);
  }

  function updateSaveState(dirty) {
    const el = $("#save-state");
    if (!el) return;
    el.classList.toggle("dirty", !!dirty);
    el.textContent = dirty ? "未保存" : "已保存";
  }

  let saveTimer = null;
  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      App.project.updatedAt = Date.now();
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(App.project));
      } catch (e) {}
      App.lastSave = Date.now();
      updateSaveState(false);
      $("#info-saved").textContent = new Date(App.lastSave).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }, 500);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    App.project.updatedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(App.project)); } catch (e) {}
    App.lastSave = Date.now();
    updateSaveState(false);
    toast("工程已保存");
  }

  function refreshAll(pushHistory) {
    Engine.setProject(App.project);
    renderRuler();
    renderTracks();
    renderDock();
    renderInspectorMeta();
    updatePlayhead(App.playBar);
    if (pushHistory) autosave();
  }

  /* ═══ 编排视图 ═══════════════════════════ */
  const barX = (bar) => (bar - 1) * App.barW;
  const beatX = (beat) => (beat / 4) * App.barW;

  function renderRuler() {
    const ruler = $("#ruler");
    const d = App.project;
    ruler.innerHTML = "";
    ruler.style.width = (d.meta.bars * App.barW) + "px";
    const frag = document.createDocumentFragment();
    for (let bar = 1; bar <= d.meta.bars; bar++) {
      if (bar === 1 || (bar - 1) % 4 === 0) {
        const tick = document.createElement("div");
        tick.className = "tick";
        tick.style.left = barX(bar) + "px";
        if (bar === 1 || (bar - 1) % 4 === 0) {
          const s = document.createElement("span");
          s.textContent = bar;
          tick.appendChild(s);
        }
        frag.appendChild(tick);
      }
    }
    // 段落色带
    d.sections.forEach(sec => {
      const band = document.createElement("div");
      band.className = "section-band";
      band.style.left = barX(sec.start) + "px";
      band.style.width = ((sec.end - sec.start + 1) * App.barW - 2) + "px";
      if (sec.type === "chorus") band.style.background = "rgba(217,160,74,.30)";
      if (sec.type === "bridge") band.style.background = "rgba(140,120,190,.30)";
      frag.appendChild(band);
      const lab = document.createElement("div");
      lab.className = "section-label";
      lab.style.left = (barX(sec.start) + 4) + "px";
      lab.textContent = sec.name;
      frag.appendChild(lab);
    });
    ruler.appendChild(frag);
  }

  function regionClass(track) {
    if (track.type === "audio") return "audio";
    if (track.type === "drum") return "drum";
    return "midi";
  }

  function renderNotesPreview(region) {
    const notes = region.notes || [];
    if (!notes.length) return "";
    const minP = Math.min(...notes.map(n => n.pitch));
    const maxP = Math.max(...notes.map(n => n.pitch));
    const total = region.lengthBars * 4;
    const items = notes.slice(0, 260).map(n => {
      const x = (n.start / total) * 100;
      const y = 100 - ((n.pitch - minP) / Math.max(1, maxP - minP)) * 100;
      const w = Math.max(0.5, (n.dur / total) * 100);
      return `<i style="position:absolute;left:${x}%;top:${clamp(y, 0, 96)}%;width:${clamp(w, 0.5, 4)}%;height:5%;background:rgba(255,255,255,.55);border-radius:1px"></i>`;
    }).join("");
    return `<div class="r-notes">${items}</div>`;
  }

  function renderTracks() {
    const wrap = $("#tracks");
    wrap.innerHTML = "";
    wrap.style.width = (210 + App.project.meta.bars * App.barW) + "px";
    const frag = document.createDocumentFragment();
    App.project.tracks.forEach(track => {
      const row = document.createElement("div");
      row.className = "track-row" + (App.selectedTrackId === track.id ? " selected" : "");
      row.dataset.track = track.id;

      const head = document.createElement("div");
      head.className = "track-head";
      head.innerHTML = `
        <div class="track-color" style="background:${track.color}"></div>
        <div class="track-main">
          <div class="track-name">${track.name}</div>
          <div class="track-sub">${track.sub || ""}</div>
          <div class="track-btns">
            <button class="mute ${track.mute ? "on" : ""}" data-mute="${track.id}" title="静音">M</button>
            <button class="solo ${track.solo ? "on" : ""}" data-solo="${track.id}" title="独奏">S</button>
            <input class="track-vol" type="range" min="-36" max="6" step="1" value="${track.volume}" data-vol="${track.id}">
          </div>
        </div>`;
      head.addEventListener("pointerdown", () => { App.selectedTrackId = track.id; $$(".track-row").forEach(r => r.classList.toggle("selected", r.dataset.track === track.id)); });
      head.addEventListener("click", (e) => {
        if (e.target.dataset.mute !== undefined) { Engine.setTrackMute(e.target.dataset.mute, !track.mute); track.mute = !track.mute; pushUndo("静音"); renderTracks(); }
        if (e.target.dataset.solo !== undefined) { Engine.setTrackSolo(e.target.dataset.solo, !track.solo); track.solo = !track.solo; pushUndo("独奏"); renderTracks(); }
      });
      head.addEventListener("input", (e) => {
        if (e.target.dataset.vol) {
          track.volume = parseFloat(e.target.value);
          Engine.setTrackParam(track.id, "volume", track.volume);
          autosave();
        }
      });

      const lane = document.createElement("div");
      lane.className = "track-lane" + (track.id !== "piano" ? " alt" : "");
      lane.style.width = (App.project.meta.bars * App.barW) + "px";
      // 小节网格
      const grid = document.createElement("div");
      grid.className = "bar-grid";
      for (let bar = 1; bar <= App.project.meta.bars; bar++) {
        const i = document.createElement("i");
        i.style.left = barX(bar) + "px";
        grid.appendChild(i);
        if (App.barW > 30) {
          for (let b = 1; b < 4; b++) {
            const bi = document.createElement("i");
            bi.className = "beat";
            bi.style.left = (barX(bar) + (b / 4) * App.barW) + "px";
            grid.appendChild(bi);
          }
        }
      }
      lane.appendChild(grid);

      (track.regions || []).forEach(region => {
        const el = document.createElement("div");
        el.className = "region " + regionClass(track) + (App.selectedRegionId === region.id ? " selected" : "");
        el.dataset.region = region.id;
        el.dataset.track = track.id;
        el.style.left = barX(region.startBar) + "px";
        el.style.width = Math.max(12, region.lengthBars * App.barW - 1) + "px";
        el.style.background = region.trackColor || "";
        const label = document.createElement("div");
        label.className = "r-label";
        label.textContent = region.name || regionLabel(track, region);
        el.appendChild(label);
        if (track.type === "midi") el.insertAdjacentHTML("beforeend", renderNotesPreview(region));
        if (track.type === "audio") {
          el.innerHTML += `<div class="r-wave">${waveformBars(region.mediaId || "ai-male")}</div>`;
        }
        el.addEventListener("pointerdown", (e) => startRegionDrag(e, track, region, el));
        el.addEventListener("dblclick", () => {
          if (track.type === "midi") { App.selectedRegionId = region.id; openDock("piano"); }
          else if (track.type === "drum") { App.selectedRegionId = region.id; openDock("step"); }
          else toast("音频片段 · 可在混音台调节音量或替换");
        });
        lane.appendChild(el);
      });
      if (!track.regions || !track.regions.length) {
        const empty = document.createElement("div");
        empty.className = "region-empty";
        empty.textContent = track.type === "audio" ? "录音或从素材池放入 AI 人声" : "空白片段";
        lane.appendChild(empty);
      }

      row.appendChild(head);
      row.appendChild(lane);
      frag.appendChild(row);
    });
    const addRow = document.createElement("div");
    addRow.className = "track-add-row";
    addRow.innerHTML = `<button class="add-track-btn">＋ 新建轨道（MIDI / 音频 / 鼓机）</button>`;
    addRow.addEventListener("click", () => {
      const choice = window.confirm("新建 MIDI 轨？\n取消则新建鼓机轨。") ? "midi" : "drum";
      addTrack(choice);
    });
    wrap.appendChild(frag);
    wrap.appendChild(addRow);
    updatePlayhead(App.playBar);
  }

  function regionLabel(track, region) {
    if (track.type === "drum") return "鼓组 · " + (region.lengthBars) + " 小节";
    const notes = region.notes || [];
    return track.name + " · " + Math.round(notes.length) + " 音符";
  }

  function waveformBars(seed) {
    let out = "";
    let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
    for (let i = 0; i < 90; i++) {
      h = (h * 37 + 11) % 997;
      const hgt = 15 + (h / 997) * 70;
      out += `<i style="position:absolute;left:${(i / 90) * 100}%;bottom:0;width:0.6%;height:${hgt}%;background:rgba(255,255,255,.35);border-radius:1px"></i>`;
    }
    return out;
  }

  function updatePlayhead(bar) {
    const line = $("#playhead-line");
    if (!line) return;
    line.style.left = (beatX((bar - 1) * 4) + 210) + "px";
  }

  /* 片段拖动 */
  function startRegionDrag(e, track, region, el) {
    e.stopPropagation();
    App.selectedRegionId = region.id;
    App.selectedTrackId = track.id;
    App.selectedNote = null;
    $$(".region").forEach(r => r.classList.toggle("selected", r.dataset.region === region.id));
    $$(".track-row").forEach(r => r.classList.toggle("selected", r.dataset.track === track.id));
    const startX = e.clientX;
    const startBar = region.startBar;
    let pushed = false;
    const row = el.closest(".track-row");
    const lane = el.parentElement;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dBar = Math.round(dx / App.barW);
      const nb = clamp(startBar + dBar, 1, App.project.meta.bars - region.lengthBars + 1);
      if (nb !== region.startBar) {
        if (!pushed) { pushUndo("移动片段"); pushed = true; }
        region.startBar = nb;
        el.style.left = barX(nb) + "px";
        Engine.buildEvents(App.project);
        autosave();
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      renderDock();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ═══ 走带 / 播放头 ═══════════════════════ */
  function tickUI(pos, beat) {
    App.playBar = pos.bar;
    $("#lcd-pos").textContent = `${pos.bar} · ${pos.beat} · ${pos.tick} · 1`;
    const sec = beat * (60 / App.project.meta.bpm);
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60), d = Math.floor((sec % 1) * 10);
    $("#lcd-time").textContent = `${m}:${String(s).padStart(2, "0")}.${d}`;
    const line = $("#playhead-line");
    if (line) line.style.left = (beatX(beat) + 210) + "px";
    if (App.follow && App.playing && line) {
      const body = $(".arrange-body");
      const x = beatX(beat);
      if (x < body.scrollLeft + 240 || x > body.scrollLeft + body.clientWidth - 80) {
        body.scrollLeft = Math.max(0, x - body.clientWidth * 0.35);
      }
    }
  }

  function createPlayhead() {
    const wrap = $("#tracks");
    const line = document.createElement("div");
    line.className = "playhead-line";
    line.id = "playhead-line";
    wrap.appendChild(line);
    updatePlayhead(App.playBar);
  }

  function rAF() {
    requestAnimationFrame(rAF);
    const m = Engine.getMeters();
    const setMeter = (id, v) => { const el = $(id); if (el) el.style.setProperty("--lv", (v * 100).toFixed(1) + "%"); };
    setMeter("#meter-master-l", m.master[0]);
    setMeter("#meter-master-r", m.master[1]);
    $$(".strip-meter i").forEach(el => {
      const id = el.dataset.meter;
      const v = id === "master" ? (m.master[0] + m.master[1]) / 2 : (m.tracks[id] || 0);
      el.style.setProperty("--lv", (v * 100).toFixed(1) + "%");
    });
    if (App.recState.recording) {
      const lv = Engine.recordLevel();
      drawRecScope(lv);
      $("#rec-level-label").textContent = "输入电平 " + (lv > 0 ? (20 * Math.log10(lv)).toFixed(0) : "−∞") + " dB";
    }
    // 播放头位置
    if (App.playing || Engine.state.playing) {
      const pos = Engine.getPosition();
      const beat = Engine.currentBeat();
      tickUI(pos, beat);
      if (App.dockTab === "score" && App.score.follow && pos.bar !== App._lastScoreBar) {
        App._lastScoreBar = pos.bar;
        const now = performance.now();
        if (!App._scoreLastDraw || now - App._scoreLastDraw > 120) {
          App._scoreLastDraw = now;
          renderScore();
        }
      }
      if (App.dockTab === "automation") drawAutoPlayhead();
    }
  }

  /* ═══ 底部编辑器 ═════════════════════════ */
  function openDock(tab) {
    App.dockTab = tab;
    $$(".dock-tabs > button").forEach(b => b.classList.toggle("active", b.dataset.dtab === tab));
    $$(".dtab").forEach(d => { d.hidden = true; });
    const el = $("#dtab-" + tab);
    if (el) el.hidden = false;
    renderDock();
  }

  function renderDock() {
    if (App.dockTab === "piano") renderPianoRoll();
    if (App.dockTab === "step") renderStep();
    if (App.dockTab === "mixer") renderMixer($("#mixer-mini"), true);
    if (App.dockTab === "chords") renderChords();
    if (App.dockTab === "score") renderScore();
    if (App.dockTab === "automation") renderAutomation();
  }

  function midiName(p) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return names[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
  }

  function currentRegion() {
    for (const t of App.project.tracks) {
      const r = (t.regions || []).find(x => x.id === App.selectedRegionId);
      if (r) return { track: t, region: r };
    }
    // 未选中时默认落在旋律轨，保证钢琴卷帘可直接编辑
    const lead = App.project.tracks.find(t => t.id === "lead");
    if (lead && lead.regions && lead.regions[0]) return { track: lead, region: lead.regions[0] };
    return null;
  }

  function renderPianoRoll() {
    const cv = $("#piano-roll");
    if (!cv) return;
    const cur = currentRegion();
    const scroll = cv.parentElement;
    const availW = Math.max(500, scroll.clientWidth);
    const availH = Math.max(160, scroll.clientHeight);
    let region = cur && cur.track.type === "midi" ? cur.region : null;
    if (!region) {
      // 默认显示旋律轨
      const t = App.project.tracks.find(x => x.id === "lead");
      region = t && t.regions[0];
    }
    if (!region) { cv.width = availW; cv.height = availH; return; }
    if (cur && cur.track.type === "midi") {
      App.pianoView.regionId = region.id;
      $("#dock-title").textContent = `${cur.track.name} · ${App.selectedRegionId ? "片段 " + region.startBar : "旋律 MIDI 参考"}`;
    }
    const notes = region.notes || [];
    const pitches = notes.length ? notes.map(n => n.pitch) : [57, 64, 69];
    const minP = Math.max(24, Math.min(...pitches) - 3);
    const maxP = Math.min(108, Math.max(...pitches) + 3);
    App.pianoView.minPitch = minP;
    App.pianoView.maxPitch = maxP;
    const rowH = App.pianoView.rowH = 14;
    const pxB = App.pianoView.pxPerBeat = 26;
    const keyW = 40;
    const totalBeats = region.lengthBars * 4;
    const w = keyW + totalBeats * pxB;
    const h = (maxP - minP + 1) * rowH;
    cv.width = w * DPR; cv.height = h * DPR;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    const g = cv.getContext("2d");
    g.scale(DPR, DPR);
    g.clearRect(0, 0, w, h);

    // 背景 + 行
    for (let p = maxP; p >= minP; p--) {
      const y = (maxP - p) * rowH;
      const isBlack = [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
      g.fillStyle = isBlack ? "#141519" : "#1a1b1f";
      g.fillRect(keyW, y, w - keyW, rowH);
      g.strokeStyle = "rgba(255,255,255,.035)";
      g.beginPath(); g.moveTo(keyW, y + rowH); g.lineTo(w, y + rowH); g.stroke();
      // 键盘
      g.fillStyle = isBlack ? "#2a2b31" : "#dfddd6";
      g.fillRect(0, y, keyW, rowH - 1);
      g.fillStyle = isBlack ? "#8d8c92" : "#6b6a63";
      g.font = "8px monospace";
      if (!isBlack || p % 12 === 1) g.fillText(midiName(p).replace("-1", "").replace("-0", ""), 3, y + rowH - 4);
    }
    // 网格
    for (let b = 0; b <= totalBeats; b++) {
      const x = keyW + b * pxB;
      const isBar = b % 4 === 0;
      const isBeat = b % 1 === 0;
      g.strokeStyle = isBar ? "rgba(255,255,255,.14)" : isBeat ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.03)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    // 音符
    notes.forEach((n, i) => {
      const x = keyW + n.start * pxB;
      const y = (maxP - n.pitch) * rowH + 1;
      const ww = Math.max(3, n.dur * pxB - 1);
      const sel = App.selectedNote === i;
      g.fillStyle = sel ? "#e0a44b" : "#4fc3ba";
      g.fillRect(x, y, ww, rowH - 3);
      g.fillStyle = "rgba(0,0,0,.35)";
      g.fillRect(x, y + rowH - 5, ww, 1);
      if (sel) { g.strokeStyle = "#fff"; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, ww - 1, rowH - 4); }
    });
    // 绑定交互（一次性）
    if (!cv.dataset.bound) {
      cv.dataset.bound = "1";
      bindPianoEvents(cv, keyW);
    }
    cv._regionId = region.id;
    cv._keyW = keyW;
  }

  function bindPianoEvents(cv) {
    const keyW = 40;
    let drag = null;
    cv.addEventListener("pointerdown", (e) => {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x < keyW) return;
      const pxB = App.pianoView.pxPerBeat, rowH = App.pianoView.rowH;
      const maxP = App.pianoView.maxPitch;
      const beat = Math.max(0, Math.round((x - keyW) / pxB * 4) / 4);
      const pitch = clamp(Math.round(maxP - y / rowH), 24, 108);
      const cur = currentRegion();
      if (!cur || cur.track.type !== "midi") { toast("选中一个 MIDI 片段后再编辑"); return; }
      const notes = cur.region.notes;
      // 点击命中音符
      let hit = -1;
      notes.forEach((n, i) => {
        const nx = keyW + n.start * pxB, nw = Math.max(3, n.dur * pxB - 1);
        const ny = (maxP - n.pitch) * rowH;
        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + rowH - 2) hit = i;
      });
      if (hit >= 0) {
        App.selectedNote = hit;
        const n = notes[hit];
        drag = { startX: x, startY: y, startBeat: n.start, startPitch: n.pitch, index: hit, moved: false };
      } else {
        pushUndo("添加音符");
        notes.push({ pitch, start: clamp(beat, 0, cur.region.lengthBars * 4 - 0.25), dur: 0.5, velocity: parseInt($("#pr-vel").value, 10) || 78 });
        App.selectedNote = notes.length - 1;
        Engine.audition("piano", pitch, 80);
        Engine.buildEvents(App.project);
        autosave();
      }
      renderPianoRoll();
    });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const cur = currentRegion();
      if (!cur) return;
      const n = cur.region.notes[drag.index];
      if (!n) return;
      const pxB = App.pianoView.pxPerBeat, rowH = App.pianoView.rowH;
      const beat = Math.round((x - keyW) / pxB * 4) / 4;
      const pitch = clamp(Math.round(App.pianoView.maxPitch - y / rowH), 24, 108);
      if (beat !== n.start || pitch !== n.pitch) {
        if (!drag.moved) { pushUndo("移动音符"); drag.moved = true; }
        n.start = clamp(beat, 0, cur.region.lengthBars * 4 - 0.25);
        n.pitch = pitch;
        Engine.buildEvents(App.project);
        renderPianoRoll();
        autosave();
      }
    });
    window.addEventListener("pointerup", () => { if (drag) { drag = null; } });
    cv.addEventListener("dblclick", (e) => {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x < keyW) return;
      const cur = currentRegion();
      if (!cur || cur.track.type !== "midi") return;
      const pxB = App.pianoView.pxPerBeat, rowH = App.pianoView.rowH;
      let hit = -1;
      cur.region.notes.forEach((n, i) => {
        const nx = keyW + n.start * pxB, nw = Math.max(3, n.dur * pxB - 1);
        const ny = (App.pianoView.maxPitch - n.pitch) * rowH;
        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + rowH - 2) hit = i;
      });
      if (hit >= 0) {
        pushUndo("删除音符");
        cur.region.notes.splice(hit, 1);
        App.selectedNote = null;
        Engine.buildEvents(App.project);
        renderPianoRoll();
        autosave();
      }
    });
  }

  /* ═══ 步进音序 ═══════════════════════════ */
  function drumRegion() {
    const t = App.project.tracks.find(x => x.type === "drum");
    if (!t) return null;
    return { track: t, region: t.regions[0] };
  }

  function renderStep() {
    const wrap = $("#step-rows");
    const d = drumRegion();
    if (!wrap) return;
    let pattern;
    if (d && d.region.pattern) pattern = d.region.pattern;
    else pattern = App.project.drumPattern[App.project.meta.drumKit || "studio"];
    wrap.innerHTML = "";
    const names = ["底鼓", "军鼓", "踩镲", "开镲"];
    for (let r = 0; r < 4; r++) {
      const row = document.createElement("div");
      row.className = "step-row";
      row.innerHTML = `<div class="row-name">${names[r]}</div>`;
      for (let s = 0; s < 16; s++) {
        const cell = document.createElement("div");
        cell.className = "step-cell" + (pattern[r] && pattern[r][s] ? " on" : "") + (s % 4 === 0 ? " beat" : "");
        cell.dataset.row = r; cell.dataset.step = s;
        cell.addEventListener("click", () => {
          if (!pattern[r]) pattern[r] = new Array(16).fill(0);
          pattern[r][s] = pattern[r][s] ? 0 : 1;
          cell.classList.toggle("on", !!pattern[r][s]);
          pushUndo("鼓机编辑");
          if (d) { d.region.pattern = pattern; }
          else { App.project.drumPattern[App.project.meta.drumKit || "studio"] = pattern; }
          Engine.buildEvents(App.project);
          if (pattern[r][s]) Engine.audition("drum", 36 + r, 90);
          autosave();
        });
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    }
    $("#step-status").textContent = d ? `已写入「${d.track.name}」片段 · 第 ${d.region.startBar} 小节起` : "当前工程没有鼓机轨";
  }

  function playStepPreview() {
    const d = drumRegion();
    if (!d) return;
    const pattern = d.region.pattern || App.project.drumPattern[App.project.meta.drumKit || "studio"];
    const stepMs = (60 / App.project.meta.bpm) * 1000 / 4;
    for (let s = 0; s < 16; s++) {
      setTimeout(() => {
        for (let r = 0; r < 4; r++) {
          if (pattern[r] && pattern[r][s]) Engine.audition("drum", 36 + r, 90);
        }
        $$(".step-cell").forEach(c => c.classList.toggle("playing", parseInt(c.dataset.step, 10) === s));
      }, s * stepMs);
    }
    setTimeout(() => $$(".step-cell").forEach(c => c.classList.remove("playing")), 16 * stepMs + 100);
  }

  /* ═══ 混音台 ═════════════════════════════ */
  function renderMixer(container, compact) {
    if (!container) return;
    container.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "mixer-strips";
    const frag = document.createDocumentFragment();
    App.project.tracks.forEach(track => {
      frag.appendChild(makeStrip(track, compact));
    });
    // 返回轨
    ["混响返回", "延迟返回"].forEach((name, i) => {
      const s = document.createElement("div");
      s.className = "strip return";
      s.innerHTML = `<div class="strip-top"><div class="strip-color" style="background:#4c6a8e"></div><div class="strip-name">${name}</div></div>
        <div class="strip-pan"><input type="range" min="0" max="100" value="${i === 0 ? 62 : 38}" disabled></div>
        <div class="strip-fader"><input type="range" min="-60" max="6" value="${i === 0 ? -8 : -14}" disabled><div class="strip-meter"><i></i></div></div>
        <div class="strip-db">${i === 0 ? "−8.0" : "−14.0"} dB</div>`;
      frag.appendChild(s);
    });
    // 主输出
    const master = document.createElement("div");
    master.className = "strip master";
    master.innerHTML = `<div class="strip-top"><div class="strip-color" style="background:#d9a04a"></div><div class="strip-name">主输出</div></div>
      <div class="strip-pan"><input type="range" min="-100" max="100" value="0" disabled></div>
      <div class="strip-fader"><input type="range" min="-60" max="6" value="0" id="master-fader"><div class="strip-meter"><i data-meter="master"></i></div></div>
      <div class="strip-db">0.0 dB</div>`;
    frag.appendChild(master);
    inner.appendChild(frag);
    container.appendChild(inner);
    const mf = $("#master-fader");
    if (mf) mf.addEventListener("input", () => {
      const v = parseFloat(mf.value);
      const lin = v <= -60 ? 0 : Math.pow(10, v / 20);
      Engine.state.master.gain.value = lin * 0.9;
      mf.closest(".strip").querySelector(".strip-db").textContent = v.toFixed(1) + " dB";
    });
  }

  function makeStrip(track, compact) {
    const s = document.createElement("div");
    s.className = "strip";
    s.dataset.strip = track.id;
    s.innerHTML = `
      <div class="strip-top"><div class="strip-color" style="background:${track.color}"></div><div class="strip-name">${track.name}</div></div>
      <div class="strip-pan"><input type="range" min="-100" max="100" value="${Math.round((track.pan || 0) * 100)}" data-pan="${track.id}"></div>
      <div class="strip-fader">
        <input type="range" min="-60" max="6" step="0.5" value="${track.volume}" data-fader="${track.id}">
        <div class="strip-meter"><i data-meter="${track.id}"></i></div>
      </div>
      <div class="strip-db">${track.volume.toFixed(1)} dB</div>
      <div class="strip-btns">
        <button class="mute ${track.mute ? "on" : ""}" data-mute="${track.id}">M</button>
        <button class="solo ${track.solo ? "on" : ""}" data-solo="${track.id}">S</button>
      </div>
      <div class="strip-sends">
        <label>混响<input type="range" min="0" max="100" value="${Math.round((track.rev || 0) * 100)}" data-send="rev" data-track="${track.id}"></label>
        <label>延迟<input type="range" min="0" max="100" value="${Math.round((track.dly || 0) * 100)}" data-send="dly" data-track="${track.id}"></label>
      </div>`;
    s.addEventListener("input", (e) => {
      const t = App.project.tracks.find(x => x.id === track.id);
      if (e.target.dataset.fader) {
        t.volume = parseFloat(e.target.value);
        Engine.setTrackParam(t.id, "volume", t.volume);
        s.querySelector(".strip-db").textContent = t.volume.toFixed(1) + " dB";
        autosave();
      }
      if (e.target.dataset.pan) {
        t.pan = parseFloat(e.target.value) / 100;
        Engine.setTrackParam(t.id, "pan", t.pan);
        autosave();
      }
      if (e.target.dataset.send) {
        t[e.target.dataset.send] = parseFloat(e.target.value) / 100;
        Engine.setTrackParam(t.id, "volume", t.volume);
        Engine.applyTrackParams(t);
        autosave();
      }
    });
    s.addEventListener("click", (e) => {
      const t = App.project.tracks.find(x => x.id === track.id);
      if (e.target.dataset.mute !== undefined) {
        t.mute = !t.mute;
        Engine.setTrackMute(t.id, t.mute);
        pushUndo("静音"); renderTracks(); renderDock(); autosave();
      }
      if (e.target.dataset.solo !== undefined) {
        t.solo = !t.solo;
        Engine.setTrackSolo(t.id, t.solo);
        pushUndo("独奏"); renderTracks(); renderDock(); autosave();
      }
    });
    return s;
  }

  /* ═══ 和弦 / 结构 ═════════════════════════ */
  function renderChords() {
    const list = $("#sections-list");
    const grid = $("#chord-grid");
    if (!list || !grid) return;
    list.innerHTML = App.project.sections.map(s =>
      `<span class="section-pill"><b>${s.name}</b> ${s.start}–${s.end}</span>`).join("");
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    App.project.chords.forEach((c, i) => {
      const bar = i + 1;
      const sec = App.project.sections.find(s => bar >= s.start && bar <= s.end);
      const cell = document.createElement("div");
      cell.className = "chord-cell";
      cell.dataset.bar = bar;
      cell.innerHTML = `${c}<small>${bar}${sec ? " · " + sec.name : ""}</small>`;
      cell.addEventListener("click", () => {
        Engine.seek(bar);
        App.playBar = bar;
        updatePlayhead(bar);
        toast(`定位到第 ${bar} 小节 · ${c}`);
      });
      frag.appendChild(cell);
    });
    grid.appendChild(frag);
  }

  /* ═══ 检查器 / 元信息 ═════════════════════ */
  function renderInspectorMeta() {
    const p = App.project;
    $("#info-duration").textContent = fmtDuration(p.meta.bars);
    $("#info-tracks").textContent = p.tracks.length;
    const regions = p.tracks.reduce((n, t) => n + (t.regions ? t.regions.length : 0), 0);
    $("#info-regions").textContent = regions;
    $("#info-undo").textContent = App.undoStack.length;
    $("#lcd-bpm").textContent = p.meta.bpm.toFixed(1);
    $("#lcd-key").textContent = p.meta.keyLabel;
    $("#lcd-sig").textContent = p.meta.sig;
    $("#lyrics-editor").value = p.lyrics;
    $("#ai-fit-v").textContent = $("#ai-fit").value;
    $("#ai-creative-v").textContent = $("#ai-creative").value;
    $("#ai-density-v").textContent = $("#ai-density").value;
    if (p.ai) {
      $("#ai-prompt").value = p.ai.prompt || "";
      $("#ai-vocal").value = p.ai.vocal || "male";
      $$("#ai-styles button").forEach(b => b.classList.toggle("active", b.dataset.style === p.ai.style));
    }
  }

  function fmtDuration(bars) {
    const sec = bars * 4 * (60 / App.project.meta.bpm);
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }


  /* ═══ 自动化编辑器 ═══════════════════════ */
  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return `rgba(85,195,188,${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  const AUTO_META = {
    volume: { label: "音量", min: -60, max: 6, unit: "dB", fmt: v => v.toFixed(1), def: -6, color: "#55c3bc" },
    pan: { label: "声像", min: -1, max: 1, unit: "", fmt: v => (v >= 0 ? "R" : "L") + Math.abs(Math.round(v * 100)), def: 0, color: "#d9a04a" },
    rev: { label: "混响", min: 0, max: 1, unit: "", fmt: v => Math.round(v * 100) + "%", def: 0.15, color: "#7fa8e0" },
    dly: { label: "延迟", min: 0, max: 1, unit: "", fmt: v => Math.round(v * 100) + "%", def: 0.05, color: "#b98fd8" }
  };

  function autoTrack() {
    return App.project.tracks.find(t => t.id === App.auto.trackId) || App.project.tracks[0];
  }
  function autoPoints(track, param) {
    if (!track.automation) track.automation = {};
    if (!track.automation[param]) track.automation[param] = [];
    return track.automation[param];
  }
  function autoValueOf(track, param) {
    const meta = AUTO_META[param];
    if (param === "volume") return track.volume;
    if (param === "pan") return track.pan || 0;
    return track[param] === undefined ? meta.def : track[param];
  }

  function renderAutomation() {
    const track = autoTrack();
    const sel = $("#auto-track");
    if (sel && sel.options.length !== App.project.tracks.length) {
      sel.innerHTML = App.project.tracks.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    }
    if (sel) sel.value = track.id;
    const param = App.auto.param;
    const meta = AUTO_META[param];
    $$("#auto-param button").forEach(b => b.classList.toggle("active", b.dataset.autoParam === param));
    const points = autoPoints(track, param);
    $("#auto-enabled").checked = points.length >= 2;
    $("#auto-hint").textContent = points.length
      ? `${meta.label}自动化 · ${points.length} 个控制点 · 拖动控制点，双击删除`
      : `拖动控制点 · 双击删除 · 空白处点击加点`;

    const cv = $("#auto-canvas");
    const wrap = cv.parentElement;
    const dpr = 2;
    const bars = App.project.meta.bars;
    const pxPerBar = Math.max(18, Math.min(60, App.barW));
    const w = bars * pxPerBar;
    const h = Math.max(120, wrap.clientHeight - 2);
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#191a1e"; g.fillRect(0, 0, w, h);

    const top = 10, bottom = h - 10;
    const yOf = v => bottom - ((v - meta.min) / (meta.max - meta.min)) * (bottom - top);
    const vOf = y => meta.min + ((bottom - y) / (bottom - top)) * (meta.max - meta.min);
    const xOfBeat = beat => (beat / 4) * pxPerBar;
    const beatOfX = x => (x / pxPerBar) * 4;

    // 段落背景
    App.project.sections.forEach(sec => {
      const x0 = xOfBeat((sec.start - 1) * 4), x1 = xOfBeat(sec.end * 4);
      g.fillStyle = sec.type === "chorus" ? "rgba(217,160,74,.06)"
        : sec.type === "verse" ? "rgba(85,195,188,.045)"
        : sec.type === "bridge" ? "rgba(140,120,190,.06)" : "rgba(255,255,255,.018)";
      g.fillRect(x0, 0, x1 - x0, h);
      if (pxPerBar > 26) {
        g.fillStyle = "#5b5a61"; g.font = "8px -apple-system, sans-serif";
        g.fillText(sec.name, x0 + 4, 9);
      }
    });
    // 小节线
    for (let bar = 1; bar <= bars; bar++) {
      const x = xOfBeat((bar - 1) * 4);
      g.strokeStyle = bar % 4 === 1 ? "rgba(255,255,255,.09)" : "rgba(255,255,255,.035)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    // 零值线（pan）
    if (param === "pan") {
      g.strokeStyle = "rgba(255,255,255,.12)"; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(0, yOf(0)); g.lineTo(w, yOf(0)); g.stroke();
      g.setLineDash([]);
    }
    // 曲线（无点则画静态值虚线）
    const draw = points.length >= 2 ? points.slice().sort((a, b) => a.beat - b.beat) : null;
    if (!draw) {
      g.strokeStyle = "rgba(255,255,255,.22)"; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(0, yOf(autoValueOf(track, param))); g.lineTo(w, yOf(autoValueOf(track, param))); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#67666d"; g.font = "10px -apple-system, sans-serif";
      g.fillText("未启用自动化 · 点击曲线区域添加控制点", 12, h / 2 - 8);
    } else {
      g.beginPath();
      g.moveTo(xOfBeat(draw[0].beat), yOf(draw[0].value));
      draw.forEach(p => g.lineTo(xOfBeat(p.beat), yOf(p.value)));
      g.lineTo(xOfBeat(bars * 4), yOf(draw[draw.length - 1].value));
      g.strokeStyle = meta.color; g.lineWidth = 1.6;
      g.shadowColor = meta.color; g.shadowBlur = 5;
      g.stroke();
      g.shadowBlur = 0;
      // 填充（曲线下方半透明区域）
      g.lineTo(xOfBeat(bars * 4), bottom); g.lineTo(xOfBeat(draw[0].beat), bottom); g.closePath();
      g.fillStyle = hexToRgba(meta.color, 0.10);
      g.fill();
      // 控制点
      draw.forEach((p, i) => {
        const x = xOfBeat(p.beat), y = yOf(p.value);
        g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2);
        g.fillStyle = i === App.autoDragIdx ? "#fff" : meta.color; g.fill();
        g.strokeStyle = "#0f1012"; g.lineWidth = 1; g.stroke();
      });
    }
    // 播放头
    if (App.playBar) {
      const px = xOfBeat((App.playBar - 1) * 4);
      g.strokeStyle = "#d9a04a"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, h); g.stroke();
    }
    cv._map = { yOf, vOf, xOfBeat, beatOfX, pxPerBar, h, meta };

    // 刻度
    const scale = $("#auto-scale");
    if (scale) {
      const ticks = [];
      let values = [];
      if (param === "pan") {
        values = [1, 0.5, 0, -0.5, -1];
      } else if (param === "volume") {
        values = [6, -6, -18, -30, -42, -60];
      } else {
        values = [1, 0.5, 0];
      }
      const seen = [];
      values.forEach(v => {
        if (v < meta.min - 1e-6 || v > meta.max + 1e-6) return;
        if (seen.some(u => Math.abs(u - v) < 1e-6)) return;
        seen.push(v);
        ticks.push(`<span style="top:${yOf(v)}px">${meta.fmt(v)}${meta.unit}</span>`);
      });
      scale.innerHTML = ticks.join("");
    }
    bindAutomation(cv, track, param);
  }

  function bindAutomation(cv, track, param) {
    if (cv.dataset.bound === "1") return;
    cv.dataset.bound = "1";
    const hitPoint = (e) => {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const pts = autoPoints(track, param);
      for (let i = 0; i < pts.length; i++) {
        const px = cv._map.xOfBeat(pts[i].beat), py = cv._map.yOf(pts[i].value);
        if (Math.hypot(px - x, py - y) <= 6) return i;
      }
      return -1;
    };
    cv.addEventListener("pointerdown", (e) => {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pts = autoPoints(track, param);
      const hit = hitPoint(e);
      if (hit >= 0) {
        App.autoDragIdx = hit;
        App.autoDrag = { index: hit, moved: false };
        cv.setPointerCapture(e.pointerId);
      } else {
        pushUndo("添加自动化点");
        const beat = clamp(cv._map.beatOfX(x), 0, App.project.meta.bars * 4);
        const value = clamp(cv._map.vOf(y), AUTO_META[param].min, AUTO_META[param].max);
        pts.push({ beat, value });
        pts.sort((a, b) => a.beat - b.beat);
        App.autoDragIdx = pts.findIndex(p => Math.abs(p.beat - beat) < 1e-6);
        App.autoDrag = { index: App.autoDragIdx, moved: false };
        renderAutomation();
        autosave();
      }
    });
    cv.addEventListener("pointermove", (e) => {
      if (!App.autoDrag) return;
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const pts = autoPoints(track, param);
      const p = pts[App.autoDrag.index];
      if (!p) return;
      if (!App.autoDrag.moved) { pushUndo("调整自动化"); App.autoDrag.moved = true; }
      p.beat = clamp(cv._map.beatOfX(x), 0, App.project.meta.bars * 4);
      p.value = clamp(cv._map.vOf(y), AUTO_META[param].min, AUTO_META[param].max);
      pts.sort((a, b) => a.beat - b.beat);
      App.autoDrag.index = pts.indexOf(p);
      renderAutomation();
      autosave();
    });
    window.addEventListener("pointerup", () => { App.autoDrag = null; App.autoDragIdx = -1; });
    cv.addEventListener("dblclick", (e) => {
      const hit = hitPoint(e);
      if (hit < 0) return;
      pushUndo("删除自动化点");
      autoPoints(track, param).splice(hit, 1);
      renderAutomation();
      autosave();
    });
  }

  function autoShape(kind) {
    const track = autoTrack();
    const param = App.auto.param;
    const meta = AUTO_META[param];
    pushUndo("自动化形状");
    const bars = App.project.meta.bars;
    let pts = [];
    if (kind === "fade" && param === "volume") {
      pts = [
        { beat: 0, value: meta.min },
        { beat: 2, value: autoValueOf(track, "volume") },
        { beat: (bars - 4) * 4, value: autoValueOf(track, "volume") },
        { beat: bars * 4, value: meta.min }
      ];
    } else if (kind === "swell" && param === "volume") {
      const base = autoValueOf(track, "volume");
      pts = [{ beat: 0, value: base }];
      App.project.sections.forEach(sec => {
        if (sec.type === "chorus") {
          pts.push({ beat: (sec.start - 1) * 4, value: base - 2 });
          pts.push({ beat: (sec.end - 1) * 4, value: Math.min(meta.max, base + 3) });
        }
      });
      pts.push({ beat: bars * 4, value: base });
    } else if (param === "pan") {
      pts = [{ beat: 0, value: -0.4 }, { beat: bars * 2, value: 0.4 }, { beat: bars * 4, value: 0 }];
    } else {
      pts = [{ beat: 0, value: meta.def }, { beat: bars * 2, value: Math.min(meta.max, meta.def + 0.5) }, { beat: bars * 4, value: meta.def }];
    }
    pts.sort((a, b) => a.beat - b.beat);
    track.automation = track.automation || {};
    track.automation[param] = pts;
    Engine.applyTrackParams(track);
    renderAutomation();
    renderTracks();
    autosave();
    toast("已生成" + AUTO_META[param].label + "自动化");
  }

  function clearAutomation() {
    const track = autoTrack();
    pushUndo("清除自动化");
    track.automation = track.automation || {};
    track.automation[App.auto.param] = [];
    Engine.applyTrackParams(track);
    renderAutomation();
    renderTracks();
    autosave();
    toast("已清除" + AUTO_META[App.auto.param].label + "自动化");
  }

  /* ═══ 五线谱 ═════════════════════════════ */
  function scoreDoc(part) {
    const p = App.project;
    const sections = p.sections.map(s => ({ name: s.name, start: s.start, end: s.end }));
    const tracks = [];
    const pick = (id) => p.tracks.find(t => t.id === id);
    const toNotes = (track) => {
      const out = [];
      (track.regions || []).forEach(r => {
        const base = (r.startBar - 1) * 4;
        (r.notes || []).forEach(n => out.push({ pitch: n.pitch, start: base + n.start, dur: n.dur, velocity: n.velocity || 80 }));
      });
      return out.sort((a, b) => a.start - b.start);
    };
    if (part === "piano" || part === "all") {
      const piano = pick("piano");
      if (piano) tracks.push({ id: "piano-treble", name: "钢琴", clef: "treble", notes: toNotes(piano).filter(n => n.pitch >= 55) });
      if (piano) tracks.push({ id: "piano-bass", name: "钢琴（低）", clef: "bass", notes: toNotes(piano).filter(n => n.pitch < 55) });
    }
    if (part === "lead" || part === "all") {
      const lead = pick("lead");
      if (lead) tracks.push({ id: "lead", name: "旋律", clef: "treble", notes: toNotes(lead) });
    }
    return {
      title: p.meta.title,
      subtitle: `${p.meta.bpm} BPM · ${p.meta.keyLabel} · ${p.meta.sig}`,
      bars: p.meta.bars,
      timeSignature: [4, 4],
      keySignature: { sharps: 0 },
      sections,
      chords: p.chords,
      tracks
    };
  }

  function renderScore() {
    const cv = $("#score-canvas");
    if (!cv || !window.Notation) {
      if (cv && !window.Notation) {
        const g = cv.getContext("2d");
        cv.width = 600; cv.height = 80;
        g.fillStyle = "#1a1b1f"; g.fillRect(0, 0, 600, 80);
        g.fillStyle = "#8b8a90"; g.font = "12px -apple-system, sans-serif";
        g.fillText("五线谱模块加载中…", 16, 44);
      }
      return;
    }
    const doc = scoreDoc(App.score.part);
    const wrap = $("#score-scroll");
    const width = Math.max(760, wrap.clientWidth - 4);
    const opts = {
      width: Math.floor(width * App.score.zoom),
      scale: 1,
      lineSpace: 8,
      showChords: App.score.chords,
      showSections: App.score.sections,
      showBarNumbers: true,
      highlightBar: App.score.follow ? App.playBar : 0
    };
    const info = Notation.render(cv, doc, opts);
    cv._info = info;
    $("#score-zoom-label").textContent = Math.round(App.score.zoom * 100) + "%";
    // 跟随时自动滚到当前小节所在行
    if (App.score.follow && App.playBar && info.systems) {
      const rowIdx = Math.floor((App.playBar - 1) / info.barsPerSystem);
      const rowH = info.height / info.systems;
      const target = Math.max(0, rowIdx * rowH - rowH * 0.5);
      const scroller = $("#score-scroll");
      if (scroller && Math.abs(scroller.scrollTop - target) > rowH * 0.6) {
        scroller.scrollTo({ top: target, behavior: "smooth" });
      }
    }
    const totalNotes = doc.tracks.reduce((n, t) => n + t.notes.length, 0);
    $("#score-hint").textContent =
      `大谱表 · ${App.project.meta.sig} · ${App.project.meta.keyLabel} · ` +
      `${info.systems || info.systems === 0 ? info.systems : "?"} 行 · ${totalNotes} 音符`;
  }

  function drawAutoPlayhead() {
    const cv = $("#auto-canvas");
    if (!cv || !cv._map) return;
    const bar = App.playBar;
    if (cv._lastBar === bar) return;
    cv._lastBar = bar;
    // 简化：整块重绘（数据量小，成本可接受）
    renderAutomation();
  }

  function exportScorePNG() {
    const cv = $("#score-canvas");
    if (!cv) return;
    cv.toBlob(blob => {
      if (!blob) return toast("导出失败");
      downloadBlob(blob, `镜湖_五线谱_${today()}.png`);
      toast("五线谱 PNG 已导出");
    }, "image/png");
  }

  /* ═══ 录音 ═══════════════════════════════ */
  let recCanvasCtx = null;
  function drawRecScope(level) {
    const cv = $("#rec-wave");
    if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * DPR; cv.height = h * DPR;
    if (!recCanvasCtx) recCanvasCtx = cv.getContext("2d");
    const g = recCanvasCtx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = "#0e0f11"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(85,195,188,.18)";
    g.beginPath(); for (let x = 0; x < w; x += 6) { g.moveTo(x, h / 2); g.lineTo(x, h / 2); } g.stroke();
    g.strokeStyle = "#55c3bc"; g.lineWidth = 1.5; g.beginPath();
    const mid = h / 2;
    g.moveTo(0, mid);
    for (let x = 0; x < w; x++) {
      const v = Math.sin(x * 0.05 + performance.now() * 0.004) * level * (h * 0.42) * (0.4 + Math.random() * 0.6);
      g.lineTo(x, mid - v);
    }
    g.stroke();
  }

  async function beginRecording() {
    try {
      App.recState.armed = true;
      $("#rec-arm").classList.add("on");
      $("#rec-start").disabled = false;
      $("#rec-stop").disabled = true;
      await Engine.init();
      const devs = await Engine.listInputs();
      const sel = $("#rec-input");
      if (devs.length) {
        sel.innerHTML = devs.map(d => `<option value="${d.deviceId}">${d.label || "输入设备"}</option>`).join("");
      }
      toast("麦克风已就绪，可以开始录音");
    } catch (e) {
      toast("无法访问麦克风：" + e.message);
    }
  }

  async function startRec() {
    try {
      if (!Engine.state.ctx) await Engine.init();
      await Engine.startRecord();
      App.recState.recording = true;
      $("#rec-start").disabled = true;
      $("#rec-stop").disabled = false;
      $("#btn-record").classList.add("on");
      $("#rec-time").textContent = "00:00.0";
      App.recTimer = setInterval(() => {
        const t = (Date.now() - (App.recStart || Date.now())) / 1000;
        $("#rec-time").textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;
      }, 100);
      App.recStart = App.recStart || Date.now();
      toast("录音中……再次点击停止");
    } catch (e) {
      toast("录音启动失败：" + e.message);
    }
  }

  async function stopRec() {
    try {
      clearInterval(App.recTimer);
      const res = await Engine.stopRecord();
      App.recState.recording = false;
      $("#rec-start").disabled = false;
      $("#rec-stop").disabled = true;
      $("#btn-record").classList.remove("on");
      if (!res) return;
      pushUndo("录音");
      const track = App.project.tracks.find(t => t.id === "vocal");
      if (track && res.buffer) {
        const id = "rec-" + Date.now();
        Engine.state.buffers[id] = res.buffer;
        track.regions.push({
          id, startBar: res.startBar, lengthBars: Math.max(1, res.endBar - res.startBar),
          mediaId: id, name: "录音 " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        });
        renderTracks();
        toast("录音已写入「主唱」轨");
      } else {
        toast("录音完成，但未获得音频数据");
      }
      const takes = takesStore();
      takes.push({
        buffer: res.buffer || null,
        weight: 1,
        solo: false,
        startBeat: res.startBeat,
        startBar: res.startBar,
        size: res.blob ? res.blob.size : 0
      });
      const take = document.createElement("div");
      take.className = "take-item";
      take.innerHTML = `<span class="take-dot"></span><span>Take ${takes.length}</span><span class="take-meta">${res.startBar} 小节起 · ${res.blob ? (res.blob.size / 1024).toFixed(0) : 0} KB</span>`;
      $("#takes").prepend(take);
      renderTakeList();
      autosave();
    } catch (e) {
      toast("录音终止失败：" + e.message);
    }
  }


  /* ═══ 多 take 合成 ═══════════════════════ */
  function takesStore() {
    if (!App.takes) App.takes = [];
    return App.takes;
  }

  function renderTakeList() {
    const list = $("#take-comp-list");
    if (!list) return;
    const takes = takesStore();
    if (!takes.length) {
      list.innerHTML = `<div class="take-empty">还没有录音 take。点「开始录音」录几遍同一段，它们会出现在这里。</div>`;
      const btn = $("#take-compile");
      if (btn) btn.disabled = true;
      return;
    }
    const btn = $("#take-compile");
    if (btn) btn.disabled = takes.length < 2;
    list.innerHTML = takes.map((t, i) => `
      <div class="take-comp-row" data-take="${i}">
        <span class="tk-name">Take ${i + 1}</span>
        <div class="tk-bar"><i style="width:${Math.round((t.weight === undefined ? 1 : t.weight) * 100)}%"></i></div>
        <input type="range" min="0" max="100" value="${Math.round((t.weight === undefined ? 1 : t.weight) * 100)}" data-take-weight="${i}" style="flex:1;accent-color:var(--accent);height:10px">
        <span class="tk-val">${Math.round((t.weight === undefined ? 1 : t.weight) * 100)}%</span>
        <button class="tk-solo ${t.solo ? "on" : ""}" data-take-solo="${i}" title="独听">S</button>
      </div>`).join("");
    $$("[data-take-weight]", list).forEach(el => el.addEventListener("input", (e) => {
      const i = parseInt(e.target.dataset.takeWeight, 10);
      takesStore()[i].weight = parseInt(e.target.value, 10) / 100;
      const row = e.target.closest(".take-comp-row");
      row.querySelector(".tk-bar i").style.width = e.target.value + "%";
      row.querySelector(".tk-val").textContent = e.target.value + "%";
    }));
    $$("[data-take-solo]", list).forEach(el => el.addEventListener("click", () => {
      const i = parseInt(el.dataset.takeSolo, 10);
      const takes = takesStore();
      takes[i].solo = !takes[i].solo;
      renderTakeList();
    }));
    $("#take-hint").textContent = `${takes.length} 条 take · 拖动权重后点「合成为一条」`;
  }

  function compileTakes() {
    const takes = takesStore().filter(t => t.buffer);
    if (takes.length < 2) return toast("至少需要 2 条 take");
    pushUndo("多 take 合成");
    const align = $("#take-align") ? $("#take-align").checked : false;
    const payload = takes.map(t => ({
      buffer: t.buffer,
      weight: t.solo ? 1 : (t.weight === undefined ? 1 : t.weight),
      offset: align ? 0 : (t.startBeat || 0) * (60 / App.project.meta.bpm)
    }));
    const mixed = Engine.mixTakes(payload, { alignStart: align });
    if (!mixed) return toast("合成失败：没有可用音频");
    const id = "take-" + Date.now();
    Engine.state.buffers[id] = mixed;
    const track = App.project.tracks.find(t => t.id === "vocal");
    const startBeat = Math.min(...takes.map(t => t.startBeat || 0));
    const startBar = Math.max(1, Math.floor(startBeat / 4) + 1);
    const barsPerSec = App.project.meta.bpm / 240;
    const lenBars = Math.max(1, Math.round(mixed.duration * barsPerSec));
    track.regions.push({
      id, startBar, lengthBars: lenBars, mediaId: id,
      name: `${takes.length} take 合成`
    });
    Engine.buildEvents(App.project);
    renderTracks();
    renderTakeList();
    autosave();
    toast(`已合成 ${takes.length} 条 take → ${mixed.duration.toFixed(1)} 秒`);
  }

  /* ═══ 导出 ═══════════════════════════════ */
  function openExport() {
    const d = App.project;
    const modal = document.createElement("div");
    modal.className = "modal-mask";
    modal.innerHTML = `
      <div class="modal export-modal" role="dialog" aria-label="导出母带">
        <div class="modal-head"><h3>导出母带</h3><button class="close" data-close>✕</button></div>
        <div class="modal-body">
          <p class="modal-sub">V1 导出链路：立体声母带、分轨 ZIP、主唱干声 / 伴奏，以及响度规范化（ITU-R BS.1770 简化实现，含 −1 dBFS 峰值保护）。</p>
          <div class="field"><label>范围</label>
            <select id="exp-range">
              <option value="all">整首（第 1–${d.meta.bars} 小节）</option>
              <option value="cycle">循环区间（第 ${Engine.state.loopStartBar}–${Engine.state.loopEndBar} 小节）</option>
              <option value="chorus">副歌（第 29–56 小节）</option>
            </select>
          </div>
          <div class="field"><label>导出内容</label>
            <select id="exp-type">
              <option value="mix">立体声混音（母带 WAV）</option>
              <option value="stems">分轨 ZIP（每轨独立 WAV）</option>
              <option value="vocal">仅主唱干声</option>
              <option value="inst">伴奏（除主唱）</option>
            </select>
          </div>
          <div class="field"><label>格式</label>
            <select id="exp-format"><option value="wav">WAV · 48kHz / 16bit</option></select>
          </div>
          <div class="field"><label>包含轨道</label>
            <div class="track-list">
              ${d.tracks.map(t => `<label class="track-check"><input type="checkbox" data-exp-track="${t.id}" checked> ${t.name}</label>`).join("")}
            </div>
          </div>
          <div class="field"><label>响度规范</label>
            <select id="exp-loud">
              <option value="none">保持原始电平（仅峰值 −1 dB）</option>
              <option value="-14">−14 LUFS · 流媒体（Spotify / Apple Music）</option>
              <option value="-16">−16 LUFS · 播客 / 有声</option>
              <option value="-9">−9 LUFS · 响母带（俱乐部）</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn primary" id="exp-run">开始渲染</button>
            <button class="btn" id="exp-json">导出工程 JSON</button>
            <button class="btn ghost" data-close>取消</button>
          </div>
          <div class="mini-note" id="exp-status" style="margin-top:10px"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.dataset.close !== undefined) modal.remove();
    });
    $("#exp-run", modal).addEventListener("click", () => runExport(modal));
    $("#exp-json", modal).addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(App.project, null, 2)], { type: "application/json" });
      downloadBlob(blob, "镜湖_工程.json");
      modal.remove();
    });
  }

  async function ensureBuffers(proj) {
    for (const t of proj.tracks) {
      for (const r of t.regions || []) {
        if (t.type === "audio" && r.mediaId && !Engine.state.buffers[r.mediaId]) {
          const media = App.project.media.find(m => m.id === r.mediaId);
          if (media) await Engine.loadAudio(media.id, media.file);
        }
      }
    }
  }
  function blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsArrayBuffer(blob);
    });
  }
  const today = () => new Date().toISOString().slice(0, 10);

  async function runExport(modal) {
    const range = $("#exp-range", modal).value;
    let from = 1, to = App.project.meta.bars;
    if (range === "cycle") { from = Engine.state.loopStartBar; to = Engine.state.loopEndBar; }
    if (range === "chorus") { from = 29; to = 56; }
    const type = $("#exp-type", modal).value;
    const loud = $("#exp-loud", modal).value;
    let include = new Set($$("[data-exp-track]", modal).filter(c => c.checked).map(c => c.dataset.expTrack));
    if (type === "vocal") include = new Set(["vocal"]);
    if (type === "inst") include.delete("vocal");
    const status = $("#exp-status", modal);
    const runBtn = $("#exp-run", modal);
    if (runBtn) runBtn.disabled = true;
    status.textContent = "准备离线渲染…";
    const proj = snapshot();
    proj.tracks = proj.tracks.filter(t => include.has(t.id));
    if (!proj.tracks.length) { status.textContent = "没有选中任何轨道"; if (runBtn) runBtn.disabled = false; return; }
    const target = loud === "none" ? null : parseFloat(loud);
    const yieldUI = () => new Promise(r => setTimeout(r, 24));
    try {
      await ensureBuffers(proj);
      if (type === "stems") {
        // 分轨：所有轨道统一按母带目标响度给同一增益，保持混音比例
        let gainDb = 0;
        let mixLufs = null;
        if (target) {
          status.textContent = "计算混音响度…";
          await yieldUI();
          const mix = await Engine.renderOffline(proj, from, to);
          const n = Engine.normalizeLufs(mix, target);
          gainDb = n.gainDb;
          mixLufs = n.after;
        }
        const files = [];
        const report = [];
        for (let i = 0; i < proj.tracks.length; i++) {
          const t = proj.tracks[i];
          status.textContent = `渲染分轨 ${i + 1}/${proj.tracks.length}：${t.name}…`;
          await yieldUI();
          const one = Object.assign({}, proj, { tracks: [t] });
          let buf = await Engine.renderOffline(one, from, to);
          if (target) buf = Engine.applyGain(buf, gainDb);
          const lufs = Engine.measureLufs(buf).lufs;
          const wav = await blobToArrayBuffer(Engine.encodeWav(buf));
          files.push({ name: `${String(i + 1).padStart(2, "0")}_${t.name}.wav`, data: new Uint8Array(wav) });
          report.push(`${String(i + 1).padStart(2, "0")}  ${t.name}  ${buf.duration.toFixed(1)}s  ${lufs.toFixed(1)} LUFS`);
        }
        const readme = [
          "理音 Liyin Studio · 干声分轨",
          `工程：${proj.meta.title}（${proj.meta.bpm} BPM · ${proj.meta.keyLabel} · ${proj.meta.sig}）`,
          `范围：第 ${from}–${to} 小节`,
          target ? `响度：按整轨混音统一到 ${target} LUFS（增益 ${gainDb.toFixed(1)} dB，峰值保护 −1 dBFS）` : "响度：保持原始分轨电平",
          "", "文件：", ...report
        ].join("\n");
        files.push({ name: "分轨说明.txt", data: new TextEncoder().encode(readme) });
        const zip = Engine.makeZip(files);
        downloadBlob(zip, `镜湖_分轨_${today()}.zip`);
        status.textContent = `已导出 ${proj.tracks.length} 条分轨 ZIP · ${(zip.size / 1048576).toFixed(1)} MB${target ? " · 统一 " + target + " LUFS" : ""} · 含说明文件`;
      } else {
        status.textContent = "离线渲染混音中…";
        await yieldUI();
        let buf = await Engine.renderOffline(proj, from, to);
        const before = Engine.measureLufs(buf).lufs;
        let note = `峰值 −1 dBFS · ${before.toFixed(1)} LUFS`;
        if (target) {
          const n = Engine.normalizeLufs(buf, target);
          buf = n.buffer;
          note = `${n.before.toFixed(1)} → ${n.after.toFixed(1)} LUFS（增益 ${n.gainDb >= 0 ? "+" : ""}${n.gainDb.toFixed(1)} dB）`;
        }
        const blob = Engine.encodeWav(buf);
        const suffix = type === "vocal" ? "主唱干声" : type === "inst" ? "伴奏" : "母带";
        downloadBlob(blob, `镜湖_${suffix}_${today()}.wav`);
        status.textContent = `已渲染 ${buf.duration.toFixed(1)} 秒 · ${(blob.size / 1048576).toFixed(1)} MB · ${note} · 已开始下载`;
      }
      setTimeout(() => modal.remove(), 2200);
    } catch (e) {
      status.textContent = "渲染失败：" + e.message;
    } finally {
      if (runBtn) runBtn.disabled = false;
    }
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ═══ 能力地图 ═══════════════════════════ */
  const ROADMAP = [
    ["工程与时间线", "多轨音频/MIDI、区域编排、标记、撤销历史", "编排标记段落、文件夹轨/轨栈、模板工程", "云同步工程元数据、版本分支"],
    ["录音与 take", "立体声/单声道录音、打点、循环录音", "多 take 合成、旁听低延迟、闪回缓冲捕获", "分层人声自动分离导入工作流"],
    ["节拍与采样", "步进音序器、基础采样器、鼓垫套件", "自定义鼓机设计、切片/翻转采样、鼓合成器", "循环格实时触发与现场编排视图"],
    ["MIDI 与谱曲", "钢琴卷帘、量化、速度轨、调号拍号", "五线谱编辑、和弦轨、简单吉他谱/和弦格", "多声部总谱、MusicXML 进出、分轨打印"],
    ["音源与效果库", "精选钢琴/贝斯/合成器/鼓 + EQ/压缩/混响/延迟", "可扩展音色包管理、模拟染色类效果", "第三方制作人包生态与商店"],
    ["插件生态", "AU 乐器/效果扫描与插入", "插件管理器、旁链、延迟补偿开关", "插件沙箱与崩溃隔离加强"],
    ["混音", "通道条、推子/声像、发送、总线、自动化", "编组、轨栈、旁链、低延迟监听模式", "大型工程（数百轨）性能档与群组自动化"],
    ["智能辅助", "智能速度匹配、基础音高校正", "和弦识别写入和弦轨、虚拟乐手（鼓/贝斯/键盘）", "分轨拆解、母带辅助、更丰富的合成风格乐手"],
    ["导出与空间音频", "WAV/AIFF/MP3、工程归档", "干声分轨导出、响度规范预设", "杜比 Atmos 类空间混音与 ADM 级交付"],
    ["跨设备与协作", "本机工程；可选无线控制端调研", "与轻量移动端工程互通（只读/精简编辑）", "iPad 触控创作端、团队批注协作"]
  ];
  const STATUS = ["done", "done", "partial", "done", "partial", "next", "done", "partial", "done", "next"];
  const STATUS_LABEL = { done: "✓", partial: "◐", next: "○" };
  function openRoadmap() {
    const rows = ROADMAP.map((r, i) => {
      const st = STATUS[i] || "next";
      const cls = st === "done" ? "mvdone" : st === "partial" ? "mvpart" : "";
      return `<tr>
        <td><b>${r[0]}</b></td>
        <td class="${cls}"><span class="st">${STATUS_LABEL[st]}</span>${r[1]}</td>
        <td>${r[2]}</td>
        <td>${r[3]}</td>
      </tr>`;
    }).join("");
    const modal = document.createElement("div");
    modal.className = "modal-mask";
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-head"><h3>能力地图 · MVP / V1 / 后续</h3><button class="close" data-close>✕</button></div>
        <div class="modal-body">
          <p class="modal-sub">✓ 已覆盖 · ◐ 部分覆盖（原型内可见） · ○ 规划中（V1 / 后续）。本原型目标：<b>独立完成一首立体声可发布作品</b>，并保留通往 V1 的架构位置。</p>
          <p class="modal-sub" style="color:var(--accent);margin-top:-4px">已升级到 V1 的三项：<b>自动化曲线</b>（音量/声像/发送，播放与离线渲染均生效）、<b>五线谱</b>（大谱表 + 和弦 + 段落 + PNG 导出）、<b>多 take 合成</b>（权重混合 + 对齐 + 软限幅）；导出已覆盖干声分轨与 −14/−16/−9 LUFS 响度规范。</p>
          <table class="cap-table">
            <thead><tr><th style="width:110px">能力域</th><th>MVP（当前，✓ 已覆盖）</th><th>V1（专业小工作室）</th><th>后续</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p class="modal-sub" style="margin-top:12px">设计原则：创作流不断（切换视图不丢上下文）、智能辅助可调（滑杆级参数）、中文体验优先（术语、排版、模型输出均中文）。</p>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.dataset.close !== undefined) modal.remove(); });
  }

  /* ═══ 素材 / 会话导入 ═════════════════════ */
  async function addMediaToTrack(mediaId) {
    const media = App.project.media.find(m => m.id === mediaId);
    if (!media) return;
    try {
      await Engine.loadAudio(media.id, media.file);
      const track = App.project.tracks.find(t => t.id === "vocal");
      pushUndo("放入素材");
      const exists = track.regions.find(r => r.mediaId === mediaId);
      if (exists) { toast("该素材已在主唱轨中"); return; }
      const barsPerSec = App.project.meta.bpm / 240;
      const lenBars = Math.max(1, Math.min(App.project.meta.bars, Math.round((media.duration || 230) / (1 / barsPerSec))));
      track.regions.push({
        id: "ar-" + mediaId + "-" + Date.now(),
        startBar: 1, lengthBars: lenBars,
        mediaId: media.id, name: media.name
      });
      Engine.buildEvents(App.project);
      renderTracks();
      autosave();
      toast("已放入「主唱」轨 · 可用 M/S 对照试听");
    } catch (e) {
      toast("素材加载失败：" + e.message);
    }
  }

  /* ═══ UI 绑定 ════════════════════════════ */
  function wire() {
    // 走带
    $$("[data-act]").forEach(b => b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "play") togglePlay();
      if (act === "stop") { Engine.stop(); toast("已停止"); updateTransportUI(); }
      if (act === "to-start") { Engine.seek(1); App.playBar = 1; updatePlayhead(1); }
      if (act === "rewind") { Engine.seek(Math.max(1, App.playBar - 1)); }
      if (act === "record") { switchView("record"); }
      if (act === "cycle") {
        App.cycle = !App.cycle;
        Engine.setCycle(App.cycle);
        $("#btn-cycle").classList.toggle("on", App.cycle);
        if (App.cycle) toast("循环区间：副歌 29–56 小节");
      }
    }));
    $("#btn-metro").addEventListener("click", () => {
      App.metro = !App.metro; Engine.setMetro(App.metro);
      $("#btn-metro").classList.toggle("on", App.metro);
    });
    $("#btn-countin").addEventListener("click", () => {
      App.countIn = !App.countIn; Engine.setCountIn(App.countIn);
      $("#btn-countin").classList.toggle("on", App.countIn);
    });
    $("#btn-follow").addEventListener("click", () => {
      App.follow = !App.follow;
      $("#btn-follow").classList.toggle("on", App.follow);
    });

    // 缩放
    $("#zoom").addEventListener("input", (e) => {
      App.barW = parseInt(e.target.value, 10);
      renderRuler(); renderTracks();
    });

    // 视图切换
    $$(".rail button").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.view === "export") { openExport(); return; }
      if (b.dataset.view === "ai") { $("#inspector").classList.remove("collapsed"); $$(".insp-tabs button").forEach(x => x.classList.toggle("active", x.dataset.itab === "assist")); $$(".itab").forEach(x => x.hidden = x.id !== "itab-assist"); return; }
      switchView(b.dataset.view);
    }));
    $$(".insp-tabs button").forEach(b => b.addEventListener("click", () => {
      if (b.classList.contains("insp-collapse")) return;
      $$(".insp-tabs button").forEach(x => x.classList.toggle("active", x === b));
      $$(".itab").forEach(x => x.hidden = x.id !== "itab-" + b.dataset.itab);
    }));
    $("#insp-collapse").addEventListener("click", () => $("#inspector").classList.toggle("collapsed"));

    // dock
    $$(".dock-tabs > button").forEach(b => b.addEventListener("click", () => openDock(b.dataset.dtab)));
    $("#dock-collapse").addEventListener("click", () => {
      $(".dock").classList.toggle("collapsed");
      $("#dock-collapse").textContent = $(".dock").classList.contains("collapsed") ? "▸" : "▾";
    });

    // 钢琴卷帘工具
    $("#pr-quantize").addEventListener("click", () => {
      const cur = currentRegion();
      if (!cur || cur.track.type !== "midi") return toast("先选中 MIDI 片段");
      pushUndo("量化");
      cur.region.notes.forEach(n => { n.start = Math.round(n.start * 4) / 4; n.dur = Math.max(0.25, Math.round(n.dur * 4) / 4); });
      Engine.buildEvents(App.project); renderPianoRoll(); autosave(); toast("已量化到 1/16");
    });
    $("#pr-delete").addEventListener("click", () => {
      const cur = currentRegion();
      if (!cur || App.selectedNote == null) return toast("先点选一个音符");
      pushUndo("删除音符");
      cur.region.notes.splice(App.selectedNote, 1);
      App.selectedNote = null;
      Engine.buildEvents(App.project); renderPianoRoll(); autosave();
    });

    // 步进
    $("#step-play").addEventListener("click", playStepPreview);
    $("#step-clear").addEventListener("click", () => {
      const d = drumRegion();
      if (!d) return;
      pushUndo("清空鼓机");
      const empty = [0, 0, 0, 0].map(() => new Array(16).fill(0));
      d.region.pattern = empty;
      Engine.buildEvents(App.project); renderStep(); autosave();
    });
    $("#step-kit").addEventListener("change", (e) => {
      App.project.meta.drumKit = e.target.value;
      const d = drumRegion();
      if (d) { d.region.pattern = JSON.parse(JSON.stringify(App.project.drumPattern[e.target.value])); }
      Engine.buildEvents(App.project); renderStep(); autosave();
    });

    // 轨道添加
    $("#btn-add-midi").addEventListener("click", () => addTrack("midi"));
    $("#btn-add-audio").addEventListener("click", () => addTrack("audio"));
    $("#btn-add-drum").addEventListener("click", () => addTrack("drum"));

    // 混音视图
    $("#btn-auto-mix").addEventListener("click", () => window.LiyinAI.autoMix());
    $("#btn-reset-mix").addEventListener("click", () => window.LiyinAI.resetMix());
    $("#ai-automix").addEventListener("click", () => window.LiyinAI.autoMix());

    // 撤销/重做/保存/导出
    $("#btn-undo").addEventListener("click", undo);
    $("#btn-redo").addEventListener("click", redo);
    $("#btn-export").addEventListener("click", openExport);
    $("#btn-roadmap").addEventListener("click", openRoadmap);

    // 歌词
    $("#lyrics-editor").addEventListener("input", (e) => {
      App.project.lyrics = e.target.value;
      autosave();
    });
    $("#lyr-reflow").addEventListener("click", () => {
      App.project.lyrics = reflowLyrics(App.project.lyrics);
      $("#lyrics-editor").value = App.project.lyrics;
      autosave(); toast("已重整结构标签");
    });
    $("#lyr-send-ace").addEventListener("click", () => {
      $$(".insp-tabs button").forEach(x => x.classList.toggle("active", x.dataset.itab === "assist"));
      $$(".itab").forEach(x => x.hidden = x.id !== "itab-assist");
      toast("歌词已就绪，可在智能辅助中调用模型");
    });

    // 录音视图
    $("#rec-arm").addEventListener("click", beginRecording);
    $("#rec-start").addEventListener("click", startRec);
    $("#rec-stop").addEventListener("click", stopRec);
    $("#rec-monitor").addEventListener("change", (e) => {
      Engine.state.recordMonitor = e.target.checked;
      toast(e.target.checked ? "监听已开启（使用系统回放，注意啸叫）" : "监听已关闭");
    });

    // 多 take
    if ($("#take-compile")) $("#take-compile").addEventListener("click", compileTakes);
    if ($("#take-clear")) $("#take-clear").addEventListener("click", () => {
      if (!takesStore().length) return;
      pushUndo("清空 take");
      App.takes = [];
      const el = $("#takes"); if (el) el.innerHTML = "";
      renderTakeList();
      autosave();
      toast("已清空 take 列表（已写入时间线的片段保留）");
    });

    // 和弦建议
    $("#chord-ai").addEventListener("click", () => window.LiyinAI.suggestChords());

    // 五线谱
    $$("#score-part button").forEach(b => b.addEventListener("click", () => {
      $$("#score-part button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      App.score.part = b.dataset.scorePart;
      renderScore();
    }));
    $("#score-chords").addEventListener("change", (e) => { App.score.chords = e.target.checked; renderScore(); });
    $("#score-sections").addEventListener("change", (e) => { App.score.sections = e.target.checked; renderScore(); });
    $("#score-follow").addEventListener("change", (e) => { App.score.follow = e.target.checked; renderScore(); });
    $("#score-zoom-in").addEventListener("click", () => { App.score.zoom = Math.min(2.4, App.score.zoom + 0.15); renderScore(); });
    $("#score-zoom-out").addEventListener("click", () => { App.score.zoom = Math.max(0.6, App.score.zoom - 0.15); renderScore(); });
    $("#score-png").addEventListener("click", exportScorePNG);

    // 自动化
    $("#auto-track").addEventListener("change", (e) => { App.auto.trackId = e.target.value; renderAutomation(); });
    $$("#auto-param button").forEach(b => b.addEventListener("click", () => {
      App.auto.param = b.dataset.autoParam;
      const cv = $("#auto-canvas");
      if (cv) delete cv.dataset.bound;
      renderAutomation();
    }));
    $("#auto-enabled").addEventListener("change", (e) => {
      const track = autoTrack();
      const param = App.auto.param;
      if (e.target.checked) {
        pushUndo("启用自动化");
        const pts = autoPoints(track, param);
        if (pts.length < 2) {
          const v = autoValueOf(track, param);
          const bars = App.project.meta.bars;
          track.automation[param] = [{ beat: 0, value: v }, { beat: bars * 4, value: v }];
        }
      } else {
        pushUndo("关闭自动化");
        track.automation[param] = [];
      }
      Engine.applyTrackParams(track);
      renderAutomation(); renderTracks(); autosave();
    });
    $("#auto-shape-fade").addEventListener("click", () => autoShape("fade"));
    $("#auto-shape-swell").addEventListener("click", () => autoShape("swell"));
    $("#auto-clear").addEventListener("click", clearAutomation);

    // 键盘快捷键
    window.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.key === "Enter") { Engine.stop(); updateTransportUI(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
      if (e.key.toLowerCase() === "r") switchView("record");
    });

    // 检查器 tab 内的 AI 输入同步
    $("#ai-fit").addEventListener("input", (e) => {
      App.project.ai.fit = parseInt(e.target.value, 10);
      $("#ai-fit-v").textContent = e.target.value; autosave();
    });
    $("#ai-creative").addEventListener("input", (e) => {
      App.project.ai.creative = parseInt(e.target.value, 10);
      $("#ai-creative-v").textContent = e.target.value; autosave();
    });
    $("#ai-density").addEventListener("input", (e) => {
      App.project.ai.density = parseInt(e.target.value, 10);
      $("#ai-density-v").textContent = e.target.value; autosave();
    });
    $("#ai-vocal").addEventListener("change", (e) => { App.project.ai.vocal = e.target.value; autosave(); });
    $("#ai-prompt").addEventListener("input", (e) => { App.project.ai.prompt = e.target.value; autosave(); });
    $$("#ai-styles button").forEach(b => b.addEventListener("click", () => {
      $$("#ai-styles button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      App.project.ai.style = b.dataset.style;
      autosave();
    }));
    // 会话素材 chips
    $$("[data-media]").forEach(b => b.addEventListener("click", () => addMediaToTrack(b.dataset.media)));

    // 点击编排空白区域清除选中
    $("#arrange-body").addEventListener("pointerdown", (e) => {
      if (e.target.closest(".region") || e.target.closest(".track-head")) return;
      App.selectedRegionId = null;
      App.selectedNote = null;
      $$(".region").forEach(r => r.classList.remove("selected"));
      $("#status-sel").textContent = "未选中片段";
      renderDock();
    });

    // 标尺点击定位
    $("#ruler").addEventListener("pointerdown", (e) => {
      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
      const bar = clamp(Math.floor(x / App.barW) + 1, 1, App.project.meta.bars);
      Engine.seek(bar);
      App.playBar = bar;
      updatePlayhead(bar);
    });

    // window resize
    window.addEventListener("resize", () => { renderTracks(); renderDock(); });
  }

  function addTrack(type) {
    pushUndo("新增轨道");
    const idx = App.project.tracks.length + 1;
    const base = {
      id: "track-" + Date.now(),
      volume: -8, pan: 0, mute: false, solo: false, rev: 0.15, dly: 0.03,
      regions: []
    };
    if (type === "midi") {
      base.type = "midi"; base.instrument = "piano"; base.name = "新 MIDI 轨 " + idx; base.sub = "Piano"; base.color = "#3f8f89";
      base.regions.push({ id: "r-" + base.id, startBar: 1, lengthBars: 8, notes: [] });
    } else if (type === "audio") {
      base.type = "audio"; base.name = "新音频轨 " + idx; base.sub = "Audio"; base.color = "#c98a3f";
    } else {
      base.type = "drum"; base.name = "鼓机 " + idx; base.sub = "Step Sequencer"; base.color = "#8a6a3f";
      base.regions.push({ id: "r-" + base.id, startBar: 1, lengthBars: 8, pattern: [0, 1, 2, 3].map(() => new Array(16).fill(0)) });
    }
    App.project.tracks.push(base);
    renderTracks(); renderInspectorMeta(); autosave();
    toast("已新增" + (type === "midi" ? " MIDI " : type === "audio" ? "音频" : "鼓机") + "轨");
  }

  function togglePlay() {
    Engine.state.playing ? Engine.pause() : Engine.play(App.playBar);
    updateTransportUI();
  }

  function updateTransportUI() {
    const playing = Engine.state.playing;
    $("#btn-play").classList.toggle("on", playing);
    $("#btn-play").textContent = playing ? "❚❚" : "▶";
  }

  function switchView(view) {
    App.view = view;
    $$(".rail button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $("#arrange").hidden = view !== "arrange";
    $("#mixer-view").hidden = view !== "mixer";
    $("#record-view").hidden = view !== "record";
    if (view === "mixer") renderMixer($("#mixer"), false);
    if (view === "record") { $("#record-view").hidden = false; renderTakeList(); }
  }

  function reflowLyrics(text) {
    return text.replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.hidden = false;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* ═══ 启动 ═══════════════════════════════ */
  function boot() {
    if (window.self !== window.top) document.documentElement.classList.add("embedded");
    loadProject();
    App.selectedRegionId = "r-lead";
    App.selectedTrackId = "lead";
    Engine.setProject(App.project);
    Engine.setLoopRange(29, 56);
    Engine.onTick = (pos, beat) => { tickUI(pos, beat); };
    renderRuler();
    renderTracks();
    createPlayhead();
    renderDock();
    renderInspectorMeta();
    renderMixer($("#mixer"), false);
    renderMixer($("#mixer-mini"), true);
    renderChords();
    wire();
    updateTransportUI();
    requestAnimationFrame(rAF);
    // 初始播放位置
    setTimeout(() => { updatePlayhead(1); }, 30);
    // AI 面板初始化（ai.js）
    if (window.LiyinAI && window.LiyinAI.init) window.LiyinAI.init();
    // 首次提示
    setTimeout(() => toast("已从会话导入《镜湖》· 按空格试听，或让 AI 生成新版本"), 600);
    // 自动保存
    setInterval(() => { if (App.project) localStorage.setItem(SAVE_KEY, JSON.stringify(App.project)); }, 20000);
    // 控制器 API
    window.toast = toast;
    window.saveNow = saveNow;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.LiyinApp = { refreshAll, renderTracks, renderRuler, renderDock, renderInspectorMeta, addMediaToTrack, toast, pushUndo, autosave, buildDefaultProject, downloadBlob };
})();
