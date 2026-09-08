# npm dependencies — what to do about it

Companion to [`npm-deps.md`](npm-deps.md), which records what is true. This
file records what to do about it, and why in that order.

Every number here was measured at `80ad7468` by
[`tooling/npm-survey`](../tooling/npm-survey/). Re-measure before acting on any
of them.

## Scope

Self-contained, by instruction. No JSR, no second registry, no asking package
authors to publish a `nts` export condition, no ecosystem-cooperation strategy,
nothing that requires anybody outside this repository to do anything.

That constraint costs less than it sounds like it should. Of 458 packages in a
realistic dependency closure, **one** exposes TypeScript through a custom
`exports` condition. The cooperative route is not a road not taken; it is a road
nobody is on.

## The situation in one paragraph

Two gates stand between an npm dependency and a compiled program: can its
implementation be obtained, and can this compiler compile it. The first is
narrower than expected and the second is the wall. Source is recoverable for
**26 of 458** packages and for **22** once their subtrees have to be recoverable
too. Of those 26, six reach the lowerer and refuse between 8 and 27 constructs
each, one reports no refusal only because nothing called it, and the rest fail
to typecheck for reasons the survey harness mostly caused itself. **Zero
packages compile.** The refusals, when they finally appear, are regular
expressions, closure capture, omitted optional arguments and object-literal
methods — ordinary compiler reach, not npm machinery.

    npm packages compiled from their published sources and
    agreeing with node:   0

Everything below is ordered by that number.

---

## The model: a dependency is a contract and a binding

The thing an application needs from a package is the behaviour behind its
public type surface. npm distributes that surface reliably — every package in
the closure has one — and distributes the implementation behind it almost never.

