// Search (§6.14) against the mock, never the real canvas.
//
//   entry     the ⌕ at the end of the Home | Threads switch (not on the
//             Organiser, which has its own), 44 px
//   typing    results as you type (debounced, one request per pause):
//             Threads (title / recap / project), Messages (who, thread,
//             snippet with the match marked), Memory when the host has it
//   jump      a message hit opens its thread scrolled to that message (older
//             than the first page), flashed, the words lit; back returns to
//             the same results
//   memory    no Memory section when the server says it is unavailable
//   advanced  off: no "Tool steps" filter; on (Settings, per device): the
//             filter finds a tool step, marked "Tool step"
//   kept      the words typed are there again when ⌕ opens (left by the
//             back arrow or a reload), selected; the ✕ empties them for good
//   recent    a search opened is kept; tapping it searches again; Clear
//   sizes     portrait and landscape, Default and Largest: no overflow,
//             44 px targets
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8891'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/search?memory=1&indexing=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }

// The mock's own answers first.
const api = async (p) => (await fetch(BASE + p, { headers: H })).json()
let r = await api('/search?q=' + encodeURIComponent('"Question 7:"'))
ok(r.ok && r.messages.length === 1 && r.messages[0].role === 'user' && r.messages[0].thread.title === 'Mock: long conversation', `mock /search finds one message (${r.messages?.length})`)
ok(r.memory?.available === true, 'memory available by default')
r = await api('/search?q=forty-fi')
ok(r.threads.some((t) => t.title === 'Mock: long conversation' && t.match.recap), 'a recap is a thread hit')
ok(r.memory.items.some((m) => m.id === 'mem-2'), 'memory items filtered by the words')
const bad = await fetch(BASE + '/search?q=%20', { headers: H })
ok(bad.status === 400, 'no words → 400')

const b = await chromium.launch()
const errors = []
async function newPage(viewport = { width: 390, height: 780 }, size = null) {
  const ctx = await b.newContext({ viewport, isMobile: true, hasTouch: true, colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.route('**/input', (rt) => rt.abort())
  page.on('pageerror', (e) => errors.push(e.message))
  page.searches = 0
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/search') page.searches++
  })
  await page.goto(BASE + '/settings')
  await page.evaluate(
    ([base, res, size]) => {
      localStorage.setItem('sasonica.chat.baseUrl', base)
      localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
      localStorage.removeItem('sasonica.chat.advanced')
      localStorage.removeItem('sasonica.chat.recentSearches')
      localStorage.removeItem('sasonica.chat.searchDraft')
      if (size) localStorage.setItem('sasonica.chat.textSize2', size)
      else localStorage.removeItem('sasonica.chat.textSize2')
    },
    [BASE, pr, size]
  )
  return page
}
const box = async (loc) => (await loc.boundingBox()) || { width: 0, height: 0 }
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

let page = await newPage()

// entry
await page.goto(BASE + '/threads')
await page.waitForSelector('.list-tools .tab-search')
const entry = page.locator('.list-tools .tab-search')
ok((await box(entry)).height >= 40 && (await box(entry)).width >= 44, `the ⌕ is a full-size target (${JSON.stringify(await box(entry))})`)
await page.screenshot({ path: SHOTS + '/search-01-entry.png' })
await page.goto(BASE + '/organiser')
await page.waitForSelector('.tabs')
ok((await page.locator('.tab-search').count()) === 0, 'not on the Organiser (it has its own ⌕)')
await page.goto(BASE + '/')
await page.waitForSelector('.tabs')
ok((await page.locator('.tab-search').count()) === 0, 'not on Home (it looks through threads)')
await page.goto(BASE + '/threads')
await page.locator('.list-tools .tab-search').click()
await page.waitForURL('**/find')
await page.waitForSelector('.search-field input')
await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'search', null, { timeout: 2000 }).catch(() => {})
ok(await page.evaluate(() => document.activeElement?.getAttribute('type') === 'search'), 'the field has focus')
ok((await page.locator('.search-filters .chip').count()) === 0, 'Advanced off: no Tool steps chip')
ok((await page.locator('.search-filters .filter-button').innerText()).startsWith('Show: Everything'), 'the filter opens on Everything')

