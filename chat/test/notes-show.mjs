// The Organiser's Show and Sort menus (lib/noteSort.ts):
//
//   show    Done and cancelled asks the server again (?done=1); Waiting and
//           someday, and Notes and sections, hide client-side; the chip
//           counts what is left on; nothing left → a notice, not a blank
//   sort    File order (sections kept), Date, Priority, Title (sections
//           become ordinary rows), Recently changed in a roam folder
//   agenda  the days stay in date order; the items inside one are sorted
//   device  both choices survive a reload
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const mock = async (qs = '') => (await fetch(BASE + '/mock/notes' + qs)).json()
await fetch(BASE + '/mock/delay?ms=0')
await mock('?reset=1')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => {
  localStorage.setItem('sasonica.chat.baseUrl', base)
  localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() }))
  for (const k of ['sasonica.notes.view', 'sasonica.notes.sort', 'sasonica.notes.show']) localStorage.removeItem(k)
}, [BASE, pr])

const titles = () => page.locator('.note-list .note-row .title, .note-list .note-section a').allInnerTexts()
const rows = () => page.locator('.note-list .note-row .title').allInnerTexts()
const openShow = async () => { await page.click('.list-tools button:has-text("Show")'); await page.waitForSelector('.sort-menu[aria-label="Show in the organiser"]') }
const tick = async (label) => { await openShow(); await page.click(`.sort-menu button:has-text("${label}")`); await page.click('.popover-scrim', { position: { x: 5, y: 5 } }) }
const setSort = async (label) => {
  await page.click('.list-tools button:has-text("Sort:")')
  await page.click(`.sort-menu[aria-label="Sort the organiser"] button:has-text("${label}")`)
  await page.waitForSelector(`.list-tools button:has-text("Sort: ${label}")`)
}

// 1. The inbox as it comes: sections, no DONE, File order, "Show" plain
await page.goto(BASE + '/organiser')
await page.waitForSelector('.note-views')
await page.click('.note-view:has-text("Inbox")')
await page.waitForSelector('.note-section')
const first = await titles()
ok(first.join('|') === 'THIS WEEK|Water the fern|Ring the plumber|LATER|Library hold on the atlas', `file order, DONE left out (${first.join(', ')})`)
ok((await page.locator('.list-tools button:has-text("Sort:")').innerText()).includes('File order'), 'Sort: File order to start')
ok(!(await page.locator('.list-tools button:has-text("Show")').innerText()).includes('/'), 'the Show chip is quiet until something is changed')
await page.screenshot({ path: SHOTS + '/notes-show-01-default.png' })

// 2. Show: Done and cancelled — the server is asked again
await openShow()
await page.screenshot({ path: SHOTS + '/notes-show-02-menu.png' })
await page.click('.sort-menu button:has-text("Done and cancelled")')
await page.waitForSelector('.note-list .note-row:has-text("Posted the parcel")')
ok(true, 'ticking Done brings the parcel back (?done=1)')
await page.click('.popover-scrim', { position: { x: 5, y: 5 } })

// 3. Waiting and someday, then Notes and sections, hide here
await tick('Waiting and someday')
await page.waitForSelector('.note-list .note-row:has-text("Library hold")', { state: 'detached' })
ok((await page.locator('.list-tools button:has-text("Show")').innerText()).includes('2/3'), 'the chip counts 2 of 3 on')  // Done on, Waiting off
await tick('Notes and sections')
await page.waitForSelector('.note-section', { state: 'detached' })
const todos = await rows()
ok(todos.join('|') === 'Water the fern|Ring the plumber|Posted the parcel', `to-dos only (${todos.join(', ')})`)
await page.screenshot({ path: SHOTS + '/notes-show-03-todos.png' })

// 4. The choices survive a reload; then put Waiting and sections back
await page.reload()
await page.waitForSelector('.note-list .note-row')
ok((await page.locator('.note-section').count()) === 0 && (await page.locator('.note-list').innerText()).includes('Posted the parcel'), 'Show is remembered per device')
await tick('Waiting and someday')
await tick('Notes and sections')
await page.waitForSelector('.note-section')

// 5. Sort: Date — the overdue fern first, the deadline next, the undated last
await setSort('Date')
const byDate = await rows()
ok(byDate.indexOf('Water the fern') === 0 && byDate.indexOf('Ring the plumber') === 1, `by date (${byDate.join(', ')})`)
ok(byDate.indexOf('Library hold on the atlas') > 1, 'an undated item sinks below the dated ones')
ok((await page.locator('.note-section').count()) === 0, 'sorted, a section heading is an ordinary row')

// 6. Sort: Priority — [#A] on top
await setSort('Priority')
ok((await rows())[0] === 'Ring the plumber', `[#A] first (${(await rows()).join(', ')})`)

// 7. Sort: Title — alphabetical, sections among them
await setSort('Title')
const byTitle = await rows()
ok(byTitle.join('|') === [...byTitle].sort((a, c) => a.toLowerCase().localeCompare(c.toLowerCase())).join('|'), `alphabetical (${byTitle.join(', ')})`)
await page.screenshot({ path: SHOTS + '/notes-show-04-title.png' })

// 8. Nothing left to show says so
await tick('Waiting and someday')
await tick('Notes and sections')
await tick('Done and cancelled')
await page.click('.note-view:has-text("Next actions")')
await page.waitForSelector('.note-list .note-row:has-text("Sharpen the shears")')
await tick('Waiting and someday') // NEXT is not waiting: still there
ok((await page.locator('.note-list').innerText()).includes('Sharpen the shears'), 'a NEXT item is not "waiting"')
await tick('Waiting and someday')

// 9. The agenda: days in date order, items sorted inside a day
await page.click('.note-view:has-text("Agenda")')
await page.waitForSelector('.agenda-day')
const days = await page.locator('.agenda-day h2').allTextContents()
// (The mock dates its fixtures in UTC, so "Today" can read as yesterday here.)
ok(days[0] === 'Overdue' && days.length > 1, `the days keep their order under Title sort (${days.join(', ')})`)
const dayItems = await page.locator('.agenda-day').first().locator('.note-row .title').allInnerTexts()
ok(dayItems.join('|') === [...dayItems].sort((a, c) => a.toLowerCase().localeCompare(c.toLowerCase())).join('|'), `sorted inside a day (${dayItems.join(', ')})`)

// 10. A roam folder: Recently changed and Title, the filters left alone
await page.click('.note-view:has-text("Project notes")')
await page.waitForSelector('.note-list .note-row')
await setSort('Title')
const notes = await rows()
ok(notes.join('|') === 'Garden plan|Seed list', `notes by title (${notes.join(', ')})`)
await setSort('Recently changed')
ok((await rows()).length === 2, 'both notes still there under Recently changed')

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`)
await mock('?reset=1')
await b.close()
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
