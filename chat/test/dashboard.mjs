// Home (§6.11) and the layout fixes that came with it. Its own mock (run.mjs
// gives it P+2), because it answers questions the other suites also answer.
//
//   home      every section renders from /dashboard; polled while visible
//   needs     a multi-select question answered in place → POST
//             /session/answer {session, key, answers}, the ticks and words
//             surviving a poll, the card leaves at once and stays gone; a
//             title tap opens the thread; back → Home
//   working   the current step and a ticking elapsed time
//   listening a queued reply shows as "1 waiting"; Output → /audio/target
//   recaps    clamped text that expands; live / resting badges
//   quick     "agent-media · Claude" opens New chat preset (place + agent)
//   machines  memory ring pressure, session count, service and online dots
//             follow the hosts scenario (tight / ok); a tap opens numbers
//   tabs      Home ⇄ Threads with the back gesture behaving
//   fab       above the inset and the speech bar, last row fully visible —
//             portrait, landscape, Larger text; a simulated 48 px nav inset
//   composer  one line empty, grows to 8 rows then scrolls; laid out at a
//             zero width first (the Next bug) it still starts at one line;
//             with the soft keyboard (a shorter viewport) it stays on screen
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8813'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/dashboard?hosts=tight')
await fetch(BASE + '/mock/arrive?clear=1')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = (await (await fetch(BASE + '/targets', { headers: H })).json()).sessions
const sid = (t) => targets.find((s) => s.title === t)?.session
const dash = await (await fetch(BASE + '/dashboard', { headers: H })).json()
ok(['needs_you', 'working', 'speech', 'recent', 'places', 'agents', 'hosts', 'at'].every((k) => k in dash), 'mock /dashboard carries every §6.11 key')

const b = await chromium.launch()
const login = async (page) => {
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
}
const newPage = async (opts = {}) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark', ...opts })
  const page = await ctx.newPage()
  await page.route('**/input', (r) => r.abort())
  return { ctx, page }
}
const errors = []
const { page } = await newPage()
page.on('pageerror', (e) => errors.push(e.message))
const posts = []
page.on('request', (r) => { if (r.method() === 'POST') posts.push({ p: new URL(r.url()).pathname, body: JSON.parse(r.postData() || '{}') }) })
let dashGets = 0
page.on('request', (r) => { if (new URL(r.url()).pathname === '/dashboard') dashGets++ })
await login(page)

// ── home: every section ──────────────────────────────────────────────────
await page.goto(BASE + '/')
await page.waitForSelector('.home-page .dash-section', { timeout: 8000 })
for (const s of ['needs', 'working', 'listening', 'recaps', 'start', 'machines']) ok((await page.locator(`.dash-${s}`).count()) === 1, `home: the ${s} section renders`)
const order = await page.evaluate(() => [...document.querySelectorAll('.dash-section')].map((e) => [...e.classList].find((c) => c.startsWith('dash-') && c !== 'dash-section')))
ok(JSON.stringify(order) === JSON.stringify(['dash-needs', 'dash-working', 'dash-agenda', 'dash-listening', 'dash-recaps', 'dash-start', 'dash-machines']), `home: sections top to bottom (${order.join(', ')})`)
ok((await page.locator('.tabs .tab[aria-selected=true]').innerText()) === 'Home', 'home: the Home tab is selected')
const needCount = await page.locator('.need-card').count()
ok(needCount === dash.needs_you.length && needCount >= 4, `needs: one card per session stopped on a question (${needCount})`)
await page.screenshot({ path: SHOTS + '/home-01-top.png', fullPage: false })
const g0 = dashGets
await page.waitForTimeout(5600)
ok(dashGets > g0, `home: /dashboard polled again within ~5 s (${dashGets - g0})`)

