'use strict';

/**
 * 切线 Cutline · 纯时间线引擎 (engine.js)
 *
 * 约束：零 DOM / 零 React / 零 Node API；所有导出函数均不可变——不修改入参，
 * 返回新的 project（或 { project, ... }）。时间单位统一为秒。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 片段最短时长（秒）：trim / split / insert 都不会产生更短的片段。 */
const MIN_CLIP = 0.08;
/** roughCut 保留段的最短时长（秒），更短的保留段直接丢弃。 */
const MIN_KEEP = 0.25;
/** 字幕句间最小间隙（秒）。 */
const SENTENCE_GAP = 0.06;
/** 自动闪避默认电平。 */
const DEFAULT_DUCK = 0.22;
/** 字幕/静音计算中的零值容差。 */
const EPS = 1e-9;

/**
 * 角色常量（中文界面名 + 品牌色 + 单字缩写）。
 * id 与 Project.roles / Clip.role 对应。
 */
const ROLES = [
  { id: 'dialogue', name: '对白', color: '#5b8def', short: '对' },
  { id: 'music', name: '音乐', color: '#b06cf0', short: '乐' },
  { id: 'ambient', name: '环境', color: '#46b3a5', short: '环' },
];

/**
 * 全局/片段滤镜预设。`css` 可直接赋给 canvas `ctx.filter`；'none' 表示不过滤。
 */
const FILTERS = [
  { id: 'none', name: '原片', css: 'none', accent: '#9aa4b2' },
  { id: 'cinema', name: '电影', css: 'contrast(1.12) saturate(0.94) brightness(0.96)', accent: '#d9a648' },
  { id: 'warm', name: '暖调', css: 'sepia(0.25) saturate(1.2) contrast(1.04)', accent: '#ff8a3d' },
  { id: 'cool', name: '冷调', css: 'saturate(1.06) hue-rotate(-8deg) contrast(1.05)', accent: '#4aa8ff' },
  { id: 'mono', name: '黑白', css: 'grayscale(1) contrast(1.15)', accent: '#c7ccd4' },
  { id: 'vivid', name: '浓彩', css: 'saturate(1.45) contrast(1.08)', accent: '#ff4d2e' },
  { id: 'fade', name: '褪色', css: 'saturate(0.72) contrast(0.9) brightness(1.06)', accent: '#c9a27e' },
  { id: 'night', name: '夜景', css: 'brightness(0.9) contrast(1.16) saturate(0.85) hue-rotate(-10deg)', accent: '#6a7bd8' },
  { id: 'vintage', name: '复古', css: 'sepia(0.45) contrast(1.05) saturate(0.9)', accent: '#b98b5e' },
];

/** 系统 UI 字体栈（字幕默认字体也复用）。 */
const UI_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';

/**
 * 字幕样式预设。size/color/bg/stroke 供 canvas 绘制字幕使用。
 * 默认样式为 CAPTION_STYLES[0]（id = 'clean'）。
 */
const CAPTION_STYLES = [
  {
    id: 'clean',
    name: '简洁',
    font: UI_FONT,
    weight: 600,
    size: 42,
    color: '#ffffff',
    bg: 'rgba(0,0,0,0.30)',
    stroke: 'rgba(0,0,0,0.85)',
  },
  {
    id: 'bold',
    name: '强调',
    font: UI_FONT,
    weight: 800,
    size: 50,
    color: '#ffffff',
    bg: 'transparent',
    stroke: '#000000',
  },
  {
    id: 'box',
    name: '底块',
    font: UI_FONT,
    weight: 600,
    size: 38,
    color: '#ffffff',
    bg: 'rgba(8,9,11,0.72)',
    stroke: 'transparent',
  },
  {
    id: 'brand',
    name: '品牌',
    font: UI_FONT,
    weight: 700,
    size: 44,
    color: '#ff4d2e',
    bg: 'transparent',
    stroke: 'rgba(0,0,0,0.9)',
  },
  {
    id: 'minimal',
    name: '极简',
    font: UI_FONT,
    weight: 500,
    size: 36,
    color: '#f4f6f8',
    bg: 'transparent',
    stroke: 'transparent',
  },
];

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

let idSequence = 0;

/**
 * 生成会话内唯一 id（前缀 + 时间戳 + 自增序号）。
 * @param {string} [prefix='id']
 * @returns {string}
 */
function newId(prefix) {
  idSequence += 1;
  const p = typeof prefix === 'string' && prefix ? prefix : 'id';
  const stamp = Date.now().toString(36);
  return p + '_' + stamp + '_' + idSequence.toString(36);
}

/** 是否为有限数字。 */
function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 取有限数字；否则返回兜底值。 */
function num(value, fallback) {
  return isNum(value) ? value : fallback;
}

/** 数值夹取到 [min, max]；非有限数字返回 fallback（默认 min）。 */
function clamp(value, min, max, fallback) {
  if (!isNum(value)) return fallback === undefined ? min : fallback;
  return Math.min(max, Math.max(min, value));
}

/** 时间值四舍五入到毫秒，消除浮点噪声。 */
function roundTime(value) {
  return Math.round(value * 1000) / 1000;
}

