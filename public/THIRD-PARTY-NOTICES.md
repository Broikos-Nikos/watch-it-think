# Third party notices

This page ships other people's code. Every licence below requires its notice to
travel with the thing it covers, and a static site has nowhere to put a notice
except a file it serves, so this file is served at
`/THIRD-PARTY-NOTICES.md` alongside the page.

The supply chain audit of 2026-09-22 grepped all three shipped artefacts, the
bundle, the runtime's loader and the 14.2 MB wasm binary, for Microsoft's
copyright and found zero hits in all three. The runtime is a third of a
gigabyte of somebody else's work and its notice was not travelling with it.

## onnxruntime-web 1.30.0, and what it brings

The inference runtime. MIT.

```
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the MIT License.
```

Full text: https://github.com/microsoft/onnxruntime/blob/main/LICENSE

It pulls in, all of them reaching the built page:

| package | licence |
|---|---|
| `onnxruntime-common` | MIT, Microsoft Corporation |
| `flatbuffers` | Apache 2.0, Google Inc. |
| `long` | Apache 2.0, Long.js authors |
| `protobufjs` and its nine `@protobufjs/*` modules | BSD 3 Clause, Daniel Wirtz |
| `guid-typescript` | ISC |
| `platform` | MIT, Benjamin Tan and John David Dalton |

Apache 2.0 full text: https://www.apache.org/licenses/LICENSE-2.0
BSD 3 Clause and ISC and MIT are reproduced in each package's own repository.

## Fonts

Both are subset and self hosted from `public/fonts/`, and both carry their own
copyright and licence records inside the binary.

| font | licence | file |
|---|---|---|
| Manrope | SIL Open Font License 1.1 | `fonts/Manrope-OFL.txt` |
| Roboto Mono | Apache License 2.0 | `fonts/RobotoMono-LICENSE.txt` |

The two are under different licences and the difference is not cosmetic: Roboto
Mono as distributed by Google Fonts is Apache 2.0, not OFL, and getting that
backwards is a real finding this workspace has already had once.

## The model

The weights are not in this repository and are not covered by anything here.
They were trained by the author from random initialisation on a corpus the
`bslm` repository generates.

## This project

MIT, Nikos Broikos. See `LICENSE`.
