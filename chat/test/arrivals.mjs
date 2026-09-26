// A reply landing in another session never moves the reader: no navigation,
// no scroll. It shows as a notice (tap to open) and an unread dot in the
// list. Plus the ↑ / ↓ pills in a thread, portrait, landscape and Larger.
// Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const mock = (q) => fetch(`${BASE}/mock/arrive?${q}`).then((r) => r.json())
await fetch(BASE + '/mock/delay?ms=0')
await mock('clear=1')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const A = sid('Mock: long conversation')
const B = sid('Mock: not on the shelf yet')
const W = sid('Mock: working')
const Q = sid('Mock: asking a question')

const b = await chromium.launch()
const newPage = async (viewport, size) => {
  const page = await (await b.newContext({ viewport })).newPage()
  await page.route('**/input', (r) => r.abort())
  page.on('pageerror', (e) => console.log('  pageerror', e.message))
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, res, size]) => {
    localStorage.setItem('sasonica.chat.baseUrl', base)
    localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
    if (size) localStorage.setItem('sasonica.chat.textSize2', size)
  }, [BASE, pr, size])
  return page
}
const page = await newPage({ width: 390, height: 780 })
const scrollTop = () => page.evaluate(() => document.querySelector('.viewport').scrollTop)

// 1. Reading A, scrolled into the middle.
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row')
await page.waitForTimeout(6000) // the list's first /sessions/state and /speech/now: the baseline
await page.locator(`a.thread-row[href="/t/${A}"]`).click()
await page.waitForSelector('.msg')
await page.waitForTimeout(2500)
await page.evaluate(() => { const v = document.querySelector('.viewport'); v.scrollTop = Math.round(v.scrollHeight / 2) })
await page.waitForTimeout(400)
const url0 = page.url()
const top0 = await scrollTop()

// 2. Another session's reply starts being spoken.
await mock('mode=speak')
await page.waitForSelector('.notice-toast', { timeout: 8000 })
await page.waitForTimeout(1500)
ok(page.url() === url0, 'a reply spoken elsewhere: still on A')
ok(Math.abs((await scrollTop()) - top0) < 3, `…and not scrolled (${top0} → ${await scrollTop()})`)
const t1 = await page.locator('.notice-toast').first().innerText()
ok(/New reply/.test(t1) && t1.includes('Mock: not on the shelf yet'), `notice: "${t1.replace(/\s+/g, ' ')}"`)
await page.screenshot({ path: SHOTS + '/arrivals-01-notice.png' })
// The bar now names B; a tap on its title in A does not leave A.
await page.waitForTimeout(900)
const barTitle = page.locator('.speech-bar .speech-title')
if (await barTitle.count()) {
  await barTitle.click()
  await page.waitForTimeout(400)
  ok(page.url() === url0, "tapping the bar's title (another thread's reply) in A stays in A")
  await page.keyboard.press('Escape')
} else ok(false, 'speech bar shown for the reply elsewhere')

// 3. A turn ends in another session (working → waiting).
await mock(`mode=state&title=${encodeURIComponent('Mock: working')}`)
await page.waitForFunction(() => [...document.querySelectorAll('.notice-toast')].some((n) => n.textContent.includes('Mock: working')), null, { timeout: 16000 })
ok(page.url() === url0 && Math.abs((await scrollTop()) - top0) < 3, 'a turn ending elsewhere: A unmoved')

