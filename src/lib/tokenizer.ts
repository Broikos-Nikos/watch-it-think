/**
 * The router's tokenizer, in the browser.
 *
 * This is a port, not a reimplementation. The model was trained on ids produced
 * by `bslm/tokenizer.py`, so a port that is merely close produces ids the model
 * has never seen and the page quietly shows a worse model than the one that was
 * trained. `tools/check-tokenizer.ts` compares this against a fixture the
 * Python dumped, over 242 sentences, and fails on a single differing id. It
 * does not run Python: the fixture records which bslm commit and which sha256
 * it came from, and the gate prints them, because otherwise "identical" is a
 * claim about a snapshot with no date on it.
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
 * How many distinct words the merge cache keeps. Large enough that ordinary
 * use never evicts, small enough that a session of pasting cannot grow the
 * heap without limit. The vocabulary itself is 4,000 entries.
 */
const CACHE_LIMIT = 20_000


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

  /**
   * Greedy lowest rank merge, the same result the trainer's loop gives, but not
   * the same loop.
   *
   * The obvious version rescans every adjacent pair on every merge and rebuilds
   * the array each time, so it is quadratic twice over. On words that is
   * invisible. On a paste with no spaces in it, it is not: 32,000 characters
   * took 13.8 seconds here and 21.6 in the browser, with the tab unusable
   * throughout, and 128,000 characters took four and a quarter minutes.
   *
   * The tempting fix is to cut the word down first, since the model only ever
   * sees `maxLen` tokens anyway. That is wrong, and measurably so: BPE is not
   * prefix stable. Merging is greedy by rank across the whole word, so a merge
   * at the far end can change which pairs exist earlier. Checked rather than
   * reasoned: `'a'.repeat(80)` sliced to 64 characters gives different leading
   * pieces, and so does a repeated Greek string. Slicing would have changed the
   * ids the model is fed, quietly, in exactly the cases nobody tests.
   *
   * So the loop changes and the output does not. A doubly linked list over the
   * symbols, and a heap of candidate pairs ordered by rank and then by original
   * position, which is the same tie break as "leftmost of the lowest rank" that
   * the scan gave. Merged nodes are left in place and marked dead, and stale
   * heap entries are discarded when they surface. O(n log n).
   *
   * `check:tokenizer` holds the output to the Python tokenizer's, and
   * `check:input` holds the time.
   */
  encodeWord(word: string): number[] {
    const key = lower(word)
    const hit = this.cache.get(key)
    if (hit) {
      // Refresh: this is the cheapest possible LRU, and the cache is bounded
      // below, so an unbounded paste session cannot grow it without limit.
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }

    const chars = [...key]
    const n = chars.length
    if (n === 0) {
      this.remember(key, [])
      return []
    }

    const sym = new Array<string>(n)
    sym[0] = chars[0]
    for (let i = 1; i < n; i++) sym[i] = `##${chars[i]}`

    const prev = new Int32Array(n)
    const next = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      prev[i] = i - 1
      next[i] = i + 1 < n ? i + 1 : -1
    }

    // A binary min heap of (rank, left) pairs. `left` breaks ties, and because
    // node indices are original positions and never move, ordering by it is
    // ordering by position, which is what the scan did.
    let poppedRank = 0
    const heapRank: number[] = []
    const heapLeft: number[] = []
    const less = (a: number, b: number) =>
      heapRank[a] !== heapRank[b] ? heapRank[a] < heapRank[b] : heapLeft[a] < heapLeft[b]
    const swap = (a: number, b: number) => {
      const r = heapRank[a], l = heapLeft[a]
      heapRank[a] = heapRank[b]; heapLeft[a] = heapLeft[b]
      heapRank[b] = r; heapLeft[b] = l
    }
    const push = (rank: number, left: number) => {
      heapRank.push(rank)
      heapLeft.push(left)
      let i = heapRank.length - 1
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (!less(i, parent)) break
        swap(i, parent)
        i = parent
      }
    }
    const pop = (): number => {
      const left = heapLeft[0]
      poppedRank = heapRank[0]
      const last = heapRank.length - 1
      heapRank[0] = heapRank[last]; heapLeft[0] = heapLeft[last]
      heapRank.pop(); heapLeft.pop()
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let small = i
        if (l < heapRank.length && less(l, small)) small = l
        if (r < heapRank.length && less(r, small)) small = r
        if (small === i) break
        swap(i, small)
        i = small
      }
      return left
    }

    const offer = (left: number) => {
      const right = next[left]
      if (right < 0) return
      const rank = this.merges.get(`${sym[left]}\u0000${sym[right]}`)
      if (rank !== undefined) push(rank, left)
    }

    for (let i = 0; i < n; i++) offer(i)

    const dead = new Uint8Array(n)
    while (heapRank.length > 0) {
      const left = pop()
      if (dead[left]) continue
      const right = next[left]
      if (right < 0 || dead[right]) continue
      // The pair may have been superseded since it was pushed. Comparing the
      // rank, not merely checking that a rank exists, is what makes this
      // equivalent to the scan: an entry whose symbols have changed carries an
      // out of date priority, and acting on it fires a merge earlier than the
      // scan would have. The first version of this checked only for existence
      // and disagreed with Python on 48 of 242 sentences.
      //
      // Skipping is safe because every change to a symbol is followed by an
      // offer() for each pair it touches, so a fresh entry with the right rank
      // is already in the heap.
      const rank = this.merges.get(`${sym[left]}\u0000${sym[right]}`)
      if (rank === undefined || rank !== poppedRank) continue

      const b = sym[right]
      sym[left] = b.startsWith('##') ? sym[left] + b.slice(2) : sym[left] + b
      dead[right] = 1
      const after = next[right]
      next[left] = after
      if (after >= 0) prev[after] = left

      offer(left)
      if (prev[left] >= 0) offer(prev[left])
    }

    const out: number[] = []
    for (let i = 0; i >= 0; i = next[i]) out.push(this.vocab.get(sym[i]) ?? this.unk)

    this.remember(key, out)
    return out
  }

  /**
   * The cache had no bound. Five 800 KB pastes took the heap from 17.2 MB to
   * 62.9 MB and it did not come back down, and this page invites exactly that
   * session. Oldest out, which with the refresh on hit above is an LRU.
   */
  private remember(key: string, value: number[]): void {
    this.cache.set(key, value)
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next()
      if (!oldest.done) this.cache.delete(oldest.value)
    }
  }

  encode(words: string[], maxLen = 64): Encoded {
    const ids = [this.cls]
    const cases: number[] = [0]
    const wordIndex: number[] = [-1]

    for (const [wi, w] of words.entries()) {
      // The inner loop stopped at maxLen and the outer one did not, so every
      // word past the cap was tokenised in full and thrown away. On a 32,000
      // character paste that is the whole cost of the page freezing, paid for
      // output nobody ever sees.
      if (ids.length >= maxLen) break
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
