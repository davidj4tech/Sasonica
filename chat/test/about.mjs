// About: reached from the foot of Settings; the mark, name and tagline; the
// build's version (commit + date); the server host and its paired name; the
// shell's version inside Sasonica Next (a faked window.Capacitor); credits
// and the repo link; 44 px hit areas; back to Settings; no sideways scroll
// in portrait, landscape and at the largest text size.
import { chromium, SHOTS } from './lib.mjs'
import path from 'node:path'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const host = new URL(pr.server?.base || BASE).host

const b = await chromium.launch()
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
for (const [name, vp, size, shell] of [
  ['portrait', { width: 390, height: 780 }, 'default', false],
  ['landscape', { width: 844, height: 390 }, 'default', false],
  ['portrait-largest', { width: 390, height: 780 }, 'largest', true],
  ['landscape-largest', { width: 844, height: 390 }, 'largest', false]
]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  if (shell)
    await page.addInitScript(() => {
      window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '0.4.1', build: '17' }) } } }
    })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, res, s]) => {
    localStorage.setItem('sasonica.chat.textSize2', s)
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
  }, [BASE, pr, size])
  await page.goto(BASE + '/settings')
  const row = page.locator('a.about-row[href="/about"]')
  await row.scrollIntoViewIfNeeded()
  ok((await row.innerText()).includes('About Sasonica'), `${name}: Settings ends with "About Sasonica"`)
  ok((await row.boundingBox()).height >= 44, `${name}: the About row is 44 px tall`)
  await row.click()
  await page.waitForURL(/\/about$/)
  await page.waitForSelector('.brand-hero .mark')
  ok((await page.locator('.brand-hero .wordmark').innerText()) === 'Sasonica', `${name}: the name`)
  ok((await page.locator('.brand-hero .tagline').innerText()) === 'Talk to your agents.', `${name}: the tagline`)
  const ver = await page.getByTestId('app-version').innerText()
  ok(/^([0-9a-f]{7,}|dev) · built \S/.test(ver), `${name}: version is a sha and a build date (${ver})`)
  const srv = await page.getByTestId('server').innerText()
  ok(srv.startsWith(host) && (!pr.server?.name || srv.includes(pr.server.name)), `${name}: server host${pr.server?.name ? ' and name' : ''} (${srv})`)
  if (shell) {
    await page.waitForFunction(() => document.querySelector('[data-testid=native-version]')?.textContent?.includes('0.4.1'))
    ok((await page.getByTestId('native-version').innerText()) === 'Sasonica Next 0.4.1 (17)', `${name}: the shell's version inside Sasonica Next`)
  } else ok((await page.getByTestId('native-version').count()) === 0, `${name}: no shell version in a browser`)
  ok((await page.locator('.about-what').innerText()).includes('voice-first'), `${name}: what it is`)
  const credits = await page.locator('.credits li').allInnerTexts()
  for (const c of ['React', 'React Router', 'assistant-ui', 'Capacitor']) ok(credits.some((t) => t.startsWith(c) && t.includes('MIT')), `${name}: credits ${c} (MIT)`)
  ok((await page.locator('a.source').getAttribute('href')) === 'https://github.com/davidj4tech/Sasonica', `${name}: links the repo`)
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.about a, .bar .icon')].filter((a) => a.getBoundingClientRect().height < 44).map((a) => a.textContent)
  )
  ok(!small.length, `${name}: every link is 44 px tall ${small.join(', ')}`)
  ok(!(await wide(page)), `${name}: no sideways scroll`)
  await page.screenshot({ path: path.join(SHOTS, `about-${name}.png`), fullPage: true })
  await page.locator('.bar .icon').click()
  await page.waitForURL(/\/settings$/)
  ok(true, `${name}: ← goes back to Settings`)
  ok(!errors.length, `${name}: no page errors ${errors.join('; ')}`)
  await ctx.close()
}
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
