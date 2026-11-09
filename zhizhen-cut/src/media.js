/**
 * 切线 Cutline · media.js
 *
 * DOM/media pipeline for the video workbench. Zero React, zero dependencies.
 *
 * Exports:
 *   loadAsset(file, opts?) -> Promise<Asset>
 *   PreviewEngine              (class)
 *   exportProject(project, options, callbacks) -> Promise<{ blob, mime, filename, width, height, duration }>
 *   probeExportSupport() -> { mime, extension, supported }
 *   download(blob, filename)
 *   formatBytes(bytes) -> string
 *   formatDuration(seconds) -> string
 *
 * Notes / design decisions:
 * - engine.js is owned by engine-dev and is the source of truth for timeline
 *   math. This module calls it when available (clipAt / timeline / duration /
 *   clipGain / musicGain / captionsAt / FILTERS / CAPTION_STYLES / newId) and
 *   keeps a small, documented fallback for each helper so a partially bundled
 *   build still previews and exports instead of crashing.
 * - Browser-only APIs are used, but never `document.body`: the preview canvas
 *   and its hidden media elements are appended to the host element supplied by
 *   the caller; the export pipeline uses a detached container unless the caller
 *   passes `options.host`.
 * - Cancellation: `exportProject` throws `Error("export-cancelled")`
 *   (`.code === "export-cancelled"`) after cleaning everything up.
 * - No exceptions escape preview rendering; unready media renders a dark stage
 *   with a "加载中" placeholder.
 *
 * @module media
 */

/* ------------------------------------------------------------------ */
/* engine bridge                                                      */
/* ------------------------------------------------------------------ */

var engine = null;
try {
  // Contract: `require('./engine')` is allowed. Kept in try/catch so a build
  // that runs before engine.js lands still produces a usable media module.
  engine = require('./engine');
} catch (err) {
  engine = null;
}

/**
 * Call an engine helper by name, falling back to a local implementation when
 * the engine module (or that specific helper) is unavailable.
 * @param {string} name
 * @param {Function} fallback
 * @param {Array} args
 * @returns {*}
 */
function engineCall(name, fallback, args) {
  var list = args || [];
  if (engine && typeof engine[name] === 'function') {
    try {
      return engine[name].apply(engine, list);
    } catch (err) {
      /* fall through to the local implementation */
    }
  }
  if (typeof fallback === 'function') return fallback.apply(null, list);
  return undefined;
}

/**
 * Read an exported engine constant, with a fallback value.
 * @param {string} name
 * @param {*} fallback
 * @returns {*}
 */
function engineConst(name, fallback) {
  if (engine && engine[name] != null) return engine[name];
  return fallback;
}

/* ------------------------------------------------------------------ */
/* constants                                                          */
/* ------------------------------------------------------------------ */

var FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';

var FALLBACK_FILTERS = [{ id: 'none', name: '无', css: 'none', accent: '#888888' }];

var FALLBACK_CAPTION_STYLES = [
  {
    id: 'default',
    name: '默认',
    font: FONT_STACK,
    weight: 600,
    size: 52,
    color: '#ffffff',
    bg: 'rgba(0, 0, 0, 0.55)',
    stroke: 'rgba(0, 0, 0, 0.65)',
  },
];

var FALLBACK_ROLES = {
  dialogue: { id: 'dialogue', volume: 1, muted: false },
  music: { id: 'music', volume: 0.8, muted: false },
  ambient: { id: 'ambient', volume: 0.7, muted: false },
};

/** Preferred recording codecs, best first (contract order). */
// Prefer MP4/H.264 because it opens in QuickTime, iOS/Android, Windows Media
// Player and every social platform. WebM stays as a fallback for browsers that
// cannot record MP4 (the export dialog tells the user when that happens).
var EXPORT_CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', extension: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
  { mime: 'video/mp4;codecs=avc1', extension: 'mp4' },
  { mime: 'video/mp4', extension: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', extension: 'webm' },
  { mime: 'video/webm', extension: 'webm' },
];

var DEFAULT_EXPORT = {
  width: 1280,
  height: 720,
  fps: 30,
  bitrate: 8000000,
  audioBitrate: 128000,
  includeCaptions: true,
  includeMusic: true,
};

/** Upper bound for files we are willing to fully read + decode for peaks. */
var MAX_DECODE_BYTES = 400 * 1024 * 1024;

/** Extra recording time after the timeline end so the last frames flush. */
var EXPORT_TAIL_SECONDS = 0.12;

var AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|weba|aiff?|caf|wma)$/i;
var VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov|mkv|avi|ogv|wmv|flv|mpe?g|ts|mts|3gp|m2ts)$/i;
var MIME_BY_EXT = {
  mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv', mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', weba: 'audio/webm', aiff: 'audio/aiff',
  aif: 'audio/aiff', caf: 'audio/x-caf', wma: 'audio/x-ms-wma',
};

/* ------------------------------------------------------------------ */
/* generic helpers                                                    */
/* ------------------------------------------------------------------ */

function noop() {}

/** @returns {number} numeric value or fallback when NaN/Infinity. */
function num(value, fallback) {
  var n = Number(value);
  return isFinite(n) ? n : fallback;
}

/** @returns {number} value clamped into [min, max]. */
function clamp(value, min, max) {
  var n = Number(value);
  if (!isFinite(n)) n = min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** @returns {number} value clamped into [0, 1]. */
function clamp01(value) {
  return clamp(value, 0, 1);
}

/** @returns {string} two-digit zero padded number. */
function pad2(value) {
  var n = Math.max(0, Math.floor(num(value, 0)));
  return n < 10 ? '0' + n : String(n);
}

function roundTo(value, digits) {
  var factor = Math.pow(10, digits || 0);
  var n = num(value, 0);
  return Math.round(n * factor) / factor;
}

/** Build an Error carrying a stable machine-readable `code`. */
function makeError(code, fallbackMessage) {
  var err = new Error(fallbackMessage || code);
  err.code = code;
  return err;
}

function makeCancelError() {
  return makeError('export-cancelled', 'export-cancelled');
}

function wallClock() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/** @returns {string} best-effort MIME type for a filename. */
function mimeFromName(name) {
  var match = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  if (!match) return '';
  return MIME_BY_EXT[match[1].toLowerCase()] || '';
}

/** @returns {string} exporter file extension for a MIME type. */
function extensionForMime(mime) {
  var m = String(mime || '').toLowerCase();
  if (m.indexOf('webm') >= 0) return 'webm';
  if (m.indexOf('mp4') >= 0 || m.indexOf('avc1') >= 0 || m.indexOf('h264') >= 0) return 'mp4';
  if (m.indexOf('quicktime') >= 0) return 'mov';
  if (m.indexOf('ogg') >= 0) return 'ogv';
  return 'webm';
}

/** Strip characters that break cross-platform filenames. */
function sanitizeFilename(name) {
  var out = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);
  return out;
}

