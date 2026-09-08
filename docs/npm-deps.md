# npm dependencies — what is actually there

This file used to be an unmeasured argument: it described where a compiler
might look for a package's original TypeScript, in a plausible order, and
recommended building a source-acquisition layer in front of the compiler.

The routes it named are real and are kept below. What it never did was count
anything, and the counting changes the conclusion. **Source acquisition is not
the binding constraint.** It is a small problem sitting in front of a much
larger one, and building the elaborate version of it first would be building
the wrong thing carefully.

Everything numeric here comes from [`tooling/npm-survey`](../tooling/npm-survey/),
measured at `80ad7468` against the registry on 2026-09-08. Re-run it before
acting on any digit.

---

## The sample

96 packages chosen to look like what a TypeScript application imports — HTTP
servers, validators, ORMs, date and string utilities, loggers, parsers, crypto
— resolved to their full runtime dependency closure:

    96 roots  →  458 packages

    depth 0   96      depth 3   45
    depth 1  200      depth 4    7
    depth 2  107      depth 5    3

    285 of 458 have no dependencies of their own
    60 of the 96 roots pull nothing at all
    the largest closures: express 69, fastify 45, archiver 33, winston 30

That second half matters more than it looks. The ecosystem is mostly leaves —
small, dependency-free packages — with a few roots that drag in dozens. A
dependency story that works only for leaves already covers most of the graph by
count, and none of `express`.

---

## 1. Can the implementation be recovered at all?

The question has to be asked about the package's **declared entry point**, not
about whether a `.ts` file exists somewhere in the tarball. Asking the loose
version inflates the answer badly: a first pass counted 48 packages as shipping
TypeScript, and the majority were shipping `index.test-d.ts` — `tsd` type tests
— with no implementation source at all. `rfdc` "ships TypeScript": 273 bytes of
type assertions.

Asked properly — does the file that `exports`/`main`/`module` names have a
recoverable implementation:

| route                                                                    | packages | share |
| ------------------------------------------------------------------------ | -------: | ----: |
| `js-only` — nothing to recover                                           |      399 | 87.1% |
| `entry-map-ts` — the entry's source map carries its TypeScript           |       25 |  5.5% |
| `map-incomplete` — a map exists, `sourcesContent` has holes              |       21 |  4.6% |
| `ts-present-entry-not-covered` — TypeScript ships, but not for the entry |        9 |  2.0% |
| `map-js-origin` — the map's sources are JavaScript                       |        3 |  0.7% |
| `entry-ts` — `exports` names a `.ts` directly                            |    **1** |  0.2% |

    recoverable for the package itself:      26 of 458   5.7%
    recoverable across its whole subtree:    22 of 458   4.8%
    of the 96 roots, whole-subtree:          11

The eleven: `zod`, `drizzle-orm`, `immer`, `minimatch`, `ts-pattern`,
`class-transformer`, `cookie`, `tar`, `marked`, `lru-cache`, `mitt`.

Two details worth keeping.

**The source-map route is the only one that works, and one package uses the
cooperative one.** The original draft proposed a custom `exports` condition as
the clean path for willing authors. Exactly one package in 458 points `exports`
at TypeScript. Source maps carry five times as much recoverable source as
deliberate publication does, and they carry it by accident.

**`map-incomplete` is nearly as large as `entry-map-ts`.** 21 packages ship a
map whose `sourcesContent` is partly `null`. Half a module graph is not a
buildable package, and treating a partial recovery as a success is how a
source-acquisition layer starts lying.

### The git route, and why it is thinner than it sounds

The draft's second route was fetching the repository at the release revision.
The affordances for doing that safely:

    repository field present:              458 of 458   100%
    gitHead present:                         9 of 458     2%
    npm provenance attestation present:     57 of 458    12%

So for 86% of packages there is a repository URL and nothing that pins which
commit produced the artifact. Resolving a version tag and hoping is not a
source-to-artifact correspondence, and the draft was right to say so. The route
is real; it is a per-package recipe with a human in it, not an automatic tier.

---

## 2. The second gate is the wall

Recovering the source answers the first question. The second is whether this
compiler can compile it, and that is where the ecosystem actually stops.

All 26 recovered packages were vendored out as ordinary source and handed to
`nts check`:

| outcome                          | packages |
| -------------------------------- | -------: |
| did not typecheck                |       19 |
| typechecked, refused constructs  |        6 |
| typechecked, no refusal reported |        1 |

**Most of those 19 are the harness's fault, not the package's.** The error codes
say so: `TS2307` is a missing dependency the survey did not vendor, `TS2591` is
a missing ambient `process`/`Buffer`, `TS2503` a missing `@types` namespace,
`TS7006` an implicit `any` under a `strict` the package never asked for. Only
`TS1294` — `erasableSyntaxOnly` — is this compiler's profile talking. Separating
those four causes is unfinished work, and until it is done **19 is not a
language verdict and must not be quoted as one.**

### What the six that reached the lowerer refuse

This is the part worth reading, because it is nothing like what a syntactic
scan predicts:

