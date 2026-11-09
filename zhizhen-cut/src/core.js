/**
 * Shared client-side core for the Cutline workbench: the editor store, the
 * React subscription hook, the locale bridge, the icon set, and small host-like
 * UI primitives. Every other Cutline module requires this file.
 *
 * CommonJS, browser-only. No Harness Client packages are imported.
 */
const React = require('react');
const engine = require('./engine');

const h = React.createElement;

/** Package id used for tagging logs and DOM. */
const PACKAGE_ID = 'zhizhen-cut';

/* ------------------------------------------------------------------ */
/* Locale bridge                                                       */
/* ------------------------------------------------------------------ */

let translator = null;

/** @param {(key: string, params?: object) => string} fn */
function setTranslator(fn) {
  translator = typeof fn === 'function' ? fn : null;
}

const FALLBACK_ZH = {
  'entry.label': '剪辑',
  'entry.title': '打开切线视频工作台（⌥C）',
  'app.title': '切线 Cutline',
  'app.badge': '会话工作台',
  'app.export': '导出',
  'app.import': '导入媒体',
  'app.ai': 'AI 工具',
  'app.effects': '效果',
  'app.color': '调色',
  'app.audio': '混音',
  'app.captions': '字幕',
  'app.shortcuts': '快捷键',
  'app.close': '收起工作台',
  'app.project': '未命名项目',
  'app.clips': '{count} 个片段',
  'app.emptyProject': '空白项目',
  'app.stage': '节目监视器',
  'app.previewProxy': '代理预览',
  'app.original': '原始画质',
  'app.play': '播放（空格）',
  'app.pause': '暂停（空格）',
  'app.stepBack': '后退一帧（←）',
  'app.stepForward': '前进一帧（→）',
  'app.back1s': '后退 1 秒（J）',
  'app.forward1s': '前进 1 秒（L）',
  'app.markIn': '设置入点（I）',
  'app.markOut': '设置出点（O）',
  'app.clearMarks': '清除入/出点',
  'app.in': '入点',
  'app.out': '出点',
  'app.range': '导出范围',
  'app.fullRange': '整条时间线',
  'app.sessionHint': '从会话进入 · Esc 返回会话',
  'app.closeDrawer': '关闭面板',
};

/** Translate a key; falls back to the Chinese dictionary, then the key. */
function t(key, params) {
  let value = translator ? translator(key) : key;
  if ((value === key || value == null) && Object.prototype.hasOwnProperty.call(FALLBACK_ZH, key)) {
    value = FALLBACK_ZH[key];
  }
  if (value == null) value = key;
  if (params) {
    value = String(value).replace(/\{(\w+)\}/g, (match, name) =>
      params[name] == null ? match : String(params[name]),
    );
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Editor store                                                        */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 120;
const COALESCE_MS = 900;

const store = {
  open: false,
  project: engine.createProject(),
  version: 0,
  listeners: new Set(),
  history: [],
  index: -1,
  lastKey: null,
  lastAt: 0,

  init() {
    this.history = [this.project];
    this.index = 0;
    return this;
  },

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },

  notify() {
    this.version += 1;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (error) {
        if (typeof console !== 'undefined') console.error(`${PACKAGE_ID}: store listener failed`, error);
      }
    }
  },

  setOpen(next) {
    const value = Boolean(next);
    if (this.open === value) return;
    this.open = value;
    this.notify();
  },

  openWorkbench() {
    this.setOpen(true);
  },

  closeWorkbench() {
    this.setOpen(false);
  },

  /**
   * Apply an immutable project operation.
   * @param {(project: object) => object} updater
   * @param {{ history?: boolean, coalesceKey?: string }} [options]
   */
  update(updater, options) {
    const opts = options || {};
    const next = typeof updater === 'function' ? updater(this.project) : updater;
    if (!next || next === this.project) return this.project;

    if (opts.history !== false) {
      const now = Date.now();
      const coalesce = Boolean(
        opts.coalesceKey &&
          this.lastKey === opts.coalesceKey &&
          now - this.lastAt < COALESCE_MS &&
          this.index >= 0,
      );
      if (coalesce) {
        this.history[this.index] = next;
      } else {
        this.history = this.history.slice(0, this.index + 1);
        this.history.push(next);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.index = this.history.length - 1;
      }
      this.lastKey = opts.coalesceKey || null;
      this.lastAt = now;
    }

    this.project = next;
    this.notify();
    return next;
  },

  /** Store the playhead without publishing a render (playback ticks use this). */
  setPlayheadSilent(seconds) {
    const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.project = Object.assign({}, this.project, { playhead: value });
  },

  canUndo() {
    return this.index > 0;
  },

  canRedo() {
    return this.index >= 0 && this.index < this.history.length - 1;
  },

  undo() {
    if (!this.canUndo()) return false;
    this.index -= 1;
    this.project = this.history[this.index];
    this.lastKey = null;
    this.notify();
    return true;
  },

  redo() {
    if (!this.canRedo()) return false;
    this.index += 1;
    this.project = this.history[this.index];
    this.lastKey = null;
    this.notify();
    return true;
  },

  resetProject() {
    this.project = engine.createProject();
    this.history = [this.project];
    this.index = 0;
    this.lastKey = null;
    this.notify();
  },
};

