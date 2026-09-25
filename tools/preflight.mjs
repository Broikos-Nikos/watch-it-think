/**
 * The browser these gates need, checked before the first gate needs it.
 *
 * WE-F10, and the same file in all eight projects here, because all eight ran a
 * browser suite and not one of them checked. On a machine that has never run
 * Playwright, `npm run verify` started a preview server and then handed the same
 * failure to every gate in turn. Measured in `watch-it-think` at tick 165, with
 * the browser path pointed at an empty directory:
 *
 *   352 lines of output
 *   13 uncaught stack traces, one per gate
 *   13 copies of Playwright's own "Looks like Playwright was just installed"
 *   9.6 seconds, ending in "13 of 13 browser gates failed"
 *
 * Every one of those thirteen says the same thing, and none of them is the
 * repository speaking: they are Node printing an unhandled rejection. The
 * README has said `npx playwright install chromium` since the day it was
 * written, and a person who skipped that line got a stack trace rather than
 * that sentence.
 *
 * The audit filed this against `npm run build`, which is where the browser
 * gates lived on 2026-09-21. They moved out at tick 111, so the build is clean
 * on a bare machine and the defect moved with the gates rather than going away.
 *
 * ## Why this launches a browser instead of looking for one
 *
 * Because the obvious version of this check is wrong, and measurably so:
 *
 *   chromium.executablePath()   chromium-1228/chrome-win64/chrome.exe
 *   what a headless launch runs chromium_headless_shell-1228/...-shell.exe
 *
 * Two different binaries, and `npx playwright install chromium` fetches both.
 * With only the first in place, `existsSync(chromium.executablePath())` is true
 * and every gate still dies. A launch costs 111 ms when the browser is there
 * and 10 ms when it is not, which is less than the check that would have been
 * wrong.
 */

import { chromium } from 'playwright'

export async function browserReady() {
  try {
    const browser = await chromium.launch()
    await browser.close()
  } catch (err) {
    const first = String(err).split('\n')[0].replace(/^Error:\s*/, '')
    console.error('These gates drive a real browser, and Playwright has no browser to drive here.\n')
    console.error('  npx playwright install chromium\n')
    console.error(`  ${first}`)
    process.exit(1)
  }
}
