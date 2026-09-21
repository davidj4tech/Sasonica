import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8812'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const real = targets.sessions.find((s) => s.title.startsWith('Mock: real speech (streaming')).session
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage()
await page.route('**/input', (r) => r.abort())
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
await fetch(BASE + '/mock/real/restart?in=2')
await page.goto(BASE + '/t/' + real)
await page.waitForSelector('.live-text .sentence.now', { timeout: 15000 })
await page.waitForTimeout(30000)
const idx = await page.evaluate(() => { const all = [...document.querySelectorAll('.live-text .sentence')]; return all.indexOf(document.querySelector('.live-text .sentence.now')) })
const now = await (await fetch(BASE + '/speech/now', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
// sentence step is 70/22 s ≈ 3.18 s; the player is at pos → sentence floor(pos/3.18); elapsed says pos/0.75
const byPos = Math.floor((now.pos + 0.5) / (70 / 22)), byElapsed = Math.floor((now.pos / 0.75) / (70 / 22))
console.log(`  bold ${idx}, player-pos sentence ~${byPos}, elapsed sentence ~${byElapsed}`)
ok(Math.abs(idx - byPos) <= 1 && idx < byElapsed, 'bold follows the player position, not the ahead-running elapsed')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0)
