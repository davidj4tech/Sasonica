// Naming another thread by chip (lib/refs.ts, server §6.3 `refs`): long press
// → Share into… → a thread: the chip waits at the end of its draft and it
// opens; sending carries `refs` and the sent message shows the chip as a
// link, not the server's footer line. `@` in the composer offers threads by
// title and a tap puts the chip in place of `@letters`. Mock only.
import { chromium, SHOTS } from './lib.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:8811'
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
await fetch(BASE + '/mock/delay?ms=0')
await fetch(BASE + '/mock/reply?delay=0&skew=0&flatten=0&fail=0')
await fetch(BASE + '/mock/pair')
const pr = await (await fetch(BASE + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'c0ffee42' }) })).json()
const targets = await (await fetch(BASE + '/targets', { headers: { Authorization: 'Bearer ' + pr.token } })).json()
const sid = (t) => targets.sessions.find((s) => s.title === t)?.session
const last = async () => (await fetch(BASE + '/mock/last-send')).json()
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })).newPage()
await page.route('**/input', (r) => r.abort())
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
const box = () => page.locator('.composer textarea')

// 1. Share into… from the list's long press.
const shared = sid('Mock: shelved conversation')
const into = sid('Mock: not on the shelf yet')
await longPress(shared)
await page.getByRole('menuitem', { name: 'Share into…' }).click()
await page.waitForSelector('.share-sheet')
ok(!(await page.locator('.share-sheet').getByRole('menuitem', { name: 'Mock: shelved conversation' }).count()), 'the sheet does not offer the thread itself')
// Rows never overlap, however long a title wraps (David's screenshot, 24 Sep 2026):
// the largest text on a narrow screen, so the titles wrap.
await page.evaluate(() => localStorage.setItem('sasonica.chat.textSize2', 'largest'))
await page.setViewportSize({ width: 300, height: 780 })
await page.reload()
await page.getByRole('menuitem', { name: 'Share into…' }).waitFor().catch(() => {})
if (!(await page.locator('.share-sheet').count())) {
  await longPress(shared)
  await page.getByRole('menuitem', { name: 'Share into…' }).click()
  await page.waitForSelector('.share-sheet')
}
const wrapped = await page.evaluate(() => [...document.querySelectorAll('.share-sheet .share-title')].some((t) => t.getClientRects().length > 1 || t.offsetHeight > 40))
ok(wrapped, 'some titles wrap at this size (the case being tested)')
await page.screenshot({ path: SHOTS + '/refs-00-share-largest.png' })
const overlaps = await page.evaluate(() => {
  const r = [...document.querySelectorAll('.share-sheet .action-list button')].map((b) => b.getBoundingClientRect())
  return r.filter((a, i) => i && a.top < r[i - 1].bottom - 1).length + [...document.querySelectorAll('.share-sheet .action-list button')].filter((b) => b.scrollHeight > b.clientHeight + 1).length
})
ok(overlaps === 0, `share rows hold their text, none overlapping (${overlaps})`)
await page.evaluate(() => localStorage.setItem('sasonica.chat.textSize2', 'default'))
await page.setViewportSize({ width: 390, height: 780 })
await page.reload()
await page.waitForSelector('.thread-row')
await longPress(shared)
await page.getByRole('menuitem', { name: 'Share into…' }).click()
await page.waitForSelector('.share-sheet')
await page.locator('.share-find').fill('not on the')
await page.screenshot({ path: SHOTS + '/refs-01-share-sheet.png' })
await page.locator('.share-sheet').getByRole('menuitem', { name: /not on the shelf yet/ }).click()
await page.waitForURL(`**/t/${into}`)
await page.waitForTimeout(400)
ok((await box().inputValue()) === '@[Mock: shelved conversation] ', 'the chip is waiting in the chosen thread\'s box')

