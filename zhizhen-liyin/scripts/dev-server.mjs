#!/usr/bin/env node
/** Local harness: serve the plugin routes on :8099 to verify the embedded app path. */
import http from 'node:http'
import { apply } from '../index.js'

const routes = []
apply({ webServer: { register: (r) => routes.push(r) }, logger: console })

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  const match = routes
    .filter((r) => (r.kind === 'prefix' ? pathname === r.path || pathname.startsWith(r.path + '/') : pathname === r.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!match) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('not found')
  }
  try {
    await match.handler(req, res)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(error))
  }
})
server.listen(8099, '127.0.0.1', () => console.log('liyin plugin harness → http://127.0.0.1:8099/api/liyin/index.html'))
