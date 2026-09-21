import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
const LEGACY = !!process.env.LEGACY // old build: ABS token only
const SIZE = process.env.SIZE || 'default'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pairRes = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42', device: 'test' }) })).json()
const H = { Authorization: 'Bearer ' + pairRes.token }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res, legacy, size]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  if (legacy) localStorage.setItem('sasonica.chat.token', 'abs-legacy')
  else localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 'test', server: res.server, pairedAt: Date.now() }))
  if (size !== 'default') localStorage.setItem('sasonica.chat.textSize', size)
}, [BASE, pairRes, LEGACY, SIZE])

const sample = () => page.evaluate(() => {
  const vp = document.querySelector('.viewport'); if (!vp) return null
  const now = vp.querySelector('.live-text .sentence.now'); const foot = vp.querySelector('.footer')
  const v = vp.getBoundingClientRect(); const bandBottom = (foot ? foot.getBoundingClientRect().top : v.bottom) - v.top
  const r = now?.getBoundingClientRect()
  const live = vp.querySelector('.live-text')
  const all = [...vp.querySelectorAll('.live-text .sentence')]
  return {
    top: Math.round(vp.scrollTop), atBottom: Math.abs(vp.scrollHeight - vp.scrollTop - vp.clientHeight) < 2,
    liveLen: live ? live.textContent.length : 0, nowIdx: now ? all.indexOf(now) : -1, nSent: all.filter((x) => !x.classList.contains('pending')).length,
    nowTop: r ? Math.round(r.top - v.top) : null, nowBot: r ? Math.round(r.bottom - v.top) : null, band: Math.round(bandBottom),
    follow: !!vp.querySelector('.follow-pill:not(.new-below)'), newBelow: vp.querySelector('.follow-pill.new-below')?.textContent || '',
    blocked: window.__followBlocked || 0, msgs: vp.querySelectorAll('.msg').length
  }
})
const inBand = (s) => s.nowTop !== null && s.nowTop >= -2 && s.nowBot <= s.band + 2

// ── F1: streaming live line, paused at start, working, appends below ──────
await fetch(BASE + '/mock/real/restart?in=4')
const real = sid('Mock: real speech (streaming, appends)')
await page.goto(BASE + '/t/' + real)
await page.waitForSelector('.msg')
const before = await sample()
await page.waitForSelector('.live-text', { timeout: 15000 })
const samples = []
const t0 = Date.now()
while (Date.now() - t0 < 34000) {
  samples.push({ t: Date.now() - t0, ...(await sample()) })
  await page.waitForTimeout(300)
}
await page.screenshot({ path: `${SHOTS}/follow-${LEGACY ? 'old' : 'new'}-${SIZE}-f1.png` })
const first = samples[0], last = samples[samples.length - 1]
console.log('  first', JSON.stringify(first)); console.log('  last ', JSON.stringify(last))
ok(first.liveLen >= last.liveLen * 0.98, `whole text shown from the first live poll (${first.liveLen} vs ${last.liveLen} chars)`)
const settled = samples.filter((s) => s.t > 3500) // after the 2 s "paused" start and the first moves
// On screen = the bold sentence's top is in the band (a new, taller sentence can
// overhang the foot for one 250 ms tick before the view moves).
const out = settled.filter((s) => !(s.nowTop !== null && s.nowTop >= -2 && s.nowTop <= s.band))
if (out.length) console.log('  out:', JSON.stringify(out.map((s) => [s.t, s.nowIdx, s.nowTop, s.nowBot, s.band, s.top])))
ok(out.length <= 2, `bold sentence stayed on screen (${settled.length - out.length}/${settled.length} samples in the band)`)
const early = settled.filter((s) => s.nowIdx >= 0 && s.nowIdx < s.nSent - 4)
ok(!early.some((s) => s.atBottom), `never yanked to the bottom while the voice was mid-reply (${early.filter((s) => s.atBottom).length} at-bottom samples)`)
ok(samples.some((s) => s.nowIdx >= 8), `the bold walked down the reply (reached sentence ${Math.max(...samples.map((s) => s.nowIdx))})`)
ok(!samples.some((s) => s.follow), 'no "Follow along" pill without a hand on the screen')
ok(samples.some((s) => s.newBelow.includes('New message') || s.newBelow.includes('new messages')), `messages appended below the live line → hint (${[...new Set(samples.map((s) => s.newBelow))].join(' | ')})`)
if (!LEGACY) ok(last.blocked > 0, `assistant-ui scroll-to-bottom attempts blocked: ${last.blocked}`)

if (!LEGACY) {
  // ── F2: a hand scroll detaches; the pill resumes ─────────────────────────
  await page.mouse.move(200, 300)
  await page.mouse.wheel(0, -900)
  await page.waitForTimeout(600)
  let s = await sample()
  ok(s.follow, '"Follow along" pill after a hand scroll (wheel)')
  const held = s.top
  await page.waitForTimeout(2500)
  s = await sample()
  ok(Math.abs(s.top - held) < 4, 'detached view stays where the reader put it')
  await page.screenshot({ path: `${SHOTS}/follow-new-${SIZE}-f2-detached.png` })
  await page.locator('.follow-pill:not(.new-below)').click()
  await page.waitForTimeout(1200)
  s = await sample()
  ok(inBand(s) && !s.follow, 'pill → back on the bold sentence, pill gone')
  // touchmove detaches too
  await page.evaluate(() => document.querySelector('.viewport').dispatchEvent(new Event('touchmove')))
  await page.waitForTimeout(300)
  ok((await sample()).follow, '"Follow along" pill after a touch drag')
  await page.locator('.follow-pill:not(.new-below)').click()
  await page.waitForTimeout(1000)
  // ── F3: the "New messages ↓" hint goes to the foot and detaches ───────────
  s = await sample()
  if (s.newBelow) {
    await page.locator('.follow-pill.new-below').click()
    await page.waitForTimeout(1200)
    s = await sample()
    ok(s.atBottom && s.follow, 'new-messages hint → at the foot, with "Follow along" offered')
    await page.screenshot({ path: `${SHOTS}/follow-new-${SIZE}-f3-newbelow.png` })
  } else ok(false, 'new-messages hint present for F3')

  // ── F4: no offsets, sentence null: the app estimates, and the bold advances ──
  await fetch(BASE + '/mock/real/restart?in=1')
  await page.goto(BASE + '/t/' + sid('Mock: real speech (no offsets)'))
  await page.waitForSelector('.live-text .sentence.now', { timeout: 15000 })
  const a = await sample()
  await page.waitForTimeout(9000)
  const z = await sample()
  ok(z.nowIdx > a.nowIdx && inBand(z), `no offsets + null sentence: bold advances (${a.nowIdx} → ${z.nowIdx}) and is followed`)

  // ── F5: the original mock fixture still follows ──────────────────────────
  await page.goto(BASE + '/t/' + sid('Mock: speaking now'))
  await page.waitForSelector('.live-text .sentence.now', { timeout: 15000 })
  await page.waitForTimeout(4000)
  ok(inBand(await sample()), 'mock speaking fixture: bold on screen')
}
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
