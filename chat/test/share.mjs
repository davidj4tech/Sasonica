// Something shared to the app (routes/share.tsx). On the web it arrives as
// the Web Share Target's query (?text=&title=&url=); the Android share sheet
// hands the same screen its state (ShareInPlugin, files included — those are
// sent from native code and not reachable here). New chat and Into a thread
// leave the words at the end of that draft and open it; Organiser inbox
// captures a TODO; Play it (a link only) goes to /share. Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/notes?reset=1')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t)?.session
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const q = encodeURIComponent
const open = async (params) => {
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${BASE}/share?${params}`)
  await page.waitForSelector('.share-words')
}
const box = () => page.locator('.composer textarea')

// 1. New chat: the subject leads, the link follows, and it waits in the box.
await open(`title=${q('A good read')}&text=${q('worth a look')}&url=${q('https://example.com/a')}`)
ok((await page.locator('.share-words').inputValue()) === 'A good read\nworth a look\nhttps://example.com/a', 'subject, text and link in the box')
ok(await page.getByRole('menuitem', { name: 'Play it' }).isVisible(), 'a link can be played')
ok(!(await page.getByRole('menuitem', { name: /Just keep/ }).count()), 'no files, nothing to keep')
await page.screenshot({ path: SHOTS + '/share-00-screen.png' })
await page.getByRole('menuitem', { name: 'New chat' }).click()
await page.waitForURL(/\/new$/)
await page.waitForSelector('.composer textarea')
ok((await box().inputValue()).startsWith('A good read\nworth a look'), 'New chat: the words wait in its box')

// 2. Into a thread: after what its draft holds already.
const into = sid('Mock: not on the shelf yet')
await page.evaluate((s) => localStorage.setItem('sasonica.chat.draft.' + s, JSON.stringify({ text: 'first thought', at: Date.now() / 1000 })), into)
await open(`text=${q('second thought')}`)
ok(!(await page.getByRole('menuitem', { name: 'Play it' }).count()), 'no link, no Play it')
await page.getByRole('menuitem', { name: 'Into a thread…' }).click()
await page.fill('.share-find', 'not on the shelf')
await page.getByRole('menuitem', { name: /Mock: not on the shelf yet/ }).click()
await page.waitForURL(new RegExp(`/t/${into}$`))
await page.waitForSelector('.composer textarea')
ok((await box().inputValue()) === 'first thought\n\nsecond thought', 'Into a thread: after its draft')

// 3. Organiser inbox.
await open(`text=${q('Ring the plumber')}`)
await page.getByRole('menuitem', { name: 'Organiser inbox' }).click()
await page.waitForSelector('.status:has-text("inbox")')
const log = await (await fetch(BASE + '/mock/notes')).json()
ok(log.captures.some((c) => c.text === 'Ring the plumber' && c.kind === 'todo'), 'captured as a TODO')

// 4. Play it.
await open(`url=${q('https://example.com/song')}`)
await page.getByRole('menuitem', { name: 'Play it' }).click()
await page.waitForSelector('.status:has-text("Mock track")')
const last = await (await fetch(BASE + '/mock/last-share')).json()
ok(last?.text === 'https://example.com/song', 'POST /share with the link')

// 5. Nothing shared.
await page.evaluate(() => sessionStorage.clear())
await page.goto(BASE + '/share')
await page.waitForSelector('.notice:has-text("Nothing was shared")')
ok(true, 'an empty share says so')

await b.close()
process.exit(fails ? 1 : 0)
