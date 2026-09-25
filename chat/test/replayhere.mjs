// Replay replays the thread the bar names, never "the newest of all" (§6.5
// `session` on `replay`, 25 Sep 2026): the finished strip's Replay, pressed
// inside a thread or not, sends the session of the reply it is labelled
// with. Unscoped, a reply held in another thread was read out instead —
// question first. Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const ctl = (action) => fetch(BASE + '/speech/ctl', { method: 'POST', headers: H, body: JSON.stringify({ action }) })
const replays = async () => (await (await fetch(BASE + '/mock/speech/log')).json()).filter((e) => e.action === 'replay')
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const speaking = sid('Mock: speaking now')

// The speaking thread finishes while the page watches: the bar becomes the
// slim Replay strip, named for it.
for (const [where, label] of [[speaking, 'in the thread it came from'], [sid('Mock: not on the shelf yet'), 'in another thread']]) {
  await fetch(BASE + '/mock/voice?loop=1')
  await page.goto(BASE + '/t/' + where)
  await page.waitForSelector('.composer textarea')
  await page.waitForSelector('.speech-bar:not(.slim)', { timeout: 20000 }).catch(() => {})
  await fetch(BASE + '/mock/voice?loop=0')
  await ctl('jump-end')
  const strip = page.locator('.slim-replay')
  await strip.waitFor({ timeout: 20000 }).catch(() => {})
  if (!(await strip.count())) { ok(false, `${label}: the Replay strip shows`); continue }
  await fetch(BASE + '/mock/speech/log?clear=1')
  await strip.tap()
  let r = []
  for (const t0 = Date.now(); Date.now() - t0 < 4000 && !r.length; ) { await page.waitForTimeout(150); r = await replays() }
  ok(r.length === 1 && r[0].session === speaking, `${label}: Replay names the reply's own thread (${JSON.stringify(r[0] || null)})`)
}
await page.screenshot({ path: SHOTS + '/replayhere-01.png' })
await fetch(BASE + '/mock/voice?loop=1')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
