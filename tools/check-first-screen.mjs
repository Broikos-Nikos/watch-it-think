/**
 * The ten seconds most people give this say the thing worth saying.
 *
 *   npm run check:first-screen
 *
 * The recruiter audit read this repository the way a recruiter does and did not
 * keep scrolling. The sentence that matters:
 *
 *   "Thirty eight of my forty candidates wrapped somebody else's model in an
 *    API call. I cannot tell this one apart from them in ten seconds."
 *
 * The fact that the model was trained from nothing by the author was on line 39
 * of the README, in the passive voice, in a section called "What it is", after
 * a paragraph about quantisation. It is the single most unusual thing about the
 * project and it was below everything.
 *
 * Every other gate in this repository checks whether something is true. This
 * one checks whether it is reachable, which is a different question and the one
 * seven audits never asked.
 *
 * It is deliberately crude. It cannot tell good writing from bad, and it does
 * not try. It asserts that the claim exists above the picture, that the page
 * makes the same claim, and that the first thing a reader meets after the
 * picture is not a shell command.
 *
 * The same recruiter came back and read it again. The claim had moved to the
 * top and it worked, and the fix had grown its own defect: 760 characters and
 * eighteen lines of prose before the picture, against 555 in `tokenlab`, which
 * is the repository they said they would open first. Two of the four paragraphs
 * were about where the evidence lives rather than about what the thing does.
 * The strongest asset here had gone from second and wrong to fifth and right.
 *
 * So there is now a budget on the words above the picture, and the rule about
 * the proof link is a rule about the opening section rather than about the
 * picture. Under the picture is still one click away, and it costs the reader
 * who does not care nothing. See D13.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Line endings normalised before anything counts characters. On this machine
// the working copy is CRLF and in CI it is LF, so the budget below measured 327
// here and would have measured 319 there: a gate whose number depends on the
// checkout is a gate that can fail on one machine and pass on the other.
const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

// Everything before the first image is what a reader sees before they have
// scrolled past the thing that stopped them.
const imageAt = readme.indexOf('![')
if (imageAt < 0) {
  fail('there is no image in the README, and a project named for motion leads with one')
}
const above = readme.slice(0, imageAt < 0 ? 600 : imageAt)

// ---- the claim, in the first person, above the picture ---------------------
const saysTrained = /\btrained\b/i.test(above)
const firstPerson = /\b(I|my|mine)\b/.test(above)

if (!saysTrained) {
  fail(
    'nothing above the picture says the model was trained',
    'this is the one fact that separates the project from wrapping somebody else\'s model',
  )
} else if (!firstPerson) {
  fail(
    'the training claim above the picture is not in the first person',
    'the passive voice reads as a fact about a model rather than as a thing a person did',
  )
} else {
  const line = above.split('\n').find((l) => /\btrained\b/i.test(l))?.trim()
  console.log(`  ok      the claim is above the picture: ${JSON.stringify(line?.slice(0, 68))}`)
}

// ---- the picture is not buried under the prose -----------------------------
//
// 500, because tokenlab opens in 555 and that is the one a reader said they
// would open first. It leaves room for the claim and a paragraph under it, and
// it fails at the 760 this README carried for eleven ticks.
const BUDGET = 500
if (above.length > BUDGET) {
  fail(
    `there are ${above.length} characters before the picture, over the ${BUDGET} budget`,
    'the recording is the strongest thing here and every sentence above it is a sentence between a reader and it',
  )
} else {
  console.log(`  ok      ${above.length} characters before the picture, under ${BUDGET}`)
}

// ---- the proof is linked in the opening, not necessarily above the picture --
//
// This used to require the link above the picture, which is half of why there
// were eighteen lines up there. The claim needs its evidence one click away,
// not one click away and before the thing that makes anybody want the evidence.
// The opening section is everything before the first horizontal rule.
const opening = readme.split('\n---')[0]
if (!/github\.com\/Broikos-Nikos\/bslm/.test(opening)) {
  fail(
    'the training repository is not linked in the opening section',
    'a claim to have trained a model should be one click from the evidence, and not below a fold',
  )
} else {
  const side = /github\.com\/Broikos-Nikos\/bslm/.test(above) ? 'above' : 'under'
  console.log(`  ok      the training repository is linked in the opening, ${side} the picture`)
}

// ---- and the first thing after it is not a command -------------------------
const after = readme.slice(imageAt).split('\n').slice(1).join('\n')
const firstBlock = after.split('##')[1] ?? ''
const firstProse = after.trimStart().slice(0, 200)
if (/^```/.test(firstProse)) {
  fail('the first thing under the picture is a code block', 'a reader who does not run commands has nowhere to go')
} else {
  console.log('  ok      the first thing under the picture is prose')
}
void firstBlock

// ---- the page makes the same promise ---------------------------------------

/*
 * The server comes from tools/serve.mjs: one preview on a port the operating
 * system hands out, proved to be serving this build. Each gate used to spawn
 * its own on a hardcoded number, which is how ten of them leaked and how one
 * was caught reporting green against a page it never started.
 *
 * WIT_URL, when set, is a server somebody else already started, which is what
 * npm run verify does for the whole browser pass.
 */
const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()
const BASE = server.url

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1')

  const h1 = (await page.textContent('h1'))?.trim() ?? ''
  if (!/\btrained\b/i.test(h1)) {
    fail(
      `the page headline does not say the model was trained: ${JSON.stringify(h1)}`,
      'it used to give a parameter count, which is a specification and not a reason',
    )
  } else {
    console.log(`  ok      the page headline says it too: ${JSON.stringify(h1)}`)
  }

  // On the device most people will open it on, the claim has to be visible
  // without scrolling.
  const visible = await page.evaluate(() => {
    const h = document.querySelector('h1')
    const r = h.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight
  })
  if (!visible) {
    fail('the headline is not fully visible at 390 by 844 without scrolling')
  } else {
    console.log('  ok      the headline is fully on screen at phone size')
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nBeing true is not the same as being reachable.')
  process.exit(1)
}

console.log('first screen: the claim is above the picture, linked to its proof, and on the page')
