// A reply the listener stopped part way (§6.2.2 `spoken.resume`, 25 Sep
// 2026): its key says "Resume" with where that is, and a tap plays it from
// the first sentence not heard (`replay-id` + `sentence`); a smaller key
// plays it from the start (no `sentence`); the words not heard are dimmed,
// cut by the server's sentences (GET /speech/sentences — this reply has no
// timeline), and the heard ones are not; a reply with no `resume` keeps the
// plain ▶. Mock only (`GET /mock/resume` arms it).
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const ctl = (action) => fetch(BASE + '/speech/ctl', { method: 'POST', headers: H, body: JSON.stringify({ action }) })
const replays = async () => (await (await fetch(BASE + '/mock/speech/log')).json()).filter((e) => e.action === 'replay-id')
const clock = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const rich = sid('Mock: a table and links')
const reply = page.locator('.msg.agent', { hasText: 'Here are the three options.' })

/** Arm the fixture reply, nothing speaking, and open its thread afresh. */
const open = async () => {
  await ctl('jump-end')
  const armed = await (await fetch(BASE + '/mock/resume?sentence=3')).json()
  await page.goto(BASE + '/t/' + rich)
  await page.waitForSelector('.composer textarea')
  await reply.locator('.msg-resume').waitFor({ timeout: 8000 }).catch(() => {})
  return armed
}
const firstReplay = async () => {
  let r = []
  for (const t0 = Date.now(); Date.now() - t0 < 4000 && !r.length; ) { await page.waitForTimeout(150); r = await replays() }
  return r
}

// 1. The key: "Resume" and where it picks up.
await fetch(BASE + '/mock/voice?loop=0')
const { id, resume } = await open()
ok(!!id && resume?.sentence === 3, `the mock armed the reply (${JSON.stringify(resume)})`)
const key = reply.locator('.msg-key.resume')
ok((await key.count()) === 1, 'the interrupted reply shows one Resume key')
ok((await key.innerText()).includes('Resume'), 'it is labelled "Resume"')
const at = (await reply.locator('.msg-resume-at').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
ok(at === `${clock(resume.at_s)} / ${clock(resume.dur_s)}`, `with its time "${at}" (want ${clock(resume.at_s)} / ${clock(resume.dur_s)})`)
ok((await reply.locator('.msg-key.restart').count()) === 1, 'and a play-from-the-start key')

// 2. What was not heard is dimmed; what was heard is not.
await reply.locator('.sentence.missed').first().waitFor({ timeout: 6000 }).catch(() => {})
const shade = await reply.locator('.line-text').evaluate((el) =>
  [...el.querySelectorAll('.sentence')].map((s) => ({ t: s.textContent.trim(), missed: s.classList.contains('missed'), op: Number(getComputedStyle(s).opacity) }))
)
const missed = shade.filter((x) => x.missed)
const heard = shade.filter((x) => !x.missed)
ok(missed.some((x) => x.t.startsWith('Pick the second one')) && missed.some((x) => x.t === 'Done.'), `from the resume sentence on is dimmed (${JSON.stringify(missed.map((x) => x.t.slice(0, 20)))})`)
ok(missed.length > 0 && missed.every((x) => x.op < 1), 'dimmed: lower opacity')
ok(heard.some((x) => x.t === 'Here are the three options.') && heard.every((x) => x.op === 1), `the heard part is not (${JSON.stringify(heard.map((x) => x.t.slice(0, 20)))})`)
ok(!missed.some((x) => x.t.startsWith('Here are')), 'the first sentence is not dimmed')
ok(await reply.locator('.msg-code').evaluate((el) => !!el.closest('.missed')), 'a block the voice skipped after the stop is dimmed too')
await page.screenshot({ path: SHOTS + '/interrupted-01.png' })

// 3. Restart: replay-id with no sentence.
await fetch(BASE + '/mock/speech/log?clear=1')
await reply.locator('.msg-key.restart').tap()
let r = await firstReplay()
ok(r.length === 1 && r[0].arg === id && r[0].sentence === undefined, `the restart key sends replay-id with no sentence (${JSON.stringify(r)})`)

// 4. Resume: replay-id with the resume sentence; once played, the key goes.
await open()
await fetch(BASE + '/mock/speech/log?clear=1')
await reply.locator('.msg-key.resume').tap()
r = await firstReplay()
ok(r.length === 1 && r[0].arg === id && r[0].sentence === 3, `Resume sends replay-id from sentence 3 (${JSON.stringify(r)})`)
let gone = false
for (const t0 = Date.now(); Date.now() - t0 < 8000 && !gone; ) { await page.waitForTimeout(200); gone = (await reply.locator('.msg-resume').count()) === 0 }
ok(gone, 'played again: the Resume key is gone')
await ctl('jump-end')

// 5. A reply with no resume: the plain ▶, nothing dimmed.
await page.goto(BASE + '/t/' + sid('Mock: shelved conversation'))
await page.waitForSelector('.composer textarea')
await page.waitForSelector('.msg.agent .msg-key', { timeout: 8000 }).catch(() => {})
ok((await page.locator('.msg.agent .msg-key[aria-label="Play this reply"]').count()) > 0, 'a reply with no resume has the plain ▶')
ok((await page.locator('.msg-resume, .sentence.missed').count()) === 0, 'and no Resume, nothing dimmed')

await fetch(BASE + '/mock/resume?clear=1')
await fetch(BASE + '/mock/voice?loop=1')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
