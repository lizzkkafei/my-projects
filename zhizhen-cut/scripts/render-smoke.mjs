#!/usr/bin/env node
/**
 * Render smoke test: execute the built bundle in a VM with a stub React runtime,
 * invoke `apply()` to capture the registered slot components, open the store
 * through the entry button, and recursively evaluate the resulting element tree
 * (function components included). This catches undefined render paths, bad hook
 * usage and missing imports without a browser. It does NOT verify pixels.
 *
 * Usage: node scripts/render-smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(root, 'client.js'), 'utf8');

let registration = null;
const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({
    tagName: String(tag).toUpperCase(),
    dataset: {},
    style: {},
    textContent: '',
    setAttribute() {},
    appendChild() {},
    remove() {},
    getContext: () => null,
  }),
  head: { append() {} },
  documentElement: { lang: 'zh-CN' },
  body: { appendChild() {} },
};
const windowStub = {
  __ModuleLoader__: { load: (value) => { registration = value; } },
  devicePixelRatio: 2,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  setTimeout: (fn) => 1,
  clearTimeout() {},
  confirm: () => false,
  getComputedStyle: () => ({ position: 'relative' }),
  innerWidth: 1440,
  innerHeight: 900,
};
const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  console,
  setTimeout: windowStub.setTimeout,
  clearTimeout: windowStub.clearTimeout,
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
  performance: { now: () => 0 },
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL() {} },
});

vm.runInContext(code, context);
if (!registration) throw new Error('client.js did not call window.__ModuleLoader__.load');

let hookCursor = 0;
const noop = () => {};
const ReactStub = {
  createElement: (type, props, ...children) => ({
    type,
    props: Object.assign({}, props, {
      children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children,
    }),
  }),
  useState: (initial) => {
    hookCursor += 1;
    return [typeof initial === 'function' ? initial() : initial, noop];
  },
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useCallback: (callback) => callback,
  useReducer: (reducer, initial) => [initial, noop],
  memo: (component) => component,
  Fragment: 'Fragment',
  createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
  useContext: () => null,
};

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return ReactStub;
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
});
if (typeof plugin.apply !== 'function') throw new Error('factory did not export apply()');

const registered = new Map();
const t = (key) => key;
const ctx = {
  effect(callback) {
    const dispose = callback();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  on: () => () => {},
  locale: {
    register: () => () => {},
    bind: () => t,
  },
  slots: {
    inject: (key, callback) => {
      callback();
      return () => {};
    },
    register: (options, component) => {
      registered.set(options.name, { options, component });
      return () => {};
    },
  },
};

plugin.apply(ctx);

const entry = registered.get('conversation.input.left');
const overlay = registered.get('shell.overlay');
if (!entry || !overlay) throw new Error('missing slot registrations after apply()');

let nodeCount = 0;
let functionCount = 0;
const MAX_NODES = 6000;

function walk(node, depth) {
  if (node == null || depth > 80) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  nodeCount += 1;
  if (nodeCount > MAX_NODES) throw new Error('render tree exceeded node budget');
  const { type, props } = node;
  if (typeof type === 'function') {
    functionCount += 1;
    hookCursor = 0;
    const rendered = type(props || {});
    walk(rendered, depth + 1);
    return;
  }
  if (typeof type === 'string') {
    walk(props && props.children, depth + 1);
  }
}

// Render the entry button and invoke its onClick to open the workbench store.
const entryTree = entry.component({});
walk(entryTree, 0);
let opened = false;
function findClickHandler(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findClickHandler(item);
      if (found) return found;
    }
    return null;
  }
  if (node.props && typeof node.props.onClick === 'function') return node.props.onClick;
  return findClickHandler(node.props && node.props.children);
}
const onClick = findClickHandler(entryTree);
if (typeof onClick !== 'function') throw new Error('entry button has no onClick handler');
onClick({ preventDefault() {}, stopPropagation() {} });
opened = true;

const tree = overlay.component({});
walk(tree, 0);

if (!opened) throw new Error('entry button did not open the workbench');
if (nodeCount < 100) throw new Error(`rendered tree looks too small (${nodeCount} nodes)`);

console.log('render smoke ok');
console.log(`  entry + workbench nodes: ${nodeCount}`);
console.log(`  function components evaluated: ${functionCount}`);
console.log(`  registered slots: ${[...registered.keys()].join(', ')}`);