function timestampForFilename() {
  var d = new Date();
  return (
    String(d.getFullYear()) +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    '-' +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

/** Local id generator used when engine.newId is unavailable. */
function localNewId(prefix) {
  var base = typeof prefix === 'string' && prefix ? prefix : 'id';
  return base + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function generateId(prefix) {
  return engineCall('newId', localNewId, [prefix || 'asset']);
}

/* ------------------------------------------------------------------ */
/* timeline fallbacks (only used when engine.js cannot be loaded)     */
/* ------------------------------------------------------------------ */

function localTimeline(project) {
  if (!project || !Array.isArray(project.clips)) return [];
  var assets = {};
  var assetList = Array.isArray(project.assets) ? project.assets : [];
  for (var i = 0; i < assetList.length; i++) {
    if (assetList[i] && assetList[i].id) assets[assetList[i].id] = assetList[i];
  }
  var entries = [];
  var cursor = 0;
  for (var c = 0; c < project.clips.length; c++) {
    var clip = project.clips[c];
    if (!clip) continue;
    var asset = assets[clip.assetId];
    var inPoint = num(clip.in, 0);
    var outPoint = num(clip.out, asset && asset.duration ? asset.duration : 0);
    var duration = Math.max(0, outPoint - inPoint);
    if (!asset) {
      asset = {
        id: clip.assetId,
        name: clip.label || '',
        kind: 'video',
        duration: inPoint + duration,
        width: 0,
        height: 0,
        url: '',
        thumbnail: null,
        peaks: null,
        fileSize: 0,
        mime: '',
        hasAudio: false,
      };
    }
    entries.push({ clip: clip, asset: asset, index: c, start: cursor, end: cursor + duration, duration: duration });
    cursor += duration;
  }
  return entries;
}

function localDuration(project) {
  var entries = localTimeline(project);
  var total = 0;
  for (var i = 0; i < entries.length; i++) total += entries[i].duration;
  return total;
}

function localClipAt(project, time) {
  var t = num(time, 0);
  var entries = localTimeline(project);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (t >= entry.start && t < entry.end) {
      return { entry: entry, localTime: t - entry.start, sourceTime: num(entry.clip.in, 0) + (t - entry.start) };
    }
  }
  return null;
}

function localClipGain(project, clip) {
  if (!clip) return 0;
  var roles = (project && project.roles) || {};
  var role = roles[clip.role] || FALLBACK_ROLES[clip.role] || { volume: 1, muted: false };
  if (role.muted) return 0;
  return clamp01(num(role.volume, 1) * num(clip.volume, 1));
}

function localMusicGain(project, time) {
  var music = project && project.music;
  if (!music || !music.assetId) return 0;
  var roles = (project && project.roles) || {};
  var musicRole = roles.music || FALLBACK_ROLES.music;
  if (musicRole && musicRole.muted) return 0;
  var gain = num(music.volume, 1) * num(musicRole && musicRole.volume, 1);
  var ducking = (project && project.ducking) || null;
  if (ducking && ducking.enabled) {
    var hit = localClipAt(project, num(time, 0));
    if (hit && hit.entry && hit.entry.clip && hit.entry.clip.role === 'dialogue') {
      var dialogueRole = roles.dialogue;
      if (!dialogueRole || !dialogueRole.muted) gain *= num(ducking.level, 0.22);
    }
  }
  return clamp01(gain);
}

function localCaptionsAt(project, time) {
  if (!project || !Array.isArray(project.captions)) return [];
  var t = num(time, 0);
  var out = [];
  for (var i = 0; i < project.captions.length; i++) {
    var caption = project.captions[i];
    if (!caption) continue;
    var start = num(caption.start, 0);
    var duration = Math.max(0, num(caption.duration, 0));
    if (t >= start && t < start + duration) out.push(caption);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* content (filters / captions) helpers                               */
/* ------------------------------------------------------------------ */

function getFilterList() {
  var list = engineConst('FILTERS', FALLBACK_FILTERS);
  return Array.isArray(list) && list.length ? list : FALLBACK_FILTERS;
}

function getCaptionStyleList() {
  var list = engineConst('CAPTION_STYLES', FALLBACK_CAPTION_STYLES);
  return Array.isArray(list) && list.length ? list : FALLBACK_CAPTION_STYLES;
}

function findById(list, id) {
  if (!Array.isArray(list) || !list.length) return null;
  if (id == null) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === id) return list[i];
  }
  return null;
}

/**
 * Build the canvas `ctx.filter` value for the global project filter plus a
 * clip filter. Unknown ids and 'none' are ignored.
 * @param {object} project
 * @param {object|null} clip
 * @returns {string}
 */
function fitModeFor(project) {
  return project && project.fit === 'cover' ? 'cover' : 'contain';
}

function filterCssFor(project, clip) {
  var filters = getFilterList();
  var global = project ? findById(filters, project.filter) : null;
  var local = clip ? findById(filters, clip.filter) : null;
  var parts = [];
  if (global && global.css && global.css !== 'none') parts.push(global.css);
  if (local && local.css && local.css !== 'none' && (!global || local.css !== global.css)) parts.push(local.css);
  return parts.length ? parts.join(' ') : 'none';
}

/* ------------------------------------------------------------------ */
/* canvas drawing helpers                                             */
/* ------------------------------------------------------------------ */

function drawCover(ctx, source, sourceWidth, sourceHeight, width, height) {
  if (!ctx || !source || !sourceWidth || !sourceHeight) return;
  var scale = Math.max(width / sourceWidth, height / sourceHeight);
  if (!isFinite(scale) || scale <= 0) return;
  var dw = sourceWidth * scale;
  var dh = sourceHeight * scale;
  try {
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } catch (err) {
    /* drawImage can throw for tainted or not-yet-decoded sources */
  }
}

/**
 * Draw a source with either `contain` (letterbox, the professional default for
 * mismatched orientations) or `cover` (fill and crop) scaling.
 */
function drawFit(ctx, source, sourceWidth, sourceHeight, width, height, fit) {
  if (!ctx || !source || !sourceWidth || !sourceHeight) return;
  var scale =
    fit === 'contain'
      ? Math.min(width / sourceWidth, height / sourceHeight)
      : Math.max(width / sourceWidth, height / sourceHeight);
  if (!isFinite(scale) || scale <= 0) return;
  var dw = sourceWidth * scale;
  var dh = sourceHeight * scale;
  try {
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } catch (err) {
    /* drawImage can throw for tainted or not-yet-decoded sources */
  }
}

function drawLoadingState(ctx, width, height, text) {
  try {
    ctx.save();
    var size = Math.max(12, Math.round(height * 0.035));
    ctx.font = '500 ' + size + 'px ' + FONT_STACK;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || '加载中', width / 2, height / 2);
    ctx.restore();
  } catch (err) {
    /* ignore text rendering failures */
  }
}

function roundRectPath(ctx, x, y, width, height, radius) {
  var r = Math.max(0, Math.min(num(radius, 0), Math.min(width, height) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Greedy text wrap that handles both space-separated and CJK strings. */
function wrapTextLines(ctx, text, maxWidth) {
  var raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!raw) return [''];
  if (maxWidth <= 0) return [raw];
  var lines = [];
  var line = '';
  var tokens = raw.split(' ');
  for (var t = 0; t < tokens.length; t++) {
    var token = tokens[t];
    if (!token) continue;
    var candidate = line ? line + ' ' + token : token;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = '';
    }
    if (ctx.measureText(token).width <= maxWidth) {
      line = token;
      continue;
    }
    // Token alone is too wide: break it by characters (CJK / long URLs).
    for (var c = 0; c < token.length; c++) {
      var ch = token.charAt(c);
      var next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawCaptionBlock(ctx, text, style, width, height, stackIndex) {
  if (!text) return;
  try {
    var scale = height / 1080;
    var fontPx = clamp(Math.round(num(style.size, 52) * scale), 10, Math.max(12, Math.round(height * 0.28)));
    var weight = style.weight != null ? style.weight : 600;
    var family = style.font || FONT_STACK;
    var color = style.color || '#ffffff';
    var bg = style.bg;
    var stroke = style.stroke;

    ctx.save();
    ctx.font = String(weight) + ' ' + fontPx + 'px ' + family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var lines = wrapTextLines(ctx, text, width * 0.86);
    var lineHeight = fontPx * 1.26;
    var padX = fontPx * 0.55;
    var padY = fontPx * 0.3;
    var blockHeight = lines.length * lineHeight;
    var stackedOffset = num(stackIndex, 0) * (blockHeight + padY * 2 + fontPx * 0.4);
    var bottom = height - height * 0.075 - stackedOffset;
    var top = bottom - blockHeight;

    var widest = 0;
    for (var i = 0; i < lines.length; i++) {
      var lineWidth = ctx.measureText(lines[i]).width;
      if (lineWidth > widest) widest = lineWidth;
    }
    var boxWidth = Math.min(width * 0.94, widest + padX * 2);
    var boxHeight = blockHeight + padY * 2;
    var boxX = (width - boxWidth) / 2;
    var boxY = top - padY;

    if (bg && bg !== 'none' && bg !== 'transparent') {
      ctx.fillStyle = bg;
      roundRectPath(ctx, boxX, boxY, boxWidth, boxHeight, Math.min(boxHeight / 2, fontPx * 0.35));
      ctx.fill();
    }

    var stroked = !!(stroke && stroke !== 'none' && stroke !== 'transparent');
    if (stroked) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, fontPx / 10);
      ctx.lineJoin = 'round';
    }
    ctx.fillStyle = color;
    for (var l = 0; l < lines.length; l++) {
      var y = top + lineHeight * (l + 0.5);
      if (stroked) ctx.strokeText(lines[l], width / 2, y);
      ctx.fillText(lines[l], width / 2, y);
    }
    ctx.restore();
  } catch (err) {
    /* captions must never break video rendering */
  }
}

/**
 * Draw all captions active at `time`, using engine.captionsAt and
 * engine.CAPTION_STYLES. Overlapping captions stack upward.
 */
function drawCaptionsLayer(ctx, project, time, width, height) {
  var captions = engineCall('captionsAt', localCaptionsAt, [project, num(time, 0)]);
  if (!captions || !captions.length) return;
  var styles = getCaptionStyleList();
  for (var i = 0; i < captions.length; i++) {
    var caption = captions[i];
    if (!caption || !caption.text) continue;
    var style = findById(styles, caption.styleId) || styles[0] || FALLBACK_CAPTION_STYLES[0];
    drawCaptionBlock(ctx, caption.text, style, width, height, i);
  }
}

/* ------------------------------------------------------------------ */
/* media element helpers                                              */
/* ------------------------------------------------------------------ */

var HIDDEN_MEDIA_CSS =
  'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;' +
  'border:0;margin:0;padding:0;z-index:-1;';

/** Create a muted-agnostic hidden media element (caller decides mute/gain). */
function createHiddenMediaElement(asset) {
  var kind = asset && asset.kind === 'audio' ? 'audio' : 'video';
  var el = document.createElement(kind === 'audio' ? 'audio' : 'video');
  el.preload = 'auto';
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', '');
  el.setAttribute('disablepictureinpicture', '');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('tabindex', '-1');
  el.playsInline = true;
  try {
    el.style.cssText = HIDDEN_MEDIA_CSS;
  } catch (err) {
    /* ignore */
  }
  if (asset && asset.url) {
    try {
      el.src = asset.url;
    } catch (err) {
      /* ignore */
    }
  }
  return el;
}

/** Pause + release decoder and DOM references for an element. */
function releaseMediaElement(el) {
  if (!el) return;
  try {
    el.pause();
  } catch (err) {
    /* ignore */
  }
  try {
    el.removeAttribute('src');
  } catch (err) {
    /* ignore */
  }
  try {
    if (typeof el.load === 'function') el.load();
  } catch (err) {
    /* ignore */
  }
  try {
    if (el.parentNode) el.parentNode.removeChild(el);
  } catch (err) {
    /* ignore */
  }
}

function safePause(el) {
  if (!el) return;
  try {
    if (!el.paused) el.pause();
  } catch (err) {
    /* ignore */
  }
}

function safePlay(el) {
  if (!el) return;
  try {
    var promise = el.play();
    if (promise && typeof promise.catch === 'function') promise.catch(noop);
  } catch (err) {
    /* autoplay policies reject play(); the next render retries */
  }
}

function safeSeek(el, time) {
  if (!el) return;
  try {
    if (el.readyState >= 1) el.currentTime = Math.max(0, num(time, 0));
  } catch (err) {
    /* seeking before metadata throws in some browsers */
  }
}

/** Clamp a source time into [0, media duration). */
function clampSourceTime(asset, sourceTime) {
  var duration = num(asset && asset.duration, 0);
  var t = Math.max(0, num(sourceTime, 0));
  if (duration > 0) t = Math.min(t, duration - 0.0005 < 0 ? 0 : duration - 0.0005);
  return t;
}

/** Best-effort native signal that a video element carries audio. */
function nativeAudioHint(el) {
  if (!el) return false;
  try {
    if (typeof el.mozHasAudio === 'boolean' && el.mozHasAudio) return true;
    if (typeof el.webkitAudioDecodedByteCount === 'number' && el.webkitAudioDecodedByteCount > 0) return true;
    if (el.audioTracks && el.audioTracks.length > 0) return true;
  } catch (err) {
    /* ignore */
  }
  return false;
}

function mediaErrorCode(el) {
  var code = el && el.error ? el.error.code : 0;
  if (code === 2) return 'media-network-error';
  if (code === 3) return 'media-decode-error';
  if (code === 4) return 'media-unsupported';
  return 'media-load-error';
}

/** Resolve when the element reaches HAVE_METADATA; reject with a coded error. */
function waitForMetadata(el, timeoutMs) {
  return new Promise(function (resolve, reject) {
    if (!el) {
      reject(makeError('media-load-error', 'no media element'));
      return;
    }
    if (el.readyState >= 1) {
      resolve();
      return;
    }
    function cleanup() {
      el.removeEventListener('loadedmetadata', onReady);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    }
    function onReady() {
      cleanup();
      resolve();
    }
    function onError() {
      cleanup();
      reject(makeError(mediaErrorCode(el), 'media metadata failed'));
    }
    var timer = setTimeout(function () {
      cleanup();
      reject(makeError('media-timeout', 'media metadata timeout'));
    }, Math.max(1000, num(timeoutMs, 20000)));
    el.addEventListener('loadedmetadata', onReady);
    el.addEventListener('error', onError);
  });
}

/**
 * Tolerant readiness wait: resolves `true` once readyState >= minReadyState,
 * `false` on error or timeout. Never rejects.
 */
function waitReadyTolerant(el, minReadyState, timeoutMs) {
  return new Promise(function (resolve) {
    if (!el) {
      resolve(false);
      return;
    }
    if (el.readyState >= minReadyState) {
      resolve(true);
      return;
    }
    // Elements with no source never fire load events; don't wait out the timer.
    if (!el.src && !el.currentSrc) {
      resolve(false);
      return;
    }
    var settled = false;
    var timer = null;
    var events = ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'];
    function cleanup() {
      for (var i = 0; i < events.length; i++) el.removeEventListener(events[i], check);
      el.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    }
    function finish(ok) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    }
    function check() {
      if (el.readyState >= minReadyState) finish(true);
    }
    function onError() {
      finish(false);
    }
    for (var i = 0; i < events.length; i++) el.addEventListener(events[i], check);
    el.addEventListener('error', onError);
    timer = setTimeout(function () {
      finish(el.readyState >= minReadyState);
    }, Math.max(1000, num(timeoutMs, 10000)));
  });
}

/** Resolve when the next `seeked` fires (or timeout/error); never rejects. */
function waitSeeked(el, timeoutMs) {
  return new Promise(function (resolve) {
    if (!el) {
      resolve(false);
      return;
    }
    var settled = false;
    var timer = null;
    function cleanup() {
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    }
    function finish(ok) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    }
    function onSeeked() {
      finish(true);
    }
    function onError() {
      finish(false);
    }
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('error', onError);
    timer = setTimeout(function () {
      finish(false);
    }, Math.max(300, num(timeoutMs, 3000)));
  });
}

/** Seek an element and wait for the resulting frame; never rejects. */
function seekElement(el, time, timeoutMs) {
  if (!el) return Promise.resolve(false);
  var target = Math.max(0, num(time, 0));
  if (el.readyState >= 2 && Math.abs(num(el.currentTime, 0) - target) < 0.01) return Promise.resolve(true);
  var wait = waitSeeked(el, timeoutMs);
  try {
    el.currentTime = target;
  } catch (err) {
    return Promise.resolve(false);
  }
  return wait;
}

/* ------------------------------------------------------------------ */
/* loadAsset                                                          */
/* ------------------------------------------------------------------ */

function guessKind(mime, name) {
  if (/^audio\//i.test(mime || '')) return 'audio';
  if (/^video\//i.test(mime || '')) return 'video';
  if (AUDIO_EXT_RE.test(String(name || ''))) return 'audio';
  return 'video';
}

function createAudioContext() {
  var Ctor = null;
  if (typeof AudioContext !== 'undefined') Ctor = AudioContext;
  else if (typeof webkitAudioContext !== 'undefined') Ctor = webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch (err) {
    return null;
  }
}

/** FileReader-based read with progress (falls back to Blob.arrayBuffer). */
function readFileAsArrayBuffer(file, onProgress) {
  return new Promise(function (resolve, reject) {
    if (typeof FileReader === 'undefined') {
      if (file && typeof file.arrayBuffer === 'function') {
        file.arrayBuffer().then(resolve, reject);
      } else {
        reject(makeError('media-read-error', 'FileReader unavailable'));
      }
      return;
    }
    var reader = new FileReader();
    reader.onprogress = function (event) {
      if (event && event.lengthComputable && typeof onProgress === 'function') {
        try {
          onProgress(clamp01(event.loaded / event.total));
        } catch (err) {
          /* ignore */
        }
      }
    };
    reader.onload = function () {
      resolve(reader.result);
    };
    reader.onerror = function () {
      reject(makeError('media-read-error', 'file read failed'));
    };
    try {
      reader.readAsArrayBuffer(file);
    } catch (err) {
      reject(makeError('media-read-error', 'file read failed'));
    }
  });
}

function decodeAudioDataAsync(ctx, arrayBuffer) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = null;
    function finish(ok, value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (ok) resolve(value);
      else reject(value);
    }
    timer = setTimeout(function () {
      finish(false, makeError('media-decode-timeout', 'audio decode timeout'));
    }, 45000);
    try {
      var maybe = ctx.decodeAudioData(
        arrayBuffer,
        function (buffer) {
          finish(true, buffer);
        },
        function (err) {
          finish(false, err || makeError('media-decode-error', 'audio decode failed'));
        }
      );
      if (maybe && typeof maybe.then === 'function') {
        maybe.then(
          function (buffer) {
            finish(true, buffer);
          },
          function (err) {
            finish(false, err || makeError('media-decode-error', 'audio decode failed'));
          }
        );
      }
    } catch (err) {
      finish(false, err || makeError('media-decode-error', 'audio decode failed'));
    }
  });
}