| package           | refusals | what they are                                                 |
| ----------------- | -------: | ------------------------------------------------------------- |
| `yallist`         |       27 | `Iterable` and `Node` parameters, `yield` outside a generator |
| `brace-expansion` |       22 | a name from an enclosing scope, `Math.random`, `instanceof`   |
| `cookie`          |       12 | regular expression literals ×5, `new` of type `any`           |
| `content-type`    |        8 | regular expression literals ×4                                |
| `balanced-match`  |        9 | a name from an enclosing scope, `instanceof`                  |

Regular expressions, closure capture from an enclosing scope, `Math.random`,
`instanceof`, iterables. **None of these is npm infrastructure.** They are
ordinary compiler reach, and they are the same queue
[`docs/conformance/typescript.md`](conformance/typescript.md) §15 already keeps.
The regex rows in particular are an independent argument for the direction
already recorded in `docs/icu-i18n.md`.

### The one that reported no refusal did not compile

`mitt` came back clean. It came back clean because **nothing called it** — the
compiler pruned the module and never walked it. Pointed at by a program that
actually uses it, three separate refusals appear:

    mitt<Events>()          → an omitted argument for a parameter with
                              nowhere to put `undefined`
    mitt<Events>(new Map()) → a `new` of unrepresentable type (`Map<any, any>`)
    the returned object     → a method declaration in an object literal

This is the same trap §14 of the conformance doc records catching twice: a
count of what lowers is meaningless over functions nothing reaches. **Every
per-package number above is a lower bound**, and any future instrument has to
measure from a use site rather than from a package in isolation.

### What a syntactic probe says, for calibration

Over the 26 recovered packages, a textual scan for constructs §13 refuses:

    free of every probe                          4
    would be, if `any` were representable       10
    ...plus ambient globals bound               11
    ...plus enum/namespace lowered              13
    blocked by the object model regardless      13

The last row is the honest half. Thirteen of twenty-six use `Proxy`,
`Object.defineProperty`, prototype mutation or a well-known `Symbol` protocol.
Those are §13 refusals — not backlog, not reachable by working harder. For
those packages the package's own source is permanently the wrong input, whatever
the acquisition layer manages to fetch.

The first row is the useful half: **`any` alone more than doubles the clean
set**, and [`docs/any-unknown.md`](any-unknown.md) already holds the design
contract for it, unimplemented. npm reach and `any` representation are the same
work.

---

## 3. One line decides all of this today

`compiler/frontend-ts/src/tsgo/mod.rs:1408`, `compiled_files`:

```rust
if metadata.is_default_library || metadata.is_from_external_library {
    continue;
}
```

Anything TypeScript resolved out of `node_modules` is dropped before lowering.
Measured three ways:

- A package under `node_modules` whose `exports` names a `.ts` file — resolution
  succeeds, with a Package ID, and the file never becomes a module.
- The same package pointed at by `paths` — still dropped. The discriminator is
  the file, not the route.
- The identical source copied _outside_ `node_modules` — becomes a module and
  lowers.

The boundary is deliberate and the comment beside it says why. What is not
deliberate is the diagnostic a program gets when it crosses:

    refused: NTS1001 `invariant`, a builtin this compiler does not
             provide is not supported by this lowering yet

`invariant` is not a builtin. It is `tiny-invariant`, whose implementation was
excluded from the program. A reader of that message goes looking in
`hir::builtin` for a missing standard-library name and finds nothing, because
nothing is missing there. **The first thing to fix in this area is the sentence,
not the boundary.**

`rootDir` is the other structural constraint, found the same way: a dependency
materialised outside the app's `rootDir` fails with `TS6059` before the compiler
sees it. Whatever acquires sources has to write them _inside_ the program.

---

## 3a. The per-project number, which is the one that matters

Everything above is measured package by package out of a tarball. That is the
wrong unit and §2 says so: a package compiled with nothing calling it is not a
measurement. `nts deps` measures the right one — a real project, driven by what
its program imports — and `tooling/npm-survey/corpus.ts` builds the project to
point it at: all 458 packages installed flat, a program importing all 96 roots.

    packages the program reaches      141   (of 458 installed)
    acquired                           15   10.6%

    by route
      110  published JavaScript only
       14  source map
        1  shipped TypeScript
       11  a map that exists and cannot be used:
             9  sourcesContent has holes
             3  bundles several sources, names no entry among them
             1  its sources were JavaScript
        2  the entry its package.json names is not installed

Two things this says that the per-package number could not.

**The denominator is smaller than the dependency graph.** 141 of 458, because a
program reaches what it imports rather than what its manifests declare. The rate
roughly doubles — 5.7% to 10.6% — without anything being acquired that was not
acquirable before.

**A map that exists is not a map that can be used.** Eleven packages ship one
and none of the eleven yields source: nine have `null` in `sourcesContent`,
three are bundles whose map names several sources and no entry, one was
JavaScript to begin with. That is nearly as many as the fourteen the route
succeeds on, and it is the sharpest argument in this file against building the
acquisition pipeline out further: the next tier of effort buys those eleven.

