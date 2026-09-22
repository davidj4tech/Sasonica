// Changing notes from the Notes tab: ○ marks a row done (Undo puts it
// back; a repeating one moves on instead), the reader's state keys, Move
// to… (next actions, the tickler on a date), roam notes left read-only, and
// a heading gone from under the app. Mock only: a real one rewrites ~/org.
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
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); localStorage.setItem('sasonica.notes.view', 'inbox') }, [BASE, pr])

// 1. ○ on a row: gone at once, the file says DONE with CLOSED; Undo restores it
await page.goto(BASE + '/organiser')
await page.waitForSelector('.note-row:has-text("Water the fern")')
await page.click('button[aria-label="Mark done: Water the fern"]')
await page.waitForSelector('.note-toast:has-text("Done: Water the fern")')
ok((await page.locator('.note-row:has-text("Water the fern")').count()) === 0, 'the row went at once')
let inbox = (await mock()).inbox
ok(/\*\* DONE Water the fern\n\s+CLOSED: \[/.test(inbox), 'inbox.org: DONE with a CLOSED line')
await page.screenshot({ path: SHOTS + '/notes-edit-01-done.png' })
await page.click('.note-toast button:has-text("Undo")')
await page.waitForSelector('.note-row:has-text("Water the fern")')
inbox = (await mock()).inbox
ok(inbox.includes('** TODO Water the fern\n   SCHEDULED') && !inbox.includes('CLOSED'), 'Undo: TODO again, CLOSED gone')
ok((await page.locator('.note-section button.done-key, li.note-section .done-key').count()) === 0, 'section headings have no ○')

// 2. A repeating item moves on instead of closing
await page.click('.note-view:has-text("Tickler")')
await page.waitForSelector('.note-row:has-text("Stretch")')
await page.click('button[aria-label="Mark done: Stretch"]')
await page.waitForSelector('.note-toast:has-text("next on")')
const tick = (await mock()).files['tickler.org']
ok(tick.includes('** TODO Stretch') && !tick.includes('DONE Stretch'), 'the repeater stayed open')
await page.waitForSelector('.note-row:has-text("Stretch")')
ok(true, 'and is back in the list, at its next date')

// 3. The reader: state keys
await page.click('.note-view:has-text("Inbox")')
await page.click('.note-row:has-text("Ring the plumber")')
await page.waitForSelector('.note-actions')
ok((await page.locator('.state-key.on').innerText()) === 'NEXT', 'the current state is marked')
await page.click('.state-key:has-text("WAITING")')
await page.waitForSelector('.notice:has-text("Now WAITING")')
await page.waitForSelector('.bar h1 .org-state.waiting')
ok((await mock()).inbox.includes('** WAITING [#A] Ring the plumber :phone:'), 'inbox.org: WAITING, priority and tags kept')
await page.screenshot({ path: SHOTS + '/notes-edit-02-reader.png' })

// 4. Move to… Next actions: the page follows the heading to its new file
await page.click('.state-key.move')
await page.waitForSelector('.move-sheet')
ok(!(await page.locator('.move-targets').innerText()).includes('Inbox'), 'not offered the file it is already in')
await page.screenshot({ path: SHOTS + '/notes-edit-03-move.png' })
await page.click('.move-targets button:has-text("Next actions")')
await page.waitForURL(/path=next-actions\.org/)
await page.waitForSelector('.notice:has-text("Moved to Next actions")')
let files = (await mock()).files
ok(!files['inbox.org'].includes('Ring the plumber'), 'gone from the inbox')
ok(/\* Inbox\n\*\* NEXT Sharpen the shears\n\*\* NEXT \[#A\] Ring the plumber :phone:\n\s+DEADLINE/.test(files['next-actions.org']), 'under * Inbox in next-actions.org, as NEXT, with its deadline')
ok((await page.locator('.bar h1').innerText()).includes('Ring the plumber'), 'the reader shows it in its new place')

// 5. Move to the tickler, on a date
await page.goto(BASE + '/organiser')
await page.click('.note-view:has-text("Inbox")')
await page.click('.note-row:has-text("Library hold")')
await page.click('.state-key.move')
await page.click('.move-targets button:has-text("Tickler")')
await page.fill('.move-date input[type=date]', '2026-12-01')
await page.click('.move-date button[type=submit]')
await page.waitForURL(/path=tickler\.org/)
files = (await mock()).files
ok(files['tickler.org'].includes('** WAITING Library hold on the atlas\n   SCHEDULED: <2026-12-01>'), 'tickler.org: scheduled on the date')

// 6. Roam notes are read-only here
await page.goto(BASE + '/organiser/note?path=' + encodeURIComponent('roam/projects/garden.org'))
await page.waitForSelector('.note-body')
ok((await page.locator('.note-actions').count()) === 0, 'no state keys on a roam note')

// 7. A heading changed at the desk: said, not guessed
await page.goto(BASE + '/organiser')
await page.click('.note-view:has-text("Inbox")')
await page.waitForSelector('.note-row')
const firstTitle = (await page.locator('.note-row .title').first().innerText()).trim()
await mock('?drop=' + encodeURIComponent(firstTitle))
await page.locator('button.done-key').first().click()
await page.waitForSelector('.note-toast.error')
ok((await page.locator('.note-toast.error').innerText()).includes('not there any more'), `a vanished heading is refused (${firstTitle})`)

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`)
await mock('?reset=1')
await b.close()
console.log(fails ? `${fails} FAILED` : 'all passed')
process.exit(fails ? 1 : 0)
