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
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
