// The thread list's filter (David, 23 Sep 2026). Shares P+3 with sort.mjs
// (runs after it; changes nothing but the choices, and resets them).
//
//   active    the default: archived rows only in the folded section
//   archived  only archived rows, unfolded, no Archived section
//   live      only live rows; closed: only shelved rows, no archived one
//   all       every row, archived ones marked
//   project   one project's rows, combined with the show choice
//   states    Needs you / Working / Your turn, any number of them at once:
//             the menu stays open, shelved rows go, the button names them
//   empty     nothing matches → a line with "Show all", which resets
//   device    the choice survives a reload (localStorage)
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8814'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = (await (await fetch(BASE + '/targets', { headers: H })).json()).sessions
const byTitle = Object.fromEntries(targets.map((t) => [t.title, t]))
const archivedTitles = targets.filter((t) => t.archived).map((t) => t.title)
ok(archivedTitles.length > 0 && targets.some((t) => t.live) && targets.some((t) => !t.live && !t.archived), 'mock /targets has live, shelved and archived rows')

const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })).newPage()
await page.route('**/input', (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); localStorage.removeItem('sasonica.chat.threadSort'); localStorage.removeItem('sasonica.chat.threadFilter') }, [BASE, pr])
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row .badge')
const titles = () => page.locator('.threads .thread-row .title').allInnerTexts()
const pick = async (name) => {
  await page.locator('.filter-button').click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await page.waitForTimeout(100)
}
const label = () => page.locator('.filter-button').innerText()

// Active (default)
ok((await label()).startsWith('Show: Active'), 'Active is the default')
let t = await titles()
ok(archivedTitles.every((x) => !t.includes(x)) && (await page.locator('.archived-head').count()) === 1, 'Active: archived rows folded away under Archived')
ok(!(await page.locator('.filter-button').getAttribute('class')).includes(' on'), 'the button is not lit under Active')

// Archived
await pick('Archived')
t = await titles()
ok(t.length === archivedTitles.length && archivedTitles.every((x) => t.includes(x)), `Archived: exactly the archived rows (${t.join(', ')})`)
ok((await page.locator('.archived-head').count()) === 0 && (await page.locator('.filter-button').getAttribute('class')).includes(' on'), 'no folded section; the button is lit')
await page.screenshot({ path: SHOTS + '/filter-01-archived.png' })

// Live / Closed
await pick('Live')
t = await titles()
ok(t.length > 0 && t.every((x) => byTitle[x]?.live && !byTitle[x]?.archived), 'Live: only live rows')
await pick('Closed')
t = await titles()
ok(t.length > 0 && t.every((x) => !byTitle[x]?.live && !byTitle[x]?.archived), 'Closed: only shelved rows, none archived')

// Everything
await pick('Everything')
t = await titles()
ok(t.length === targets.length, `Everything: every row (${t.length}/${targets.length})`)
const marked = await page.locator('.thread-row:has(.archived-mark) .title').allInnerTexts()
ok(marked.length === archivedTitles.length && marked.every((x) => archivedTitles.includes(x)), 'archived rows carry the Archived mark')

// Project, with a show choice
await pick('sasonica')
ok((await label()) .includes('Everything · sasonica'), `the button names both (${await label()})`)
t = await titles()
ok(t.length > 0 && t.every((x) => byTitle[x]?.project === 'sasonica'), 'one project: only its rows')
await pick('Archived')
t = await titles()
ok(t.length > 0 && t.every((x) => byTitle[x]?.project === 'sasonica' && byTitle[x]?.archived), 'Archived in sasonica')
await page.screenshot({ path: SHOTS + '/filter-02-project.png' })

// States: a multiple choice, the menu staying open
const state = async (name) => {
  if ((await page.locator('.filter-menu').count()) === 0) await page.locator('.filter-button').click()
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
  await page.waitForTimeout(100)
}
await pick('Everything')
await pick('All projects')
await page.waitForTimeout(600) // /sessions/state
const badges = async () => page.locator('.threads .thread-row').evaluateAll((els) => els.map((el) => el.querySelector('.badge')?.textContent || ''))
await state('Needs you')
ok((await page.locator('.filter-menu').count()) === 1, 'the menu stays open on a state')
let bs = await badges()
ok(bs.length > 0 && bs.every((x) => x === 'needs you'), `Needs you: only those (${bs.length} rows)`)
await state('Working')
bs = await badges()
ok(bs.length > 0 && bs.every((x) => x === 'needs you' || x === 'working') && bs.includes('working'), `and Working: both (${bs.join(',')})`)
ok((await label()).includes('Needs you, Working'), `the button names them (${await label()})`)
await page.screenshot({ path: SHOTS + '/filter-03-states.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
ok((await titles()).every((x) => byTitle[x]?.live), 'no shelved row while a state is picked')
await state('Needs you')
bs = await badges()
ok(bs.length > 0 && bs.every((x) => x === 'working'), 'a second tap unticks it: Working alone')
await state('Working')
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
ok((await titles()).length === targets.length && !(await label()).includes('·'), 'none ticked asks nothing')
// The menu fits the screen at the largest text: it scrolls, never runs off
// the foot, and every section is reachable.
await page.evaluate(() => localStorage.setItem('sasonica.chat.textSize2', 'largest'))
await page.reload()
await page.waitForSelector('.thread-row')
await page.locator('.filter-button').click()
await page.waitForSelector('.filter-menu')
const box = await page.locator('.filter-menu').boundingBox()
const vh = await page.evaluate(() => window.innerHeight)
ok(box.y + box.height <= vh + 1, `the menu stops at the foot of the screen (${(box.y + box.height).toFixed(0)} ≤ ${vh})`)
ok(await page.evaluate(() => { const m = document.querySelector('.filter-menu'); return m.scrollHeight > m.clientHeight && getComputedStyle(m).overflowY === 'auto' }), 'and scrolls, since it is taller than that')
await page.getByRole('menuitemcheckbox', { name: 'Your turn', exact: true }).click()
await page.waitForTimeout(100)
ok((await label()).includes('Your turn'), 'the states are reachable at the largest text')
await page.screenshot({ path: SHOTS + '/filter-04-largest.png' })
await page.getByRole('menuitemcheckbox', { name: 'Your turn', exact: true }).click()
await page.keyboard.press('Escape')
await page.evaluate(() => localStorage.removeItem('sasonica.chat.textSize2'))
await page.reload()
await page.waitForSelector('.thread-row')

await pick('sasonica')
await pick('Archived')

// Per device
await page.reload()
await page.waitForSelector('.thread-row')
ok((await label()).includes('Archived · sasonica'), 'the choice survives a reload')

// Empty → Show all (a state clears with it)
await pick('runlet')
await page.waitForSelector('.filter-empty')
ok((await titles()).length === 0 && (await page.locator('.filter-empty').innerText()).includes('No archived threads in runlet'), 'nothing matches: says so')
await state('Needs you')
await state('Your turn')
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
ok((await page.locator('.filter-empty').innerText()).includes('(needs you or your turn)'), `the empty line names the states (${(await page.locator('.filter-empty').innerText()).split('\n')[0]})`)
await page.locator('.filter-empty .link').click()
await page.waitForTimeout(100)
ok((await label()).startsWith('Show: Active') && !(await label()).includes('·') && (await titles()).length > 0, 'Show all goes back to Active, every project, no state')

ok(!errors.length, `no page errors ${errors.join('; ')}`)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
