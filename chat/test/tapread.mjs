// "Read from here" (server-contract.md §6.5): a tap on a sentence of the
// message being said jumps the voice there (goto-sentence, optimistic bold
// that then follows the real position); a selection in an older spoken reply
// offers "Read from here", which replays it from the sentence the selection
// starts in (replay-id + sentence, one call). Scrolls, drags, selections and
// the reply's own keys are not taps.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42', device: 'tapread' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t).session
const log = async (clear) => (await fetch(BASE + '/mock/speech/log' + (clear ? '?clear=1' : ''))).json()
const ctl = (body) => fetch(BASE + '/speech/ctl', { method: 'POST', headers: H, body: JSON.stringify(body) })

// ── The contract, on the mock ───────────────────────────────────────────────
for (const arg of ['3', true, -1, 2.5]) {
  const r = await ctl({ action: 'goto-sentence', arg })
  ok(r.status === 400, `goto-sentence arg ${JSON.stringify(arg)} → 400 (${r.status})`)
}
{
  const r = await ctl({ action: 'replay-id', arg: 1, sentence: '2' })
  ok(r.status === 400, `replay-id sentence "2" → 400 (${r.status})`)
}

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 'tapread', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])

const speaking = sid('Mock: speaking now')
await page.goto(BASE + '/t/' + speaking)
await page.waitForSelector('.live-text .sentence.now', { timeout: 15000 })
await page.waitForTimeout(1500) // let the follow-along's opening settle
const boldIdx = () => page.evaluate(() => {
  const n = document.querySelector('.live-text .sentence.now')
  return n ? Number(n.getAttribute('data-i')) : -1
})
const nSentences = await page.evaluate(() => document.querySelectorAll('.live-text .sentence[data-i]').length)
ok(nSentences >= 8, `the live message's sentences are tap targets (${nSentences})`)

// ── T1: a tap jumps there; the bold moves at once, then follows ───────────
await log(true)
const from = await boldIdx()
const to = from + 4 < nSentences ? from + 4 : Math.max(0, from - 4)
const el = page.locator(`.live-text .sentence[data-i="${to}"]`)
await el.scrollIntoViewIfNeeded()
await page.waitForTimeout(700)
const t0 = Date.now()
await el.tap()
const early = await boldIdx()
const took = Date.now() - t0
ok(early === to, `bold on the tapped sentence at once (${from} → ${early}, want ${to}, ${took} ms)`)
await page.waitForTimeout(300)
let sent = (await log()).filter((x) => x.action === 'goto-sentence')
ok(sent.length === 1 && sent[0].arg === to && sent[0].session === speaking, `one goto-sentence ${to} for this thread: ${JSON.stringify(sent)}`)
await page.waitForTimeout(3500)
const now = await (await fetch(BASE + '/speech/now', { headers: H })).json()
const later = await boldIdx()
ok(later >= to && later <= to + 1, `after the server confirms, the bold follows the real position (${later})`)
const words = await page.locator(`.live-text .sentence[data-i="${later}"]`).textContent()
ok(now.sentence && words.replace(/\s+/g, ' ').trim() === now.sentence.replace(/\s+/g, ' ').trim(), `…and it is the sentence the voice is on ("${(now.sentence || '').slice(0, 40)}…")`)
await page.screenshot({ path: `${SHOTS}/tapread-live.png` })

// ── T2: a scroll is never a tap ─────────────────────────────────────────────
await log(true)
const cdp = await ctx.newCDPSession(page)
const box = await page.locator(`.live-text .sentence[data-i="${Math.min(nSentences - 1, to + 1)}"]`).boundingBox()
const x = box.x + 20, y0 = box.y + box.height / 2
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
for (let k = 1; k <= 8; k++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - k * 25 }] })
  await page.waitForTimeout(16)
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(600)
ok((await log()).length === 0, 'a touch drag across the live text sends nothing')

