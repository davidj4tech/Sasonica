// The bold follows the PLAYER, not the ahead-running `elapsed`, and is not
// dragged behind by /speech/now's stale pos. Mock with MOCK_REAL_VOICE=1:
// player = 0.98 × elapsed − 1.4 s; pos a ≤1 s old snapshot answered 1.5 s
// late (red5, 22 Sep 2026).
import { chromium } from './lib.mjs'
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
const page = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage()
await page.route('**/input', (r) => r.abort())
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const startAt = Date.now() / 1000 + 2
await fetch(BASE + '/mock/real/restart?in=2')
await page.goto(BASE + '/t/' + real)
await page.waitForSelector('.live-text .sentence.now', { timeout: 15000 })
await page.waitForTimeout(22000) // let the skew estimate settle
const diffs = []
for (let i = 0; i < 20; i++) {
  const idx = await page.evaluate(() => { const all = [...document.querySelectorAll('.live-text .sentence')]; return all.indexOf(document.querySelector('.live-text .sentence.now')) })
  const e = Date.now() / 1000 - startAt
  const want = Math.floor((player(e) + LEAD) / STEP)
  const byElapsed = Math.floor((e + LEAD) / STEP)
  diffs.push({ idx, want, byElapsed })
  await page.waitForTimeout(800)
}
const d = diffs.map((x) => x.idx - x.want)
const mean = d.reduce((a, x) => a + x, 0) / d.length
console.log('  bold − player sentence:', JSON.stringify(d), 'mean', mean.toFixed(2))
ok(d.every((x) => Math.abs(x) <= 1), 'bold within a sentence of the player throughout')
ok(mean > -0.35 && mean < 0.5, `not systematically behind or ahead (mean ${mean.toFixed(2)} sentences, a sentence is ${STEP.toFixed(1)} s)`)
ok(diffs.some((x) => x.byElapsed > x.want), 'the uncorrected clock would have run ahead (the case is real)')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0)
