// Move a thread to another project (§6.15): long press in the list → Move to
// project…, and the same item in the thread's ⋮. The picker offers the other
// projects and not its own; picking one POSTs /session/move and the project
// line follows. A working session is refused (409) and says so.
//
// Mock only: on the canvas a move refiles the transcript and restarts a live
// session in the new directory.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = await (await fetch(BASE + '/targets', { headers: H })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t)?.session
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
const posts = []
page.on('request', (r) => { if (r.method() === 'POST') posts.push({ p: new URL(r.url()).pathname, body: r.postData() }) })
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row')
const rowOf = (session) => page.locator(`a.thread-row[href="/t/${session}"]`)
const longPress = async (session) => {
  await rowOf(session).scrollIntoViewIfNeeded()
  const box = await rowOf(session).boundingBox()
  await page.mouse.move(box.x + 60, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(800)
  await page.mouse.up()
  await page.waitForSelector('.action-sheet')
}

// 1. The list's long press → Move to project… → the picker
const shelved = sid('Mock: shelved conversation')      // in "sasonica", not live
await page.waitForSelector('.thread-row .badge.working')
await page.waitForTimeout(300)
ok((await rowOf(shelved).locator('.row-project').innerText()) === 'sasonica', 'the row says which project it is in')
await longPress(shelved)
await page.getByRole('menuitem', { name: 'Move to project…' }).click()
await page.waitForSelector('.action-sheet .action-note')
const offered = await page.locator('.action-list [role=menuitem]').allInnerTexts()
ok(!offered.includes('sasonica'), 'the picker does not offer the project it is already in')
ok(offered.includes('agent-media') && offered.includes('runlet'), 'the other projects are offered')
ok((await page.locator('.action-note').innerText()).includes('next time'), 'a closed thread: it opens there next time')
// The Show menu's treatment (David, 23 Sep 2026): section heads, most
// recently used first, and a list that scrolls rather than running off the
// screen. Every mock project has a session running in it.
const heads = await page.locator('.project-list .menu-head').allInnerTexts()
ok(/^running now$/i.test(heads[0] || ''), `the first head names the projects in use (${heads.join(' | ')})`)
const scrolls = await page.evaluate(() => {
  const el = document.querySelector('.project-list')
  const cs = getComputedStyle(el)
  return { overflow: cs.overflowY, capped: cs.maxHeight !== 'none' }
})
ok(scrolls.overflow === 'auto' && scrolls.capped, `the list is capped and scrolls (${JSON.stringify(scrolls)})`)
await page.screenshot({ path: SHOTS + '/move-01-picker.png' })
// A long name wraps inside its row, never over the next ones (David's
// screenshot, 25 Sep 2026: a worktree's project ran over three rows).
const overlaps = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.project-list button')]
  rows[0].textContent = 'p-agent-media--claude-worktrees-agent-a5b43898be9e83566-spike-headless-work'
  const r = rows.map((b) => b.getBoundingClientRect())
  return { wrapped: rows[0].offsetHeight > 60, n: r.filter((a, i) => i && a.top < r[i - 1].bottom - 1).length + rows.filter((b) => b.scrollHeight > b.clientHeight + 1).length }
})
ok(overlaps.wrapped && overlaps.n === 0, `a long name wraps in its own row, none overlapping (${JSON.stringify(overlaps)})`)
await page.screenshot({ path: SHOTS + '/move-01b-long-name.png' })
await page.locator('.action-sheet .quiet').click()
await longPress(shelved)
await page.getByRole('menuitem', { name: 'Move to project…' }).click()
await page.waitForSelector('.action-sheet .action-note')

// 2. Picking one moves it
await page.getByRole('menuitem', { name: 'agent-media' }).click()
await page.waitForTimeout(400)
const mp = posts.find((p) => p.p === '/session/move')
ok(mp && JSON.parse(mp.body).session === shelved && JSON.parse(mp.body).project === 'agent-media', 'POST /session/move {session, project}')
ok((await rowOf(shelved).locator('.row-project').innerText()) === 'agent-media', 'the row moved to its new project')
ok((await page.locator('.notice').innerText()).includes('Moved to agent-media'), 'it says so')
await page.screenshot({ path: SHOTS + '/move-02-moved.png' })

// 3. A live session is told it will restart; a working one is refused
const speaking = sid('Mock: speaking now')
await longPress(speaking)
await page.getByRole('menuitem', { name: 'Move to project…' }).click()
await page.waitForSelector('.action-sheet .action-note')
ok((await page.locator('.action-note').innerText()).includes('restarts the session'), 'a live thread: the move restarts it')
await page.locator('.action-sheet .quiet').click()

const working = sid('Mock: working')
await longPress(working)
await page.getByRole('menuitem', { name: 'Move to project…' }).click()
await page.waitForSelector('.action-sheet .action-note')
await page.getByRole('menuitem', { name: 'runlet' }).click()
await page.waitForTimeout(400)
const note = await page.locator('.notice').innerText()
ok(note.includes('Not moved') && note.includes('working'), 'a working session is refused, and says why')
ok((await rowOf(working).locator('.row-project').innerText()) === 'agent-media', 'and it did not move')
await page.screenshot({ path: SHOTS + '/move-03-refused.png' })

// 4. Its files could not follow: the thread moved, and it says so
await fetch(BASE + '/mock/session?fail=move-folder')
const stream = sid('Mock: stream')
await longPress(stream)
await page.getByRole('menuitem', { name: 'Move to project…' }).click()
await page.waitForSelector('.action-sheet .action-note')
await page.getByRole('menuitem', { name: 'runlet' }).click()
await page.waitForTimeout(400)
const stuck = await page.locator('.notice').innerText()
ok(stuck.includes('Moved to runlet') && stuck.includes('files stayed put'), 'a folder that could not move is said beside the move')
ok((await rowOf(stream).locator('.row-project').innerText()) === 'runlet', 'and the thread moved anyway')
await fetch(BASE + '/mock/session?fail=none')
await page.screenshot({ path: SHOTS + '/move-04-files-stuck.png' })

// 5. The same from inside a thread, through ⋮
await page.goto(BASE + '/t/' + shelved)
await page.waitForSelector('.thread-project')
await page.locator('header button[aria-label="Thread menu"]').click()
await page.getByRole('menuitem', { name: 'Move to project…' }).click()
await page.waitForSelector('.action-sheet .action-note')
await page.getByRole('menuitem', { name: 'sasonica' }).click()
await page.waitForTimeout(400)
ok((await page.locator('.thread-project').innerText()) === 'sasonica', 'the thread header follows the move')
await page.screenshot({ path: SHOTS + '/move-05-thread.png' })

await b.close()
console.log(fails ? `${fails} failed` : 'all pass')
process.exit(fails ? 1 : 0)
