# Publishing this

Everything here is written out before the push rather than after it, which is
the whole of WR-F1: the recruiter audit found `tokenlab` with an empty About box
and said a repository with no description is one word on a profile listing, and
the listing is what gets read first.

## 1. The repository

Create it as `watch-it-think`, public, and push `main`.

**Description**, paste exactly:

```
A transformer I trained from nothing, running entirely in your browser. Type a sentence in Greek or English and watch it decide what you meant, with every attention head on the page.
```

It deliberately contains no numbers. A description lives on GitHub where
`npm run build` cannot reach it, so a figure in it would go stale without
anything failing. The parameter count belongs on the page, where `check:claims`
holds it against `meta.json`.

**Topics**, paste as a list:

```
transformer  onnx  onnxruntime-web  attention-visualization  in-browser-ml  machine-learning  typescript  nlp  greek  intent-classification
```

## 2. Pages

`.github/workflows/pages.yml` is in the repository. It builds on every push to
`main` and publishes `dist/`. It needs one setting turned on once:

- Settings, Pages, Build and deployment, Source: **GitHub Actions**.

Nineteen gates run before anything deploys: nine in `npm run build` and ten in
`npm run verify`, in a job that holds no deployment permission. A push that
breaks a number in the README, or that leaves the recording showing a headline
the page no longer has, does not publish.

## 3. The line that matters most

The whole pitch is "open it and watch it happen", and until there is a URL there
is nowhere to click. That is WE-F3, and it is the reason `tokenlab` beat this
project in two consecutive recruiter audits on a comparison that had nothing to
do with either README.

Once Pages is live, the first line under the title in `README.md`, above the
opening paragraph:

```markdown
**[Open it](https://broikos-nikos.github.io/watch-it-think/)** and type a sentence into it.
```

and the same URL set as the repository Website, so it shows in the About box.

## 4. The training repository

`github.com/Broikos-Nikos/bslm` holds the model this page runs. It is linked
from the opening section of the README, under the recording, per D13.

Two files in it are still untracked and the owner has not decided whether they
should be: `bslm.pt`, the weights, and `data/test.jsonl`, the held out set. The
page here ships the quantised int8 export rather than either of them, so nothing
in this repository depends on that decision.
