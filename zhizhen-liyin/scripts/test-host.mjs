#!/usr/bin/env node
/**
 * Host-half smoke test: fake a webServer, register the Liyin routes, then
 * exercise static serving (html/css/audio), path traversal rejection and the
 * ACE-Step reverse proxy. Run with the local ACE-Step API up.
 *
 * Usage: node scripts/test-host.mjs
 */
import { apply } from '../index.js'

const routes = []
const ctx = { webServer: { register: (route) => routes.push(route) }, logger: { warn: () => {} } }
apply(ctx)

const prefix = routes.find((r) => r.path === '/api/liyin' && r.kind === 'prefix')
if (!prefix) throw new Error('prefix route not registered')

function fakeReq(url, method = 'GET') {
  return {
    url,
    method,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {},
  }
}
function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers || {} },
    end(body) { this.body = body ?? null; this.done = true },
  }
  return res
}
async function call(url, method = 'GET') {
  const res = fakeRes()
  await prefix.handler(fakeReq(url, method), res)
  return res
}

const checks = []
async function check(name, url, expectStatus, expectType, expectContains) {
  const res = await call(url)
  const type = res.headers['content-type'] || ''
  const text = res.body ? (Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.body))) : Buffer.alloc(0)
  const okStatus = res.status === expectStatus
  const okType = !expectType || type.includes(expectType)
  let okContains = true
  if (expectContains) okContains = text.includes(Buffer.from(expectContains))
  checks.push({ name, status: res.status, type, bytes: text.length, ok: okStatus && okType && okContains })
  if (!(okStatus && okType && okContains)) {
    console.log(`FAIL ${name}: status=${res.status} type=${type} bytes=${text.length}`)
  }
}

await check('index html', '/api/liyin/index.html', 200, 'text/html', '理音')
await check('styles.css', '/api/liyin/styles.css', 200, 'text/css')
await check('app.js', '/api/liyin/app.js', 200, 'javascript')
await check('audio asset', '/api/liyin/assets/audio/ai-demo.mp3', 200, 'audio/mpeg')
await check('path traversal', '/api/liyin/../package.json', 404, 'application/json')
await check('missing file', '/api/liyin/nope.js', 404, 'application/json')

// proxy (needs the local ACE-Step API on 8001)
const health = await call('/api/liyin/ace/health')
let proxyOk = false
try {
  const json = JSON.parse(Buffer.from(health.body).toString('utf8'))
  proxyOk = health.status === 200 && json?.data?.status === 'ok'
} catch {}
checks.push({ name: 'ace proxy health', status: health.status, ok: proxyOk })

let failed = 0
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(18)} status=${c.status} ${c.bytes ? c.bytes + 'B' : ''}`)
  if (!c.ok) failed++
}
process.exitCode = failed ? 1 : 0
