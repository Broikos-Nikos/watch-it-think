# The audits

Commit messages cite identifiers like `WDR-F1`. This is what they refer to.

Seventeen audit passes and the workspace sweeps. Each pass was run against
one assigned perspective and nothing else.

**198 findings, 132 closed, 66 open**, across the 17 perspectives that produced them.

Held to the workspace queue this project is built from by
`tools/check-audit-status.mjs`, which fails if a row here says anything the
queue does not.

## `WDR`, deep reviewer

15 findings, 10 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WDR-F1` | high | fixed, tick 29 | tools/export_onnx.py does not parse, so the export in this repository cannot be run at all. A heredoc reintroduced an unterminated string at tick 20 and the output was filtered |
| `WDR-F2` | high | fixed, tick 30 | The attention tensor, the only reason the export file exists, is the one output no gate compares. Reversing the layers or rolling the head axis passes every gate |
| `WDR-F3` | high | fixed, tick 31 | The tokenizer port disagrees with bslm/tokenizer.py on five whitespace code points including the byte order mark, while the gate prints identical because none of its 230 sentences contains one |
| `WDR-F4` | medium | fixed, tick 157 | concentration() computes a different quantity from the one its docstring describes |
| `WDR-F5` | medium | fixed, tick 158 | The page says the intent is read from the first position; it is read from the first position plus the mean of every position |
| `WDR-F6` | medium | fixed, tick 159 | 5.28 MB over the wire describes one of the seven files the page downloads |
| `WDR-F7` | medium | fixed, tick 160 | A word past the token cap is dropped from the tag row and from the evaluation, silently and in the evaluation favour |
| `WDR-F8` | medium | not reproduced, tick 161 | One long word freezes the page for seconds and every millisecond of it is thrown away |
| `WDR-F9` | medium | fixed, tick 162 | dump_python_tokenizer.py still states the exact falsehood the port was fixed for |
| `WDR-F10` | medium | fixed, tick 163 | The accuracy budget is spent on intent accuracy, and the attention the page draws is never measured at all |
| `WDR-F11` | low | open | The gate never exercises padding, a batch above one, a single token, or a sentence at the cap |
| `WDR-F12` | low | open | positions comes from the tokenizer, not from the tensor, and the two are never checked against each other |
| `WDR-F13` | low | open | focusToken survives into a shorter sentence and blanks the field |
| `WDR-F14` | low | open | concentration returns 1 for a single token, so every head reads 100 percent |
| `WDR-F15` | low | open | User text reaches innerHTML, safe only because of an invariant nothing states |

## `WM`, measurement

15 findings, 13 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WM-F1` | high | fixed, tick 33 | The attention witness runs on four English sentences, 6 to 14 tokens, and three places say it runs on more. meta.json's sentences: 20 is the sample for gates 1 to 3 only |
| `WM-F2` | high | fixed, tick 34 | Not one published number can be reproduced by someone who has only the clone: the checkpoint and test set are named nowhere and hashed nowhere |
| `WM-F3` | high | fixed, tick 35 | Five latency numbers, none reproduces, and meta.json's was measured on native onnxruntime while the page runs wasm at a few times that |
| `WM-F4` | high | fixed, tick 37 | The devlog says both accuracy figures are in meta.json so neither can be quoted alone. meta.json contains neither the 72.00 abstain figure nor the threshold |
| `WM-F5` | medium | fixed, tick 33 | meta.json ships one tolerance over four parity numbers; three were applied, and attentionRowSumDeviation cannot fail because it measures a softmax summing to 1 |
| `WM-F6` | medium | fixed, tick 170 | 97.28 percent tag accuracy is reported with no baseline, and always predicting O scores 74.98 percent on the same tags |
| `WM-F7` | medium | fixed, tick 34 | The page tells the visitor the held out set is the adversarial one, and the pipeline records nothing about which file was evaluated |
| `WM-F8` | medium | fixed, tick 171 | meta.json's source string is a hardcoded literal repeated in four places, and its config reports dropout 0.1 for a graph exported with dropout zero |
| `WM-F9` | medium | fixed, tick 172 | Each of the 24 thumbnails is normalised to its own peak, so the small multiples the page exists for are not comparable. Measured spread 0.267 to 0.999 |
| `WM-F10` | medium | fixed, tick 34 | quantize.py's docstring states 10,578 as a property of the tool, and rowsRead and rowsEvaluated are both called the held out set |
| `WM-F11` | medium | fixed, tick 34 | tokenizer.ts names check-tokenizer.py, which does not exist, and the gate compares against an unversioned fixture rather than running both |
| `WM-F12` | medium | fixed, tick 37 | Devlog proof blocks are typed reconstructions: one drops the n= that states the sample size, one is off by 1,077 bytes, and the 800 row cross check has no script |
| `WM-F13` | low | open | ship_int8 compares a difference of two already rounded percentages against the budget |
| `WM-F14` | low | fixed, tick 35 | The page's live latency is one unwarmed sample printed to a tenth of a millisecond, and N tokens counts the cls vector |
| `WM-F15` | low | open | Two pointers to things that do not exist: npm run capture, and a README this repository does not have |

