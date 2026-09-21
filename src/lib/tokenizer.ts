/**
 * The router's tokenizer, in the browser.
 *
 * This is a port, not a reimplementation. The model was trained on ids produced
 * by `bslm/tokenizer.py`, so a port that is merely close produces ids the model
 * has never seen and the page quietly shows a worse model than the one that was
 * trained. `tools/check-tokenizer.py` runs both over the same sentences and
 * fails on a single differing id.
 *
 * Four places where the obvious JavaScript is wrong, or the clever JavaScript
 * is. The gate found the first three. It did not find the fourth, and said so
 * in the strongest terms available to it, by printing "identical to
 * bslm/tokenizer.py" over 230 sentences none of which contained the character
 * that breaks it. A gate is a statement about its inputs and nothing else.
 *
 * 1. Python's `\w` under `re.UNICODE` is letters, digits and underscore, which
 *    is `[\p{L}\p{N}_]` rather than JavaScript's ASCII only `\w`.
 * 2. `str.isupper()` is true only when there is at least one cased character
 *    and every one of them is upper case, which is not the same as
 *    `s === s.toUpperCase()`: that is also true of `'123'` and of `'.'`.
 * 3. Lowercasing is a plain `toLowerCase()` on the whole word, and the first
 *    version of this file lowercased each code point separately on the theory
 *    that Python does not apply the Greek final sigma rule. Python applies it:
 *    `'ΟΔΟΣ'.lower()` is `'οδος'` in both languages, with a final sigma, and
 *    `'Σ'` alone is `'σ'` in both. The per character version was the thing that
 *    broke it, producing `##σ` where the model expects `##ς`, two token ids
 *    apart. The comment asserting a difference had been written before anything
 *    was measured, which is how a defect gets an explanation attached to it.
 * 4. `\s` is a different set of code points in each language, in both
 *    directions. See the note on PY_SPACE below. Found by an audit reading the
 *    two classes side by side, not by the gate, and the twelve sentences that
 *    now cover it were added the same day.
 */

export interface TokenizerData {
  vocab: Record<string, number>
  merges: [string, string, number][]
}

const PAD = '<pad>'
const UNK = '<unk>'
const CLS = '<cls>'


/**
 * Python's whitespace, not JavaScript's. They are not the same set.
 *
 * `bslm/tokenizer.py` collapses runs of `\s` and then calls `.strip()`, both of
 * which use Python's class. Enumerated from the two runtimes: Python matches 29
 * code points and JavaScript 25, and the difference is not symmetric. Python has
 * U+001C to U+001F and U+0085, which JavaScript does not. JavaScript has U+FEFF,
 * which Python does not, and `String.prototype.trim` strips it while
 * `str.strip()` leaves it in place.
 *
 * So a byte order mark at the front of a pasted sentence, which is the single
 * most likely invisible character in text that has been through a file, becomes
 * an `<unk>` token in Python and nothing at all in JavaScript. The model was
 * trained on the Python behaviour.
 *
 * Generated from `[c for c in range(0x11000) if re.fullmatch(r'\s', chr(c))]`,
 * not from memory.
 */
const PY_SPACE =
  '\t\n\v\f\r\u001C-\u001F \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000'
const PY_SPACE_RUN = new RegExp(`[${PY_SPACE}]+`, 'gu')

/**
 * The pre-tokenizer, character for character the one the corpus was built with,
 * including its whitespace class.
 *
 * `[^\w\s]` in Python is "not a word character and not whitespace", and after
 * the fix above a byte order mark is no longer whitespace here either, so it
 * falls into this class and becomes a token exactly as it does in Python. Built
 * from PY_SPACE rather than written out, so the two can never drift apart.
 */
const W = String.raw`\p{L}\p{N}_`
const WORD_RE = new RegExp(
  `[${W}]+(?:['’´][${W}]+)?|[^${W}${PY_SPACE}]`,
  'gu',
)
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'gu')

export function normalize(text: string): string {
  return text.normalize('NFC').replace(PY_SPACE_RUN, ' ').replace(PY_STRIP, '')
}

export function wordTokenize(text: string): string[] {
  return text.match(WORD_RE) ?? []
}

/**
 * Whole word, contextual rules and all, because that is what `str.lower()` does.
 * See note 3 in the header before changing this.
 */
const lower = (word: string) => word.toLowerCase()

const hasCase = (s: string) => s.toLowerCase() !== s.toUpperCase()

/** Python's str.isupper: at least one cased character, and all of them upper. */
function isUpper(s: string): boolean {
  let cased = false
  for (const ch of s) {
    if (!hasCase(ch)) continue
    cased = true
    if (ch !== ch.toUpperCase()) return false
  }
  return cased
}

export function caseId(word: string): 0 | 1 | 2 {
  if (isUpper(word) && [...word].length > 1) return 2
  const first = [...word][0]
  if (first !== undefined && hasCase(first) && first === first.toUpperCase()) return 1
  return 0
}

export interface Encoded {
  ids: number[]
  cases: number[]
  /** Which word each position belongs to, or -1 for a continuation piece. */
  wordIndex: number[]
}

export class Tokenizer {
  private readonly vocab: Map<string, number>
  private readonly merges: Map<string, number>
  private readonly cache = new Map<string, number[]>()
  readonly unk: number
  readonly cls: number
  readonly pad: number
  readonly size: number

  constructor(data: TokenizerData) {
    this.vocab = new Map(Object.entries(data.vocab))
    this.merges = new Map(data.merges.map(([a, b, rank]) => [`${a}\u0000${b}`, rank]))
    this.unk = this.vocab.get(UNK)!
    this.cls = this.vocab.get(CLS)!
    this.pad = this.vocab.get(PAD)!
    this.size = this.vocab.size
  }

  /** Greedy lowest rank merge, the same loop the trainer ran. */
  encodeWord(word: string): number[] {
    const key = lower(word)
    const hit = this.cache.get(key)
    if (hit) return hit

    const chars = [...key]
    let syms = chars.length === 0 ? [] : [chars[0], ...chars.slice(1).map((c) => `##${c}`)]

    while (syms.length > 1) {
      let best = -1
      let rank: number | null = null
      for (let i = 0; i < syms.length - 1; i++) {
        const r = this.merges.get(`${syms[i]}\u0000${syms[i + 1]}`)
        if (r !== undefined && (rank === null || r < rank)) {
          best = i
          rank = r
        }
      }
      if (best === -1) break
      const a = syms[best]
      const b = syms[best + 1]
      const merged = b.startsWith('##') ? a + b.slice(2) : a + b
      syms = [...syms.slice(0, best), merged, ...syms.slice(best + 2)]
    }

    const out = syms.map((s) => this.vocab.get(s) ?? this.unk)
    this.cache.set(key, out)
    return out
  }

  encode(words: string[], maxLen = 64): Encoded {
    const ids = [this.cls]
    const cases: number[] = [0]
    const wordIndex: number[] = [-1]

    for (const [wi, w] of words.entries()) {
      const pieces = this.encodeWord(w)
      const c = caseId(w)
      for (const [pi, p] of pieces.entries()) {
        if (ids.length >= maxLen) break
        ids.push(p)
        cases.push(c)
        wordIndex.push(pi === 0 ? wi : -1)
      }
    }

    return {
      ids: ids.slice(0, maxLen),
      cases: cases.slice(0, maxLen),
      wordIndex: wordIndex.slice(0, maxLen),
    }
  }

  encodeText(text: string, maxLen = 64): { words: string[] } & Encoded {
    const words = wordTokenize(normalize(text))
    return { words, ...this.encode(words, maxLen) }
  }
}