store.init();

/** Re-render a component whenever the store publishes a new version. */
function useStore() {
  const [, force] = React.useState(0);
  React.useEffect(
    () =>
      store.subscribe(() => {
        force((value) => value + 1);
      }),
    [],
  );
  return store;
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad2(value) {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds + 0.0001);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${minutes}:${pad2(secs)}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, exp)).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function basenameWithoutExtension(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

function selectedClip(project) {
  if (!project || !project.selectedClipId) return null;
  return project.clips.find((clip) => clip.id === project.selectedClipId) || null;
}

/* ------------------------------------------------------------------ */
/* Icon set                                                            */
/* ------------------------------------------------------------------ */

function Svg(props) {
  const { size, children, viewBox, ...rest } = props;
  return h(
    'svg',
    Object.assign(
      {
        viewBox: viewBox || '0 0 24 24',
        width: size || 16,
        height: size || 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      rest,
    ),
    children,
  );
}

function IconClapper(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M3 7.5h18v12.5H3z', rx: 2 }),
    h('path', { d: 'M3 7.5 5.4 3.6M9.2 7.5 11.6 3.6M15.4 7.5 17.8 3.6M20.6 7.5 23 3.6' }),
    h('path', { d: 'M8.2 13.4v4.4M8.2 13.4l3.2 2.2-3.2 2.2z' }),
    h('path', { d: 'M14.3 16.1h3.4' }),
  );
}

function IconSparkle(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z' }),
    h('path', { d: 'M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' }),
  );
}

function IconWand(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M4 20 16 8' }),
    h('path', { d: 'M14.5 4.5 16 3l1.5 1.5L19 3l1 1-1.5 1.5L20 7l-1 1-1.5-1.5L16 8z' }),
    h('path', { d: 'M5 4v3M3.5 5.5h3M17 16v3M15.5 17.5h3' }),
  );
}

function IconSliders(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M4 7h7M15 7h5M4 17h3M11 17h9' }),
    h('circle', { cx: 13, cy: 7, r: 2 }),
    h('circle', { cx: 9, cy: 17, r: 2 }),
  );
}

function IconWave(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h-1' }),
  );
}

function IconCC(props) {
  return h(
    Svg,
    props,
    h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
    h('path', { d: 'M9.5 10.4a2.4 2.4 0 1 0 0 3.2M17 10.4a2.4 2.4 0 1 0 0 3.2' }),
  );
}

