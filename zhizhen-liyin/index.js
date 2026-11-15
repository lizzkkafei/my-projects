/**
 * Host half of the zhizhen-liyin bundle.
 *
 * Serves the 理音 Liyin Studio web workbench under /api/liyin/* (same origin as
 * the DSH Web GUI, so iframes, audio, recording and AI calls all work), and
 * reverse-proxies /api/liyin/ace/* to the local ACE-Step 1.5 API.
 */
import { readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'zhizhen-liyin'
export const inject = ['webServer']

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = process.env.LIYIN_WEB_DIR || resolve(PACKAGE_ROOT, 'web')
const ACE_UPSTREAM = process.env.LIYIN_ACE_UPSTREAM || 'http://127.0.0.1:8001'
const PREFIX = '/api/liyin'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(data)
}

function safeRoot() {
  try {
    return realpathSync(WEB_DIR)
  } catch {
    return resolve(WEB_DIR)
  }
}

async function serveStatic(req, res) {
  const root = safeRoot()
  let pathname = '/'
  try {
    pathname = new URL(req.url || '/', 'http://dsh.internal').pathname
  } catch {}
  let rel = decodeURIComponent(pathname.slice(PREFIX.length) || '/')
  if (rel === '' || rel === '/') rel = '/index.html'
  const abs = resolve(root, '.' + rel)
  if (abs !== root && !abs.startsWith(root + sep)) {
    return json(res, 400, { error: 'invalid path' })
  }
  try {
    const info = await stat(abs)
    if (!info.isFile()) return json(res, 404, { error: 'not found' })
    const data = await readFile(abs)
    const ext = (abs.split('.').pop() || '').toLowerCase()
    res.writeHead(200, {
      'content-type': MIME['.' + ext] || 'application/octet-stream',
      'content-length': String(data.length),
      'cache-control': 'no-store',
    })
    res.end(data)
  } catch {
    json(res, 404, { error: 'not found' })
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function proxyAce(req, res) {
  const url = new URL(req.url || '/', 'http://dsh.internal')
  const rest = url.pathname.slice((PREFIX + '/ace').length) || '/'
  const target = ACE_UPSTREAM.replace(/\/$/, '') + rest + url.search
  const method = req.method || 'GET'
  try {
    let body
    if (method !== 'GET' && method !== 'HEAD') body = await readBody(req)
    const resp = await fetch(target, {
      method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        accept: req.headers['accept'] || '*/*',
      },
      body,
    })
    const buf = Buffer.from(await resp.arrayBuffer())
    res.writeHead(resp.status, {
      'content-type': resp.headers.get('content-type') || 'application/octet-stream',
      'content-length': String(buf.length),
      'cache-control': 'no-store',
    })
    res.end(buf)
  } catch (error) {
    json(res, 502, { error: 'ACE-Step upstream unavailable', detail: String(error && error.message || error) })
  }
}

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn('[zhizhen-liyin] ctx.webServer unavailable; skipping routes')
    return
  }
  webServer.register({
    kind: 'exact',
    path: PREFIX + '/health',
    handler: async (_req, res) => {
      json(res, 200, { ok: true, plugin: 'zhizhen-liyin', version: '1.0.0', webDir: WEB_DIR, ace: ACE_UPSTREAM })
    },
  })
  webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://dsh.internal')
        if (url.pathname.startsWith(PREFIX + '/ace/')) return await proxyAce(req, res)
        if (url.pathname === PREFIX || url.pathname === PREFIX + '/') {
          // 根路径重定向到 index.html，保证相对资源解析正确
          res.writeHead(302, { location: PREFIX + '/index.html', 'cache-control': 'no-store' })
          return res.end()
        }
        return await serveStatic(req, res)
      } catch (error) {
        json(res, 500, { error: String(error && error.message || error) })
      }
    },
  })
}
