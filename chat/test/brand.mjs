// The brand re-skin: icons + manifest in the head, the wordmark on the list,
// the mark and tagline on Pair, the text-size scale untouched by the faces,
// and nothing wider than the phone. Screenshots of each screen.
import { chromium, SHOTS } from './lib.mjs'
import path from 'node:path'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session

const man = await fetch(BASE + '/manifest.webmanifest')
const mj = await man.json()
ok(man.ok && mj.name === 'Sasonica' && mj.display === 'standalone' && mj.icons.length === 2, 'manifest served: name, standalone, two icons')
for (const f of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) ok((await fetch(BASE + '/' + f)).ok, `${f} served`)

const b = await chromium.launch()
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
for (const [name, vp, size, px] of [['portrait', { width: 390, height: 780 }, 'default', 19], ['landscape', { width: 844, height: 390 }, 'default', 19], ['portrait-larger', { width: 390, height: 780 }, 'largest', 25]]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // Pair first, unpaired: the hero.
  await page.goto(BASE + '/settings')
  await page.evaluate((s) => localStorage.setItem('sasonica.chat.textSize2', s), size)
  await page.goto(BASE + '/pairing')
  await page.waitForSelector('.brand-hero .mark')
  ok((await page.locator('.brand-hero .tagline').innerText()) === 'Talk to your agents.', `${name}: Pair shows the tagline`)
  ok(!(await wide(page)), `${name}: Pair has no sideways scroll`)
  await page.screenshot({ path: path.join(SHOTS, `brand-pair-${name}.png`) })
  const head = await page.evaluate(() => ({
    svg: !!document.querySelector('link[rel=icon][type="image/svg+xml"]'),
    png: !!document.querySelector('link[rel=icon][type="image/png"]'),
    apple: !!document.querySelector('link[rel=apple-touch-icon]'),
    manifest: !!document.querySelector('link[rel=manifest]'),
    theme: document.querySelector('meta[name=theme-color]')?.content,
    fonts: document.querySelector('link[rel=stylesheet][href*="fonts.googleapis.com"]')?.href || ''
  }))
  ok(head.svg && head.png && head.apple && head.manifest && head.theme === '#0D1412', `${name}: head links icons, manifest, theme-color`)
  ok(head.fonts.includes('Fraunces') && head.fonts.includes('IBM+Plex+Sans') && head.fonts.includes('display=swap'), `${name}: fonts requested with swap`)

  await page.evaluate(([base, res]) => {
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
  }, [BASE, pr])
  await page.goto(BASE + '/threads')
  await page.waitForSelector('.thread-row')
  const wm = await page.evaluate(() => {
    const h = document.querySelector('.bar h1.wordmark')
    const m = h?.querySelector('.mark')?.getBoundingClientRect()
    return { text: h?.textContent, family: h && getComputedStyle(h).fontFamily, mark: m && Math.round(m.width), root: getComputedStyle(document.documentElement).fontSize, body: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor }
  })
  ok(wm.text === 'Sasonica' && wm.family.includes('Fraunces'), `${name}: list header is the wordmark in Fraunces`)
  ok(wm.mark >= 24 && wm.mark <= 44, `${name}: the mark is ~28 px (${wm.mark})`)
  ok(wm.root === px + 'px', `${name}: root font-size is the text-size setting (${wm.root})`)
  ok(wm.body.includes('IBM Plex Sans'), `${name}: body in IBM Plex Sans`)
  ok(wm.bg === 'rgb(13, 20, 18)', `${name}: ground #0D1412`)
  ok(!(await wide(page)), `${name}: list has no sideways scroll`)
  await page.screenshot({ path: path.join(SHOTS, `brand-list-${name}.png`) })

  await page.goto(BASE + '/t/' + sid('Mock: speaking now'))
  await page.waitForSelector('.live-text', { timeout: 15000 })
  await page.waitForSelector('.speech-bar')
  await page.waitForTimeout(800)
  ok(!(await wide(page)), `${name}: thread has no sideways scroll`)
  const bar = await page.evaluate(() => getComputedStyle(document.querySelector('.speech-bar')).backgroundColor)
  ok(bar === 'rgb(21, 32, 28)', `${name}: speech bar on the tile #15201C`)
  await page.screenshot({ path: path.join(SHOTS, `brand-thread-${name}.png`) })
  ok(!errors.length, `${name}: no page errors ${errors.join('; ')}`)
  await ctx.close()
}
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
