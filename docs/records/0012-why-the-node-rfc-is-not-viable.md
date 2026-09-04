# 0012 — Why NTS-NODE-001 is not viable

Status: conclusion, from measurement
Recorded: 2026-08-27
Subject: `docs/node-js.md` (RFC NTS-NODE-001)
Corpus: `nodejs/node` at tag `v24.20.0`

The RFC proposes treating Node.js as an upstream **standard-library source
package**: consume a pinned checkout, compile selected files from `lib/*.js`
and `lib/internal/**/*.js` through the Native TypeScript frontend, and reach
native code without embedding V8 or maintaining a permanent fork.

This records why that does not work. The measurements below are reproducible
against the pinned tag; the numbers are what changed the conclusion.

## The argument does not rest on compiler maturity

This compiler is young and refuses a great deal of ordinary TypeScript. None of
that is the argument here, and this record deliberately excludes it. Every
finding below is a property of **Node's source and Node's release process**, and
each would hold unchanged against a mature compiler that lowered all of
TypeScript perfectly.

The argument is also not hostile to the RFC's instinct. A working port exists —
see record 0011 and `examples/node-path` — and it agrees with the real
`node:path.posix` on 2856 cases. The question is not whether Node's library can
be reached. It is whether Node's **source files** are the right input.

## Finding 1 — `lib/` has no module boundaries in the sense a compiler needs

`lib/path.js` is the most nearly self-contained module Node has. It uses exactly
two symbols from outside its own file and the constants table: `isWindows`, a
boolean, and `getLazy`, a five-line memoiser. Both come from one eager require:

```js
const {
  isWindows,
  getLazy,
} = require('internal/util');            // lib/path.js:57-61
```

The transitive closure of that import — following only **eager** requires, that
is requires at module scope and not inside a function or a lazy thunk — is:

| | |
| --- | ---: |
| files | 8 |
| lines | 5,770 |
| distinct `internalBinding` surfaces | 9 |

`lib/internal/util.js` alone is 900 lines that exist to serve every module in
Node, and it reaches `internalBinding('messaging')` — V8's structured-clone
serializer, for `DOMException` — and `internalBinding('profiler')`.

Both of those sit behind lazy accessors, so a sufficiently strong reachability
analysis could in principle prune them. That is precisely the burden the RFC
does not account for: the analysis must prove unreachability **soundly**, across
dynamic JavaScript, for 372 files, and re-prove it on every Node release. Where
it fails to prove, what remains is V8.

The ratio is the finding. Two symbols cost 5,770 lines and nine binding
surfaces. A hand-written equivalent of the same public functions is 271 lines
and needs no bindings at all.

## Finding 2 — the closure ceiling is the entire library, for every module

Following **all** requires, eager and lazy, every public module converges on the
same closure:

| module | eager files | eager lines | eager bindings | full closure |
| --- | ---: | ---: | ---: | --- |
| `path` | 8 | 5,770 | 9 | 227 files / 108,762 lines / 61 bindings |
| `os` | 7 | 4,360 | 10 | 227 / 108,762 / 61 |
| `events` | 11 | 8,615 | 14 | 227 / 108,762 / 61 |
| `buffer` | 13 | 10,046 | 16 | 227 / 108,762 / 61 |
| `fs` | 42 | 26,905 | 30 | 227 / 108,762 / 61 |
| `stream` | 48 | 24,325 | 23 | 227 / 108,762 / 61 |
| `http` | 74 | 41,468 | 34 | 234 / 114,665 / 61 |

Node's `lib/` is not a collection of libraries. It is one realm that assumes a
bootstrap sequence, a shared error and inspection machinery, a V8 heap and an
event loop. The RFC's phrase "compiling **selected files**" presumes a cut in
this graph that does not exist. There is no subset whose boundary is small.

## Finding 3 — Node's C++ is marshalling, and marshalling is the part to delete

Across all 201 `.cc` files in `src/`:

| | lines |
| --- | ---: |
| total | 126,505 |
| touching V8 (`Local<`, `Isolate`, `FunctionCallbackInfo`, `HandleScope`, `env->`, …) | 13,889 |
| calling libuv (`uv_*`) | 1,513 |

Nine lines of engine marshalling for every line of actual work. `Cwd`, the
implementation behind `process.cwd()`, is representative
(`src/node_process_methods.cc:159`): seventeen lines, of which one is
`uv_cwd(buf, &cwd_len)` and the rest construct an `Environment*`, a
`Local<String>` and a return value on V8's stack.

Every binding entry point has signature `void(const FunctionCallbackInfo<Value>&)`.
None can be called without an Isolate, a Context and a HandleScope. Linking
Node's compiled archive therefore *is* embedding V8 — the one thing §1 forbids.

So "reuse Node's C++ modules" resolves to: keep the 1,513 lines of libuv calls,
delete the 13,889 lines around them, and supply your own ABI. That is a
reasonable thing to do, and it has been done here for two bindings. But it is
transcription against a reference, not reuse of a module.

## Finding 4 — part of the surface has no meaning without an engine