## `WH`, hostile stranger

16 findings, 13 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WH-F1` | high | fixed, tick 38 | A paste with no spaces in it freezes the tab for 21.6 seconds while the page keeps showing a confident answer to the previous sentence. Quadratic merge loop, no clamp, no thinking state |
| `WH-F2` | high | fixed, tick 42 | boot() ends with el.input.value = SAMPLES[0] unconditionally, so everything the visitor types during the 61 second download is overwritten and answered as a different sentence |
| `WH-F3` | high | fixed, tick 39 | One long word tears the layout open: scrollWidth 631 inside a 390 pixel phone, 285,214 on desktop. No overflow-wrap on .word or .axis-token |
| `WH-F4` | medium | fixed, tick 166 | 19.8 MB arrives before anything works and the page shows no progress, no byte count, no aria-busy, and chips that look live and do nothing |
| `WH-F5` | medium | fixed, tick 103 | On a load failure the standfirst and footer stay empty and the box and chips stay interactive and inert, so the failure state is the one state that never says what the page is |
| `WH-F6` | medium | fixed, tick 111 | No noscript block anywhere: with scripts off the page says loading the model for ever, and on the dev server it is unstyled because the CSS is imported from main.ts |
| `WH-F7` | medium | fixed, tick 103 | main.ts calls String.prototype.trim, which strips U+FEFF, so the leading byte order mark that tokenizer.ts spends twenty lines saying it handles never reaches the tokenizer. Measured 2 positions where Python gives 3 |
| `WH-F8` | medium | fixed, tick 103 | Input of only U+0085 or U+001C to U+001F survives the empty check, normalises to nothing, and produces a full confident answer: smalltalk.greet 36.4 percent over a wall of uniform green |
| `WH-F9` | medium | fixed, tick 103 | Every invisible code point gets its own visible chip, and a zero width space can be handed a slot tag, so the tag row shows the model assigning B-TOPIC to nothing |
| `WH-F10` | medium | fixed, tick 168 | Emoji are pulled apart into code points: the Greek flag draws as G and R, a skin toned thumb as a thumb plus a colour swatch, and all of them are unk |
| `WH-F11` | medium | fixed, tick 169 | The axis stops labelling anything when a word is long: 59 of 64 chips read '..' on a pasted hash, and the axis is the only label the large field has |
| `WH-F12` | medium | fixed, tick 50 | On a phone the token highlight cannot be used at all: pointerenter only, no click, no tabindex, no hover:none media query |
| `WH-F13` | low | open | The thumbnail canvas is fixed at 44x44 for a field that can be 64x64, so past about forty tokens roughly twenty rows and columns are never drawn |
| `WH-F14` | low | open | '1 positions' and '61452 ms to load': no pluralisation, and the load time printed as raw milliseconds |
| `WH-F15` | low | fixed, tick 38 | The word cache is an unbounded Map with no eviction: five 800 KB pastes took the heap from 17.2 to 62.9 MB and it did not come back |
| `WH-F16` | low | open | Every visit logs a favicon 404 before the visitor has done anything |

## `WP`, performance access

15 findings, 13 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WP-F1` | high | fixed, tick 51 | 12 of the 19.8 MB are one response header away from not being sent, and nothing in the repository sets it |
| `WP-F2` | high | fixed, tick 43 | Every attention field is painted one fillRect per cell with a freshly built oklch() string: 144 ms where 1.1 ms draws the same picture |
| `WP-F4` | high | fixed, tick 47 | The live region announces the telemetry on every keystroke and never announces the answer |
| `WP-F5` | high | fixed, tick 50 | The token highlight has no keyboard path at all |
| `WP-F3` | medium | fixed, tick 173 | Choosing a head still rebuilds every button and the whole axis for a change that altered no data. The 350 ms it cost is gone with WP-F2, measured at 2.3 ms median, so this is waste rather than a delay |
| `WP-F6` | medium | fixed, tick 174 | Sweeping the pointer across the axis redraws the 520 pixel field synchronously per token: 47 fps desktop, 11 fps mid range |
| `WP-F7` | medium | fixed, tick 50 | A tablist that controls nothing, 24 tab stops, dead arrow keys, and a focus ring identical to the selection |
| `WP-F8` | medium | fixed, tick 47 | 25 canvases are the entire point of the page and carry no key, no values and no text alternative |
| `WP-F9` | medium | fixed, tick 175 | Under forced colours the heat map inverts: the weakest cells become the brightest thing on screen |
| `WP-F10` | medium | fixed, tick 176 | Every interactive boundary on the page is at 1.48:1, where the rule is 3:1 |
| `WP-F11` | medium | fixed, tick 177 | Three of the six sample buttons are Greek inside lang=en |
| `WP-F12` | low | fixed, tick 47 | The answer has no heading, no label, and its tag codes are unexplained jargon |
| `WP-F13` | low | fixed, tick 173 | peak runs three times and concentration once over a field that has not changed, on every hover |
| `WP-F14` | low | open | list-style: none strips the list semantics of the race and the axis in Safari |
| `WP-F15` | low | open | Nothing says how long any of the 19.8 MB may be cached, and the model files are not content hashed |

