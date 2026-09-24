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

// 4. Share into a new chat: the chip is in the new chat's box.
await box().fill('')
await page.locator('button[aria-label="Thread menu"]').click()
await page.getByRole('menuitem', { name: 'Share into…' }).click()
await page.locator('.share-sheet').getByRole('menuitem', { name: 'New chat' }).click()
await page.waitForURL('**/new')
await page.waitForTimeout(400)
ok((await box().inputValue()).endsWith('@[Mock: not on the shelf yet] '), 'Share into… New chat puts the chip in the new chat')
await b.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
process.exit(fails ? 1 : 0)
