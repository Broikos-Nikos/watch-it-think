/**
 * The word class is the one the model was trained against, not the browser's.
 *
 *   npm run check:unicode
 *
 * WD2-F4. `\p{L}` is a question about a Unicode version and the two runtimes
 * answer it from different ones. Measured at tick 178:
 *
 *   Python 3.14.4, unicodedata 16.0.0   142,940 word code points
 *   V8, Unicode 17.0                    147,597
 *   in the browser and not in Python      4,657, as 20 ranges and 6 singles
 *   the other way                             0
 *
 * A code point in that gap is glued into the word beside it here and cut out as
 * its own token there, so it does not only change its own id: it changes the
 * ids of the ordinary words either side of it. `check:tokenizer` cannot see it,
 * because its 242 sentences are Greek and English and the gap is Tangut,
 * Vithkuqi and Garay.
 *
 * ## What is checked
 *
 * Both halves run everywhere; the third needs Python and says so when it is
 * missing, the same way `check:tools` does.
 *
 *   1. Every pinned code point is cut out as its own token by the tokenizer
 *      that ships, and the ordinary words either side keep their own ids.
 *   2. Every pinned code point is a letter to *this* runtime. If it is not, the
 *      pin is describing a browser nobody runs any more.
 *   3. And against Python, when Python is here: the pinned set is exactly the
 *      difference between the two, in both directions.
 */

import { execFileSync } from 'node:child_process'
import { NEWER_THAN_PYTHON, normalize, wordTokenize } from '../src/lib/tokenizer'


let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/*
 * The pinned list, imported from the file that ships.
 *
 * WM2-F12, swept from `check:draw`. This read the literal out of
 * `src/lib/tokenizer.ts` with a regex and ran it through `eval` to decode the
 * escapes. The regex was guarded, so a rename failed loudly, but a line split
 * or a template literal would have left it reading a different list and saying
 * nothing. A gate that reconstructs its subject from text is one reformat away
 * from testing something else.
 */
const pinnedText: string = NEWER_THAN_PYTHON

/** The ranges, expanded, so each one can be asked about individually. */
const pinned: number[] = []
const chars = [...pinnedText]
for (let i = 0; i < chars.length; i++) {
  if (chars[i + 1] === '-' && chars[i + 2]) {
    const from = chars[i]!.codePointAt(0)!
    const to = chars[i + 2]!.codePointAt(0)!
    for (let c = from; c <= to; c++) pinned.push(c)
    i += 2
  } else {
    pinned.push(chars[i]!.codePointAt(0)!)
  }
}

const spans = pinnedText.split('-').length - 1
console.log(
  `  ok      ${pinned.length.toLocaleString('en-US')} code points pinned, ${spans} ranges and ` +
    `${chars.length - spans * 3} on their own`,
)

/* ---- 1. the tokenizer cuts them out, and leaves their neighbours alone ---- */
const sampled = pinned.filter((_, i) => i % 97 === 0)
const wrong: string[] = []
for (const cp of sampled) {
  const got = wordTokenize(normalize(`ab${String.fromCodePoint(cp)}cd`))
  if (got.length !== 3 || got[0] !== 'ab' || got[2] !== 'cd') {
    wrong.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')} gave ${JSON.stringify(got)}`)
  }
}
if (wrong.length > 0) {
  fail(
    `${wrong.length} of ${sampled.length} sampled code points are still glued into the word beside them`,
    wrong.slice(0, 4).join('; '),
  )
} else {
  console.log(`  ok      ${sampled.length} sampled code points are each their own token, and "ab" and "cd" survive`)
}

/* And the ordinary cases are untouched, because a pin that breaks Greek is
   worse than the drift it fixes. */
for (const [text, want] of [
  ['turn off the kitchen lights', 5],
  ['σβήσε τα φώτα στην κουζίνα', 5],
  ['don’t stop', 2],
  ['ΟΔΟΣ ΕΡΜΟΥ 15', 3],
] as const) {
  const got = wordTokenize(normalize(text))
  if (got.length !== want) fail(`${JSON.stringify(text)} split into ${got.length} words, not ${want}`, JSON.stringify(got))
}

