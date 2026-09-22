// The thread is its stream (§11): a new message renders without polling,
// in well under a second; reasoning is collapsed (a "thought" marker when
// redacted); tool steps fold into "Worked · N steps" and open lazily; the
// spoken reply still follows along; a reconnect is a fresh snapshot with no
// duplicates; a refused stream falls back to polling the log, and the
// stream comes back. Plus "Load earlier" (§6.2 `before`). Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const ctl = (what) => fetch(`${BASE}/mock/stream/${what}`).then((r) => r.json())
await ctl('refuse?on=0')
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const S = sid('Mock: stream')

const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
const logReqs = []
page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/conversation/log') logReqs.push(u.search) })
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])

const stats = () => ctl('stats')
const s0 = await stats()
await page.goto(BASE + '/t/' + S)
await page.waitForSelector('text=Stream history answer 4.')
await page.waitForTimeout(800)

// ── 1. Opening is the stream; an appended message renders without polling ──
ok(logReqs.length === 0, `opened on the stream, no /conversation/log (${logReqs.length})`)
const lat = []
const RUN = `r${Date.now()}`
for (let i = 0; i < 6; i++) {
  const word = `appended-${RUN}-${i}`
  await page.evaluate((w) => {
    window.__seen = new Promise((res) => {
      const mo = new MutationObserver(() => { if (document.querySelector('.viewport')?.textContent.includes(w)) { mo.disconnect(); res(Date.now()) } })
      mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    })
  }, word)
  const t0 = Date.now()
  await ctl(`append?text=${encodeURIComponent('(mock) ' + word + ' landed in the transcript.')}`)
  const seen = await page.evaluate(() => Promise.race([window.__seen, new Promise((r) => setTimeout(() => r(0), 5000))]))
  lat.push(seen ? seen - t0 : 99999)
  await page.waitForTimeout(300)
}
lat.sort((a, x) => a - x)
console.log('  append → render ms:', JSON.stringify(lat))
ok(lat[lat.length - 1] < 1000, `every appended message rendered < 1 s after the mock append (median ${lat[3]} ms, max ${lat[lat.length - 1]} ms)`)
ok(logReqs.length === 0, 'still no polling while the stream is up')
const s1 = await stats()
ok((s1.streams[S] || 0) - (s0.streams[S] || 0) === 1, 'one stream opened for the thread')

// ── 2. A turn: reasoning collapsed, steps grouped and lazy ────────────────
await ctl('turn')
await page.waitForSelector('.msg.agent .thinking', { timeout: 3000 })
const think = await page.evaluate(() => { const t = [...document.querySelectorAll('.msg.agent .thinking')].pop(); return { open: t.classList.contains('open'), text: !!t.querySelector('.thinking-text'), head: t.querySelector('.thinking-head')?.textContent } })
ok(!think.open && !think.text && think.head === 'Thinking', `reasoning arrives collapsed as "Thinking" (${JSON.stringify(think)})`)
await page.waitForFunction(() => [...document.querySelectorAll('.work-head')].some((h) => h.textContent.includes('Working') && h.querySelector('.spinner')), null, { timeout: 3000 })
ok(true, 'a running step shows "Working" with a spinner and its title')
const runningNow = await page.evaluate(() => [...document.querySelectorAll('.work-head .work-now')].map((x) => x.textContent).pop())
ok(/Run the stream tests|Read the result/.test(runningNow || ''), `…naming the running step ("${runningNow}")`)
await page.screenshot({ path: SHOTS + '/stream-01-running.png' })
await page.waitForFunction(() => [...document.querySelectorAll('.work-head')].some((h) => /Worked · 2 steps/.test(h.textContent)), null, { timeout: 5000 })
ok((await page.locator('.step').count()) === 0, 'steps are not mounted while every block is closed (lazy)')
const group = page.locator('.work-group', { hasText: 'Worked · 2 steps' }).last()
await group.locator('.work-head').click()
const steps = await group.locator('.step').count()
const thoughts = await group.locator('.thought').count()
ok(steps === 2 && thoughts === 1, `opened: 2 tool steps and the redacted thought as a marker (${steps} steps, ${thoughts} thought)`)
ok((await group.locator('.step-body').count()) === 0, 'a step’s input/result not rendered until it is opened')
await group.locator('.step-head').first().click()
const body = await group.locator('.step-body').first().innerText()
ok(body.includes('run the stream tests') && body.includes('Run the stream tests: ok'), 'a step opens to its input and result summaries')
await page.screenshot({ path: SHOTS + '/stream-02-steps.png' })