## `WE`, hiring engineer

13 findings, 12 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WE-F1` | high | fixed, tick 46 | There is no README, so the first screen of this repository is eight filenames |
| `WE-F2` | high | fixed, tick 46 | Nothing says how to run it, and the two commands an engineer types first, npm start and npm test, both error |
| `WE-F3` | high | fixed, tick 103 | There is nowhere to click |
| `WE-F4` | high | fixed, tick 46 | The proof the author trained the model is a public repository with its own README and audit, linked only from inside a 10 KB JSON blob |
| `WE-F5` | high | fixed, tick 45 | Thirteen of fifteen commits credit an LLM as co-author, against none of tokenlab's twenty eight. Directly against the owner's standing instruction that the only author is Nikos Broikos |
| `WE-F6` | high | fixed, tick 45 | The default branch is daily, and master is missing the two commits that closed the last two high findings |
| `WE-F7` | medium | fixed, tick 46 | The honest limits are real, unusually good, and every one of them is somewhere a three minute reader will never go |
| `WE-F8` | medium | fixed, tick 164 | Four audits and thirty open findings exist, commit messages cite their identifiers, and none of it is in the repository |
| `WE-F9` | medium | fixed, tick 59 | No licence, on a repository whose two most borrowable pieces are a tokenizer port and an attention witness |
| `WE-F10` | medium | fixed, tick 165 | npm run build on a machine that has never run Playwright dies in an uncaught stack trace with no warning |
| `WE-F11` | medium | fixed, tick 45 | Fifteen commits, three different author names |
| `WE-F12` | low | open | No publish document, so the About box, the topics and the homepage field are unwritten three days out |
| `WE-F13` | low | fixed, tick 46 | The numbers on the page are not hand typed, the one thing a reader could verify in three minutes, and nothing tells them to try |

## `WS`, supply chain

12 findings, 5 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WS-F1` | high | fixed, tick 49 | allowScripts in package.json is a security control that nothing reads: @lavamoat/allow-scripts is not a dependency, so protobufjs: false blocks nothing |
| `WS-F2` | medium | fixed, tick 189 | 'Nothing leaves this page' is the one claim in the repository with no gate, and nothing enforces it at runtime |
| `WS-F3` | medium | open | The one file every visitor downloads and executes is the one file with no hash |
| `WS-F4` | medium | open | numpy is the only unpinned dependency in the pipeline, and it is the one that produces the repository's strongest number |
| `WS-F5` | medium | fixed, tick 199 | .capture/ is not ignored, and npm run capture leaves a full screen recording in it on any failure |
| `WS-F6` | medium | open | ffmpeg is an undeclared, unpinned binary taken off PATH, and it makes the repository's front door |
| `WS-F7` | medium | fixed, tick 202 | meta.json is fetched at runtime and 109 of its strings reach innerHTML, while the gate reading that file checks only its numbers |
| `WS-F8` | medium | open | There is no CI, so nothing has ever installed this project from its own lockfile |
| `WS-F9` | medium | fixed, tick 59 | The licence is one sentence of prose, the machine readable metadata says the opposite, and the MIT runtime ships with no notice |
| `WS-F10` | low | open | wait-on costs 39 packages, including all of lodash, joi, axios and rxjs, to poll one localhost URL |
| `WS-F11` | low | open | @types/node is the only floating version in a package.json where everything else is pinned to the patch |
| `WS-F12` | low | open | onnxruntime-web installs 139 MB to ship 14 MB, and the honest limits tell the visitor about the download and not the reader about the clone |

