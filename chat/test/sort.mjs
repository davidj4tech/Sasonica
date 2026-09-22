// The thread list's order and each row's project (§6.1). Shares P+3 with
// agents.mjs (it runs after it and changes nothing but the sort choice).
//
//   smart     needs you → working → the rest, pinned on top of the rest
//   recent    newest first: the pinned old thread falls to its place
//   project   headings in the order of their newest thread, "Other" last,
//             each row under its own project; the Archived section too
//   device    the choice survives a reload (localStorage)
//   menu      the sort menu closes on a tap outside without changing it
//   project   the small line under a row's title, the thread header's, and
//             Home's recap and working cards; none where it is null
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8814'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const H = { Authorization: 'Bearer ' + pr.token }
const targets = (await (await fetch(BASE + '/targets', { headers: H })).json()).sessions
const sid = (t) => targets.find((s) => s.title === t)?.session
const byTitle = Object.fromEntries(targets.map((t) => [t.title, t]))
ok(targets.every((t) => 'project' in t && 'cwd' in t) && targets.some((t) => t.project === null) && new Set(targets.map((t) => t.project).filter(Boolean)).size >= 3, 'mock /targets rows carry project and cwd, a mix with some null')

const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })).newPage()
await page.route('**/input', (r) => r.abort())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })); localStorage.removeItem('sasonica.chat.threadSort') }, [BASE, pr])
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row .badge')
await page.waitForTimeout(800) // /sessions/state's first answer
const list = () =>
  page.locator('.threads > li').evaluateAll((els) =>
    els.map((li) =>
      li.classList.contains('project-head')
        ? { head: li.textContent.trim() }
        : li.classList.contains('archived-head')
          ? { archived: true }
          : { title: li.querySelector('.title')?.textContent || '', badge: li.querySelector('.badge')?.textContent || '', project: li.querySelector('.row-project')?.textContent || null }
    )
  )
const sortTo = async (label) => {
  await page.locator('.sort-button').click()
  await page.getByRole('menuitemradio', { name: label }).click()
  await page.waitForTimeout(100)
}

// Smart (default)
ok((await page.locator('.sort-button').innerText()).startsWith('Sort: Smart'), 'Smart is the default')
let l = (await list()).filter((x) => x.title)
const rank = (x) => (x.badge === 'needs you' ? 0 : x.badge === 'working' ? 1 : 2)
ok(l.every((x, i) => i === 0 || rank(l[i - 1]) <= rank(x)), `needs you → working → the rest: ${l.map((x) => x.badge || '·').join(',')}`)
const rest = l.filter((x) => rank(x) === 2)
ok(rest[0]?.title === 'Mock: long conversation', `the pinned (old, shelved) thread tops the rest (${rest[0]?.title})`)
await page.screenshot({ path: SHOTS + '/sort-01-smart.png' })

// Most recent
await sortTo('Most recent')
l = (await list()).filter((x) => x.title)
const shelvedOrder = l.filter((x) => !x.badge).map((x) => byTitle[x.title]?.at || 0)
ok(shelvedOrder.every((at, i) => i === 0 || shelvedOrder[i - 1] >= at), 'Most recent: shelved rows newest first')
ok(l.findIndex((x) => x.title === 'Mock: long conversation') > l.findIndex((x) => x.title === 'Mock: shelved conversation'), 'the pinned one falls to its place')
ok(l.findIndex((x) => !x.badge) > l.findLastIndex((x) => !!x.badge), 'live (happening now) before shelved')

// By project
await sortTo('By project')
let all = await list()
const heads = all.filter((x) => x.head).map((x) => x.head)
ok(heads.length >= 4 && heads[heads.length - 1] === 'Other' && ['agent-media', 'sasonica', 'runlet'].every((h) => heads.includes(h)), `headings: ${heads.join(' | ')}`)
let under = null
let right = true
for (const x of all) {
  if (x.archived) break
  if (x.head) under = x.head
  else if (x.title && (under === 'Other' ? x.project !== null : x.project !== under)) right = false
}
ok(right, 'every row sits under its own project ("Other" rows have none)')
await page.screenshot({ path: SHOTS + '/sort-02-project.png' })
await page.locator('.archived-head button').click()
all = await list()
const ai = all.findIndex((x) => x.archived)
ok(all[ai + 1]?.head === 'sasonica' && all[ai + 2]?.title === 'Mock: archived earlier', 'the Archived section follows the order (its own heading)')
await page.locator('.archived-head button').click()

// Per device
await page.reload()
await page.waitForSelector('.thread-row')
ok((await page.locator('.sort-button').innerText()).startsWith('Sort: By project') && (await page.locator('.project-head').count()) >= 4, 'the choice survives a reload')

// The sort menu dismisses without changing anything
await page.locator('.sort-button').click()
await page.waitForSelector('.sort-menu')
await page.mouse.click(200, 500)
await page.waitForTimeout(150)
ok((await page.locator('.sort-menu').count()) === 0 && page.url() === BASE + '/threads' && (await page.locator('.sort-button').innerText()).startsWith('Sort: By project'), 'a tap outside closes the sort menu; nothing opened, nothing changed')

// The project line
const rowProject = async (t) => page.locator(`a.thread-row[href="/t/${sid(t)}"] .row-project`)
ok((await (await rowProject('Mock: working')).innerText()) === 'agent-media', 'a row shows its project under the title')
ok((await (await rowProject('Mock: not on the shelf yet')).count()) === 0, 'no line where the project is null')
const lh = await page.locator(`a.thread-row[href="/t/${sid('Mock: working')}"] .row-project`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.closest('.thread-row')).fontSize))
ok(lh > 0.7 && lh < 0.8, `really small (${lh.toFixed(2)} em)`)
await page.goto(BASE + '/t/' + sid('Mock: working'))
await page.waitForSelector('.msg')
ok((await page.locator('.bar .thread-project').innerText()) === 'agent-media', 'the thread header: project under the title')
await page.goto(BASE + '/t/' + sid('Mock: not on the shelf yet'))
await page.waitForSelector('.msg')
ok((await page.locator('.bar .thread-project').count()) === 0, 'a thread with no project: no line')
await page.goto(BASE + '/')
await page.waitForSelector('.recap-row')
ok((await page.locator('.recap-row', { hasText: 'Mock: shelved conversation' }).locator('.row-project').innerText()) === 'sasonica', 'Home: a recap card carries its project')
ok((await page.locator('.working-row', { hasText: 'Mock: working' }).locator('.row-project').innerText()) === 'agent-media', 'Home: a working card too')

ok(!errors.length, `no page errors ${errors.join('; ')}`)
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
