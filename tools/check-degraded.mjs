/**
 * The page is honest when the model is not there.
 *
 *   npm run check:degraded
 *
 * Two findings, made by the hostile stranger on 21 September and made again by
 * the hostile stranger on the 23rd, because the first pair was never closed.
 * Two days apart, the same two sentences.
 *
 * **With scripts off** the page said `loading the model` and would have said it
 * for as long as the visitor stayed. That string was chosen to reassure somebody
 * who is waiting, and this is the one case where it is untrue, told to exactly
 * the people most likely to have turned scripts off on purpose.
 *
 * **With the graph killed** the status line said so honestly and everything
 * else on the page forgot what it was: an empty paragraph under the headline, an
 * empty footer, and six sample chips that still looked like buttons and answered
 * nothing. A visitor found that out by clicking.
 *
 * Both are now structural rather than cosmetic. `meta.json` is 10 KB and is
 * fetched before the 5.28 MB graph, so the description is on the page in about a
 * hundred milliseconds whatever happens to the graph afterwards, and a failed
 * load disables the controls rather than leaving them live and inert.
 *
 * The gate drives both states rather than reading the markup, because the
 * question is what a visitor is looking at, and `<noscript>` in the source says
 * nothing about what the built bundle serves.
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()
const BASE = server.url

try {
  const browser = await chromium.launch()

  // ---- 1. javascript off ---------------------------------------------------
  {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    /*
     * innerText, not textContent, and the difference is the whole assertion.
     *
     * The noscript block hides the status line with a style rule rather than
     * removing it, because two sentences that contradict each other are worse
     * than either. textContent returns hidden text too, so the first version of
     * this failed against a page that was already correct: it was reading the
     * DOM where the docstring above promises to read what a visitor is looking
     * at.
     */
    const seen = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim()

    if (/loading the model/i.test(seen)) {
      fail(
        'with javascript off the page still says it is loading the model',
        'it will say that for as long as the visitor stays, and nothing is ever going to load',
      )
    } else if (!/javascript/i.test(seen)) {
      fail('with javascript off the page does not say that it needs javascript')
    } else {
      const noscript = (await page.textContent('[data-noscript]'))?.replace(/\s+/g, ' ').trim() ?? ''
      console.log(`  ok      javascript off: ${JSON.stringify(noscript.slice(0, 64))}...`)
    }
    await ctx.close()
  }

  // ---- 2. the graph never arrives ------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.route('**/router.int8.onnx', (r) => r.abort('failed'))
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => /did not load/i.test(document.querySelector('[data-status]')?.textContent ?? ''),
      null,
      { timeout: 60_000 },
    )

    const state = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-samples] button')]
      return {
        standfirst: (document.querySelector('[data-standfirst]')?.textContent ?? '').trim(),
        status: (document.querySelector('[data-status]')?.textContent ?? '').trim(),
        chips: chips.length,
        live: chips.filter((b) => !b.disabled).length,
        boxDisabled: document.querySelector('textarea')?.disabled ?? false,
      }
    })

    if (state.standfirst.length === 0) {
      fail(
        'the model failed and the page forgot how to describe itself',
        'the paragraph under the headline is written from meta.json, which is 10 KB and arrives long before the graph',
      )
    } else {
      console.log(`  ok      it still describes itself: ${JSON.stringify(state.standfirst.slice(0, 56))}...`)
    }

    if (state.live > 0 || !state.boxDisabled) {
      fail(
        `${state.live} of ${state.chips} sample chips and the box are still live with no model behind them`,
        'every one of them looks like a control and answers nothing, which a visitor finds out by clicking',
      )
    } else {
      console.log(`  ok      the box and all ${state.chips} chips are disabled, and the line says why`)
    }
    await ctx.close()
  }

  // ---- 3. a sentence that is not there gets no answer ----------------------
  //
  // U+0085 is whitespace to Python and not to String.prototype.trim, so one of
  // them alone used to survive the page's empty check, normalise away inside the
  // tokenizer and reach the model as <cls> alone. The page printed a verdict, a
  // race of six intents with bars, an empty tag box and twenty five flat squares
  // captioned "strongest single link 100 percent". The hostile stranger pass
  // called it a full, confident, empty answer.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 300_000 })
    await page.waitForTimeout(600)

    await page.fill('textarea', '')
    await page.waitForTimeout(1200)

    const after = await page.evaluate(() => ({
      resultHidden: document.querySelector('[data-result]')?.hidden ?? null,
      intent: (document.querySelector('[data-intent]')?.textContent ?? '').trim(),
      status: (document.querySelector('[data-status]')?.textContent ?? '').trim(),
    }))

    // Only whether the section is hidden. The previous answer's text stays in
    // the DOM behind `hidden`, and reading it was this assertion's own first
    // mistake: it failed against a page that had correctly hidden the result and
    // simply had not erased what was underneath.
    if (after.resultHidden !== true) {
      fail(
        `an input of U+0085 alone got an answer: ${JSON.stringify(after.intent)}`,
        'Python calls it whitespace, the tokenizer normalises it away, and the model saw only <cls>',
      )
    } else {
      console.log(`  ok      U+0085 alone is treated as nothing: ${JSON.stringify(after.status)}`)
    }
    await ctx.close()
  }

  // ---- 4. the page does not correct the input before the model sees it -----
  //
  // tokenizer.ts spends twenty lines on the byte order mark: Python's
  // str.strip() keeps it, so a sentence pasted out of a file carries one into
  // the model as a token, and PY_SPACE was built to match. The page then called
  // String.prototype.trim, which does strip U+FEFF, so "U+FEFF then hello" reached the
  // model byte for byte identical to "hello" where Python would have given one
  // position more. The tokenizer half of this is in check:input and it always
  // passed, because the tokenizer was never the broken end.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 300_000 })

    const positionsFor = async (text) => {
      await page.fill('textarea', text)
      await page.waitForTimeout(900)
      return (await page.evaluate(() => document.querySelectorAll('.axis-token').length))
    }
    const plain = await positionsFor('hello')
    const marked = await positionsFor('\uFEFFhello')

    if (marked === plain) {
      fail(
        `a leading byte order mark changed nothing: ${marked} positions either way`,
        'the page is stripping it before the model sees it, and the model was trained on text that keeps it',
      )
    } else {
      console.log(`  ok      a byte order mark reaches the model: ${marked} positions against ${plain} without it`)
    }
    await ctx.close()
  }

  // ---- 5. every chip says which token it is --------------------------------
  //
  // Two findings from the same pass. Continuation pieces all read ".." on the
  // axis, so a sentence with one long word gave sixty four chips of which fifty
  // nine said nothing, and the axis is the only label the 520 pixel field has.
  // And a zero width space is its own token, so it drew an empty chip that could
  // still be handed a slot tag: a tag attached to nothing visible.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 300_000 })

    await page.fill('textarea', 'the hash is 9f86d081884c7d659a2feaa0c55ad015 ok')
    await page.waitForTimeout(1200)
    const axis = await page.evaluate(() =>
      [...document.querySelectorAll('.axis-token')].map((b) => b.textContent.trim()),
    )
    const dots = axis.filter((t) => t === '..').length

    if (dots > 0) {
      fail(
        `${dots} of ${axis.length} axis chips read ".." and say nothing`,
        'the axis is the only label the large field has, and it goes blank exactly when it is fullest',
      )
    } else {
      console.log(`  ok      all ${axis.length} axis chips name their token, longest word included`)
    }

    // A zero width space between two letters: its own token, and it used to draw
    // an empty chip.
    await page.fill('textarea', 'hel\u200Blo there')
    await page.waitForTimeout(1200)
    /*
     * Measured as rendered width, not as string length, and the first version of
     * this got it wrong in the way the finding is about. A chip holding a zero
     * width space has a text length of one, so `length === 0` passed against the
     * page that draws it as an empty sliver. The finding was never about empty
     * strings; it was about characters with no ink.
     *
     * A Range around the text node gives what the browser actually drew.
     */
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('.word')].map((s) => {
        const node = s.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE) return { text: '', width: 0 }
        const r = document.createRange()
        r.selectNodeContents(node)
        return { text: node.textContent, width: r.getBoundingClientRect().width }
      }),
    )
    const blank = chips.filter((c) => c.width < 1).length

    if (blank > 0) {
      fail(
        `${blank} of ${chips.length} word chips draw nothing at all`,
        'an invisible token gets a chip like any other, and a chip with no ink can still carry a slot tag',
      )
    } else {
      console.log(
        `  ok      all ${chips.length} word chips draw something: ` +
          JSON.stringify(chips.map((c) => c.text).join(' ')),
      )
    }
    await ctx.close()
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA page that cannot work should say so, not pretend to be loading.')
  process.exit(1)
}

console.log('degraded: with no scripts and with no model, the page says what is true')