// ── needs: answer the multi-select in place ─────────────────────────────
const multi = sid('Mock: multi-select question')
const card = page.locator(`.need-card[data-session="${multi}"]`)
ok((await card.count()) === 1, 'needs: the multi-select question has a card')
ok((await card.locator('[role=checkbox]').count()) === 3, 'needs: its three checkboxes, as in the thread')
ok((await card.locator('[role=checkbox]').nth(1).getAttribute('aria-checked')) === 'true', 'needs: the desk tick (Pear) starts ticked')
await card.locator('[role=checkbox]').nth(0).click()
await card.locator('.other input').fill('kiwi')
await page.screenshot({ path: SHOTS + '/home-02-answering.png' })
// A poll of /dashboard hands back the same question in a new object: what
// has been ticked here stays ticked, and the words stay written.
await page.waitForTimeout(5600)
const kept = await card.locator('[role=checkbox]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked')))
ok(JSON.stringify(kept) === JSON.stringify(['true', 'true', 'false']), `needs: the ticks survive a /dashboard poll (${kept.join(', ')})`)
ok((await card.locator('.other input').inputValue()) === 'kiwi', 'needs: and the Other words survive it')
const before = posts.length
await card.locator('.send-answer').click()
for (let i = 0; i < 30 && posts.length === before; i++) await page.waitForTimeout(100)
const a = posts.filter((p) => p.p === '/session/answer').pop()
ok(a && a.body.session === multi && JSON.stringify(a.body.answers) === JSON.stringify([{ question_index: 0, selected: [1, 2], other_text: 'kiwi' }]) && a.body.key, `needs: POST /session/answer from Home (${JSON.stringify(a?.body)})`)
await page.waitForTimeout(300)
ok((await page.locator(`.need-card[data-session="${multi}"]`).count()) === 0, 'needs: the card leaves at once')
await page.waitForTimeout(6000)
ok((await page.locator(`.need-card[data-session="${multi}"]`).count()) === 0, 'needs: and stays gone after the next poll')

// single-select approval by number in place
const appr = sid('Mock: needs approval')
const acard = page.locator(`.need-card[data-session="${appr}"]`)
ok((await acard.locator('.option').count()) === 3, 'needs: a permission prompt shows its numbered options')

// title tap → the thread; back → Home
await page.locator(`.need-card[data-session="${appr}"] .need-title`).click()
await page.waitForURL(new RegExp(`/t/${appr}$`), { timeout: 5000 })
ok(true, 'needs: the title opens the thread')
await page.locator('a.icon[title="Back"]').click()
await page.waitForURL(BASE + '/', { timeout: 5000 })
await page.waitForSelector('.dash-section')
ok(true, 'thread ← goes back to Home')

// ── working ──────────────────────────────────────────────────────────────
const wrow = page.locator('.working-row', { hasText: 'Mock: working' })
ok((await wrow.count()) === 1, 'working: the working session is listed')
const sub = await wrow.locator('.dash-sub').innerText()
ok(/step/.test(sub) && sub.length > 5, `working: its current step (${sub})`)
const t1 = await wrow.locator('.dash-when').innerText()
await page.waitForTimeout(2100)
const t2 = await wrow.locator('.dash-when').innerText()
ok(/\d+[sm]/.test(t1) && t1 !== t2, `working: elapsed ticks (${t1} → ${t2})`)
ok((await wrow.locator('.live-pulse').count()) === 1, 'working: a live indicator')

// ── listening ────────────────────────────────────────────────────────────
await fetch(BASE + '/mock/arrive?mode=queue&title=' + encodeURIComponent('Mock: shelved conversation'))
let lt = ''
for (let i = 0; i < 40 && !/1 waiting/.test(lt); i++) { await page.waitForTimeout(250); lt = await page.locator('.listening-line').innerText() }
ok(/(Speaking|Paused|Quiet)/.test(lt) && /1 waiting/.test(lt), `listening: what is said and the queue (${lt.replace(/\s+/g, ' ')})`)
await fetch(BASE + '/mock/arrive?clear=1')
await page.locator('.output-chip').click()
await page.waitForSelector('.output-sheet [role=radio]')
ok((await page.locator('.output-sheet [role=radio]').count()) === 4, 'listening: the output sheet lists the speech targets')
await page.screenshot({ path: SHOTS + '/home-03-output.png' })
await page.locator('.output-sheet [role=radio]', { hasText: 'House speakers' }).click()
for (let i = 0; i < 20 && !posts.some((p) => p.p === '/audio/target'); i++) await page.waitForTimeout(100)
const at = posts.filter((p) => p.p === '/audio/target').pop()
ok(at && at.body.channel === 'speech' && at.body.target === 'rooms', `listening: POST /audio/target (${JSON.stringify(at?.body)})`)
ok((await page.locator('.output-sheet [role=radio][aria-checked=true]').innerText()).includes('House speakers'), 'listening: the chosen target is marked')
await page.locator('.output-sheet button', { hasText: 'Back to the default' }).click()
await page.waitForTimeout(300)
await page.locator('.output-sheet button', { hasText: 'Done' }).click()

