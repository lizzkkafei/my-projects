/**
 * Client half of the zhizhen-liyin bundle.
 *
 * Adds a 「理音」 entry to the session composer (conversation.input.left) and a
 * full-frame overlay (shell.overlay) that hosts the Liyin Studio web workbench
 * in a same-origin iframe served by this bundle's host half (/api/liyin/*).
 */
const React = require('react');
const h = React.createElement;
const CSS = require('./styles.css');

const PACKAGE_ID = 'zhizhen-liyin';
const LOCALE_NS = 'liyinWorkbench';
const STYLE_ID = 'zhizhen-liyin-style';

const zh = {
  'entry.label': '理音',
  'entry.title': '打开理音音乐工作台（⌥M）',
  'app.title': '理音 Liyin Studio',
  'app.subtitle': '会话工作台',
  'app.hint': '编曲 / 录音 / 混音 / AI 生成 · Esc 返回会话',
  'app.close': '收起工作台',
};
const en = {
  'entry.label': 'Liyin',
  'entry.title': 'Open the Liyin music workbench (⌥M)',
  'app.title': 'Liyin Studio',
  'app.subtitle': 'Session workbench',
  'app.hint': 'Arrange / record / mix / AI · Esc to return',
  'app.close': 'Close workbench',
};

let isOpen = false;
const listeners = new Set();

function setOpen(next) {
  isOpen = next;
  for (const listener of listeners) {
    try { listener(); } catch {}
  }
}

function useOpen() {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    const listener = () => bump();
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return isOpen;
}

function installStyles() {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.dataset.plugin = PACKAGE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

function EntryButton() {
  const open = useOpen();
  return h(
    'button',
    {
      type: 'button',
      className: 'liyin-entry' + (open ? ' is-open' : ''),
      title: '打开理音音乐工作台（⌥M，⌥L 亦可）',
      'aria-pressed': open,
      onClick: () => setOpen(!open),
    },
    h('span', { className: 'liyin-entry-dot', 'aria-hidden': true }),
    h('span', { className: 'liyin-entry-label' }, '理音'),
  );
}

function Overlay() {
  const open = useOpen();
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  return h(
    'div',
    { className: 'liyin-overlay', role: 'dialog', 'aria-label': '理音音乐工作台' },
    h(
      'div',
      { className: 'liyin-overlay-bar' },
      h(
        'div',
        { className: 'liyin-overlay-brand' },
        h('span', { className: 'liyin-brand-mark' }, '理音'),
        h('span', { className: 'liyin-brand-sub' }, 'LIYIN STUDIO'),
        h('span', { className: 'liyin-brand-tag' }, '会话工作台'),
      ),
      h('div', { className: 'liyin-overlay-hint' }, '编曲 / 录音 / 混音 / AI 生成 · Esc 返回会话'),
      h(
        'button',
        { type: 'button', className: 'liyin-overlay-close', onClick: () => setOpen(false) },
        '收起工作台 ⌫',
      ),
    ),
    h('iframe', {
      className: 'liyin-overlay-frame',
      src: '/api/liyin/index.html',
      title: '理音 Liyin Studio',
      allow: 'microphone; autoplay; clipboard-write',
    }),
  );
}

const inject = ['slots', 'locale'];

function apply(ctx) {
  ctx.effect(() => {
    try {
      return ctx.locale.register(LOCALE_NS, { zh, en });
    } catch {
      return () => {};
    }
  }, 'liyin: dictionaries');

  ctx.effect(installStyles, 'liyin: styles');

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: 'zhizhen-liyin',
        order: 18,
        locale: LOCALE_NS,
      },
      EntryButton,
    ),
  );

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'zhizhen-liyin',
        order: 78,
        locale: LOCALE_NS,
      },
      Overlay,
    ),
  );

  ctx.effect(() => {
    const onKeyDown = (event) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      // ⌥M 为主快捷键（Music），⌥L 保留为别名
      const key = String(event.key).toLowerCase();
      if (key !== 'm' && key !== 'l') return;
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen(!isOpen);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, 'liyin: open shortcut');
}

module.exports = { inject, apply };