/**
 * Compute `count` peak values (0..1) from a decoded AudioBuffer. Samples are
 * decimated for very long buffers so a 1h podcast stays fast.
 * @returns {number[]}
 */
function computePeaks(audioBuffer, count) {
  var peaks = new Array(count);
  var length = audioBuffer ? audioBuffer.length : 0;
  if (!length) {
    for (var z = 0; z < count; z++) peaks[z] = 0;
    return peaks;
  }
  var channels = Math.max(1, audioBuffer.numberOfChannels);
  var channelData = [];
  for (var c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));
  var bucketSize = length / count;
  var maxSamplesPerBucket = 2048;
  for (var i = 0; i < count; i++) {
    var start = Math.floor(i * bucketSize);
    var end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * bucketSize)));
    var step = Math.max(1, Math.ceil((end - start) / maxSamplesPerBucket));
    var peak = 0;
    for (var ch = 0; ch < channels; ch++) {
      var data = channelData[ch];
      for (var s = start; s < end; s += step) {
        var value = data[s];
        if (value < 0) value = -value;
        if (value > peak) peak = value;
      }
    }
    peaks[i] = peak > 1 ? 1 : peak;
  }
  return peaks;
}

/**
 * Decode a file's audio track to extract peaks. Returns null (never throws)
 * when decode is unsupported, fails, or the file exceeds the memory cap.
 * @returns {Promise<{ peaks: number[], duration: number } | null>}
 */
async function extractAudioAnalysis(file, opts, onProgress) {
  var options = opts || {};
  var maxBytes = num(options.maxDecodeBytes, MAX_DECODE_BYTES);
  if (!file || !num(file.size, 0)) return null;
  if (maxBytes > 0 && num(file.size, 0) > maxBytes) return null;
  var arrayBuffer;
  try {
    arrayBuffer = await readFileAsArrayBuffer(file, function (ratio) {
      if (typeof onProgress === 'function') onProgress(clamp01(ratio));
    });
  } catch (err) {
    return null;
  }
  if (!arrayBuffer || !arrayBuffer.byteLength) return null;
  var ctx = createAudioContext();
  if (!ctx) return null;
  try {
    var audioBuffer = null;
    try {
      audioBuffer = await decodeAudioDataAsync(ctx, arrayBuffer);
    } catch (err) {
      return null;
    }
    if (!audioBuffer || !audioBuffer.length) return null;
    return { peaks: computePeaks(audioBuffer, 800), duration: num(audioBuffer.duration, 0) };
  } finally {
    try {
      if (ctx.state !== 'closed') ctx.close();
    } catch (err) {
      /* ignore */
    }
  }
}

/**
 * Read duration, working around containers that report Infinity until seeked.
 * @returns {Promise<number>} seconds, 0 when unknown.
 */
