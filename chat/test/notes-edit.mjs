// Changing notes from the Notes tab: ○ marks a row done (Undo puts it
// back; a repeating one moves on instead), the reader's state keys, a date
// tapped and changed, Move to… (next actions, the tickler on a date), roam
// notes left read-only, and a heading gone from under the app. Mock only: a real one rewrites ~/org.
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

// 3b. The date: tapped, changed, given a time, then a new one added and removed
await page.click('.org-date button.date-key:has-text("DEADLINE")')
await page.waitForSelector('.date-sheet')
await page.screenshot({ path: SHOTS + '/notes-edit-02b-date.png' })
await page.fill('.date-sheet input[type=date]', '2026-10-09')
await page.fill('.date-sheet input[type=time]', '19:00')
await page.click('.date-sheet button[type=submit]')
await page.waitForSelector('.notice:has-text("Deadline for 2026-10-09 at 19:00")')
ok((await mock()).inbox.includes(':phone:\n   DEADLINE: <2026-10-09 Fri 19:00>'), 'inbox.org: the deadline moved, with a time')
await page.waitForSelector('.org-date button.date-key:has-text("2026-10-09")')
ok(true, 'the page shows the new date')
await page.click('.state-key:has-text("Schedule…")')
await page.click('.date-quick button:has-text("Tomorrow")')
await page.click('.date-sheet button[type=submit]')
await page.waitForSelector('.notice:has-text("Scheduled for")')
ok(/:phone:\n   DEADLINE: <2026-10-09 Fri 19:00> SCHEDULED: <\d{4}-\d{2}-\d{2} \w{3}>\n/.test((await mock()).inbox), 'Schedule… adds a SCHEDULED beside the deadline')
ok((await page.locator('.state-key:has-text("Schedule…")').count()) === 0, 'and Schedule… goes once there is one')
await page.click('.org-date button.date-key:has-text("SCHEDULED")')
await page.click('.date-sheet button:has-text("Remove date")')
await page.waitForSelector('.notice:has-text("Scheduled date removed")')
ok((await mock()).inbox.includes(':phone:\n   DEADLINE: <2026-10-09 Fri 19:00>\n'), 'Remove date takes it off again')

// 3c. Priority…: A is shown, B picked, then none; the file follows
ok((await page.locator('.state-key:has-text("Priority A")').count()) === 1, 'the key says Priority A')
await page.click('.state-key:has-text("Priority A")')
await page.waitForSelector('.action-sheet [role=menuitemradio]')
await page.screenshot({ path: SHOTS + '/notes-edit-02c-priority.png' })
await page.click('.action-sheet [role=menuitemradio]:has-text("B")')
await page.waitForSelector('.notice:has-text("Priority B.")')
ok((await mock()).inbox.includes('** WAITING [#B] Ring the plumber :phone:'), 'inbox.org: [#B], state and tags kept')
await page.click('.state-key:has-text("Priority B")')
await page.click('.action-sheet [role=menuitemradio]:has-text("None")')
await page.waitForSelector('.notice:has-text("No priority.")')
ok((await mock()).inbox.includes('** WAITING Ring the plumber :phone:'), 'None takes the cookie off')
await page.waitForSelector('.state-key:has-text("Priority…")')
await page.click('.state-key:has-text("Priority…")')
await page.click('.action-sheet [role=menuitemradio]:has-text("A — read aloud")')
await page.waitForSelector('.notice:has-text("Priority A.")')
ok((await mock()).inbox.includes('** WAITING [#A] Ring the plumber :phone:'), 'and A puts it back')

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
ok((await page.locator('.note-actions .state-key').count()) === 0, 'no state keys on a roam note')

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
