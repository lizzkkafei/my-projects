/**
 * Client half of the zhizhen-pool bundle.
 *
 * Registers a session-composer entry (`conversation.input.left`). Clicking it
 * mounts the bundled billiards game as a body-level full-frame layer, inside a
 * shadow root, so the game's stylesheet and element ids cannot collide with the
 * DSH UI. Closing the layer tears down every listener, animation frame and
 * audio context.
 *
 * Everything here runs inside the factory scope created by scripts/build.mjs:
 * `React`, `h`, `GAME_CSS`, `GAME_HTML` and `__bootPool` are in scope.
 */

const PACKAGE_ID = 'zhizhen-pool';
const LOCALE_NS = 'zhizhenPool';
const SHORTCUT_KEY = 'p';

const zh = {
  'entry.label': '台球',
  'entry.title': '打开桌面台球（⌥P）',
  'overlay.close': '返回会话（⌥P）',
  'overlay.hint': '拖拽鼠标瞄准 · 按住空格蓄力 · 松开击球 · T 切视角 · G 辅助线',
  'overlay.loading': '正在铺开台面…',
  'overlay.error': '台面没能启动',
};

const en = {
  'entry.label': 'Pool',
  'entry.title': 'Open the pool table (⌥P)',
  'overlay.close': 'Back to session (⌥P)',
  'overlay.hint': 'Drag to aim · hold Space to charge · release to shoot · T view · G guides',
  'overlay.loading': 'Racking the table…',
  'overlay.error': 'The table could not start',
};

const CHROME_CSS = `
.zp-entry {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(217, 180, 91, 0.35);
  background: rgba(217, 180, 91, 0.08);
  color: inherit; font: inherit; font-size: 12px; line-height: 1;
  cursor: pointer; white-space: nowrap;
}
.zp-entry:hover { background: rgba(217, 180, 91, 0.16); border-color: rgba(217, 180, 91, 0.55); }
.zp-entry-icon { display: inline-flex; color: #d9b45b; }
.zp-overlay {
  position: fixed; inset: 0; z-index: 4100;
  overflow: hidden;
  background: #05070a; color: #e8eef6;
}
.zp-stage { position: absolute; inset: 0; }
.zp-close {
  position: absolute; top: 14px; right: 16px; z-index: 3;
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 999px;
  border: 1px solid rgba(217, 180, 91, 0.4);
  background: rgba(7, 11, 16, 0.72); color: #d9b45b;
  font: inherit; font-size: 12px; cursor: pointer;
  backdrop-filter: blur(8px);
}
.zp-close:hover { background: rgba(217, 180, 91, 0.16); }
.zp-hint {
  position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
  z-index: 2; font-size: 11px; letter-spacing: 0.04em;
  color: rgba(232, 238, 246, 0.5); pointer-events: none; white-space: nowrap;
}
`;

// Falls back to the Chinese dictionary until apply() binds the real locale.
let translate = (key) => zh[key] || key;
let open = false;
const listeners = new Set();