function IconUpload(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M12 16V4M8 8l4-4 4 4' }),
    h('path', { d: 'M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3' }),
  );
}

function IconPlay(props) {
  return h(Svg, props, h('path', { d: 'M8 5.5v13l10-6.5z', fill: 'currentColor' }));
}

function IconPause(props) {
  return h(Svg, props, h('rect', { x: 7, y: 5, width: 3.4, height: 14, rx: 1, fill: 'currentColor' }),
    h('rect', { x: 13.6, y: 5, width: 3.4, height: 14, rx: 1, fill: 'currentColor' }));
}

function IconStepBack(props) {
  return h(Svg, props, h('path', { d: 'M17 6v12L9 12z', fill: 'currentColor' }), h('path', { d: 'M7 6v12' }));
}

function IconStepForward(props) {
  return h(Svg, props, h('path', { d: 'M7 6v12l8-6z', fill: 'currentColor' }), h('path', { d: 'M17 6v12' }));
}

function IconScissors(props) {
  return h(
    Svg,
    props,
    h('circle', { cx: 6.5, cy: 6.5, r: 2.5 }),
    h('circle', { cx: 6.5, cy: 17.5, r: 2.5 }),
    h('path', { d: 'M20 4 8.6 15.4M20 20 8.6 8.6' }),
  );
}

function IconUndo(props) {
  return h(Svg, props, h('path', { d: 'M9 7H5v-4' }), h('path', { d: 'M5 7a8 8 0 1 1-1 8' }));
}

function IconRedo(props) {
  return h(Svg, props, h('path', { d: 'M15 7h4v-4' }), h('path', { d: 'M19 7a8 8 0 1 0 1 8' }));
}

function IconExport(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M12 15V3M8 7l4-4 4 4' }),
    h('path', { d: 'M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5' }),
  );
}

function IconClose(props) {
  return h(Svg, props, h('path', { d: 'M6 6l12 12M18 6 6 18' }));
}

function IconPlus(props) {
  return h(Svg, props, h('path', { d: 'M12 5v14M5 12h14' }));
}

function IconTrash(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13' }),
    h('path', { d: 'M10 11v5M14 11v5' }),
  );
}

function IconMusic(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M9 18V6l10-2v12' }),
    h('circle', { cx: 6.5, cy: 18, r: 2.5 }),
    h('circle', { cx: 16.5, cy: 16, r: 2.5 }),
  );
}

function IconCheck(props) {
  return h(Svg, props, h('path', { d: 'M5 12.5 9.5 17 19 6.5' }));
}

function IconKeyboard(props) {
  return h(
    Svg,
    props,
    h('rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2.5 }),
    h('path', { d: 'M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6' }),
  );
}

function IconAlert(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M12 3 22 20H2z' }),
    h('path', { d: 'M12 9v5M12 17h.01' }),
  );
}

function IconFilm(props) {
  return h(
    Svg,
    props,
    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    h('path', { d: 'M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5' }),
  );
}

function IconChevron(props) {
  return h(Svg, props, h('path', { d: 'M6 9l6 6 6-6' }));
}

function IconDownload(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M12 3v12M8 11l4 4 4-4' }),
    h('path', { d: 'M4 19h16' }),
  );
}