## `WD`, design eye

18 findings, 15 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WD-F1` | high | fixed, tick 53 | The one transition on the page is declared, and it has never run |
| `WD-F2` | high | fixed, tick 53 | The leader changes eight times while you type, and the page renders every change as a blink |
| `WD-F3` | high | fixed, tick 54 | The quantitative encoding and the brand accent are the same green, and the hottest cell of the heat map is louder than the answer |
| `WD-F4` | high | fixed, tick 54 | The house style has not reached this project, and the page is its opposite on every axis that matters |
| `WD-F5` | medium | fixed, tick 196 | The winner's percentage is cut in two by the bar behind it |
| `WD-F6` | medium | fixed, tick 198 | The attention section uses half its column and leaves 448 pixels empty beside its own subject |
| `WD-F7` | medium | fixed, tick 197 | The axis is not an axis |
| `WD-F8` | medium | fixed, tick 55 | Twenty four thumbnails with no label, no order and no score, and the source already says they should have one |
| `WD-F9` | medium | fixed, tick 204 | Thirteen rendered type sizes, six of them inside a 2.08 pixel band |
| `WD-F10` | medium | fixed, tick 205 | Ten gap values, six radii, seven surface darks, and fifteen colour literals outside the token block |
| `WD-F11` | medium | fixed, tick 206 | The rhythm gives the answer the same air as a row of chips |
| `WD-F12` | medium | fixed, tick 207 | The state between loading and answered is a hole, and the answer lands by shoving the input box 74 pixels down the page |
| `WD-F13` | medium | fixed, tick 53 | The big canvas resizes as you type, so the only thing that moves is the layout |
| `WD-F14` | low | open | Three focus languages, two focus colours, and the house token reached two of five focusable things |
| `WD-F15` | low | fixed, tick 54 | The tag code is 9.4 pixels, and it is the only orange text in the answer |
| `WD-F16` | low | open | Two permanent legends, 300 pixels apart, both grey, both repeated forever |
| `WD-F17` | low | fixed, tick 54 | The header's green wash is the one piece of atmosphere on the page and it does nothing |
| `WD-F18` | low | open | At 390 the six sample chips become a 230 pixel ragged column before the visitor has done anything |

## `WR`, recruiter

12 findings, 7 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WR-F1` | high | fixed, tick 103 | The About box is empty, so the whole ten second screen has no sentence in it and nowhere to go |
| `WR-F2` | high | fixed, tick 57 | The picture at the top is a picture of a different page, under a sentence saying it is the real one |
| `WR-F3` | high | fixed, tick 58 | Nothing anywhere near the top says he built the model himself |
| `WR-F4` | medium | fixed, tick 58 | The best sentence in the README is the fourth block, and the first thing under the picture is npm install |
| `WR-F5` | medium | open | The biggest number in the document reads as a failing grade, and the only baseline given belongs to the other number |
| `WR-F6` | medium | open | Seven of the eleven rows in the file list carry the same commit message |
| `WR-F7` | medium | fixed, tick 57 | On a phone the moving picture is a 356 by 235 smear |
| `WR-F8` | medium | fixed, tick 58 | The page makes a different promise from the one that got me there |
| `WR-F12` | medium | open | The profile pins two archived batch file Caesar ciphers and neither of the two repositories worth reading |
| `WR-F9` | low | open | 'Why you can believe them' answers an accusation nobody has made yet |
| `WR-F10` | low | open | The page link has no card |
| `WR-F11` | low | fixed, tick 57 | The picture weighs 3.85 MB, and a better encoder is not the fix |