// typing
page.searches = 0
await page.locator('.search-field input').pressSequentially('forty-fi', { delay: 40 })
await page.waitForSelector('section[aria-label="Threads"] .hit')
ok(page.searches <= 2, `debounced: ${page.searches} request(s) for 8 keystrokes`)
ok((await page.locator('section[aria-label="Threads"] .hit-title').first().innerText()) === 'Mock: long conversation', 'the thread whose recap matched')
ok((await page.locator('section[aria-label="Threads"] .hit-snippet mark').first().innerText()).toLowerCase().startsWith('forty'), 'the recap match is marked')
ok((await page.locator('section[aria-label="Memory"] .memory-item').count()) === 1, 'memory has its own section')
await page.screenshot({ path: SHOTS + '/search-02-threads-memory.png' })

await page.locator('.search-field input').fill('"Question 7:"')
await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Messages"] .hit').length === 1)
const hit = page.locator('section[aria-label="Messages"] .hit').first()
ok((await hit.locator('.hit-who').innerText()) === 'You', 'marked as the listener’s words')
ok((await hit.locator('.hit-thread').innerText()) === 'Mock: long conversation', 'names its thread')
ok((await hit.locator('mark').first().innerText()) === 'Question 7', 'the match is marked in the snippet')
ok((await box(hit)).height >= 44, '44 px hit')
await page.screenshot({ path: SHOTS + '/search-03-messages.png' })

// the filter: its own Show on this screen, and nothing hidden without a reason
await page.locator('.search-filters .filter-button').click()
await page.waitForSelector('.filter-menu')
await page.locator('.filter-menu button', { hasText: 'Archived' }).first().click()
await page.keyboard.press('Escape')
await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Messages"] .hit').length === 0)
ok((await page.locator('.search-filters .filter-button.on').count()) === 1, 'a narrowed filter is marked on the button')
ok(/Archived/.test(await page.locator('.notice').first().innerText()), 'the empty says which filter hid it')
await page.screenshot({ path: SHOTS + '/search-04-filtered.png' })
await page.locator('.notice .link', { hasText: 'Search everything' }).first().click()
await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Messages"] .hit').length === 1)
ok((await page.locator('.search-filters .filter-button').innerText()).startsWith('Show: Everything'), 'Search everything puts the hits back')
const hit2 = page.locator('section[aria-label="Messages"] .hit').first()

// jump
const id = (await api('/search?q=' + encodeURIComponent('"Question 7:"'))).messages[0].message
await hit2.click()
await page.waitForURL(/\/t\/.+\?at=/)
const target = `[data-mid="${id}"]`
await page.waitForSelector(target, { timeout: 8000 })
await page.waitForTimeout(1800) // the jump holds its place for 1.5 s
const place = await page.evaluate((sel) => {
  const el = document.querySelector(sel)
  const vp = document.querySelector('.viewport')
  const r = el.getBoundingClientRect()
  const v = vp.getBoundingClientRect()
  return { inView: r.top >= v.top - 2 && r.top < v.bottom, atBottom: vp.scrollHeight - vp.scrollTop - vp.clientHeight < 40, count: document.querySelectorAll('.msg').length }
}, target)
ok(place.inView, `the message is on screen after the jump (${JSON.stringify(place)})`)
ok(!place.atBottom, 'the thread is not left at its foot')
ok(place.count > 60, `older than the first page: ${place.count} messages held`)
const lit = await page.evaluate(() => (globalThis.CSS && CSS.highlights ? CSS.highlights.has('search-hit') : 'unsupported'))
ok(lit === true || lit === 'unsupported', `the words are lit (${lit})`)
await page.screenshot({ path: SHOTS + '/search-04-jump.png' })
await page.goBack()
await page.waitForURL('**/find?q=*')
await page.waitForSelector('section[aria-label="Messages"] .hit')
ok((await page.locator('.search-field input').inputValue()) === '"Question 7:"', 'back returns to the same search')

// memory unavailable
await fetch(BASE + '/mock/search?memory=0')
await page.locator('.search-field input').fill('forty-five')
await page.waitForSelector('section[aria-label="Threads"] .hit')
await page.waitForTimeout(300)
ok((await page.locator('section[aria-label="Memory"]').count()) === 0, 'no Memory section when the host has no agent-memory')
await fetch(BASE + '/mock/search?memory=1')