function resolveDuration(el, timeoutMs) {
  if (isFinite(el.duration) && el.duration > 0) return Promise.resolve(el.duration);
  return new Promise(function (resolve) {
    var settled = false;
    var timer = null;
    function finish(value) {
      if (settled) return;
      settled = true;
      el.removeEventListener('durationchange', onDurationChange);
      el.removeEventListener('timeupdate', onDurationChange);
      if (timer) clearTimeout(timer);
      resolve(num(value, 0));
    }
    function onDurationChange() {
      if (isFinite(el.duration) && el.duration > 0) finish(el.duration);
    }
    el.addEventListener('durationchange', onDurationChange);
    el.addEventListener('timeupdate', onDurationChange);
    timer = setTimeout(function () {
      finish(isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
    }, Math.max(500, num(timeoutMs, 4000)));
    try {
      // The classic Infinity-duration workaround.
      el.currentTime = 1e7;
    } catch (err) {
      finish(0);
    }
  });
}

/** Capture a 320px-wide JPEG thumbnail from a loaded video element. */
async function captureThumbnail(el, duration, progress) {
  if (!el) return null;
  if (!el.videoWidth || !el.videoHeight) return null;
  var candidates = [];
  if (duration > 0.15) {
    candidates.push(Math.min(Math.max(duration * 0.1, 0.04), 3));
    if (duration > 2) candidates.push(Math.min(duration * 0.5, duration - 0.1));
  } else {
    candidates.push(0);
  }
  for (var i = 0; i < candidates.length; i++) {
    await seekElement(el, candidates[i], 6000);
    if (el.readyState < 2) await waitReadyTolerant(el, 2, 4000);
    if (progress) progress(i === 0 ? 0.35 : 0.42);
    var dataUrl = drawThumbnail(el);
    if (dataUrl) return dataUrl;
  }
  return null;
}

function drawThumbnail(el) {
  try {
    var sourceWidth = el.videoWidth;
    var sourceHeight = el.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    var width = 320;
    var height = Math.max(1, Math.round((width * sourceHeight) / sourceWidth));
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(el, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch (err) {
    return null;
  }
}

/**
 * Inspect a user-selected File/Blob and produce an Asset for the project.
 *
 * Creates a blob URL, reads video/audio metadata, captures a 320px-wide JPEG
 * thumbnail for video, extracts 800 audio peaks via decodeAudioData (tolerant:
 * null on failure/unsupported/oversized files) and estimates `hasAudio`.
 *
 * @param {File|Blob} file
 * @param {{ id?: string, onProgress?: (p:number)=>void, host?: Element,
 *           maxDecodeBytes?: number, thumbnailTime?: number,
 *           metadataTimeout?: number }} [opts]
 * @returns {Promise<object>} Asset per CONTRACTS.md
 */
async function loadAsset(file, opts) {
  if (!file || typeof file.size !== 'number') throw makeError('media-invalid-file', 'loadAsset requires a File/Blob');
  var options = opts || {};
  var onProgress = typeof options.onProgress === 'function' ? options.onProgress : noop;
  function report(value) {
    try {
      onProgress(clamp01(value));
    } catch (err) {
      /* a throwing progress callback must not abort the import */
    }
  }

  var mime = file.type || mimeFromName(file.name);
  var name = file.name || 'clip';
  var kind = guessKind(mime, name);
  var url = URL.createObjectURL(file);
  var el = null;
  var host = options.host && options.host.appendChild ? options.host : null;

  report(0.01);
  try {
    if (typeof document !== 'undefined') {
      el = document.createElement(kind === 'audio' ? 'audio' : 'video');
      el.preload = 'auto';
      el.muted = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.playsInline = true;
      if (host) {
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = HIDDEN_MEDIA_CSS;
        try {
          host.appendChild(el);
        } catch (err) {
          /* ignore */
        }
      }
      el.src = url;
      await waitForMetadata(el, num(options.metadataTimeout, 20000));
    } else {
      throw makeError('media-unsupported', 'loadAsset requires a DOM');
    }
    report(0.06);

    var duration = await resolveDuration(el, 4000);
    report(0.1);

    var width = kind === 'video' ? num(el.videoWidth, 0) : 0;
    var height = kind === 'video' ? num(el.videoHeight, 0) : 0;

    var thumbnail = null;
    if (kind === 'video' && width > 0 && height > 0) {
      thumbnail = await captureThumbnail(el, duration, report);
    }
    report(0.55);

    var analysis = null;
    try {
      analysis = await extractAudioAnalysis(file, options, function (ratio) {
        report(0.55 + ratio * 0.4);
      });
    } catch (err) {
      analysis = null;
    }
    report(0.97);

    if (!(duration > 0) && analysis && analysis.duration > 0) duration = analysis.duration;
    if (!(duration > 0)) throw makeError('media-no-duration', 'unable to determine media duration');

    var peaks = analysis ? analysis.peaks : null;
    var decodedAudio = !!(analysis && analysis.peaks);
    var hasAudio = kind === 'audio' ? true : decodedAudio || nativeAudioHint(el);

    var asset = {
      id: options.id || generateId('asset'),
      name: name,
      kind: kind,
      duration: roundTo(duration, 3),
      width: Math.round(width),
      height: Math.round(height),
      url: url,
      thumbnail: thumbnail,
      peaks: peaks,
      fileSize: num(file.size, 0),
      mime: mime || (kind === 'audio' ? 'audio/*' : 'video/*'),
      hasAudio: hasAudio,
    };
    report(1);
    return asset;
  } catch (err) {
    try {
      URL.revokeObjectURL(url);
    } catch (revokeErr) {
      /* ignore */
    }
    if (err && err.code) throw err;
    throw makeError('media-load-error', (err && err.message) || 'loadAsset failed');
  } finally {
    releaseMediaElement(el);
  }
}

/* ------------------------------------------------------------------ */
/* PreviewEngine                                                      */
/* ------------------------------------------------------------------ */

function resolveSourceTime(hit) {
  if (!hit) return 0;
  if (hit.sourceTime != null && isFinite(hit.sourceTime)) return num(hit.sourceTime, 0);
  var clip = hit.entry && hit.entry.clip;
  return num(clip && clip.in, 0) + num(hit.localTime, 0);
}

function findAssetById(project, assetId) {
  if (!project || !Array.isArray(project.assets)) return null;
  for (var i = 0; i < project.assets.length; i++) {
    if (project.assets[i] && project.assets[i].id === assetId) return project.assets[i];
  }
  return null;
}

/**
 * Canvas preview renderer.
 *
 * Owns one hidden media element per project asset (plus a dedicated looping
 * music element), appended into the supplied host element. `render()` is
 * stateless and safe to call every animation frame: it resolves the current
 * clip at the playhead, seeks/plays only that element, applies per-clip gain,
 * mixes in the music bed with ducking, and paints canvas frames with filters
 * and captions.
 *
 * @param {Element} hostElement preview stage container
 * @param {{ background?: string, loadingText?: string, maxDpr?: number,
 *           readyTimeout?: number, captions?: boolean }} [options]
 */
function PreviewEngine(hostElement, options) {
  this.host = hostElement || null;
  this.options = options || {};
  this.canvas = null;
  this._ctx = null;
  this._lastFrame = null;
  this._lastFrameCtx = null;
  this._cssW = 0;
  this._cssH = 0;
  this._dpr = 1;
  this._pool = new Map();
  this._music = null;
  this._activeAssetId = null;
  this._activeClipId = null;
  this._playing = false;
  this._disposed = false;
  this._warned = false;
  this._bg = typeof this.options.background === 'string' ? this.options.background : '#0b0c0e';
  this._loadingText = typeof this.options.loadingText === 'string' ? this.options.loadingText : '加载中';
  this._resizeRaf = 0;
  this._ro = null;
  this._pendingRedraw = null;
  this._lastProject = null;
  this._lastTime = 0;
  this._lastOpts = null;
  this._initDom();
}

PreviewEngine.prototype._initDom = function () {
  if (typeof document === 'undefined') return;
  var host = this.host;
  if (host && host.style) {
    try {
      var computed = typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(host) : null;
      if (!computed || computed.position === 'static') host.style.position = 'relative';
    } catch (err) {
      /* ignore */
    }
    try {
      if (host.style.overflow !== 'hidden') host.style.overflow = 'hidden';
    } catch (err) {
      /* ignore */
    }
  }
  var canvas = document.createElement('canvas');
  canvas.setAttribute('data-cutline-preview', '1');
  canvas.style.cssText = 'display:block;width:100%;height:100%;position:relative;z-index:1;';
  this.canvas = canvas;
  this._ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
  if (host && host.appendChild) {
    try {
      host.appendChild(canvas);
    } catch (err) {
      /* ignore */
    }
  }
  var self = this;
  if (typeof ResizeObserver !== 'undefined' && host) {
    try {
      this._ro = new ResizeObserver(function () {
        self._onHostResize();
      });
      this._ro.observe(host);
    } catch (err) {
      this._ro = null;
    }
  }
};

PreviewEngine.prototype._onHostResize = function () {
  if (this._disposed) return;
  var self = this;
  if (this._resizeRaf) return;
  var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { return setTimeout(fn, 60); };
  this._resizeRaf = raf(function () {
    self._resizeRaf = 0;
    if (self._disposed) return;
    self._syncSize();
    if (self._lastProject) self._redrawLast();
  });
};

PreviewEngine.prototype._syncSize = function () {
  var width = 0;
  var height = 0;
  var host = this.host;
  if (host) {
    width = host.clientWidth || 0;
    height = host.clientHeight || 0;
    if ((!width || !height) && typeof host.getBoundingClientRect === 'function') {
      var rect = host.getBoundingClientRect();
      width = rect.width || width;
      height = rect.height || height;
    }
  }
  if (!width) width = 640;
  if (!height) height = 360;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  var maxDpr = num(this.options.maxDpr, 2);
  if (maxDpr > 0) dpr = Math.min(dpr, maxDpr);
  if (!(dpr > 0)) dpr = 1;
  if (width !== this._cssW || height !== this._cssH || dpr !== this._dpr) {
    this._cssW = width;
    this._cssH = height;
    this._dpr = dpr;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(width * dpr));
      this.canvas.height = Math.max(1, Math.round(height * dpr));
    }
    this._ensureLastFrame();
  }
  return { width: this._cssW, height: this._cssH, dpr: this._dpr };
};

PreviewEngine.prototype._ensureLastFrame = function () {
  if (!this.canvas) return;
  var width = Math.max(1, this.canvas.width);
  var height = Math.max(1, this.canvas.height);
  if (!this._lastFrame) {
    this._lastFrame = document.createElement('canvas');
    this._lastFrameCtx = this._lastFrame.getContext('2d');
  }
  if (this._lastFrame.width !== width || this._lastFrame.height !== height) {
    this._lastFrame.width = width;
    this._lastFrame.height = height;
  }
};

PreviewEngine.prototype._ensureMusicSync = function (project) {
  var music = project ? project.music : null;
  var asset = music && music.assetId ? findAssetById(project, music.assetId) : null;
  if (!asset) {
    if (this._music) {
      releaseMediaElement(this._music.el);
      this._music = null;
    }
    return null;
  }
  if (this._music && this._music.asset && this._music.asset.id === asset.id) return null;
  if (this._music) releaseMediaElement(this._music.el);
  var el = createHiddenMediaElement(asset);
  el.loop = true;
  this._appendHidden(el, asset);
  this._music = { asset: asset, el: el };
  return this._music;
};

PreviewEngine.prototype._appendHidden = function (el, asset) {
  var host = this.host;
  if (!host || !host.appendChild) return;
  try {
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = HIDDEN_MEDIA_CSS;
    host.appendChild(el);
  } catch (err) {
    /* ignore */
  }
};

PreviewEngine.prototype._createPoolRecord = function (asset) {
  var el = createHiddenMediaElement(asset);
  this._appendHidden(el, asset);
  return { asset: asset, el: el };
};

/**
 * Create media elements for every project asset (idempotent) and wait for the
 * newly created ones to become drawable. Safe to call repeatedly.
 * @param {object} project
 * @returns {Promise<void>}
 */
PreviewEngine.prototype.ensureProject = async function (project) {
  if (this._disposed || !project) return;
  var created = this._ensureSync(project);
  if (!created.length) return;
  var timeout = num(this.options.readyTimeout, 8000);
  var waits = [];
  for (var i = 0; i < created.length; i++) {
    if (created[i] && created[i].el) waits.push(waitReadyTolerant(created[i].el, 2, timeout));
  }
  if (waits.length) await Promise.all(waits);
};

// Internal synchronous element-pool sync; returns newly created records.
PreviewEngine.prototype._ensureSync = function (project) {
  var created = [];
  if (!project || !Array.isArray(project.assets) || typeof document === 'undefined') return created;
  var self = this;
  var ids = {};
  for (var i = 0; i < project.assets.length; i++) {
    var asset = project.assets[i];
    if (!asset || !asset.id) continue;
    ids[asset.id] = true;
    if (!this._pool.has(asset.id)) {
      var record = this._createPoolRecord(asset);
      this._pool.set(asset.id, record);
      created.push(record);
    }
  }
  var stale = [];
  this._pool.forEach(function (record, id) {
    if (!ids[id]) stale.push(id);
  });
  for (var s = 0; s < stale.length; s++) {
    var old = this._pool.get(stale[s]);
    if (old) releaseMediaElement(old.el);
    this._pool.delete(stale[s]);
  }
  var musicRecord = this._ensureMusicSync(project);
  if (musicRecord) created.push(musicRecord);
  return created;
};

PreviewEngine.prototype._releaseAll = function () {
  var self = this;
  this._pool.forEach(function (record) {
    releaseMediaElement(record.el);
  });
  this._pool.clear();
  if (this._music) {
    releaseMediaElement(this._music.el);
    this._music = null;
  }
  this._activeAssetId = null;
  this._activeClipId = null;
};

PreviewEngine.prototype._armRedraw = function (el, events) {
  if (!el || typeof el.addEventListener !== 'function') return;
  var self = this;
  if (this._pendingRedraw && this._pendingRedraw.el === el) return;
  this._disarmRedraw();
  var pending = { el: el, events: events, handler: null };
  pending.handler = function () {
    self._disarmRedraw();
    self._redrawLast();
  };
  for (var i = 0; i < events.length; i++) el.addEventListener(events[i], pending.handler, { once: true });
  pending.timer = setTimeout(function () {
    self._disarmRedraw();
  }, 5000);
  this._pendingRedraw = pending;
};

PreviewEngine.prototype._disarmRedraw = function () {
  var pending = this._pendingRedraw;
  if (!pending) return;
  this._pendingRedraw = null;
  try {
    if (pending.timer) clearTimeout(pending.timer);
  } catch (err) {
    /* ignore */
  }
  try {
    for (var i = 0; i < pending.events.length; i++) pending.el.removeEventListener(pending.events[i], pending.handler);
  } catch (err) {
    /* ignore */
  }
};

PreviewEngine.prototype._redrawLast = function () {
  if (this._disposed || !this._lastProject) return;
  try {
    this.render(this._lastProject, this._lastTime, this._lastOpts || {});
  } catch (err) {
    /* render never throws outward */
  }
};

PreviewEngine.prototype._rememberFrame = function (el) {
  if (!this._lastFrame || !this._lastFrameCtx || !el) return;
  if (!el.videoWidth || !el.videoHeight) return;
  var width = this._lastFrame.width;
  var height = this._lastFrame.height;
  if (!width || !height) return;
  try {
    var ctx = this._lastFrameCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawFit(ctx, el, el.videoWidth, el.videoHeight, width, height, fitModeFor(this._lastProject));
  } catch (err) {
    /* ignore */
  }
};

PreviewEngine.prototype._syncMusic = function (project, time, playing, direction, rate) {
  var record = this._music;
  if (!record || !record.el) return;
  var gain = clamp01(num(engineCall('musicGain', localMusicGain, [project, time]), 0));
  try {
    record.el.volume = gain;
  } catch (err) {
    /* ignore */
  }
  var advancing = playing && direction > 0;
  try {
    // Keep the music bed advancing at the same playback rate as the clips.
    record.el.playbackRate = advancing ? clamp(num(rate, 1), 0.0625, 16) : 1;
  } catch (err) {
    /* ignore */
  }
  var duration = num(record.asset && record.asset.duration, 0);
  var target = duration > 0.05 ? num(time, 0) % duration : 0;
  if (advancing && gain > 0.0005) {
    if (record.el.paused) {
      if (Math.abs(num(record.el.currentTime, 0) - target) > 0.05) safeSeek(record.el, target);
      safePlay(record.el);
    } else if (record.el.readyState >= 1 && Math.abs(num(record.el.currentTime, 0) - target) > 0.45) {
      safeSeek(record.el, target);
    }
  } else {
    safePause(record.el);
    if (record.el.readyState >= 1 && Math.abs(num(record.el.currentTime, 0) - target) > 0.05) safeSeek(record.el, target);
  }
};

PreviewEngine.prototype._syncClip = function (project, hit, playing, direction, rate, skim) {
  var self = this;
  var activeAssetId = hit && hit.entry && hit.entry.asset ? hit.entry.asset.id : null;
  var activeRecord = activeAssetId ? this._pool.get(activeAssetId) : null;
  var activeEl = activeRecord ? activeRecord.el : null;

  this._pool.forEach(function (record) {
    if (record.el && record.el !== activeEl) safePause(record.el);
  });
  if (!activeEl) {
    if (this._music && this._music.el) safePause(this._music.el);
    this._activeAssetId = null;
    this._activeClipId = null;
    return;
  }

  var clip = hit.entry.clip;
  var asset = hit.entry.asset;
  var gain = clamp01(num(engineCall('clipGain', localClipGain, [project, clip]), 0));
  try {
    activeEl.volume = gain;
  } catch (err) {
    /* ignore */
  }

  var sourceTime = clampSourceTime(asset, resolveSourceTime(hit));
  var isSwitch = this._activeAssetId !== activeAssetId || this._activeClipId !== (clip && clip.id);
  this._activeAssetId = activeAssetId;
  this._activeClipId = clip && clip.id;

  if (playing && direction > 0 && !skim) {
    try {
      activeEl.playbackRate = rate;
    } catch (err) {
      /* ignore */
    }
    var drift = activeEl.readyState >= 1 ? Math.abs(num(activeEl.currentTime, 0) - sourceTime) : 0;
    var threshold = isSwitch ? 0.04 : Math.max(0.12, 0.35 * Math.max(1, rate));
    if (drift > threshold) safeSeek(activeEl, sourceTime);
    if (activeEl.paused) safePlay(activeEl);
    if (activeEl.readyState < 2) this._armRedraw(activeEl, ['loadeddata', 'canplay', 'seeked']);
  } else {
    // Paused, skimming, or reverse playback: no native reverse exists, so
    // pause and step currentTime every frame.
    safePause(activeEl);
    var seekThreshold = skim ? 0.04 : direction < 0 ? 0.03 : 0.05;
    var pausedDrift = activeEl.readyState >= 1 ? Math.abs(num(activeEl.currentTime, 0) - sourceTime) : 0;
    if (pausedDrift > seekThreshold) {
      safeSeek(activeEl, sourceTime);
      this._armRedraw(activeEl, ['seeked', 'loadeddata']);
    } else if (activeEl.readyState < 2) {
      this._armRedraw(activeEl, ['loadeddata', 'canplay', 'seeked']);
    }
  }
};

/**
 * Render one preview frame. Never throws.
 * @param {object} project
 * @param {number} time playhead in seconds
 * @param {{ playing?: boolean, direction?: 1|-1, rate?: number, skim?: boolean }} [opts]
 */
PreviewEngine.prototype.render = function (project, time, opts) {
  if (this._disposed) return;
  var options = opts || {};
  this._lastProject = project || null;
  this._lastTime = num(time, 0);
  this._lastOpts = options;
  try {
    if (!this._ctx) return;
    this._ensureSync(project);
    var size = this._syncSize();
    var width = size.width;
    var height = size.height;
    var ctx = this._ctx;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this._bg;
    ctx.fillRect(0, 0, width, height);

    var t = Math.max(0, num(time, 0));
    var hit = engineCall('clipAt', localClipAt, [project, t]);
    var playing = !!options.playing;
    var direction = num(options.direction, 1) < 0 ? -1 : 1;
    var rate = clamp(num(options.rate, 1), 0.0625, 16);
    var skim = !!options.skim;
    var totalDuration = num(engineCall('duration', localDuration, [project]), 0);
    var drewVideo = false;

    if (hit && hit.entry) {
      this._syncClip(project, hit, playing, direction, rate, skim);
      var asset = hit.entry.asset;
      var clip = hit.entry.clip;
      var record = asset ? this._pool.get(asset.id) : null;
      var el = record ? record.el : null;
      if (asset && asset.kind === 'video' && el) {
        var filterCss = filterCssFor(project, clip);
        if (el.readyState >= 2 && el.videoWidth > 0) {
          try {
            ctx.filter = filterCss;
            drawFit(ctx, el, el.videoWidth, el.videoHeight, width, height, fitModeFor(project));
          } finally {
            ctx.filter = 'none';
          }
          drewVideo = true;
          this._rememberFrame(el);
        }
      }
      if (!drewVideo && asset && asset.kind === 'video' && this._lastFrame) {
        var heldFilter = filterCssFor(project, clip);
        try {
          ctx.filter = heldFilter;
          drawFit(ctx, this._lastFrame, this._lastFrame.width, this._lastFrame.height, width, height, fitModeFor(project));
        } finally {
          ctx.filter = 'none';
        }
        drewVideo = true;
      }
      if (!drewVideo && asset && asset.kind === 'video') {
        drawLoadingState(ctx, width, height, this._loadingText);
      }
    } else {
      this._syncClip(project, null, playing, direction, rate, skim);
      if (this._lastFrame && totalDuration > 0 && t >= totalDuration - 0.02) {
        drawFit(ctx, this._lastFrame, this._lastFrame.width, this._lastFrame.height, width, height, fitModeFor(project));
      }
    }

    this._syncMusic(project, t, playing, direction, rate);
    if (this.options.captions !== false) drawCaptionsLayer(ctx, project, t, width, height);
    this._playing = playing;
  } catch (err) {
    if (!this._warned && typeof console !== 'undefined' && console.warn) {
      this._warned = true;
      try {
        console.warn('[cutline] preview render failed:', err);
      } catch (warnErr) {
        /* ignore */
      }
    }
  }
};

/** Pause all preview media elements. */
PreviewEngine.prototype.pause = function () {
  if (this._disposed) return;
  this._playing = false;
  var self = this;
  this._pool.forEach(function (record) {
    safePause(record.el);
  });
  if (this._music) safePause(this._music.el);
  if (self._pendingRedraw) this._disarmRedraw();
};

/** Release every element, observer and canvas reference. Safe to call twice. */
PreviewEngine.prototype.dispose = function () {
  if (this._disposed) return;
  this._disposed = true;
  try {
    this._releaseAll();
  } catch (err) {
    /* ignore */
  }
  if (this._ro) {
    try {
      this._ro.disconnect();
    } catch (err) {
      /* ignore */
    }
    this._ro = null;
  }
  if (this._resizeRaf) {
    try {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._resizeRaf);
      else clearTimeout(this._resizeRaf);
    } catch (err) {
      /* ignore */
    }
    this._resizeRaf = 0;
  }
  this._disarmRedraw();
  if (this.canvas && this.canvas.parentNode) {
    try {
      this.canvas.parentNode.removeChild(this.canvas);
    } catch (err) {
      /* ignore */
    }
  }
  this.canvas = null;
  this._ctx = null;
  this._lastFrame = null;
  this._lastFrameCtx = null;
  this._lastProject = null;
  this._lastOpts = null;
};