## `WM2`, maintainer

16 findings, 8 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WM2-F1` | high | fixed, tick 63 | Ten gates, ten fixed ports, and not one checks it is talking to the server it started. One was proved reporting green against a page it never looked at |
| `WM2-F2` | high | fixed, tick 61 | npm run build cannot run in a clean clone, because check:palette reads STYLEGUIDE.md, which is outside the repository |
| `WM2-F3` | high | fixed, tick 61 | The second gate in the build is the one that cannot survive being cloned |
| `WM2-F4` | high | fixed, tick 62 | check:install will fail the build on the fix npm itself recommends: npm approve-scripts writes the allowScripts block the gate rejects |
| `WM2-F5` | high | fixed, tick 63 | The README describes an eight gate build. There are nineteen, and ten of them need a browser |
| `WM2-F6` | medium | fixed, tick 63 | Eighty seven seconds and twenty npm spawns before every commit, and the sibling repository already shows the answer |
| `WM2-F7` | medium | fixed, tick 203 | Two gates spend a preview server and a Chromium on assertions that are file reads |
| `WM2-F8` | medium | open | Six stale latency numbers live in two source comments, and both point the reader at meta.json as the authority while contradicting it |
| `WM2-F9` | medium | fixed, tick 63 | The cleanup is taskkill, so on any machine that is not Windows nothing is cleaned up |
| `WM2-F10` | medium | open | RELEASE=1 is documented only inside the gate that reads it, and the publish step it names does not exist |
| `WM2-F11` | medium | open | Nine of the gates' DOM hooks are presentational class names, and eighteen design findings are about to rewrite that markup |
| `WM2-F12` | medium | open | check:draw slices a function out of the source with indexOf and evals it |
| `WM2-F13` | low | open | PYTHON and tools/requirements.txt appear nowhere in the README |
| `WM2-F14` | low | open | The model's shape is hardcoded as 24 in one gate and nowhere else |
| `WM2-F15` | low | open | Seventeen of the nineteen gates are outside the typecheck |
| `WM2-F16` | low | open | Nothing checks the sample sentences, and adding one passes all nineteen gates while making an open finding worse |

## `WD2`, deep reviewer, second pass

13 findings, 12 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WD2-F1` | high | fixed, tick 65 | Past 44 tokens the thumbnails stop drawing half of every field, and 10 of the 24 no longer contain their own strongest link |
| `WD2-F2` | high | fixed, tick 67 | A sentence typed before the page's own script has run is still replaced by the sample, and on a slow connection that window is 1,356 ms |
| `WD2-F3` | high | fixed, tick 66 | The new row's entry animation is added and removed inside one task, so it has never run |
| `WD2-F4` | medium | fixed, tick 178 | The browser's word class is two Unicode releases ahead of the Python the model was trained with, and 9,661 code points change the ids of the ordinary words beside them |
| `WD2-F5` | medium | fixed, tick 179 | 'median of 2' prints the first run's number, which is the one figure the rewrite exists to stop showing |
| `WD2-F6` | medium | fixed, tick 180 | A pinned token that outlives its sentence dims the entire field, hides itself, and switches hover off, with nothing on screen to undo it |
| `WD2-F7` | medium | fixed, tick 66 | Reduced motion stops the CSS transition and nothing else, and the gate that says it all stops when asked only reads the transition |
| `WD2-F8` | medium | fixed, tick 181 | Three gate headers describe a check the gate does not make |
| `WD2-F9` | medium | fixed, tick 182 | The non-Windows half of the server cleanup cannot work, because the child is never detached |
| `WD2-F10` | low | fixed, tick 184 | The ramp is read with a truncation, so a shipped cell is up to two units per channel from the colour the old code asked for, against the gate's own one unit bar |
| `WD2-F11` | low | fixed, tick 65 | 'each cell gets whole pixels' holds for 21 of the 64 possible token counts |
| `WD2-F12` | low | fixed, tick 66 | A row's travel is never cancelled, so up to four transform animations run on one row and the newest replaces the others mid flight |
| `WD2-F13` | low | open | The free port is proved free on 127.0.0.1 and then let go, and what actually makes the gate safe is the index.html comparison |

