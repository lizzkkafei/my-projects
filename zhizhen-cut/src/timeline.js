/**
 * 切线 Cutline — 磁吸时间线（React 组件）
 *
 * 设计约束（见 CONTRACTS.md · timeline.js 精确 API）：
 * - 纯 props、零全局 store、零外部依赖，只 require('react') 与 require('./engine')。
 * - 默认单条主轨磁吸排列（无空隙）；专业模式增加字幕泳道与三条音频角色泳道。
 * - 所有文案走 t(key)，t 缺失或返回 key 本身时回退中文。
 * - 样式全部在 src/timeline.css，类前缀 clt-。
 *
 * 组件内部只通过 refs 读取自己的 DOM，不查询文档中的其他节点；所有全局监听、
 * requestAnimationFrame 与 canvas 像素在卸载或依赖变化时释放。
 */

'use strict';

const React = require('react');
const engine = require('./engine');

const h = React.createElement;
const memo = typeof React.memo === 'function' ? React.memo : function (component) { return component; };

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const MIN_ZOOM = 8;
const MAX_ZOOM = 260;
const DEFAULT_ZOOM = 44;
const SNAP_PX = 8;
const MIN_CLIP = 0.08;
const TAIL_PX = 120;
const CONTENT_MIN = 320;
const RULER_H = 26;
const MAIN_H = 78;
const MAIN_PRO_H = 64;
const MAIN_MAX_H = 112;
const ROLE_H = 30;
const CAP_H = 36;
const GUTTER_W = 96;

const ROLE_FALLBACK = {
  dialogue: { color: '#5b8def' },
  music: { color: '#b06cf0' },
  ambient: { color: '#46b3a5' },
};

const ROLE_KEYS = { dialogue: 'tl.dialogue', music: 'tl.music', ambient: 'tl.ambient' };

const EMPTY_PROJECT = {
  version: 1,
  fps: 30,
  assets: [],
  clips: [],
  captions: [],
  roles: {},
  proMode: false,
};

const FALLBACK_T = {
  'tl.split': '分割',
  'tl.delete': '删除',
  'tl.undo': '撤销',
  'tl.redo': '重做',
  'tl.pro': '专业模式',
  'tl.proOn': '开启专业模式',
  'tl.proOff': '关闭专业模式',
  'tl.snap': '吸附',
  'tl.skimming': '掠视',
  'tl.zoom': '缩放',
  'tl.empty': '把素材拖到这里',
  'tl.emptyHint': '点击左上角导入素材，或从素材库拖入',
  'tl.caption': '字幕',
  'tl.dialogue': '对白',
  'tl.music': '音乐',
  'tl.ambient': '环境',
  'tl.video': '视频',
  'tl.in': '入点',
  'tl.out': '出点',
  'tl.duration': '时长',
  'tl.selected': '已选中',
  'tl.addToTimeline': '加入时间线',
};

const TICK_STEPS = [
  1 / 30, 1 / 15, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
  60, 120, 300, 600, 900, 1800, 3600,
];

const rafFn = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : function (callback) { return setTimeout(callback, 16); };
const cafFn = typeof cancelAnimationFrame === 'function'
  ? cancelAnimationFrame
  : function (id) { clearTimeout(id); };

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function isNum(value) {
  return typeof value === 'number' && isFinite(value);
}

function num(value, fallback) {
  if (isNum(value)) return value;
  return isNum(fallback) ? fallback : 0;
}

function clamp(value, low, high) {
  const v = num(value, 0);
  if (v < low) return low;
  if (v > high) return high;
  return v;
}

function round3(value) {
  return Math.round(num(value, 0) * 1000) / 1000;
}

function pad2(value) {
  const text = String(Math.max(0, Math.floor(num(value, 0))));
  return text.length >= 2 ? text : '0' + text;
}

/**
 * 工具条按钮用短标签：t 文案可能带快捷键提示（如「在播放头剪开（B / ⌘B）」），
 * 可见文字取括号前的动作名，完整文案留给 title 提示。
 */
function shortLabelOf(text) {
  const full = String(text == null ? '' : text).trim();
  const cut = full.split(/[（(]/)[0].trim();
  return cut || full;
}

function makeT(translate) {
  return function t(key) {
    let value = null;
    if (typeof translate === 'function') {
      try {
        value = translate(key);
      } catch (error) {
        value = null;
      }
    }
    if (typeof value === 'string' && value && value !== key) return value;
    if (Object.prototype.hasOwnProperty.call(FALLBACK_T, key)) return FALLBACK_T[key];
    return key;
  };
}

/* ------------------------------------------------------------------ */
/* 时间格式化（engine 优先，缺失时本地兜底）                            */
/* ------------------------------------------------------------------ */

function fallbackTimecode(seconds, fps) {
  const rate = Math.max(1, Math.round(num(fps, 30)));
  const totalFrames = Math.max(0, Math.round(num(seconds, 0) * rate));
  const frames = totalFrames % rate;
  const totalSeconds = (totalFrames - frames) / rate;
  const secs = totalSeconds % 60;
  const totalMinutes = (totalSeconds - secs) / 60;
  const mins = totalMinutes % 60;
  const hours = (totalMinutes - mins) / 60;
  return pad2(hours) + ':' + pad2(mins) + ':' + pad2(secs) + ':' + pad2(frames);
}

function timecodeOf(seconds, fps) {
  try {
    if (typeof engine.formatTimecode === 'function') {
      const text = engine.formatTimecode(seconds, fps);
      if (typeof text === 'string') return text;
    }
  } catch (error) {
    /* engine 未就绪时使用本地实现 */
  }
  return fallbackTimecode(seconds, fps);
}

function fallbackClock(seconds) {
  const totalTenths = Math.max(0, Math.round(num(seconds, 0) * 10));
  const tenths = totalTenths % 10;
  const totalSeconds = (totalTenths - tenths) / 10;
  const secs = totalSeconds % 60;
  const totalMinutes = (totalSeconds - secs) / 60;
  const mins = totalMinutes % 60;
  const hours = (totalMinutes - mins) / 60;
  if (hours > 0) return hours + ':' + pad2(mins) + ':' + pad2(secs) + '.' + tenths;
  return mins + ':' + pad2(secs) + '.' + tenths;
}

function clockOf(seconds) {
  try {
    if (typeof engine.formatClock === 'function') {
      const text = engine.formatClock(seconds);
      if (typeof text === 'string') return text;
    }
  } catch (error) {
    /* engine 未就绪时使用本地实现 */
  }
  return fallbackClock(seconds);
}

/* ------------------------------------------------------------------ */
/* 角色 / 素材判定                                                     */
/* ------------------------------------------------------------------ */

function colorOf(role) {
  try {
    if (typeof engine.roleColor === 'function') {
      const color = engine.roleColor(role);
      if (typeof color === 'string' && color) return color;
    }
  } catch (error) {
    /* ignore */
  }
  const meta = ROLE_FALLBACK[role];
  return meta ? meta.color : '#9aa4b2';
}

function clipRoleOf(clip) {
  if (clip && typeof clip.role === 'string' && clip.role) return clip.role;
  return 'dialogue';
}

function assetHasAudio(asset) {
  if (!asset) return false;
  if (asset.kind === 'audio') return true;
  if (asset.hasAudio === true) return true;
  if (asset.hasAudio === false) return false;
  return Array.isArray(asset.peaks) && asset.peaks.length > 0;
}

/* ------------------------------------------------------------------ */
/* 时间线条目（engine.timeline 优先，容错兜底）                         */
/* ------------------------------------------------------------------ */

function normalizeEntries(project, raw) {
  const source = project && typeof project === 'object' ? project : EMPTY_PROJECT;
  const assets = Array.isArray(source.assets) ? source.assets : [];
  const clips = Array.isArray(source.clips) ? source.clips : [];
  const byId = Object.create(null);
  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i];
    if (asset && asset.id != null) byId[String(asset.id)] = asset;
  }
  const useRaw = Array.isArray(raw) && raw.length > 0;
  const count = useRaw ? raw.length : clips.length;
  const entries = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const item = useRaw ? raw[i] : { clip: clips[i] };
    if (!item || !item.clip) continue;
    const clip = item.clip;
    const asset = item.asset || byId[String(clip.assetId)] || null;
    const start = isNum(item.start) ? item.start : cursor;
    let duration = isNum(item.duration)
      ? item.duration
      : num(clip.out, 0) - num(clip.in, 0);
    if (!isNum(duration) || duration < 0) duration = 0;
    const end = isNum(item.end) ? item.end : start + duration;
    entries.push({
      clip: clip,
      asset: asset,
      index: entries.length,
      start: start,
      end: end,
      duration: Math.max(0, end - start),
    });
    cursor = end;
  }
  return entries;
}

