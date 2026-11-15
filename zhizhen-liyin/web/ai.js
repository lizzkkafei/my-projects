/* 理音 Liyin Studio — 智能辅助
   1) 本地歌词/编曲生成器（离线可用的演示级生成）
   2) ACE-Step 1.5 本地模型客户端（经 serve.py 反向代理，或直连）
   3) 智能混音建议 / 和弦建议 */
window.LiyinAI = (function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const AI = {
    base: "http://127.0.0.1:8001",
    proxyBase: "/ace",
    connected: false,
    busy: false
  };
  window.LiyinAI = AI;

  const STYLES = {
    folk: {
      label: "氛围民谣",
      prompt: "ambient folk, chinese ballad, slow, 72 bpm, A minor, 4/4, male vocal, warm breathy, acoustic nylon guitar, soft piano, cello pad, subtle bass, wide reverb, dreamy, minimal, no drums",
      chords: {
        verse: ["Am", "F", "C", "G", "Am", "F", "G", "Am"],
        pre: ["F", "G", "Em", "Am", "F", "G", "Em", "Am"],
        chorus: ["F", "C", "G", "Am", "F", "C", "G", "Am"],
        bridge: ["Dm", "Am", "F", "Em", "Dm", "Am", "F", "Em"],
        outro: ["F", "Am", "G", "Am"],
        intro: ["Am", "F", "C", "G"]
      },
      drums: "brush", density: 0.5
    },
    postrock: {
      label: "后摇",
      prompt: "post-rock, ambient, slow build, 72 bpm, A minor, 4/4, female vocal, ethereal fragile, fingerpicked electric guitar reverb, piano, cello, soft bass, huge reverb, cinematic, crescendo at outro",
      chords: {
        verse: ["Am", "Em", "F", "C", "Am", "Em", "G", "Am"],
        pre: ["F", "G", "Am", "Em", "F", "G", "Em", "Am"],
        chorus: ["F", "C", "G", "Am", "F", "C", "Em", "Am"],
        bridge: ["Dm", "Am", "F", "Em", "Dm", "Am", "F", "G"],
        outro: ["F", "Am", "G", "Am"],
        intro: ["Am", "Em", "F", "C"]
      },
      drums: "studio", density: 0.55
    },
    electronic: {
      label: "电子",
      prompt: "ambient electronic, downtempo, 72 bpm, A minor, 4/4, female vocal breathy, warm analog pads, deep sub bass, tape saturation, soft percussion, wide reverb, dreamy, minimal",
      chords: {
        verse: ["Am", "F", "Am", "G", "Am", "F", "Em", "G"],
        pre: ["F", "G", "Am", "Em", "F", "G", "Am", "Am"],
        chorus: ["F", "G", "Am", "Em", "F", "G", "Am", "G"],
        bridge: ["Dm", "Am", "Em", "F", "Dm", "Am", "G", "G"],
        outro: ["Am", "F", "G", "Am"],
        intro: ["Am", "F", "C", "G"]
      },
      drums: "tape", density: 0.6
    },
    strings: {
      label: "弦乐四重奏",
      prompt: "string quartet, cinematic, slow, 72 bpm, A minor, 4/4, no vocals, violin, viola, cello, intimate, wide reverb, minimal, emotional",
      chords: {
        verse: ["Am", "F", "C", "G", "Am", "F", "Em", "Am"],
        pre: ["F", "G", "Em", "Am", "F", "G", "Em", "Am"],
        chorus: ["F", "C", "G", "Am", "F", "C", "Em", "Am"],
        bridge: ["Dm", "Am", "F", "Em", "Dm", "Am", "F", "Em"],
        outro: ["F", "Am", "G", "Am"],
        intro: ["Am", "F", "C", "G"]
      },
      drums: "brush", density: 0.25
    },
    chinese: {
      label: "中国风",
      prompt: "chinese folk, guzheng, dizi, soft percussion, 72 bpm, A minor, 4/4, female vocal, ethereal, wide reverb, minimal, dreamy",
      chords: {
        verse: ["Am", "F", "G", "Am", "Am", "F", "C", "G"],
        pre: ["F", "G", "Am", "Am", "F", "G", "Em", "Am"],
        chorus: ["F", "G", "Am", "Em", "F", "G", "Am", "Am"],
        bridge: ["Dm", "Am", "F", "Em", "Dm", "Am", "G", "G"],
        outro: ["Am", "F", "G", "Am"],
        intro: ["Am", "F", "C", "G"]
      },
      drums: "brush", density: 0.35
    }
  };

  /* ═══ 工具 ═══════════════════════════ */
  function log(msg, cls) {
    const el = $("#ai-log");
    if (!el) return;
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const line = document.createElement("div");
    line.className = cls || "";
    line.textContent = `[${time}] ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 80) el.removeChild(el.firstChild);
  }
  function setProgress(p) {
    const el = $("#ace-progress");
    if (el) el.style.width = Math.max(0, Math.min(100, p)) + "%";
  }
  function setAceState(state, text) {
    AI.connected = state === "ok";
    const dot = $("#ace-dot");
    if (dot) { dot.className = "dot " + state; }
    const st = $("#ace-state");
    if (st) st.textContent = text;
    const badge = $("#ai-badge");
    if (badge) badge.innerHTML = `<i></i>ACE-Step ${state === "ok" ? "在线" : state === "warn" ? "等待" : "离线"}`;
    const status = $("#status-ai");
    if (status) {
      status.textContent = "AI 服务：" + (state === "ok" ? "已连接 · ACE-Step 1.5" : "未连接");
      status.className = state === "ok" ? "ok" : "err";
    }
  }
  function apiBase() {
    // DSH 插件内嵌：工作台经 /api/liyin/ 同源托管，ACE 走插件代理
    if (location.pathname.indexOf("/api/liyin") === 0) return "/api/liyin/ace";
    if (location.protocol === "http:" || location.protocol === "https:") return AI.proxyBase;
    return AI.base;
  }

  /* ═══ 歌词生成器（本地） ═════════════════ */
  const BANKS = {
    water: ["湖", "水", "船", "雾", "岸", "浪"],
    night: ["夜", "月", "星", "灯", "钟", "窗"],
    city: ["城", "街", "站台", "灯塔", "人群", "车"],
    dream: ["梦", "镜", "影", "回声", "寂静", "黑"]
  };
  const MOOD = ["安静", "缓慢", "潮湿", "透明", "遥远", "空"];
  const VERBS = ["漂", "沉", "停在", "走进", "穿过", "等"];
  const ADJS = ["灰", "冷", "轻", "远", "旧", "静"];

  function pick(arr, seed) {
    return arr[Math.abs(seed) % arr.length];
  }
  function keywordOf(prompt) {
    if (/湖|船|水|雨|海/.test(prompt)) return BANKS.water;
    if (/夜|梦|月|黑/.test(prompt)) return BANKS.dream;
    if (/城|街|人|灯/.test(prompt)) return BANKS.city;
    return BANKS.night;
  }

  function makeVerse(seed, words) {
    const L = [];
    L.push(`${pick(ADJS, seed)}的${pick(words, seed + 1)}像一面${pick(["镜子", "旧铁皮", "雾", "钟"], seed + 2)}`);
    L.push(`我${pick(VERBS, seed + 3)}在${pick(words, seed + 4)}的${pick(["中间", "尽头", "背面", "下面"], seed + 5)}`);
    L.push(`${pick(["天", "灯", "风", "星"], seed + 6)}${pick(["阴着", "亮着", "落下来", "没有声音"], seed + 7)}`);
    L.push(`${pick(words, seed + 8)}把${pick(words, seed + 9)}照得${pick(["很轻", "很静", "很清楚", "什么都没有"], seed + 10)}`);
    return L;
  }
  function makePre(seed, words) {
    return [
      `我低头 往${pick(words, seed)}里看得很深`,
      `${pick(["看见", "没有看见", "仍看见"], seed + 1)}${pick(["一小片影子", "自己的轮廓", "水的回声"], seed + 2)}`,
      `再往下 再往下 就什么都没有了`,
      `不是${pick(words, seed + 3)} 是再没有东西可看`
    ];
  }
  function makeChorus(seed, words) {
    return [
      `黑。无尽的，黑。`,
      `未来是一整片${pick(["黑", "雾", "光"], seed)} 等我走进去`,
      `我朝它伸出手 掌心向上`,
      `落不落得下来 那是明天的事`
    ];
  }
  function makeBridge(seed, words) {
    return [
      `镜子照见天 也照见自己`,
      `镜子的背面 就是${pick(["黑", "海", "梦"], seed)}`,
      `船没有桨 我也没带桨`,
      `它究竟在漂 还是从来没有动过`
    ];
  }
  function generateLyrics(prompt, style) {
    const words = keywordOf(prompt || "");
    const seed = (prompt || "").length + (style || "folk").length;
    const v1 = makeVerse(seed, words);
    const v2 = makeVerse(seed + 13, words);
    const pre = makePre(seed + 3, words);
    const ch = makeChorus(seed + 5, words);
    const br = makeBridge(seed + 7, words);
    const outro = [
      `镜面之上 天色从未变过`,
      `镜面之下 黑从来没有散`,
      `未来若要来`,
      `总得先经过这片${pick(["黑", "雾", "夜"], seed + 9)}`
    ];
    const fmt = (lines) => lines.join("\n");
    return [
      "[前奏]",
      "",
      "[主歌一]",
      fmt(v1),
      "",
      "[主歌二]",
      fmt(v2),
      "",
      "[预副歌]",
      fmt(pre),
      "",
      "[副歌]",
      fmt(ch),
      "",
      "[桥段]",
      fmt(br),
      "",
      "[副歌]",
      fmt(ch),
      "",
      "[尾声]",
      fmt(outro)
    ].join("\n");
  }

  /* ═══ 编曲生成器（本地） ═════════════════ */
  const SCALE = [57, 59, 60, 62, 64, 65, 67]; // A natural minor
  const VOICING = {
    Am: [57, 60, 64], F: [53, 57, 60], C: [55, 60, 64], G: [55, 59, 62],
    Em: [52, 55, 59], Dm: [50, 53, 57]
  };
  const BASS = { Am: 45, F: 41, C: 48, G: 43, Em: 40, Dm: 38 };

  function buildChordsForStyle(style) {
    const cfg = STYLES[style] || STYLES.folk;
    const bars = [];
    const push = (list, n) => { for (let i = 0; i < n; i++) bars.push(list[i % list.length]); };
    push(cfg.chords.intro, 4);
    push(cfg.chords.verse, 8);
    push(cfg.chords.verse, 8);
    push(cfg.chords.pre, 8);
    push(cfg.chords.chorus, 8);
    push(cfg.chords.intro, 4);
    push(cfg.chords.verse, 8);
    push(cfg.chords.chorus, 8);
    push(cfg.chords.bridge, 8);
    push(cfg.chords.outro, 4);
    return bars;
  }

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function generateArrangement(prompt, style, opts) {
    const cfg = STYLES[style] || STYLES.folk;
    const chords = buildChordsForStyle(style);
    const density = (opts.density || 40) / 100;
    const creative = (opts.creative || 45) / 100;
    const fit = (opts.fit || 72) / 100;
    // 贴合度低时引入替代和声，贴合度高时保留原走向
    if (fit < 0.55) {
      const SUB = { F: "Dm", C: "Am", G: "Em", Am: "C", Em: "G", Dm: "F" };
      for (let i = 8; i < chords.length; i += 3) {
        if (Math.random() < (0.55 - fit)) chords[i] = SUB[chords[i]] || chords[i];
      }
    }
    const rnd = rng((prompt || "").length + style.length * 7 + 11);
    const tracks = {};
    const barsCount = chords.length;

    // 钢琴
    const piano = [];
    for (let bar = 0; bar < barsCount; bar++) {
      const v = VOICING[chords[bar]] || VOICING.Am;
      const pat = density > 0.6 ? [0, 1, 2, 1, 0, 1, 2, 1] : [0, 1, 2, 1];
      pat.forEach((idx, i) => {
        piano.push({
          pitch: v[idx] + (creative > 0.7 && rnd() > 0.82 ? 12 : 0),
          start: bar * 4 + i * (4 / pat.length),
          dur: Math.max(0.4, 4 / pat.length * 0.9),
          velocity: 50 + Math.floor(rnd() * 12)
        });
      });
    }
    // 铺底
    const pad = [];
    for (let bar = 0; bar < barsCount; bar++) {
      const v = VOICING[chords[bar]] || VOICING.Am;
      v.forEach(p => pad.push({ pitch: p, start: bar * 4, dur: 3.85, velocity: 38 + Math.floor(rnd() * 6) }));
    }
    // 贝斯
    const bass = [];
    for (let bar = 0; bar < barsCount; bar++) {
      const root = BASS[chords[bar]] || 45;
      bass.push({ pitch: root, start: bar * 4, dur: 1.9, velocity: 70 });
      if (density > 0.3) bass.push({ pitch: root + 7, start: bar * 4 + 2, dur: 1.8, velocity: 56 });
    }
    // 旋律（每段 2 小节一句）
    const lead = [];
    const sections = [
      { startBar: 5, len: 8 }, { startBar: 13, len: 8 }, { startBar: 21, len: 8 },
      { startBar: 29, len: 8 }, { startBar: 41, len: 8 }, { startBar: 49, len: 8 },
      { startBar: 57, len: 8 }, { startBar: 65, len: 4 }
    ];
    sections.forEach(sec => {
      const bars = Math.max(1, Math.floor(sec.len / 2));
      for (let b = 0; b < bars; b++) {
        const base = sec.startBar - 1 + b * 2;
        // 每两小节一条旋律：前密后疏
        const rhythm = [0, 1, 1.5, 2, 3, 4, 5, 5.5, 6];
        const n = 6 + Math.floor(density * 4);
        let prev = 3;
        for (let i = 0; i < n; i++) {
          const step = Math.floor(rnd() * 4);
          prev = Math.max(0, Math.min(SCALE.length - 1, prev + step - 1));
          const startBeat = rhythm[i % rhythm.length];
          lead.push({
            pitch: SCALE[prev] + (rnd() > 0.85 ? 12 : 0),
            start: base * 4 + startBeat,
            dur: 0.5 + Math.round(rnd() * 2) * 0.5,
            velocity: 72
          });
        }
      }
    });
    // 鼓
    const kit = cfg.drums;
    const base = window.LIYIN.drumPattern[kit] || window.LIYIN.drumPattern.studio;
    const pattern = JSON.parse(JSON.stringify(base));
    if (density < 0.35) { pattern[2] = pattern[2].map((v, i) => (i % 2 === 0 ? v : 0)); }

    return {
      chords,
      tracks: {
        piano: { notes: piano },
        pad: { notes: pad },
        bass: { notes: bass },
        lead: { notes: lead },
        drums: { pattern, startBar: 29, lengthBars: 28, kit }
      },
      meta: { style, density: opts.density, creative: opts.creative, fit: opts.fit }
    };
  }

  function applyArrangement(arr) {
    const App = window.App;
    const L = window.LiyinApp;
    L.pushUndo("AI 生成编曲");
    App.project.chords = arr.chords;
    App.project.meta.drumKit = arr.tracks.drums.kit || App.project.meta.drumKit;
    const find = (id) => App.project.tracks.find(t => t.id === id);
    const piano = find("piano"), pad = find("pad"), bass = find("bass"), lead = find("lead"), drums = find("drums");
    if (piano) piano.regions = [{ id: "r-piano", startBar: 1, lengthBars: arr.chords.length, notes: arr.tracks.piano.notes }];
    if (pad) pad.regions = [{ id: "r-pad", startBar: 1, lengthBars: arr.chords.length, notes: arr.tracks.pad.notes }];
    if (bass) bass.regions = [{ id: "r-bass", startBar: 1, lengthBars: arr.chords.length, notes: arr.tracks.bass.notes }];
    if (lead) lead.regions = [{ id: "r-lead", startBar: 1, lengthBars: arr.chords.length, notes: arr.tracks.lead.notes }];
    if (drums) drums.regions = [{ id: "r-drums", startBar: arr.tracks.drums.startBar, lengthBars: arr.tracks.drums.lengthBars, pattern: arr.tracks.drums.pattern }];
    Engine.setProject(App.project);
    L.renderRuler(); L.renderTracks(); L.renderDock(); L.renderInspectorMeta();
    L.autosave();
    log(`已写入编曲 · ${STYLES[arr.meta.style] ? STYLES[arr.meta.style].label : arr.meta.style} · ${arr.chords.length} 小节`, "ok");
  }

  /* ═══ ACE-Step 客户端 ═══════════════════ */
  async function fetchJSON(url, opts, timeout) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout || 15000);
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal }, opts));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function testConnection() {
    const base = apiBase();
    const ep = $("#ace-endpoint") ? $("#ace-endpoint").value.trim() : AI.base;
    if (ep) AI.base = ep;
    setAceState("warn", "检测中…");
    try {
      const data = await fetchJSON(base + "/health", {}, 4000);
      const d = data.data || {};
      const ok = d.status === "ok";
      setAceState(ok ? "ok" : "err", ok ? `已连接 · ${d.loaded_model || "ACE-Step"}` : "响应异常");
      if (ok) {
        const lm = d.loaded_lm_model ? " · LM " + d.loaded_lm_model : "";
        log(`连接成功：${d.service || "ACE-Step"} ${d.version || ""}${lm}`, "ok");
        $("#model-state").textContent = d.models_initialized ? "已加载" : "未加载（首次请求时加载）";
      }
      return ok;
    } catch (e) {
      setAceState("err", "未连接");
      log("连接失败：" + e.message + "（可先启动本地服务，或改用直连地址）", "err");
      return false;
    }
  }

  function stylePrompt() {
    const style = (window.App && App.project.ai && App.project.ai.style) || "folk";
    const extra = window.App ? App.project.ai : {};
    const vocal = extra.vocal === "instrumental" ? "no vocals" : (extra.vocal === "female" ? "female vocal" : "male vocal");
    const cfg = STYLES[style] || STYLES.folk;
    return cfg.prompt.replace(/male vocal|female vocal|no vocals/, vocal) +
      `, duration ${Math.round((window.App ? App.project.meta.bars * 4 * 60 / App.project.meta.bpm : 230))} seconds`;
  }

  async function generateWithModel() {
    if (AI.busy) return;
    const App = window.App;
    const L = window.LiyinApp;
    AI.busy = true;
    setProgress(3);
    log("提交生成任务：ACE-Step 会先由语言模型生成音频语义码，再扩散成歌。", "");
    setAceState("warn", "生成中");
    const base = apiBase();
    const duration = Math.round(App.project.meta.bars * 4 * 60 / App.project.meta.bpm);
    const payload = {
      prompt: stylePrompt(),
      lyrics: App.project.lyrics,
      vocal_language: "zh",
      bpm: App.project.meta.bpm,
      key_scale: "A minor",
      time_signature: "4",
      audio_duration: duration,
      thinking: true,
      inference_steps: 8,
      batch_size: 1,
      model: "acestep-v15-turbo",
      use_cot_caption: false,
      audio_format: "wav"
    };
    try {
      const submit = await fetchJSON(base + "/release_task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }, 30000);
      const taskId = submit.data && submit.data.task_id;
      if (!taskId) throw new Error("未返回 task_id");
      log("任务已排队：" + taskId.slice(0, 8) + "…（预计 3–5 分钟，期间可继续编辑）", "");
      setProgress(8);
      let done = null, tries = 0;
      while (tries < 240) {
        await new Promise(r => setTimeout(r, 6000));
        tries++;
        setProgress(Math.min(92, 8 + tries * 2.2));
        try {
          const q = await fetchJSON(base + "/query_result", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id_list: [taskId] })
          }, 20000);
          const item = (q.data || [])[0];
          if (!item) continue;
          if (item.status === 1) { done = JSON.parse(item.result)[0]; break; }
          if (item.status === 2) throw new Error("模型生成失败（可重试或缩短时长）");
          if (item.progress_text) log("进度：" + String(item.progress_text).slice(0, 80), "");
        } catch (e) {
          if (e.message.indexOf("失败") >= 0) throw e;
        }
      }
      if (!done) throw new Error("生成超时");
      setProgress(94);
      log("生成完成，正在取回音频…", "ok");
      const fileUrl = done.file || "";
      const raw = fileUrl.split("path=", 1)[1] || "";
      const src = base + "/v1/audio?path=" + raw;
      const res = await fetch(src);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const mediaId = "ai-" + Date.now();
      App.project.media.push({
        id: mediaId, name: "AI 生成 · " + (STYLES[App.project.ai.style] || STYLES.folk).label,
        file: objectUrl, duration: duration, tag: "ACE-Step", color: "#5a5a8f"
      });
      // 放入主唱轨
      const track = App.project.tracks.find(t => t.id === "vocal");
      L.pushUndo("ACE-Step 生成");
      track.regions.push({
        id: "r-" + mediaId, startBar: 1, lengthBars: Math.min(App.project.meta.bars, Math.round(duration / (240 / App.project.meta.bpm))),
        mediaId, name: "AI 生成 · " + (STYLES[App.project.ai.style] || STYLES.folk).label
      });
      try { await Engine.loadAudio(mediaId, objectUrl); } catch (e) { log("缓冲解码失败：可直接播放", "warn"); }
      Engine.buildEvents(App.project);
      L.renderTracks(); L.autosave();
      setProgress(100);
      log("已写入「主唱」轨，可对照试听。", "ok");
      setAceState("ok", "已连接");
      window.toast && window.toast("AI 生成完成：已放入主唱轨");
    } catch (e) {
      setAceState("err", "生成失败");
      log("生成失败：" + e.message, "err");
      setProgress(0);
    } finally {
      AI.busy = false;
    }
  }

  /* ═══ 混音 / 和弦建议 ═══════════════════ */
  const MIX_PRESET = {
    vocal: { volume: -3, pan: 0, rev: 0.3, dly: 0.12 },
    piano: { volume: -9, pan: -0.18, rev: 0.22, dly: 0.05 },
    pad: { volume: -15, pan: 0.2, rev: 0.4, dly: 0.08 },
    bass: { volume: -7, pan: 0, rev: 0.05, dly: 0 },
    lead: { volume: -8, pan: 0.08, rev: 0.25, dly: 0.14 },
    drums: { volume: -7, pan: 0, rev: 0.12, dly: 0 }
  };

  function autoMix() {
    const App = window.App, L = window.LiyinApp;
    L.pushUndo("智能混音");
    const anySolo = App.project.tracks.some(t => t.solo);
    if (anySolo) App.project.tracks.forEach(t => { t.solo = false; });
    App.project.tracks.forEach(t => {
      const p = MIX_PRESET[t.id] || { volume: -10, pan: 0, rev: 0.15, dly: 0.05 };
      t.volume = p.volume; t.pan = p.pan; t.rev = p.rev; t.dly = p.dly;
      Engine.applyTrackParams(t);
    });
    L.renderTracks(); L.renderDock();
    if ($("#mixer-view") && !$("#mixer-view").hidden) L.renderDock();
    L.autosave();
    log("混音建议：按乐器角色分配增益/声像/发送，人声 −3 dB 为焦点，铺底退到 −15 dB。", "ok");
    window.toast && window.toast("已应用智能混音建议");
  }

  function resetMix() {
    const App = window.App, L = window.LiyinApp;
    L.pushUndo("重置推子");
    const defaults = { vocal: -6, piano: -8, pad: -12, bass: -9, lead: -7, drums: -8 };
    App.project.tracks.forEach(t => {
      t.volume = defaults[t.id] !== undefined ? defaults[t.id] : -8;
      t.pan = 0; t.rev = 0.15; t.dly = 0.05;
      Engine.applyTrackParams(t);
    });
    L.renderTracks(); L.renderDock(); L.autosave();
    window.toast && window.toast("推子已重置");
  }

  function suggestChords() {
    const App = window.App;
    const pools = [
      ["F", "C", "G", "Am", "F", "C", "Em", "Am"],
      ["F", "G", "Em", "Am", "F", "G", "Am", "Am"],
      ["Dm", "Am", "F", "G", "Dm", "Am", "Em", "Am"]
    ];
    const modal = document.createElement("div");
    modal.className = "modal-mask";
    modal.innerHTML = `<div class="modal"><div class="modal-head"><h3>智能和弦建议</h3><button class="close" data-close>✕</button></div>
      <div class="modal-body"><p class="modal-sub">三种副歌走向，点击试听后会写入整个副歌段落（29–56 小节）。</p>
      ${pools.map((p, i) => `<button class="btn wide" style="margin:6px 0;text-align:left" data-prog="${i}">方案 ${i + 1}：${p.join(" → ")}</button>`).join("")}
      </div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", async (e) => {
      if (e.target === modal || e.target.dataset.close !== undefined) return modal.remove();
      const idx = e.target.dataset.prog;
      if (idx === undefined) return;
      const prog = pools[parseInt(idx, 10)];
      const App2 = window.App, L = window.LiyinApp;
      L.pushUndo("和弦建议");
      // 副歌 29-56 共 4 段、每段 8 小节 → 用该走向
      for (let rep = 0; rep < 4; rep++) {
        for (let i = 0; i < 8; i++) App2.project.chords[28 + rep * 8 + i] = prog[i];
      }
      // 重新生成钢琴/贝斯/铺底基于新和弦
      const VO = { Am: [57, 60, 64], F: [53, 57, 60], C: [55, 60, 64], G: [55, 59, 62], Em: [52, 55, 59], Dm: [50, 53, 57] };
      const B = { Am: 45, F: 41, C: 48, G: 43, Em: 40, Dm: 38 };
      const rebuild = (track, fn) => {
        if (!track || !track.regions[0]) return;
        const notes = [];
        App2.project.chords.forEach((c, bar) => fn(notes, c, bar));
        track.regions[0].notes = notes;
      };
      rebuild(App2.project.tracks.find(t => t.id === "piano"), (notes, c, bar) => {
        const v = VO[c] || VO.Am;
        [0, 1, 2, 1, 0, 1, 2, 1].forEach((idx, i) => notes.push({ pitch: v[idx], start: bar * 4 + i * 0.5, dur: 0.55, velocity: 52 }));
      });
      rebuild(App2.project.tracks.find(t => t.id === "bass"), (notes, c, bar) => {
        const r = B[c] || 45;
        notes.push({ pitch: r, start: bar * 4, dur: 1.9, velocity: 72 });
        notes.push({ pitch: r + 7, start: bar * 4 + 2, dur: 1.8, velocity: 58 });
      });
      rebuild(App2.project.tracks.find(t => t.id === "pad"), (notes, c, bar) => {
        (VO[c] || VO.Am).forEach(p => notes.push({ pitch: p, start: bar * 4, dur: 3.8, velocity: 40 }));
      });
      Engine.setProject(App2.project);
      L.renderRuler(); L.renderTracks(); L.renderChords && L.renderChords(); L.renderDock(); L.autosave();
      log("和弦已更新：副歌段落改用 " + prog.join(" → "), "ok");
      window.toast && window.toast("已应用和弦建议");
      modal.remove();
    });
  }

  /* ═══ UI 绑定 ════════════════════════════ */
  function init() {
    if ($("#ai-lyrics")) $("#ai-lyrics").addEventListener("click", () => {
      const App = window.App, L = window.LiyinApp;
      const prompt = $("#ai-prompt").value.trim();
      const style = App.project.ai.style || "folk";
      const text = generateLyrics(prompt, style);
      L.pushUndo("AI 生成歌词");
      App.project.lyrics = text;
      $("#lyrics-editor").value = text;
      $$(".insp-tabs button").forEach(x => x.classList.toggle("active", x.dataset.itab === "lyrics"));
      $$(".itab").forEach(x => x.hidden = x.id !== "itab-lyrics");
      L.autosave();
      log("歌词已生成（本地演算器）：" + (prompt ? "依据你的主题「" + prompt.slice(0, 16) + "…」" : "依据默认梦境意象") + "，可继续用模型生成整首。", "ok");
      window.toast && window.toast("已生成歌词，可在「歌词 / 结构」查看");
    });

    if ($("#ai-arrange")) $("#ai-arrange").addEventListener("click", () => {
      const App = window.App;
      const prompt = $("#ai-prompt").value.trim();
      const style = App.project.ai.style || "folk";
      const arr = generateArrangement(prompt, style, {
        density: parseInt($("#ai-density").value, 10),
        creative: parseInt($("#ai-creative").value, 10),
        fit: parseInt($("#ai-fit").value, 10)
      });
      log(`编曲生成：${STYLES[style].label} · 贴合 ${$("#ai-fit").value} · 密度 ${$("#ai-density").value} · 创意 ${$("#ai-creative").value}`, "");
      applyArrangement(arr);
      window.toast && window.toast("已写入新编曲，按空格试听");
    });

    if ($("#ai-apply")) $("#ai-apply").addEventListener("click", () => {
      const App = window.App;
      App.project.ai.style = App.project.ai.style || "folk";
      window.toast && window.toast("当前参数已写入工程 · 自动保存");
      window.LiyinApp.autosave();
      log("参数已写入工程。", "ok");
    });

    if ($("#ace-test")) $("#ace-test").addEventListener("click", testConnection);
    if ($("#model-test")) $("#model-test").addEventListener("click", testConnection);
    if ($("#ace-generate")) $("#ace-generate").addEventListener("click", generateWithModel);
    if ($("#ace-endpoint")) $("#ace-endpoint").addEventListener("change", (e) => {
      AI.base = e.target.value.trim() || AI.base;
      if ($("#model-endpoint")) $("#model-endpoint").value = AI.base;
    });
    if ($("#model-endpoint")) $("#model-endpoint").addEventListener("change", (e) => {
      AI.base = e.target.value.trim() || AI.base;
      if ($("#ace-endpoint")) $("#ace-endpoint").value = AI.base;
    });

    AI.base = ($("#ace-endpoint") && $("#ace-endpoint").value.trim()) || AI.base;
    // 自动检测一次
    testConnection();
  }

  return Object.assign(AI, {
    init, generateLyrics, generateArrangement, applyArrangement,
    testConnection, generateWithModel, autoMix, resetMix, suggestChords,
    STYLES, log
  });
})();
