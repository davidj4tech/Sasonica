// AskUserQuestion answered from the phone (§6.4, structured): the single-
// select fast path (a tap sends), a multi-select's checkboxes + Send (the
// ticks the desk made start ticked), "Other" words, two questions with one
// Send, a 409 that re-renders the card, a headless session that echoes
// `request_id`, and the card docked above the composer — in view under a
// reply taller than the screen. Mock only.
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
const answers = []
page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/session/answer') answers.push(JSON.parse(r.postData() || '{}')) })
page.on('pageerror', (e) => console.log('  pageerror', e.message))
await page.goto(BASE + '/settings')
await page.evaluate(([base, res]) => { localStorage.setItem('sasonica.chat.baseUrl', base); localStorage.setItem('sasonica.chat.device', JSON.stringify({ token: res.token, device_id: res.device_id, name: 't', server: res.server, pairedAt: Date.now() })) }, [BASE, pr])
const open = async (title) => {
  await page.goto(BASE + '/t/' + sid(title))
  await page.waitForSelector('.question-card', { timeout: 8000 })
}
const lastAnswer = () => answers[answers.length - 1]
const waitAnswers = async (n) => { for (let i = 0; i < 40 && answers.length < n; i++) await page.waitForTimeout(100) }
const gone = async () => { for (let i = 0; i < 40; i++) { if (!(await page.locator('.question-card').count())) return true; await page.waitForTimeout(150) } return false }

// 1. One single-select question: a tap sends it; no Send button
await open('Mock: asking a question')
ok((await page.locator('.question-card .send-answer').count()) === 0, 'single-select: no Send button until words are typed')
// The running turn's step list sits BELOW the card and pushed the question
// itself off the top of the screen (David, 23 Sep 2026). Folded to its head
// until the question is answered; the head still opens it by hand.
ok((await page.locator('.working .working-head').count()) === 1, 'a question with a turn still running: the Working head shows')
ok((await page.locator('.working .steps').count()) === 0, 'the step list is folded while the question waits')
await page.locator('.working .working-head').click()
ok((await page.locator('.working .steps').count()) === 1, 'tapping the head opens the steps anyway')
await page.locator('.working .working-head').click()
ok((await page.locator('.working .steps').count()) === 0, 'and folds them again')
ok((await page.locator('.question-card [role=radio]').count()) === 3, 'single-select: the three options as radios (not the "Type something" row)')
await page.screenshot({ path: SHOTS + '/ask-01-single.png' })
await page.locator('.question-card [role=radio]', { hasText: 'Last thread' }).click()
await waitAnswers(1)
let a = lastAnswer()
ok(a && JSON.stringify(a.answers) === JSON.stringify([{ question_index: 0, selected: [2] }]) && a.key && !('choice' in a), `tap → structured answer (${JSON.stringify(a)})`)
ok(await gone(), 'the card goes once answered')
ok((await page.locator('.working .steps').count()) === 1, 'the step list comes back once it is answered')

// 2. Multi-select: the desk's tick is kept; toggle; Other words; Send
await open('Mock: multi-select question')
const boxes = page.locator('.question-card [role=checkbox]')
ok((await boxes.count()) === 3, 'multi-select: three checkboxes')
ok((await boxes.nth(1).getAttribute('aria-checked')) === 'true', 'Pear starts ticked (checked on screen)')
ok((await page.locator('.q-header', { hasText: 'Fruit' }).count()) === 1, 'the header chip shows')
await boxes.nth(0).click()
await boxes.nth(2).click()
await boxes.nth(1).click() // untick Pear
await page.locator('.question-card .other input').fill('kiwi')
await page.screenshot({ path: SHOTS + '/ask-02-multi.png' })
const before = answers.length
await page.locator('.question-card .send-answer').click()
await waitAnswers(before + 1)
a = lastAnswer()
ok(a && JSON.stringify(a.answers) === JSON.stringify([{ question_index: 0, selected: [1, 3], other_text: 'kiwi' }]), `multi: Apple + Plum + "kiwi" (${JSON.stringify(a?.answers)})`)
ok(!('request_id' in a), 'a pane session sends no request_id')
ok(await gone(), 'multi: the card goes once answered')

