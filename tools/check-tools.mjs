/**
 * Every tool in this directory can at least start.
 *
 *   npm run check:tools
 *
 * This exists because of a specific failure, and the failure was mine twice
 * over. `export_onnx.py` was patched through a heredoc that collapsed an escaped
 * newline into a real one, leaving an unterminated string. The file stopped
 * parsing. It was then run, and its output was piped through a grep for the
 * lines I expected to see, so the traceback went to a pattern that did not match
 * and the exit code was never checked. The export in this repository could not
 * be run for eight ticks and nothing said so.
 *
 * Two lessons, one gate. A tool that does not parse is a broken build. And a
 * command whose output you filter is a command whose failure you have agreed not
 * to see, so this checks exit codes and nothing else.
 *
 * `--help` is the probe rather than a bare import, because it builds the whole
 * argument parser. That is where the defect actually was: the file imported
 * fine as far as the parser, and died on a string inside an `add_argument` call.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FFMPEG_HOW, resolveFfmpeg } from './ffmpeg.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const python = process.env.PYTHON ?? 'python'

let failed = 0
let skipped = 0

const pythonTools = readdirSync(here)
  .filter((f) => f.endsWith('.py'))
  .sort()

for (const file of pythonTools) {
  const path = resolve(here, file)

  // Does it parse at all.
  try {
    execFileSync(python, ['-c', 'import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8").read())', path], {
      stdio: 'pipe',
    })
  } catch (err) {
    failed++
    console.error(`FAIL  ${file} does not parse`)
    console.error(`      ${String((/** @type {any} */ (err)).stderr ?? err).trim().split('\n').slice(-3).join('\n      ')}`)
    continue
  }

  // Does its argument parser build. This is the half that would have caught the
  // defect: it lived inside an add_argument call, past the point where a plain
  // import notices anything.
  //
  // These tools need torch, onnx and onnxruntime, which not everyone cloning
  // this repository will have, so a missing dependency is reported and skipped.
  // A syntax error is never skipped. That is the line between "you have not
  // installed the pipeline" and "the pipeline is broken".
  try {
    execFileSync(python, [path, '--help'], { stdio: 'pipe' })
    console.log(`  ok      ${file}`)
  } catch (err) {
    const e = /** @type {any} */ (err)
    const stderr = String(e.stderr ?? err)
    const missing = /ModuleNotFoundError: No module named '([^']+)'/.exec(stderr)
    if (missing) {
      skipped++
      console.log(`  skip    ${file}, needs ${missing[1]}. Set PYTHON to an interpreter that has it.`)
      continue
    }
    failed++
    console.error(`FAIL  ${file} --help exited ${e.status}`)
    console.error(`      ${stderr.trim().split('\n').slice(-3).join('\n      ')}`)
  }
}

if (pythonTools.length === 0) {
  failed++
  console.error('FAIL  no python tools found, which means this check is checking nothing')
}

/*
 * And the programs npm did not install.
 *
 * WS-F6: "ffmpeg is an undeclared, unpinned binary taken off PATH, and it
 * makes the repository's front door". The gate that exists to catch "a tool in
 * this repository that no longer starts" filtered on `.endsWith('.py')`, so
 * the one tool in this directory with an out of band binary dependency was the
 * one it did not probe. That is the shape worth naming: a gate whose selector
 * happens to exclude its own hardest case reads as coverage and is not.
 *
 * Two halves. Every bare command the `.mjs` tools shell out to is listed here
 * with what it is for, and a command that appears in a tool and not in this
 * list fails, so the next out of band dependency cannot arrive silently. Then
 * the ones that are not part of an operating system are probed.
 */
const DECLARED = new Map([
  ['ffmpeg', { probe: resolveFfmpeg, why: 'turns the recorded webm into the GIF in the README' }],
  ['npm', { probe: null, why: 'tools/serve.mjs and tools/verify.mjs start the preview through it' }],
  ['git', { probe: null, why: 'tools/check-authorship.mjs reads the commit authors' }],
  ['taskkill', { probe: null, why: 'Windows: tools/serve.mjs ends the preview and its children' }],
  ['netstat', { probe: null, why: 'Windows: tools/check-stop.mjs asks who holds the port' }],
  ['tasklist', { probe: null, why: 'Windows: tools/check-stop.mjs names the process holding it' }],
  ['lsof', { probe: null, why: 'the same question on macOS and Linux' }],
])

const SHELLS_OUT = /(?:execFileSync|execFile|spawnSync|spawn)\(\s*'([^'\\/.][^'\\/]*)'/g
const jsTools = readdirSync(here)
  .filter((f) => /\.(mjs|ts)$/.test(f))
  .sort()

const found = new Map()
for (const file of jsTools) {
  const code = readFileSync(resolve(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')
  const note = (command) => {
    const where = found.get(command) ?? new Set()
    where.add(file)
    found.set(command, where)
  }
  for (const m of code.matchAll(SHELLS_OUT)) note(m[1])

  /*
   * And a tool that goes through the resolver.
   *
   * This half was written because the first version of this gate failed on its
   * own fix. `capture.mjs` had just stopped saying `execFileSync('ffmpeg')` and
   * started saying `execFileSync(FFMPEG.path)`, so the scan for bare command
   * strings no longer saw ffmpeg anywhere and the gate reported that a declared
   * program was unused. Importing `ffmpeg.mjs` is what depending on ffmpeg
   * looks like now, so that is what is counted. This file is excluded: it
   * imports the resolver to run the probe below, not to make a GIF.
   */
  if (file !== 'check-tools.mjs' && code.includes("from './ffmpeg.mjs'")) note('ffmpeg')
}

if (found.size === 0) {
  failed++
  console.error(`FAIL  none of the ${jsTools.length} javascript tools appears to run a program, so this half is reading nothing`)
}

for (const [command, where] of [...found].sort()) {
  if (!DECLARED.has(command)) {
    failed++
    console.error(`FAIL  ${[...where].join(', ')} runs ${JSON.stringify(command)} and nothing here declares it`)
    console.error('      Add it to DECLARED with what it is for, and say so in the README if a reader has to install it.')
  }
}

for (const [command, d] of DECLARED) {
  if (!found.has(command)) {
    failed++
    console.error(`FAIL  ${JSON.stringify(command)} is declared and no tool runs it any more`)
    console.error('      A declaration nobody uses is a reader installing something for nothing.')
    continue
  }
  if (!d.probe) continue

  const got = d.probe()
  if ('error' in got) {
    failed++
    console.error(`FAIL  ${command}: ${got.error}`)
    console.error(`      ${FFMPEG_HOW}`)
    console.error(`      ${[...found.get(command)].join(', ')} ${d.why}, and it is the first thing in the README.`)
  } else {
    console.log(`  ok      ${command} ${got.version}, which ${d.why}`)
  }
}

if (failed === 0) {
  const names = [...DECLARED.keys()].sort().join(', ')
  console.log(`  ok      ${jsTools.length} javascript tools run ${DECLARED.size} programs npm did not install, all declared: ${names}`)
}

if (failed > 0) {
  console.error(`\n${failed} tools cannot start. The pipeline in this repository cannot be run.`)
  process.exit(1)
}

const probed = pythonTools.length - skipped
console.log(
  `${pythonTools.length} tools parse` +
    (probed > 0 ? `, ${probed} build their argument parser` : '') +
    (skipped > 0
      ? `, ${skipped} skipped for missing dependencies (set PYTHON to the interpreter that runs the pipeline)`
      : ''),
)
