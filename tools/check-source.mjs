/**
 * No source file carries an invisible character it did not mean to.
 *
 *   npm run check:source
 *
 * On 2026-09-24 a gate in this directory contained the regex
 * `/<BS>\d{4,} ms<BS>/`, where `<BS>` is a literal backspace byte, 0x08. It was
 * meant to be `\b`, the word boundary. The escape had been written through a
 * shell heredoc and arrived as the control character it names, so the pattern
 * required an actual backspace on either side of the digits and **could never
 * match anything**. The gate looked correct in an editor, looked correct in
 * `grep`, and silently asserted nothing. It took `cat -A` to see it.
 *
 * That was the third time in one day the same shell handling corrupted an escape
 * in this repository. The other two were visible rather than dangerous: a
 * character class in `tokenizer.ts` arrived holding six real invisible
 * characters, and two test inputs carried a literal U+FEFF and U+200B where the
 * escapes were meant.
 *
 * So the rule is not "avoid heredocs", which nothing can enforce. It is that
 * **an invisible character in source is always a mistake**: if one is wanted, it
 * is written as an escape, which is readable, diffable and survives every tool
 * that touches the file.
 *
 * What counts as invisible here: the C0 controls except tab, newline and
 * carriage return, the zero width and directional marks U+200B to U+200F, and
 * the byte order mark. Not ordinary whitespace, and not anything a reader can
 * see.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\ufeff]/
const name = (c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')

const files = [
  ...globSync('src/**/*.{ts,css}', { cwd: root }),
  ...globSync('tools/**/*.{mjs,ts}', { cwd: root }),
  'index.html',
]

let failed = 0
let scanned = 0

for (const rel of files) {
  let text
  try {
    text = readFileSync(resolve(root, rel), 'utf8')
  } catch {
    continue
  }
  scanned++
  text.split('\n').forEach((line, i) => {
    if (!INVISIBLE.test(line)) return
    failed++
    const found = [...new Set([...line].filter((c) => INVISIBLE.test(c)).map(name))]
    console.error(`FAIL  ${rel}:${i + 1} carries ${found.join(', ')}`)
    console.error(`      ${JSON.stringify(line.slice(0, 90))}`)
    console.error('      write it as an escape: a character nobody can see is a character nobody can review')
  })
}

if (failed > 0) {
  console.error(`\n${failed} line${failed === 1 ? ' carries' : 's carry'} a character that cannot be seen.`)
  process.exit(1)
}

console.log(`source: ${scanned} files, no invisible characters outside their escapes`)
