// A preview server for the built bundle: static files, the SPA fallback, and
// a one-time pairing link that puts a login token into the browser.
//
// Not the app's future home -- that is the Capacitor shell -- but the way to
// hold the prototype on a phone before it is one. The token problem is the
// same one the canvas's /pair solves: typing a long bearer on a phone keyboard
// is miserable, and pasting it into a chat puts it in a transcript. So the
// token stays on this host, and what travels is a short code that works once
// and expires.
//
//   SASONICA_CHAT_TOKEN      the bearer to hand over (read from the env, never
//                            logged)
//   node serve.mjs --host <ip> --port <n>
//
// The code is printed on stdout and written to $XDG_RUNTIME_DIR/sasonica-chat-pair
// (mode 600), so whoever runs this can pass the link on.

import { createServer } from 'node:http'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build', 'client')
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const HOST = arg('host', '127.0.0.1')
const PORT = Number(arg('port', 8795))
const TOKEN = (process.env.SASONICA_CHAT_TOKEN || '').trim()
const PAIR_TTL_MS = 30 * 60 * 1000

let pair = TOKEN ? { code: randomBytes(4).toString('hex'), at: Date.now() } : null

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

async function file(res, p, cache) {
  const body = await readFile(p)
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream',
    'Cache-Control': cache,
  })
  res.end(body)
}

// The page that stores the token and moves on. The token is JSON-encoded and
// its `<` escaped, so nothing in it can close the script.
function pairPage() {
  const t = JSON.stringify(TOKEN).replace(/</g, '\\u003c')
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Pairing</title><script>
try { localStorage.setItem('sasonica.chat.token', ${t}); location.replace('/'); }
catch (e) { document.body.textContent = 'Could not store the token: ' + e.message; }
</script>`
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname === '/pair') {
      const ok = pair && url.searchParams.get('c') === pair.code && Date.now() - pair.at < PAIR_TTL_MS
      // Spent on first use, right or wrong: a guess costs the code.
      pair = null
      if (!ok) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        return res.end('invalid or expired pairing code\n')
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(pairPage())
    }
    const p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)))
    if (p.startsWith(ROOT + path.sep) && (await stat(p).catch(() => null))?.isFile()) {
      return await file(res, p, url.pathname.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache')
    }
    // Everything else is a route the SPA owns.
    return await file(res, path.join(ROOT, 'index.html'), 'no-cache')
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('server error\n')
  }
}).listen(PORT, HOST, async () => {
  console.log(`sasonica chat preview on http://${HOST}:${PORT}/`)
  if (pair) {
    const link = `http://${HOST}:${PORT}/pair?c=${pair.code}`
    console.log(`pair (once, 30 min): ${link}`)
    const dir = process.env.XDG_RUNTIME_DIR
    if (dir) await writeFile(path.join(dir, 'sasonica-chat-pair'), link + '\n', { mode: 0o600 }).catch(() => {})
  }
})
