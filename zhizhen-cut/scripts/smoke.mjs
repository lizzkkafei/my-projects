#!/usr/bin/env node
/**
 * Bundle smoke test: execute the generated `client.js` inside a VM with a
 * stubbed module loader, materialize the factory, and run `apply()` against a
 * recording slot/locale registry. This catches build-wrapper breakage, broken
 * requires, and registrations wired to the wrong slot ids — failures that
 * static syntax checks cannot see.
 *
 * Usage: node scripts/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(root, 'client.js'), 'utf8');

let registration = null;
const styleTags = [];

const documentStub = {
  querySelector: () => null,
  createElement: (tag) => ({
    tagName: String(tag).toUpperCase(),
    dataset: {},
    textContent: '',
    remove() {},
  }),
  head: {
    append(element) {
      styleTags.push(element);
    },
  },
  documentElement: { lang: 'zh-CN' },
};

const context = vm.createContext({
  window: {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
    addEventListener() {},
    removeEventListener() {},
  },
  document: documentStub,
  console,
  setTimeout,
  clearTimeout,
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
});

vm.runInContext(code, context);
if (!registration) throw new Error('client.js did not call window.__ModuleLoader__.load');
if (registration.id !== 'zhizhen-cut') {
  throw new Error(`unexpected bundle id: ${registration.id}`);
}

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useCallback: (callback) => callback,
  useReducer: (reducer, initial) => [initial, () => {}],
  Fragment: 'Fragment',
};

const exports = registration.factory((specifier) => {
  if (specifier === 'react') return ReactStub;
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
});

if (typeof exports.apply !== 'function') throw new Error('factory did not export apply()');
if (!Array.isArray(exports.inject) || !exports.inject.includes('slots')) {
  throw new Error('factory must export inject including "slots"');
}

const slots = [];
const dictionaries = new Map();
const effects = [];
const t = (key) => key;

function applySlotRegistration(args) {
  slots.push(args && args.name ? args.name : '(missing name)');
}

const ctx = {
  effect(callback) {
    const dispose = callback();
    effects.push(typeof dispose === 'function' ? dispose : () => {});
    return dispose;
  },
  on() {
    return () => {};
  },
  locale: {
    register(ns, dicts) {
      dictionaries.set(ns, dicts);
      return () => {};
    },
    bind(ns) {
      if (!dictionaries.has(ns)) throw new Error(`bind() before register(${ns})`);
      return t;
    },
  },
  slots: {
    inject(key, callback) {
      const result = callback();
      if (typeof result === 'function') return result;
      return () => {};
    },
    register(options) {
      applySlotRegistration(options);
      return () => {};
    },
  },
};

exports.apply(ctx);

if (!slots.includes('conversation.input.left')) {
  throw new Error(`missing conversation.input.left registration; got ${JSON.stringify(slots)}`);
}
if (!slots.includes('shell.overlay')) {
  throw new Error(`missing shell.overlay registration; got ${JSON.stringify(slots)}`);
}
if (styleTags.length === 0) {
  throw new Error('plugin did not install a stylesheet');
}
for (const tag of styleTags) {
  if (!tag.textContent || tag.textContent.length < 500) {
    throw new Error('installed stylesheet looks empty');
  }
}
if (effects.length === 0) throw new Error('apply() registered no effects');
if (!dictionaries.size) throw new Error('locale dictionaries were not registered');

console.log('smoke ok');
console.log(`  bundle: ${registration.id}`);
console.log(`  slots: ${slots.join(', ')}`);
console.log(`  locale namespaces: ${[...dictionaries.keys()].join(', ')}`);
console.log(`  style tags: ${styleTags.length} (${styleTags.map((tag) => tag.textContent.length).join(', ')} chars)`);
console.log(`  effects: ${effects.length}`);