## `WR2`, recruiter, second pass

4 findings, 3 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WR2-F1` | high | fixed, tick 103 | The picture shows a headline the page threw away, and check:capture records eight colours and a font so it cannot see words |
| `WR2-F2` | medium | fixed, tick 103 | 760 characters and twelve lines before the picture, against the sibling's 555 and eight |
| `WR2-F3` | medium | open | 'so the claim above is one click from its evidence' is writing about the writing |
| `WR2-F4` | low | not reproduced, tick 149 | The alt text is correct, which is worth saying |

## `WDR3`, deep reviewer, third pass

3 findings, 0 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WDR3-F1` | medium | open | Nothing ties the recorded model size to the model that ships |
| `WDR3-F2` | low | open | The progress callback can report more than the total |
| `WDR3-F3` | low | open | check:claims calls a disk size "bytes over the wire" |

## `WDE2`, design eye, second pass

2 findings, 0 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WDE2-F1` | medium | open | The shared scale is right and the ramp under it is now wrong |
| `WDE2-F2` | low | open | There is a hole under the grid at desktop width |

## `WH2`, hostile stranger, second pass

4 findings, 1 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WH2-F1` | high | not reproduced, tick 150 | The progress bar survives its own failure and reports 100 percent |
| `WH2-F2` | medium | open | With javascript off the page says it is loading, and always will |
| `WH2-F3` | medium | open | The failure messages are the engine's internals, verbatim |
| `WH2-F4` | low | open | "Reloading is worth a try" and nothing to click |

## `WP2`, performance access, second pass

5 findings, 2 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WP2-F1` | high | not reproduced, tick 150 | The page states a disk size and calls it the wire |
| `WP2-F2` | high | not reproduced, tick 150 | Forty one seconds of nothing, on a normal phone connection |
| `WP2-F2b` | medium | open | The first answer is still forty one seconds on slow 4G, and only the silence was fixed |
| `WP2-F3` | medium | open | The deployed bundle cannot be reproduced on the machine that wrote it |
| `WP2-F4` | low | open | Ten minutes of cache on a five megabyte model |

## `WMA2`, maintainer, second pass

3 findings, 0 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WMA2-F1` | medium | open | The gates are two and a half times the size of the thing they gate, and nothing explains them |
| `WMA2-F2` | low | open | Eleven gates repeat the same eight lines of preamble |
| `WMA2-F3` | low | open | Every browser gate pays for its own browser |

## `WME2`, measurement, second pass