// nothing
await page.locator('.search-field input').fill('zzzqqq')
await page.waitForSelector('text=Nothing found')
ok(true, 'nothing found says so')

// advanced
await page.goto(BASE + '/settings')
await page.waitForSelector('text=Paired as')
ok((await page.locator('legend', { hasText: 'Follow-along lead' }).count()) === 0, 'the follow-along lead is hidden while Advanced is off')
ok((await page.locator('details.advanced').count()) === 0, 'so is the legacy connection, once paired')
await page.getByLabel('Advanced', { exact: true }).check()
ok(await page.evaluate(() => localStorage.getItem('sasonica.chat.advanced') === '1'), 'Advanced is kept per device')
ok((await page.locator('legend', { hasText: 'Follow-along lead' }).count()) === 1 && (await page.locator('details.advanced').count()) === 1, 'the follow-along lead and the legacy connection show under Advanced')
await page.screenshot({ path: SHOTS + '/search-05-settings-advanced.png', fullPage: true })
await page.goto(BASE + '/find')
await page.locator('.search-field input').fill('Read a file')
await page.waitForSelector('.search-filters .chip')
await page.waitForTimeout(500)
ok((await page.locator('.hit-who.tool').count()) === 0, 'tool steps are not searched until asked')
const chip = page.locator('.search-filters .chip')
ok((await box(chip)).height >= 44, '44 px filter chip')
await chip.click()
await page.waitForSelector('.hit-who.tool')
ok((await page.locator('.hit-who.tool').first().innerText()) === 'Tool step', 'the filter finds tool steps, marked')
await page.screenshot({ path: SHOTS + '/search-06-tools.png' })

// kept
await page.goto(BASE + '/threads')
await page.locator('.list-tools .tab-search').click()
await page.waitForSelector('.search-field input')
const field = page.locator('.search-field input')
ok((await field.inputValue()) === 'Read a file', `⌕ opens on the words last typed (${await field.inputValue()})`)
ok(await field.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length), 'selected, so typing replaces them')
await page.keyboard.type('forty')
ok((await field.inputValue()) === 'forty', 'typing replaced them')
await page.reload()
await page.goto(BASE + '/find')
ok((await field.inputValue()) === 'forty', 'kept through a reload')
await page.locator('.search-field .search-clear').click()
await page.goto(BASE + '/find')
ok((await field.inputValue()) === '', 'the ✕ empties them for good')

// recent
await page.goto(BASE + '/find')
await page.waitForSelector('.recent-searches button')
const recent = await page.locator('.recent-searches button').allInnerTexts()
ok(recent.some((t) => t.includes('"Question 7:"')), `an opened search is kept (${recent.join(' | ')})`)
await page.locator('.recent-searches button', { hasText: 'Question 7' }).click()
await page.waitForSelector('section[aria-label="Messages"] .hit')
ok(true, 'a recent search searches again')
await page.locator('.search-field .search-clear').click()
await page.locator('.search-forget').click()
ok((await page.locator('.recent-searches').count()) === 0, 'Clear forgets them')
await page.close()

// sizes
for (const [name, vp, size] of [
  ['landscape', { width: 915, height: 412 }, null],
  ['largest', { width: 390, height: 780 }, 'largest'],
  ['largest-landscape', { width: 915, height: 412 }, 'largest']
]) {
  const p = await newPage(vp, size)
  await p.goto(BASE + '/find?q=' + encodeURIComponent('answer'))
  await p.waitForSelector('section[aria-label="Messages"] .hit')
  ok(await noOverflow(p), `${name}: no sideways scroll`)
  const heights = await p.locator('.hit, .search-field input, .bar a.icon').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
  ok(heights.every((h) => h >= 43.5), `${name}: every target ≥ 44 px (min ${Math.min(...heights).toFixed(1)})`)
  await p.screenshot({ path: SHOTS + `/search-07-${name}.png` })
  await p.close()
}

ok(!errors.length, `no page errors ${errors.join(' | ')}`)
await b.close()
await fetch(BASE + '/mock/search?memory=1&indexing=0')
console.log(fails ? `\n${fails} failed` : '\nall pass')
process.exit(fails ? 1 : 0)