// ── 3. The spoken reply follows along ────────────────────────────────────
await page.waitForSelector('.live-text .sentence.now', { timeout: 6000 })
const liveSample = () => page.evaluate(() => { const all = [...document.querySelectorAll('.live-text .sentence')]; const t = document.querySelector('.live-text'); return { idx: all.indexOf(document.querySelector('.live-text .sentence.now')), len: t ? t.textContent.length : 0, key: document.querySelector('.msg.agent:has(.live-text) .msg-key')?.getAttribute('aria-label') } })
const a = await liveSample()
await page.waitForTimeout(7000)
const z = await liveSample()
ok(a.len > 250 && a.len === z.len, `the spoken reply is shown whole while it plays (${a.len} chars)`)
ok(z.idx > a.idx, `the bold advances on the stream's clock (${a.idx} → ${z.idx})`)
ok(a.key === 'Pause', 'the live reply has its pause key')
await page.screenshot({ path: SHOTS + '/stream-03-follow.png' })

// ── 4. Reconnect: a fresh snapshot, no duplicates ─────────────────────────
const ids = () => page.evaluate(() => [...document.querySelectorAll('.msg')].map((m) => m.textContent.slice(0, 60)))
const before = await ids()
const streamsBefore = (await stats()).streams[S]
await ctl('drop')
for (let i = 0; i < 40 && (await stats()).streams[S] === streamsBefore; i++) await page.waitForTimeout(250)
await page.waitForTimeout(1200)
const after = await ids()
ok((await stats()).streams[S] === streamsBefore + 1, 'the dropped stream reconnected')
ok(after.length === before.length, `same messages after the reconnect's snapshot (${before.length} → ${after.length})`)
const appended = after.filter((t) => t.includes(`appended-${RUN}`))
ok(new Set(appended).size === appended.length && appended.length === 6, `no duplicates (${appended.length} appended messages, each once)`)
ok(logReqs.length === 0, 'the reconnect did not poll')

// ── 5. Refused: polling takes over, then the stream comes back ────────────
await ctl('refuse?on=1')
await ctl('drop')
await page.waitForSelector('.bar .updating:text("polling")', { timeout: 20000 })
ok(true, 'after repeated refusals the thread says "polling"')
const polled = `polled-${Date.now()}`
await ctl(`append?text=${encodeURIComponent('(mock) ' + polled)}`)
await page.waitForSelector(`text=${polled}`, { timeout: 20000 })
ok(logReqs.some((q) => q.includes('messages=1')), `…and the polled log (messages=1) brought a new message (${logReqs.length} polls)`)
await page.screenshot({ path: SHOTS + '/stream-04-polling.png' })
await ctl('refuse?on=0')
await page.waitForFunction(() => !document.querySelector('.bar .updating'), null, { timeout: 40000 })
const n = logReqs.length
await page.waitForTimeout(3000)
ok(logReqs.length === n, 'the stream came back and the polling stopped')

// ── 6. Load earlier ──────────────────────────────────────────────────────
const L = sid('Mock: long conversation')
await page.goto(BASE + '/t/' + L)
await page.waitForSelector('.earlier-button', { timeout: 8000 })
await page.waitForTimeout(1500)
const count0 = await page.locator('.msg').count()
await page.evaluate(() => { document.querySelector('.viewport').scrollTop = 0 })
await page.waitForTimeout(300)
const anchor = await page.evaluate(() => { const m = document.querySelectorAll('.msg')[0]; return { text: m.textContent.slice(0, 40), top: Math.round(m.getBoundingClientRect().top) } })
await page.locator('.earlier-button').click()
await page.waitForFunction((n) => document.querySelectorAll('.msg').length > n, count0, { timeout: 5000 })
await page.waitForTimeout(1500)
const count1 = await page.locator('.msg').count()
const moved = await page.evaluate((t) => { const m = [...document.querySelectorAll('.msg')].find((x) => x.textContent.startsWith(t)); return m ? Math.round(m.getBoundingClientRect().top) : null }, anchor.text)
ok(count0 === 60 && count1 === 90, `Load earlier: ${count0} → ${count1} messages`)
ok(moved !== null && Math.abs(moved - anchor.top) < 8, `…and the reader's place is kept (${anchor.top} → ${moved})`)
ok((await page.locator('.earlier-button').count()) === 0, '…and the button goes when nothing is older')

await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