10 findings, 4 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WME2-F1` | high | not reproduced, tick 150 | The footer counts the browser cache as the wire |
| `WME2-F2` | high | not reproduced, tick 150 | Two gate counts in the README are wrong, and the gate for gate counts exempts them |
| `WME2-F3` | medium | open | check:claims cannot fail on three of its twenty four claims |
| `WME2-F4` | medium | open | check:upstream's "every percentage" misses the one that is spelled out |
| `WME2-F5` | medium | fixed, tick 200 | The recording predates the shared thumbnail scale, and check:capture cannot see a drawing change |
| `WME2-F6` | medium | open | At the 64 token cap on a 100 percent scaled screen, the thumbnails on screen are not the ones the gates measure |
| `WME2-F7` | low | fixed, tick 201 | The witness control's failure value is two different numbers, and no command produces either |
| `WME2-F8` | low | open | meta.json was edited by hand, and the tools would no longer write it |
| `WME2-F9` | low | open | The download prose has drifted, and nine correct README numbers are held by nothing |
| `WME2-F10` | low | open | Numbers and claims in gate comments and the workflow that measurement contradicts |

## `self`, swept from elsewhere (not an audit pass)

Not a perspective and not an agent. Findings raised against this project while
a class found somewhere else in the workspace was being swept across all eight,
kept here because commit messages cite them like any other.

22 findings, 14 closed.

| id | severity | status | finding |
|---|---|---|---|
| `WSELF-F1` | high | fixed, tick 104 | Four of the twenty four claims in check:claims were bare digits and could not fail: layers "6" occurs 19 times in the README, heads "4" occurs 23 times |
| `WAUD-F1` | medium | fixed, tick 164 | The commit log cites 41 finding ids and the repository publishes no list to resolve them |
| `WBUD-F1` | medium | fixed, tick 176 | The throttled sweep budget was two absolute numbers and failed the morning after it was written |
| `WCNT-F1` | medium | fixed, tick 160 | check-counts matched browser gates with a trailing comma, so it never counted the last one |
| `WCON-F1` | medium | fixed, tick 176 | Thirty six controls are bounded by a line nobody can see: the text box at 1.36:1, six buttons at 1.36, 23 table head buttons at 1.36 and six axis tokens at 1.07 |
| `WDEP-F1` | medium | fixed, tick 155 | wait-on was 40 of the 78 packages this project installed, for one await in the capture tool |
| `WEVAL-F1` | medium | open | The quantisation table compares fp32 and int8 on differences of 0 to 16 rows out of 10,578, with no paired test, no discordant counts, and one of the four metrics pointing the other way |
| `WFOLD-F1` | medium | open | The picture the page is built on is below the fold at both widths |
| `WGIF-F1` | medium | open | The picture at the top runs eight seconds, so a reader sees it once |
| `WHEAD-F1` | medium | open | A forwarded link unfurls into a bare URL: no og tags anywhere in the head |
| `WICON-F1` | medium | fixed, tick 189 | The inline favicon ended the head, so the document put markup in the body and refused a policy |
| `WNOT-F1` | medium | open | The bundle ships onnxruntime-web and its licence travels with nothing |
| `WSEAL-F1` | medium | fixed, tick 189 | The page says the work happens in your browser and nothing enforces it |
| `WVER-F1` | medium | fixed, tick 164 | A hole in the GATES array ran `npm run undefined` and counted it as a browser gate that passed |
| `WCAP-F2` | medium | open | capture.mjs hands the committed GIF to ffmpeg and closes its browser outside a finally |
| `WCNT-F2` | medium | fixed, tick 179 | The gate that holds the gate counts could not match a two word number, and then matched its tail |
| `WCAP-F1` | low | open | check:capture caps the gif at 4 MB and the gif is 3.00 MB, so the ceiling permits silent growth |
| `WGRP-F1` | low | fixed, tick 182 | check-groups read a call inside a comment as a call |
| `WNET-F1` | low | fixed, tick 189 | The README promises the model runs in your browser and nothing holds it: no gate watches the wire |
| `WRACE-F1` | low | fixed, tick 196 | The recording in the README still showed the defect the audit filed it for |
| `WRAMP-F1` | low | fixed, tick 184 | Nothing held the 256 step ramp table against the curve it was built from |
| `WTAP-F1` | low | open | Controls shorter than 24 pixels at a phone width |