/** 浅拷贝 project 并覆盖若干字段（不可变更新）。 */
function assign(project, patch) {
  return Object.assign({}, project, patch);
}

/** 判断 role id 是否有效。 */
function isRoleId(roleId) {
  return ROLES.some((role) => role.id === roleId);
}

/** 判断 filter id 是否有效。 */
function isFilterId(filterId) {
  return FILTERS.some((filter) => filter.id === filterId);
}

/** 从 project.assets 中按 id 查素材；找不到返回 null。 */
function findAsset(project, assetId) {
  const assets = (project && project.assets) || [];
  for (let i = 0; i < assets.length; i += 1) {
    if (assets[i] && assets[i].id === assetId) return assets[i];
  }
  return null;
}

/** 从 project.clips 中按 id 查片段；找不到返回 null。 */
function findClip(project, clipId) {
  const clips = (project && project.clips) || [];
  for (let i = 0; i < clips.length; i += 1) {
    if (clips[i] && clips[i].id === clipId) return clips[i];
  }
  return null;
}

/** 读取角色音量/静音设置，缺省时给出安全兜底。 */
function roleSettings(project, roleId) {
  const roles = (project && project.roles) || {};
  const found = roles[roleId] || {};
  return {
    volume: clamp(num(found.volume, 1), 0, 1, 1),
    muted: found.muted === true,
  };
}

/** 把片段时长变化后的播放头夹回 [0, 总时长]。 */
function settlePlayhead(project) {
  const total = duration(project);
  const playhead = clamp(num(project && project.playhead, 0), 0, total, 0);
  if (playhead === (project && project.playhead)) return project;
  return assign(project, { playhead });
}

/** 规范化素材对象：补齐缺省字段、清理非法数值，不修改入参。 */
function normalizeAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const duration = Math.max(0, num(asset.duration, 0));
  const peaks =
    Array.isArray(asset.peaks) && asset.peaks.length > 0
      ? asset.peaks.map((peak) => clamp(num(peak, 0), 0, 1, 0))
      : null;
  return {
    id: typeof asset.id === 'string' && asset.id ? asset.id : newId('asset'),
    name: typeof asset.name === 'string' && asset.name ? asset.name : '未命名素材',
    kind: asset.kind === 'audio' ? 'audio' : 'video',
    duration,
    width: Math.max(0, Math.round(num(asset.width, 0))),
    height: Math.max(0, Math.round(num(asset.height, 0))),
    url: typeof asset.url === 'string' ? asset.url : '',
    thumbnail: typeof asset.thumbnail === 'string' ? asset.thumbnail : null,
    peaks,
    fileSize: Math.max(0, num(asset.fileSize, 0)),
    mime: typeof asset.mime === 'string' ? asset.mime : '',
    hasAudio: asset.hasAudio !== false,
  };
}

/** 依据素材推断默认角色：音频素材→音乐，视频素材→对白。 */
function inferRole(asset) {
  if (!asset) return 'dialogue';
  return asset.kind === 'audio' ? 'music' : 'dialogue';
}

/** 更新单个片段字段并返回新 project；片段不存在时原样返回。 */
function updateClip(project, clipId, patch) {
  const clips = (project && project.clips) || [];
  const index = clips.findIndex((clip) => clip && clip.id === clipId);
  if (index < 0) return project;
  const nextClip = assign(clips[index], patch);
  const nextClips = clips.slice();
  nextClips[index] = nextClip;
  return settlePlayhead(assign(project, { clips: nextClips }));
}

/** 把拆句后的文本按换行与中英文句末标点切分成句子数组（含标点）。 */
function splitSentences(text) {
  const source = String(text === null || text === undefined ? '' : text).replace(/\r\n?/g, '\n');
  const sentences = [];
  // 句末标点：中文。！？；… 与英文 . ! ? ; ——标点后的收尾引号/括号跟随本句。
  const sentenceRe = /[^。！？!?；;.…]+(?:[。！？!?；;.…]+[”’"'』」）)\]]*)?/g;
  source.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    sentenceRe.lastIndex = 0;
    let match = sentenceRe.exec(trimmed);
    while (match) {
      const sentence = match[0].trim();
      if (sentence) sentences.push(sentence);
      if (match.index === sentenceRe.lastIndex) sentenceRe.lastIndex += 1;
      match = sentenceRe.exec(trimmed);
    }
  });
  return sentences;
}

/** 合并源素材内绝对秒的重叠/相邻区间，输出升序数组。 */
function mergeRanges(ranges) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .filter((range) => range && isNum(range.start) && isNum(range.end) && range.end > range.start)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  sorted.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + EPS) {
      if (range.end > last.end) last.end = range.end;
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  });
  return merged;
}

// ---------------------------------------------------------------------------
// 项目 / 素材
// ---------------------------------------------------------------------------

/**
 * 创建新项目；overrides 浅覆盖顶层字段，roles/ducking 支持部分覆盖。
 * @param {object} [overrides]
 * @returns {object} Project
 */