/* ------------------------------------------------------------------ */
/* exportProject                                                      */
/* ------------------------------------------------------------------ */

function normalizeExportOptions(options) {
  var out = {};
  var key;
  for (key in DEFAULT_EXPORT) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_EXPORT, key)) out[key] = DEFAULT_EXPORT[key];
  }
  if (options && typeof options === 'object') {
    for (key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) out[key] = options[key];
    }
  }
  return out;
}

/** Resolve [start, end) for export, honoring in/out marks only when both set. */
function exportBounds(project, totalDuration) {
  var total = Math.max(0, num(totalDuration, 0));
  var start = 0;
  var end = total;
  var inPoint = project && typeof project.inPoint === 'number' && isFinite(project.inPoint) ? project.inPoint : null;
  var outPoint = project && typeof project.outPoint === 'number' && isFinite(project.outPoint) ? project.outPoint : null;
  if (inPoint !== null && outPoint !== null && outPoint > inPoint) {
    start = clamp(inPoint, 0, total);
    end = clamp(outPoint, 0, total);
    if (!(end - start > 0.001)) {
      start = 0;
      end = total;
    }
  }
  return { start: start, end: end };
}

function entryAtTime(entries, time) {
  if (!entries) return null;
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry) continue;
    if (time >= entry.start && time < entry.end) {
      return { entry: entry, localTime: time - entry.start, sourceTime: num(entry.clip && entry.clip.in, 0) + (time - entry.start) };
    }
  }
  return null;
}