So a dependency resolves to a **contract** (the package's declarations) plus a
**binding** (something this compiler can lower), and there is more than one way
to supply the second:

| binding | when it is right | measured supply |
|---|---|---|
| the package's own TypeScript | recoverable *and* it lowers | 26 of 458 recoverable |
| an in-tree portable TypeScript port | the object model permanently blocks the original | 13 of 26 need this |
| a native implementation behind `declare function` | the package is a thin wrapper over platform capability | the `runtime/node` playbook |
| refusal, by name and reason | everything else | the honest majority, today |

The third row is not a fallback. For `pg`, `sharp` or `fs-extra` a native
binding is the *better* artifact, and the package's own JavaScript was never
going to be the input.

The second row is not new work either. `runtime/node` is already 22 modules of
TypeScript written against somebody else's contract and tested with their own
suite. `pnpm-workspace.yaml` already lists `libraries/*`, and that directory
does not exist yet. That is where userland ports go.

### The mechanism already works

No compiler change is needed to compile a dependency. Measured three ways in
`npm-deps.md` §3: source under `node_modules` is dropped by `compiled_files`
whatever route resolved it, and the identical source outside `node_modules`
becomes a module and lowers. `rootDir` must contain it.

So the acquisition layer's whole job is: **write the chosen implementation as
ordinary TypeScript inside the program, and point `paths` at it.** Everything
downstream is the pipeline that already exists.

    <workspace>/
      .nts/vendor/<name>@<version>/…   recovered source, one copy per workspace
      .nts/deps.lock                   artifact identity + source identity
      packages/app/
        node_modules/             untouched; still what node and the editor use
        tsconfig.json             untouched; still the project's own
        tsconfig.nts.json         generated: extends yours, adds the paths

---

## The developer experience is a design constraint, not a finish

Four rules, and the first one is load-bearing for correctness rather than taste.

**The project's own `tsconfig.json` and `node_modules` are never touched.** The
generated config extends the project's and adds the vendor `paths`; the compiler
is pointed at the generated one. This is not tidiness. **node is the oracle for
every correctness claim in this repository** — `nts check` compares a compiled
program against node running the same TypeScript — and that only works while the
program still runs under node, resolving its dependencies the ordinary way. A
tool that rewrote the project's `paths` to point at vendored source would break
the one thing that can tell it whether the vendored source was right. The editor
keeps working for the same reason, for free.

**Acquisition is automatic and cached, never a step somebody remembers.** See
below — it is enough of a design question to have its own section.

**A failure names the package, the route, and the next action.** The unit of
bad news is not a construct inside a vendored file nobody chose to read — it is
*"your import of `cookie` cannot be compiled, because its entry needs a regular
expression engine, at these 5 sites; the routes that would change that are a
port in `libraries/` or the regex work in `docs/icu-i18n.md`."* Section A is the
first instalment of this and section B is the rest.

**Nothing silently degrades.** There is no JavaScript fallback and there is not
going to be one, so a dependency this compiler cannot take must be visible
*before* a build fails — which is `nts deps`'s real job, and why it comes before
the acquisition it reports on.

### Nobody should have to run the acquisition

The developer runs `pnpm install` and then builds. There is no third command,
and the second one does not print a lecture about the first.

**The install hook is an optimisation. The build is the mechanism.** And
building it showed the optimisation is not worth taking.

A `postinstall` looked obviously worth having while this was a plan: dependencies
changing is exactly when vendored source goes stale, and install time is when a
developer already expects to wait for a network. Both halves of that turned out
to be wrong once acquisition existed. **Recovery never touches the network** —
every route reads files pnpm already put on disk — so there is no wait to move
earlier, and a whole monorepo acquires in about 15 ms. There is nothing for a
hook to warm.

It could not have been the mechanism anyway: `--ignore-scripts` is ordinary in
CI, a lockfile can change without an install, and a build that silently compiled
yesterday's dependency is worse than one that pauses. So the build checks and
acquires, always — which it now does, from `project()` in the CLI, so every
command that builds a program gets it and no `nts build` has to exist first for
the property to hold.

If a route is ever added that *does* fetch — the pinned-repository recipe of §1
is the only candidate — revisit this. Nothing else here justifies a hook, and a
package-manager-specific one (`.pnpmfile.cjs`) never will: it buys a slightly
better moment to run and costs working with npm, yarn and bun.

### `node_modules` is both the resolution and the source

Two shortcuts that make this much cheaper than the survey was, and both are DX
before they are performance.

**Walk `node_modules`, not a lockfile.** An earlier draft of this section said
to parse the project's lockfile. Building it settled the question the other
way: there are four lockfile formats and one `node_modules`, and more to the
point `node_modules` is what the developer's program *actually resolves
against*. Reading it cannot disagree with what `tsc`, node and the editor see,
and a lockfile parser can. pnpm's symlink store, npm's hoisted layout and a
nested `node_modules` all answer the same lookup. No version solver enters the
compiler; the survey's `semverMax` stays a survey artifact.

**Recovery reads `node_modules`, not the registry.** This falls out of
`npm-deps.md` §3 and is easy to miss: the files are *already installed*. Shipped
TypeScript, `.js.map` files and inline `sourceMappingURL` data URLs are all
sitting in `node_modules/<pkg>/` — the compiler simply declines to look at them
because they are under `node_modules`. So the common path needs no tarball, no
registry call and no network at all; it reads installed files and writes
`.nts/vendor/`. Only the pinned-repository route in §1 needs the network, and
that route is a per-package recipe anyway.

---

## A. Make the boundary honest

**Why first.** It is the smallest change in this document and the only one that
makes every later failure legible. Today a program that imports a package it
cannot compile is told:

    refused: NTS1001 `invariant`, a builtin this compiler does not
             provide is not supported by this lowering yet

`invariant` is not a builtin, nothing is missing from `hir::builtin`, and the
sentence sends its reader to the wrong file. Anyone doing the work in sections B
through E will read this message hundreds of times.

**What it says instead** names the package, says the implementation was not in
the program, and says which route would change that.

**Checkable condition.** A program importing a package resolved only to
declarations produces a diagnostic naming the package, and no diagnostic in that
situation says "builtin".

## B. `nts deps` — the instrument, before the feature

**Why second.** Every number in `npm-deps.md` came from a harness that had to be
written before anything could be argued, and that harness measures the wrong
unit: it compiles each package with nothing calling it, so the compiler prunes
what no root reaches. `mitt` reported zero refusals that way and refuses three
constructs the moment a program uses it. **The measurement has to be driven from
the application's use sites**, which means it has to live where the module graph
does.

`nts modules`, `nts erasure`, `nts layouts` and `nts types` all exist for this
reason: make the question answerable before anything depends on the answer.

**What it prints,** given a project: its runtime closure, and per package the
recovery route, whether the subtree is recoverable, **which exports this program
actually imports**, and what stops each one.

The used-slice column is the part the throwaway harness could not produce and
the part most likely to change the picture. An application imports three
functions from a package of four hundred, the compiler already refuses per
function rather than per module — `compiler/core/tests/module_evaluation.rs` is
the test that one refused statement must not cost a module its evaluation — so
a package does not have to compile for its used slice to compile.

**Checkable condition.** `nts deps` on a real project prints a table that
regenerates, and every npm number quoted anywhere in the tree comes from it
rather than from `tooling/npm-survey`.

## C. Vendor the used slice, and compile it

**Why third.** With A and B done this is mostly plumbing, and it produces the
number that has never existed: how many packages compile when driven from an
application's real imports.

Acquisition recovers implementations by the routes `npm-deps.md` measures —
shipped TypeScript first, `sourcesContent` second — reading them out of
`node_modules`, writing them under `.nts/vendor/`, and generating
`.nts/tsconfig.json` with the `paths`. It records both identities in a lock: the
npm artifact's integrity hash *and* the source identity, because a tarball hash
does not pin a source tree extracted from a source map.

**It runs from the build, not from a command the developer types**, keyed on the
project's lockfile so an unchanged lock does no work and touches no files. A
`postinstall` may warm the same cache earlier; it must never be what makes the
build correct.

Three things the survey learned the hard way and this must not repeat:

- **Normalise before writing.** Map-declared source paths are attacker-adjacent.
  Never write a path that escapes the extraction root; the prototype's
  `safeJoin` exists because `tar`'s own map names paths under a bundled
  `node_modules`.
- **A partial recovery is a failure.** 21 packages ship maps with `null` holes
  in `sourcesContent`. Half a module graph must be reported as unrecoverable,
  not vendored and left to fail confusingly later.
- **One logical path, one content.** Detect conflicts rather than letting the
  last write win.

**Checkable condition.** One npm package, acquired from what npm published,
compiled from its own source, agreeing with node on that package's own test
suite. This is the `0` at the top of the document.

## D. The refusal queue, ordered by npm evidence

**Why fourth.** Because until C exists the queue is guesswork, and the survey
already shows that guessing gets it wrong: a syntactic scan predicted `any`,
`defineProperty` and `Proxy` as the top blockers, and what the compiler actually
said was regular expressions, closure capture and omitted arguments.

Measured, from the six packages that reached the lowerer plus the `mitt` walk:

| what | seen in | note |
|---|---|---|
| a regular expression literal | `cookie` ×5, `content-type` ×4 | see `docs/icu-i18n.md`; this is an independent argument for the same direction |
| a name from an enclosing scope | `brace-expansion`, `balanced-match` | already row 6 of the README corpus table |
| an omitted argument for an optional parameter | `mitt` | pervasive in idiomatic npm code |
| a method declaration in an object literal | `mitt` | already rows 8 and 12 of the corpus table |
| `new` of unrepresentable type (`any`, `Map<any, any>`) | `cookie`, `content-type`, `mitt` | the `any` work |
| `instanceof` with no class | `brace-expansion`, `balanced-match` | |
| `Math.random` | `brace-expansion` ×3 | small |
| `Iterable` parameters, `yield` | `yallist` ×27 | |

**This is breadth, not a work queue that converts.** The README says it plainly
about the corpus table and it is true here: a package refused for five reasons
does not compile when one is fixed. Read the table as evidence about what npm
code contains, and take the ordering from C's use-site measurement.

**The `any` connection is the largest single lever.** Of 26 recovered packages,
4 are free of every hazard probe and **10** would be if `any` were
representable. [`docs/any-unknown.md`](any-unknown.md) already holds the design
contract, unimplemented, and says so in its own second paragraph. npm reach and
`any` representation are the same work, and this is the measurement that says
how much the second buys.

**What will never move.** 13 of 26 use `Proxy`, `Object.defineProperty`,
prototype mutation or a well-known `Symbol` protocol. Those are
`docs/conformance/typescript.md` §13 refusals — one decision made once, the
decision the whole compiler is built on. For those packages the original source
is permanently the wrong input and section E is the only answer. Saying so early
is cheaper than discovering it per package.

## E. `libraries/` — the ports lane

**Why fifth, and why not last.** It is the only route that covers the 87% of
packages with nothing to recover, and it is the route this project has already
proven at scale on somebody else's API surface.

The playbook is `runtime/node`'s, unchanged:

- **The contract is the package's own published `.d.ts`.** Surface equality
  against it is a check that can run, not a promise.
- **The oracle is the package's own test suite.** `tooling/conformance/check.sh`
  applies an upstream suite to a compiled artifact; the same shape applies here.
  Matching a `.d.ts` proves nothing about behaviour, and this is the thing that
  does.
- **Faithful, not adapted.** The rule that stopped the node port from rewriting
  `break` into a flag applies exactly: a port that dodges a refusal stops
  measuring what is missing.
- **Each native operation is one `declare function`.**

**Checkable condition.** One package in `libraries/` passing that package's own
upstream test suite as a compiled artifact.

## F. Reproducibility

Record the npm artifact identity and the source identity separately, plus the
recipe version and any patch hashes. A lockfile that pins a tarball has not
pinned a source tree extracted from a source map, and a build that cannot say
which of the two it compiled cannot be reproduced.

Not urgent, and cheap to get wrong in a way that is expensive later, so the lock
format lands with C rather than after it.

---

## What success looks like, and what it does not

The honest ceiling on section C alone is 26 packages in 458, and lower after
refusals. **A plan that spends its year on source acquisition is a plan to
compile 5% of a dependency graph.** The routes are worth building because they
are cheap and because the packages they reach are real; they are not worth
building elaborately.

The number that decides whether this direction works is not "how many packages
can be fetched". It is section C's: how many compile when driven from the
imports an application actually writes — because that is the only measurement
that has the used-slice effect and the per-function refusal behaviour in it, and
both of them cut in this project's favour.

---


# What is built already

**Steps 1, 3, 4 and 5 of the goal are done; step 2 is the main lane's.** `tooling/deps` (`nts deps`) acquires,
and `project()` in the CLI acquires before returning a config — so every command
that builds a program does it, and there is no second command to know about.
Resolution comes from tsgo rather than from an `exports` walk of our own.

    $ nts check packages/app/tsconfig.json      # nothing else was run

    4 of 4 dependencies acquired

      @demo/lib  1.0.0      workspace source, in place
      lru-cache  11.5.2     source map, 3 files
      mitt       3.0.1      source map, 1 file
      zod        4.5.4      shipped TypeScript, 96 files

    checked 29 cases across 1 function(s)
    agreed on every case

37 tests, workspace clippy clean, ~35 ms for the whole monorepo, idempotent.

**Monorepos were broken in the most basic way and are the largest thing this
fixed.** `packages/app` importing `packages/lib` resolves through a
`node_modules` symlink, so the frontend dropped it as external and the
developer's own TypeScript refused with `a builtin this compiler does not
provide`. One generated `paths` entry turns that into `agreed on every case`.

## What asking tsgo changed

The counts above are the same demo as before the change, and three of them moved:

| | manifest walk | asking tsgo |
|---|---:|---:|
| dependencies reported | 6 | **4** |
| `zod` files vendored | 123 | **96** |
| `zod` specifiers mapped | 11, patterns skipped | **`zod/v4`, exactly** |

`6` became `4` because `cookie` and `ms` are *declared* and never imported: the
unit is now what the program uses rather than what the manifest offers. `123`
became `96` for the same reason one subpath's imports are not the whole package.
And `zod/v4/locales/*` stopped being a pattern nobody could expand — a checker
expands it, and only the file it expanded to is observed.

The `exports`-ranking code this replaced is the code that mapped `lru-cache` at
`diagnostics-channel-browser.ts`. It survives only as a fallback for a checkout
with no built tsgo, where the report says it is degraded.

## Four things building it taught, all of them corrections

**A composite project rejects a file it reached only by import.** `include` is
irrelevant to imported files — that is why the generated config does not restate
it — but `composite: true` turns that into `TS6307`, and projects inherit
`composite` from a shared base all the time. The generated config now switches
the whole emit group off, the way `runtime/node/tsconfig.module.json` already
did for the same reason. `emitDeclarationOnly` has to move with `noEmit`,
because the two cannot both be set.

**`baseUrl` was removed in TypeScript 7.** Emitting one is an error. Without it
`paths` resolve relative to the config that declares them, which is what they
were written for anyway.

**Acquisition has to reach a fixpoint.** Resolution is taken from the program as
it stands, and the program as it stands does not contain source that has not
been acquired yet — so a dependency's *own* dependencies are invisible on the
first pass. Passes accumulate rather than re-derive: the second pass traces the
generated config, where an already-acquired specifier resolves into the vendor
tree, and reading that as a *new* discovery made one build report every vendored
package as workspace source and then prune the tree it had just written.

**A `..` that is not folded away is a combinatorial explosion.** `Utf8PathBuf::join`
keeps them, so `src/a/../b.ts` and `src/b.ts` were different keys for one file
and the module walk revisited it once per path that reached it. `zod` took 90
seconds and finished in 16 ms after normalising.

## Acquired and buildable are different claims

The report makes both. The pass that answers "where did this specifier go" is a
typecheck, so its complaints were already being thrown away; they are kept now,
attributed to the package whose recovered source they are about, and grouped by
error code — forty instances of `Cannot find name 'process'` are one fact about
a package's build environment rather than forty facts.

    lru-cache  11.5.2   source map, 3 files
        4 × TS2339: Property 'unref' does not exist on type 'number'.
        3 × TS2552: Cannot find name 'process'. Did you mean 'PROCESS'?

Only the vendor tree is reported. An error in the developer's own code is theirs
and was there before acquisition — 23 of the corpus's, before and after.

## What it does not do yet

**Step 2**, which is in `compiler/core/src/hir` — and that tree is not this
lane's to edit. The change is written, tested and handed to the main lane, who
own it.

**It needs no schema bump, and the claim that it did was wrong.** The lowerer
cannot tell a `lib.d.ts` builtin from a name whose package was excluded *by
looking at the declaration* — but it does not have to, because the schema
already distinguishes them from the other side of the import.
`SymbolRecord::declarations` says so itself:

> Empty for a symbol declared outside the decoded file set, which is honest:
> there is no node to point at.

A builtin has none. An imported name declares at its **import specifier**, which
is decoded because the program wrote it, and walking its `parent` chain reaches
the `ImportDeclaration` in five hops.

    `pad`, an imported name whose implementation is not in this program
    `parseFloat`, a builtin this compiler does not provide

Verified while it was applied: 133 examples byte-identical to the pre-patch run,
and the 22-module node profile unchanged — its 15 `builtin` refusals are all
genuine `lib.d.ts` globals with no import to blame, and all keep the old wording.

Two details worth keeping if it lands. The diagnostic's location must stay on
the **call**: pointing at the import reads better and attributes the failure to
a node outside the walked function, which costs the *caller* its own diagnostic.
And the second test is not redundant — "never say builtin" would otherwise pass
by never saying it.

One thing the message still cannot do is name the package inline. A module
specifier's `text` is `None`, because a string literal's text lives in the
extended section of the wire format and `ast.rs` decodes that only for template
literals. The main lane has taken that separately. `nts deps` names the package
two lines above the refusal meanwhile.

**The half that is done here:** `nts deps` names the specifiers a program
imports from each package it could not acquire, so a reader can connect the
refusal to its cause before the lowerer does it for them.

Two things the measurements say are not worth doing, recorded so they are not
rediscovered as ideas:

- **A `postinstall` hook.** Recovery never touches the network, so there is
  nothing to warm. See above.
- **Supplying ambients.** They are host globals; see step 4.

# The goal

Copy from here.

> ## Goal: acquire the TypeScript behind npm dependencies, with great DX
>
> The compiler's reach is somebody else's moving target; do not chase it. This
> goal is about **getting the source in front of the compiler**, and saying
> precisely what could not be got. `docs/npm-deps.md` has the measurements and
> `docs/npm-deps-plan.md` the reasoning; `tooling/deps` is the working start.
>
> **The experience being built, which is the whole specification:**
>
>     pnpm install
>     nts build            # acquires what it needs, says what it cannot take
>
> No third command. The project's `tsconfig.json`, `package.json` and
> `node_modules` are read and never written — `nts check` compares a compiled
> program against node running the same TypeScript, so the program has to keep
> resolving its dependencies the ordinary way. Break that and the oracle goes
> with it, and the editor too.
>
> **Work in this order. Each step's condition is checkable.**
>
> 1. **Make it automatic.** Acquisition is a subcommand today, so a developer
>    has to know to run it. Move it into the build path: check the lock, acquire
>    what is missing, then compile. Keyed on `node_modules` so an unchanged tree
>    does no work and writes no files. A `postinstall` may warm the cache
>    earlier, but must never be what makes a build correct — `--ignore-scripts`
>    is ordinary in CI and should cost latency, not correctness. No
>    `.pnpmfile.cjs` or other package-manager-specific hook on the primary path.
>    *Done when: a fresh clone runs `pnpm install && nts build` and compiles,
>    having typed no other command.*
>
> 2. **Fix the diagnostic at the boundary — but not from this lane.** A package
>    that could not be acquired still refuses as ``NTS1001 `x`, a builtin this
>    compiler does not provide``, which sends its reader to `hir::builtin` where
>    nothing is missing. It must say the implementation is not in the program.
>
>    **This lives in `compiler/core/src/hir`, and this lane does not edit
>    `compiler/**` or `runtime/**` — at all.** That is a standing instruction and
>    it outranks this step. The work that *is* this lane's is making the change
>    cheap for the lane that owns it, and that is done: a minimal repro, the
>    route through the existing snapshot data, an anchored patch, two tests, and
>    the verification already run — 133 examples byte-identical to the pre-patch
>    tree, and the 22-module node profile unchanged. It is with the main lane.
>
>    *Done for this lane when: the change is handed over verified, and this
>    document records whether it was taken.* **Status: handed over; the main
>    lane's to land or decline.**
>
>    The half that does not need their tree is already in: `nts deps` names the
>    package, the reason it could not be acquired, and the specifiers the program
>    imports from it — two lines above the refusal, in the same output.
>
> 3. **Stop resolving bare specifiers, and ask tsgo where they went.** This is
>    the largest single improvement available and it replaces three separate
>    gaps with one better mechanism.
>
>    `tooling/deps` currently reimplements part of npm's `exports` resolution,
>    and that is its weakest code: object key order is lost by the JSON parser,
>    so conditions are *ranked* by a cost table rather than matched in order,
>    and that already produced one wrong answer — `lru-cache` mapped at
>    `diagnostics-channel-browser.ts`, a real file and not the one the specifier
>    means. Meanwhile `imports`/`#internal` specifiers, self-reference and
>    `exports: null` denial are not handled at all.
>
>    None of that needs a second resolver — not `oxc_resolver`, not a
>    hand-written one. **tsgo already resolves every specifier, and its answer
>    is the only one that binds**, because tsgo builds the program the compiler
>    compiles. A second resolver would have to be kept in agreement with it,
>    with no way to adjudicate a disagreement. Ask the authority instead:
>    `--listFiles` gives every file in the program and `--traceResolution` gives
>    specifier → file, both on a binary already shipped. Take every resolved
>    file that landed under `node_modules`, and recover the source behind *that*.
>
>    It comes free with several things below and above it: **two versions of one
>    package stop collapsing** (resolution is per-importer, where
>    `resolve::closure` keys by name and lets the first version win);
>    **subpath patterns stop needing expansion** (`zod/v4/locales/*` is expanded
>    by the resolver, and only the resolved file is observed — no inference that
>    `dist/x.js` came from `src/x.ts`); and the report gains the **used slice**,
>    which is the number section B wanted and no instrument can currently see.
>
>    Keep the relative-import walker in `recover.rs`. Which files to *copy* has
>    to be decided before they exist for tsgo to look at, and relative
>    specifiers plus TypeScript's extension substitution is the easy part of
>    resolution. There is no bootstrap problem for the rest: an un-acquired
>    program typechecks fine, because its types come from `.d.ts`.
>
>    The cost is one tsgo snapshot before acquisition (~170 ms, and cached).
>    `nts build` runs one anyway.
>
> 4. **Close what is left.**
>
>    - ~~**Ambient types travel with the source and are not acquired.**~~
>      **Decided: report, never supply.** 63 of a corpus's 212 remaining
>      problems are an ambient the package's own build had — `process`,
>      `Buffer`, a namespace — and `nts deps` now names them per package with
>      the checker's own message. Acquisition will not add `types` for the
>      developer, and the reason is not tidiness: these are *host globals*, and
>      a program compiled to a native target may not have them. Source that
>      needs `process` is source with a requirement, and satisfying it silently
>      in a generated config would hide the requirement at exactly the moment it
>      became relevant.
>    - **`map-incomplete` is 21 of 458** — a map with `null` holes in
>      `sourcesContent`. Currently refused, correctly. A pinned repository
>      checkout is the only route that reaches these, and it is a per-package
>      recipe with a human in it, not an automatic tier: `gitHead` is present for
>      2% of packages and provenance for 12%.
>
> 5. **Measure acquisition on real projects, and publish the number.** The
>    survey's 26-of-458 was measured package-by-package from tarballs. The
>    number that matters is per *project*: point `nts deps` at real repositories
>    and report what fraction of each one's dependencies it can hand the
>    compiler. Replace `tooling/npm-survey` as the source of every npm number in
>    the tree once it can.
>
> **Rules.**
>
> - **Never execute dependency code.** Installed files and registry metadata are
>   read as data; no dependency lifecycle script runs as part of acquisition.
>   The project's own `postinstall` in step 1 is a different thing — the
>   developer's script, in the developer's project, warming a cache.
> - **Never modify what the developer owns.** Generated files are
>   `<workspace>/.nts/` and `<project>/tsconfig.nts.json`. Nothing else.
> - **Report, never degrade.** There is no JavaScript fallback and there is not
>   going to be one. A dependency that cannot be acquired is a named line in a
>   report, not a silent substitution — and a *partial* recovery is a failure,
>   not a partial success: half a module graph is not a package.
> - **Do not build a second resolver.** TypeScript resolves the program this
>   compiler compiles, so its answer is the only one that binds. Anything that
>   resolves bare specifiers independently — `oxc_resolver`, or the `exports`
>   handling in `manifest.rs` today — has to be kept in agreement with tsgo, and
>   a disagreement has no adjudicator. Ask tsgo.
> - **Never guess which source a specifier means.** Recovering the files and
>   knowing which one the entry is are two questions, and only the first is
>   always answerable. `lru-cache` bundles three sources and taking the first
>   mapped its main specifier at a file it does not mean. Where it is not
>   knowable, say so.
> - **Do not chase lowering refusals.** If a package acquires and then refuses to
>   compile, that is a data point for `docs/conformance/typescript.md` §15 and
>   somebody else's queue. Record it and move on.
> - Do not touch `runtime/`, `compiler/codegen/`, or the JVM and web-platform
>   lanes — other sessions own those.
> - Do not run `cargo fmt`. Check clippy locally before the gate. Pass `NTS_BIN`
>   so the gate does not measure someone else's binary.
>
> **One thing to hand off rather than fix.** The snapshot cache in
> `compiler/frontend-ts/src/cache.rs` does not key on the tsconfig: with a
> regenerated `tsconfig.nts.json` it returned a snapshot built from the previous
> one, reporting `TS6059` against a `rootDir` the config no longer had.
> `NTS_NO_SNAPSHOT_CACHE=1` works around it. This matters more now that a config
> is generated on every build, and the file belongs to the frontend lane.