function createProject(overrides) {
  const base = {
    version: 1,
    name: '未命名项目',
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    clips: [],
    captions: [],
    music: null,
    roles: {
      dialogue: { volume: 1, muted: false },
      music: { volume: 0.8, muted: false },
      ambient: { volume: 0.7, muted: false },
    },
    ducking: { enabled: true, level: DEFAULT_DUCK },
    filter: 'none',
    proMode: false,
    playhead: 0,
    inPoint: null,
    outPoint: null,
  };
  if (!overrides || typeof overrides !== 'object') return base;

  const next = assign(base, overrides);
  next.assets = Array.isArray(overrides.assets) ? overrides.assets.slice() : [];
  next.clips = Array.isArray(overrides.clips) ? overrides.clips.slice() : [];
  next.captions = Array.isArray(overrides.captions) ? overrides.captions.slice() : [];
  next.music = overrides.music
    ? {
        assetId: overrides.music.assetId,
        volume: clamp(num(overrides.music.volume, 0.8), 0, 1, 0.8),
      }
    : null;
  next.roles = {
    dialogue: assign(base.roles.dialogue, overrides.roles && overrides.roles.dialogue),
    music: assign(base.roles.music, overrides.roles && overrides.roles.music),
    ambient: assign(base.roles.ambient, overrides.roles && overrides.roles.ambient),
  };
  next.ducking = assign(base.ducking, overrides.ducking);
  next.playhead = Math.max(0, num(overrides.playhead, 0));
  next.inPoint = isNum(overrides.inPoint) ? overrides.inPoint : null;
  next.outPoint = isNum(overrides.outPoint) ? overrides.outPoint : null;
  return next;
}

/**
 * 追加素材；若同 id 已存在则原位替换。
 * @param {object} project
 * @param {object} asset
 * @returns {object} Project
 */
function addAsset(project, asset) {
  const normalized = normalizeAsset(asset);
  if (!normalized) return project;
  const assets = Array.isArray(project && project.assets) ? project.assets.slice() : [];
  const index = assets.findIndex((item) => item && item.id === normalized.id);
  if (index >= 0) assets[index] = normalized;
  else assets.push(normalized);
  return assign(project, { assets });
}

/**
 * 移除素材，同时移除引用它的片段与音乐垫；时间线自动磁吸合拢。
 * @param {object} project
 * @param {string} assetId
 * @returns {object} Project
 */
function removeAsset(project, assetId) {
  const assets = Array.isArray(project && project.assets) ? project.assets : [];
  if (!assets.some((asset) => asset && asset.id === assetId)) return project;
  const nextAssets = assets.filter((asset) => asset && asset.id !== assetId);
  const clips = Array.isArray(project.clips) ? project.clips : [];
  const nextClips = clips.filter((clip) => clip && clip.assetId !== assetId);
  const music = project.music && project.music.assetId === assetId ? null : project.music;
  return settlePlayhead(assign(project, { assets: nextAssets, clips: nextClips, music }));
}

// ---------------------------------------------------------------------------
// 片段操作（磁吸：clips 数组顺序即时间线顺序）
// ---------------------------------------------------------------------------

/**
 * 在指定索引插入片段；options.in/out 为素材内绝对秒，缺省取整段。
 * 素材不存在或过短时返回 { project, clipId: null }。
 * @param {object} project
 * @param {string} assetId
 * @param {number} index 插入位置，越界自动夹取；undefined 追加到末尾
 * @param {{role?:string,in?:number,out?:number,volume?:number,filter?:string,label?:string}} [options]
 * @returns {{project: object, clipId: string|null}}
 */
function insertClip(project, assetId, index, options) {
  const opts = options || {};
  const clips = Array.isArray(project && project.clips) ? project.clips : [];
  const asset = findAsset(project, assetId);
  if (!asset || !(num(asset.duration, 0) > 0)) return { project, clipId: null };

  const sourceDuration = asset.duration;
  let inPoint = clamp(num(opts.in, 0), 0, sourceDuration, 0);
  let outPoint = clamp(num(opts.out, sourceDuration), 0, sourceDuration, sourceDuration);
  if (outPoint < inPoint) outPoint = inPoint;

  // 保证至少 MIN_CLIP：先尝试延展 out，素材尾部不允许时再反推 in。
  if (outPoint - inPoint < MIN_CLIP) {
    const extendedOut = Math.min(sourceDuration, inPoint + MIN_CLIP);
    if (extendedOut - inPoint >= MIN_CLIP) {
      outPoint = extendedOut;
    } else {
      const shiftedIn = Math.max(0, outPoint - MIN_CLIP);
      if (outPoint - shiftedIn >= MIN_CLIP) inPoint = shiftedIn;
    }
  }
  if (outPoint - inPoint < MIN_CLIP) return { project, clipId: null };

  const clip = {
    id: newId('clip'),
    assetId: asset.id,
    in: roundTime(inPoint),
    out: roundTime(outPoint),
    role: isRoleId(opts.role) ? opts.role : inferRole(asset),
    volume: clamp(num(opts.volume, 1), 0, 1, 1),
    filter: isFilterId(opts.filter) ? opts.filter : 'none',
    label:
      typeof opts.label === 'string' && opts.label
        ? opts.label
        : typeof asset.name === 'string'
          ? asset.name
          : '',
  };

  const rawIndex = num(index, clips.length);
  const at = Math.min(clips.length, Math.max(0, Math.round(rawIndex)));
  const nextClips = clips.slice();
  nextClips.splice(at, 0, clip);
  return { project: settlePlayhead(assign(project, { clips: nextClips })), clipId: clip.id };
}

