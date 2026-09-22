// Tapping "Follow along" re-reads where the voice is, not just where the
// words are. The mock moves the player on by 10 s without moving `elapsed`
// (a skip taken at the desk, a media key): the bold is left behind the
// voice, and the skew window — eight answers, ~12 s — would take that long
// to notice on its own. The pill drops the window and asks at once.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8812'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const LEN = 70, N = 22, STEP = LEN / N, LEAD = 0.5, JUMP = 10
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
const voiceIdx = (jump) => Math.floor((Math.max(0, player(Date.now() / 1000 - startAt) + jump) + LEAD) / STEP)

await page.waitForTimeout(16000) // the skew estimate settles on the true lead
ok(Math.abs((await boldIdx()) - voiceIdx(0)) <= 1, 'before the skip: the bold is on the voice')

await fetch(BASE + `/mock/real/jump?by=${JUMP}`)
await page.waitForTimeout(3500) // two /speech/now answers: the window still holds the old lead
const behind = voiceIdx(JUMP) - (await boldIdx())
ok(behind >= 2, `the skip left the bold ${behind} sentences behind the voice`)

// A hand on the screen, so the pill is there to tap.
await page.evaluate(() => document.querySelector('.viewport').dispatchEvent(new Event('touchmove')))
await page.waitForTimeout(300)
ok(await page.locator('.follow-pill:not(.new-below)').isVisible(), '"Follow along" pill after a touch drag')
await page.locator('.follow-pill:not(.new-below)').click()
await page.waitForTimeout(2500) // the asked-for answer, and the 250 ms follow tick
const after = voiceIdx(JUMP) - (await boldIdx())
console.log(`  behind before ${behind}, after ${after} sentences (a sentence is ${STEP.toFixed(1)} s)`)
ok(Math.abs(after) <= 1, `the tap put the bold back on the voice (${after} sentences out)`)
const onScreen = await page.evaluate(() => {
  const vp = document.querySelector('.viewport')
  const r = vp.querySelector('.live-text .sentence.now')?.getBoundingClientRect()
  const foot = vp.querySelector('.footer')
  const v = vp.getBoundingClientRect()
  const bottom = foot ? Math.min(v.bottom, foot.getBoundingClientRect().top) : v.bottom
  return !!r && r.top >= v.top - 2 && r.top <= bottom
})
ok(onScreen, 'and back on screen, as the pill always did')
await page.screenshot({ path: `${SHOTS}/resync.png` })

await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