// ── T3: a selection in the live text is not a tap, and offers no chip ──────
await log(true)
const sb = await page.locator(`.live-text .sentence[data-i="${Math.min(nSentences - 1, to + 1)}"]`).boundingBox()
await page.mouse.move(sb.x + 4, sb.y + 6)
await page.mouse.down()
await page.mouse.move(sb.x + 120, sb.y + 8, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(500)
const selText = await page.evaluate(() => document.getSelection()?.toString() || '')
ok((await log()).length === 0, `selecting words in the live text sends nothing (selected "${selText.slice(0, 30)}")`)
ok((await page.locator('.read-from-here').count()) === 0, 'no "Read from here" chip for the message being said')
await page.evaluate(() => document.getSelection()?.removeAllRanges())

// ── T4: the reply's own key is still its key ───────────────────────────────
await log(true)
await page.locator('.msg.agent .msg-key.on').last().tap()
await page.waitForTimeout(400)
let got = await log()
ok(got.length === 1 && got[0].action === 'toggle', `the live reply's pause key still pauses (${JSON.stringify(got.map((g) => g.action))})`)
await page.locator('.msg.agent .msg-key.on').last().tap() // and resume
await page.waitForTimeout(400)

// ── T5: an older reply — a tap does nothing; a selection offers the chip ───
const OLD = 'Here is the shape of it.'
const old = page.locator('.line-text[data-rid]', { hasText: OLD })
ok((await old.count()) === 1, 'an older spoken reply carries its history row')
await old.scrollIntoViewIfNeeded()
await log(true)
await old.tap()
await page.waitForTimeout(500)
ok((await log()).length === 0 && (await page.locator('.read-from-here').count()) === 0, 'a plain tap on an older reply sends nothing and shows no chip')
// A long press selects a word natively; do the same by script.
await page.evaluate((word) => {
  const p = [...document.querySelectorAll('.line-text[data-rid]')].find((e) => e.textContent.includes(word))
  const node = p.firstChild
  const at = node.textContent.indexOf('shape')
  const r = document.createRange()
  r.setStart(node, at)
  r.setEnd(node, at + 'shape'.length)
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
}, OLD)
await page.waitForSelector('.read-from-here', { timeout: 3000 })
const chip = await page.locator('.read-from-here').boundingBox()
const word = await page.evaluate(() => document.getSelection().getRangeAt(0).getBoundingClientRect().toJSON())
ok(chip.y >= word.bottom - 1, `the chip sits under the selection, clear of the native Copy bar (chip ${Math.round(chip.y)}, words end ${Math.round(word.bottom)})`)
ok(chip.x >= 0 && chip.x + chip.width <= 390, 'the chip is on screen')
await page.screenshot({ path: `${SHOTS}/tapread-chip.png` })
const rid = Number(await old.getAttribute('data-rid'))
await page.locator('.read-from-here').tap()
await page.waitForTimeout(500)
got = (await log()).filter((x) => x.action === 'replay-id')
ok(got.length === 1 && got[0].arg === rid && got[0].sentence === 1, `one replay-id ${rid} from sentence 1: ${JSON.stringify(got)}`)
ok((await page.locator('.read-from-here').count()) === 0, 'the chip goes once pressed')
await page.waitForSelector('.live-text', { timeout: 8000 })
await page.waitForFunction((w) => { const n = document.querySelector('.live-text .sentence.now'); return n && n.textContent.includes(w) }, 'shape', { timeout: 8000 }).catch(() => {})
const liveNow = await page.evaluate(() => document.querySelector('.live-text .sentence.now')?.textContent || '')
ok(liveNow.includes('shape'), `the replay plays from that sentence ("${liveNow}")`)

// ── T6: a sentence past the end, and a selection outside any reply ─────────
await page.evaluate(() => {
  const p = document.querySelector('.msg.user .bubble')
  const r = document.createRange()
  r.selectNodeContents(p)
  document.getSelection().removeAllRanges()
  document.getSelection().addRange(r)
})
await page.waitForTimeout(500)
ok((await page.locator('.read-from-here').count()) === 0, 'a selection in your own message offers no chip')

await b.close()
await fetch(BASE + '/mock/voice?loop=1')
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