function buildRecorderOptions(mime, bitrate, options) {
  var recorderOptions = {};
  if (mime) recorderOptions.mimeType = mime;
  var videoBits = num(bitrate, DEFAULT_EXPORT.bitrate);
  if (videoBits > 0) recorderOptions.videoBitsPerSecond = Math.round(videoBits);
  var audioBits = num(options.audioBitrate, DEFAULT_EXPORT.audioBitrate);
  if (audioBits > 0) recorderOptions.audioBitsPerSecond = Math.round(clamp(audioBits, 16000, 320000));
  return recorderOptions;
}

function stopRecorderAsync(recorder, timeoutMs) {
  return new Promise(function (resolve) {
    if (!recorder) {
      resolve();
      return;
    }
    var settled = false;
    var timer = null;
    function cleanup() {
      try {
        recorder.removeEventListener('stop', onStop);
      } catch (err) {
        /* ignore */
      }
      if (timer) clearTimeout(timer);
    }
    function onStop() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }
    try {
      recorder.addEventListener('stop', onStop);
    } catch (err) {
      /* ignore */
    }
    try {
      if (recorder.state !== 'inactive') recorder.stop();
      else onStop();
    } catch (err) {
      onStop();
    }
    timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, Math.max(500, num(timeoutMs, 6000)));
  });
}

function buildExportFilename(project, extension, explicitName) {
  var base = explicitName ? String(explicitName) : project && project.name ? String(project.name) : '';
  base = sanitizeFilename(base);
  if (!base) base = 'cutline';
  var ext = extension || 'webm';
  if (explicitName && /\.(webm|mp4|mov|ogv)$/i.test(base)) return base;
  return base + '-' + timestampForFilename() + '.' + ext;
}

/**
 * Lazily derive 800 audio peaks for an asset when `decodeAudioData` could not
 * handle its container (some MP4/MOV/AAC combinations). The media element is
 * played through an AnalyserNode at an accelerated playback rate, so the energy
 * envelope is captured without a server-side decode. Returns null when audio is
 * unavailable or blocked.
 *
 * @param {object} asset Asset object with `url`, `kind`, `duration`.
 * @param {{ host?: Element, rate?: number, maxSeconds?: number, timeoutMs?: number }} [options]
 * @returns {Promise<number[]|null>}
 */
async function analyzeAssetAudio(asset, options) {
  if (!asset || !asset.url || typeof document === 'undefined') return null;
  if (Array.isArray(asset.peaks) && asset.peaks.length) return asset.peaks;
  var duration = num(asset.duration, 0);
  if (!(duration > 0)) return null;
  var opts = options || {};
  var AudioCtx =
    typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!AudioCtx) return null;
  var rafRequest =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : function (fn) { return setTimeout(fn, 16); };
  var rafCancel =
    typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : function (id) { clearTimeout(id); };

  var el = null;
  var ctx = null;
  var source = null;
  var analyser = null;
  var sink = null;
  var host = null;
  var appended = false;
  try {
    el = createHiddenMediaElement(asset);
    el.muted = false;
    el.volume = 1;
    host = opts.host && opts.host.appendChild ? opts.host : document.documentElement;
    if (host) {
      host.appendChild(el);
      appended = true;
    }
    await waitForMetadata(el, num(opts.timeoutMs, 20000));

    ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (resumeErr) {
        /* an analyser on a suspended context returns silence */
      }
    }
    source = ctx.createMediaElementSource(el);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    sink = ctx.createGain();
    sink.gain.value = 0; // silent sink keeps the analyser graph alive
    source.connect(analyser);
    analyser.connect(sink);
    sink.connect(ctx.destination);

    var rate = clamp(num(opts.rate, duration > 120 ? 16 : 8), 1, 16);
    try {
      el.playbackRate = rate;
    } catch (rateErr) {
      /* ignore */
    }

    var buffer = new Uint8Array(analyser.fftSize);
    var samples = [];
    var started = wallClock();
    var maxRealSeconds = clamp(num(opts.maxSeconds, 45), 3, 120);

    await new Promise(function (resolve) {
      var done = false;
      var raf = 0;
      var timeoutId = 0;
      function finish() {
        if (done) return;
        done = true;
        if (raf) rafCancel(raf);
        if (timeoutId) window.clearTimeout(timeoutId);
        resolve();
      }
      function frame() {
        if (done) return;
        if (el && el.readyState >= 2) {
          try {
            analyser.getByteTimeDomainData(buffer);
            var sum = 0;
            for (var i = 0; i < buffer.length; i += 1) {
              var value = (buffer[i] - 128) / 128;
              sum += value * value;
            }
            var rms = Math.sqrt(sum / buffer.length);
            var at = clamp(num(el.currentTime, 0), 0, duration);
            samples.push({ time: at, value: clamp(rms * 2.6, 0, 1) });
          } catch (readErr) {
            /* ignore a bad analyser frame */
          }
        }
        var elapsed = (wallClock() - started) / 1000;
        if (
          (el && el.ended) ||
          (el && num(el.currentTime, 0) >= duration - 0.05) ||
          elapsed > maxRealSeconds
        ) {
          finish();
          return;
        }
        raf = rafRequest(frame);
      }
      el.addEventListener('ended', finish);
      el.play().then(
        function () {
          raf = rafRequest(frame);
        },
        function () {
          finish();
        },
      );
      timeoutId = window.setTimeout(finish, (maxRealSeconds + 5) * 1000);
    });

    if (!samples.length) return null;
    var points = 800;
    var peaks = new Array(points).fill(0);
    for (var sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      var sample = samples[sampleIndex];
      var position = clamp(Math.floor((sample.time / duration) * (points - 1)), 0, points - 1);
      if (sample.value > peaks[position]) peaks[position] = sample.value;
    }
    var previous = 0;
    for (var index = 0; index < points; index += 1) {
      if (peaks[index] < 0.015) peaks[index] = previous * 0.55;
      else previous = peaks[index];
    }
    var loudest = 0;
    for (var loudIndex = 0; loudIndex < points; loudIndex += 1) {
      if (peaks[loudIndex] > loudest) loudest = peaks[loudIndex];
    }
    return loudest > 0.02 ? peaks : null;
  } catch (error) {
    return null;
  } finally {
    try {
      if (el) {
        safePause(el);
        releaseMediaElement(el);
      }
    } catch (cleanupErr) {
      /* ignore */
    }
    try {
      if (source) source.disconnect();
      if (analyser) analyser.disconnect();
      if (sink) sink.disconnect();
    } catch (disconnectErr) {
      /* ignore */
    }
    try {
      if (ctx) await ctx.close();
    } catch (closeErr) {
      /* ignore */
    }
    if (appended && el && el.parentNode) {
      try {
        el.parentNode.removeChild(el);
      } catch (removeErr) {
        /* ignore */
      }
    }
  }
}

/**
 * Render the whole timeline in real time to an offscreen canvas and record it
 * together with a WebAudio mix of clip audio and the music bed.
 *
 * Cancellation: throws `Error('export-cancelled')` after full cleanup; query
 * `callbacks.isCancelled()` once per frame.
 *
 * @param {object} project
 * @param {object} [options] width, height, fps, bitrate, includeCaptions,
 *   includeMusic, audioBitrate, host, filename
 * @param {{ onProgress?: (p:number)=>void, onPhase?: (phase:string)=>void,
 *           isCancelled?: ()=>boolean }} [callbacks]
 *   onPhase receives stable keys: 'preparing' | 'recording' | 'finalizing'.
 * @returns {Promise<{ blob: Blob, mime: string, filename: string,
 *           width: number, height: number, duration: number }>}
 */