The recovered graphs are whole, which took a second pass to get right. A
`tsc`-style build emits one file per input, so the *entry's* map carries the
entry alone — `minimatch` first arrived as `src/index.ts` with five dangling
imports and looked exactly like a package that has one module. Recovery now
indexes every map in a package and walks imports between the sources those maps
*state*, which is not the same as inferring that `dist/ast.js` came from
`src/ast.ts`. `drizzle-orm` went from 1 file to 291, `minimatch` to 6.

### Recovered source is not automatically buildable source

The original draft said not to equate the two. Handing the acquired corpus to
the checker says how far apart they are:

    the project's own code, before acquiring   23 errors
    the project's own code, after acquiring    23 errors
    added, all of it inside vendored source   218 errors, over 7 of 14 packages

The first two numbers matter as much as the third: **acquisition never made the
program worse**, it only added source that has its own problems.

The first measurement of this was **3,091**, and 2,850 of them were one package.
`drizzle-orm` writes `~/entity.ts` throughout and publishes no tsconfig defining
`~`, so every one of its 291 recovered files imports something that cannot
resolve. Vendoring that and reporting it as acquired is a partial recovery
dressed as a success, so it is now a refusal that names the specifier — and the
count fell to 218 by declining one package rather than by fixing anything.

What is left, over the seven packages that arrive with errors:

| | | |
|---|---:|---|
| `TS2591`, `TS2503` | 51 | an ambient the package's own build supplied — `process`, `Buffer`, a namespace |
| `TS7006` | 26 | implicit `any`: the source assumes a `strict` its build did not set |
| `TS2307` | 24 | a module still unresolved |
| `TS2345`, `TS2322`, `TS2532`, `TS2339` | 68 | ordinary type errors under options the source was not written for |

**Seven of fourteen arrive clean.** The other seven need their build
*environment*, not more source — which is a different problem from acquisition
and a much smaller one than it looked before the one bad package was separated
out.

## 4. What the numbers argue for

**The elaborate acquisition pipeline is not the first thing to build.** Its
ceiling is 5.7% of a realistic closure, and most of that 5.7% then hits refusals
that have nothing to do with npm. Three tiers of fetching, provenance
verification and recipe formats would be careful work spent on the smaller half
of the problem.

**A package's implementation is not the only way to satisfy it.** What an
application needs is the behaviour behind a package's public type surface, and
the `.d.ts` — the one artifact npm distributes reliably — _is_ that surface. The
Node profile already runs this playbook: `runtime/node` is 22 modules of
TypeScript written against node's contract, tested with node's own suite, with
each native operation a single `declare function`. Nothing about it is specific
to `node:*`.

So a dependency has more than two outcomes, and which one applies is a per
package fact worth measuring rather than assuming:

1. **compile its own TypeScript** — when recoverable and when it lowers;
2. **bind its contract to a native implementation** — right answer anyway for
   anything that is a thin wrapper over platform capability;
3. **a portable TypeScript port** in-tree, checked against the package's own
   published `.d.ts` for surface and its own test suite for behaviour;
4. **refuse by name**, with the reason and the route that would change it.

**And the instrument comes before the feature.** Every number in this file was
produced by a throwaway harness that had to be written before anything could be
argued. That harness belongs in the tree, pointed at a real project, printing
the closure with a route and a reason per package — the same way `nts modules`,
`nts erasure` and `nts layouts` exist to make a question answerable before
anything depends on the answer.

The plan is [`npm-deps-plan.md`](npm-deps-plan.md).

---

## Appendix: the routes, as the original draft named them

Kept because the taxonomy is right even where the weighting was wrong.

**Shipped TypeScript.** A package including its `src` in the archive. Measured
at ~2% of packages, and one package in 458 exposes it through `exports`.

**Embedded source-map content.** `sourcesContent` in an external `.js.map` or an
inline `data:` URL, which `inlineSources` populates with the original `.ts`.
Extraction is reading an embedded copy, not decompilation. This is the only
route that carries meaningful volume. Maps may be sectioned; `sourcesContent`
entries may be `null`; the recovered text may be JavaScript rather than
TypeScript. Load recovered files into a package-scoped virtual filesystem,
normalise paths, refuse traversal outside the extraction root, and detect
conflicting contents for one logical path.

**A pinned repository checkout.** `repository.url` plus `repository.directory`
for monorepos; `gitHead` when present; npm provenance when available. Never the
default branch for a pinned version. Measured: 100% / 2% / 12%.

**Explicit per-package recipes.** For packages that need generated files,
release-time constants, or a custom transform, record the requirement rather
than re-guessing it from directory names.

**Type resolution is not implementation resolution.** `resolveTypes` and
`resolveImplementation` are different questions, and finding `dist/index.d.ts`
must not stop the second. An import written `./helper.js` may resolve to
`helper.ts`, and a source resolver needs the same extension substitution.

**Both gates apply to every reachable dependency**, not just the top level. A
package whose own source is TypeScript is not usable if something below it is
not — which is the difference between 5.7% and 4.8% above.
