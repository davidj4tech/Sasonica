// The live row is lost while the audio plays on — a barge-in took it, or the
// submit that owned it died (agent-media, 23 Sep 2026). The bold used to stop
// there and stay stopped for the rest of the reply.
//
// What is left is the turn's timeline with no claim to be playing (§6.2
// `spoken.timeline`) and a /speech/now that still knows where the player is
// and which turn it is on (§6.5 `turn`). The app bolds from the player's own
// position instead of an `elapsed` that died with the row.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8812'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const LEN = 70, N = 22, STEP = LEN / N, LEAD = 0.5
const player = (e) => Math.max(0, 0.98 * e - 1.4)

await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const real = targets.sessions.find((s) => s.title.startsWith('Mock: real speech (streaming')).session
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])

const startAt = Date.now() / 1000 + 2
await fetch(BASE + '/mock/real/restart?in=2')
await page.goto(BASE + '/t/' + real)
await page.waitForSelector('.live-text .sentence.now', { timeout: 15000 })

const boldIdx = () => page.evaluate(() => {
  const all = [...document.querySelectorAll('.live-text .sentence')]
  return all.indexOf(document.querySelector('.live-text .sentence.now'))
})
/** Which sentence the voice is really on, from the mock's own player model. */
const voiceIdx = () => Math.floor((player(Date.now() / 1000 - startAt) + LEAD) / STEP)

await page.waitForTimeout(14000)
const beforeBold = await boldIdx()
ok(Math.abs(beforeBold - voiceIdx()) <= 1, `while live, the bold is on the voice (${beforeBold} vs ${voiceIdx()})`)

// The row goes; the player does not.
await fetch(BASE + '/mock/real/lose')
await page.waitForTimeout(4000)
const kept = await boldIdx()
ok(kept >= 0, 'the bold survives losing the live row')
ok(Math.abs(kept - voiceIdx()) <= 1, `and is still on the voice (${kept} vs ${voiceIdx()})`)

// It keeps moving: the position comes from the player, not from a clock that
// died with the row.
const then = await boldIdx()
await page.waitForTimeout(9000)
const later = await boldIdx()
ok(later > then, `the bold moves on without a live row (${then} → ${later})`)
ok(Math.abs(later - voiceIdx()) <= 1, `still on the voice ${9} s later (${later} vs ${voiceIdx()})`)
await page.screenshot({ path: SHOTS + '/lostlive.png' })

// Nothing playing: the timeline is not a claim that it is.
await fetch(BASE + '/mock/real/restart?ended=1')
await page.waitForTimeout(3000)
ok((await page.locator('.live-text .sentence.now').count()) === 0, 'a quiet player bolds nothing')

await b.close()
console.log(fails ? `${fails} check(s) failed` : 'all checks pass')
process.exit(fails ? 1 : 0)
