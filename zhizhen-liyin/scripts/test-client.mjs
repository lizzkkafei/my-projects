#!/usr/bin/env node
/**
 * Client-half smoke test: emulate the Harness module loader, run the plugin
 * factory, then call apply() against a fake client context and assert both
 * session entries were registered with a component.
 *
 * Usage: node scripts/test-client.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let loaded = null
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useReducer: () => [0, () => {}],
  useEffect: () => {},
  useState: (v) => [v, () => {}],
}
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (entry) => { loaded = entry },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  document: {
    createElement: () => ({ set textContent(v) {}, remove() {}, dataset: {} }),
    head: { appendChild: () => {} },
  },
  console,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox)
if (!loaded) throw new Error('module loader entry not registered')
if (loaded.id !== 'zhizhen-liyin') throw new Error('unexpected bundle id: ' + loaded.id)

const modules = {}
const factoryRequire = (id) => {
  if (id === 'react') return fakeReact
  const key = id.startsWith('./') ? id.slice(2) : id
  if (!modules[key]) throw new Error('unknown module ' + id)
  return modules[key]
}
const exportsRaw = loaded.factory(factoryRequire)
if (typeof exportsRaw.apply !== 'function') throw new Error('missing apply()')
if (!Array.isArray(exportsRaw.inject)) throw new Error('missing inject[]')

const registered = []
const effects = []
const fakeCtx = {
  effect: (fn, label) => { effects.push(label) },
  locale: { register: () => () => {} },
  slots: {
    inject: (name, cb) => cb(),
    register: (descriptor, component) => {
      registered.push({ name: descriptor.name, id: descriptor.id, component })
      return () => {}
    },
  },
}
exportsRaw.apply(fakeCtx)

const names = registered.map((r) => r.name)
const ok =
  names.includes('conversation.input.left') &&
  names.includes('shell.overlay') &&
  registered.every((r) => typeof r.component === 'function') &&
  exportsRaw.inject.includes('slots')

for (const r of registered) console.log('registered:', r.name, 'id=' + r.id, 'component=' + typeof r.component)
console.log('effects:', effects.join(', '))
console.log(ok ? 'PASS client half' : 'FAIL client half')
process.exitCode = ok ? 0 : 1
