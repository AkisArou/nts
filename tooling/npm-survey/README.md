# The npm survey

Four stages that answer one question with evidence instead of intuition:

> Of the packages a real TypeScript application depends on, how many can this
> compiler actually compile, and what stops the rest?

The findings are written up in [`docs/npm-deps.md`](../../docs/npm-deps.md).
This directory is how they were produced, and re-running it is how they get
re-derived when the ecosystem or the compiler moves.

```sh
tooling/npm-survey/run.sh
```

## The stages

| stage | in | out | what it does |
|---|---|---|---|
| `resolve.ts` | `roots.json` | `closure.json` | walks the runtime dependency closure straight from the registry |
| `classify.ts` | `closure.json` | `classified.json` | downloads each published tarball and asks whether the *entry point's* implementation can be recovered |
| `vendor.ts` | tarballs | `vendored/` | materialises the recovered TypeScript as ordinary source |
| `verdict.ts` | `vendored/` | `verdict.json` | hands each package to `nts check` and records what the compiler says |

Written in TypeScript and run directly — node 24 strips types with no flag and
no build step, so there is nothing to compile before measuring.

No stage installs anything, runs a lifecycle script, or executes package code.
`resolve.ts` reads registry metadata and `classify.ts` reads tarballs as data.
`tarball.ts` is the shared archive and source-map reader, kept in one place so
the classifier and the extractor cannot disagree about what a package
contains.

## Three things to know before quoting a number from this

**The closure is a sample, not a census.** `roots.json` is 96 packages chosen
to look like what TypeScript applications import — HTTP servers, validators,
ORMs, date and string utilities, loggers, parsers. It resolves to 458 packages.
A different root set gives different numbers, and the *shape* is what
transfers, not the digits.

**Version resolution is deliberately crude.** `semverMax` understands caret,
tilde and exact ranges and picks the newest matching release. It is not a
semver solver and does not need to be: the survey asks what a package's
published files look like, and that does not turn on picking the same version
npm would.

**A per-package refusal count is a lower bound, and a zero is not a pass.**
`verdict.ts` compiles each package with nothing calling it, so the compiler
prunes what no root reaches and never walks it. `mitt` came back with zero
refusals that way and then refused three different constructs the moment a
program used it — see `docs/npm-deps.md`. Reading a zero here as "this package
compiles" is exactly the mistake the profile number in
`docs/conformance/typescript.md` §14 was caught making twice.

## Caches

`meta/` (registry metadata) and `tars/` (published tarballs) are written on
first run and reused after. They are not checked in. Delete them to re-measure
against today's registry; keep them to reproduce a past number exactly.
`vendored/` is regenerated from `tars/` every run.