// 3. Two questions, one Send; Other on a single-select deselects; 409 re-renders
await open('Mock: two questions')
ok((await page.locator('.question-card fieldset.question').count()) === 2, 'two questions stacked in one card')
const send = page.locator('.question-card .send-answer')
ok(await send.isDisabled(), 'Send disabled until every question has an answer')
await page.locator('.question-card fieldset').nth(0).locator('[role=radio]', { hasText: 'Blue' }).click()
ok((await page.locator('.question-card fieldset').nth(0).locator('[role=radio][aria-checked=true]').count()) === 1, 'a single-select tap in a two-question card picks, does not send')
ok(answers.length === before + 1, 'nothing sent yet')
await page.locator('.question-card fieldset').nth(0).locator('.other input').fill('teal')
ok((await page.locator('.question-card fieldset').nth(0).locator('[role=radio][aria-checked=true]').count()) === 0, 'Other words replace the single-select option')
ok(await send.isDisabled(), 'still disabled: the second question is unanswered')
await page.locator('.question-card fieldset').nth(1).locator('[role=checkbox]', { hasText: 'Cat' }).click()
await page.locator('.question-card fieldset').nth(1).locator('[role=checkbox]', { hasText: 'Fish' }).click()
ok(!(await send.isDisabled()), 'Send enabled once both are answered')
await page.screenshot({ path: SHOTS + '/ask-03-two.png' })
await send.click()
await waitAnswers(before + 2)
a = lastAnswer()
ok(a && JSON.stringify(a.answers) === JSON.stringify([{ question_index: 0, selected: [], other_text: 'teal' }, { question_index: 1, selected: [1, 3] }]), `two: teal + Cat, Fish (${JSON.stringify(a?.answers)})`)
await page.waitForSelector('.question-card .error', { timeout: 4000 })
ok(/changed/i.test(await page.locator('.question-card .error').innerText()), '409: "the question changed" shown')
ok((await page.locator('.q-text', { hasText: '(asked again)' }).count()) === 1, '409: the card re-rendered from the returned approval')
ok((await page.locator('.question-card [aria-checked=true]').count()) === 0 && (await page.locator('.question-card .other input').first().inputValue()) === '', '409: the picks start over')
await page.screenshot({ path: SHOTS + '/ask-04-changed.png' })
await page.locator('.question-card fieldset').nth(0).locator('[role=radio]', { hasText: 'Red' }).click()
await page.locator('.question-card fieldset').nth(1).locator('[role=checkbox]', { hasText: 'Dog' }).click()
const key409 = lastAnswer().key
await page.locator('.question-card .send-answer').click()
await waitAnswers(before + 3)
a = lastAnswer()
ok(a && a.key !== key409 && JSON.stringify(a.answers) === JSON.stringify([{ question_index: 0, selected: [1] }, { question_index: 1, selected: [2] }]), `after 409: answered with the new key (${JSON.stringify(a?.answers)})`)
ok(await gone(), 'two: the card goes once answered')
// The answered question reads back later with the chosen options (mock: the next line)

// 4. Headless: the card is on the pending ask part; request_id echoed
await open('Mock: headless question')
ok((await page.locator('.ask-dock .question-card').count()) === 1, 'headless: the card is docked above the composer')
ok((await page.locator('.question-card').count()) === 1, 'headless: one card, not a second on the ask part')
ok((await page.locator('.tool-card.ask.asking').count()) === 1, 'headless: the ask keeps its place in the thread, marked as waiting')
await page.locator('.question-card [role=checkbox]', { hasText: 'Plum' }).click()
await page.locator('.question-card .send-answer').click()
await waitAnswers(before + 4)
a = lastAnswer()
ok(a && a.request_id === 'req-mock-headless-1' && JSON.stringify(a.answers) === JSON.stringify([{ question_index: 0, selected: [3] }]), `headless: request_id + answers (${JSON.stringify(a)})`)
ok(await gone(), 'headless: the card goes once answered')
// Answered and read-only: the chosen label marked
await page.waitForSelector('.tool-card.ask.answered', { timeout: 6000 }).catch(() => null)
ok((await page.locator('.tool-card.ask.answered li.chosen', { hasText: 'Plum' }).count()) === 1, 'answered ask part marks the chosen option')
await page.screenshot({ path: SHOTS + '/ask-05-answered.png' })

// 5. The form stays in view under a reply taller than the screen (David,
// 23 Sep 2026): scrolled to the top of the thread, it is still on screen.
await open('Mock: asking after a long reply')
ok((await page.locator('.ask-dock .question-card').count()) === 1, 'long reply: the card is docked')
ok((await page.locator('.question-card').count()) === 1, 'long reply: one card only')
await page.evaluate(() => document.querySelector('.viewport').scrollTo(0, 0))
await page.waitForTimeout(400)
const box = await page.locator('.ask-dock').boundingBox()
const vh = await page.evaluate(() => innerHeight)
ok(box.y >= 0 && box.y + box.height <= vh + 1, `scrolled to the top, the form is still on screen (${Math.round(box.y)}…${Math.round(box.y + box.height)} of ${vh})`)
await page.screenshot({ path: SHOTS + '/ask-06-docked.png' })
await page.locator('.question-card [role=radio]', { hasText: 'New chat' }).click()
await waitAnswers(before + 5)
ok(await gone(), 'long reply: answered from the dock, and the dock goes')

// 6. A permission prompt still answers by number
await page.goto(BASE + '/t/' + sid('Mock: needs approval'))
await page.waitForSelector('.approval-options .option')
ok((await page.locator('.question-card').count()) === 0, 'a permission prompt is not a question card')
await page.locator('.approval-options .option').first().click()
await waitAnswers(before + 6)
a = lastAnswer()
ok(a && a.choice === 1 && !a.answers, `permission prompt: {choice, key} (${JSON.stringify(a)})`)

await b.close()
console.log(fails ? `${fails} failed` : 'all pass')
process.exit(fails ? 1 : 0)