function IconInfo(props) {
  return h(Svg, props, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 11v6M12 7.5h.01' }));
}

function IconScan(props) {
  return h(
    Svg,
    props,
    h('path', { d: 'M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3' }),
    h('circle', { cx: 12, cy: 12, r: 3 }),
  );
}

/* ------------------------------------------------------------------ */
/* UI primitives                                                       */
/* ------------------------------------------------------------------ */

function Btn(props) {
  const { children, variant, size, icon, active, className, ...rest } = props;
  const classes = [
    'cl-btn',
    variant ? `cl-btn--${variant}` : 'cl-btn--ghost',
    size ? `cl-btn--${size}` : 'cl-btn--md',
    active ? 'is-active' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');
  return h('button', Object.assign({ type: 'button', className: classes }, rest), icon || null, children || null);
}

function IconBtn(props) {
  const { icon, label, active, className, size, ...rest } = props;
  return h(
    'button',
    Object.assign(
      {
        type: 'button',
        className: `cl-icon-btn${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`,
        title: label,
        'aria-label': label,
      },
      rest,
    ),
    icon || null,
  );
}

function Toggle(props) {
  const { checked, onChange, label, hint } = props;
  return h(
    'button',
    {
      type: 'button',
      className: `cl-toggle${checked ? ' is-on' : ''}`,
      role: 'switch',
      'aria-checked': checked ? 'true' : 'false',
      title: label,
      onClick: () => onChange(!checked),
    },
    h('span', { className: 'cl-toggle-track', 'aria-hidden': 'true' }, h('span', { className: 'cl-toggle-knob' })),
    label ? h('span', { className: 'cl-toggle-label' }, label) : null,
    hint ? h('span', { className: 'cl-toggle-hint' }, hint) : null,
  );
}

function Slider(props) {
  const { value, min, max, step, onChange, label, valueLabel, disabled } = props;
  return h(
    'label',
    { className: 'cl-slider' },
    label
      ? h(
          'span',
          { className: 'cl-slider-head' },
          h('span', null, label),
          valueLabel != null ? h('b', null, valueLabel) : null,
        )
      : null,
    h('input', {
      type: 'range',
      min,
      max,
      step,
      value,
      disabled: Boolean(disabled),
      onChange: (event) => onChange(Number(event.target.value)),
    }),
  );
}

function Section(props) {
  const { title, subtitle, right, children, className } = props;
  return h(
    'section',
    { className: `cl-section${className ? ` ${className}` : ''}` },
    title || right
      ? h(
          'header',
          { className: 'cl-section-head' },
          h(
            'div',
            { className: 'cl-section-titles' },
            title ? h('h3', null, title) : null,
            subtitle ? h('p', null, subtitle) : null,
          ),
          right || null,
        )
      : null,
    children,
  );
}

function Chip(props) {
  const { children, active, onClick, title, tone } = props;
  return h(
    'button',
    {
      type: 'button',
      className: `cl-chip${active ? ' is-active' : ''}${tone === 'accent' ? ' cl-chip--accent' : ''}`,
      onClick,
      title,
      'aria-pressed': active ? 'true' : 'false',
    },
    children,
  );
}

function Spinner(props) {
  return h('span', { className: `cl-spinner${props && props.size === 'sm' ? ' is-sm' : ''}`, 'aria-hidden': 'true' });
}

function Divider() {
  return h('span', { className: 'cl-divider', 'aria-hidden': 'true' });
}

module.exports = {
  React,
  h,
  engine,
  PACKAGE_ID,
  store,
  useStore,
  setTranslator,
  t,
  clamp,
  formatDuration,
  formatBytes,
  basenameWithoutExtension,
  selectedClip,
  Svg,
  icons: {
    clapper: IconClapper,
    sparkle: IconSparkle,
    wand: IconWand,
    sliders: IconSliders,
    wave: IconWave,
    cc: IconCC,
    upload: IconUpload,
    play: IconPlay,
    pause: IconPause,
    stepBack: IconStepBack,
    stepForward: IconStepForward,
    scissors: IconScissors,
    undo: IconUndo,
    redo: IconRedo,
    export: IconExport,
    close: IconClose,
    plus: IconPlus,
    trash: IconTrash,
    music: IconMusic,
    check: IconCheck,
    keyboard: IconKeyboard,
    alert: IconAlert,
    film: IconFilm,
    chevron: IconChevron,
    download: IconDownload,
    info: IconInfo,
    scan: IconScan,
  },
  Btn,
  IconBtn,
  Toggle,
  Slider,
  Section,
  Chip,
  Spinner,
  Divider,
};