// ── recaps ───────────────────────────────────────────────────────────────
const rrow = page.locator('.recap-row', { hasText: 'Mock: shelved conversation' })
ok((await rrow.count()) === 1, 'recaps: a shelved thread with its recap')
const rt = rrow.locator('.recap-text')
const clamp = await rt.evaluate((e) => ({ h: e.clientHeight, sh: e.scrollHeight, lh: parseFloat(getComputedStyle(e).lineHeight) }))
ok(clamp.h <= clamp.lh * 3 + 2, `recaps: clamped to 3 lines (${clamp.h}px, line ${clamp.lh})`)
await rt.click()
ok((await rt.getAttribute('aria-expanded')) === 'true', 'recaps: a tap expands it')
ok((await page.locator('.recap-row', { hasText: 'Mock: long conversation' }).locator('.badge.resting').count()) === 1, 'recaps: a rested thread says resting')
ok((await page.locator('.recap-row', { hasText: 'Mock: speaking now' }).locator('.badge.waiting', { hasText: 'live' }).count()) === 1, 'recaps: a live one says live')
ok((await page.locator('.recap-row', { hasText: 'Mock: archived earlier' }).count()) === 0, 'recaps: archived threads are left out')

// ── machines ─────────────────────────────────────────────────────────────
await page.locator('.dash-machines').scrollIntoViewIfNeeded()
const red5 = page.locator('.machine[data-host=red5]')
const hpo = page.locator('.machine[data-host=hpo]')
ok((await red5.locator('.mem-ring').getAttribute('data-pressure')) === 'tight', 'machines: red5 memory ring is tight (red)')
ok(/Memory \d+% used, tight/.test((await red5.locator('.mem-ring').getAttribute('aria-label')) || ''), 'machines: the ring says so in words')
ok((await red5.locator('.svc-dot[aria-label^="Shell"]').getAttribute('data-state')) === 'up', 'machines: Sasonica Shell up (steady green)')
ok((await red5.locator('.svc-dot[aria-label^="sessiond"]').getAttribute('data-state')) === 'down', 'machines: sessiond down')
ok(/\d+/.test(await red5.locator('.count-badge').innerText()), 'machines: a session-count badge')
ok((await hpo.locator('.online-dot').getAttribute('data-state')) === 'down', 'machines: hpo offline')
ok(/seen/.test(await hpo.innerText()), 'machines: hpo says when it was last seen')
await page.screenshot({ path: SHOTS + '/home-04-machines-tight.png' })
await red5.locator('.machine-row').click()
ok(/Idle closer/.test(await red5.locator('.machine-details').innerText()), 'machines: a tap shows the numbers and the idle closer’s last run')
await fetch(BASE + '/mock/dashboard?hosts=ok')
let pr5 = ''
for (let i = 0; i < 30 && pr5 !== 'ok'; i++) { await page.waitForTimeout(300); pr5 = (await red5.locator('.mem-ring').getAttribute('data-pressure')) || '' }
ok(pr5 === 'ok', 'machines: the ring follows the next poll (ok)')
ok((await hpo.locator('.online-dot').getAttribute('data-state')) === 'up', 'machines: hpo online')
ok((await red5.locator('.svc-dot[aria-label^="sessiond"]').getAttribute('data-state')) === 'up', 'machines: sessiond up')
await page.screenshot({ path: SHOTS + '/home-05-machines-ok.png' })
const reduced = await (async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 780 }, reducedMotion: 'reduce' })
  const p2 = await c.newPage()
  await login(p2)
  await p2.goto(BASE + '/')
  await p2.waitForSelector('.svc-dot.up')
  const an = await p2.evaluate(() => getComputedStyle(document.querySelector('.svc-dot.up')).animationName)
  await c.close()
  return an
})()
ok(reduced === 'none', `machines: prefers-reduced-motion stills the dots (${reduced})`)

