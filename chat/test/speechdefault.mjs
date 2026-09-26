// Default speech priority (§6.4 /speech/default): Settings shows the four
// levels with the server's pressed, says it is saved on the server (every
// device), and a pick is what /speech/default and a thread without a level
// of its own answer afterwards; the thread menu's item is "Speech priority…".
import { chromium } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const auth = { Authorization: `Bearer ${pr.token}` }

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])
await page.goto(BASE + '/settings')
const box = page.getByTestId('speech-default')
await box.waitFor()
ok((await box.locator('legend').innerText()) === 'Default speech priority', 'Settings has "Default speech priority"')
const pressed = async () => box.locator('button[aria-pressed=true]').allInnerTexts()
ok(JSON.stringify(await box.locator('button').allInnerTexts()) === JSON.stringify(['Interrupt', 'Auto speak', 'When open', 'Quiet']), 'the four levels')
ok(JSON.stringify(await pressed()) === '["When open"]', 'When open pressed, as the server says')
ok(/Saved on the server.*every device/s.test(await box.locator('small.server-wide').innerText()), 'it warns the setting is the server’s, for every device')
await box.getByRole('button', { name: 'Quiet' }).click()
await page.waitForFunction(() => document.querySelector('[data-testid=speech-default] button[aria-pressed=true]')?.textContent === 'Quiet')
const got = await (await fetch(BASE + '/speech/default', { headers: auth })).json()
ok(got.level === 'quiet', `the server has it (${got.level})`)
const rows = (await (await fetch(BASE + '/targets', { headers: auth })).json()).sessions || []
ok(rows.some((r) => r.speech === 'quiet'), 'a thread without a level of its own is quiet')
await page.reload()
await box.waitFor()
ok(JSON.stringify(await pressed()) === '["Quiet"]', 'after a reload, Quiet is still pressed')
await box.getByRole('button', { name: 'When open' }).click()
await page.waitForFunction(() => document.querySelector('[data-testid=speech-default] button[aria-pressed=true]')?.textContent === 'When open')
ok(!errors.length, `no page errors ${errors.join('; ')}`)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
