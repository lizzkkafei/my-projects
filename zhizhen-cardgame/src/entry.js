/**
 * Client half of the zhizhen-cardgame bundle.
 *
 * Registers a session-composer entry (`conversation.input.left`) and a
 * full-frame overlay (`shell.overlay`). The overlay mounts the bundled game
 * into a shadow root so its stylesheet and element ids cannot collide with the
 * DSH UI, and tears every listener, animation frame and audio context down
 * again when the overlay closes.
 *
 * Everything here runs inside the factory scope created by scripts/build.mjs:
 * `React`, `h`, `GAME_CSS`, `GAME_HTML` and `__bootCardgame` are in scope.
 */

const PACKAGE_ID = 'zhizhen-cardgame';
const LOCALE_NS = 'zhizhenCardgame';
const SHORTCUT_KEY = 'g';

const zh = {
  'entry.label': '游戏',
  'entry.title': '打开小丑之桌（⌥G）',
  'overlay.close': '返回会话（⌥G）',
  'overlay.hint': '空格 出牌 · D 弃牌 · Esc 取消选择 · M 静音',
  'overlay.loading': '正在铺开牌桌…',
  'overlay.error': '牌桌没能启动',
};

const en = {
  'entry.label': 'Play',
  'entry.title': "Open Jester's Table (⌥G)",
  'overlay.close': 'Back to session (⌥G)',
  'overlay.hint': 'Space play · D discard · Esc clear selection · M mute',
  'overlay.loading': 'Dealing the table…',
  'overlay.error': 'The table could not start',
};

const CHROME_CSS = `
.cg-entry {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 10px; border-radius: 8px;
  border: 1px solid rgba(243, 201, 97, 0.35);
  background: rgba(243, 201, 97, 0.08);
  color: inherit; font: inherit; font-size: 12px; line-height: 1;
  cursor: pointer; white-space: nowrap;
}
.cg-entry:hover { background: rgba(243, 201, 97, 0.16); border-color: rgba(243, 201, 97, 0.55); }
.cg-entry-icon { display: inline-flex; color: #f3c961; }
.cg-overlay {
  position: fixed; inset: 0; z-index: 4100;
  background: #05070f; color: #f7f1e1;
}
.cg-stage { position: absolute; inset: 0; }
.cg-close {
  position: absolute; top: 14px; right: 16px; z-index: 3;
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 999px;
  border: 1px solid rgba(243, 201, 97, 0.4);
  background: rgba(7, 11, 24, 0.72); color: #f3c961;
  font: inherit; font-size: 12px; cursor: pointer;
  backdrop-filter: blur(8px);
}
.cg-close:hover { background: rgba(243, 201, 97, 0.16); }
.cg-hint {
  position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%);
  z-index: 2; font-size: 11px; letter-spacing: 0.04em;
  color: rgba(247, 241, 225, 0.5); pointer-events: none; white-space: nowrap;
}
.cg-fallback {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: rgba(247, 241, 225, 0.7);
}
`;

let translate = (key) => key;
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

/** Write a boot failure into the game's own #err element, if it exists. */
function showGameError(shadow, error) {
  const detail = error && (error.stack || error.message || String(error));
  console.error(`[${PACKAGE_ID}] game boot failed`, error);
  const target = shadow.getElementById('err');
  if (target) {
    target.textContent = `${translate('overlay.error')}\n\n${detail}`;
    target.classList.add('on');
  }
}

/**
 * Mount the bundled game into `host`'s shadow root.
 * Returns a dispose function that removes the DOM, every window listener the
 * boot added, every scheduled animation frame, and every audio context.
 */
