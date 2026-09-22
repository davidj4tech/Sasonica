// The speech bar after a reply ends: a slim one-line strip, "▶ Replay ·
// <title>", about half the bar (≤ 36 px at any text size, ~30 at Default)
// with 44 px hit areas, in portrait, landscape and Larger; the full bar is
// back when the voice speaks again; gone after ~30 s.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const ctl = (action, arg) => fetch(BASE + '/speech/ctl', { method: 'POST', headers: H, body: JSON.stringify(arg ? { action, arg } : { action }) })
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage()
await page.route('**/input', (r) => r.abort())
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); }, [BASE, pr])
await page.goto(BASE + '/')
await page.waitForSelector('.thread-row')
const bar = () => page.evaluate(() => {
  const b = document.querySelector('.speech-bar')
  if (!b) return null
  const r = b.getBoundingClientRect()
  // The hit area: what a tap 6 px above and below the strip lands on (the
  // screen's edge where the strip sits at the foot, as in landscape).
  const key = b.querySelector('[aria-label=Replay]')
  const x = key ? key.getBoundingClientRect().left + 30 : 0
  const hit = (y) => { const el = document.elementFromPoint(x, y); return !!el && !!key && key.contains(el) }

  return { text: b.innerText.replace(/\s+/g, ' ').trim(), slim: b.classList.contains('slim'), h: Math.round(r.height), lines: b.querySelectorAll('.speech-sentence, .speech-progress').length, hit: hit(r.top - 6) && hit(Math.min(r.bottom + 6, innerHeight - 1)), wide: document.documentElement.scrollWidth > innerWidth + 1, root: getComputedStyle(document.documentElement).fontSize }
})
const seen = []
await fetch(BASE + '/mock/voice?loop=0')
// The speaking fixture's long reply, by history id: "replay the latest" could
// pick a short reply another suite just sent, over before a poll sees it.
const tg = await (await fetch(BASE + '/targets', { headers: H })).json()
const speaking = tg.sessions.find((s) => s.title === 'Mock: speaking now').session
await ctl('jump-end')
await new Promise((r) => setTimeout(r, 500))
const lg = await (await fetch(BASE + '/conversation/log?session=' + speaking, { headers: H })).json()
const longId = lg.lines.filter((l) => l.who === 'agent' && l.id).pop().id
const LAYOUTS = [
  ['portrait', { width: 390, height: 780 }, 17],
  ['landscape', { width: 844, height: 390 }, 17],
  ['portrait-larger', { width: 390, height: 780 }, 22],
  ['landscape-larger', { width: 844, height: 390 }, 22]
]
for (const [name, vp, px] of LAYOUTS) {
  await page.setViewportSize(vp)
  await page.evaluate((px) => document.documentElement.style.setProperty('--text-size', px + 'px'), px)
  await ctl('replay-id', longId)
  await page.waitForFunction(() => document.querySelector('.speech-bar .skey.main')?.getAttribute('aria-label') === 'Pause', null, { timeout: 12000 })
  const full = await bar()
  await ctl('jump-end')
  await page.waitForFunction(() => document.querySelector('.speech-bar.slim [aria-label=Replay]'), null, { timeout: 12000 })
  const s = await bar()
  seen.push(s)
  console.log(`  ${name}: speaking ${full.h}px, finished ${JSON.stringify(s)}`)
  ok(!full.slim && full.h >= 44, `${name}: the full bar while speaking (${full.h}px)`)
  ok(s.slim && s.text.startsWith('Replay') && s.text.includes('Mock: speaking now') && !s.text.includes('Finished') && s.lines === 0, `${name}: finished = one line, "▶ Replay · title", no progress or sentence`)
  ok(s.h <= 36 && s.h <= full.h * 0.7 && (px > 17 || (s.h >= 28 && s.h <= 32)), `${name}: slim strip ${s.h}px (≤ 36, ~half of ${full.h})`)
  ok(s.hit, `${name}: Replay's hit area reaches 6 px past the strip (≥ 44 px)`)
  ok(!s.wide, `${name}: no sideways scroll`)
  await page.screenshot({ path: SHOTS + `/finished-${name}.png` })
}
// Something speaks again: the full bar is back
await ctl('replay-id', longId)
await page.waitForFunction(() => { const b = document.querySelector('.speech-bar'); return b && !b.classList.contains('slim') && b.querySelector('.skey.main')?.getAttribute('aria-label') === 'Pause' }, null, { timeout: 12000 })
ok(true, 'speaking again: the full bar is back')
await page.setViewportSize({ width: 390, height: 780 })
await page.evaluate(() => document.documentElement.style.removeProperty('--text-size'))
// And in a thread: the strip over the composer
await page.goto(BASE + '/t/' + speaking)
await page.waitForSelector('.composer')
await ctl('jump-end')
await page.waitForSelector('.speech-bar.slim', { timeout: 12000 })
const inThread = await bar()
ok(inThread.slim && inThread.h <= 32 && inThread.hit, `in a thread: the slim strip over the composer (${inThread.h}px)`)
await page.screenshot({ path: SHOTS + '/finished-thread.png' })
const t0 = Date.now()
await page.waitForFunction(() => !document.querySelector('.speech-bar'), null, { timeout: 45000 })
const gone = (Date.now() - t0) / 1000
ok(gone > 20 && gone < 40, `finished bar lingers ~30 s (gone after ${gone.toFixed(0)} s)`)
await fetch(BASE + '/mock/voice?loop=1') // leave the mock voice looping, as it started
await ctl('replay-id', longId)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