function readEntries(project) {
  const source = project && typeof project === 'object' ? project : EMPTY_PROJECT;
  let raw = null;
  try {
    if (typeof engine.timeline === 'function') raw = engine.timeline(source);
  } catch (error) {
    raw = null;
  }
  return normalizeEntries(source, raw);
}

function readTotal(project, entries) {
  if (entries.length) return entries[entries.length - 1].end;
  try {
    if (typeof engine.duration === 'function') {
      const value = engine.duration(project || EMPTY_PROJECT);
      if (isNum(value) && value > 0) return value;
    }
  } catch (error) {
    /* ignore */
  }
  return 0;
}

function fallbackSnap(project, time, threshold) {
  const entries = normalizeEntries(project, null);
  const total = entries.length ? entries[entries.length - 1].end : 0;
  let best = time;
  let bestDelta = threshold;
  const candidates = [0, total];
  for (let i = 0; i < entries.length; i += 1) {
    candidates.push(entries[i].start, entries[i].end);
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const delta = Math.abs(candidates[i] - time);
    if (delta <= bestDelta) {
      bestDelta = delta;
      best = candidates[i];
    }
  }
  return best;
}

function snapTimeTo(project, time, threshold) {
  try {
    if (typeof engine.snap === 'function') {
      const value = engine.snap(project || EMPTY_PROJECT, time, threshold);
      if (isNum(value)) return value;
    }
  } catch (error) {
    /* ignore */
  }
  return fallbackSnap(project, time, threshold);
}

function boundaryX(entries, index, zoom) {
  if (!entries.length || index <= 0) return 0;
  if (index >= entries.length) return entries[entries.length - 1].end * zoom;
  return entries[index].start * zoom;
}

/* ------------------------------------------------------------------ */
/* 颜色 / 波形绘制                                                     */
/* ------------------------------------------------------------------ */