function mountCardgame(host) {
  // Reuse the shadow root across re-opens; a shadow root cannot be attached twice.
  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = GAME_CSS;
  const surface = document.createElement('div');
  surface.className = 'cg-surface';
  surface.innerHTML = GAME_HTML;
  shadow.replaceChildren(style, surface);

  const restores = [];
  const frames = new Set();
  const audioContexts = [];
  const bootListeners = [];
  let alive = true;

  // The game looks up its HUD by document.getElementById; resolve inside the
  // shadow root first, then fall back to the host document.
  const nativeGetElementById = document.getElementById;
  document.getElementById = function (id) {
    return (shadow.getElementById ? shadow.getElementById(id) : null) || nativeGetElementById.call(document, id);
  };
  restores.push(() => {
    document.getElementById = nativeGetElementById;
  });

  // Track the animation frames the game schedules so closing the overlay
  // really stops the render loop instead of leaving it running invisibly.
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

  // Track AudioContext instances (created lazily on the first user gesture).
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
    restores.push(() => {
      window[key] = NativeAudioContext;
    });
  }

  // Record the window listeners the boot adds, so the overlay can remove them.
  const nativeAddEventListener = window.addEventListener.bind(window);
  const nativeRemoveEventListener = window.removeEventListener.bind(window);
  window.addEventListener = function (type, listener, options) {
    bootListeners.push([type, listener, options]);
    return nativeAddEventListener(type, listener, options);
  };
  try {
    __bootCardgame();
  } catch (error) {
    showGameError(shadow, error);
  } finally {
    window.addEventListener = nativeAddEventListener;
    window.removeEventListener = nativeRemoveEventListener;
  }

  return function dispose() {
    alive = false;
    for (const handle of frames) {
      try {
        nativeCAF(handle);
      } catch {
        /* frame already gone */
      }
    }
    frames.clear();
    for (const [type, listener, options] of bootListeners) {
      try {
        nativeRemoveEventListener(type, listener, options);
      } catch {
        /* listener already gone */
      }
    }
    bootListeners.length = 0;
    for (const context of audioContexts) {
      try {
        context.close();
      } catch {
        /* already closed */
      }
    }
    audioContexts.length = 0;
    for (const restore of restores) {
      try {
        restore();
      } catch {
        /* already restored */
      }
    }
    restores.length = 0;
    shadow.replaceChildren();
  };
}

/** Card-in-flight glyph used by the composer entry button. */
function EntryIcon() {
  return h(
    'svg',
    {
      width: 15,
      height: 15,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    h('rect', { x: 4.5, y: 3.5, width: 10, height: 15, rx: 1.8, transform: 'rotate(-8 9.5 11)' }),
    h('rect', { x: 9.5, y: 5.5, width: 10, height: 15, rx: 1.8 }),
    h('path', { d: 'M14.5 9.6c.9.9 1.4 1.6 1.4 2.4a1.4 1.4 0 0 1-2.8 0c0-.8.5-1.5 1.4-2.4Z' }),
  );
}

function EntryButton() {
  return h(
    'button',
    {
      type: 'button',
      className: 'cg-entry',
      onClick: () => setOpen(true),
      title: translate('entry.title'),
      'aria-label': translate('entry.label'),
    },
    h('span', { className: 'cg-entry-icon' }, h(EntryIcon)),
    h('span', null, translate('entry.label')),
  );
}

function GameOverlay() {
  const isOpen = useOpen();
  const hostRef = React.useRef(null);

  React.useEffect(() => {
    if (!isOpen) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    try {
      return mountCardgame(host);
    } catch (error) {
      showGameError(host.shadowRoot ?? host, error);
      return undefined;
    }
  }, [isOpen]);

  if (!isOpen) return null;
  return h(
    'div',
    { className: 'cg-overlay', role: 'dialog', 'aria-label': "Jester's Table" },
    h('div', { className: 'cg-stage', ref: hostRef }),
    h('button', { type: 'button', className: 'cg-close', onClick: () => setOpen(false) }, translate('overlay.close')),
    h('div', { className: 'cg-hint' }, translate('overlay.hint')),
  );
}

/** Inject the bundle chrome stylesheet once and keep it owned by the plugin. */
function installStyles() {
  const tagId = `${PACKAGE_ID}/chrome.css`;
  const existing = document.querySelector(`style[data-cardgame-css="${tagId}"]`);
  if (existing) return () => {};
  const tag = document.createElement('style');
  tag.dataset.cardgame = PACKAGE_ID;
  tag.dataset.cardgameCss = tagId;
  tag.textContent = CHROME_CSS;
  document.head.append(tag);
  return () => {
    tag.remove();
  };
}

const inject = ['slots', 'locale'];

/**
 * Wire the bundle into the Client: dictionary, chrome stylesheet, composer
 * entry, full-frame overlay, and the global ⌥G shortcut.
 * @param ctx Client root context.
 */
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'cardgame: dictionaries');
  translate = ctx.locale.bind(LOCALE_NS);
  ctx.effect(installStyles, 'cardgame: chrome styles');

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: PACKAGE_ID,
        order: 21,
        locale: LOCALE_NS,
      },
      EntryButton,
    ),
  );

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: PACKAGE_ID,
        order: 82,
        locale: LOCALE_NS,
      },
      GameOverlay,
    ),
  );

  ctx.effect(() => {
    const onKeyDown = (event) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (String(event.key).toLowerCase() !== SHORTCUT_KEY && event.code !== 'KeyG') return;
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen(!open);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, 'cardgame: toggle shortcut');
}
