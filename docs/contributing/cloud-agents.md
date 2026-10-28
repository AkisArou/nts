# Contributing from a cloud agent

How an agent that works through GitHub pull requests, without this machine's
gate or toolchains (ChatGPT's coding agent, for one), contributes to nts. The
rules for every other contributor are in [`../../AGENTS.md`](../../AGENTS.md)
and [`workflow.md`](workflow.md); this page is what differs.

## What a cloud agent works on

Plain TypeScript, and the tests that hold it to its specification:

- in `runtime/web-platform`, the specification-defined API surfaces and
  policy of features whose provider is source code ([which kind of provider](../foundations/builtins.md#which-kind-of-provider));
- in `runtime/web-platform`, the TypeScript surface of a native feature over
  its capability, where a maintainer's handoff assigns it: the Web
  Cryptography API over `host:crypto`'s primitives;
- in `benchmarks/cases/`, programs ported from an established benchmark
  suite, each with its C++ reference (and a Java one where the suite has
  it), where a handoff assigns them. A port is transcribed, not rewritten,
  and a program nts refuses is kept as it is: the refusal is the finding.
  Only permissively licensed code enters the repository (MIT, BSD, Apache,
  zlib, Boost, ISC, Unicode). A part under the GPL or LGPL is left out, or
  replaced with original code written without reference to it.

Never the work the compiler or native code does: whatever depends on the
layout of the values it is given (`structuredClone`, string conversions) and
whatever has a known native winner (SIMD transcoding, compression, the
cryptographic primitives themselves) is built inside nts.

Out of scope: `compiler/`, `runtime/c/`, `tooling/` (except adding a test file
to `tooling/conformance/web-platform/check.sh`'s list), `docs/` (except a
pointer to the specification section a change implements), and any file
another open pull request touches, except the two shared files below (under
"A pull request").

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
- **Not at all, for now:** `Proxy`, `Reflect`, `Object.defineProperty`,
  `freeze`, `seal`, decorators, and reflection over prototypes and
  descriptors (`Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor`).
  nts compiles a class to a fixed layout with no property descriptors yet,
  so Web IDL's writable, enumerable and configurable flags are not
  reproduced: declare members plainly (constants as `static readonly`), and
  list a case that tests only a descriptor as left out. An nts program
  cannot redefine an intrinsic accessor either, so `view.byteLength` and the
  like already are the internal slot reads Web IDL asks for. Read them
  plainly, and list a case that spoofs one by patching a prototype as left
  out.
- **A native capability reports failure as a value,** never by throwing: a
  native binding cannot throw into TypeScript yet. A primitive returns a
  result that the shared code turns into the specification's exception.
- **Write for speed:** a `RegExp` with a literal pattern, which nts compiles
  into a generated matcher, rather than one built from a string, unless the
  specification builds the pattern at run time; typed arrays and simple
  loops on hot paths; no allocation per character or per call where the
  specification does not require one.
- **Classes and interfaces are typed layouts:** declare every field, with its
  type, in the class body. A constructor function from older JavaScript
  becomes a `class` with the same fields: strict TypeScript refuses `new` on
  a plain function, and no cast (`as unknown as`) may force it through. A
  prototype used as a namespace (`Vector.prototype.add(a, b)` with explicit
  operands) becomes `static` methods with the same bodies.
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
- **One revision per web-platform-tests directory,** recorded with each
  file's hash in the adapter's versions table, as node pins its own copy. A
  shared directory (`common/`, `resources/`) exists once, at the newest
  revision any imported directory needs: a pull request that needs a newer
  one updates it for every test and reports any result that changes, rather
  than keeping a second copy.

## A pull request

- **One specification area per pull request,** on a branch named
  `chatgpt/<topic>`, against `main`.
- **Work that needs another open pull request's code stacks on it:** branch
  from that pull request's branch and make it the new pull request's base.
  Retarget to `main` once the first lands. Don't wait for a landing to
  start the next item.
- **Two shared files every pull request may touch:** `check.sh`'s test
  list, and the shared web-platform-tests adapter
  (`runtime/web-platform/test/wpt/harness.ts`, `runner.ts`, `tsconfig.json`).
  Add your entries to the list in order. Keep adapter changes additive,
  and name each one, with what it does, in the description. The
  maintainers resolve the merges.
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
