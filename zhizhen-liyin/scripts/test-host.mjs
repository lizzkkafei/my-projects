#!/usr/bin/env node
/**
 * Host-half smoke test: fake a webServer and connection, register the Liyin
 * routes, then exercise static serving, path-traversal rejection, the ACE-Step
 * reverse proxy, and the Host/Origin fence.
 *
 * The fence checks run against DSH's real `isTrustedApiRequest`, imported from
 * the installed harness source, so the test cannot pass against a stub that is
 * more permissive than the product.
 *
 * Usage: node scripts/test-host.mjs
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { apply } from '../index.js'

const DSH_ROOT =
  process.env.DSH_CHECKOUT ||
  '/Users/zhizhen/Downloads/my AI work/deepseek DSH/deepseek-harness'
const TRUST_MODULE = `${DSH_ROOT}/packages/client/connection/src/api-request-trust.ts`

let isTrustedApiRequest
if (existsSync(TRUST_MODULE)) {
  ;({ isTrustedApiRequest } = await import(pathToFileURL(TRUST_MODULE).href))
} else {
  console.log(`SKIP  trust fence checks: ${TRUST_MODULE} not found`)
}

const routes = []
const ctx = {
  webServer: { register: (route) => routes.push(route) },
  // 用真实的信任判定，而不是放宽的桩
  connection: isTrustedApiRequest
    ? {
        requestRejection(req) {
          if (!isTrustedApiRequest(req, [])) return 403
          return undefined
        },
      }
    : undefined,
  logger: { warn: () => {} },
}
apply(ctx)

const prefix = routes.find((r) => r.path === '/api/liyin' && r.kind === 'prefix')
const healthRoute = routes.find((r) => r.path === '/api/liyin/health')
if (!prefix) throw new Error('prefix route not registered')
if (!healthRoute) throw new Error('health route not registered')

/** A loopback workbench request: same-origin iframe, no cross-site marker. */
function trustedReq(url, method = 'GET') {
  return {
    url,
    method,
    headers: {
      host: '127.0.0.1:58238',
      'content-type': 'application/json',
    },
    async *[Symbol.asyncIterator]() {},
  }
}

function fakeRes() {
  return {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
    },
    end(body) {
      this.body = body ?? null
      this.done = true
    },
  }
}

async function call(url, method = 'GET', req = trustedReq(url, method)) {
  const res = fakeRes()
  await prefix.handler(req, res)
  return res
}
async function callHealth(req) {
  const res = fakeRes()
  await healthRoute.handler(req, res)
  return res
}

const checks = []
function record(name, ok, detail) {
  checks.push({ name, ok })
  if (!ok) console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
}

async function check(name, url, expectStatus, expectType, expectContains) {
  const res = await call(url)
  const type = res.headers['content-type'] || ''
  const text = res.body
    ? Buffer.isBuffer(res.body)
      ? res.body
      : Buffer.from(String(res.body))
    : Buffer.alloc(0)
  const okContains = expectContains ? text.includes(Buffer.from(expectContains)) : true
  const ok = res.status === expectStatus && (!expectType || type.includes(expectType)) && okContains
  record(name, ok, `status=${res.status} type=${type} bytes=${text.length}`)
  return res
}

/* ── 正常路径 ─────────────────────────────── */
await check('index html', '/api/liyin/index.html', 200, 'text/html', '理音')
await check('styles.css', '/api/liyin/styles.css', 200, 'text/css')
await check('app.js', '/api/liyin/app.js', 200, 'javascript')
await check('audio asset', '/api/liyin/assets/audio/ai-demo.mp3', 200, 'audio/mpeg')
await check('path traversal', '/api/liyin/../package.json', 404, 'application/json')
await check('missing file', '/api/liyin/nope.js', 404, 'application/json')

const health = await callHealth(trustedReq('/api/liyin/health'))
record('health route', health.status === 200, `status=${health.status}`)

/* ── 防护：必须拦截的请求 ─────────────────── */
if (isTrustedApiRequest) {
  // 恶意网页跨站调用
  const crossSite = trustedReq('/api/liyin/index.html')
  crossSite.headers['sec-fetch-site'] = 'cross-site'
  const r1 = await call('/api/liyin/index.html', 'GET', crossSite)
  record('reject cross-site', r1.status === 403, `status=${r1.status}`)

  // 另一站点页面发起（Origin 不等于 Host）
  const foreignOrigin = trustedReq('/api/liyin/index.html')
  foreignOrigin.headers.origin = 'https://evil.example'
  const r2 = await call('/api/liyin/index.html', 'GET', foreignOrigin)
  record('reject foreign origin', r2.status === 403, `status=${r2.status}`)

  // DNS rebinding：Host 是攻击者域名，但连接落到了本机
  const rebound = trustedReq('/api/liyin/index.html')
  rebound.headers.host = 'evil.example'
  rebound.headers.origin = 'https://evil.example'
  const r3 = await call('/api/liyin/index.html', 'GET', rebound)
  record('reject rebound host', r3.status === 403, `status=${r3.status}`)

  // 沙箱 iframe / file: 页面的不透明 Origin
  const opaque = trustedReq('/api/liyin/index.html')
  opaque.headers.origin = 'null'
  const r4 = await call('/api/liyin/index.html', 'GET', opaque)
  record('reject opaque origin', r4.status === 403, `status=${r4.status}`)

  // 健康检查同样受保护，不能当探测入口
  const r5 = await callHealth(rebound)
  record('reject rebound on health', r5.status === 403, `status=${r5.status}`)

  // 同源 iframe（带 Origin，且与 Host 一致）必须放行
  const sameOrigin = trustedReq('/api/liyin/index.html')
  sameOrigin.headers.origin = 'http://127.0.0.1:58238'
  const r6 = await call('/api/liyin/index.html', 'GET', sameOrigin)
  record('allow same origin', r6.status === 200, `status=${r6.status}`)

  // 同站子资源（音频、脚本）同样放行
  const audioReq = trustedReq('/api/liyin/assets/audio/ai-demo.mp3')
  audioReq.headers.origin = 'http://127.0.0.1:58238'
  const r7 = await call('/api/liyin/assets/audio/ai-demo.mp3', 'GET', audioReq)
  record('allow same-origin audio', r7.status === 200, `status=${r7.status}`)
}

/* ── 防护：connection 服务缺失时不得裸奔 ──── */
{
  const bare = []
  const bareCtx = {
    webServer: { register: (r) => bare.push(r) },
    logger: { warn: () => {} },
  }
  apply(bareCtx)
  const route = bare.find((r) => r.kind === 'prefix')
  const res = fakeRes()
  await route.handler(trustedReq('/api/liyin/index.html'), res)
  record('refuse without connection', res.status === 503, `status=${res.status}`)
}

/* ── 代理（需要本地 ACE-Step 在 8001） ─────── */
const proxied = await call('/api/liyin/ace/health')
let proxyOk = false
try {
  const body = JSON.parse(Buffer.from(proxied.body).toString('utf8'))
  proxyOk = proxied.status === 200 && body?.data?.status === 'ok'
} catch {}
checks.push({ name: 'ace proxy health (needs model server)', ok: proxyOk })

/* ── 汇总 ─────────────────────────────────── */
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
}
console.log()
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`)
}
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exitCode = failed ? 1 : 0
