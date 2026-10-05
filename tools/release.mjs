/**
 * The publish step the authorship gate has always referred to.
 *
 *   npm run release
 *
 * WM2-F10, the maintainer pass: `check-authorship.mjs` says "the branch half is
 * strict only when this is a release: RELEASE=1, set by the publish step", and
 * the audit grepped the repository, the workspace and `.claude/` and found
 * nothing that sets it. There was no publish step. The string existed in two
 * places, both inside the file that reads it.
 *
 * A switch that is armed by a string living only in the source of the thing it
 * arms is a switch nobody will find. This is that step, and it is three lines of
 * what it says: the full build and the full browser pass, with `RELEASE=1` in
 * the environment, so the branch is held to the same standard as the authorship.
 *
 * Not `cross-env`: this project removed 40 packages at WDEP-F1 for one `await`,
 * and spawning with an environment is what `cross-env` does.
 */

import { spawnSync } from 'node:child_process'

const steps = [
  ['npm', ['run', 'build']],
  ['npm', ['run', 'verify']],
]

for (const [cmd, args] of steps) {
  console.log(`\n$ RELEASE=1 ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, RELEASE: '1' },
  })
  if (r.status !== 0) {
    console.error(`\nrelease stopped: ${cmd} ${args.join(' ')} exited ${r.status}`)
    process.exit(r.status ?? 1)
  }
}

console.log('\nrelease: every gate, with the branch held to the same standard as the authorship')
