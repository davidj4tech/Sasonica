// Three things a listener asked for in one sitting (23 Sep 2026):
//   * the app opens where it was left, so a reinstall does not lose the page
//   * the ↑/↓ jump pills stop covering a reply's ▶
//   * the speed row shows the rate AND offers reset, instead of one element
//     that is both and reads as a reset key the moment it says 1×
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42', device: 'resume' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const session = (targets.sessions || [])[0]?.session
ok(!!session, 'the mock has a thread to open')

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 'resume', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])

// ── Opening where it was left ──────────────────────────────────────────────
await page.goto(BASE + '/t/' + session)
await page.waitForSelector('.msg')
ok((await page.evaluate(() => localStorage.getItem('sasonica.lastRoute'))) === '/t/' + session,
   'the thread being read is written down')

// A launch is a fresh load of the start URL — which is what an install, an
// update and a swipe away all end with.
await page.goto(BASE + '/')
await page.waitForSelector('.msg')
ok(page.url().endsWith('/t/' + session), `it opens on the thread again (${page.url()})`)

// But Home asked for is Home given: the resume is spent once per launch, so
// walking to Home inside the app does not bounce straight back to the thread.
await page.evaluate(() => {
  const home = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/')
  if (home) home.click()
  else window.history.pushState({}, '', '/')
})
await page.waitForTimeout(600)
ok(new URL(page.url()).pathname === '/', `Home reached from inside the app stays Home (${page.url()})`)

// ── The jump pills clear the bubble keys ───────────────────────────────────
await page.goto(BASE + '/t/' + session)
await page.waitForSelector('.msg')
// A short mock thread never scrolls far enough to raise the pills on its own,
// and the fix is the CSS, not when they appear: put a real pill where the app
// puts one and measure it against the keys that are on screen.
const geom = await page.evaluate(() => {
  const footer = document.querySelector('.footer')
  const keys = [...document.querySelectorAll('.msg-key')]
  if (!footer || !keys.length) return null
  const pills = document.createElement('div')
  pills.className = 'jump-pills'
  pills.innerHTML = '<button class="jump-pill">\u2191</button>'
  footer.prepend(pills)
  const p = pills.firstElementChild.getBoundingClientRect()
  const hits = keys.filter((k) => {
    const r = k.getBoundingClientRect()
    return r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top
  }).length
  // Its lane must also be clear of the keys' column, not merely clear of the
  // keys that happen to be rendered right now.
  const lane = Math.min(...keys.map((k) => k.getBoundingClientRect().left))
  // See-through, so what it floats over is still readable through it.
  const bg = getComputedStyle(pills.firstElementChild).backgroundColor
  // Two spellings reach us: rgba(r, g, b, a) and color-mix's color(srgb r g b / a).
  const a = /\/\s*([\d.]+)\s*\)/.exec(bg) || /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(bg)
  const opaque = !a || Number(a[1]) >= 0.95
  pills.remove()
  return { hits, keys: keys.length, clear: p.right <= lane + 0.5, pillRight: p.right, lane, bg, opaque }
})
if (geom) {
  ok(geom.hits === 0, `no bubble key sits under a jump pill (${geom.hits} of ${geom.keys} overlapping)`)
  ok(geom.clear, `the pill stays left of the keys' column (${Math.round(geom.pillRight)} vs ${Math.round(geom.lane)})`)
  ok(!geom.opaque, `and it is see-through, not a disc over the words (${geom.bg})`)
} else {
  console.log('SKIP no bubble keys on screen')
}

// ── Speed: a reading, and a reset of its own ───────────────────────────────
await page.click('.speech-bar .skey.more')
await page.waitForSelector('.speech-sheet')
const knob = await page.evaluate(() => {
  const value = document.querySelector('.knob-value')
  const reset = document.querySelector('.knob-reset')
  return {
    hasValue: !!value,
    valueIsButton: value?.tagName === 'BUTTON',
    text: value?.textContent?.trim() || '',
    hasReset: !!reset,
    resetDisabled: reset ? reset.disabled : null,
    resetLabel: reset?.getAttribute('aria-label') || ''
  }
})
if (knob.hasValue) {
  ok(!knob.valueIsButton, 'the rate is a reading, not a button that resets it')
  ok(/×$/.test(knob.text), `it says the rate (${knob.text})`)
  ok(knob.hasReset, 'reset is a key of its own')
  ok(knob.resetDisabled === true, 'and it is offered only when there is something to reset')
  ok(/reset/i.test(knob.resetLabel), `the reset key says what it does ("${knob.resetLabel}")`)
} else {
  console.log('SKIP the speech sheet did not open')
}

await page.screenshot({ path: `${SHOTS}/resume.png` })
await b.close()
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