// 2. Send it: refs go with it, and the message shows a link, not the footer.
await box().press('End')
await box().type('what did we decide?')
await box().press('Control+Enter')
await page.waitForTimeout(1200)
const sent = await last()
ok(sent?.refs?.['Mock: shelved conversation'] === shared, '/reply carried refs {title: session}')
const link = page.locator('.msg.user a.ref-chip').last()
ok((await link.count()) === 1 && (await link.getAttribute('href')) === `/t/${shared}`, 'the sent chip is a link to its thread')
const bubble = await page.locator('.msg.user .bubble').last().innerText()
ok(!bubble.includes('is conversation') && bubble.includes('@Mock: shelved conversation'), 'the footer line is not shown')
await page.waitForTimeout(1500)
const copies = await page.locator('.msg.user .bubble', { hasText: 'what did we decide?' }).count()
ok(copies === 1, `shown once: the "sending…" copy gives way to the server's line with its footer (${copies})`)
await page.screenshot({ path: SHOTS + '/refs-02-sent.png' })

// 3. @ in the composer.
await box().fill('compare with @shel')
await page.waitForSelector('.mention-list')
await page.screenshot({ path: SHOTS + '/refs-03-mention.png' })
await page.locator('.mention-list button', { hasText: 'Mock: shelved conversation' }).click()
ok((await box().inputValue()) === 'compare with @[Mock: shelved conversation] ', 'a tap puts the chip in place of @letters')
ok(!(await page.locator('.mention-list').count()), 'the list closes after the pick')
await box().fill('mail me @ ')
await page.waitForTimeout(200)
ok(!(await page.locator('.mention-list').count()), 'a space after @ closes it')
await box().fill('x@y')
await page.waitForTimeout(200)
ok(!(await page.locator('.mention-list').count()), 'an @ inside a word (an address) opens nothing')
await box().fill('@')
await page.waitForSelector('.mention-list')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
ok(!(await page.locator('.mention-list').count()), 'Escape closes it')

// 4. The thread's own ⋮ → Insert a thread…: the chip goes in at the caret,
// and nothing typed is lost (David, 25 Sep 2026: "I'd rather it just insert
// where the cursor is").
await box().fill('compare this with that')
await box().evaluate((el) => el.setSelectionRange('compare this '.length, 'compare this '.length))
await page.locator('button[aria-label="Thread menu"]').click()
ok(!(await page.getByRole('menuitem', { name: 'Share into…' }).count()), 'the thread\'s ⋮ offers Insert, not Share into…')
await page.getByRole('menuitem', { name: 'Insert a thread…' }).click()
await page.waitForSelector('.share-sheet')
ok(!(await page.locator('.share-sheet').getByRole('menuitem', { name: 'New chat' }).count()), 'no New chat in the insert picker')
await page.locator('.share-sheet').getByRole('menuitem', { name: /shelved conversation/ }).click()
await page.waitForTimeout(300)
ok((await box().inputValue()) === 'compare this @[Mock: shelved conversation] with that', `inserted at the caret: ${JSON.stringify(await box().inputValue())}`)
ok(new URL(page.url()).pathname === `/t/${into}`, 'it stays in this thread')
await page.reload()
await page.waitForSelector('.composer textarea')
await page.waitForTimeout(600)
ok((await box().inputValue()) === 'compare this @[Mock: shelved conversation] with that', 'kept as the draft')

// 5. Share into a new chat, from the list: the chip is in the new chat's box.
await box().fill('')
await page.goto(BASE + '/threads')
await page.waitForSelector('.thread-row')
await longPress(into)
await page.getByRole('menuitem', { name: 'Share into…' }).click()
await page.locator('.share-sheet').getByRole('menuitem', { name: 'New chat' }).click()
await page.waitForURL('**/new')
await page.waitForTimeout(400)
ok((await box().inputValue()).endsWith('@[Mock: not on the shelf yet] '), 'Share into… New chat puts the chip in the new chat')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