/**
 * 把素材追加到时间线末尾。
 * @param {object} project
 * @param {string} assetId
 * @param {object} [options]
 * @returns {{project: object, clipId: string|null}}
 */
function appendClip(project, assetId, options) {
  const clips = (project && project.clips) || [];
  return insertClip(project, assetId, clips.length, options);
}

/**
 * 移动片段；toIndex 为移除后插入位置，越界自动夹取。
 * @param {object} project
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {object} Project
 */
function moveClip(project, fromIndex, toIndex) {
  const clips = Array.isArray(project && project.clips) ? project.clips : [];
  const length = clips.length;
  if (length === 0 || !isNum(fromIndex) || !isNum(toIndex)) return project;
  const from = Math.min(length - 1, Math.max(0, Math.trunc(fromIndex)));
  const to = Math.min(length - 1, Math.max(0, Math.trunc(toIndex)));
  if (from === to) return project;
  const nextClips = clips.slice();
  const moved = nextClips.splice(from, 1)[0];
  nextClips.splice(to, 0, moved);
  return assign(project, { clips: nextClips });
}

/**
 * 调整片段入/出点；sourceTime 为素材内绝对秒。
 * in 夹到 [0, out-0.08]，out 夹到 [in+0.08, asset.duration]。
 * @param {object} project
 * @param {string} clipId
 * @param {'in'|'out'} edge
 * @param {number} sourceTime
 * @returns {object} Project
 */
function trimClip(project, clipId, edge, sourceTime) {
  if (!isNum(sourceTime)) return project;
  const clip = findClip(project, clipId);
  if (!clip) return project;
  const asset = findAsset(project, clip.assetId);
  const clipIn = num(clip.in, 0);
  const clipOut = num(clip.out, clipIn + MIN_CLIP);

  if (edge === 'in') {
    const upper = Math.max(0, clipOut - MIN_CLIP);
    const nextIn = roundTime(clamp(sourceTime, 0, upper, 0));
    if (nextIn === clipIn) return project;
    return updateClip(project, clipId, { in: nextIn });
  }
  if (edge === 'out') {
    const lower = clipIn + MIN_CLIP;
    const upper = asset ? Math.max(lower, num(asset.duration, clipOut)) : Math.max(lower, clipOut);
    const nextOut = roundTime(clamp(sourceTime, lower, upper, lower));
    if (nextOut === clipOut) return project;
    return updateClip(project, clipId, { out: nextOut });
  }
  return project;
}

/**
 * 波纹删除片段，后面的片段自动前移。
 * @param {object} project
 * @param {string} clipId
 * @returns {object} Project
 */
function removeClip(project, clipId) {
  const clips = Array.isArray(project && project.clips) ? project.clips : [];
  const index = clips.findIndex((clip) => clip && clip.id === clipId);
  if (index < 0) return project;
  const nextClips = clips.slice();
  nextClips.splice(index, 1);
  return settlePlayhead(assign(project, { clips: nextClips }));
}

/**
 * 在时间线 time 处剪开片段；不在片段内（或会切出过短片段）时原样返回。
 * 返回的 clipId 是切出的右侧新片段 id。
 * @param {object} project
 * @param {number} time
 * @returns {{project: object, clipId: string|null}}
 */
function splitAt(project, time) {
  if (!isNum(time)) return { project, clipId: null };
  const entries = timeline(project);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const localTime = time - entry.start;
    if (localTime < MIN_CLIP || entry.duration - localTime < MIN_CLIP) continue;
    const sourceTime = roundTime(num(entry.clip.in, 0) + localTime);
    const left = assign(entry.clip, { out: sourceTime });
    const right = assign(entry.clip, { id: newId('clip'), in: sourceTime });
    const clips = project.clips.slice();
    clips.splice(entry.index, 1, left, right);
    return { project: assign(project, { clips }), clipId: right.id };
  }
  return { project, clipId: null };
}

/**
 * 设置片段角色（只接受 ROLES 中的 id）。
 * @param {object} project
 * @param {string} clipId
 * @param {string} role
 * @returns {object} Project
 */
function setClipRole(project, clipId, role) {
  if (!isRoleId(role)) return project;
  const clip = findClip(project, clipId);
  if (!clip || clip.role === role) return project;
  return updateClip(project, clipId, { role });
}

/**
 * 设置片段音量（夹取到 0..1）。
 * @param {object} project
 * @param {string} clipId
 * @param {number} volume
 * @returns {object} Project
 */
