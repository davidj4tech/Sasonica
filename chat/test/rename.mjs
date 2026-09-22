// Rename a thread: long press in the list (→ its menu → Rename…), title tap and ⋮ in the thread;
// optimistic everywhere (list, header, speech bar, saved list), rolled back
// on refusal; empty names disabled. Mock only: a real POST /rename types
// into a running session.
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

// 1. Long press in the list → sheet prefilled; blank disabled; optimistic; saved
const shelved = sid('Mock: shelved conversation')
// The list settles once /sessions/state answers (Smart order groups by state).
await page.waitForSelector('.thread-row .badge.working')
await page.waitForTimeout(300)
await rowOf(shelved).scrollIntoViewIfNeeded()
const box = await rowOf(shelved).boundingBox()
await page.mouse.move(box.x + 60, box.y + box.height / 2)
await page.mouse.down()
await page.waitForTimeout(800)
await page.mouse.up()
// The long press opens the thread's menu (Rename, Exit, Archive: sessions.mjs).
await page.waitForSelector('.action-sheet')
ok(page.url() === BASE + '/threads', 'long press opened the menu, not the thread')
await page.getByRole('menuitem', { name: 'Rename…' }).click()
await page.waitForSelector('.rename-sheet input')
ok((await page.locator('.rename-sheet input').inputValue()) === 'Mock: shelved conversation', 'sheet prefilled with the current title')
await page.locator('.rename-sheet input').fill('   ')
ok(await page.locator('.rename-sheet button[type=submit]').isDisabled(), 'whitespace-only name: Rename disabled')
await page.screenshot({ path: SHOTS + '/rename-01-sheet.png' })
await fetch(BASE + '/mock/delay?ms=1500')
await page.locator('.rename-sheet input').fill('Layout sketches')
await page.locator('.rename-sheet button[type=submit]').click()
await page.waitForTimeout(300)
ok((await rowOf(shelved).locator('.title').innerText()) === 'Layout sketches', 'list row renamed at once (before the server answered)')
await page.waitForTimeout(1800)
const rp = posts.find((p) => p.p === '/rename')
ok(rp && JSON.parse(rp.body).session === shelved && JSON.parse(rp.body).title === 'Layout sketches', 'POST /rename {session, title}')
await fetch(BASE + '/mock/delay?ms=0')
ok((await rowOf(shelved).locator('.title').innerText()) === 'Layout sketches', 'still renamed after the answer')
// the saved list paints it on a cold start (before the network: slow link)
await fetch(BASE + '/mock/delay?ms=3000')
await page.reload()
await page.waitForSelector('.thread-row')
const cold = await rowOf(shelved).locator('.title').innerText()
ok(cold === 'Layout sketches', `cold start paints the new name from the saved list (${cold})`)
await fetch(BASE + '/mock/delay?ms=0')

// 2. In the thread: title tap → rename refused → rolled back, said quietly
await page.goto(BASE + '/t/' + shelved)
await page.waitForSelector('.title-button')
ok((await page.locator('.title-button').innerText()) === 'Layout sketches', 'thread header shows the new name')
await fetch(BASE + '/mock/delay?ms=1200')
await page.locator('.title-button').click()
await page.locator('.rename-sheet input').fill('This will FAIL')
await page.locator('.rename-sheet button[type=submit]').click()
await page.waitForTimeout(250)
ok((await page.locator('.title-button').innerText()) === 'This will FAIL', 'header renamed optimistically')
await page.waitForSelector('.status.failed', { timeout: 5000 })
ok((await page.locator('.title-button').innerText()) === 'Layout sketches', 'refused → rolled back')
ok((await page.locator('.status.failed').innerText()).includes('could not rename'), 'refusal said in the status line')
await fetch(BASE + '/mock/delay?ms=0')

// 3. ⋮ → Rename… on a working session → terminal:false, why shown quietly
const working = sid('Mock: working')
await page.goto(BASE + '/t/' + working)
await page.getByRole('button', { name: 'Thread menu' }).click()
await page.getByRole('menuitem', { name: 'Rename…' }).click()
await page.locator('.rename-sheet input').fill('Working, renamed')
await page.locator('.rename-sheet button[type=submit]').click()
await page.waitForSelector('text=Renamed. The running session will pick it up when it is free.')
ok(!(await page.locator('.status.failed').count()), 'terminal:false is not a failure: "Renamed. <why>"')
await page.screenshot({ path: SHOTS + '/rename-02-why.png' })

// 4. The speech bar follows a rename of the speaking thread
const speaking = sid('Mock: speaking now')
await page.goto(BASE + '/threads')
await page.waitForSelector('.speech-bar .speech-title')
await page.evaluate(() => document.querySelector(`a.thread-row[href^="/t/"]`) && 0)
const r4 = rowOf(speaking)
await r4.dispatchEvent('contextmenu')
await page.getByRole('menuitem', { name: 'Rename…' }).click()
await page.waitForSelector('.rename-sheet input')
await page.locator('.rename-sheet input').fill('The voice, renamed')
await page.locator('.rename-sheet button[type=submit]').click()
await page.waitForTimeout(300)
ok((await page.locator('.speech-bar .speech-title').innerText()).includes('The voice, renamed'), 'speech bar title renamed (context-menu long press)')
await page.screenshot({ path: SHOTS + '/rename-03-list.png' })
// put the fixtures back
for (const [s, t] of [[shelved, 'Mock: shelved conversation'], [working, 'Mock: working'], [speaking, 'Mock: speaking now']]) await fetch(BASE + '/rename', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ session: s, title: t }) })
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
