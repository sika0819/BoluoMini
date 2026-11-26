import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { dirname, extname, join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { readCard, say, voiceStatus } from './say.mjs'

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
const port = Number(process.env.PORT || 4173)

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 4096) {
        reject(new Error('too big'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

async function handleSay(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 404, { text: null })
    return
  }
  try {
    const raw = await readBody(req)
    const body = JSON.parse(raw)
    const card = readCard(body)
    const text = card.intent ? await say(card) : null
    sendJson(res, 200, { text })
  } catch {
    sendJson(res, 200, { text: null })
  }
}

function onRequest(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/api/say') {
    void handleSay(req, res)
    return
  }
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const path = resolve(root, rel)
  const base = resolve(root)
  if (path !== base && !path.startsWith(base + sep)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
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
}

createServer(onRequest).listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`)
  console.log(voiceStatus())
})
