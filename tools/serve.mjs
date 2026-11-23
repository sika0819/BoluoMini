import { createServer, request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { readFileSync, existsSync } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
}
const port = 4173
function readEnv() {
  try {
    return JSON.parse(readFileSync(join(root, 'boluo-env.json'), 'utf8'))
  } catch {
    return { api: 'https://wanos-common-dev.wanos.vip' }
  }
}

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname.startsWith('/wanos-api/')) {
    const target = new URL(readEnv().api.replace(/\/$/, '') + url.pathname.slice('/wanos-api'.length) + url.search)
    const headers = { ...req.headers, host: target.host }
    delete headers['accept-encoding']
    const lib = target.protocol === 'https:' ? httpsRequest : httpRequest
    const proxy = lib(target, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    })
    proxy.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end('proxy error')
    })
    req.pipe(proxy)
    return
  }
  let path = join(root, decodeURIComponent(url.pathname))
  if (url.pathname === '/') path = join(root, 'index.html')
  if (!existsSync(path)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, {
    'Content-Type': types[extname(path)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  res.end(readFileSync(path))
}).listen(port, () => {
  console.log(`http://localhost:${port}`)
})
