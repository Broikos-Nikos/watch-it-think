/**
 * The page called "watch it think" actually moves, and the layout does not.
 *
 *   npm run check:motion
 *
 * `.race .bar` carried `transition: width 260ms` from the day it was written
 * and it never once fired. The render called `replaceChildren`, so every row
 * was a new element every time, and a new element starts at its final width:
 * there is nothing to transition from. The design audit found it by asking the
 * browser for its running animations and being told there were none.
 *
 * The data was never short of drama. Typing one sentence moves the leader
 * through six different intents, several times a second, and every frame of it
 * was thrown away and redrawn as a blink.
 *
 * Meanwhile the one thing that did move was the layout: the canvas backing
 * store is sized to the token count and its element size followed, so the page
 * slid up and down under a picture that sat still. Exactly backwards.
 *
 * So this gate checks both halves, and the second is what stops the first from
 * being satisfied by any old movement.
 */

import { chromium } from 'playwright'

const SENTENCE = 'set an alarm for seven thirty tomorrow'


let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.race li'), null, { timeout: 180_000 })
  await page.waitForTimeout(600)

  const seen = await page.evaluate(async (sentence) => {
    const el = document.querySelector('textarea')
    const race = document.querySelector('[data-race]')
    const field = document.querySelector('[data-field]')

    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))

    let running = 0
    let entries = 0
    let travels = 0
    const leaders = new Set()
    const identities = new Map()
    let rowsReplaced = 0
    const fieldWidths = new Set()

    for (const ch of sentence) {
      el.value += ch
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 70))

      // Counted by kind, not just counted.
      //
      // "Something animated" was true the whole time the entry animation was
      // dead: the travels were running and the arrivals were not. An entry is a
      // translateX and a travel is a translateY, so the two are separable and
      // the gate can require both.
      for (const a of document.getAnimations()) {
        if (a.playState !== 'running') continue
        running++
        let kind = ''
        try {
          kind = JSON.stringify(a.effect.getKeyframes())
        } catch {
          kind = ''
        }
        if (kind.includes('translateX')) entries++
        else if (kind.includes('translateY')) travels++
      }

      const leader = race.querySelector('li.is-leader .name')
      if (leader) leaders.add(leader.textContent)

      // A row for the same intent must be the same element as last time, or the
      // transition on it has nothing to animate from.
      //
      // Only while the intent stays in the list. An intent that drops out of
      // the top six and comes back later is a genuinely new row, and counting
      // that as a replacement made this check fail 31 times on a page that was
      // behaving correctly.
      const present = new Set()
      for (const li of race.querySelectorAll('li')) {
        const name = li.querySelector('.name')?.textContent
        if (!name) continue
        present.add(name)
        const was = identities.get(name)
        if (was && was !== li) rowsReplaced++
        identities.set(name, li)
      }
      for (const name of [...identities.keys()]) {
        if (!present.has(name)) identities.delete(name)
      }

      fieldWidths.add(Math.round(field.getBoundingClientRect().width))
    }

    return {
      running,
      entries,
      travels,
      leaders: [...leaders],
      rowsReplaced,
      fieldWidths: [...fieldWidths],
      keystrokes: sentence.length,
    }
  }, SENTENCE)

  // ---- 1. something actually animates --------------------------------------
  if (seen.running === 0) {
    fail(
      'nothing animated at any point while a sentence was typed',
      'the page is named for motion and the browser reports no running animations',
    )
  } else {
    console.log(`  ok      ${seen.running} running animations observed while typing ${seen.keystrokes} characters`)
  }

  // ---- 2. the rows survive, which is why it animates -----------------------
  if (seen.rowsReplaced > 0) {
    fail(
      `a race row was replaced ${seen.rowsReplaced} times rather than updated`,
      'a new element starts at its final width, so its transition never runs',
    )
  } else {
    console.log('  ok      every race row for a given intent is the same element across renders')
  }

  // ---- 2b. both kinds of movement actually happen --------------------------
  if (seen.entries === 0) {
    fail(
      'no row was ever seen arriving',
      'the entry animation was added and removed inside one task for two days, so it never ran once',
    )
  } else if (seen.travels === 0) {
    fail('no row was ever seen travelling, so the reordering is still a jump')
  } else {
    console.log(`  ok      ${seen.entries} arrivals and ${seen.travels} travels observed, both kinds move`)
  }

  // ---- 3. there was something worth animating ------------------------------
  // If the leader never changes, the first two can pass on a page that is still
  // a blink, because there was nothing to show.
  if (seen.leaders.length < 2) {
    fail(
      `the leader never changed while typing, so this run proves nothing`,
      `leaders seen: ${JSON.stringify(seen.leaders)}`,
    )
  } else {
    console.log(`  ok      the leader changed ${seen.leaders.length} times: ${seen.leaders.join(' to ')}`)
  }

  // ---- 4. the layout holds still -------------------------------------------
  if (seen.fieldWidths.length > 1) {
    fail(
      `the attention field took ${seen.fieldWidths.length} different widths while typing`,
      `${seen.fieldWidths.join(', ')} px. Motion only reads as motion against something that holds still.`,
    )
  } else {
    console.log(`  ok      the attention field held one width, ${seen.fieldWidths[0]} px, throughout`)
  }

  // ---- 5. and it all stops when asked --------------------------------------
  const reduced = await browser.newContext({ reducedMotion: 'reduce' })
  const rp = await reduced.newPage()
  await rp.goto(BASE, { waitUntil: 'domcontentloaded' })
  await rp.waitForFunction(() => !!document.querySelector('.race li'), null, { timeout: 180_000 })
  // Both halves. The stylesheet's transition AND anything the script starts.
  //
  // This used to read the transition alone and report "it all stops when
  // asked", while four script driven animations per row carried on. A gate that
  // checks the half that was already fixed is a gate that agrees with you.
  const longest = await rp.evaluate(async () => {
    const el = document.querySelector('textarea')
    el.value = 'set an alarm for seven thirty tomorrow'
    el.dispatchEvent(new Event('input', { bubbles: true }))

    // Sampled while an animation would still be running, not after it would
    // have finished. The first version waited 900 ms and then counted, which is
    // long after a 320 ms animation ends, so it reported zero whether the guard
    // was there or not: removing the guard entirely still passed.
    let running = 0
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      running = Math.max(running, document.getAnimations().filter((a) => a.playState === 'running').length)
    }

    return {
      transition: getComputedStyle(document.querySelector('.race .bar')).transitionDuration,
      running,
    }
  })
  // Parsed as a duration rather than matched as a string. The stylesheet sets
  // 1ms and the computed value comes back as "0.001s", which the first version
  // of this check read as a failure: it was testing the spelling.
  const ms = (() => {
    const v = longest.transition.trim()
    return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000
  })()
  if (!(ms <= 1)) {
    fail(`with reduced motion the bar still transitions over ${longest.transition.trim()}`)
  } else if (longest.running > 0) {
    fail(
      `with reduced motion ${longest.running} script driven animations are still running`,
      'the stylesheet stopped and the script did not, which is the half this check used to miss',
    )
  } else {
    console.log(`  ok      reduced motion stops the transition and the script, ${longest.transition.trim()} and 0 running`)
  }
  await reduced.close()

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA page named for motion has to move, and the thing that moves has to be the content.')
  process.exit(1)
}

console.log('motion: the race animates, the rows survive, and the layout holds still')