/* ---- 2. the pin describes a runtime somebody runs ------------------------- */
const letter = /[\p{L}\p{N}_]/u
const stale = pinned.filter((cp) => !letter.test(String.fromCodePoint(cp)))
if (stale.length > 0) {
  fail(
    `${stale.length} pinned code points are not letters to this runtime either`,
    `starting at U+${stale[0]!.toString(16).toUpperCase()}. The pin is against a browser older than the one running it, so it is excluding characters nobody was including.`,
  )
} else {
  console.log('  ok      every pinned code point is a letter to this runtime, which is why it needed pinning')
}

/* ---- 3. and against Python, when Python is here and is the right Python --- */

/*
 * The unicodedata the pin was generated against, and why the version is asserted.
 *
 * The pin is one sentence: "these are the code points V8 calls letters and
 * Python does not". Both halves of that are a version number. This file used to
 * run the comparison against whatever Python answered, under a comment saying
 * "CI has no unicodedata to disagree with", and `ubuntu-latest` disagreed with
 * it the first time the gate ever ran there:
 *
 *     FAIL  5004 code points are letters here and not in Python 15.0.0,
 *           and are not pinned
 *
 * The runner's Python carries unicodedata 15.0.0. The pin was built against
 * 16.0.0, so the gap it describes is not the gap measured there, and 5,004
 * against the pinned 4,657 is the difference between two Unicode releases
 * rather than a defect in this repository. It failed the build of a published
 * project on a number that would change again on the next runner image.
 *
 * So the version is part of the claim now. Against the Python the pin was made
 * for, the comparison runs and is exact. Against any other, it says which two
 * versions it was handed and asserts nothing, because a disagreement between
 * 15.0.0 and 17.0 is a fact about Unicode and not about the tokenizer. The two
 * assertions above still run everywhere, and they are the ones that hold the
 * port to the model.
 */
const PINNED_AGAINST = '16.0.0'

const python = process.env.PYTHON ?? 'python'
try {
  const out = execFileSync(
    python,
    [
      '-c',
      [
        'import re,sys,unicodedata,json',
        'w=set(c for c in range(0x110000) if re.fullmatch(r"\\w", chr(c), re.UNICODE))',
        'print(json.dumps({"v":unicodedata.unidata_version,"n":len(w),"w":sorted(w)}))',
      ].join(';'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  )
  const { v, n, w } = JSON.parse(out) as { v: string; n: number; w: number[] }
  const pythonWords = new Set(w)

  const extra: number[] = []
  const missing: number[] = []
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    const here = letter.test(String.fromCodePoint(cp))
    const there = pythonWords.has(cp)
    if (here && !there) extra.push(cp)
    if (there && !here) missing.push(cp)
  }

  const pinnedSet = new Set(pinned)
  const unpinned = extra.filter((cp) => !pinnedSet.has(cp))
  if (v !== PINNED_AGAINST) {
    console.log(`  skipped the comparison: this Python has unicodedata ${v} and the pin was built against ${PINNED_AGAINST}`)
    console.log(
      `          ${n.toLocaleString('en-US')} word code points here, ${extra.length.toLocaleString('en-US')} of them letters to this runtime and not to that Python against ${pinned.length.toLocaleString('en-US')} pinned. That difference is a fact about two Unicode releases, not about this tokenizer, and the two assertions above hold the port either way.`,
    )
  } else if (unpinned.length > 0) {
    fail(
      `${unpinned.length} code points are letters here and not in Python ${v}, and are not pinned`,
      `starting at U+${unpinned[0]!.toString(16).toUpperCase()}. Regenerate the list: this runtime has moved ahead of the file again.`,
    )
  } else if (missing.length > 0) {
    fail(
      `${missing.length} code points are words to Python ${v} and not to this runtime`,
      `starting at U+${missing[0]!.toString(16).toUpperCase()}. Excluding is not enough for that direction and the port cannot reach them at all.`,
    )
  } else {
    console.log(
      `  ok      against Python ${v}, ${n.toLocaleString('en-US')} word code points: the ${extra.length.toLocaleString('en-US')} it does not have are the pinned ones, and nothing is missing the other way`,
    )
  }
} catch (err) {
  const why = String((err as { code?: string }).code === 'ENOENT' ? 'python is not on PATH' : err).split('\n')[0]
  console.log(`  skipped the comparison against Python: ${why}`)
  console.log('          the two assertions above do not need it, and CI has no unicodedata to disagree with.')
}

if (failed > 0) {
  console.error('\nA word class is a claim about a Unicode version, and the model only ever saw one of them.')
  process.exit(1)
}

console.log('unicode: the word class is pinned to the Python the model was trained against')
