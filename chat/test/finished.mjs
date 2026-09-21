// The speech bar after a reply ends: the long hint the first 3 times on a
// device, then a compact "▶ Replay" with the title; gone after ~30 s.
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
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); localStorage.removeItem('sasonica.chat.finishedHints') }, [BASE, pr])
await page.goto(BASE + '/')
await page.waitForSelector('.thread-row')
const bar = () => page.evaluate(() => { const b = document.querySelector('.speech-bar'); return b ? { text: b.innerText.replace(/\s+/g, ' ').trim(), compact: b.classList.contains('compact'), sentence: !!b.querySelector('.speech-sentence') } : null })
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
for (let i = 1; i <= 4; i++) {
  await ctl('replay-id', longId)
  await page.waitForFunction(() => document.querySelector('.speech-bar .skey.main')?.getAttribute('aria-label') === 'Pause', null, { timeout: 12000 })
  await ctl('jump-end')
  await page.waitForFunction(() => { const k = document.querySelector('.speech-bar .skey.main'); return k && k.getAttribute('aria-label') === 'Replay' }, null, { timeout: 12000 })
  const s = await bar()
  seen.push(s)
  console.log(`  finish ${i}: ${JSON.stringify(s)}`)
  if (i === 1) await page.screenshot({ path: SHOTS + '/finished-01-full.png' })
  if (i === 4) await page.screenshot({ path: SHOTS + '/finished-04-compact.png' })
}
ok(seen.slice(0, 3).every((s) => !s.compact && s.text.includes('Finished · play to hear it again')), 'first 3 finishes: the full hint')
ok(seen[3].compact && !seen[3].sentence && seen[3].text.includes('Replay') && !seen[3].text.includes('Finished'), '4th: compact "▶ Replay" with the title, no sentence')
ok((await page.evaluate(() => localStorage.getItem('sasonica.chat.finishedHints'))) === '3', 'count kept per device (3)')
const t0 = Date.now()
await page.waitForFunction(() => !document.querySelector('.speech-bar'), null, { timeout: 45000 })
const gone = (Date.now() - t0) / 1000
ok(gone > 20 && gone < 40, `finished bar lingers ~30 s (gone after ${gone.toFixed(0)} s)`)
await fetch(BASE + '/mock/voice?loop=1') // leave the mock voice looping, as it started
await ctl('replay-id', longId)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