// ── quick start ──────────────────────────────────────────────────────────
const chip = page.locator('.quick-chips .chip.quick', { hasText: 'agent-media · Claude' })
ok((await chip.count()) === 1, 'quick: an "agent-media · Claude" chip')
ok((await page.locator('.quick-chips .chip.quick', { hasText: 'Codex' }).count()) >= 1, 'quick: another present agent gets a chip too')
await chip.click()
await page.waitForURL(/\/new\?/, { timeout: 5000 })
await page.waitForSelector('.new-pickers .chip.on >> text=agent-media', { timeout: 5000 }).catch(() => {})
const on = await page.locator('.new-pickers .chip.on').allInnerTexts()
ok(on.includes('agent-media') && on.includes('Claude'), `quick: New chat opens preset (${on.join(', ')})`)
ok((await page.locator('.bar h1').innerText()) === 'New chat in agent-media', 'quick: the header names the place')
await page.goBack()
await page.waitForSelector('.dash-section')

// ── tabs and the back gesture ────────────────────────────────────────────
await page.locator('.tabs .tab', { hasText: 'Threads' }).click()
await page.waitForURL(BASE + '/threads')
await page.waitForSelector('.thread-row')
ok((await page.locator('.tabs .tab[aria-selected=true]').innerText()) === 'Threads', 'tabs: Threads selected on the list')
await page.goBack()
await page.waitForURL(BASE + '/')
ok(await page.waitForSelector('.dash-section', { timeout: 3000 }).then(() => true, () => false), 'tabs: back from Threads is Home')
await page.locator('.tabs .tab', { hasText: 'Threads' }).click()
await page.waitForSelector('.thread-row')
await page.locator('.tabs .tab', { hasText: 'Home' }).click()
await page.waitForURL(BASE + '/')
const idx = await page.evaluate(() => window.history.state?.idx)
ok(idx !== undefined && idx <= 2, `tabs: Threads → Home pops rather than stacking (history idx ${idx})`)
await page.locator('.all-threads').click()
await page.waitForURL(BASE + '/threads')
ok(true, 'tabs: "All threads →" opens the list')

