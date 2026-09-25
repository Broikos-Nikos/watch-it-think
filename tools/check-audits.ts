/**
 * The audit list adds up, and the README's claim about it is true.
 *
 *   npm run check:audits
 *
 * WE-F8, and WAUD-F1, which is the same defect filed twice: once by the hiring
 * engineer on 2026-09-21, once by this project against itself when the class was
 * swept at tick 148. Commit messages here cite identifiers like `WH-F2`, and
 * there was nothing in the repository that turned one into a sentence.
 *
 * Measured at tick 164, before the file existed:
 *
 *   commits                     46
 *   distinct ids cited in them  51, of which 49 are this project's
 *   resolving nowhere in it     39
 *   findings in the queue      189, across 17 audit passes
 *   docs/ in the repository     PUBLISH.md, capture.json, think.gif,
 *                               think.webm, upstream.json
 *
 * So four fifths of the identifiers in the log pointed at a document only the
 * author could read. The audit said "four audits and thirty open findings",
 * which was true when it was written and is now seventeen and a hundred and
 * four: the number grew every time a pass ran, and nothing in the repository
 * moved with it.
 *
 * ## What is checked here
 *
 * Only what this repository can see by itself, because this runs in CI:
 *
 *   every section's stated count is the count of the rows beneath it
 *   the header total is the sum of the sections
 *   every id appears once
 *   every status is one of the three this project uses
 *   the README's claim about how many perspectives audited this project
 *     matches the number of perspective sections here
 *
 * Whether a row agrees with the workspace queue is checked one level up, by
 * `tools/check-audit-status.mjs`, which is the only place both files exist. A
 * row can be internally consistent here and still be a lie about the queue, and
 * that is the failure this gate cannot see: it is why the control for this tick
 * had to be a document that passes this gate and fails that one.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * Absent is the state this gate was written for, so it is the one failure that
 * has to read as a sentence rather than as a stack trace.
 */
const read = (rel: string): string => {
  try {
    return readFileSync(resolve(root, rel), 'utf8')
  } catch {
    console.error(`FAIL  ${rel} is not in this repository`)
    console.error('      46 commits cite 51 finding identifiers. Without this file, 39 of them resolve to nothing a reader can reach.')
    process.exit(1)
  }
}

const doc = read('docs/AUDITS.md')
const readme = read('README.md')

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const CLOSED = (status: string) => status.startsWith('fixed') || status.startsWith('not reproduced')
const STATUS_OK = (status: string) => CLOSED(status) || status === 'open'

interface Section {
  key: string
  line: number
  stated?: { findings: number; closed: number; line: number }
  rows: { id: string; severity: string; status: string }[]
}

const sections: Section[] = []
const lines = doc.split('\n')
let current: Section | null = null

for (const [i, line] of lines.entries()) {
  const head = /^## `([A-Za-z0-9]+)`/.exec(line)
  if (head) {
    current = { key: head[1]!, line: i + 1, rows: [] }
    sections.push(current)
    continue
  }
  const count = /^(\d+) findings?, (\d+) closed\.$/.exec(line.trim())
  if (count && current) {
    current.stated = { findings: Number(count[1]), closed: Number(count[2]), line: i + 1 }
    continue
  }
  const row = /^\| `([A-Za-z0-9-]+)` \| (\w+) \| ([^|]+)\|/.exec(line)
  if (row && current) {
    current.rows.push({ id: row[1]!, severity: row[2]!, status: row[3]!.trim() })
  }
}

if (sections.length === 0) {
  fail('docs/AUDITS.md has no sections, so either the file or this gate has stopped being about the same document')
  process.exit(1)
}

let total = 0
let closedTotal = 0
const seen = new Map<string, string>()

for (const section of sections) {
  const closed = section.rows.filter((r) => CLOSED(r.status)).length
  total += section.rows.length
  closedTotal += closed

  if (!section.stated) {
    fail(`section \`${section.key}\` at line ${section.line} states no count`, 'Every section carries one, and it is the line this gate exists to hold.')
  } else if (section.stated.findings !== section.rows.length || section.stated.closed !== closed) {
    fail(
      `docs/AUDITS.md:${section.stated.line} says ${section.stated.findings} findings, ${section.stated.closed} closed, and \`${section.key}\` has ${section.rows.length} rows with ${closed} closed`,
      'A number that is the sum of the table directly beneath it is worth nothing unless something adds the table up.',
    )
  }

  for (const row of section.rows) {
    if (!STATUS_OK(row.status)) {
      fail(`\`${row.id}\` has status ${JSON.stringify(row.status)}`, 'open, fixed, or not reproduced, and the closed two carry the tick that did it.')
    }
    const already = seen.get(row.id)
    if (already) fail(`\`${row.id}\` appears twice, in \`${already}\` and in \`${section.key}\``)
    seen.set(row.id, section.key)
  }
}

const header = /\*\*(\d+) findings, (\d+) closed, (\d+) open\*\*, across the (\d+) perspectives/.exec(doc)
if (!header) {
  fail('the header line no longer states the totals in the form this gate reads', 'It is the first number a reader meets, and it is the sum of everything below it.')
} else {
  const [, findings, closed, open, perspectives] = header.map(String) as string[]
  if (Number(findings) !== total || Number(closed) !== closedTotal || Number(open) !== total - closedTotal) {
    fail(
      `the header says ${findings} findings, ${closed} closed, ${open} open, and the tables hold ${total}, ${closedTotal} and ${total - closedTotal}`,
    )
  }
  /*
   * `self` is this project's own class sweeps rather than an audit pass: twelve
   * prefixes of findings this repository raised against itself while a class
   * found somewhere else in the workspace was being swept. It has a table
   * because commit messages cite it, and it is not one of the perspectives the
   * header counts, because nobody independent produced it.
   */
  const passes = sections.filter((s) => s.key !== 'self').length
  if (Number(perspectives) !== passes) {
    fail(`the header claims ${perspectives} perspectives and the file carries ${passes} of them`)
  }

  const claim = /\*\*(\w+) independent agents have audited this project\*\*/.exec(readme)
  if (!claim) {
    fail('README.md no longer claims a number of audits in the form this gate reads', 'The claim and the file that backs it have to move together.')
  } else {
    const WORDS: Record<string, number> = {
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
      fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    }
    const claimed = WORDS[claim[1]!.toLowerCase()]
    if (claimed === undefined) {
      fail(`README.md says ${JSON.stringify(claim[1])} agents, which this gate cannot turn into a number`)
    } else if (claimed !== passes) {
      fail(
        `README.md says ${claim[1]} agents audited this project, and docs/AUDITS.md carries ${passes} perspectives`,
        'The claim on the page a reader meets first and the list that backs it are the two halves of the same sentence, and the list is the half nobody notices going stale.',
      )
    }
  }
}

if (failed > 0) {
  console.error('\nThe list of what is still wrong is the one document a reader has no way to check.')
  process.exit(1)
}

console.log(
  `  ok      docs/AUDITS.md: ${total} findings in ${sections.length} tables, ${closedTotal} closed, every stated count the sum of its own rows`,
)
console.log('audits: the audit list adds up, and the README agrees with it about how many passes there were')