async function exportProject(project, options, callbacks) {
  var opts = normalizeExportOptions(options);
  var hooks = callbacks || {};
  var rawProgress = typeof hooks.onProgress === 'function' ? hooks.onProgress : noop;
  var rawPhase = typeof hooks.onPhase === 'function' ? hooks.onPhase : noop;
  var rawCancelled = typeof hooks.isCancelled === 'function' ? hooks.isCancelled : function () { return false; };

  function reportProgress(value) {
    try {
      rawProgress(clamp01(value));
    } catch (err) {
      /* ignore */
    }
  }
  function reportPhase(phase) {
    try {
      rawPhase(phase);
    } catch (err) {
      /* ignore */
    }
  }
  function isCancelled() {
    try {
      return !!rawCancelled();
    } catch (err) {
      return false;
    }
  }

  /**
   * Await a promise while polling `isCancelled()` so "cancel" reacts promptly
   * during media preparation (which can take seconds for large files).
   */
  function waitUnlessCancelled(promise) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var poll = setInterval(function () {
        if (settled) return;
        if (isCancelled()) {
          settled = true;
          clearInterval(poll);
          reject(makeCancelError());
        }
      }, 150);
      promise.then(
        function (value) {
          if (settled) return;
          settled = true;
          clearInterval(poll);
          resolve(value);
        },
        function (err) {
          if (settled) return;
          settled = true;
          clearInterval(poll);
          reject(err);
        }
      );
    });
  }

  var support = probeExportSupport();
  if (!support.supported) throw makeError('export-unsupported', 'MediaRecorder or canvas.captureStream is unavailable');
  if (typeof document === 'undefined') throw makeError('export-unsupported', 'document is unavailable');

  var projectDuration = num(engineCall('duration', localDuration, [project]), 0);
  var bounds = exportBounds(project, projectDuration);
  var span = bounds.end - bounds.start;
  if (!(span > 0.02)) throw makeError('export-empty', 'timeline has nothing to export');

  var width = Math.round(clamp(num(opts.width, DEFAULT_EXPORT.width), 64, 4096));
  var height = Math.round(clamp(num(opts.height, DEFAULT_EXPORT.height), 64, 4096));
  var fps = Math.round(clamp(num(opts.fps, DEFAULT_EXPORT.fps), 1, 60));
  var bitrate = Math.round(clamp(num(opts.bitrate, DEFAULT_EXPORT.bitrate), 200000, 50000000));
  var includeCaptions = opts.includeCaptions !== false;
  var includeMusic = opts.includeMusic !== false;
  var loadTimeout = Math.round(clamp(num(opts.loadTimeout, 15000), 1000, 120000));

  var canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  var ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
  if (!ctx) throw makeError('export-canvas-failed', '2d canvas context unavailable');

  var lastFrameCanvas = document.createElement('canvas');
  lastFrameCanvas.width = width;
  lastFrameCanvas.height = height;
  var lastFrameCtx = lastFrameCanvas.getContext('2d');
  var hasHeldFrame = false;

  var container = document.createElement('div');
  container.setAttribute('data-cutline-export', '1');
  container.style.cssText = 'position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  var attachHost = opts.host && opts.host.appendChild ? opts.host : null;
  if (attachHost) {
    try {
      attachHost.appendChild(container);
    } catch (err) {
      attachHost = null;
    }
  }

  var mediaRecords = new Map();
  var musicRecord = null;
  var audioCtx = null;
  var audioDest = null;
  var stream = null;
  var recorder = null;
  var recorderError = null;
  var chunks = [];
  var rafHandle = 0;
  var timerHandle = 0;
  var disposed = false;
  var entries = [];
  var activeKey = null;

  function createRecord(asset) {
    var el = createHiddenMediaElement(asset);
    try {
      container.appendChild(el);
    } catch (err) {
      /* ignore */
    }
    return { asset: asset, el: el };
  }

  function attachAudio(record, key) {
    if (!audioCtx || !audioDest || !record || !record.el) return;
    try {
      var source = audioCtx.createMediaElementSource(record.el);
      var gain = audioCtx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(audioDest);
      record.source = source;
      record.gain = gain;
      record.audioKey = key;
      try {
        record.el.volume = 1;
      } catch (err) {
        /* ignore */
      }
    } catch (err) {
      // Could not route the element: keep it silent so export never blares
      // audio from the detached elements.
      try {
        record.el.muted = true;
      } catch (muteErr) {
        /* ignore */
      }
    }
  }

  function setRecordGain(record, value) {
    if (!record) return;
    var gainValue = clamp01(value);
    if (record.gain) {
      try {
        var param = record.gain.gain;
        // Smooth tiny ramps so ducking / clip changes don't click in the mix.
        if (audioCtx && param && typeof param.setTargetAtTime === 'function' && typeof audioCtx.currentTime === 'number') {
          param.setTargetAtTime(gainValue, audioCtx.currentTime, 0.015);
        } else {
          param.value = gainValue;
        }
      } catch (err) {
        try {
          record.gain.gain.value = gainValue;
        } catch (innerErr) {
          /* ignore */
        }
      }
    } else if (record.el) {
      try {
        record.el.volume = gainValue;
      } catch (err) {
        /* ignore */
      }
    }
  }

  function drawFrame(time) {
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, width, height);

      var hit = entryAtTime(entries, time);
      var drew = false;
      if (hit) {
        var asset = hit.entry.asset;
        var clip = hit.entry.clip;
        var record = asset ? mediaRecords.get(asset.id) : null;
        var filterCss = filterCssFor(project, clip);
        if (asset && asset.kind === 'video' && record && record.el && record.el.readyState >= 2 && record.el.videoWidth > 0) {
          try {
            ctx.filter = filterCss;
            drawFit(ctx, record.el, record.el.videoWidth, record.el.videoHeight, width, height, fitModeFor(project));
          } finally {
            ctx.filter = 'none';
          }
          drew = true;
          if (lastFrameCtx) {
            try {
              lastFrameCtx.setTransform(1, 0, 0, 1, 0, 0);
              lastFrameCtx.clearRect(0, 0, width, height);
              drawFit(lastFrameCtx, record.el, record.el.videoWidth, record.el.videoHeight, width, height, fitModeFor(project));
              hasHeldFrame = true;
            } catch (err) {
              /* ignore */
            }
          }
        }
      } else if (time >= bounds.end - 0.02 && hasHeldFrame) {
        try {
          ctx.drawImage(lastFrameCanvas, 0, 0, width, height);
        } catch (err) {
          /* ignore */
        }
        drew = true;
      }
      if (!drew && hit && hit.entry.asset && hit.entry.asset.kind === 'video' && hasHeldFrame) {
        // Hold the previous decoded frame while the next clip seeks.
        try {
          ctx.drawImage(lastFrameCanvas, 0, 0, width, height);
        } catch (err) {
          /* ignore */
        }
      }
      if (includeCaptions) drawCaptionsLayer(ctx, project, time, width, height);
    } catch (err) {
      /* a frame must never abort the export */
    }
  }

  function scheduleNext(fn) {
    // requestAnimationFrame for smooth pacing, with a timer fallback so an
    // export never stalls forever if rAF is throttled (hidden/background tab).
    var done = false;
    var rafId = 0;
    var timerId = 0;
    function once() {
      if (done) return;
      done = true;
      try {
        if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      } catch (err) {
        /* ignore */
      }
      if (timerId) {
        try {
          clearTimeout(timerId);
        } catch (err) {
          /* ignore */
        }
      }
      rafId = 0;
      timerId = 0;
      fn();
    }
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(once);
      timerId = setTimeout(function () {
        if (done) return;
        if (rafId && typeof cancelAnimationFrame === 'function') {
          try {
            cancelAnimationFrame(rafId);
          } catch (err) {
            /* ignore */
          }
        }
        rafId = 0;
        once();
      }, Math.max(250, Math.round(4000 / Math.max(1, fps))));
    } else {
      timerId = setTimeout(once, Math.max(8, Math.round(1000 / Math.max(1, fps))));
    }
    rafHandle = rafId;
    timerHandle = timerId;
  }

  function syncPlayback(time, atEnd) {
    var hit = atEnd ? null : entryAtTime(entries, time);
    var wantedId = hit ? hit.entry.asset.id : null;

    mediaRecords.forEach(function (record, assetId) {
      if (!record.el) return;
      if (atEnd || assetId !== wantedId) setRecordGain(record, 0);
      if (atEnd || assetId !== wantedId) safePause(record.el);
    });

    if (hit) {
      var record = mediaRecords.get(wantedId);
      if (record && record.el) {
        var clip = hit.entry.clip;
        var asset = hit.entry.asset;
        var gain = clamp01(num(engineCall('clipGain', localClipGain, [project, clip]), 0));
        setRecordGain(record, gain);
        var target = clampSourceTime(asset, num(hit.entry.clip && hit.entry.clip.in, 0) + num(hit.localTime, 0));
        var changed = activeKey !== wantedId;
        activeKey = wantedId;
        var drift = record.el.readyState >= 1 ? Math.abs(num(record.el.currentTime, 0) - target) : 0;
        if (record.el.paused) {
          if (drift > 0.02) {
            safeSeek(record.el, target);
          }
          safePlay(record.el);
        } else if (drift > (changed ? 0.12 : 0.3)) {
          safeSeek(record.el, target);
        }
      }
    } else {
      activeKey = null;
    }

    if (musicRecord && musicRecord.el) {
      var musicEl = musicRecord.el;
      var musicGainValue = includeMusic ? clamp01(num(engineCall('musicGain', localMusicGain, [project, time]), 0)) : 0;
      setRecordGain(musicRecord, musicGainValue);
      if (atEnd) {
        safePause(musicEl);
      } else {
        var musicDuration = num(musicRecord.asset && musicRecord.asset.duration, 0);
        var musicTarget = musicDuration > 0.05 ? time % musicDuration : 0;
        var musicDrift = Math.abs(num(musicEl.currentTime, 0) - musicTarget);
        if (musicEl.paused) {
          if (musicDrift > 0.05) safeSeek(musicEl, musicTarget);
          safePlay(musicEl);
        } else if (musicDrift > 0.5) {
          safeSeek(musicEl, musicTarget);
        }
      }
    }
  }

  async function cleanup() {
    disposed = true;
    if (rafHandle) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafHandle);
      } catch (err) {
        /* ignore */
      }
      rafHandle = 0;
    }
    if (timerHandle) {
      try {
        clearTimeout(timerHandle);
      } catch (err) {
        /* ignore */
      }
      timerHandle = 0;
    }
    if (recorder) {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch (err) {
        /* ignore */
      }
    }
    if (stream) {
      try {
        stream.getTracks().forEach(function (track) {
          try {
            track.stop();
          } catch (err) {
            /* ignore */
          }
        });
      } catch (err) {
        /* ignore */
      }
    }
    if (audioDest) {
      try {
        audioDest.stream.getTracks().forEach(function (track) {
          try {
            track.stop();
          } catch (err) {
            /* ignore */
          }
        });
      } catch (err) {
        /* ignore */
      }
    }
    mediaRecords.forEach(function (record) {
      try {
        if (record.source) record.source.disconnect();
      } catch (err) {
        /* ignore */
      }
      try {
        if (record.gain) record.gain.disconnect();
      } catch (err) {
        /* ignore */
      }
      releaseMediaElement(record.el);
    });
    if (musicRecord) {
      try {
        if (musicRecord.source) musicRecord.source.disconnect();
      } catch (err) {
        /* ignore */
      }
      try {
        if (musicRecord.gain) musicRecord.gain.disconnect();
      } catch (err) {
        /* ignore */
      }
      releaseMediaElement(musicRecord.el);
    }
    mediaRecords.clear();
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch (err) {
        /* ignore */
      }
    }
    if (container.parentNode) {
      try {
        container.parentNode.removeChild(container);
      } catch (err) {
        /* ignore */
      }
    }
  }

  try {
    reportPhase('preparing');
    reportProgress(0);

    var timelineEntries = engineCall('timeline', localTimeline, [project]) || [];
    for (var e = 0; e < timelineEntries.length; e++) {
      var candidate = timelineEntries[e];
      if (!candidate || !candidate.asset || !candidate.asset.id) continue;
      if (!(candidate.end > bounds.start + 1e-6)) continue;
      if (!(candidate.start < bounds.end - 1e-6)) continue;
      entries.push(candidate);
    }
    var usedIds = {};
    for (var u = 0; u < entries.length; u++) {
      var id = entries[u].asset.id;
      if (usedIds[id]) continue;
      usedIds[id] = true;
      mediaRecords.set(id, createRecord(entries[u].asset));
    }
    var musicAsset = includeMusic ? findAssetById(project, project && project.music ? project.music.assetId : null) : null;
    if (musicAsset) {
      musicRecord = createRecord(musicAsset);
      try {
        musicRecord.el.loop = true;
      } catch (err) {
        /* ignore */
      }
    }

    var waits = [];
    mediaRecords.forEach(function (record) {
      waits.push(waitReadyTolerant(record.el, 2, loadTimeout));
    });
    if (musicRecord) waits.push(waitReadyTolerant(musicRecord.el, 1, loadTimeout));
    if (waits.length) await waitUnlessCancelled(Promise.all(waits));
    if (isCancelled()) throw makeCancelError();

    audioCtx = createAudioContext();
    if (audioCtx) {
      try {
        if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') await audioCtx.resume();
      } catch (err) {
        /* resume may need a user gesture; MediaRecorder still records video */
      }
      try {
        audioDest = audioCtx.createMediaStreamDestination();
      } catch (err) {
        audioDest = null;
      }
      if (audioDest) {
        mediaRecords.forEach(function (record, assetId) {
          attachAudio(record, 'clip:' + assetId);
        });
        if (musicRecord) attachAudio(musicRecord, 'music');
      }
    }
    if (!audioDest) {
      // Video-only export: mute elements so nothing leaks to the speakers.
      mediaRecords.forEach(function (record) {
        try {
          if (record.el) record.el.muted = true;
        } catch (err) {
          /* ignore */
        }
      });
      if (musicRecord && musicRecord.el) {
        try {
          musicRecord.el.muted = true;
        } catch (err) {
          /* ignore */
        }
      }
    }

    if (isCancelled()) throw makeCancelError();

    var firstHit = entryAtTime(entries, bounds.start);
    if (firstHit && firstHit.entry.asset && firstHit.entry.asset.kind === 'video') {
      var firstRecord = mediaRecords.get(firstHit.entry.asset.id);
      if (firstRecord && firstRecord.el) {
        await waitUnlessCancelled(seekElement(firstRecord.el, clampSourceTime(firstHit.entry.asset, firstHit.sourceTime), 2500));
      }
    }
    drawFrame(bounds.start);
    if (isCancelled()) throw makeCancelError();

    if (typeof canvas.captureStream !== 'function') throw makeError('export-unsupported', 'canvas.captureStream unavailable');
    try {
      stream = canvas.captureStream(fps);
    } catch (err) {
      throw makeError('export-unsupported', 'canvas.captureStream failed');
    }
    if (audioDest) {
      try {
        audioDest.stream.getAudioTracks().forEach(function (track) {
          stream.addTrack(track);
        });
      } catch (err) {
        /* ignore */
      }
    }

    try {
      recorder = new MediaRecorder(stream, buildRecorderOptions(support.mime, bitrate, opts));
    } catch (err) {
      try {
        recorder = new MediaRecorder(stream);
      } catch (fallbackErr) {
        throw makeError('export-recorder-failed', 'unable to create MediaRecorder');
      }
    }
    recorder.ondataavailable = function (event) {
      if (event && event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = function (event) {
      recorderError = (event && event.error) || makeError('export-recorder-error', 'recording error');
    };
    try {
      recorder.start(400);
    } catch (err) {
      throw makeError('export-recorder-failed', 'unable to start MediaRecorder');
    }
    reportPhase('recording');

    var startWall = wallClock();
    var lastReportedProgress = -1;
    await new Promise(function (resolve, reject) {
      function frame() {
        if (disposed) {
          reject(makeCancelError());
          return;
        }
        if (isCancelled()) {
          reject(makeCancelError());
          return;
        }
        if (recorderError) {
          reject(recorderError);
          return;
        }
        var elapsed = (wallClock() - startWall) / 1000;
        var boundedElapsed = Math.min(elapsed, span);
        var time = bounds.start + boundedElapsed;
        var atEnd = elapsed >= span;
        syncPlayback(time, atEnd);
        drawFrame(atEnd ? bounds.end : time);
        var progress = span > 0 ? clamp01(boundedElapsed / span) : 1;
        if (progress - lastReportedProgress >= 0.004 || progress >= 1) {
          lastReportedProgress = progress;
          reportProgress(progress);
        }
        if (elapsed >= span + EXPORT_TAIL_SECONDS) {
          resolve();
          return;
        }
        scheduleNext(frame);
      }
      scheduleNext(frame);
    });

    if (recorderError) throw recorderError;
    reportPhase('finalizing');
    reportProgress(0.99);

    var mime = (recorder && recorder.mimeType) || support.mime || 'video/webm';
    await stopRecorderAsync(recorder, num(opts.stopTimeout, 6000));
    var blobType = String(mime).split(';')[0] || 'video/webm';
    var blob = new Blob(chunks, { type: blobType });
    var extension = extensionForMime(mime);
    var filename = buildExportFilename(project, extension, opts.filename);
    reportProgress(1);

    return {
      blob: blob,
      mime: mime,
      filename: filename,
      width: width,
      height: height,
      duration: roundTo(span, 3),
    };
  } finally {
    await cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* support probe / download / formatting                              */
/* ------------------------------------------------------------------ */

/**
 * Detect the best recording MIME type the current browser supports.
 * @returns {{ mime: string, extension: string, supported: boolean }}
 */
function probeExportSupport() {
  var unsupported = { mime: '', extension: '', supported: false };
  if (typeof MediaRecorder === 'undefined') return unsupported;
  var canvasCanCapture =
    typeof HTMLCanvasElement !== 'undefined' &&
    HTMLCanvasElement.prototype &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (!canvasCanCapture) return unsupported;
  var canCheck = typeof MediaRecorder.isTypeSupported === 'function';
  if (!canCheck) {
    // Very old implementations: assume the default WebM type works.
    return { mime: EXPORT_CANDIDATES[0].mime, extension: EXPORT_CANDIDATES[0].extension, supported: true };
  }
  for (var i = 0; i < EXPORT_CANDIDATES.length; i++) {
    var candidate = EXPORT_CANDIDATES[i];
    try {
      if (MediaRecorder.isTypeSupported(candidate.mime)) {
        return { mime: candidate.mime, extension: candidate.extension, supported: true };
      }
    } catch (err) {
      /* ignore malformed candidate */
    }
  }
  return unsupported;
}

/**
 * Trigger a browser download for a Blob without touching document.body.
 * @param {Blob} blob
 * @param {string} filename
 */
function download(blob, filename) {
  if (!blob || typeof document === 'undefined') return;
  var name = filename || 'cutline-export';
  var url = null;
  try {
    url = URL.createObjectURL(blob);
  } catch (err) {
    return;
  }
  var clicked = false;
  try {
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    // A detached anchor click avoids appending anything to document.body.
    if (typeof anchor.click === 'function') {
      anchor.click();
      clicked = true;
    }
  } catch (err) {
    clicked = false;
  }
  if (!clicked && typeof window !== 'undefined' && window.open) {
    try {
      window.open(url, '_blank');
    } catch (err) {
      /* ignore */
    }
  }
  setTimeout(function () {
    try {
      URL.revokeObjectURL(url);
    } catch (err) {
      /* ignore */
    }
  }, 30000);
}

/**
 * Human readable byte size, e.g. "1.5 KB", "12 MB".
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  var value = Number(bytes);
  if (!isFinite(value) || value <= 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value = value / 1024;
    index++;
  }
  if (index === 0) return String(Math.round(value)) + ' B';
  return value.toFixed(value < 10 ? 1 : 0) + ' ' + units[index];
}

/**
 * Short duration label: "1:23", or "1:02:03" for >= 1 hour.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  var total = Math.max(0, Math.floor(num(seconds, 0)));
  var hours = Math.floor(total / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  var secs = total % 60;
  if (hours > 0) return hours + ':' + pad2(minutes) + ':' + pad2(secs);
  return minutes + ':' + pad2(secs);
}

module.exports = {
  loadAsset: loadAsset,
  PreviewEngine: PreviewEngine,
  exportProject: exportProject,
  analyzeAssetAudio: analyzeAssetAudio,
  probeExportSupport: probeExportSupport,
  download: download,
  formatBytes: formatBytes,
  formatDuration: formatDuration,
};