function hexToRgba(color, alpha) {
  const text = String(color || '').trim();
  const a = clamp(num(alpha, 1), 0, 1);
  if (text.charAt(0) === '#') {
    let hex = text.slice(1);
    if (hex.length === 3) {
      hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
  }
  return 'rgba(140,146,155,' + a + ')';
}

/**
 * 在 canvas 上绘制 peaks 波形。width/height 是 CSS 像素；实际像素缓冲按 dpr 放大并封顶，
 * 超长片段会被压缩到 4096px，再由 CSS 拉伸到片段宽度，避免超出 canvas 尺寸上限。
 */
function drawWaveform(canvas, peaks, color, width, height) {
  const dpr = typeof window !== 'undefined' && isNum(window.devicePixelRatio)
    ? Math.max(1, Math.min(3, window.devicePixelRatio))
    : 1;
  const cssWidth = Math.max(1, Math.min(Math.round(num(width, 1)), 8192));
  const cssHeight = Math.max(1, Math.min(Math.round(num(height, 1)), 512));
  const pixelWidth = Math.max(1, Math.min(Math.round(cssWidth * dpr), 4096));
  const pixelHeight = Math.max(1, Math.min(Math.round(cssHeight * dpr), 512));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  const middle = pixelHeight / 2;
  const data = Array.isArray(peaks) ? peaks : null;
  ctx.fillStyle = color;
  if (!data || !data.length) {
    ctx.globalAlpha = 0.32;
    ctx.fillRect(0, Math.max(0, middle - 0.5), pixelWidth, Math.max(1, Math.round(dpr)));
    ctx.globalAlpha = 1;
    return;
  }
  // 对 peaks 做线性插值：高缩放下不会出现台阶状的“珠子”。
  const lastIndex = data.length - 1;
  const span = Math.max(1, pixelWidth - 1);
  for (let x = 0; x < pixelWidth; x += 1) {
    const position = (x / span) * lastIndex;
    const lower = Math.floor(position);
    const upper = Math.min(lastIndex, lower + 1);
    const fraction = position - lower;
    let lowValue = data[lower];
    let upValue = data[upper];
    if (!isNum(lowValue)) lowValue = 0;
    if (!isNum(upValue)) upValue = 0;
    const value = clamp(lowValue + (upValue - lowValue) * fraction, 0, 1);
    const half = Math.max(0.5, value * middle * 0.92);
    ctx.fillRect(x, middle - half, 1, half * 2);
  }
}

function computeTickStep(zoom) {
  for (let i = 0; i < TICK_STEPS.length; i += 1) {
    if (TICK_STEPS[i] * zoom >= 76) return TICK_STEPS[i];
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/* ------------------------------------------------------------------ */
/* 波形组件（memo 化，避免鼠标移动 / 悬停时重复绘制）                   */
/* ------------------------------------------------------------------ */

const Waveform = memo(function Waveform(props) {
  const canvasRef = React.useRef(null);
  const peaks = props.peaks;
  const color = props.color;
  const width = props.width;
  const height = props.height;

  React.useEffect(function () {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    try {
      drawWaveform(canvas, peaks, color, width, height);
    } catch (error) {
      /* 绘制失败不影响交互 */
    }
    return function () {
      try {
        if (canvas.width > 1) canvas.width = 1;
        if (canvas.height > 1) canvas.height = 1;
      } catch (error) {
        /* ignore */
      }
    };
  }, [peaks, color, width, height]);

  return h('canvas', {
    ref: canvasRef,
    className: 'clt-wave',
    'aria-hidden': 'true',
  });
});

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

/**
 * 磁吸时间线。全部状态来自 props；内部只保留拖拽、滚轮视窗等临时交互状态。
 * @param {object} props 见 CONTRACTS.md「timeline.js 精确 API」
 * @returns {object} React element
 */
function Timeline(props) {
  const project = props.project;
  const safeProject = project && typeof project === 'object' ? project : EMPTY_PROJECT;
  const translate = props.t;

  /* --------------------------- refs / state --------------------------- */

  const scrollRef = React.useRef(null);
  const skimRef = React.useRef(null);
  const latestRef = React.useRef({
    project: safeProject,
    entries: [],
    total: 0,
    zoom: DEFAULT_ZOOM,
    snapOn: false,
    skimOn: true,
  });
  const zoomAnchorRef = React.useRef(null);
  const skimRafRef = React.useRef(0);
  const skimPendingRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const dragListenersRef = React.useRef(null);

  const [drag, setDrag] = React.useState(null);
  const [external, setExternal] = React.useState(null);
  const [view, setView] = React.useState({ left: 0, width: 0, height: 0 });

  /* ---------------------------- derived ------------------------------ */

  const entries = React.useMemo(function () { return readEntries(safeProject); }, [safeProject]);
  const total = React.useMemo(function () { return readTotal(safeProject, entries); }, [safeProject, entries]);
  const fpsNow = Math.max(1, Math.round(num(safeProject.fps, 30)));
  const zoomNow = clamp(num(props.zoom, DEFAULT_ZOOM), MIN_ZOOM, MAX_ZOOM);
  const timeNow = clamp(num(props.time, 0), 0, Math.max(total, 0));
  const pro = props.proMode == null ? !!safeProject.proMode : !!props.proMode;
  const skimOn = props.skimming == null ? true : !!props.skimming;
  const snapOn = props.snapping == null ? false : !!props.snapping;
  const selectedId = props.selectedId == null ? null : props.selectedId;
  const tr = React.useMemo(function () { return makeT(translate); }, [translate]);

  const caps = React.useMemo(function () {
    return Array.isArray(safeProject.captions) ? safeProject.captions : [];
  }, [safeProject]);
  const hasCaps = caps.length > 0;

  const captionStyleMap = React.useMemo(function () {
    const map = Object.create(null);
    const styles = Array.isArray(engine.CAPTION_STYLES) ? engine.CAPTION_STYLES : [];
    for (let i = 0; i < styles.length; i += 1) {
      const style = styles[i];
      if (style && style.id != null) map[String(style.id)] = style;
    }
    return map;
  }, []);

  const laneDefs = React.useMemo(function () {
    const defs = [];
    const showCaptions = pro || hasCaps;
    const available = Math.max(0, (view.height || 0) - RULER_H);
    let videoHeight;
    if (showCaptions) {
      defs.push({ key: 'captions', kind: 'captions', height: CAP_H, label: 'tl.caption' });
    }
    if (pro) {
      // 专业模式：主轨吃掉剩余高度，三条角色泳道固定高度。
      videoHeight = Math.max(MAIN_PRO_H, available - CAP_H - ROLE_H * 3);
    } else {
      // 默认模式只有一条主轨：保持紧凑，剩余区域留作可拖放的时间线空白。
      const maxDefault = available - (showCaptions ? CAP_H : 0);
      videoHeight = Math.max(MAIN_H, Math.min(MAIN_MAX_H, maxDefault));
    }
    defs.push({ key: 'video', kind: 'video', height: videoHeight, label: 'tl.video' });
    if (pro) {
      defs.push({ key: 'role-dialogue', kind: 'role', role: 'dialogue', height: ROLE_H, label: ROLE_KEYS.dialogue });
      defs.push({ key: 'role-music', kind: 'role', role: 'music', height: ROLE_H, label: ROLE_KEYS.music });
      defs.push({ key: 'role-ambient', kind: 'role', role: 'ambient', height: ROLE_H, label: ROLE_KEYS.ambient });
    }
    return defs;
  }, [pro, hasCaps, view.height]);

  const selectedEntry = React.useMemo(function () {
    if (selectedId == null) return null;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (entry.clip && entry.clip.id === selectedId) return entry;
    }
    return null;
  }, [entries, selectedId]);

  const contentW = Math.max(
    CONTENT_MIN,
    total * zoomNow + TAIL_PX,
    view.width || 0
  );
  const playheadX = timeNow * zoomNow;

  const ticks = React.useMemo(function () {
    const zoom = zoomNow;
    const step = computeTickStep(zoom);
    const minorStep = step / 2;
    const showMinor = minorStep * zoom >= 26;
    const startPx = Math.max(0, (view.left || 0) - 48);
    const endPx = (view.left || 0) + Math.max(view.width || 0, CONTENT_MIN) + 48;
    const firstIndex = Math.max(0, Math.floor(startPx / zoom / step) - 1);
    const lastIndex = Math.floor(endPx / zoom / step) + 1;
    const items = [];
    for (let i = firstIndex; i <= lastIndex; i += 1) {
      if (items.length > 420) break;
      const time = i * step;
      const px = time * zoom;
      if (px > endPx + step * zoom) break;
      items.push({ id: i + 'm', major: true, px: px, label: timecodeOf(time, fpsNow) });
      if (showMinor) {
        const minorTime = time + minorStep;
        const minorPx = minorTime * zoom;
        if (minorPx <= endPx) items.push({ id: i + 'n', major: false, px: minorPx });
      }
    }
    return items;
  }, [view.left, view.width, zoomNow, fpsNow]);

  /* ---------------------------- helpers ------------------------------ */

  function hideSkimLine() {
    const line = skimRef.current;
    if (line) line.style.display = 'none';
    if (skimRafRef.current) {
      cafFn(skimRafRef.current);
      skimRafRef.current = 0;
    }
    skimPendingRef.current = null;
  }

  function emitSkim(value) {
    const callback = latestRef.current.onSkim;
    if (typeof callback === 'function') callback(value);
  }

  function scheduleSkim(value) {
    skimPendingRef.current = value;
    if (skimRafRef.current) return;
    skimRafRef.current = rafFn(function () {
      skimRafRef.current = 0;
      const pending = skimPendingRef.current;
      skimPendingRef.current = null;
      if (pending == null) return;
      emitSkim(pending);
    });
  }

  function scrollElement() {
    return scrollRef.current;
  }

  function timeAtClientX(clientX) {
    const el = scrollElement();
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    const zoom = latestRef.current.zoom || DEFAULT_ZOOM;
    return clamp(x / zoom, 0, Math.max(0, latestRef.current.total));
  }

  function insertionIndexAt(clientX) {
    const list = latestRef.current.entries || [];
    const time = timeAtClientX(clientX);
    let index = 0;
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (time >= entry.start + entry.duration / 2) index = i + 1;
    }
    return index;
  }

  function indexToX(index) {
    return boundaryX(latestRef.current.entries || [], index, latestRef.current.zoom || DEFAULT_ZOOM);
  }

  function snapForSeek(time) {
    const latest = latestRef.current;
    if (!latest.snapOn) return time;
    return snapTimeTo(latest.project, time, SNAP_PX / (latest.zoom || DEFAULT_ZOOM));
  }

  function snapBoundary(excludeClipId, time) {
    const latest = latestRef.current;
    const threshold = SNAP_PX / (latest.zoom || DEFAULT_ZOOM);
    let best = time;
    let bestDelta = threshold;
    const list = latest.entries || [];
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      if (!entry.clip || entry.clip.id === excludeClipId) continue;
      const dStart = Math.abs(entry.start - time);
      if (dStart <= bestDelta) { bestDelta = dStart; best = entry.start; }
      const dEnd = Math.abs(entry.end - time);
      if (dEnd <= bestDelta) { bestDelta = dEnd; best = entry.end; }
    }
    const dZero = Math.abs(time);
    if (dZero <= bestDelta) { bestDelta = dZero; best = 0; }
    const dTotal = Math.abs(latest.total - time);
    if (dTotal <= bestDelta) best = latest.total;
    return best;
  }

  function autoScroll(clientX) {
    const el = scrollElement();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const edge = Math.min(44, Math.max(18, rect.width * 0.14));
    if (clientX < rect.left + edge) {
      el.scrollLeft -= Math.ceil((rect.left + edge - clientX) * 0.6) + 6;
    } else if (clientX > rect.right - edge) {
      el.scrollLeft += Math.ceil((clientX - (rect.right - edge)) * 0.6) + 6;
    }
  }

  function capturePointer(element, pointerId) {
    if (!element || typeof element.setPointerCapture !== 'function') return;
    try {
      element.setPointerCapture(pointerId);
    } catch (error) {
      /* 某些环境（旧浏览器 / jsdom）不支持，window 监听仍可工作 */
    }
  }

  function releasePointer(element, pointerId) {
    if (!element || typeof element.releasePointerCapture !== 'function') return;
    try {
      element.releasePointerCapture(pointerId);
    } catch (error) {
      /* ignore */
    }
  }

  function clipDisplayName(entry) {
    if (!entry) return '';
    const clip = entry.clip || {};
    if (typeof clip.label === 'string' && clip.label) return clip.label;
    if (entry.asset && entry.asset.name) return String(entry.asset.name);
    return '';
  }

  function findEntryById(list, clipId) {
    if (clipId == null) return null;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].clip && list[i].clip.id === clipId) return list[i];
    }
    return null;
  }

  /** 移除拖拽期间的全局指针监听（不会重复移除）。 */
  function detachDragListeners() {
    const cleanup = dragListenersRef.current;
    dragListenersRef.current = null;
    if (typeof cleanup === 'function') cleanup();
  }

  /** 结束当前拖拽并提交结果；cancelled 为 true 时只清理不提交。 */
  function finishDrag(event, cancelled) {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    detachDragListeners();
    releasePointer(state.captureEl, state.pointerId);
    if (!cancelled) {
      const latest = latestRef.current;
      const clientX = event && isNum(event.clientX) ? event.clientX : state.startX;
      if (state.mode === 'press') {
        const entry = findEntryById(latest.entries || [], state.clipId);
        if (entry) {
          if (typeof latest.onSelect === 'function') latest.onSelect(state.clipId);
          const time = clamp(latest.timeAtClientX(clientX), entry.start, entry.end);
          if (typeof latest.onSeek === 'function') latest.onSeek(latest.snapForSeek(time));
        }
      } else if (state.mode === 'reorder') {
        const insertIndex = latest.insertionIndexAt(clientX);
        let target = insertIndex;
        if (insertIndex > state.fromIndex) target = insertIndex - 1;
        if (target !== state.fromIndex && typeof latest.onMoveClip === 'function') {
          latest.onMoveClip(state.fromIndex, target);
        }
        if (typeof latest.onSelect === 'function') latest.onSelect(state.clipId);
      }
    }
    setDrag(null);
  }

  /** 拖拽指针移动：scrub 连续 seek、trim 连续 onTrimClip、press 越过阈值转 reorder。 */
  function handleDragPointerMove(event) {
    const state = dragRef.current;
    if (!state) return;
    const latest = latestRef.current;
    const clientX = isNum(event.clientX) ? event.clientX : state.startX;
    if (state.mode === 'scrub') {
      event.preventDefault();
      autoScroll(clientX);
      if (typeof latest.onSeek === 'function') latest.onSeek(latest.snapForSeek(latest.timeAtClientX(clientX)));
      return;
    }
    if (state.mode === 'trim') {
      event.preventDefault();
      autoScroll(clientX);
      const source = trimSourceTime(state, clientX);
      if (source != null && typeof latest.onTrimClip === 'function') {
        latest.onTrimClip(state.clipId, state.edge, source);
      }
      return;
    }
    if (state.mode === 'press') {
      const dx = clientX - state.startX;
      const dy = (isNum(event.clientY) ? event.clientY : state.startY) - state.startY;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      event.preventDefault();
      state.mode = 'reorder';
      state.moved = true;
      state.insertIndex = latest.insertionIndexAt(clientX);
      setDrag(Object.assign({}, state));
      return;
    }
    if (state.mode === 'reorder') {
      event.preventDefault();
      autoScroll(clientX);
      const insertIndex = latest.insertionIndexAt(clientX);
      if (insertIndex !== state.insertIndex) {
        state.insertIndex = insertIndex;
        setDrag(Object.assign({}, state));
      }
    }
  }

  /** 在 pointerdown 里同步挂上 window 监听：即使是极快的点击也不会漏掉 pointerup。 */
  function attachDragListeners() {
    detachDragListeners();
    if (typeof window === 'undefined') return;
    function onMove(event) { handleDragPointerMove(event); }
    function onUp(event) { finishDrag(event, false); }
    function onCancel(event) { finishDrag(event, true); }
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragListenersRef.current = function () {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }

  function beginDrag(state) {
    if (dragRef.current) {
      releasePointer(dragRef.current.captureEl, dragRef.current.pointerId);
      detachDragListeners();
      dragRef.current = null;
    }
    dragRef.current = state;
    capturePointer(state.captureEl, state.pointerId);
    attachDragListeners();
    setDrag(state);
  }

  function trimSourceTime(dragState, clientX) {
    const latest = latestRef.current;
    const entry = findEntryById(latest.entries || [], dragState.clipId);
    if (!entry) return null;
    const clip = entry.clip || {};
    const asset = entry.asset || {};
    const zoom = latest.zoom || DEFAULT_ZOOM;
    const delta = (clientX - dragState.startX) / zoom;
    const origIn = num(dragState.origIn, num(clip.in, 0));
    const origOut = num(dragState.origOut, num(clip.out, origIn + MIN_CLIP));
    const origStart = num(dragState.origStart, entry.start);
    const origDuration = Math.max(0, origOut - origIn);
    const assetDuration = Math.max(0, num(asset.duration, origOut));

    if (dragState.edge === 'in') {
      let boundaryTime = origStart + delta;
      if (latest.snapOn) boundaryTime = snapBoundary(dragState.clipId, boundaryTime);
      const upper = Math.max(0, Math.min(origOut - MIN_CLIP, assetDuration));
      const source = clamp(origIn + (boundaryTime - origStart), 0, upper);
      return round3(source);
    }

    let boundaryTime = origStart + origDuration + delta;
    if (latest.snapOn) boundaryTime = snapBoundary(dragState.clipId, boundaryTime);
    const lower = Math.max(0, Math.min(origIn + MIN_CLIP, assetDuration));
    const source = clamp(origOut + (boundaryTime - (origStart + origDuration)), lower, assetDuration);
    return round3(source);
  }

  /* ---------------------- 最新值（供原生监听读取） --------------------- */

  latestRef.current = {
    project: safeProject,
    entries: entries,
    total: total,
    zoom: zoomNow,
    snapOn: snapOn,
    skimOn: skimOn,
    fps: fpsNow,
    onSelect: props.onSelect,
    onSeek: props.onSeek,
    onSkim: props.onSkim,
    onZoom: props.onZoom,
    onDropAsset: props.onDropAsset,
    onMoveClip: props.onMoveClip,
    onTrimClip: props.onTrimClip,
    timeAtClientX: timeAtClientX,
    insertionIndexAt: insertionIndexAt,
    indexToX: indexToX,
    snapForSeek: snapForSeek,
    snapBoundary: snapBoundary,
  };

  /* ----------------------------- effects ----------------------------- */

  // 滚轮：Ctrl/⌘ = 以鼠标为中心缩放；Shift / 普通滚轮 = 横向滚动。
  React.useEffect(function () {
    const el = scrollRef.current;
    if (!el) return undefined;

    function handleWheel(event) {
      const latest = latestRef.current;
      const zoom = latest.zoom || DEFAULT_ZOOM;
      let deltaX = num(event.deltaX, 0);
      let deltaY = num(event.deltaY, 0);
      if (event.deltaMode === 1) { deltaX *= 16; deltaY *= 16; } else if (event.deltaMode === 2) { deltaX *= 100; deltaY *= 100; }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (!deltaY) return;
        const factor = Math.exp(-deltaY * 0.0022);
        let next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        next = clamp(Math.round(next * 10) / 10, MIN_ZOOM, MAX_ZOOM);
        if (Math.abs(next - zoom) < 0.05) return;
        const rect = el.getBoundingClientRect();
        const offset = event.clientX - rect.left;
        const anchorTime = (el.scrollLeft + offset) / zoom;
        zoomAnchorRef.current = { time: anchorTime, zoom: next, offset: offset };
        if (typeof latest.onZoom === 'function') latest.onZoom(next);
        return;
      }

      // Shift + 滚轮：把纵向滚动转成横向（部分浏览器/外接鼠标不会自动转换）。
      if (event.shiftKey) {
        event.preventDefault();
        el.scrollLeft += deltaY !== 0 ? deltaY + deltaX : deltaX;
        return;
      }
      if (deltaX !== 0 && Math.abs(deltaX) >= Math.abs(deltaY)) {
        // 触控板横向手势交给原生滚动，保留惯性。
        return;
      }
      if (deltaY !== 0) {
        event.preventDefault();
        el.scrollLeft += deltaY + deltaX;
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false });
    return function () {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // 视窗测量：标尺只渲染可见区间的刻度。
  React.useEffect(function () {
    const el = scrollRef.current;
    if (!el) return undefined;
    let raf = 0;

    function measure() {
      raf = 0;
      if (!el) return;
      const next = { left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight };
      setView(function (prev) {
        if (prev.left === next.left && prev.width === next.width && prev.height === next.height) return prev;
        return next;
      });
    }

    function schedule() {
      if (!raf) raf = rafFn(measure);
    }

    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    let observer = null;
    if (typeof ResizeObserver === 'function') {
      try {
        observer = new ResizeObserver(schedule);
        observer.observe(el);
      } catch (error) {
        observer = null;
      }
    }
    if (!observer && typeof window !== 'undefined') {
      window.addEventListener('resize', schedule);
    }
    return function () {
      if (raf) cafFn(raf);
      el.removeEventListener('scroll', schedule);
      if (observer) {
        try { observer.disconnect(); } catch (error) { /* ignore */ }
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', schedule);
      }
    };
  }, []);

  // 缩放后把锚点时间保持在鼠标（或视图中心）原来的屏幕位置。
  React.useEffect(function () {
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    zoomAnchorRef.current = null;
    const el = scrollElement();
    if (!el) return;
    const target = Math.max(0, anchor.time * anchor.zoom - anchor.offset);
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = Math.min(target, max);
  }, [zoomNow]);

  // 卸载时清理掠视帧与拖拽监听，避免残留全局指针监听。
  React.useEffect(function () {
    return function () {
      detachDragListeners();
      dragRef.current = null;
      if (skimRafRef.current) {
        cafFn(skimRafRef.current);
        skimRafRef.current = 0;
      }
      skimPendingRef.current = null;
    };
  }, []);

  /* ---------------------------- 交互处理 ----------------------------- */

  function startScrub(event) {
    if (typeof event.button === 'number' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const latest = latestRef.current;
    hideSkimLine();
    emitSkim(null);
    const time = latest.snapForSeek(latest.timeAtClientX(event.clientX));
    if (typeof latest.onSeek === 'function') latest.onSeek(time);
    beginDrag({
      mode: 'scrub',
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      captureEl: event.currentTarget,
    });
  }

  function handleClipPointerDown(event, entry) {
    if (typeof event.button === 'number' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const latest = latestRef.current;
    const clip = entry.clip || {};
    const target = event.target;
    const handle = target && typeof target.getAttribute === 'function'
      ? target.getAttribute('data-trim')
      : null;
    const base = {
      clipId: clip.id,
      fromIndex: entry.index,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      captureEl: event.currentTarget,
      moved: false,
    };
    hideSkimLine();
    emitSkim(null);
    if (handle === 'in' || handle === 'out') {
      if (typeof latest.onSelect === 'function') latest.onSelect(clip.id);
      beginDrag(Object.assign({}, base, {
        mode: 'trim',
        edge: handle,
        origIn: num(clip.in, 0),
        origOut: num(clip.out, num(clip.in, 0) + MIN_CLIP),
        origStart: entry.start,
        origDuration: entry.duration,
      }));
      return;
    }
    beginDrag(Object.assign({}, base, { mode: 'press' }));
  }

  function handleClipDoubleClick(event, entry) {
    event.preventDefault();
    event.stopPropagation();
    const latest = latestRef.current;
    if (typeof latest.onSelect === 'function' && entry.clip) latest.onSelect(entry.clip.id);
    if (typeof latest.onSeek === 'function') latest.onSeek(entry.start);
  }

  function handleRoleBlockPointerDown(event, entry) {
    if (typeof event.button === 'number' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const latest = latestRef.current;
    hideSkimLine();
    emitSkim(null);
    if (entry.clip && typeof latest.onSelect === 'function') latest.onSelect(entry.clip.id);
    const raw = latest.timeAtClientX(event.clientX);
    if (typeof latest.onSeek === 'function') {
      latest.onSeek(clamp(raw, entry.start, entry.end));
    }
  }

  function handleCaptionPointerDown(event, caption) {
    if (typeof event.button === 'number' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const latest = latestRef.current;
    hideSkimLine();
    emitSkim(null);
    if (typeof latest.onSelect === 'function') latest.onSelect(caption.id);
    if (typeof latest.onSeek === 'function') {
      latest.onSeek(clamp(num(caption.start, 0), 0, Math.max(0, latest.total)));
    }
  }

  function handleContentPointerMove(event) {
    if (drag) return;
    const latest = latestRef.current;
    if (!latest.skimOn) return;
    const time = clamp(latest.timeAtClientX(event.clientX), 0, Math.max(0, latest.total));
    const line = skimRef.current;
    if (line) {
      line.style.display = 'block';
      line.style.transform = 'translateX(' + (time * latest.zoom) + 'px)';
    }
    scheduleSkim(time);
  }

  function handleContentPointerLeave() {
    const line = skimRef.current;
    if (line) line.style.display = 'none';
    if (skimRafRef.current) {
      cafFn(skimRafRef.current);
      skimRafRef.current = 0;
    }
    skimPendingRef.current = null;
    if (!drag) emitSkim(null);
  }

  function isAssetDrag(dataTransfer) {
    if (!dataTransfer) return false;
    let types = [];
    try {
      types = Array.prototype.slice.call(dataTransfer.types || []);
    } catch (error) {
      types = [];
    }
    return types.indexOf('application/x-cutline-asset') !== -1
      || types.indexOf('text/plain') !== -1;
  }

  function readAssetId(dataTransfer) {
    if (!dataTransfer) return null;
    const candidates = ['application/x-cutline-asset', 'text/plain', 'text/uri-list'];
    let raw = '';
    for (let i = 0; i < candidates.length; i += 1) {
      let value = '';
      try {
        value = dataTransfer.getData(candidates[i]);
      } catch (error) {
        value = '';
      }
      if (value) { raw = value; break; }
    }
    raw = String(raw || '').trim();
    if (!raw) return null;
    if (raw.charAt(0) === '{') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.assetId != null) return String(parsed.assetId);
        if (parsed && parsed.id != null) return String(parsed.id);
      } catch (error) {
        /* 不是 JSON，按纯文本 id 处理 */
      }
    }
    return raw;
  }

  function handleDragOver(event) {
    const latest = latestRef.current;
    if (!isAssetDrag(event.dataTransfer)) return;
    event.preventDefault();
    try {
      event.dataTransfer.dropEffect = 'copy';
    } catch (error) {
      /* ignore */
    }
    const index = latest.insertionIndexAt(event.clientX);
    setExternal(function (prev) {
      if (prev && prev.index === index) return prev;
      return { index: index };
    });
  }

  function handleDragLeave(event) {
    const current = event.currentTarget;
    if (current && event.relatedTarget && current.contains(event.relatedTarget)) return;
    setExternal(null);
  }

  function handleDrop(event) {
    const latest = latestRef.current;
    const assetId = readAssetId(event.dataTransfer);
    if (!assetId) {
      setExternal(null);
      return;
    }
    event.preventDefault();
    const index = latest.insertionIndexAt(event.clientX);
    setExternal(null);
    if (typeof latest.onDropAsset === 'function') latest.onDropAsset(assetId, index);
  }

  function handleZoomSlider(event) {
    const latest = latestRef.current;
    const next = clamp(num(parseFloat(event.target.value), latest.zoom), MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - latest.zoom) < 0.001) return;
    const el = scrollElement();
    const offset = el ? el.clientWidth / 2 : (view.width || 0) / 2;
    zoomAnchorRef.current = { time: timeNow, zoom: next, offset: offset };
    if (typeof latest.onZoom === 'function') latest.onZoom(next);
  }

  /* ---------------------------- 渲染工具 ----------------------------- */

  function renderToolButton(label, callback, options) {
    const opts = options || {};
    const buttonProps = {
      type: 'button',
      className: 'clt-btn' + (opts.active ? ' clt-btn-active' : '') + (opts.primary ? ' clt-btn-primary' : ''),
      title: opts.title || label,
      onClick: function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof callback === 'function') callback(event);
      },
    };
    if (opts.active !== undefined && opts.active !== null) {
      buttonProps['aria-pressed'] = opts.active ? 'true' : 'false';
    }
    if (opts.ariaLabel) buttonProps['aria-label'] = opts.ariaLabel;
    if (opts.disabled) buttonProps.disabled = true;
    return h('button', buttonProps, shortLabelOf(label));
  }

  function renderReadout(entry) {
    const clip = entry.clip || {};
    const name = clipDisplayName(entry) || '—';
    return h('div', { className: 'clt-readout' },
      h('span', { className: 'clt-readout-label' }, tr('tl.selected')),
      h('span', { className: 'clt-readout-name', title: name }, name),
      h('span', { className: 'clt-readout-item' },
        h('span', { className: 'clt-readout-key' }, tr('tl.in')),
        h('span', { className: 'clt-readout-val' }, timecodeOf(num(clip.in, 0), fpsNow))
      ),
      h('span', { className: 'clt-readout-item' },
        h('span', { className: 'clt-readout-key' }, tr('tl.out')),
        h('span', { className: 'clt-readout-val' }, timecodeOf(num(clip.out, 0), fpsNow))
      ),
      h('span', { className: 'clt-readout-item' },
        h('span', { className: 'clt-readout-key' }, tr('tl.duration')),
        h('span', { className: 'clt-readout-val' }, timecodeOf(entry.duration, fpsNow))
      )
    );
  }

  function renderToolbar() {
    const proTitle = pro ? tr('tl.proOff') : tr('tl.proOn');
    const hasClips = entries.length > 0;
    return h('div', { className: 'clt-toolbar', role: 'toolbar', 'aria-label': 'timeline' },
      h('div', { className: 'clt-toolbar-group' },
        renderToolButton(tr('tl.undo'), props.onUndo, { title: tr('tl.undo') }),
        renderToolButton(tr('tl.redo'), props.onRedo, { title: tr('tl.redo') }),
        h('span', { className: 'clt-divider', 'aria-hidden': 'true' }),
        renderToolButton(tr('tl.split'), props.onSplit, { title: tr('tl.split'), disabled: !hasClips }),
        renderToolButton(tr('tl.delete'), props.onDelete, { title: tr('tl.delete'), disabled: selectedId == null })
      ),
      h('div', { className: 'clt-toolbar-group' },
        h('span', { className: 'clt-divider', 'aria-hidden': 'true' }),
        renderToolButton(tr('tl.pro'), props.onTogglePro, {
          title: proTitle,
          ariaLabel: proTitle,
          active: pro,
        }),
        pro ? renderToolButton(tr('tl.skimming'), props.onToggleSkimming, { title: tr('tl.skimming'), active: skimOn }) : null,
        pro ? renderToolButton(tr('tl.snap'), props.onToggleSnapping, { title: tr('tl.snap'), active: snapOn }) : null
      ),
      pro && selectedEntry ? renderReadout(selectedEntry) : h('div', { className: 'clt-spacer' }),
      h('div', { className: 'clt-toolbar-group clt-zoom-group' },
        h('span', { className: 'clt-zoom-label' }, tr('tl.zoom')),
        h('input', {
          type: 'range',
          className: 'clt-range',
          min: MIN_ZOOM,
          max: MAX_ZOOM,
          step: 1,
          value: Math.round(zoomNow),
          onChange: handleZoomSlider,
          title: tr('tl.zoom'),
          'aria-label': tr('tl.zoom'),
        }),
        h('span', { className: 'clt-zoom-value' }, String(Math.round(zoomNow)))
      )
    );
  }

  function renderGutter() {
    return h('div', { className: 'clt-gutter', 'aria-hidden': 'true' },
      h('div', { className: 'clt-gutter-spacer', style: { height: RULER_H + 'px' } }),
      laneDefs.map(function (lane) {
        return h('div', {
          key: lane.key,
          className: 'clt-gutter-cell clt-gutter-' + lane.kind,
          style: { height: lane.height + 'px' },
        },
          lane.kind === 'role'
            ? h('span', { className: 'clt-dot', style: { background: colorOf(lane.role) } })
            : null,
          h('span', { className: 'clt-gutter-label' }, tr(lane.label))
        );
      })
    );
  }

  function renderRuler() {
    return h('div', {
      className: 'clt-ruler',
      style: { height: RULER_H + 'px' },
      onPointerDown: startScrub,
    },
      ticks.map(function (tick) {
        return h('div', {
          key: 'tick-' + tick.id,
          className: 'clt-tick' + (tick.major ? ' clt-tick-major' : ' clt-tick-minor'),
          style: { left: tick.px + 'px' },
        }, tick.major ? h('span', { className: 'clt-tick-label' }, tick.label) : null);
      }),
      h('div', { className: 'clt-ruler-edge', 'aria-hidden': 'true' })
    );
  }

  function renderClip(entry, laneHeight) {
    const clip = entry.clip || {};
    const asset = entry.asset || null;
    const width = Math.max(1, entry.duration * zoomNow);
    const blockHeight = Math.max(18, laneHeight - 6);
    const selected = selectedId != null && clip.id === selectedId;
    const role = clipRoleOf(clip);
    const color = colorOf(role);
    const name = clipDisplayName(entry);
    const hasAudio = assetHasAudio(asset);
    const isAudio = !!asset && asset.kind === 'audio';
    const thumbnail = asset && typeof asset.thumbnail === 'string' && asset.thumbnail ? asset.thumbnail : null;
    const aspect = asset && isNum(asset.width) && isNum(asset.height) && asset.height > 0
      ? asset.width / asset.height
      : 16 / 9;
    const tileWidth = Math.max(36, Math.round(blockHeight * clamp(aspect, 0.65, 2.6)));
    const waveHeight = Math.max(10, Math.round(blockHeight * 0.34));
    const dragging = !!(drag && drag.moved && drag.clipId === clip.id);
    const rangeText = clockOf(num(clip.in, 0)) + '–' + clockOf(num(clip.out, 0));
    const className = 'clt-clip'
      + (selected ? ' clt-clip-selected' : '')
      + (isAudio ? ' clt-clip-audio' : '')
      + (!thumbnail || isAudio ? ' clt-clip-noart' : '')
      + (width < 56 ? ' clt-clip-tiny' : '')
      + (dragging ? ' clt-clip-dragging' : '');

    let layer = null;
    if (thumbnail && !isAudio) {
      const safeUrl = String(thumbnail).replace(/[\r\n"\\]/g, '');
      layer = h('div', {
        className: 'clt-clip-strip',
        style: {
          backgroundImage: 'repeating-linear-gradient(90deg, rgba(4,5,7,.62) 0, rgba(4,5,7,.62) 1px, rgba(4,5,7,0) 1px, rgba(4,5,7,0) ' + tileWidth + 'px), url("' + safeUrl + '")',
          backgroundSize: tileWidth + 'px 100%, auto 100%',
          backgroundPosition: '0 0, 0 0',
          backgroundRepeat: 'repeat-x, repeat-x',
        },
      });
    } else {
      layer = h('div', {
        className: 'clt-clip-art',
        style: {
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,.04) 0, rgba(255,255,255,.04) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 8px), linear-gradient(180deg, '
            + hexToRgba(color, isAudio ? 0.24 : 0.3) + ', '
            + hexToRgba(color, isAudio ? 0.09 : 0.12) + ' 58%, rgba(9,10,13,.92))',
        },
      });
    }

    return h('div', {
      key: 'clip-' + (clip.id != null ? clip.id : entry.index),
      className: className,
      style: { left: (entry.start * zoomNow) + 'px', width: width + 'px' },
      title: (name || '') + ' · ' + rangeText,
      'data-clip-id': clip.id != null ? String(clip.id) : undefined,
      onPointerDown: function (event) { handleClipPointerDown(event, entry); },
      onDoubleClick: function (event) { handleClipDoubleClick(event, entry); },
    },
      h('div', { className: 'clt-clip-role', style: { background: color } }),
      layer,
      hasAudio
        ? h('div', {
            className: 'clt-clip-wave' + (isAudio ? ' clt-clip-wave-full' : ''),
            style: isAudio ? null : { height: waveHeight + 'px' },
          },
            h(Waveform, {
              peaks: asset ? asset.peaks : null,
              color: color,
              width: Math.max(2, width - 3),
              height: isAudio ? Math.max(10, blockHeight - 17) : waveHeight,
            })
          )
        : null,
      h('div', { className: 'clt-clip-shade' }),
      h('div', { className: 'clt-clip-head' },
        h('span', { className: 'clt-clip-name' }, name),
        width >= 150 ? h('span', { className: 'clt-clip-range' }, rangeText) : null
      ),
      width >= 18
        ? h('div', { className: 'clt-trim clt-trim-in', 'data-trim': 'in', title: tr('tl.in'), 'aria-hidden': 'true' })
        : null,
      width >= 18
        ? h('div', { className: 'clt-trim clt-trim-out', 'data-trim': 'out', title: tr('tl.out'), 'aria-hidden': 'true' })
        : null
    );
  }

  function renderRoleLane(lane) {
    const role = lane.role;
    const color = colorOf(role);
    const roleSettings = (safeProject.roles && safeProject.roles[role]) || null;
    const muted = !!(roleSettings && roleSettings.muted);
    const items = entries.filter(function (entry) {
      if (!entry.clip) return false;
      if (clipRoleOf(entry.clip) !== role) return false;
      return assetHasAudio(entry.asset);
    });
    return h('div', {
      key: lane.key,
      className: 'clt-lane clt-lane-role',
      'data-lane': role,
      style: { height: lane.height + 'px' },
      onPointerDown: startScrub,
    },
      items.map(function (entry) {
        const width = Math.max(1, entry.duration * zoomNow);
        const selected = selectedId != null && entry.clip.id === selectedId;
        const blockHeight = Math.max(12, lane.height - 8);
        return h('div', {
          key: 'role-' + (entry.clip.id != null ? entry.clip.id : entry.index),
          className: 'clt-role-block'
            + (selected ? ' clt-role-block-selected' : '')
            + (muted ? ' clt-role-block-muted' : ''),
          style: {
            left: (entry.start * zoomNow) + 'px',
            width: width + 'px',
            borderLeftColor: color,
            background: hexToRgba(color, selected ? 0.34 : 0.2),
          },
          title: clipDisplayName(entry),
          onPointerDown: function (event) { handleRoleBlockPointerDown(event, entry); },
          onDoubleClick: function (event) { handleClipDoubleClick(event, entry); },
        },
          h(Waveform, {
            peaks: entry.asset ? entry.asset.peaks : null,
            color: color,
            width: Math.max(2, width - 3),
            height: blockHeight,
          }),
          width > 90 ? h('span', { className: 'clt-role-name' }, clipDisplayName(entry)) : null
        );
      })
    );
  }

  function renderCaptionLane(lane) {
    return h('div', {
      key: lane.key,
      className: 'clt-lane clt-lane-captions',
      'data-lane': 'captions',
      style: { height: lane.height + 'px' },
      onPointerDown: startScrub,
    },
      caps.map(function (caption) {
        if (!caption) return null;
        const start = num(caption.start, 0);
        const duration = Math.max(0, num(caption.duration, 0));
        const width = Math.max(2, duration * zoomNow);
        const selected = selectedId != null && caption.id === selectedId;
        const styleInfo = caption.id != null && caption.styleId != null
          ? captionStyleMap[String(caption.styleId)]
          : null;
        return h('div', {
          key: 'caption-' + (caption.id != null ? caption.id : start),
          className: 'clt-caption' + (selected ? ' clt-caption-selected' : ''),
          style: {
            left: (start * zoomNow) + 'px',
            width: width + 'px',
            borderLeftColor: styleInfo && styleInfo.color ? styleInfo.color : 'rgba(255,255,255,.35)',
          },
          title: caption.text || '',
          'data-caption-id': caption.id != null ? String(caption.id) : undefined,
          onPointerDown: function (event) { handleCaptionPointerDown(event, caption); },
        },
          h('span', { className: 'clt-caption-text' }, caption.text || ''),
          width > 70 ? h('span', { className: 'clt-caption-meta' }, clockOf(duration)) : null
        );
      })
    );
  }

  function renderLane(lane) {
    if (lane.kind === 'captions') return renderCaptionLane(lane);
    if (lane.kind === 'role') return renderRoleLane(lane);
    return h('div', {
      key: lane.key,
      className: 'clt-lane clt-lane-video',
      'data-lane': 'video',
      style: { height: lane.height + 'px' },
      onPointerDown: startScrub,
    }, entries.map(function (entry) { return renderClip(entry, lane.height); }));
  }

  function renderEmptyState() {
    const icon = h('svg', {
      className: 'clt-empty-icon',
      width: 40,
      height: 30,
      viewBox: '0 0 40 30',
      'aria-hidden': 'true',
    },
      h('rect', { x: 2, y: 4, width: 36, height: 22, rx: 3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
      h('rect', { x: 7, y: 0.6, width: 4, height: 3, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 18, y: 0.6, width: 4, height: 3, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 29, y: 0.6, width: 4, height: 3, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 7, y: 26.4, width: 4, height: 3, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 18, y: 26.4, width: 4, height: 3, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 29, y: 26.4, width: 4, height: 3, rx: 1, fill: 'currentColor' }),
      h('path', { d: 'M17 11.4 25 15l-8 3.6z', fill: 'currentColor' })
    );
    return h('div', {
      className: 'clt-empty' + (external ? ' clt-empty-drop' : ''),
      style: { top: RULER_H + 'px' },
    },
      icon,
      h('div', { className: 'clt-empty-title' }, tr('tl.empty')),
      h('div', { className: 'clt-empty-hint' }, tr('tl.emptyHint'))
    );
  }

  function renderInsertIndicator() {
    let index = null;
    let drop = false;
    if (drag && drag.mode === 'reorder' && drag.insertIndex != null) {
      index = drag.insertIndex;
    } else if (external && external.index != null) {
      index = external.index;
      drop = true;
    }
    if (index == null) return null;
    const x = indexToX(index);
    return h('div', {
      className: 'clt-insert' + (drop ? ' clt-insert-drop' : ''),
      style: { transform: 'translateX(' + x + 'px)' },
      'aria-hidden': 'true',
    }, drop ? h('span', { className: 'clt-insert-chip' }, tr('tl.addToTimeline')) : null);
  }

  function renderContent() {
    const rows = laneDefs.map(renderLane);
    return h('div', {
      className: 'clt-content',
      style: { width: Math.max(1, Math.round(contentW)) + 'px' },
      onPointerDown: startScrub,
    },
      renderRuler(),
      rows,
      h('div', {
        className: 'clt-playhead',
        style: { transform: 'translateX(' + playheadX + 'px)' },
      },
        h('div', {
          className: 'clt-playhead-head',
          onPointerDown: startScrub,
          title: timecodeOf(timeNow, fpsNow),
        })
      ),
      h('div', { ref: skimRef, className: 'clt-skim', 'aria-hidden': 'true' }),
      renderInsertIndicator(),
      entries.length === 0 ? renderEmptyState() : null
    );
  }

  /* ------------------------------ 渲染 ------------------------------- */

  const rootClassName = 'clt-root'
    + (pro ? ' clt-pro' : '')
    + (drag && drag.mode === 'trim' ? ' clt-is-trim' : '')
    + (drag && drag.mode !== 'trim' ? ' clt-is-drag' : '');

  return h('div', { className: rootClassName, 'data-pro': pro ? '1' : '0' },
    renderToolbar(),
    h('div', {
      className: 'clt-body',
      style: { gridTemplateColumns: GUTTER_W + 'px minmax(0, 1fr)' },
    },
      renderGutter(),
      h('div', {
        ref: scrollRef,
        className: 'clt-scroll',
        onPointerMove: handleContentPointerMove,
        onPointerLeave: handleContentPointerLeave,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onDrop: handleDrop,
      },
        renderContent()
      )
    )
  );
}

module.exports = { Timeline };
