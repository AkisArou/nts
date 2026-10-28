# Contributing from a cloud agent

How an agent that works through GitHub pull requests, without this machine's
gate or toolchains (ChatGPT's coding agent, for one), contributes to nts. The
rules for every other contributor are in [`../../AGENTS.md`](../../AGENTS.md)
and [`workflow.md`](workflow.md); this page is what differs.

## What a cloud agent works on

Plain TypeScript in `runtime/web-platform`, and the conformance tests that
hold it to its specifications:

- the specification-defined API surfaces and policy of features whose
  provider is source code ([which kind of provider](../foundations/builtins.md#which-kind-of-provider));
- the TypeScript surface of a native feature over its capability, where a
  maintainer's handoff assigns it: the Web Cryptography API over
  `host:crypto`'s primitives.

Never the work the compiler or native code does: whatever depends on the
layout of the values it is given (`structuredClone`, string conversions) and
whatever has a known native winner (SIMD transcoding, compression, the
cryptographic primitives themselves) is built inside nts.

Out of scope: `compiler/`, `runtime/c/`, `tooling/` (except adding a test file
to `tooling/conformance/web-platform/check.sh`'s list), `docs/` (except a
pointer to the specification section a change implements), and any file
another open pull request touches.

## The TypeScript nts compiles

nts compiles TypeScript ahead of time, with typed layouts, so it accepts a
stricter TypeScript than node runs. Follow the style of the code already in
`runtime/web-platform`. Write each algorithm as its specification defines
it, using any feature nts has decided to support even where it cannot
compile it yet (`RegExp`, generators, reading `globalThis`, member reads by
a run-time key on `any` and `unknown`): until that feature lands, nts
refuses the functions that use it by name, the maintainers record those
refusals when they land the code, and the code compiles the day the feature
does. In particular:

- **`strict` on,** and no `any` except where a specification passes an
  arbitrary value; `unknown` there, narrowed before use.
- **Never what nts will not compile:** `eval` or `new Function` of a
  run-time string, `with`, sloppy-mode code, or assignment to `globalThis`.
  Globals are exposed by the package's provider bootstrap.
- **Not without asking in the pull request:** `Proxy`, `Reflect`,
  `Object.defineProperty`, `freeze`, `seal` and decorators. They are later
  work for nts, and these specifications rarely need them.
- **Write for speed:** a `RegExp` with a literal pattern, which nts compiles
  into a generated matcher, rather than one built from a string, unless the
  specification builds the pattern at run time; typed arrays and simple
  loops on hot paths; no allocation per character or per call where the
  specification does not require one.
- **Classes and interfaces are typed layouts:** declare every field, with its
  type, in the class body.
- **Imports stay inside the package** or go through the provider interfaces
  in `src/provider/`. Platform services (the clock, sockets, files) are
  provider capabilities, never node's modules.

## Testing

The package's tests run under plain node 24 (the version in
`.tool-versions`), with pnpm 10 (`packageManager` in `package.json`):

```sh
pnpm install
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/<your-file>.test.ts
```

`sh tooling/conformance/web-platform/check.sh` runs the whole suite. Without
an nts compiler it skips the compiled checks and says so; that is expected in
a cloud environment.

- **Every new test file is added to the list in `check.sh`,** which fails on a
  test file it does not name.
- **Tests come from the specification:** each behaviour a section defines,
  edge cases included. Cases taken from web-platform-tests are copied
  unedited, keep their licence header (BSD-3-Clause), and name their source
  path and revision.

## A pull request

- **One specification area per pull request,** on a branch named
  `chatgpt/<topic>`, against `main`.
- **The description names** the specification and its sections, what is
  implemented and what is not, and the test command and its output.
- **Commit messages** say what the change does, in the present tense, as the
  repository's history does.

## After the pull request

A local agent fetches the branch, compiles the package with nts, runs the
gate's steps that the change owes, and lands it on `main` through
[`land`](workflow.md). The landed commits keep the pull request's authorship;
the pull request is then closed with the landed commit's id. A change that
nts refuses comes back on the pull request with the refusal, so the code can
be rewritten within the rules above.