function setClipVolume(project, clipId, volume) {
  if (!isNum(volume)) return project;
  const clip = findClip(project, clipId);
  const nextVolume = clamp(volume, 0, 1, 1);
  if (!clip || clip.volume === nextVolume) return project;
  return updateClip(project, clipId, { volume: nextVolume });
}

/**
 * 设置片段级滤镜（只接受 FILTERS 中的 id）。
 * @param {object} project
 * @param {string} clipId
 * @param {string} filterId
 * @returns {object} Project
 */
function setClipFilter(project, clipId, filterId) {
  if (!isFilterId(filterId)) return project;
  const clip = findClip(project, clipId);
  if (!clip || clip.filter === filterId) return project;
  return updateClip(project, clipId, { filter: filterId });
}

/**
 * 设置片段显示标签。
 * @param {object} project
 * @param {string} clipId
 * @param {string} label
 * @returns {object} Project
 */
function setClipLabel(project, clipId, label) {
  const clip = findClip(project, clipId);
  if (!clip) return project;
  const nextLabel = typeof label === 'string' ? label : String(label === undefined ? '' : label);
  if (clip.label === nextLabel) return project;
  return updateClip(project, clipId, { label: nextLabel });
}

// ---------------------------------------------------------------------------
// 播放头 / 入出点 / 音乐与混音设置
// ---------------------------------------------------------------------------

/**
 * 移动播放头到 time（夹取到 [0, 总时长]）。
 * @param {object} project
 * @param {number} time
 * @returns {object} Project
 */
function seek(project, time) {
  const total = duration(project);
  const nextTime = roundTime(clamp(num(time, 0), 0, total, 0));
  if (nextTime === (project && project.playhead)) return project;
  return assign(project, { playhead: nextTime });
}

/**
 * 在播放头处设入点；若已有出点且 in >= out，则清空出点。
 * @param {object} project
 * @returns {object} Project
 */
function setInPoint(project) {
  const total = duration(project);
  const inPoint = roundTime(clamp(num(project && project.playhead, 0), 0, total, 0));
  const outPoint = project && isNum(project.outPoint) ? project.outPoint : null;
  const nextOut = outPoint !== null && inPoint >= outPoint ? null : outPoint;
  if (inPoint === project.inPoint && nextOut === project.outPoint) return project;
  return assign(project, { inPoint, outPoint: nextOut });
}

/**
 * 在播放头处设出点；若已有入点且 out <= in，则清空入点。
 * @param {object} project
 * @returns {object} Project
 */
function setOutPoint(project) {
  const total = duration(project);
  const outPoint = roundTime(clamp(num(project && project.playhead, 0), 0, total, 0));
  const inPoint = project && isNum(project.inPoint) ? project.inPoint : null;
  const nextIn = inPoint !== null && outPoint <= inPoint ? null : inPoint;
  if (outPoint === project.outPoint && nextIn === project.inPoint) return project;
  return assign(project, { inPoint: nextIn, outPoint });
}

/**
 * 清空入点/出点。
 * @param {object} project
 * @returns {object} Project
 */
function clearMarks(project) {
  if (!project || (project.inPoint === null && project.outPoint === null)) return project;
  return assign(project, { inPoint: null, outPoint: null });
}

/**
 * 设置背景音乐素材；传 null 清空。素材不存在时原样返回。
 * @param {object} project
 * @param {string|null} assetId
 * @returns {object} Project
 */
function setMusic(project, assetId) {
  if (assetId === null || assetId === undefined) {
    if (!project || !project.music) return project;
    return assign(project, { music: null });
  }
  const asset = findAsset(project, assetId);
  if (!asset) return project;
  if (project.music && project.music.assetId === assetId) return project;
  const volume = clamp(num(project.music && project.music.volume, 0.8), 0, 1, 0.8);
  return assign(project, { music: { assetId, volume } });
}

/**
 * 设置背景音乐音量（0..1）；尚未设置音乐时原样返回。
 * @param {object} project
 * @param {number} volume
 * @returns {object} Project
 */
function setMusicVolume(project, volume) {
  if (!project || !project.music || !isNum(volume)) return project;
  const nextVolume = clamp(volume, 0, 1, 0.8);
  if (nextVolume === project.music.volume) return project;
  return assign(project, {
    music: assign(project.music, { volume: nextVolume }),
  });
}

/**
 * 开关自动闪避并可选调整闪避电平（0..1）。
 * @param {object} project
 * @param {boolean} enabled
 * @param {number} [level]
 * @returns {object} Project
 */
function setDucking(project, enabled, level) {
  const previous = (project && project.ducking) || { enabled: true, level: DEFAULT_DUCK };
  const nextEnabled = enabled === true;
  const nextLevel =
    level === undefined
      ? clamp(num(previous.level, DEFAULT_DUCK), 0, 1, DEFAULT_DUCK)
      : clamp(num(level, DEFAULT_DUCK), 0, 1, DEFAULT_DUCK);
  if (previous.enabled === nextEnabled && previous.level === nextLevel) return project;
  return assign(project, { ducking: { enabled: nextEnabled, level: nextLevel } });
}

/**
 * 设置角色音量（0..1）。
 * @param {object} project
 * @param {string} role
 * @param {number} volume
 * @returns {object} Project
 */