function setOpen(next) {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

function useOpen() {
  const [, forceRender] = React.useState(0);
  React.useEffect(() => {
    const listener = () => forceRender((value) => value + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return open;
}

function bootErrorText(error) {
  return error && (error.stack || error.message || String(error));
}

/**
 * Mount the bundled game into `host`'s shadow root.
 * Returns a dispose function that removes the DOM, every window listener the
 * boot added, every scheduled animation frame, and every audio context.
 */
function mountPool(host) {
  // A shadow root can only be attached once, so reuse it across re-opens.
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = GAME_CSS;
  const surface = document.createElement('div');
  surface.className = 'zp-surface';
  surface.innerHTML = GAME_HTML;
  shadow.replaceChildren(style, surface);

  const restores = [];
  const frames = new Set();
  const audioContexts = [];
  const bootListeners = [];
  let alive = true;

  // The game resolves every HUD node through document.getElementById; answer
  // from the shadow root first so its ids never hit the DSH document.
  const nativeGetById = document.getElementById;
  document.getElementById = function (id) {
    const local = shadow.getElementById ? shadow.getElementById(id) : null;
    return local || nativeGetById.call(document, id);
  };
  restores.push(() => { document.getElementById = nativeGetById; });

  // Track animation frames so closing the overlay really stops the render loop.
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeCAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    if (!alive) return 0;
    let handle = 0;
    handle = nativeRAF((time) => {
      frames.delete(handle);
      if (!alive) return;
      callback(time);
    });
    frames.add(handle);
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    frames.delete(handle);
    return nativeCAF(handle);
  };
  restores.push(() => {
    window.requestAnimationFrame = nativeRAF;
    window.cancelAnimationFrame = nativeCAF;
  });

  // Track AudioContext instances (the game creates one lazily on first gesture).
  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (NativeAudioContext) {
    const key = window.AudioContext ? 'AudioContext' : 'webkitAudioContext';
    const Tracked = function (...args) {
      const context = new NativeAudioContext(...args);
      audioContexts.push(context);
      return context;
    };
    Tracked.prototype = NativeAudioContext.prototype;
    window[key] = Tracked;
    restores.push(() => { window[key] = NativeAudioContext; });
  }

  // The standalone page ships a boot guard that fades the loading layer and
  // reports fatal errors. Inside the plugin that guard is not present, so the
  // host supplies the same three hooks before the game runs.
  const loadingEl = shadow.getElementById('loading');
  const prevHooks = {
    hide: window.__HIDE_LOADING,
    ok: window.__BOOT_OK,
    fatal: window.__FATAL,
  };
  window.__HIDE_LOADING = () => {
    if (!loadingEl) return;
    loadingEl.classList.add('done');
    window.setTimeout(() => {
      if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    }, 800);
  };
  window.__BOOT_OK = () => {};
  window.__FATAL = (title, detail) => {
    const box = shadow.getElementById('loading');
    if (!box) {
      console.error(`[${PACKAGE_ID}] ${title}: ${detail}`);
      return;
    }
    box.className = 'fatal';
    box.style.visibility = 'visible';
    box.style.opacity = '1';
    box.innerHTML =
      '<div class="fatal-box">' +
      `<div class="fatal-title">${title}</div>` +
      `<div class="fatal-detail">${String(detail).replace(/</g, '&lt;')}</div>` +
      `<div class="fatal-hint">${translate('overlay.error')}</div>` +
      '</div>';
  };
  restores.push(() => {
    window.__HIDE_LOADING = prevHooks.hide;
    window.__BOOT_OK = prevHooks.ok;
    window.__FATAL = prevHooks.fatal;
  });

  // Tell the game it is embedded so it sizes itself from this container
  // instead of the window (the overlay can be smaller than the viewport when
  // DSH wraps it in a layout box).
  const prevEmbedded = window.__POOL_EMBEDDED;
  window.__POOL_EMBEDDED = true;
  restores.push(() => { window.__POOL_EMBEDDED = prevEmbedded; });

  // The container can change size without a window resize (sidebar collapse,
  // panel drag). Nudge the game to re-fit.
  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => {
      if (!alive) return;
      window.dispatchEvent(new Event('resize'));
    });
    resizeObserver.observe(surface);
  }

  // Record the window listeners the boot adds so the overlay can remove them.
  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  window.addEventListener = function (type, listener, options) {
    bootListeners.push([type, listener, options]);
    return nativeAdd(type, listener, options);
  };
  try {
    __bootPool();
  } catch (error) {
    console.error(`[${PACKAGE_ID}] game boot failed`, error);
    window.__FATAL(translate('overlay.error'), bootErrorText(error));
  } finally {
    window.addEventListener = nativeAdd;
    window.removeEventListener = nativeRemove;
  }

  return function dispose() {
    alive = false;
    if (resizeObserver) resizeObserver.disconnect();
    for (const handle of frames) {
      try { nativeCAF(handle); } catch { /* already gone */ }
    }
    frames.clear();
    for (const [type, listener, options] of bootListeners) {
      try { nativeRemove(type, listener, options); } catch { /* already gone */ }
    }
    bootListeners.length = 0;
    for (const context of audioContexts) {
      try { context.close(); } catch { /* already closed */ }
    }
    audioContexts.length = 0;
    for (const restore of restores) {
      try { restore(); } catch { /* already restored */ }
    }
    restores.length = 0;
    shadow.replaceChildren();
  };
}

/** Eight-ball glyph used by the composer entry button. */
function EntryIcon() {
  return h(
    'svg',
    {
      width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.7,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
    },
    h('circle', { cx: 9, cy: 15, r: 5.2 }),
    h('circle', { cx: 9, cy: 15, r: 2.1, fill: 'currentColor', stroke: 'none' }),
    h('path', { d: 'M13.4 11.6 20 5' }),
    h('path', { d: 'M17.6 7.4 19.4 9.2' }),
  );
}

function EntryButton() {
  return h(
    'button',
    {
      type: 'button',
      className: 'zp-entry',
      onClick: () => openTable(),
      title: translate('entry.title'),
      'aria-label': translate('entry.label'),
    },
    h('span', { className: 'zp-entry-icon' }, h(EntryIcon)),
    h('span', null, translate('entry.label')),
  );
}

/**
 * 覆盖层不走 React 渲染，而是直接挂到 document.body。
 *
 * 原因：DSH 的外壳容器可能带 transform（会改变 fixed 的定位祖先）和
 * overflow:hidden（会裁掉溢出内容）。只要覆盖层还在那棵子树里，
 * 它就既可能只占窗口一角，也可能被裁掉 —— 用户看到的就是"球台很小/被切"。
 * 挂到 body 之后，`position:fixed; inset:0` 才是真正的整个视口。
 *
 * 插件拿不到 react-dom，所以这里不用 portal，而是命令式地建节点、挂节点、
 * 关的时候整体移除。React 只负责渲染输入框旁的那个按钮。
 */
let overlay = null;

function closeTable() {
  if (!overlay) return;
  const current = overlay;
  overlay = null;
  try { current.dispose(); } catch { /* already disposed */ }
  current.root.remove();
  document.removeEventListener('keydown', onEscape, true);
  setOpen(false);
}

function onEscape(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  closeTable();
}

function openTable() {
  if (overlay) return;
  // The layer is plain DOM appended to <body>; make sure its stylesheet exists
  // even if apply() has not run yet (or was torn down).
  installStyles();

  const root = document.createElement('div');
  root.className = 'zp-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Desktop Eight-Ball');

  const stage = document.createElement('div');
  stage.className = 'zp-stage';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zp-close';
  closeBtn.textContent = translate('overlay.close');
  closeBtn.addEventListener('click', closeTable);

  const hint = document.createElement('div');
  hint.className = 'zp-hint';
  hint.textContent = translate('overlay.hint');

  root.append(stage, closeBtn, hint);
  document.body.append(root);

  let dispose = () => {};
  try {
    dispose = mountPool(stage);
  } catch (error) {
    console.error(`[${PACKAGE_ID}] mount failed`, error);
  }

  overlay = { root, dispose };
  document.addEventListener('keydown', onEscape, true);
  setOpen(true);
}

/** Inject the bundle chrome stylesheet once and keep it owned by the plugin. */
function installStyles() {
  const marker = `${PACKAGE_ID}/chrome.css`;
  if (document.querySelector(`style[data-zp-css="${marker}"]`)) return () => {};
  const tag = document.createElement('style');
  tag.dataset.zpCss = marker;
  tag.textContent = CHROME_CSS;
  document.head.append(tag);
  return () => { tag.remove(); };
}

const inject = ['slots', 'locale'];

/**
 * Wire the bundle into the Client: dictionary, chrome stylesheet, composer
 * entry, full-frame overlay, and the global ⌥P shortcut.
 * @param ctx Client root context.
 */
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'pool: dictionaries');
  translate = ctx.locale.bind(LOCALE_NS);
  ctx.effect(installStyles, 'pool: chrome styles');

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      { name: 'conversation.input.left', id: PACKAGE_ID, order: 22, locale: LOCALE_NS },
      EntryButton,
    ),
  );

  ctx.effect(() => {
    const onKeyDown = (event) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (String(event.key).toLowerCase() !== SHORTCUT_KEY && event.code !== 'KeyP') return;
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (overlay) closeTable(); else openTable();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, 'pool: toggle shortcut');
}