// ── the FAB ──────────────────────────────────────────────────────────────
const fabCheck = async (label, opts = {}, { inset = 0, quiet = false, size = '' } = {}) => {
  const { ctx, page: p } = await newPage(opts)
  if (quiet) await p.route('**/speech/now', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, live: false, speaking: false, paused: false, sentence: '', session: null, title: '', item: null, pos: null, dur: null, speed: null, muted: false, queued: [] }) }))
  await login(p)
  if (size) await p.evaluate((s) => localStorage.setItem('sasonica.chat.textSize2', s), size)
  if (inset) {
    // Chromium's own safe-area emulation where it has it; else the same
    // number through the CSS the inset feeds (the dock's padding).
    let native = false
    try {
      const cdp = await ctx.newCDPSession(p)
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: inset } })
      native = true
    } catch {}
    if (!native) await p.addInitScript((px) => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `.dock{padding-bottom:${px}px !important}`; document.head.append(s) }), inset)
  }
  await p.goto(BASE + '/threads')
  await p.waitForSelector('.thread-row')
  if (!quiet) await p.waitForSelector('.speech-bar', { timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(400)
  await p.evaluate(() => { const l = document.querySelector('.threads'); l.scrollTop = l.scrollHeight })
  await p.waitForTimeout(200)
  const m = await p.evaluate(() => {
    const r = (e) => e && e.getBoundingClientRect()
    const fab = r(document.querySelector('.dock .fab'))
    const dock = r(document.querySelector('.dock'))
    const bar = r(document.querySelector('.dock .speech-bar'))
    const rows = [...document.querySelectorAll('.threads > li')]
    const last = r(rows[rows.length - 1])
    const list = r(document.querySelector('.threads'))
    const pad = parseFloat(getComputedStyle(document.querySelector('.dock')).paddingBottom)
    return { fab, dock, bar, last, list, vh: window.innerHeight, pad }
  })
  const overlap = (a, c) => a && c && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom
  const gapAbove = m.bar ? m.bar.top - m.fab.bottom : m.vh - m.pad - m.fab.bottom
  ok(gapAbove >= 16, `fab ${label}: ≥ 16 px above ${m.bar ? 'the speech bar' : 'the bottom inset'} (${Math.round(gapAbove)} px, inset ${m.pad})`)
  ok(m.fab.bottom <= m.vh - m.pad - 16, `fab ${label}: clear of the navigation bar inset (${Math.round(m.vh - m.fab.bottom)} px from the bottom)`)
  ok(!overlap(m.fab, m.last) && m.last.bottom <= m.list.bottom + 1, `fab ${label}: the last row is fully visible, not under the + (row ${Math.round(m.last.top)}–${Math.round(m.last.bottom)}, fab ${Math.round(m.fab.top)})`)
  await p.screenshot({ path: `${SHOTS}/fab-${label}.png` })
  await ctx.close()
}
await fabCheck('portrait-bar')
await fabCheck('portrait-quiet-inset48', {}, { quiet: true, inset: 48 })
await fabCheck('landscape', { viewport: { width: 844, height: 390 } })
await fabCheck('landscape-quiet-inset48', { viewport: { width: 844, height: 390 } }, { quiet: true, inset: 48 })
await fabCheck('larger-quiet', {}, { quiet: true, size: 'largest' })
await fabCheck('larger-bar', {}, { size: 'largest' })

// ── the composer ─────────────────────────────────────────────────────────
{
  // The Next bug: laid out before the WebView has its width.
  const { ctx, page: p } = await newPage({ viewport: { width: 1, height: 780 } })
  await login(p)
  await p.goto(BASE + '/t/' + sid('Mock: not on the shelf yet'))
  await p.waitForSelector('.composer .input', { state: 'attached' })
  await p.waitForTimeout(300)
  const narrow = await p.evaluate(() => Number(document.querySelector('.composer .input').dataset.rows))
  await p.setViewportSize({ width: 390, height: 780 })
  await p.waitForTimeout(400)
  const box = () => p.evaluate(() => { const e = document.querySelector('.composer .input'); const cs = getComputedStyle(e); return { h: e.getBoundingClientRect().height, line: parseFloat(cs.lineHeight), pad: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), overflow: cs.overflowY, sh: e.scrollHeight, ch: e.clientHeight, rows: Number(e.dataset.rows) } })
  let c = await box()
  ok(c.h <= c.line + c.pad + 2, `composer: one line when empty, even laid out at zero width first (${narrow} rows at 1 px wide → ${Math.round(c.h)} px, line ${c.line})`)
  await p.screenshot({ path: SHOTS + '/composer-01-empty.png' })
  await p.locator('.composer .input').fill('one\ntwo\nthree')
  await p.waitForTimeout(100)
  c = await box()
  ok(c.rows === 3 && c.overflow === 'hidden', `composer: grows to three lines for three (${c.rows} rows)`)
  await p.locator('.composer .input').fill(Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'))
  await p.waitForTimeout(100)
  c = await box()
  ok(c.rows <= 8 && c.h <= c.line * 8 + c.pad + 2 && c.overflow === 'auto' && c.sh > c.ch, `composer: capped at 8 rows, then scrolls (${c.rows} rows, ${Math.round(c.h)} px)`)
  await p.locator('.composer .input').fill('')
  await p.waitForTimeout(100)
  c = await box()
  ok(c.h <= c.line + c.pad + 2, 'composer: back to one line when emptied')
  await ctx.close()
}
{
  // The soft keyboard: the visible height shrinks (Next resizes the WebView,
  // a browser resizes the layout); the composer must ride above it.
  const { ctx, page: p } = await newPage()
  await login(p)
  await p.goto(BASE + '/t/' + sid('Mock: not on the shelf yet'))
  await p.waitForSelector('.composer .input')
  await p.locator('.composer .input').focus()
  await p.setViewportSize({ width: 390, height: 430 })
  await p.waitForTimeout(400)
  const k = await p.evaluate(() => ({ r: document.querySelector('.composer').getBoundingClientRect(), vh: window.innerHeight, head: document.querySelector('.bar').getBoundingClientRect() }))
  ok(k.r.bottom <= k.vh && k.r.top > k.head.bottom, `composer: on screen above a keyboard (bottom ${Math.round(k.r.bottom)} of ${k.vh})`)
  await p.screenshot({ path: SHOTS + '/composer-02-keyboard.png' })
  await ctx.close()
}

ok(!errors.length, `no page errors ${errors.join('; ')}`)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
