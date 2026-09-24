// The Organiser offers what the server says (§6.10 GET /notes), not paragtd's
// lists hard-coded (lib/notesMeta.ts):
//
//   plain   a server on plain Org: the state keys are its keywords (no
//           WAITING), Move to… lists its files, none of them asks for a
//           date, and ✓ Done writes its done keyword
//   legacy  a server from before those fields: paragtd's keys and targets,
//           the tickler on a date, as before
//   sequence  closing a sequenced step says which step is next, and when
//   templates  More… beside the capture box: the server's templates, their
//           prompts drawn, Save waiting for them; plain Org has no More…
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const mock = async (qs = '') => (await fetch(BASE + '/mock/notes' + qs)).json()
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const b = await chromium.launch()
const errors = []

// A fresh page per layout: the app keeps one copy of /notes' answer per load.
async function open(layout) {
  await mock('?reset=1')
  await mock(`?layout=${layout}`)
  const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
  await page.route('**/input', (r) => r.abort())
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(BASE + '/settings')
  await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); localStorage.setItem('sasonica.notes.view', 'inbox') }, [BASE, pr])
  await page.goto(BASE + '/organiser')
  await page.click('.note-row:has-text("Ring the plumber")')
  await page.waitForSelector('.note-actions')
  return page
}
const keys = (page) => page.locator('.note-actions .state-key:not(.move):not(.prio-set)').allInnerTexts()

// 1. Plain Org
let page = await open('plain')
let got = await keys(page)
ok(got.includes('TODO') && got.includes('NEXT') && got.includes('✓ Done'), `its keywords are the keys (${got.join(', ')})`)
ok(!got.includes('WAITING') && !got.includes('SOMEDAY'), 'no GTD keywords it does not have')
await page.click('.state-key.move')
await page.waitForSelector('.move-sheet')
let targets = await page.locator('.move-targets').innerText()
ok(targets.includes('Next actions') && targets.includes('Tickler'), 'Move to… lists its files')
ok(!targets.includes('on a date') && !targets.includes('Waiting for'), 'none asks for a date, and no paragtd-only targets')
await page.screenshot({ path: SHOTS + '/notes-layout-01-plain.png' })
await page.click('.move-targets button.quiet')
await page.click('.state-key:has-text("✓ Done")')
await page.waitForSelector('.notice:has-text("Done.")')
ok(/\*\* DONE \[#A\] Ring the plumber/.test((await mock()).inbox), 'Done writes its done keyword')
await page.context().close()

// 2. An older server
page = await open('legacy')
got = await keys(page)
ok(['TODO', 'NEXT', 'WAITING'].every((k) => got.includes(k)), `paragtd's keys (${got.join(', ')})`)
await page.click('.state-key.move')
await page.waitForSelector('.move-sheet')
targets = await page.locator('.move-targets').innerText()
ok(targets.includes('Tickler (on a date)') && targets.includes('Waiting for'), "paragtd's targets, the tickler on a date")
await page.context().close()

// 3. A sequenced project: ○ on a step names the next one
page = await open('paragtd')
await mock('?sequence=1')
await page.goto(BASE + '/organiser')
await page.click('.note-view:has-text("Next actions")')
await page.waitForSelector('.note-row:has-text("Get photos taken")')
await page.click('button[aria-label="Mark done: Get photos taken"]')
await page.waitForSelector('.note-toast:has-text("Next: Fill in the form")')
ok(/Next: Fill in the form, on \d{4}-\d{2}-\d{2}/.test(await page.locator('.note-toast').innerText()), 'the toast names the next step and its date')
ok((await mock()).files['next-actions.org'].includes('** NEXT Fill in the form'), 'which is NEXT now')
ok((await page.locator('.note-toast button:has-text("Undo")').count()) === 0, 'no Undo: it could not take the next step back')
await page.screenshot({ path: SHOTS + '/notes-layout-02-sequence.png' })
await page.context().close()

// 4. Capture templates
page = await open('paragtd')
await page.goto(BASE + '/organiser')
await page.waitForSelector('.capture')
await page.click('.capture-kind button:has-text("More…")')
await page.waitForSelector('.capture-sheet')
ok((await page.locator('.capture-sheet .move-targets button').allInnerTexts()).some((t) => t.startsWith('Tickler')), 'the sheet lists the templates')
await page.click('.capture-sheet button:has-text("Tickler")')
await page.fill('.capture textarea', 'Return the library book')
ok(await page.locator('.capture button[type=submit]').isDisabled(), 'Save waits for the date')
await page.fill('.capture-fields input[type=datetime-local]', '2026-10-01T10:00')
await page.screenshot({ path: SHOTS + '/notes-layout-03-template.png' })
await page.click('.capture button[type=submit]')
await page.waitForSelector('.capture-note:has-text("Filed in tickler")')
let cap = (await mock()).captures.at(-1)
ok(cap.kind === 'k' && cap.fields.f0 === '2026-10-01T10:00' && cap.text === 'Return the library book', 'sent as the template, with its date')
ok((await page.locator('.capture-kind button.on').innerText()) === 'To-do', 'and back to a plain to-do')
// A template that needs no text: its prompts are enough.
await page.click('.capture-kind button:has-text("More…")')
await page.click('.capture-sheet button:has-text("New Partner")')
await page.fill('.capture-fields input[type=text]', 'Sam')
await page.click('.capture button[type=submit]')
await page.waitForSelector('.capture-note:has-text("Filed in roleplay/inbox")')
cap = (await mock()).captures.at(-1)
ok(cap.kind === 'rp' && cap.fields.f0 === 'Sam' && cap.fields.f1 === 'Calm', 'the choice goes with its first option')
await page.context().close()
page = await open('plain')
await page.goto(BASE + '/organiser')
await page.waitForSelector('.capture')
ok((await page.locator('.capture-kind button:has-text("More…")').count()) === 0, 'plain Org: no More…')
await page.context().close()

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`)
await b.close()
console.log(fails ? `${fails} failed` : 'all passed')
process.exit(fails ? 1 : 0)
