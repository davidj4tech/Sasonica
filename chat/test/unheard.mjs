// A held reply's play key is the big one; the list and home mark the
// conversation the voice is on. Run against a mock with MOCK_UNHEARD=1.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8816'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
const posts = []
page.on('request', (r) => { if (r.method() === 'POST') posts.push({ p: new URL(r.url()).pathname, body: r.postData() }) })
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])

// The big key on the held reply, the faint one on the reply before it.
await page.goto(BASE + '/t/' + sid('Mock: shelved conversation'))
await page.waitForSelector('.msg.agent .msg-key')
const keys = await page.evaluate(() => [...document.querySelectorAll('.msg.agent')].map((m) => { const k = m.querySelector('.msg-keys .msg-key:last-child'); const r = k.getBoundingClientRect(); return { unheard: k.classList.contains('unheard'), w: Math.round(r.width) } }))
ok(keys.length >= 2 && keys.at(-1).unheard && !keys[0].unheard, `only the held reply is unheard (${JSON.stringify(keys)})`)
ok(keys.at(-1).w >= 60 && keys[0].w <= 44, `its key is big (${keys.at(-1).w}px vs ${keys[0].w}px)`)
await page.screenshot({ path: `${SHOTS}/unheard-thread.png` })
await page.locator('.msg-key.unheard').last().click()
await page.waitForTimeout(300)
ok(posts.some((p) => p.p === '/speech/ctl' && JSON.parse(p.body).action === 'replay-id'), 'the big key replays that row (replay-id)')

// The list: bars on the conversation being said.
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row')
await page.waitForSelector('.playing-mark', { timeout: 8000 }).catch(() => {})
const marks = await page.evaluate(() => [...document.querySelectorAll('.thread-row')].filter((r) => r.querySelector('.playing-mark')).map((r) => ({ title: r.querySelector('.title').textContent, state: r.querySelector('.playing-mark').className })))
ok(marks.length >= 1, `the list marks the conversation the voice is on (${JSON.stringify(marks)})`)
await page.locator('.thread-row:has(.playing-mark)').first().scrollIntoViewIfNeeded()
await page.screenshot({ path: `${SHOTS}/playing-threads.png` })

// Home: the Tabs, not the address — `/` reopens the last screen.
await page.locator('.tabs .tab', { hasText: 'Home' }).click()
await page.waitForSelector('.dash', { timeout: 8000 })
await page.waitForTimeout(1500)
const home = await page.evaluate(() => ({ marks: document.querySelectorAll('.dash .playing-mark').length, link: !!document.querySelector('.listening-thread') }))
ok(home.link, `home: the Listening line links to the thread being said (${JSON.stringify(home)})`)
await page.screenshot({ path: `${SHOTS}/playing-home.png`, fullPage: true })

await b.close()
console.log(`shots in ${SHOTS}`)
process.exit(fails ? 1 : 0)