function setRoleVolume(project, role, volume) {
  if (!isRoleId(role) || !isNum(volume) || !project) return project;
  const current = roleSettings(project, role);
  const nextVolume = clamp(volume, 0, 1, 1);
  if (current.volume === nextVolume && (project.roles || {})[role]) return project;
  const roles = assign(project.roles || {}, {
    [role]: { volume: nextVolume, muted: current.muted },
  });
  return assign(project, { roles });
}

/**
 * 切换角色静音。
 * @param {object} project
 * @param {string} role
 * @returns {object} Project
 */
function toggleRoleMute(project, role) {
  if (!isRoleId(role) || !project) return project;
  const current = roleSettings(project, role);
  const roles = assign(project.roles || {}, {
    [role]: { volume: current.volume, muted: !current.muted },
  });
  return assign(project, { roles });
}

/**
 * 设置全局风格滤镜（只接受 FILTERS 中的 id）。
 * @param {object} project
 * @param {string} filterId
 * @returns {object} Project
 */
function setFilter(project, filterId) {
  if (!project || !isFilterId(filterId) || project.filter === filterId) return project;
  return assign(project, { filter: filterId });
}

/**
 * 开关专业模式。
 * @param {object} project
 * @param {boolean} enabled
 * @returns {object} Project
 */
function setProMode(project, enabled) {
  if (!project) return project;
  const next = enabled === true;
  if (project.proMode === next) return project;
  return assign(project, { proMode: next });
}

// ---------------------------------------------------------------------------
// 时间线查询
// ---------------------------------------------------------------------------

/**
 * 计算时间线布局（顺序即磁吸顺序，无空隙）。
 * @param {object} project
 * @returns {Array<{clip:object, asset:object|null, index:number, start:number, end:number, duration:number}>}
 */
function timeline(project) {
  const assets = (project && project.assets) || [];
  const clips = (project && project.clips) || [];
  const assetById = {};
  assets.forEach((asset) => {
    if (asset) assetById[asset.id] = asset;
  });
  let cursor = 0;
  return clips.map((clip, index) => {
    const rawDuration = num(clip && clip.out, 0) - num(clip && clip.in, 0);
    const clipDuration = Math.max(0, rawDuration);
    const start = cursor;
    const end = start + clipDuration;
    cursor = end;
    return {
      clip,
      asset: assetById[clip && clip.assetId] || null,
      index,
      start,
      end,
      duration: clipDuration,
    };
  });
}

/**
 * 片段总时长（秒）。
 * @param {object} project
 * @returns {number}
 */
function duration(project) {
  const clips = (project && project.clips) || [];
  let total = 0;
  clips.forEach((clip) => {
    if (!clip) return;
    const clipDuration = num(clip.out, 0) - num(clip.in, 0);
    if (clipDuration > 0) total += clipDuration;
  });
  return total;
}

/**
 * 查找时间线 time 处所在的片段；半开区间 [start, end)，无片段返回 null。
 * @param {object} project
 * @param {number} time
 * @returns {{entry:object, localTime:number, sourceTime:number}|null}
 */
function clipAt(project, time) {
  if (!isNum(time)) return null;
  const entries = timeline(project);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (time >= entry.start && time < entry.end) {
      const localTime = time - entry.start;
      return {
        entry,
        localTime,
        sourceTime: num(entry.clip.in, 0) + localTime,
      };
    }
  }
  return null;
}

/**
 * 吸附到 0 / 结尾 / 片段边界；threshold 内最近者胜出，否则原样返回。
 * @param {object} project
 * @param {number} time
 * @param {number} [threshold=0.12]
 * @returns {number}
 */
