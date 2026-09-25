// A reply with a table, links and code (lib/rich.tsx, David 25 Sep 2026):
//
//   drawn    the table is a <table> (header, cells, bold and code in cells, a
//            link in a cell); a markdown link, a bare address and a link in a
//            cell are tappable <a>s to their url; the code is a <pre>; no
//            hidden mark reaches the page (what is copied is what is seen)
//   spoken   the voice describes the table in two sentences and skips the
//            code: while it plays, the table is ONE step — bold while either
//            description sentence is said — and the words after it (a link's
//            words, a bare address said as "example.com link") are still
//            followed sentence by sentence, never the space-joined fallback
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42', device: 'rich' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token, 'Content-Type': 'application/json' }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = targets.sessions.find((s) => s.title === 'Mock: a table and links').session

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })
const page = await ctx.newPage()
await page.route('**/input', (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 'rich', server: res.server, pairedAt: Date.now() }))
}, [BASE, pr])

// ── drawn ────────────────────────────────────────────────────────────────
await page.goto(BASE + '/t/' + sid)
await page.waitForSelector('.msg-table table', { timeout: 10000 })
const reply = page.locator('.msg.agent .line-text').last()
const heads = await reply.locator('th').allTextContents()
ok(JSON.stringify(heads) === JSON.stringify(['Option', 'Cost', 'Notes']), `the table's header row (${heads.join(', ')})`)
ok((await reply.locator('tbody tr').count()) === 3, 'three body rows')
ok((await reply.locator('tbody tr').first().locator('strong').textContent()) === 'Keep', 'bold in a cell')
ok((await reply.locator('tbody code').textContent()) === 'rm -rf', 'code in a cell')
ok((await reply.locator('td').nth(1).evaluate((e) => getComputedStyle(e).textAlign)) === 'right', 'a right-aligned column')
const hrefs = await reply.locator('a.msg-link').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.target]))
const has = (t, h) => hrefs.some(([x, y, tg]) => x === t && y === h && tg === '_blank')
ok(has('the plan', 'https://example.com/plan'), 'a link in a cell')
ok(has('docs', 'https://example.com/docs'), "a markdown link's words, to its url")
ok(has('https://example.com/raw', 'https://example.com/raw'), 'a bare address, without the full stop after it')
ok((await reply.locator('pre.msg-code').textContent()) === 'media say --hold "hi"', 'the code block, as code')
const text = await reply.textContent()
ok(!/[-]/.test(text) && !text.includes('|---') && !text.includes('```'), 'no hidden mark, table pipe or fence on the page')
await reply.screenshot({ path: `${SHOTS}/rich-drawn.png` })

// ── spoken ───────────────────────────────────────────────────────────────
await page.locator('.msg.agent', { has: page.locator('.msg-table') }).locator('.msg-key').first().tap()
await page.waitForSelector('.live-text .sentence.now', { timeout: 8000 })
const steps = await page.evaluate(() => [...document.querySelectorAll('.live-text .sentence[data-i]')].map((e) => [e.dataset.i, e.classList.contains('block'), e.textContent.slice(0, 30)]))
ok(JSON.stringify(steps.map((s) => s[0])) === JSON.stringify(['0', '1', '3', '4']), `sentences 0, the table (1-2), 3, 4 (${JSON.stringify(steps)})`)
ok(steps[1] && steps[1][1], 'the table is one block step')
ok((await page.locator('.live-text .sentence.block pre').count()) === 0 && (await page.locator('.live-text pre.msg-code').count()) === 1, 'the unspoken code block sits between sentences, not in one')
ok((await page.locator('.live-text a.msg-link[href="https://example.com/docs"]').count()) === 1, 'links stay tappable while it plays')
const boldOn = (i) => page.waitForFunction((i) => document.querySelector('.live-text .sentence.now')?.dataset.i === String(i), i, { timeout: 15000 }).then(() => true, () => false)
ok(await boldOn(1), 'the table is bold while it is described')
await page.screenshot({ path: `${SHOTS}/rich-table-bold.png` })
ok(await boldOn(3), 'then the sentence after it, with its link and bare address')
ok(await boldOn(4), 'then the last')
ok(errors.length === 0, `no page errors (${errors.join('; ')})`)

await fetch(BASE + '/mock/voice?loop=1')
await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