Of 67 distinct `internalBinding` surfaces across 378 call sites, a group is not
merely unported but unportable: `contextify`, `module_wrap`, `messaging`,
`worker`, `inspector`, and the V8-stack machinery behind `errors`. `vm`,
`v8.serialize`, the inspector protocol and worker structured-clone messaging are
definitions *of* V8 behaviour. They can be replaced by something different or
refused; they cannot be compiled.

This sets a ceiling on coverage that no amount of effort moves, and the RFC does
not acknowledge that such a ceiling exists.

## Finding 5 — Node's library does not typecheck, and that is a source property

With `allowJs`, `checkJs`, every external stubbed as `any`, and `noImplicitAny`
disabled — the most permissive arrangement available — **219 of 372 files fail
to typecheck**. The failures are structural, not stylistic:

- `lib/events.js` — `EventEmitter` used as both value and type, and an export
  assignment combined with named exports (TS2749, TS2507, TS2309).
- `lib/punycode.js` — variables reassigned across incompatible types (TS2322,
  TS2362, TS2365).
- `lib/querystring.js` — `{ __proto__: null }` where a `Record` is required.

These are properties of the JavaScript, reported by the TypeScript checker.
They would be reported identically by any TypeScript-based frontend, and they
are unaffected by how much TypeScript the backend can lower.

The RFC's §1 also assumes the checker will "infer internal helper types" for
this code. It does not. For untyped JavaScript the checker's answer is `any`,
which is an absence of information rather than a type — so the RFC's central
mechanism supplies nothing on the internal helpers it is aimed at.

## Finding 6 — the RFC forbids the fork it requires

§1 states that Native TypeScript must not:

> maintain a permanent source fork of Node's JavaScript standard library.

and then lists, as the importer's responsibilities:

> apply semantic overlays, apply minimal external patches, substitute explicit
> shims when required.

Overlays, patches and shims held against 372 upstream files, rebased on every
upstream release, **are** a fork. It is a fork with worse ergonomics than a real
one, because the divergence is expressed as out-of-tree transformations rather
than as tracked source.

Node ships a release roughly every two weeks and a major line every six months.
Each release perturbs the files the importer patches. The cost of this proposal
is therefore not an integration cost paid once; it is a continuous rebase
obligation across 161,340 lines of someone else's JavaScript, whose refactors
are not coordinated with us and whose maintainers have no reason to keep the
patch surface stable.

Pinning to one version and declining to track releases does not escape this. It
converts the obligation into a frozen standard library that never receives an
upstream security fix — which for `fs`, `http`, `crypto` and `url` is not a
tenable product.

## What the same evidence does support

The RFC's underlying instinct is sound: Node's library encodes a great deal of
hard-won correctness, and rewriting it from nothing would discard that. The
error is in which artifact gets reused. Four things reuse cleanly, and three
have been demonstrated here:

1. **The algorithms.** Leaf function bodies transcribe almost unchanged.
   `examples/node-path` carries the posix half of `node:path`, bodies taken from
   `lib/path.js`, and agrees with the real `node:path.posix` on 2856 cases.
2. **The C++ as a reference for libuv usage.** `uv_cwd` and `uv_os_gethostname`
   were transcribed with our ABI in place of V8's, producing a binary that links
   `libuv`, `libm` and `libc` and matches node's output.
3. **Node's test suite as the conformance gate.** `test/parallel` holds 4,058
   files — 17 files and 1,305 lines for `path` alone. This is the most valuable
   reuse available and the only one immune to the rebase problem, because tests
   are black-box and version-tolerant. The RFC does not mention it.
4. **node itself as a differential oracle**, which is already how `nts check`
   works.

That is: reuse Node as **specification, oracle and reference implementation**,
not as **source input**. It preserves the correctness guarantee that motivates
the RFC while inheriting neither the dependency graph, nor the V8-intrinsic
tier, nor the fork obligation.

The scope also shrinks to something ownable: roughly thirty public modules worth
writing, on the order of 30,000–50,000 lines of TypeScript that we own and can
type, against 161,340 lines that we do not own and cannot.

## Objections, and what the measurements say to them

**"Stub the lazy requires and the closure collapses."** It does not collapse far
enough. The eager closure of `path` is still 8 files, 5,770 lines and 9 binding
surfaces, for two symbols. And every lazy edge that is stubbed rather than
proven unreachable is a behavioural difference that has to be justified per
file, per release.

**"Only 219 files fail to typecheck; patch those."** Patching them is the fork
of Finding 6. The count is also not the burden — the burden is that the patches
must survive upstream refactors nobody is coordinating with us.

**"Pin a version and stop tracking upstream."** Then the standard library never
receives a security fix. See Finding 6.

**"Take only the leaf modules."** Measured in Finding 1: there are none. The
most self-contained module in Node reaches `internal/util.js` on its first hop.

**"`internalBinding` can be shimmed."** For the libuv tier, yes — demonstrated.
For the V8-intrinsic tier of Finding 4, a shim is a reimplementation of engine
semantics, and the surface is 67 bindings across 378 call sites.

**"Whole-program reachability will prune what is unused."** It has to prove
unreachability soundly, over dynamic JavaScript, across 372 files, and again on
every release. Where the proof fails the residue is V8 — and a soundness bug
there is a miscompile rather than a missing feature.
