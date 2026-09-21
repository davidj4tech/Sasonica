// A preview server for the built bundle: static files, the SPA fallback, and
// a /pair link that gets the phone a credential without typing one.
//
// Not the app's future home -- that is the Capacitor shell -- but the way to
// hold the prototype on a phone before it is one.
//
// DEVICE PAIRING (the default; server-contract.md §9). Mint a code at the
// desk with `media-visual-canvas pair --device NAME --host <canvas ip>`, then
// open  http://<this host>:<port>/pair?c=<code>  on the phone. This server
// never sees a token: it redirects to the app's own auto-pair address,
// /?pair=<code>&server=<canvas base>, and the app redeems the code with the
// canvas's POST /pair itself. No SASONICA_CHAT_TOKEN needed.
//
//   --canvas <base>          the canvas the app pairs with (or
//                            SASONICA_CHAT_CANVAS); default http://<host>:8781
//
// LEGACY TOKEN MODE (only when SASONICA_CHAT_TOKEN is set): the same /pair
// path also takes this server's own short-lived code, whose page stores that
// bearer (an Audiobookshelf token) in the browser. The token stays on this
// host and only the code travels. Its code is printed on stdout and written
// to $XDG_RUNTIME_DIR/sasonica-chat-pair (mode 600). A /pair?c= that is not
// this server's code is taken to be a device code and passed through.
//
//   SASONICA_CHAT_TOKEN      the bearer to hand over (read from the env, never
//                            logged)
//   node serve.mjs --host <ip> --port <n> [--canvas <base>]

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
const CANVAS = (arg('canvas', process.env.SASONICA_CHAT_CANVAS || '') || `http://${HOST}:8781`).replace(/\/+$/, '')
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
      const code = url.searchParams.get('c') || url.searchParams.get('code') || ''
      // Legacy: this server's own code. Good for its whole window, not
      // once: a phone browser can load a link twice (a preview, a reload
      // after the redirect), and a one-shot code then greets the person
      // with "expired" on their very first tap. The server is
      // tailnet-bound, and 8 hex digits in 30 minutes is not a guessing
      // game anyone can win from there.
      if (pair && code === pair.code && Date.now() - pair.at < PAIR_TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(pairPage())
      }
      // Anything else is a device code (§9): the app redeems it with the
      // canvas; this server only points the way. The canvas judges the code
      // (a wrong one is its 403, shown by the app).
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        return res.end('no pairing code: open /pair?c=<code> from `media-visual-canvas pair --device NAME`\n')
      }
      const server = (url.searchParams.get('server') || CANVAS).replace(/\/+$/, '')
      res.writeHead(302, { Location: `/?pair=${encodeURIComponent(code)}&server=${encodeURIComponent(server)}`, 'Cache-Control': 'no-store' })
      return res.end()
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
  console.log(`device pairing with ${CANVAS}: media-visual-canvas pair --device NAME, then open http://${HOST}:${PORT}/pair?c=<code>`)
  if (pair) {
    const link = `http://${HOST}:${PORT}/pair?c=${pair.code}`
    console.log(`legacy token pair (30 min): ${link}`)
    const dir = process.env.XDG_RUNTIME_DIR
    if (dir) await writeFile(path.join(dir, 'sasonica-chat-pair'), link + '\n', { mode: 0o600 }).catch(() => {})
  }
})
