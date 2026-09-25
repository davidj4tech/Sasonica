// The reply box's reading chip (§6.3 `keep_reading`): hidden while nothing
// is read, and in a thread that is not the one being read; "Stops reading"
// while this thread speaks or is paused, and a plain send carries no
// `keep_reading`; a tap gives "Keep reading", that one send carries
// `keep_reading: true`, and the chip is back to "Stops reading". Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/reply?delay=0&skew=0&flatten=0&fail=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const last = async () => (await fetch(BASE + '/mock/last-send')).json()
const ctl = (action) => fetch(BASE + '/speech/ctl', { method: 'POST', headers: H, body: JSON.stringify({ action }) })
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const chip = () => page.locator('.reading-chip')
const chipText = async () => ((await chip().count()) ? (await chip().innerText()).trim() : null)
/** The chip's words once they settle on `want` (null: gone), or what they were at the end. */
const until = async (want, ms) => {
  let got
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    got = await chipText()
    if (got === want) return got
    await page.waitForTimeout(200)
  }
  return got
}
const send = async (text) => {
  await page.locator('.composer textarea').fill(text)
  await page.locator('.composer textarea').press('Control+Enter')
  for (const t0 = Date.now(); Date.now() - t0 < 4000; ) {
    if ((await last())?.text === text) return last()
    await page.waitForTimeout(100)
  }
  return last()
}
const speaking = sid('Mock: speaking now')

// 1. Nothing being read: no chip.
await fetch(BASE + '/mock/voice?loop=0')
await ctl('jump-end')
await page.goto(BASE + '/t/' + speaking)
await page.waitForSelector('.composer textarea')
await page.waitForTimeout(6000) // past an idle /speech/now poll
ok((await chipText()) === null, 'nothing is being read: no chip')

// 2. This thread speaks: "Stops reading"; paused, still there.
await fetch(BASE + '/mock/voice?loop=1')
ok((await until('Stops reading', 20000)) === 'Stops reading', 'this thread speaks: "Stops reading"')
await page.screenshot({ path: SHOTS + '/keepreading-01-stops.png' })
await ctl('toggle')
await page.waitForTimeout(2500)
ok((await chipText()) === 'Stops reading', 'paused: the chip stays')
await ctl('toggle')

// 3. A plain send carries no keep_reading.
const plain = await send('a plain reply')
ok(plain?.text === 'a plain reply' && !('keep_reading' in plain), 'a plain send has no keep_reading')

// 4. A tap: "Keep reading", that send carries it, then back to the default.
await chip().tap()
ok((await chipText()) === 'Keep reading', 'a tap: "Keep reading"')
ok(await chip().evaluate((el) => el.classList.contains('on') && el.getAttribute('aria-pressed') === 'true'), 'shown as on')
await page.screenshot({ path: SHOTS + '/keepreading-02-keep.png' })
const kept = await send('keep going')
ok(kept?.text === 'keep going' && kept.keep_reading === true, 'the next send carries keep_reading: true')
ok((await until('Stops reading', 3000)) === 'Stops reading', 'after that send: "Stops reading" again')
const next = await send('and one more')
ok(next?.text === 'and one more' && !('keep_reading' in next), 'the send after has none (one send only)')

// 5. Another thread while this one is read: no chip there.
await page.goto(BASE + '/t/' + sid('Mock: not on the shelf yet'))
await page.waitForSelector('text=A brand new chat.')
await page.waitForSelector('.composer textarea')
await page.waitForTimeout(2500)
ok((await chipText()) === null, 'another thread while this one is read: no chip')

await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
