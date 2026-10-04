/**
 * What a label out of `meta.json` is allowed to look like.
 *
 * WS-F7. These 109 strings, 44 intents and 65 BIO tags, are the only part of
 * the page's output that does not come from the bundle: they are fetched at
 * boot from a directory the page is pointed at, and they are printed as the
 * page's own answer. The supply chain pass found them reaching `innerHTML`,
 * which is fixed, and noted that nothing anywhere said what they may contain.
 *
 * Measured at tick 202 by writing `<img src=x onerror=alert(1)>` into the
 * intent the test sentence resolves to: no element created, no request off
 * origin, nothing from the Content Security Policy, because `textContent` and
 * the policy are both doing their jobs. The page printed the whole string as
 * its own verdict, and all 23 build gates passed.
 *
 * The shapes are derived from the 109 strings that exist rather than guessed.
 * Every intent is lowercase, dotted or underscored: `alarm.set`, and also `oos`
 * and `translate`, which is why a first attempt requiring a dot was wrong.
 * Every tag is `O`, or `B-` or `I-` and a lowercase word: `B-unit_to`, which is
 * why a first attempt requiring upper case failed 64 of 65. The longest of each
 * is 22 and 12 characters.
 *
 * This file exists on its own, rather than inside `router.ts`, because
 * `router.ts` imports the onnxruntime wasm through vite's `?url` and cannot be
 * loaded by a tool in node. `check:shape` imports these three and holds the
 * committed file to them; `router.ts` imports them and holds the fetched one.
 * One source, and the second reach is the one a build gate cannot have: a fork
 * pointed at somebody else's model directory only meets the runtime.
 */

export const INTENT_SHAPE = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/
export const TAG_SHAPE = /^(?:O|[BI]-[a-z][a-z0-9_]*)$/

/** Longer than any label that exists, by a factor of nearly two. */
export const LABEL_MAX = 40

export const LABEL_FIELDS = [
  ['intents', INTENT_SHAPE, 'what the page calls the thing you asked for'],
  ['slotTags', TAG_SHAPE, 'what it calls each word of your sentence'],
] as const

/**
 * The two arrays, held to their shapes. Throws with what is wrong and where.
 *
 * It throws rather than filtering, because a page that quietly drops the labels
 * it does not like would answer with the wrong intent's name rather than with
 * nothing, and the one thing worse than no answer here is a confident wrong
 * one. The page already knows how to show a load failure: `check:degraded`
 * asserts the standfirst stays, the box is disabled and a reason is given.
 */
export function checkLabels<T>(meta: T): T {
  for (const [field, shape] of LABEL_FIELDS) {
    const arr = (meta as unknown as Record<string, unknown>)[field]
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`meta.json has no ${field}, so the page has nothing to call its own answers`)
    }
    for (const [i, value] of arr.entries()) {
      if (typeof value !== 'string' || value.length > LABEL_MAX || !shape.test(value)) {
        const shown = typeof value === 'string' ? value.slice(0, 60) : typeof value
        throw new Error(`meta.json ${field}[${i}] is not a label this page will print: ${JSON.stringify(shown)}`)
      }
    }
  }
  return meta
}
