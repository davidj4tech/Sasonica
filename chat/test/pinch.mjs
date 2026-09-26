// Pinch: two fingers spreading step the text size up, closing step it down,
// saved as the Settings choice (the open Settings page follows), stopping at
// either end; the page itself never zooms. Real touches through CDP.
import { chromium } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()

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
await page.waitForSelector('.text-sizes')

const cdp = await ctx.newCDPSession(page)
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
/** Two fingers about (195, 400), from `a` px apart to `z`, in steps. */
const pinch = async (a, z, steps = 12) => {
  const at = (d) => [[195 - d / 2, 400], [195 + d / 2, 400]]
  await touch('touchStart', at(a))
  for (let i = 1; i <= steps; i++) await touch('touchMove', at(a + ((z - a) * i) / steps))
  await touch('touchEnd', [])
  await page.waitForTimeout(50)
}
const saved = () => page.evaluate(() => localStorage.getItem('sasonica.chat.textSize2') || 'default')
const rootPx = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
// The text sizes come first; Default speech priority below reuses the look.
const pressed = () => page.locator('.text-sizes button[aria-pressed=true]').first().innerText()
const scale = () => page.evaluate(() => window.visualViewport?.scale ?? 1)

ok((await saved()) === 'default' && (await rootPx()) === '15px', 'starts at Default, 15 px')
await pinch(100, 130) // ×1.3: one step
ok((await saved()) === 'large', `spread ×1.3 → Large (${await saved()})`)
ok((await rootPx()) === '17px', `the root follows: ${await rootPx()}`)
ok((await pressed()) === 'Large', `the open Settings follows (${await pressed()})`)
ok((await scale()) === 1, 'the page did not zoom')
await pinch(100, 110)
ok((await saved()) === 'large', 'a small spread (×1.1) changes nothing')
await pinch(80, 300) // ×3.75: several steps, capped
ok((await saved()) === 'largest', `a wide spread stops at Largest (${await saved()})`)
await pinch(300, 20) // closing: all the way down
ok((await saved()) === 'smallest' && (await rootPx()) === '9px', `closing stops at Smallest (${await saved()}, ${await rootPx()})`)
ok((await pressed()) === 'Smallest', 'Settings shows Smallest')
await page.reload()
await page.waitForSelector('.text-sizes')
ok((await rootPx()) === '9px' && (await pressed()) === 'Smallest', 'kept across a reload')
await pinch(130, 100)
ok((await saved()) === 'smallest', 'no lower than Smallest')
await pinch(100, 400)
await pinch(400, 100) // up to Largest, then back ×0.25: 6 steps down from 7 → Smallest
await page.locator('.text-sizes button', { hasText: /^Default$/ }).click()
ok((await saved()) === 'default' && (await rootPx()) === '15px', 'the buttons still set it')
ok((await scale()) === 1, 'still unzoomed after every pinch')
ok(errors.length === 0, `no page errors ${errors.join(' | ')}`)
await b.close()
process.exit(fails ? 1 : 0)