function snap(project, time, threshold) {
  if (!isNum(time)) return 0;
  const limit = Math.max(0, num(threshold, 0.12));
  const entries = timeline(project);
  const candidates = [0, duration(project)];
  entries.forEach((entry) => {
    candidates.push(entry.start, entry.end);
  });
  let best = time;
  let bestDistance = limit + EPS;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const distance = Math.abs(time - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best === time ? time : roundTime(best);
}

/**
 * 返回角色主题色；未知角色回退中性灰。
 * @param {string} role
 * @returns {string}
 */
function roleColor(role) {
  const found = ROLES.find((item) => item.id === role);
  return found ? found.color : '#9aa4b2';
}

// ---------------------------------------------------------------------------
// 音量 / 闪避
// ---------------------------------------------------------------------------

/**
 * 音乐垫增益（0..1），已包含音乐音量、音乐角色音量/静音与对白自动闪避。
 * @param {object} project
 * @param {number} time
 * @returns {number}
 */
function musicGain(project, time) {
  if (!project || !project.music) return 0;
  const musicRole = roleSettings(project, 'music');
  if (musicRole.muted) return 0;
  let gain = clamp(num(project.music.volume, 0.8), 0, 1, 0.8) * musicRole.volume;
  const ducking = project.ducking;
  if (ducking && ducking.enabled) {
    const hit = clipAt(project, num(time, 0));
    // 对白“出现”即压低音乐，即使对白被静音也保留闪避行为（观众听感一致）。
    if (hit && hit.entry.clip && hit.entry.clip.role === 'dialogue') {
      gain *= clamp(num(ducking.level, DEFAULT_DUCK), 0, 1, DEFAULT_DUCK);
    }
  }
  return clamp(gain, 0, 1, 0);
}

/**
 * 片段增益（0..1），已包含角色音量/静音与片段音量。
 * @param {object} project
 * @param {object} clip
 * @returns {number}
 */
function clipGain(project, clip) {
  if (!clip) return 0;
  const role = roleSettings(project, clip.role || 'dialogue');
  if (role.muted) return 0;
  return clamp(num(clip.volume, 1) * role.volume, 0, 1, 0);
}

// ---------------------------------------------------------------------------
// 时间格式化
// ---------------------------------------------------------------------------

/** 两位补零。 */
function pad2(value) {
  const text = String(Math.max(0, Math.floor(value)));
  return text.length >= 2 ? text : '0' + text;
}

/**
 * 格式化为帧时间码 '00:00:00:00'（HH:MM:SS:FF）。
 * @param {number} seconds
 * @param {number} [fps=30]
 * @returns {string}
 */
function formatTimecode(seconds, fps) {
  const framesPerSecond = Math.max(1, Math.round(num(fps, 30)));
  const totalFrames = Math.max(0, Math.round(num(seconds, 0) * framesPerSecond));
  const frames = totalFrames % framesPerSecond;
  const totalSeconds = (totalFrames - frames) / framesPerSecond;
  const secs = totalSeconds % 60;
  const totalMinutes = (totalSeconds - secs) / 60;
  const mins = totalMinutes % 60;
  const hours = (totalMinutes - mins) / 60;
  return [pad2(hours), pad2(mins), pad2(secs), pad2(frames)].join(':');
}

/**
 * 格式化为紧凑时钟：'0:00.0'、'1:02.3'、'1:02:03.4'。
 * @param {number} seconds
 * @returns {string}
 */
function formatClock(seconds) {
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

// ---------------------------------------------------------------------------
// 字幕
// ---------------------------------------------------------------------------

/**
 * 返回 time 时刻应显示的字幕（半开区间 [start, start+duration)）。
 * @param {object} project
 * @param {number} time
 * @returns {Array<object>}
 */
function captionsAt(project, time) {
  if (!isNum(time)) return [];
  const captions = (project && project.captions) || [];
  return captions.filter(
    (caption) =>
      caption &&
      time >= num(caption.start, 0) &&
      time < num(caption.start, 0) + Math.max(0, num(caption.duration, 0)),
  );
}

/**
 * 从脚本生成字幕：按换行/中英文句末标点拆句，均匀铺满 start..end，
 * 句间留 0.06s 间隙。会替换 project.captions。
 * @param {object} project
 * @param {string} text
 * @param {{start?:number,end?:number,styleId?:string}} [options]
 * @returns {object} Project
 */
function captionsFromScript(project, text, options) {
  if (!project) return project;
  const opts = options || {};
  const total = duration(project);
  const start = roundTime(clamp(num(opts.start, 0), 0, total, 0));
  const end = roundTime(clamp(num(opts.end, total), start, total, total));
  const styleId = CAPTION_STYLES.some((style) => style.id === opts.styleId)
    ? opts.styleId
    : CAPTION_STYLES[0].id;
  const sentences = splitSentences(text);
  const available = end - start;
  if (sentences.length === 0 || available <= 0.02) {
    return assign(project, { captions: [] });
  }

  const count = sentences.length;
  // 句多且总时长不足时收窄间隙，保证每条字幕都至少有一点点时长。
  const gap = count > 1 ? Math.min(SENTENCE_GAP, available / (count * 4)) : 0;
  const slot = Math.max(0.02, (available - gap * (count - 1)) / count);
  const captions = sentences.map((sentence, index) => ({
    id: newId('cap'),
    text: sentence,
    start: roundTime(start + index * (slot + gap)),
    duration: roundTime(slot),
    styleId,
  }));
  return assign(project, { captions });
}

// ---------------------------------------------------------------------------
// 静音检测 / 粗剪
// ---------------------------------------------------------------------------

/**
 * 从峰值数组检测静音区间（时间线秒）：峰值低于 threshold 且持续 >= minSilence，
 * 首尾各向内留 pad 秒。
 * @param {number[]|null} peaks 0..1 峰值数组
 * @param {number} durationSeconds 素材总时长（秒）
 * @param {{threshold?:number,minSilence?:number,pad?:number}} [options]
 * @returns {Array<{start:number,end:number}>}
 */
function silenceRanges(peaks, durationSeconds, options) {
  const opts = options || {};
  const threshold = clamp(num(opts.threshold, 0.055), 0, 1, 0.055);
  const minSilence = Math.max(0, num(opts.minSilence, 0.35));
  const pad = Math.max(0, num(opts.pad, 0.06));
  const total = Math.max(0, num(durationSeconds, 0));
  if (!Array.isArray(peaks) || peaks.length === 0 || total <= 0) return [];

  const step = total / peaks.length;
  const ranges = [];
  let runStart = -1;

  const flush = (endIndex) => {
    const rawStart = runStart * step;
    const rawEnd = Math.min(total, endIndex * step);
    runStart = -1;
    if (rawEnd - rawStart < minSilence) return;
    const start = rawStart + pad;
    const end = rawEnd - pad;
    if (end - start <= 0.005) return;
    ranges.push({ start: roundTime(start), end: roundTime(end) });
  };

  for (let i = 0; i < peaks.length; i += 1) {
    const quiet = num(peaks[i], 1) < threshold;
    if (quiet && runStart < 0) runStart = i;
    else if (!quiet && runStart >= 0) flush(i);
  }
  if (runStart >= 0) flush(peaks.length);
  return ranges;
}

/**
 * 为每个片段规划静音切点（返回源素材内绝对秒，已与片段 in/out 相交）。
 * 没有峰值数据的片段返回空数组。
 * @param {object} project
 * @param {object} [options] 透传 silenceRanges 的 threshold/minSilence/pad
 * @returns {Object<string, Array<{start:number,end:number}>>}
 */
function planSilenceCut(project, options) {
  const result = {};
  if (!project) return result;
  const clips = project.clips || [];
  clips.forEach((clip) => {
    if (!clip) return;
    result[clip.id] = [];
    const asset = findAsset(project, clip.assetId);
    if (!asset || !Array.isArray(asset.peaks) || asset.peaks.length === 0) return;
    const from = Math.min(num(clip.in, 0), num(clip.out, 0));
    const to = Math.max(num(clip.in, 0), num(clip.out, 0));
    const ranges = silenceRanges(asset.peaks, asset.duration, options);
    ranges.forEach((range) => {
      const start = Math.max(range.start, from);
      const end = Math.min(range.end, to);
      if (end - start > 0.005) {
        result[clip.id].push({ start: roundTime(start), end: roundTime(end) });
      }
    });
  });
  return result;
}

/**
 * 按静音区间粗剪：每个片段切掉 ranges 并重新拼接，保留段 < 0.25s 丢弃。
 * rangesByClip 的值是源素材内绝对秒；重叠区间自动合并。
 * @param {object} project
 * @param {Object<string, Array<{start:number,end:number}>>} rangesByClip
 * @returns {{project: object, removedSeconds: number}}
 */
function roughCut(project, rangesByClip) {
  if (!project) return { project, removedSeconds: 0 };
  const ranges = rangesByClip && typeof rangesByClip === 'object' ? rangesByClip : {};
  const before = duration(project);
  const nextClips = [];
  const clips = project.clips || [];

  clips.forEach((clip) => {
    if (!clip) return;
    const clipIn = num(clip.in, 0);
    const clipOut = Math.max(clipIn, num(clip.out, 0));
    const raw = Array.isArray(ranges[clip.id]) ? ranges[clip.id] : [];
    const cuts = mergeRanges(
      raw.map((range) => ({
        start: Math.max(clipIn, num(range && range.start, clipIn)),
        end: Math.min(clipOut, num(range && range.end, clipOut)),
      })),
    );
    if (cuts.length === 0) {
      nextClips.push(assign(clip, {}));
      return;
    }

    // 切点把 [clipIn, clipOut] 分成若干保留段。
    const keeps = [];
    let cursor = clipIn;
    cuts.forEach((cut) => {
      if (cut.start > cursor) keeps.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
    });
    if (cursor < clipOut) keeps.push({ start: cursor, end: clipOut });

    keeps
      .filter((keep) => keep.end - keep.start >= MIN_KEEP)
      .forEach((keep, index) => {
        nextClips.push(
          assign(clip, {
            id: index === 0 ? clip.id : newId('clip'),
            in: roundTime(keep.start),
            out: roundTime(keep.end),
          }),
        );
      });
  });

  const nextProject = settlePlayhead(assign(project, { clips: nextClips }));
  const removed = roundTime(Math.max(0, before - duration(nextProject)));
  // 无可切内容时返回原 project 引用，便于 UI 判断“没有检测到静音”。
  if (removed <= 1e-9 && nextProject.playhead === project.playhead) {
    return { project, removedSeconds: 0 };
  }
  return { project: nextProject, removedSeconds: removed };
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

module.exports = {
  ROLES,
  FILTERS,
  CAPTION_STYLES,
  createProject,
  newId,
  addAsset,
  removeAsset,
  insertClip,
  appendClip,
  moveClip,
  trimClip,
  removeClip,
  splitAt,
  setClipRole,
  setClipVolume,
  setClipFilter,
  setClipLabel,
  seek,
  setInPoint,
  setOutPoint,
  clearMarks,
  setMusic,
  setMusicVolume,
  setDucking,
  setRoleVolume,
  toggleRoleMute,
  setFilter,
  setProMode,
  timeline,
  duration,
  clipAt,
  snap,
  roleColor,
  musicGain,
  clipGain,
  formatTimecode,
  formatClock,
  captionsAt,
  captionsFromScript,
  silenceRanges,
  planSilenceCut,
  roughCut,
};
