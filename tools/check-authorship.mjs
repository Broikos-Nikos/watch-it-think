/**
 * One name on this repository, and no co-authors.
 *
 *   npm run check:authorship
 *
 * This is a portfolio repository. The history is part of what is being shown,
 * and a reader who scrolls it is reading a claim about who did the work.
 *
 * It has gone wrong twice, the same way both times, and neither time was caught
 * by anything except a person reading the log. `tokenlab` reached twenty three
 * commits with a co-author trailer on every one of them and was rewritten on
 * the morning it was published. This repository reached fifteen with trailers
 * on thirteen and three different spellings of one name, and the hiring
 * engineer audit found it by running `git log` in the first minute.
 *
 * A rewrite is cheap before a push and impossible after one, so the check
 * belongs in the build rather than in a memory.
 *
 * It reads the whole history, not the last commit, because the failure mode is
 * a trailer that has been there for twenty commits and nobody looked.
 */

import { execFileSync } from 'node:child_process'

const NAME = 'Nikos Broikos'
const EMAIL = 'broikos.nikolaos@gmail.com'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

let failed = 0

// ---- one author, one spelling ---------------------------------------------
const authors = new Map()
for (const line of git('log', '--format=%an <%ae>').trim().split('\n')) {
  authors.set(line, (authors.get(line) ?? 0) + 1)
}

const expected = `${NAME} <${EMAIL}>`
for (const [who, n] of authors) {
  if (who !== expected) {
    failed++
    console.error(`FAIL  ${n} commit${n === 1 ? '' : 's'} authored by ${who}`)
    console.error(`      every commit here must be ${expected}`)
  }
}
if (authors.size === 1 && authors.has(expected)) {
  console.log(`  ok      ${authors.get(expected)} commits, one author, one spelling`)
}

// ---- no co-author trailers anywhere ---------------------------------------
// %B rather than %b, because a trailer can end up in a subject line when a
// message is written badly, and the point is that the string is absent.
const bodies = git('log', '--format=%H%x00%B%x00%x00').split('\u0000\u0000')
const credited = []
for (const entry of bodies) {
  if (!entry.trim()) continue
  const [sha, body = ''] = entry.split('\u0000')
  if (/co-authored-by:/i.test(body)) credited.push(sha.trim().slice(0, 7))
}

if (credited.length > 0) {
  failed++
  console.error(`FAIL  ${credited.length} commits carry a Co-Authored-By trailer`)
  console.error(`      ${credited.slice(0, 8).join(' ')}${credited.length > 8 ? ' ...' : ''}`)
} else {
  console.log('  ok      no co-author trailers in the history')
}

// ---- the branch a cloner lands on -----------------------------------------
//
// The default branch was `daily` for eighty minutes, which is the name of a
// schedule rather than of a codebase, and `master` was two commits behind it.
//
// But `daily` being ahead of `main` is the normal state between the hourly
// ticks and the once a day squash, so failing on it would fail on every
// ordinary run, and a gate that fails on the normal state is one everybody
// learns to skip. The first version of this file did exactly that and broke
// the build on the commit that introduced it.
//
// So the branch half is strict only when this is a release: RELEASE=1, set by
// the publish step. The rest of the time it reports and moves on, because the
// facts are worth printing and are not yet wrong.
const release = process.env.RELEASE === '1'
const head = git('symbolic-ref', '--short', 'HEAD').trim()

// Remote refs count. A fresh clone checks out one branch and leaves the rest as
// `remotes/origin/*`, so asking for a local `main` fails on every clone that is
// not the working directory this was written in. That is the same defect as the
// palette gate reading a file from outside the repository, in a second gate,
// and it turned up the same way: by cloning the thing and running it.
const branches = git('branch', '-a', '--format=%(refname:short)')
  .trim()
  .split('\n')
  .map((b) => b.trim().replace(/^remotes\/[^/]+\//, ''))

if (!branches.includes('main')) {
  if (release) {
    failed++
    console.error("FAIL  there is no 'main' branch, local or remote")
  } else {
    console.log("  note    no 'main' branch here, which is normal in a single branch clone")
  }
} else {
  let ahead = '0'
  try {
    ahead = branches.includes('daily') ? git('rev-list', '--count', 'main..daily').trim() : '0'
  } catch {
    ahead = '0'
  }

  const wrong = head !== 'main' || ahead !== '0'
  if (wrong && release) {
    failed++
    console.error(
      `FAIL  releasing from '${head}' with 'daily' ${ahead} commits ahead of 'main'. ` +
        `A clone must land on main with nothing left behind it.`,
    )
  } else if (wrong) {
    console.log(`  note    on '${head}', daily ${ahead} ahead of main. Squash before release.`)
  } else {
    console.log("  ok      HEAD is on 'main' and nothing is left on daily")
  }
}

if (failed > 0) {
  console.error(`\n${failed} authorship problems. The history is part of what is being shown.`)
  process.exit(1)
}

// Do not claim the branch is right when the note above just said it is not.
console.log(
  release
    ? 'authorship: one name, no co-authors, and main is what a clone gets'
    : 'authorship: one name, no co-authors. Run with RELEASE=1 to hold the branch to the same standard',
)
