// READ-ONLY check against a real canvas: open one thread's stream in the
// built app, headless, and see what renders. Every request to the canvas
// that is not a GET (or a CORS preflight) is ABORTED here, so nothing is
// typed, answered, drafted or played. Not part of run.mjs.
//
//   CANVAS=http://100.103.43.93:8781 TOKEN=<device token> SESSION=<id> \
//   APP=http://127.0.0.1:8820 WATCH_S=120 node test/live.mjs
//
// APP serves the built bundle (the mock does, or serve.mjs). While it
// watches, it stats the session's transcript on this host (red5) every
// 50 ms and times each growth to the next change in the rendered thread:
// the transcript write → render latency the stream is for.
import { statSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { chromium, SHOTS } from './lib.mjs'

const CANVAS = process.env.CANVAS
const TOKEN = process.env.TOKEN
const SESSION = process.env.SESSION
const APP = process.env.APP || 'http://127.0.0.1:8820'
const WATCH_S = Number(process.env.WATCH_S || 60)
if (!CANVAS || !TOKEN || !SESSION) throw new Error('CANVAS, TOKEN and SESSION are required')
const canvasOrigin = new URL(CANVAS).origin

function transcriptOf(sid) {
  const root = path.join(homedir(), '.claude', 'projects')
  if (!existsSync(root)) return null
  for (const d of readdirSync(root)) {
    const f = path.join(root, d, `${sid}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}

const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
const blocked = []
const seen = []
await page.route(`${canvasOrigin}/**`, (r) => {
  const m = r.request().method()
  if (m !== 'GET' && m !== 'OPTIONS') {
    blocked.push(`${m} ${new URL(r.request().url()).pathname}`)
    return r.abort()
  }
  seen.push(`${m} ${new URL(r.request().url()).pathname}`)
  return r.continue()
})
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(APP + '/settings')
await page.evaluate(([base, token]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token, device_id: 'live-check', name: 'live-check', server: { name: 'canvas', base }, pairedAt: Date.now() }))
}, [CANVAS, TOKEN])

const t0 = Date.now()
await page.goto(APP + '/t/' + SESSION)
await page.waitForSelector('.msg', { timeout: 30000 })
const firstMsg = Date.now() - t0
await page.waitForFunction(() => !document.querySelector('.bar .updating'), null, { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)
const shape = await page.evaluate(() => ({
  msgs: document.querySelectorAll('.msg').length,
  groups: document.querySelectorAll('.work-group').length,
  groupHeads: [...document.querySelectorAll('.work-head')].slice(-4).map((h) => h.textContent.trim()),
  thoughts: document.querySelectorAll('.thought').length,
  thinking: document.querySelectorAll('.thinking').length,
  steps: document.querySelectorAll('.step').length,
  live: !!document.querySelector('.live-text'),
  keys: document.querySelectorAll('.msg-key').length,
  pictures: document.querySelectorAll('.picture').length,
  nodes: document.querySelectorAll('.viewport *').length,
  transport: document.querySelector('.bar .updating')?.textContent || 'stream'
}))
console.log(`  first message on screen after ${firstMsg} ms`)
console.log('  rendered:', JSON.stringify(shape))
await page.screenshot({ path: `${SHOTS}/live-01-open.png` })

// One "Thinking" opened, one "Worked" block opened (read-only, local UI).
const thinking = page.locator('.thinking').last()
if (await thinking.count()) {
  await thinking.locator('.thinking-head').click()
  console.log('  a Thinking part says:', JSON.stringify((await thinking.locator('.thinking-text').innerText()).slice(0, 200)))
}
const group = page.locator('.work-group').last()
if (await group.count()) {
  await group.locator('.work-head').click()
  await page.waitForTimeout(200)
  console.log('  last Worked block opened:', JSON.stringify(await group.evaluate((g) => ({ steps: g.querySelectorAll('.step').length, thoughts: g.querySelectorAll('.thought').length, thinking: g.querySelectorAll('.thinking').length, titles: [...g.querySelectorAll('.step-title')].slice(0, 5).map((x) => x.textContent) }))))
  await group.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/live-02-worked.png` })
  await group.locator('.work-head').click()
}

// Transcript write → render.
const file = transcriptOf(SESSION)
await page.evaluate(() => {
  window.__changes = []
  const vp = document.querySelector('.viewport')
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement
      if (!el || !el.closest('.msg') || el.closest('.footer') || el.closest('.working')) continue
      window.__changes.push(Date.now())
      return
    }
  })
  mo.observe(vp, { childList: true, subtree: true, characterData: true })
})
const growths = []
if (file) {
  let size = statSync(file).size
  let quietSince = Date.now()
  const until = Date.now() + WATCH_S * 1000
  console.log(`  watching ${path.basename(file)} for ${WATCH_S} s…`)
  while (Date.now() < until) {
    const now = statSync(file).size
    if (now !== size) {
      // A burst's first write, after a second of quiet.
      if (Date.now() - quietSince > 1000) growths.push(Date.now())
      size = now
      quietSince = Date.now()
    }
    await new Promise((r) => setTimeout(r, 50))
  }
} else console.log('  (no transcript on this host for that session; no latency measured)')
const changes = await page.evaluate(() => window.__changes)
const lat = growths.map((g) => { const c = changes.find((t) => t >= g); return c && c - g < 10000 ? c - g : null }).filter((x) => x !== null).sort((a, z) => a - z)
console.log(`  transcript growths: ${growths.length}; rendered after: ${JSON.stringify(lat)} ms` + (lat.length ? ` (median ${lat[Math.floor(lat.length / 2)]} ms)` : ''))
await page.screenshot({ path: `${SHOTS}/live-03-after.png` })
console.log('  canvas requests:', JSON.stringify([...new Set(seen)]))
console.log('  blocked (non-GET):', JSON.stringify(blocked))
await b.close()