// 3b. A chat started after the list was fetched: the notice has its title, not its id.
const fresh = await (await fetch(BASE + '/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + pr.token }, body: JSON.stringify({ text: 'Mock: started since the list', target: 'new' }) })).json()
await page.waitForTimeout(5500) // one /sessions/state with it working: the baseline
await mock(`mode=state&title=${encodeURIComponent('Mock: started since the list')}`)
await page.waitForFunction((sid) => [...document.querySelectorAll('.notice-toast')].some((n) => n.textContent.includes('Mock: started since the list') || n.textContent.includes(sid.slice(0, 8))), fresh.session, { timeout: 16000 })
const tFresh = await page.locator('.notice-toast', { hasText: /started since the list|/ }).allInnerTexts()
ok(tFresh.some((t) => t.includes('Mock: started since the list')) && !tFresh.some((t) => t.includes(fresh.session.slice(0, 8))), `a new chat's notice is named (${tFresh.join(' / ').replace(/\s+/g, ' ')})`)

// 4. An urgent reply waiting for the voice: the stronger notice.
await mock(`mode=queue&urgent=1&title=${encodeURIComponent('Mock: asking a question')}`)
await page.waitForSelector('.notice-toast.urgent', { timeout: 8000 })
ok((await page.locator('.notice-toast.urgent').innerText()).includes('Mock: asking a question'), 'urgent queued reply → stronger notice')
ok(page.url() === url0 && Math.abs((await scrollTop()) - top0) < 3, '…and A still unmoved')
await page.screenshot({ path: SHOTS + '/arrivals-02-urgent.png' })
await mock('clear=1')

// 5. The list: unread dots on B and W, not on A; opening B clears its dot.
await page.locator('a.icon[title="Back"]').click()
await page.waitForSelector('.thread-row')
const dot = (s) => page.locator(`a.thread-row[href="/t/${s}"] .unread-dot`).count()
ok((await dot(B)) === 1 && (await dot(W)) === 1, 'list: unread dots on the threads with new replies')
ok((await dot(A)) === 0, 'list: none on the thread that was open')
await page.screenshot({ path: SHOTS + '/arrivals-03-list.png' })
await page.locator(`a.thread-row[href="/t/${B}"]`).click()
await page.waitForSelector('.msg')
await page.locator('a.icon[title="Back"]').click()
await page.waitForSelector('.thread-row')
ok((await dot(B)) === 0, 'opening B clears its dot')

// 6. A tap on a notice opens its thread (the only way one does).
await page.locator(`a.thread-row[href="/t/${A}"]`).click()
await page.waitForSelector('.msg')
await mock(`mode=queue&title=${encodeURIComponent('Mock: asking a question')}`)
await page.waitForSelector('.notice-toast', { timeout: 8000 })
await page.locator('.notice-toast .notice-open').first().click()
await page.waitForURL(new RegExp(`/t/${Q}$`), { timeout: 5000 })
ok(true, 'tapping the notice opened its thread')
await mock('clear=1')

// 7. ↑ / ↓ pills.
for (const [name, viewport, size] of [['portrait', { width: 390, height: 780 }], ['landscape', { width: 844, height: 390 }], ['portrait-larger', { width: 390, height: 780 }, 'largest']]) {
  const p = await newPage(viewport, size)
  await p.goto(BASE + '/t/' + A)
  await p.waitForSelector('.msg')
  await p.waitForTimeout(2500)
  const shown = () => p.evaluate(() => ({ up: !!document.querySelector('.jump-pill[aria-label="To the top"]'), down: !!document.querySelector('.jump-pill[aria-label="To the bottom"]') }))
  const idle = await shown()
  ok(!idle.up && !idle.down, `${name}: no pills until the thread is moved by hand (${JSON.stringify(idle)})`)
  await p.locator('.viewport').hover()
  await p.mouse.wheel(0, 1) // a hand on the thread, at the foot already
  await p.waitForTimeout(300)
  const s0 = await shown()
  ok(s0.up && !s0.down, `${name}: at the foot → ↑ only (${JSON.stringify(s0)})`)
  // Clear of the composer.
  const overlap = await p.evaluate(() => {
    const r = (el) => el && el.getBoundingClientRect()
    const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const pills = [...document.querySelectorAll('.jump-pill')].map(r)
    const others = [...document.querySelectorAll('.composer, .speech-bar, .follow-pill, .suggestion')].map(r)
    return pills.some((a) => others.some((o) => hit(a, o)))
  })
  ok(!overlap, `${name}: pills clear of the composer, speech bar and centred pills`)
  // Clear of the ▶ lane: a reply's key can scroll under them at any height.
  const lane = await p.evaluate(() => {
    const right = Math.max(...[...document.querySelectorAll('.jump-pill')].map((el) => el.getBoundingClientRect().right))
    const keys = Math.min(...[...document.querySelectorAll('.msg-keys')].map((el) => el.getBoundingClientRect().left))
    return { right: Math.round(right), keys: Math.round(keys) }
  })
  ok(lane.right <= lane.keys && lane.keys - lane.right <= 8, `${name}: pills just left of the ▶ lane (${JSON.stringify(lane)})`)
  await p.screenshot({ path: `${SHOTS}/arrivals-pills-${name}.png` })
  const settle = async () => {
    let last = -1
    for (let i = 0; i < 30; i++) {
      await p.waitForTimeout(200)
      const t = await p.evaluate(() => document.querySelector('.viewport').scrollTop)
      if (t === last) break
      last = t
    }
    await p.waitForTimeout(300)
  }
  await p.locator('.jump-pill[aria-label="To the top"]').click()
  await settle()
  const atTop = await p.evaluate(() => document.querySelector('.viewport').scrollTop)
  const s1 = await shown()
  ok(atTop < 5 && s1.down && !s1.up, `${name}: ↑ → at the top (${atTop}), ↓ only`)
  await p.locator('.jump-pill[aria-label="To the bottom"]').click()
  await settle()
  const gap = await p.evaluate(() => { const v = document.querySelector('.viewport'); return v.scrollHeight - v.clientHeight - v.scrollTop })
  ok(gap < 5, `${name}: ↓ → at the foot (${gap}px off)`)
  await p.waitForTimeout(3500)
  const gone = await shown()
  ok(!gone.up && !gone.down, `${name}: the pills go when the hand is off the thread (3 s)`)
  await p.context().close()
}

// 8. In the speaking thread, detached: the pills stay clear of "Follow along".
{
  // At 'largest': the mock thread is only tall enough to leave pills showing
  // after the scroll below when its text is; the check is the overlap.
  const p = await newPage({ width: 390, height: 780 }, 'largest')
  await fetch(BASE + '/mock/voice?loop=1')
  await p.goto(BASE + '/t/' + sid('Mock: speaking now'))
  await p.waitForSelector('.live-text', { timeout: 20000 })
  await p.waitForTimeout(2000)
  await p.locator('.viewport').hover()
  await p.mouse.wheel(0, -600)
  await p.waitForTimeout(800)
  const r = await p.evaluate(() => {
    const box = (el) => el.getBoundingClientRect()
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const pills = [...document.querySelectorAll('.jump-pill')].map(box)
    const follow = [...document.querySelectorAll('.follow-pill')].map(box)
    return { pills: pills.length, follow: follow.length, overlap: pills.some((a) => follow.some((f) => hit(a, f))) }
  })
  ok(r.follow > 0 && r.pills > 0 && !r.overlap, `live thread, detached: pills beside "Follow along", not on it (${JSON.stringify(r)})`)
  await p.screenshot({ path: SHOTS + '/arrivals-pills-follow.png' })
  await p.context().close()
}

await b.close()
process.exit(fails ? 1 : 0)
