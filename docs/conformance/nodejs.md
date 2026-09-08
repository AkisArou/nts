# Node API conformance

What is implemented, what node's own tests say about it, and what stops it
compiling.

Companion to [`typescript.md`](typescript.md), which tracks the language and the
runtime under it. This file is the `node:*` surface built on top, and
[`nodejs-plan.md`](nodejs-plan.md) is what to do about what it says.

## Two axes, and they move independently

A module here has two separate states, and conflating them hides the interesting
half:

- **Conformance** — does it pass node's own test suite? Measured by running
  `third_party/node/test/parallel/test-<module>*.js` against our implementation.
  This is a statement about the *implementation*.
- **Compiles** — does `nts` lower it? This is a statement about the *compiler*,
  and it is expected to lag.

They are independent because our TypeScript runs on node directly: node strips
the types and executes what is left, so a module can be finished, verified
against node's suite, and still refuse to compile for months. That is the
intended order. Writing a module to fit today's compiler would mean writing
something that is not node's algorithm, and unwinding those distortions later
costs more than waiting.

## The seam: what node handles in one place and this profile handles in many

Twenty-two tests were written on 2026-09-08 by one method, and it is worth
stating because it is repeatable and it is not exhausted.

**Pick something node handles uniformly, in one piece of C++, and ask whether
this profile — which handles it at many call sites — agrees.** Node's own suite
cannot cover the variation, because upstream there is one implementation and no
assertion could fail. Here there are many, and they disagree independently.

Every module now carries at least one such test. The score:

    real defects fixed         24 `fs` functions rejecting a Buffer path
                               83 error classes with an own key node lacks
                                7 `zlib` signatures with the wrong C type
                                1 wrong error code (`readFile` + `"buffer"`)
                                1 `fs` error carrying a path node omits
    §13 decisions asserted      6, each checked against §13 rather than assumed
                                  from a source comment
    divergences recorded but    2 — the timer/immediate order, which is unstable
      deliberately unasserted       here; and `Error.prototype` identity, which
                                    needs an unchecked assertion to reach
    surveys that found nothing  9
    harness bugs, all mine      6, every one in *normalisation* rather than in
                                  the comparison, and one of them a false *pass*

**The nine that found nothing are not filler.** A survey is worth the same either
way provided it could have failed, and each is built so a plausible
mis-implementation does: `readline` splits the same CRLF across two chunks *and
across three*, because a buffer that handles two can still lose the middle one.

### How to run it

1. Pick a variation. Confirm it is under-tested upstream — `grep -l "encoding:
   'buffer'" third_party/node/test/parallel/test-fs-*.js` returned **3 of 260**.
2. Write a survey and **run it against node first**, capturing the oracle's
   answers.
3. Run the same survey through `run.mjs --module <m>`. Write results to a file in
   the scratchpad; the harness swallows stdout and mangles an async throw.
4. Diff. Then keep it as a test whose expected values are **node's answers**.

The rules that fell out are in the sections below: a test may assert what node
does or a decision §13 declares, never what this implementation happens to do;
a divergence that is unstable is recorded rather than pinned; and the list of
things the interpreted lane structurally cannot see is a **predicate to check
before filing**, not a caveat to add afterwards.

## Which modules, and which not

This file says "twenty-two modules" throughout and has never said which
twenty-two, or why not the others. That omission flatters every number in it:
"every module passes" is a much smaller claim than it sounds when the set of
modules is itself the thing being chosen.

**Node ships 46 public modules. This profile implements 22.**

    assert  async_hooks  buffer  console  dgram  diagnostics_channel  events
    fs  http  net  os  path  process  punycode  querystring  readline
    stream  string_decoder  timers  url  util  zlib

The other 24, with the reason and what each costs in pinned tests — the count
is `test/parallel` files named for that module, which is the coverage this
profile does not even attempt:

| module | tests | why not |
| --- | ---: | --- |
| `http2` | 277 | A second protocol implementation — HPACK, stream multiplexing, settings — and h2 over TLS needs `tls`. |
| `quic` | 245 | Needs TLS 1.3 and a UDP transport. Experimental in node itself. |
| `tls` | 220 | Needs a TLS provider. There is no crypto in this profile. |
| `worker_threads` | 144 | Needs a second isolate and thread. |
| `crypto` | 128 | Needs a crypto provider: ciphers, hashes, key handling. |
| `child_process` | 112 | Phase two in `docs/node-js.md`, not started. Needs process spawning and IPC. |
| `repl` | 101 | A developer tool rather than a runtime API; needs `vm` and the module loader. |
| `vm` | 97 | Needs engine-level compilation and realm control. |
| `cluster` | 83 | Needs `child_process` plus handle sharing between processes. |
| `test` | 81 | Node's own test runner. A tool, and this profile is measured *by* a runner rather than shipping one. |
| `inspector` | 74 | Needs the V8 inspector protocol. |
| `https` | 67 | `http` over `tls`. Blocked entirely on `tls`. |
| `domain` | 50 | Deprecated since v1 and discouraged by node. |
| `module` | 32 | The loader itself. This profile substitutes modules rather than resolving them. |
| `dns` | 30 | Phase two, not started. Name resolution exists as a `net` binding, so the capability is present without the module. |
| `trace_events` | 29 | Needs the V8 tracing controller. |
| `v8` | 23 | Engine introspection: heap statistics, serialization, coverage. |
| `sqlite` | 17 | An embedded database; needs a native library. |
| `perf_hooks` | 15 | Needs the engine's performance timeline. |
| `tty` | 3 | Phase two, not started. `process.stdin`/`stdout` carry `isTTY` without it. |
| `sea` | 2 | Single-executable packaging. A build feature, not a runtime API. |
| `constants` | 0 | Deprecated. Its values live on `os` and `fs`, which this profile has. |
| `sys` | 0 | Deprecated three-line alias for `util`. |
| `wasi` | 0 | WebAssembly system interface; there is no wasm here. |

**So the honest denominator is this.** `test/parallel` holds 4,494 files.
About 1,830 are named for a module in the table above and are not attempted at
all. This profile claims 2,192 of the rest — 1,772 passing and 420 excluded by
name — and the remainder belong to subsystems that are not modules (the ESM
loader, snapshots, startup, the debugger).

Read that way, "1,772 of 1,772, every module green" means: *of the twenty-two
modules chosen, and of the files in each that were judged applicable, all
pass*. Two of those three qualifiers are choices this project made, and the
number is only as good as they are. The exclusions are individually named and
auditable, which is what the next section is about; **the module set is the
qualifier with no audit at all**, and this table is the beginning of one.

## How to check any of this

```sh
tooling/conformance/check.sh path --ts    # node's tests, TypeScript on node
tooling/conformance/check.sh path         # node's tests, compiled .node addon
nts hir runtime/node/path/tsconfig.json   # what the compiler refuses
tsc -p runtime/node/tsconfig.json         # types, across the whole profile
```

**And the two axes can pull against each other, which took until now to
measure.** Adding node's argument validation to `node:buffer` -- the work that
took its test count from 18 to 26 -- cost `node:fs` **ten lowered functions**,
because node's validators take `unknown` and `unknown` does not lower. `fs`
imports `buffer`, so a signature changed in one module removed functions from
another that was not touched.

It was found by accident: a compiler change prompted a re-measure, `fs` moved
the wrong way while twelve modules moved the right way, and isolating it needed
the old source compiled by the new compiler. Attributing a compiler change
across a source change measures neither, which is a mistake this file has made
before under a different name.

`sweep.mjs --compiles` reports both axes per module for that reason. It is off
by default because it is slow, and it is the only thing here that can see a
conformance change costing lowered functions -- node's tests do not care
whether a function lowered.

`check.sh` without `--ts` builds a Node-API addon and runs node's tests against
the compiled artifact. That is the gate. `--ts` is the interim gate for a module
that does not compile yet, and the two together tell a compiler bug from an
implementation bug: fails compiled, passes on node, is a compiler bug.

**A module system is a hidden parameter of every ordering assertion.** Node
runs `test/parallel` as CommonJS, where a test body is a plain host task and
the checkpoint starts empty: `process.nextTick` first, then microtasks. An ES
module's evaluation *is* a microtask job, so a body that starts mid-drain sees
its own top-level microtasks resolve before its own top-level ticks — the
reverse order, for correct code.

This harness was supplying the wrong one. Everything before the test body is
`await`ed, so the body ran inside a microtask continuation:

```
node, CommonJS      tick -> microtask -> tick-from-microtask -> immediate -> timer
here, before this   microtask -> tick -> tick-from-microtask -> immediate -> timer
```

The body now runs from a fresh macrotask and the two traces are identical. It
moved one file, and the file it moved was a second finding: `punycode` warns
about its own deprecation *at load time*, and this harness must import before
the test body because imports are asynchronous — so the warning fired before
the test could listen for it. Node loads a module when the test calls
`require`, so load-time warnings are now held and re-emitted at that call,
which puts the observable event back where node has it.

A third command, and the one to run before believing any of the numbers below:

```sh
node tooling/conformance/run.mjs --module <name> --sabotage
```

It hands every test an empty object instead of our module. Whatever still
passes was never measuring us. See *hollow* in the table.

**A test suite is judged when the loop is empty, not after a fixed number of
turns.** This runner used to give each file three turns of the loop and then
check its `mustCall` tallies. Node checks its own from `process.on('exit')` --
that is, once there is nothing left to run -- and three turns is not the same
thing. `setTimeout(common.mustCall(), 10)` had about a millisecond to fire and
was reported as a callback that never ran.

It waits for `beforeExit` now, and for the *right* `beforeExit`: the event can
fire more than once, because a listener is allowed to schedule more work and
node re-emits each time the loop drains again. `test-process-beforeexit.js`
chains four rounds through an immediate, a timer and a socket. So the runner
leaves on the first round where nothing is outstanding, and waits for another
if an expectation is unmet.

Which needed two more things. The wait cannot be an `await` in the main flow:
if the loop ends while that promise is pending, node exits with its "unsettled
top-level await" status and the parent reads an exit code instead of the report
the runner wrote. And a test can leave the wait pending forever -- unmet
expectation, no further round -- so there is a `process.on('exit')` handler
that reports if nothing else has. Node judges from an exit handler for exactly
that reason: it is the one moment that always arrives.

That fix immediately needed a second one. Draining afterwards with
`setImmediate` *turns the loop*, and a turn after the loop has gone quiet runs
exactly the work that was supposed to have been abandoned:
`setImmediate(common.mustNotCall()).unref()` called its callback. The drain
afterwards is ticks and microtasks only, which deliver a pending warning
without giving the loop another turn. Both of these were the runner
manufacturing the behaviour it was measuring, in opposite directions.

**The pass count and the hollow count can point in opposite directions, and
when they do the hollow count is right.** `buffer/shape.mjs` installs our
`Buffer` as a global, under a comment that said it did not — the comment had
been wrong about the code for some time. Measured: removing the installation
takes `buffer` from **33 files passing to 54**. Twenty-one files, for deleting
three lines that contradicted their own comment.

Forty-six of those 54 are hollow. Without the global, a test writing
`Buffer.alloc(...)` unqualified gets *node's* `Buffer` and never touches ours;
it passes and measures nothing. Real coverage is 32 with the global and 8
without — **the higher number is the worse measurement by a factor of four.**

Worth stating plainly because every part of it looked right: a number went up,
by a lot, for a change with a written rationale, and it was a large regression.
Nothing except the sabotage run could have distinguished the two.

**A module that owns uncaught-exception dispatch gets first refusal.** Node's
runtime hands an escaped exception to `process`, which runs a capture callback
or emits `uncaughtException`, and a program with either carries on. A runner
that caught it and reported a failure would fail every such test for the one
reason the test is about. Only a module whose `shape.mjs` declares the hook can
claim an exception; for everything else an escaped exception is exactly the
failure it looks like.

**Two differential fuzzers, for the two places reading the source was not
enough.**

```sh
node tooling/conformance/fuzz-deep-equal.mjs   # comparison relations
node tooling/conformance/fuzz-timer-order.mjs  # scheduling order
```

The timer one generates random trees of timeouts, intervals, immediates, ticks
and microtasks, runs each under node and under ours, and compares the order
things ran in. Programs where node disagrees with *itself* are discarded --
`setImmediate` against `setTimeout(0)` at the top level is genuinely
unspecified, and reporting it would be reporting node's nondeterminism as our
bug.

Both fuzzers were sabotage-tested, and the timer one failed that test twice
before it was worth anything. Its first generator cleared every interval on the
first tick, so the reinsertion path -- the whole of what makes a repeating
timer repeat -- was never reached, and breaking it changed nothing. Its first
determinism filter ran each program twice, which the same seed disproved by
reporting zero differences on one invocation and three on the next. Five runs
now, and the two properties fight: the programs sensitive enough to expose a
re-arm bug are the racy ones the filter most wants to drop, so that sabotage is
caught on two seeds in six rather than on all of them. Run several.

**The harness had promises of its own, and no module could see them until one
could watch promises.** Two: the test body was wrapped in `await new
Promise(...)`, so a promise continuation ran immediately after every file, and
`drain` stepped through microtasks with `Promise.resolve().then(...)`, which is
one microtask either way but allocates a promise on the way. An `async_hooks`
test with a `before` hook failed on a callback it never scheduled; another
counted the harness's promise as its own. Node runs `test/parallel` as
CommonJS with nothing of its own outstanding, so neither promise exists there.
The body now runs with nothing awaiting it and the drain uses
`queueMicrotask`. This is the same finding as the module-system one above, one
level deeper: **the harness is a hidden parameter of any assertion about what
ran.**

**A sibling module that owns globals has to install them.** Modules name their
dependencies in a `uses` file, and those were being made available to
`require` but not installed as globals. An `async_hooks` test calling
`setImmediate` reached *node's* timers and its result was reported as ours. The
sabotage run cannot catch this class at all — it blanks our module, and node's
globals were never ours to blank.

**An allow-list that silently drops a flag turns "this test needs a
capability" into "this test fails".** Node's tests declare flags in a
`// Flags:` line, and four of them write `--expose_gc` where the allow-list had
only `--expose-gc`. V8 takes either spelling and node's own harness passes the
line through untouched. Those four failed on `globalThis.gc is not a function`,
which is a statement about how they were run rather than about the module.
Same disease as a no-op `unref`: a fact about the instrument wearing the
costume of a fact about the code.

**The binary can change underneath a measurement that takes two hours.** This
tree is shared with the session that works on the compiler, and `target/release`
is shared with it too. A full sweep of both axes takes about two hours; a
compiler commit landed and was rebuilt in the middle of one, so modules measured
before it used one compiler and modules measured after it used another. The
resulting `compiles` column was a mixture and has been discarded. Nothing about
it looked wrong.

It was caught only because three runs of the same runtime commit reported 1,309,
1,320 and 1,323 lowered functions with `git diff HEAD` empty. What the wrong
answers cost, in order: three more runs to establish it was not
nondeterministic; a per-module diff, which showed only `buffer` +1 and `fs` +2
with their refused counts falling by the same amount; moving the newly added
files out of the tree to rule them out; and checking `fs` for the
type-decomposition budget diagnostic — after checking the string was in the
binary at all, so that its absence meant something. Then `stat` on
`target/release/nts`, which said 10:04 against the 05:18 recorded earlier.

So the rule for the `compiles` column is now: **`stat` the binary before and
after the run, and discard the run if the mtime moved.** The test column does
not need it, because node's tests run TypeScript on node and never touch `nts`.
This is the same disease as a stale binary reporting no change from changes that
have landed, and the same as a diagnostic counted out of a tool that never ran:
an instrument that was not what it was assumed to be, reporting confidently.

## Modules

Counts are `passed / applicable`. Two kinds of file are outside that.

A test that spawns a real `node` child asserts on node's binary, which our
module is not in; there is no way to install ourselves into a process we did
not start. Each of those is listed with a reason in the module's
`not-applicable` file rather than inferred by a rule, so the number can be
audited.

**An exclusion reason is a claim with no test on it, so the temporary ones were
re-run.** Thirty-seven entries name a gap they expect to close — a worker
runtime, resizable `ArrayBuffer`s, `SharedArrayBuffer`, kind tags, a normalized
startup option. Every one of those is a prediction about a future that may
already have arrived, and the compiler lane found a *refusal* message this
morning whose stated cause had gone false weeks earlier. The same disease has
the same cure: run them.

Re-measured: `test-buffer-resizable.js`, `test-buffer-sharedarraybuffer.js`,
`test-buffer-pool-untransferable.js` and `test-net-transfer-guards.js` still
fail, and `test-util-types.js` still skips, each for the reason its entry
gives. The eight harness-attributed exclusions were checked the same way
earlier and also still hold.

**The file set each module measures was audited for the obvious way to lose
tests silently**: three modules are named with underscores while node names
their tests with hyphens. `string_decoder` matches
`^test-string-decoder(-.*)?` and `async_hooks` carries a second alternation for
`test-async-local-storage-*`; neither loses a file to its own name.

**That audit missed two files, and the miss is worth recording.** It said
`diagnostics_channel` found all 57 of node's files, which was true of the 57 it
went looking for. Node also ships
`test-diagnostic-channel-http-request-created.js` and
`test-diagnostic-channel-http-response-created.js` — *diagnostic*, singular —
and the module's pattern required the plural. Those two applicable pinned files
matched no module's pattern anywhere, so no run reported them: not as failures,
not as skips, not in any denominator. The pattern is now
`^test-diagnostics?-channel(-.*)?`, both files run, and both pass. A test that
matches nothing is the one kind of missing coverage a green sweep cannot show,
which is the argument for auditing a pattern against node's directory rather
than against the pattern's own output.

**No exclusion has gone stale, and no module is silently missing tests.** Both
halves are worth stating as measured results rather than left as assumptions —
together they are the claim that keeps the denominators honest, and until now
neither had been tested.

**A third audit exists now, because the same failure got into the checker.**
The baseline command in this lane is

    pnpm exec tsc --project runtime/node/tsconfig.json

and that config carries `"references": [{ "path": "../web-platform" }]`. A
TypeScript project reference resolves through the referenced project's **built
declarations**, not its source. So when `utf8Decode` left
`web-platform/src/core/utf8.ts`, the declaration file in its `.tsbuild/dist`
still declared it — built 18:09, source edited 19:51 — and the aggregate
typecheck read an artifact an hour and three quarters stale and reported green.

At that moment **thirteen of the twenty-two modules did not typecheck** against
their own configs, and `buffer` was **0 of 51**: every file failing to load on
an export that was not there. A per-module config carries no reference and
resolves `web-platform` through source, so it fails immediately.

The breakage was another lane's work in flight and was restored within minutes
of being reported — `utf8Decode` is back, with a comment naming this lane as
its consumer. What remains is the audit: `audit.mjs --typecheck` runs all 22
module configs and now reports 22 of 22, which is the first time that number
has been measured rather than assumed. **A green check over an artifact nobody
rebuilt is the same shape as a passing test that asserts nothing**, and this
document had been quoting that green number all day.

A wider version of the second audit — *which node tests require this module but
are not in its set* — is not worth running. 3,868 files `require('assert')`,
because nearly every test in node's suite does, and requiring a module is not
testing it.

**One surface in this profile is not ours and is recorded rather than
excluded.** `http/src/main.ts` exports `WebSocket`, `CloseEvent` and
`MessageEvent` by reading them off `globalThis`. Node exposes all three from
`node:http`, so exporting them is right; reading them from the host is not.

Two corrections to how this was first written here. **No test in node's suite
reaches them through `node:http`** — checked — so the `http` row is not
inflated by it and calling it a hollow *pass* overstated the case. What it is
is an untested surface that would be hollow if anything touched it.

And the fidelity gap is sharper than "reads a global". Node defines all three
as **lazy getters** that load from undici on first access
(`lib/http.js:232`, `ObjectDefineProperty(module.exports, 'WebSocket', { get()
{ return lazyUndici().WebSocket } })`). Ours are eager `export const`
bindings. So the difference is observable in the property descriptor and in
when the dependency loads, independently of which implementation is behind
it. The canonical versions live in `runtime/web-platform`, and the seam to
import them already works — `url/src/parser.ts` imports the percent decoder
across it. What is unresolved is whether the canonical `WebSocket` can be
constructed without an environment, since it obtains its transport from one and
`node:http` has none. Re-exporting a class that throws on construction would be
worse than the global, so this stays recorded and wrong rather than quietly
changed.

A test that *skips* is one that asked for something we do not have — an
internal module, a helper, a platform feature — and said so. The runner prints
the reason for every skip, so they can be read rather than assumed. Neither is
counted as a pass or a failure, which is what `sweep.mjs` reports and what the
rows below are.

**1,803 applicable test files pass** across twenty-two modules,
**of which 0 are hollow, and none fail.** Every module is green. That last
sentence has not been true before, and the paragraph below records what the
final one cost, because "all green" is the claim most worth distrusting in this
document.

The whole table comes from a single `sweep.mjs` run over the tree this tranche
commits, with sabotage on. It is one run rather than two anchored separately,
which is the first time that has been true here.

**The sweep is not quite deterministic, and the file is now named.** It printed
a total one lower than the truth four times over this document's life, always
with `util` at 19/20. The standing advice here was to re-run, which produced a
matching number every time and taught nothing. Running `util` six times in
isolation instead produced the failure twice, and named it:
**`test-util-inspect-long-running.js`**, with `Maximum call stack size exceeded`
inside `formatWithKeys`.

The test builds a thousand-deep structure and calls
`util.inspect(obj, { depth: Infinity })`, existing precisely to check that a
huge object does not crash. Our formatter spends more stack frames per level of
structure than node's — `formatValue` → `formatObject` → `formatByShape` →
`formatWithKeys` → `formatProperty` → `formatValue` — so a thousand levels
costs several thousand frames, and whether that fits depends on how much stack
the caller has already used. Under a sweep it usually does; under a loaded
machine it sometimes does not. **Load-dependent, not random**, and the fix is
fewer frames per level rather than more stack.

That resolution is the point of the entry. An intermittently failing test is a
hollow test's opposite number — it reports a defect that is not there — and
"measure it again" is the habit that would let a real intermittent regression
be re-rolled away. Four re-runs produced four clean numbers and no
understanding; one deliberate attempt to reproduce produced the cause. **Re-run
to check a number, reproduce to learn anything.**

**Then it was made deterministic, which turned it into a control.** An
intermittent failure cannot be used to judge a fix; a threshold can. Bisecting
`node --stack-size=<n> run-one.mjs util test-util-inspect-long-running.js`:

    984  pass          <- node's own default is about this
    900  Maximum call stack
    850  Maximum call stack
    600  fail (a different, real failure)

So the test needed about 950KB of a 984KB stack — **three and a half percent of
headroom**, which is why a loaded machine tipped it over and an idle one never
did.

`formatProperty` had exactly one caller and sat on the recursion path, so every
level of structure paid for a frame that existed for readability. Inlining it
moves the threshold to between 850 and 900: **about eight percent**, measured
the same way. Two controls say it changed stack usage and not behaviour — the
`inspect` census is unchanged at 38 of 61 kinds, and `util` is 20/20 over six
isolated runs and a full sweep.

**The gap that remains is larger than the one that was closed, and is worth
writing down rather than implying it is fixed.** Node renders the same object in
under **100KB** of stack; this profile needs about **875KB**. The obvious
explanation — that node cuts the traverse off earlier — is wrong, and was
checked rather than assumed: node's output for that object measures **1002
levels of nesting and 135MB**, with the same `2 ** 27` budget cut-off firing and
the same `[Object]` markers in it. Node performs the identical traverse. The
whole difference is frame *size*: roughly 100 bytes per level against our 875.

One tempting explanation was also eliminated. Our recursion path wraps its
recursive call in `try/finally` to restore `indentationLvl` and pop `ctx.seen`,
and node's `formatRaw` — read, not remembered — wraps its own recursive call in
`try/catch` for the same reason. It is not the handler. What is left is register
pressure across four functions on the recursion path, which is a V8 tuning
exercise on the green axis, and the compiled axis is the product. Recorded as a
named residual rather than carried as a mystery.

**The previous revision of this section was wrong by about a thousand files, in
the flattering direction.** It read 766 passing of 1,462 applicable with 22
hollow. The modules had moved a long way past it -- `fs` from 72/214 to 328/328,
`stream` from 151/195 to 241/241, `net` from 50/139, `zlib` from 30/64 -- and
nobody had re-run the sweep that would have said so. A stale ledger is a
weaker failure than a wrong measurement, but it is the same failure: a number
in this file that nothing was checking.

**The denominators moved too, and that is the part to read carefully.** 421
files across the profile are excluded, each with an individually named reason
in its module's `not-applicable`. Read as buckets: 149 are §13 language
non-goals, roughly 141 are private V8 or engine internals, 62 depend on a
module that does not exist here yet (`http2`, `worker_threads`, `cluster`,
`child_process`, `tls`, `vm`, `crypto`, the ESM loader), 39 are temporary
runtime gaps, 16 are harness or runner limitations that `tooling/conformance`
owns and can recover, and 9 exist *because* the file passed under sabotage.
Seven left the runtime-gap bucket in the tranche below by being implemented
rather than re-argued, which is the direction that bucket is supposed to
move.
That last bucket is the healthy one --
`test-console-self-assign.js` is excluded on the grounds that "assigning any
writable global property to itself has no observable assertion and passes
empty-module sabotage", which is a pass being deleted rather than banked.

That fourth bucket is four smaller than it was. Six of this tranche's passes
came from it and from a source no bucket had: four were excluded as needing a
publishing subsystem that is now ours, and two were in no bucket and no
denominator at all, because their filenames matched no module's test pattern.
The first four are a denominator shrinking for the right reason — the
exclusions were conditional and the condition was met. The last two are the
denominator having been wrong.

**The exclusion set was re-audited rather than re-counted, and it holds.** Three
checks, each mechanical:

*Do they admit how much of the file is inapplicable?* 104 of the 422 entries
say the file is only *partly* out of scope — "mixes", "irreducibly", "N of M
subtests pass". Of those, **72 already name a `local/` retention** holding the
representable half, and all 72 of those files exist. That is the pattern
`local/blocklist-static.js` follows: a §13 refusal touching eleven lines of a
361-line file should cost eleven lines, not the file.

*Do the other 32 leave coverage on the floor?* Mostly no, and the reasons say
why: they are of the form "*X* is a private-engine fixture, **while** the
public behaviour is exercised by the applicable *Y*". A retention there would
duplicate a test that already runs. The distinction from `blocklist` is
concrete — there, the 350 recoverable lines existed nowhere else; here they do.

*Are those "covered by *Y*" claims true?* 26 entries point at another test by
name. Every named file exists — three resolve to `test/async-hooks/` and
`test/client-proxy/` rather than `test/parallel/`, which is why a first pass
reported them missing. None of the genuine coverage claims names a test that is
itself excluded. Four entries do reference an excluded file, and all four are
analogies rather than coverage — "the same blocker as", "the same flat object
model that makes *Y* inapplicable" — which a reader should not confuse with a
claim that *Y* covers anything.

A pass rate against a shrinking denominator is exactly the shape this document
warns about elsewhere, so the two numbers belong next to each other: **1,803
measured, 420 excluded, 0 hollow.**

The seven added since are all assertions node's own tests had no reason to make
— four object identities, two on function names, one on Web IDL surface shape —
so the denominator grew because this profile asked harder questions of itself,
not because more of node's corpus became applicable.

Both numbers moved for the same reason, and the reason is worth stating. The
ten `fs` files below were never excluded; they were never *seen*, and eight of
them were already passing. Two more newly-found files went straight into the
excluded column with a measured blocker each. That is the distinction this
line exists for: an exclusion is a decision someone can audit, and a file no
pattern matches is not a decision at all — it is absent from both columns, and
absent from any argument about whether it should be.

**The `compiles` column is not in this table, and its absence is deliberate.**
It was last measured at compiler `9bb54c1`, which is long superseded, and it
cannot be re-measured today: `target/release/nts` was rebuilt twice while this
sweep's tranche was being written, at 01:19:47Z and again at 02:43:11Z, because
the compiler lane shares this tree. That is precisely the mixed-binary
condition the rule below says to discard a run for. Carrying the old figures in
a live table would make them look current, so they are quarantined in *What
stops all of it compiling* until a run can be taken against a binary that holds
still.

| module | node's tests | hollow | note |
| --- | :---: | :---: | --- |
| `assert` | **10 / 10** | 0 | complete, including `CallTracker` and node's Myers diff |
| `async_hooks` | **114 / 114** | 0 | `AsyncLocalStorage` and the hooks |
| `buffer` | **50 / 50** | 0 | the read/write surface, validated against node's boundary values |
| `console` | **17 / 17** | 0 | complete |
| `dgram` | **75 / 75** | 0 | UDP |
| `diagnostics_channel` | **32 / 32** | 0 | complete |
| `fs` | **338 / 338** | 0 | sync, callback and promise surfaces, file streams, watchers, `FileHandle.readableWebStream` |
| `http` | **403 / 403** | 0 | a complete HTTP/1.1 implementation, parser and env-proxy routing included; no HTTPS or HTTP/2 |
| `net` | **146 / 146** | 0 | `Socket` and `Server`, with auto-select-family actually running |
| `os` | **6 / 6** | 0 | complete |
| `path` | **17 / 17** | 0 | complete but for `matchesGlob` |
| `process` | **86 / 86** | 0 | complete but for `process.binding`, `stdin` and workers |
| `punycode` | **1 / 1** | 0 | complete |
| `querystring` | **4 / 4** | 0 | complete |
| `readline` | **24 / 24** | 0 | the line editor and the splitter |
| `stream` | **247 / 247** | 0 | the core, the operators, `Readable.from` and the async iterator |
| `string_decoder` | **3 / 3** | 0 | complete |
| `timers` | **54 / 54** | 0 | complete |
| `url` | **45 / 45** | 0 | complete; exact on the Web Platform Tests corpus |
| `util` | **20 / 20** | 0 | `inspect`, `format`, `types`, the comparisons and the helpers |
| `zlib` | **66 / 66** | 0 | the streams, the one-shots, brotli and zstd |
| `events` | **28 / 28** | 0 | complete, including `addAbortListener` resisting `stopImmediatePropagation` |

**How the last failure closed, and what it needed from three places.**
`test-events-add-abort-listener.mjs` requires an abort listener to run even
after an earlier listener has called `stopImmediatePropagation()`. Node does
that by registering with `kResistStopPropagation`, a private symbol from
`internal/event_target`; the test builds its `AbortController` from a global,
and this runner deliberately withholds `--expose-internals`, so node's symbol
was unreachable here by design.

It took three pieces, and none of them alone would have done it. The
web-platform lane added a resist option that script cannot reach — not an
`addEventListener` option and nothing named for it on `EventTarget`, so
resisting stays opt-in rather than becoming what "internal" means. `events`'s
`addAbortListener` asks for it when the signal is canonical. And the runner
grew a way to *be* canonical: a module may declare web-platform globals its
tests need, one name per line in a `globals` file, and `events` declares
`abort` with the test named as the reason.

The declaration is per module rather than global, and that is the part worth
keeping. The experiment recorded below showed the swap is not free — a
canonical `AbortSignal` handed to a host function expecting the host's own is
not understood — so a module gets it only where its own tests are the reason,
and the file says which test.

**One of those two is closed and the other is not, which is the useful
outcome.** The resist option landed, `events` uses it, the runner learned to
install canonical globals per module, and `test-events-add-abort-listener.mjs`
passes. `test-aborted-util.js` did not come with it: the same globals that
close the first break a case of the second, for the reason the experiment
below found. So the shared root was real and the shared fix was not.

**The rest of this entry is kept because it is still true of `util.aborted`.** The
web-platform lane has since built the weak-listener half that `util.aborted`
needed, and it did not close `test-aborted-util.js` either — because the seam
reaches the canonical `EventTarget`'s own private state, and a pinned test's
`new AbortController()` is the host's. That is measurable rather than
inferred: a probe through the substitution reports the ordinary registration
taken, not the weak one.

So two of this profile's remaining failures have one root between them, and it
is not the option in either case. **This profile does not install the canonical
abort globals**, so our modules receive an `AbortSignal` from the host and
cannot pass it any option node reaches for privately — neither the resist flag
nor a weakly-held handler. Building more options against a signal we do not own
buys nothing. Recorded here so the next person costing this work prices the
globals rather than the options.

**"Installing the globals closes both" is what this section said next, and an
experiment says otherwise.** Installing `core/abort.ts` as
`AbortController`/`AbortSignal` in the runner takes four lines and works —
verified by printing the constructor's source through the substitution, which
changes from the host's to `controllerSignal = createAbortSignal()`. With the
globals canonical:

- `test-events-add-abort-listener.mjs` fails *identically*, which confirms the
  resist option is genuinely the remaining blocker there rather than the
  signal's provenance.
- `test-aborted-util.js` gets **worse**. A case that passed now fails, in
  `listenerCount (node:events:988)`: the test asks `node:events` for the
  listener count on the signal, `events` is the host's in this lane, and the
  host's `listenerCount` does not understand a foreign `EventTarget`.

So the prerequisite has a prerequisite. Canonical abort globals need the
canonical `EventTarget` to be understood by whatever `events` a test is holding
— which means substituting `events` alongside, and our `listenerCount`
answering for a canonical target. That is a third piece nobody had costed, and
it was cheaper to find with a four-line experiment than to discover after
building the option it was supposed to unblock. The experiment was reverted;
what it produced is this paragraph.

The first two columns are what

```sh
node tooling/conformance/sweep.mjs
```

prints — every module, both modes. It takes about twenty minutes now, and
`http` is most of it: 396 files that each open sockets. The rows are copied
here rather than generated into the file, so the sweep is the check on this
table and not the other way round. It has already earned that twice: the `url`
row read `26 / 38` when it was written by hand and the applicable count is 36,
and the whole table sat a thousand files out of date until a run contradicted
it.

**Sabotage is a control, not a test.** Replacing `node:http` with an empty
object and watching 0 of 396 files pass establishes that the suite is connected
to its subject at all — and a control that extreme can only fail if the wiring
is broken, so its passing says nothing about *resolution*. It catches a suite
that never touched the implementation; it says nothing about a suite that
touches it and would accept a wrong answer. The other half is
mutating code the suite already passes and watching it go red. Two, run against
the tree that produced the table above: deleting the whitespace-before-colon
refusal from `http/src/parser.ts` — the request-smuggling one — takes
`http-parser.mjs` to 25 passed, 1 failed; making `net`'s `bytesRead` stop
counting takes `net` from 132 to 129, named by `test-net-bytes-read.js`,
`test-net-bytes-stats.js` and `test-net-bytes-written-large.js`. A suite that
cannot be made to fail on purpose is not evidence, and 0 hollow on its own does
not establish that it can.

**The TypeScript lane now has the same mutation the compiled lane got, and it
was the lane that needed it more** — all 1,719 passes live here and it had only
the blanking control. `--mutate-addon` applies to this lane too: exported
functions throw, exported classes keep their shape with every prototype *and
static* method throwing, exported object facades have their function members
replaced.

Measured across **all twenty-two modules: 1,719 passes, 32 survive mutation.**
That run predates the tranche below, so it does not cover its six new passes.
`diagnostics_channel` was re-measured under mutation afterwards on its own:
**0 of 32 pass, 0 survive.** Each of the six notices when the module's exports
are poisoned, which is the part sabotage cannot establish.
Eleven modules drop to zero, including `dgram` 75, `zlib` 66 and `url` 44 — a
suite where every export throws and not one file fails to notice.

The four biggest are the interesting ones, because they have the most machinery
between a test and an export and are where a survivor would be least
explicable:

| module | passes | survive |
| --- | ---: | ---: |
| `http` | 396 | 4 |
| `fs` | 328 | 1 |
| `stream` | 241 | 3 |
| `net` | 132 | 2 |

**This figure first went into the ledger covering eighteen modules and 622
passes.** The four omitted were the slow ones, and they hold 1,097 passes —
nearly two-thirds of the total. A resolution number that excludes two-thirds of
what it claims to be about is the same shape as everything else on this page,
so it was completed rather than left.

**No survivor inspected was a degenerate pass, and the detector has two blind
spots — after a third, written here first, was falsified by measurement.**

The claim was that some survivors are tests asserting a *throw*, which a
throwing poison satisfies for the wrong reason. It was plausible, it was the
same shape as everything else on this page, and it is **wrong**. A second
poison was built to test exactly that — return `undefined` instead of throwing,
so a test expecting a throw fails — and the intersection did not shrink in a
single module:

```
net       throw-survivors 2   silent-survivors 3   both 2
http      throw-survivors 4   silent-survivors 8   both 4
buffer    throw-survivors 3   silent-survivors 5   both 3
readline  throw-survivors 5   silent-survivors 5   both 5
```

Every throw-survivor survives the silent poison too, so not one of them is
passing because of the throw. The hypothesis explained nothing, and it was
believed until it was tested.

What is left:

| blind spot | example | kind |
| --- | --- | --- |
| data properties, identity, existence | `test-http-max-header-size.js`, `test-path-posix-exists.js` | unreachable by *any* behavioural mutation |
| inherited methods | `test-net-write-arguments.js` | a hole in this implementation |

The second is precise and worth stating. `test-net-write-arguments.js` drives
`socket.write(null)`; `class Socket extends Duplex` at `net/src/main.ts:514`
and `net` never defines `write` — it is inherited from `Writable` at
`stream/src/writable.ts:324`, **in a different module**. Poisoning a module
replaces its own exports and their own methods, and inherited behaviour comes
from a sibling. For `net` that is a scoping fact; for `stream`, whose `Duplex`
inherits from a `Readable` and `Writable` it also exports, it is a genuine gap.

So **a survivor is not evidence of a degenerate test, and this column cannot be
read as one.**

**Building it found two holes in itself, both of which looked like findings.**
Poisoning only prototype methods left `buffer` at 40 survivors of 50 —
`Buffer.alloc`, `from` and `concat` are static, and node's tests reach for
statics far more than instance methods. And leaving exported objects alone let
`querystring` escape entirely, because its `shape.mjs` returns
`exports.QueryString` and the tests call *its* members: four survivors of four,
which read as a wholly degenerate module and were an artefact of the tool.
Both were caught by the numbers being too round to believe.

**`hollow` is how many of those passes survive the module being removed.**

```sh
node tooling/conformance/run.mjs --module buffer --sabotage
```

hands every test an empty object instead of our module. Whatever still passes
was never measuring us — it reached node's own implementation through a global,
or asserted something true of any module at all.

**That column is zero across the profile now, and getting the last three out of
`http` is what the number is for.** They were not near-misses. Two were
non-measuring filename matches: `test-http-request-agent.js` and
`test-http-url.parse-https.request.js` match `test-http-*` but load only
`node:https`, so they were grading node's implementation against itself. The
third, `test-http-server-drop-connections-in-cluster.js`, does all its work
inside a `cluster.fork()` child that the runner does not re-enter, so the child
ran host `node:http`. Each is excluded by name, and the pass count went *down*
by three as a result, which is the direction that means the check is working.

**A second kind of hollow pass, found the same way and larger.** The
`test/common` shim reported `hasIntl: false` and `hasCrypto: false`, which are
untrue of the process these tests run in. Node's tests guard cases with
`{ skip: !hasIntl }`, and a file whose every case skips still exits zero --
which this runner read as a pass. Both flags now report the truth, and a file
whose every `node:test` case skipped is reported as a skip rather than a pass.
That moved `assert` from 11 to 9 and `util` from 8 to 7, and turned ten of
`diagnostics_channel`'s skips into honest failures.

This column exists because the number above it was wrong. `node:buffer` read
**51 of 60** until the check was run, and 15 afterwards. Node's tests write
`Buffer.concat(...)` unqualified far more often than they write the export, so
they were grading node's `Buffer` against itself; 46 of the 51 passed with our
module gone. Installing ours as the global is what the other 45 failures are
now measuring, and they are real: missing `readBigInt64BE`, missing argument
validation, and the like.

The general form, which is worth more than the correction: *ask of any
measurement what input would make it fail, and check that the input is in it.*
A pass count that cannot go red is not evidence.

Read the two columns as measuring different things. `console` passes every one
of node's tests and lowers eight functions; `os` lowers nineteen and passes
four. Neither number predicts the other, which is the point of keeping them
apart.

## What closing `http` cost, and what it found in `net`

### Four bugs behind seventeen failures, and three of them were one line

`http` was the only module in the profile with any failure at all, so its
seventeen were worth reading rather than counting. They were four causes.

**The global agent was never given the environment.** Node builds its default
agent as `getGlobalAgent(getOptionValue('--use-env-proxy') ? process.env :
undefined, Agent)` -- one read, at construction, in `lib/_http_agent.js`. Ours
built it with no `proxyEnv`, so eight proxy tests watched their proxy server
receive nothing at all. Everything else about proxy support was already here
and already correct: the URL parsing, the `NO_PROXY` bypass walk with its
suffix and IPv4-range forms, the absolute-form request rewriting, the
`proxy-connection` header. It was simply never told which environment to read.

The normalization is an exact string comparison. `src/node_options.cc` sets
`use_env_proxy = opt_getter("NODE_USE_ENV_PROXY") == "1"`, so
`NODE_USE_ENV_PROXY=true` does not enable it. Accepting any truthy value would
have passed every test here and been wrong for the one spelling a user is most
likely to try.

**A pool key computed twice, two different ways.** An agent files a socket
under `getName(options)`, which reads `socketPath`, `localAddress` and `family`
as well as host and port. This profile acquired sockets with the full options
and released them under `getName({ host, port })`. For a TCP socket the two
agree by accident. For a Unix socket they cannot: every connection was filed
under a key no later lookup could produce, so keep-alive reused nothing and
`test-http-unix-socket-keep-alive.js` opened ten connections where node opens
one.

Node does not avoid this by computing the same key carefully twice. It captures
one options object when it creates the socket and hands *that object* to
`getName` at both ends -- acquisition, and again in the `free` handler through
`agent.emit('free', s, options)`. The keys agree by construction. That is the
part worth copying, and the reason the fix is the agent deriving the key from
the socket's own creation options rather than a second, more careful
computation at the call site.

**`path` means two things and only one branch knew it.** `net.connect` reads
`path` as the name of a Unix socket; HTTP options use `path` for the request
target. Node resolves the collision before it connects: copy `socketPath` over
`path`, and clear `path` when there is no `socketPath`, so a request for `/` is
never dialled as a pipe. The agent path here did that. The branch with no agent
-- the one a caller reaches by supplying `createConnection` -- did not, so a
custom connector received options with no `path` and dialled the default
origin.

### `node:net` boxed every byte, in both directions

The fourth cause was not in `http`.

```js
nts_net_write(this._handle, Array.from(buffer), onWritten);   // and, per read:
entry.socket.on("data", (chunk) => onData(Array.from(chunk)));
```

Every byte written to or read from every socket in the profile was converted
into a JavaScript array of boxed numbers, handed across the binding, and
converted back -- `Buffer.from(bytes)` on the far side of the write, and
`push(Buffer.from(bytes))` on the near side of the read. A round trip whose net
effect is the identity function.

Measured: 64 MB costs 1.5 seconds and roughly a gigabyte of boxed numbers, and
above 128 MB `Array.from` throws `RangeError: Invalid array length`, because
that is V8's maximum fast-array length. So the profile could not write more
than 128 MB to a socket at all, and the failing test is the one that writes
192 MB in order to make a socket non-drained.

**The profile's own convention already had the answer.** `nts_udp_send` takes
`chunks: Uint8Array[]`; `zlib` takes `dictionary: Uint8Array`; `Uint8Array`
appears in fifteen binding declarations across these modules. `net` was the
one place that spelled a byte payload `number[]`, and it is the module where
that spelling costs the most, because it is the one every socket goes through.

Both directions now pass the view through unconverted, and the `onread`
delivery path uses `buffer.set(bytes.subarray(...))` rather than a loop that
copied one boxed element at a time.

Two things made this safe to change rather than a question for the compiler
lane. The `socketPath`/`path` and pool-key fixes are pure TypeScript. And this
binding has no C half yet -- `net.c` is eleven lines of default values, and the
socket operations have no compiled implementation -- so the triple a
`declare function` normally has to keep in step is, for now, only two.

**What this did not fix, and why the number matters less than it looks.** A
read still copies: the binding hands over a view and the socket does
`Buffer.from` on it before pushing. That is one memcpy where node's
`stream_base` pushes the buffer it was given. Removing it means deciding who
owns the bytes after the callback returns, which is a question for the C that
does not exist yet, so it is recorded here rather than guessed at.

## The channels node publishes, and the bind that was a tick late

`node:diagnostics_channel` was complete as a mechanism and had almost nothing
to observe. Counted from node's own `lib/`, the subsystems this profile owns
publish to sixteen well-known channels: five in `console`, one in `dgram`, two
plus the `net.server.listen` tracing channel in `net`, seven across
`_http_client` and `_http_server`, and one in `process`. We published six of
them — `console`'s five and `udp.socket`. The six pinned tests that check the
others were excluded on the grounds that they needed the publishing subsystem
to be ours. It now is, for all of them, so the channels were implemented and
the tests un-excluded: `diagnostics_channel` goes from 26 to 32, with `net`,
`http`, `dgram`, `process` and `stream` re-measured unchanged, empty-module
sabotage failing all 32, and mutation leaving none of the 32 alive.

The sixteenth has no pinned test at all. Node publishes `process.execve` with
`{ execPath, args, env }` immediately before the syscall, and no file in
`test/parallel` subscribes to it — so it is implemented and covered locally
instead, in `process/test/execve-success.js`. The assertion is made in the
*replacement* image, because nothing the calling process writes after
`execve(2)` survives: node hands the subscriber the very array it is about to
pass to the syscall, so an entry the subscriber pushes onto it has to show up
in the environment of the process that replaces it. Deleting the publish takes
that file from pass to fail, which is the only reason it is worth having.

Three things came out of the rest of it that are worth more than the six files.

**A bind that was a tick late.** `test-diagnostics-channel-net.js` subscribes
to the `net.server.listen` tracing channel, calls `listen()` on a port already
in use, and unsubscribes *synchronously*, on the line after. Node's `error`
publish still lands, because node binds through libuv, which is synchronous:
`createServerHandle` returns the errno, node publishes it, and only the
`emit('error')` is deferred to a tick. Ours published from inside that deferred
tick, so a synchronous unsubscriber saw nothing — and the same seam is why an
ephemeral port has to be readable the instant `listen()` returns. Two fixes:
the module now builds the error and publishes it before deferring the emit, as
node does, and the host binding stopped modelling a synchronous bind with an
asynchronous one. `net.BoundSocket` is the one public API with libuv's timing —
it throws the bind errno rather than emitting it a tick later, and it refuses
hostnames for exactly the reason we have to screen them out — so a literal
address binds through it and a hostname keeps the deferred, DNS-shaped path,
which is the split node itself makes.

**The two publish sites that differ only in when they fire.**
`http.client.request.created` and `http.client.request.start` carry the same
payload, and `test-diagnostic-channel-http-request-created.js` distinguishes
them by setting a header between the two: the first must not see it, the second
must. That makes `start` an ordering assertion rather than a payload one, and
it landed on the one seam node has and we did not. Node calls `_finish` when
the message has handed all its bytes to an assigned socket — handed over, not
written out. A request to a host that never resolves reaches it, because the
bytes still reached the socket's own buffer; a completion callback would not,
because that write never completes. Anchoring on our flush callback published
once where node publishes twice. `OutgoingMessage` now has node's `_finish`
seam, called under node's condition and latched, since node can reach the call
again on every later drain.

**A test that matched nothing.** Node names two of these files
`test-diagnostic-channel-*`, singular. Every module's pattern wanted the
plural, so the two matched nothing anywhere and appeared in no denominator on
either axis — the failure mode a green sweep is structurally unable to show.
Both are now claimed and both pass. The completeness audit above has been
corrected rather than quietly amended, because it is the audit that was wrong.

The correction was worth generalising, and generalising it found more. Taking
every module's pattern — the explicit ones and `run.mjs`'s
`^test-<module>(-.*)?` default — and asking which of node's 4,494
`test/parallel` files match no module at all leaves 2,630, nearly all of them
belonging to subsystems this profile does not have. Filtering those for a name
that mentions a module we *do* own leaves a shortlist worth reading by hand,
and ten of them were `fs` tests: `test-file-write-stream.js` and its four
numbered siblings, `test-file-read-noexist.js`,
`test-file-validate-mode-flag.js`, and the three `test-filehandle-*` files.
Every one calls `require('fs')`. `fs` was reporting 328 of 328 while ten of its
own pinned tests were in nobody's denominator.

Eight of the ten passed the moment they were claimed, which is the
uncomfortable part: that coverage had been earned and never counted. The other
two are the subject of the section below.

## Ten `fs` tests nothing was running, and the two that failed

Eight of the ten newly-claimed `fs` files passed unchanged. `fs` goes from 328
to 338, with sabotage failing all 338. The two that failed were both worth
having.

**`FileHandle.readableWebStream` did not exist.** Node's returns a byte
`ReadableStream` that auto-allocates and answers the BYOB request, so a
`mode: "byob"` reader has its own buffer filled rather than being handed a
copy. Nothing about streams is restated in `fs` to do this: the class is the
canonical `ReadableStream` from `web-platform`, which already implements
`ReadableByteStreamController`, `byobRequest` and `autoAllocateChunkSize`.
One detail is not decoration — closing the handle has to end the stream *while
a reader holds it*, and the public `cancel()` rejects on a locked stream, so
this uses the same internal cancel that a reader's own `cancel()` goes through.
`test-filehandle-readablestream.js` checks exactly that case, along with the
BYOB reader, the three `ERR_INVALID_STATE` states, and the warning for a
non-`"bytes"` type.

**A closed handle answered the wrong error, in two layers.**
`test-filehandle-autoclose.mjs` asserts that reading an auto-closed handle
rejects with `EBADF`. Ours said `ERR_OUT_OF_RANGE`, because node's `FileHandle`
talks to the binding while ours went through the public `fs.read`, whose job is
to reject a descriptor like `-1` before it reaches libuv. The fix is the shape
this repo had already used for `fstat`, applied twice: `async.ts` now splits
`read` into a validating wrapper and a `readFileHandle` helper that accepts the
closed sentinel, and the host binding answers a negative descriptor with
`UV_EBADF` instead of letting node's own `fs.read` reject it. Both layers were
needed, and finding only the first is why the test still failed after the
obvious fix.

The same split applies in principle to `write`, `readv`, `writev` and the rest
of `FileHandle`, which still report `ERR_OUT_OF_RANGE` on a closed handle. It
is deliberately not done here. `fstat` was split when a test demanded it, and
`read` was split when a test demanded it; doing the remaining dozen now would
be behaviour nothing measures, which is the same argument this document makes
for not inventing channel names. It is recorded so the next test that demands
one finds the reason rather than the surprise.

## Five more the patterns did not claim, and one test kept rather than lost

Running the audit again over the families it had not yet been pointed at found
five more files that matched no module anywhere: `test-blocklist.js` and
`test-blocklist-clone.js` (`net.BlockList`), `test-socketaddress.js`
(`net.SocketAddress`), and `test-als-defaultvalue.js` with
`test-als-defaultvalue-original.js` (`AsyncLocalStorage` — node abbreviates it
in the filename and `async_hooks`'s pattern spelled it out). That is the fourth
and fifth instance of the same mistake, and the shape is now familiar enough to
state as a rule: **a module's test pattern should be checked against node's
directory listing, not against the module's own name.**

Both `als` files passed untouched; `async_hooks` goes to 112.
`test-socketaddress.js` is claimed and honestly reported as a skip, since it
needs `internal/socketaddress`. The two `BlockList` files are the interesting
ones.

`test-blocklist.js` is 361 lines, of which eleven fail. Two blocks want
`util.inspect` metadata this profile refuses: the depth-exceeded marker
carrying a constructor's name — node prints `[BlockList]` where ours prints
`[Object]`, which is the same §13 refusal the census records for
`Point { x: 1 }` — and node's symbol-keyed `util.inspect.custom` hook
rendering `rules: []`. **Excluding the file for those eleven lines would have
thrown away three hundred and fifty that measure real behaviour**, so it is
excluded and `local/blocklist-static.js` retains the rest unchanged: every
address and subnet rule, every `ERR_INVALID_ARG_TYPE`, `isBlockList`, and the
whole JSON round trip. That is the pattern this document already uses for
`inspect`, `assert` and `promisify`, applied where it pays best — a §13
refusal that touches two blocks should cost two blocks.

`test-blocklist-clone.js` is a genuine exclusion with nothing to retain. It
posts a `BlockList` through a `MessagePort` and requires the clone to *share
the original's native handle*, so that adding an address to one is visible
through the other. Node does that with its internal `kClone`/`kDeserialize`
symbol protocol over a shared handle; this profile's `BlockList` holds ordinary
typed state and structured clone has no route to it.

## Nine more in `net`, two refusals it was not making, and a harness bug

The sixth pass of the pattern audit went after families named for a *transport*
rather than a module: `test-socket-*` and `test-pipe-*`. Nine of them
`require('net')` and nothing else this profile lacks, and none was claimed.
`net` goes from 133 to 142.

Four passed untouched. Two were failing because `net` was not making a refusal
node makes, and both are the kind that only a test would ever tell you about:

- `new net.Socket({ objectMode: true })` has to throw `ERR_INVALID_ARG_VALUE`.
  A socket carries bytes, so object mode is not an unsupported extra but a
  request that was never coherent, and node rejects it in the constructor
  rather than ignoring it. `readableObjectMode` and `writableObjectMode` the
  same. The three are now declared in `SocketOptions` *so that they can be
  rejected* — leaving them off the interface would only move the refusal
  somewhere a caller cannot see it.
- `listen({ path: "\0abstract", readableAll: true })` has to throw. An
  abstract-namespace socket has no filesystem entry, so there is nothing for
  the permission flags to chmod, and silently ignoring them would leave a
  caller believing a socket is world-readable when nothing made it so. The
  message is transcribed with node's own typo (`writableAllt`) intact, because
  node's test matches on it.

**The ninth was a bug in this harness, and it is the exact mirror of a hollow
pass.** `test-pipe-unref.js` forks a child that binds a socket under `tmpdir`,
and it failed with `EACCES` — before reaching anything it was written to test.
The cause was in `tooling/conformance/tmpdir.mjs`: the directory was named
`.tmp.${process.pid}`, so a forked child computed a directory its parent had
never created. Node names it from `TEST_SERIAL_ID`/`TEST_THREAD_ID`, which its
runner sets and children inherit through the environment. Ours now
self-assigns an id on first use and inherits it from there, which needs no
runner change.

A hollow test passes without touching its subject; this one failed without
touching its subject. Both are the instrument lying, and only one of them has
a control that looks for it — sabotage catches the first and nothing was
looking for the second. The lesson this document keeps relearning, in its
sixth costume: **a red result deserves the same suspicion as a green one.**

## The one property `timers` exists for, which almost nothing measured

A mutation, prompted by the web-platform lane finding the same shape in its own
suite: **collapse every requested delay to 1ms**, so `setTimeout(f, 1500)`
fires after 2. Verified effective before it was believed — that exact call now
returns in 2ms.

**50 of node's 53 applicable `timers` files still pass.** Only three notice.

That is a fact about the oracle rather than about this implementation, and the
distinction matters. Node's timer tests are about semantics — ordering, `ref`
and `unref`, clearing, argument validation — because a test that asserts
elapsed wall-clock time is flaky by construction, so upstream mostly declines
to write one. Declining is defensible and it leaves the property timers exist
for unmeasured. `local/delay-honoured.js` measures it: ordering across three
different delays, and a floor on elapsed time set far below the delay it checks
and far above the two milliseconds a collapsed delay produces. It fails under
the mutation and is otherwise robust to a loaded machine.

**Two earlier versions of this mutation proved narrower things than they
looked like proving, and that is the more useful half.** The first changed a
list's expiry at creation and reported 52 of 53 surviving — but a probe showed
a 1500ms timer still waiting 1500ms, because each timer's own due-check
recomputes from its `_idleStart`. It had corrupted *ordering*, not duration.
The second collapsed `getTimerDuration` and restored ordering while still
waiting 1500ms, because `setTimeout` never routes through it. Only the third,
at `this._idleTimeout`, actually removed the delay.

Three mutations, three different numbers, and two of them would have been
reported as "the suite does not check delay" by anyone who did not probe what
the mutation had actually done. **A mutation is a claim about the code it
changed, and needs its own control** — the same sentence as the census
printing its lane, one level down.

## A comment asserting a property no test covers

The web-platform lane put it best, after finding it three times in a few hours:
**a comment asserting a property no test covers is a test asserting nothing,
except nobody runs a comment.** Applied to the comments this session added,
two of them were exactly that.

`internal/stdio.ts` said that after `process.stdout.end()` a later write "still
succeeds rather than reporting `ERR_STREAM_WRITE_AFTER_END`", a deliberate
difference from a real `Writable`. Nothing checked it. And `process`'s signal
watcher said it "does not hold the process open", because waiting for a signal
that may never arrive is not work — also unchecked, and the failure it guards
against would appear as a *timeout* rather than an assertion, which is the
least legible way for a suite to break.

Both are now `local/` tests, and both were verified to be able to fail:
mutating `end()` to close the stream, and giving the signal watcher something
that holds the loop open, each turns its test red. `process` goes to 86.

The signal test is deliberately two-sided, and that is the general lesson
rather than a detail of this file. Its second assertion is about a process
*exiting*, and a test that only asserts an exit passes just as well when the
listener was never registered at all — so it first shows the signal is
delivered, then shows the watcher does not overstay. **Sabotage tests whether
the test is empty; a positive assertion tests whether the implementation is.**
A suite made only of refusals cannot tell you whether the thing refusing
exists.

## The audits run in the sweep now, and paid on the first run

Both look for the same failure and it is the one a green sweep cannot show:
something *absent* rather than wrong. `tooling/conformance/audit.mjs` runs
them; `sweep.mjs` runs it at the end of any profile-wide run and fails on
anything new. Each is judged against a reviewed list in the same shape as a
`not-applicable` — one `subject: reason` per line — so a silence has an
argument behind it, and deleting a line reopens the question.

**Fourteen applicable tests that nothing claimed, all passing.** `http` 396 to
403, `stream` 244 to 247, `net` 144 to 146, `async_hooks` 112 to 114. Thirteen
passed untouched; the fourteenth,
`test-set-incoming-message-header.js`, wanted `IncomingMessage._addHeaderLines`
— which node's own tests call directly and this profile did not have. It is
not the same operation as our `_addHeaders`: node's replaces the raw array and
picks its destination by `complete`, ours appends for a parser delivering a
block in pieces, so both exist with a comment saying why.

Two details of the instrument matter more than the count.

**Filenames are deliberately not consulted.** Every instance of this bug was a
file whose name did not resemble its module, so the audit asks what a file
*imports*: ours when it imports something we implement and nothing we do not.
That needs one judgement, in `audit-incidental` — importing `fs`, `path` or
`util` does not make a file a test *of* them, and without that discount the
first run reported 197 candidates rather than 85.

**And the export half caught its own author.** Its docstring said each
candidate was re-checked with `in`, because own enumerable keys miss inherited
accessors — and the code did not do it. Four of the first thirty were
`process.exitCode`, `stdin`, `title` and `ppid`, all reachable and all reported
missing. The re-check is now a second pass through the same probe, and the
count moving 30 to 26 is its control. A comment asserting a property nothing
verifies, in the file written to catch things nothing verifies.

## Comparing the export surface to node's, which nothing had done

The pattern audit asks which of node's *tests* nothing runs. The complementary
question is which of node's *exports* nothing implements, and it turns out to
be cheap to answer exactly: load each module through the conformance
substitution, take `Object.keys`, and diff against `Object.keys` of the real
`node:` module in the same process. No filename heuristics, no prose.

That diff is **32 exports across five modules**:

| module | exports node has that ours does not |
| --- | --- |
| `util` | `aborted`, `getCallSites`, `inherits`, `transferableAbortSignal`, `transferableAbortController`, `TextDecoder`, `TextEncoder`, `MIMEType`, `MIMEParams`, `setTraceSigInt` |
| `process` | 18, led by `stdin`, `title`, `ppid`, `exitCode`, `report`, `binding`, `dlopen`, `domain` |
| `url` | `URLPattern`, `fileURLToPathBuffer` |
| `console` | `context`, `createTask` |
| `events` | `init` |

Two of them had pinned tests that no module's pattern claimed, which is how
they stayed missing: nothing ran the test, so nothing reported the absence.

**`url.fileURLToPathBuffer` is implemented**, and
`test-fileurltopathbuffer.js` now runs and passes — `url` goes to 45. It is
not a `Buffer`-returning wrapper around `fileURLToPath`, and the difference is
the point. `fileURLToPath` scans for encoded separators and rejects `%2f`,
which it can do because it is about to produce a UTF-8 string. The buffer
variant deliberately does not scan, because there is no encoding to scan
under: a single path may mix encodings segment by segment, and in Shift_JIS
`%5c` is the yen sign rather than a backslash, so the scan would reject legal
names. It decodes to bytes and hands them over, which is the entire reason
node has a second function.

**`util.aborted` is implemented**, and its file is claimed but excluded, with
the reason measured rather than asserted: four of its five cases pass, and the
fifth wants two things. Node registers the abort listener as a *weak* handler
keyed on the caller's resource, so collecting the resource detaches it and a
later abort leaves the promise pending.

That half is no longer missing — the web-platform lane built
`addWeaklyHeldEventListener` for it, and `util.aborted` uses it — but it does
not reach this test, and the reason is worth recording because it is not a
defect in either piece. The registration reaches the canonical `EventTarget`'s
own internals, so only an instance of that class can accept it. This profile
installs no canonical abort globals, so a pinned test's `new AbortController()`
is the host's, and the weak path is measurably not taken: a probe through the
substitution reports the ordinary registration. The seam is right, the caller is
right, and the two will meet when Node reexports the canonical abort globals.
Until then `util.aborted` uses the weak registration where it can and the
ordinary one otherwise, which is a weaker guarantee rather than a different API:
nothing observable differs until the resource is collected, which is precisely
the case the ordinary listener cannot serve.

That case then inspects the promise — and found a second gap worth more than
the test.

**`util.inspect` renders every Promise as `{}`.** Node renders
`Promise { <pending> }`, `Promise { 42 }`, `Promise { <rejected> ... }`. Ours
is correct for `Map`, `Set` and `WeakMap`, so this is specific. It is not
listed in any exclusion, and the fuzzing this document reports for `inspect` —
480,000 structures for the comparisons, 5,000 for `inspect` itself — evidently
never generated a promise, which is a useful thing to know about a generator
that reports 88.5% agreement. The fix needs a runtime helper, and the
first version of this paragraph got the seam wrong. It said V8, reasoning from
the fact that `process.binding("util")` in the pinned node no longer carries
`getPromiseDetails` — which is true of the JavaScript *host shim* and
irrelevant to a runtime that has no V8 in it at all. In the compiled profile a
promise is `NtsPromise`, a struct the runtime allocates, and its state and
settled value are fields that runtime owns. So this is `nts_promise_state`-
shaped work in the compiler lane rather than an engine internal to reach for,
and it is cheaper than the original note claimed.

The remaining 29 are not all work to do. `util.inherits` should stay missing
and is excluded by name. Others are host-process facts (`process.ppid`,
`process.title`), features from subsystems this profile does not have
(`process.report`, `process.domain`), or deliberate refusals. What the diff
buys is that each is now a line someone can argue with, instead of absent from
both the code and the document.

## Eighteen `test-std*` files, and the input half of the process

The export diff and the pattern audit met here. `process` was reporting 69 of
69 and missing `process.stdin` — `stdout` and `stderr` are present, the input
half is not, and no exclusion mentioned it. The reason nothing had said so is
the pattern audit's third instance: node names these tests `test-stdin-*`,
`test-stdout-*` and `test-stderr-*`, `process`'s pattern wanted
`^test-process(-.*)?`, and all **eighteen** of them matched no module anywhere.

Claiming them took eight passes and then gave one back, which is the part
worth reading. Seven passed untouched. An eighth needed one small thing, and
it is a nice illustration of what a test name is worth:
`test-stdout-cannot-be-closed-child-process-pipe.js` calls
`process.stdout.end('foo')` in a child and requires it to exit 0 having
written exactly `foo`. Node's `process.stdout` is a `Writable` whose `_destroy`
is a no-op, so `end()` flushes and finishes while the descriptor stays open —
a program cannot take the process's own output away from the rest of the
program, which is what the file is named after. Our standard streams had no
`end` at all. They have one now, with one documented difference: a later
`write` still succeeds rather than reporting `ERR_STREAM_WRITE_AFTER_END`,
because this class is deliberately the smaller protocol its header describes
rather than a `Writable`, and no pinned test asks for that error here.

**The ninth pass was hollow, and was deleted rather than banked.**
`test-stdin-hang.js` passed empty-module sabotage. Its own comment says why:
it "only verifies that invoking the stdin getter does not cause node to hang",
so it asserts nothing observable, and a blanked module does not hang either.
It is doubly empty here, since the getter it invokes returns `undefined`. That
is a pass this tranche created and then removed, on the same ground as
`console`'s `test-console-self-assign.js`. `process` ends at **76**, up from
69, with sabotage failing all 76.

The remaining eleven are excluded, in three groups, each named per file.

Three are the `type: module` boundary this profile hits whenever a test shells
out to one of node's CommonJS `.js` fixtures: the root `package.json` makes the
spawned child read it as ESM and it dies on `require` before reaching the
behaviour under test. That is the same cause already recorded for
`test-process-execve.js` and its siblings.

Seven needed `process.stdin`, and the blocker under it turned out to be one
level down, which is why it is worth having written out. Node builds `stdin`
from fd 0 according to what the descriptor *is* — a `net.Socket` for a pipe,
an `fs.ReadStream` for a file, a `tty.ReadStream` for a terminal. Our
`net.SocketOptions` already declared `fd` and the constructor ignored it: a
socket built on fd 0 constructed without complaint and never delivered a byte.
So the first piece of work was not `process.stdin` at all.

**Both are now done, and `process` is at 81.** `net.Socket` adopts an
already-open descriptor: an `fd` is an unopened form of the `handle` option, so
it is adopted and then takes the identical path, which is how node treats the
two once a descriptor has a handle. `process.stdin` is built on top of that,
lazily and by descriptor kind, as node builds it — lazily because acquiring a
handle on fd 0 is not free and a program that never reads stdin should not pay
for one. Five of the seven pass. A terminal is read through the same socket as
a pipe, because this profile has no `node:tty`: the bytes are right and
`isTTY`/`setRawMode` are absent, which is a difference recorded rather than
hidden.

The remaining two are excluded and neither is a `process.stdin` gap.
`test-stdin-child-proc.js` spawns `test-stdin-pause-resume.js` and asserts it
exits 0, and neither spawn path can satisfy that: unrouted the child dies in
16ms with code 1 on the `type: module` boundary, routed its exit does not
arrive within the runner's window — while the file it spawns passes standalone
and is measured directly. `test-stdout-close-unref.js` reaches for
`process.stdin._handle` and calls `close()` and `unref()` on it; node's
`_handle` is a libuv object with those methods and ours is a number, which is
the flat object model working as intended.

Adding `stdin` gave `process` two implementation dependencies it did not have,
`node:net` and `node:fs`, against a header that said `node:events` was its one
sibling. That header now says otherwise and says why: node has the same shape
and keeps it out of the bootstrap the same way, by building the stream inside
the getter, so nothing is required until a program actually reads stdin.

## `path`

Complete, both halves, transcribed from node v24.20.0 `lib/path.js`.

| | posix | win32 |
| --- | :---: | :---: |
| `resolve` | done | done |
| `normalize` | done | done |
| `isAbsolute` | done | done |
| `join` | done | done |
| `relative` | done | done |
| `toNamespacedPath` | done | done |
| `dirname` | done | done |
| `basename` | done | done |
| `extname` | done | done |
| `format` | done | done |
| `parse` | done | done |
| `sep`, `delimiter` | done | done |
| `matchesGlob` | **not done** | **not done** |

All 17 applicable `test-path*` files pass. `test-path-glob.js` is excluded on
`matchesGlob`. `test-path-win32-normalize-device-names.js` skips: it calls
`process.chdir` to a device root and only runs on Windows.

Argument validation is included — `validateString`, and the
`ERR_INVALID_ARG_TYPE` message with node's exact wording, because node's tests
compare against a string built by `common.invalidArgTypeHelper` and a
paraphrase fails a test the throw itself would pass.

## `os`

Complete, from node v24.20.0 `lib/os.js`. Every function, `os.constants`, and
the `Symbol.toPrimitive` that makes `` `${os.hostname}` `` the hostname rather
than a function's source.

| | |
| --- | --- |
| identity | `hostname`, `type`, `release`, `version`, `machine`, `arch`, `platform`, `endianness` |
| directories | `homedir`, `tmpdir`, `devNull` |
| machine | `uptime`, `totalmem`, `freemem`, `availableParallelism`, `loadavg`, `cpus` |
| network | `networkInterfaces`, with `getCIDR` |
| user | `userInfo` |
| priority | `getPriority`, `setPriority` |
| values | `EOL`, `constants` |

All four applicable test files pass. Two skip on `internal/test/binding`, node's
private hook for forcing a binding to fail; two are not applicable.

`os.constants` comes from the platform's own headers through the binding rather
than a table written down here, because the values differ by platform —
`SIGUSR1` is 10 on Linux and 30 on macOS — and a transcribed table would be
right on one and silently wrong on the other.

Where node's C++ binding returns one flat `v8::Array` of mixed strings and
numbers, ours returns one typed array per column and the TypeScript assembles
the same objects. The result is identical and the declarations stay typed.

## `events`

`EventEmitter` complete, from node v24.20.0 `lib/events.js`: `on`,
`addListener`, `once`, `prependListener`, `prependOnceListener`,
`removeListener`, `off`, `removeAllListeners`, `emit`, `listeners`,
`rawListeners`, `listenerCount`, `eventNames`, `setMaxListeners`,
`getMaxListeners`, the `defaultMaxListeners` accessor, `errorMonitor`, and the
module-level `once`, `getEventListeners`, `getMaxListeners`, `listenerCount`
and `setMaxListeners`.

27 of 28 applicable files pass. What is left:

| failing | needs |
| --- | --- |
| `test-event-emitter-subclass.js` | `EventEmitter.call(this)` — see below |
| `test-event-emitter-no-error-provided-to-error-event.js` | `node:domain` integration |
| `test-events-getmaxlisteners.js` | `EventTarget` |
| `test-events-once.js` | `events.once` and `events.on`, the promise forms |
| `test-events-uncaught-exception-stack.js` | stack rewriting for a rethrown `error` |

Three more skip on `internal/event_target`.

`captureRejections` is implemented rather than refused. A listener declared
`async` that throws would otherwise produce an unhandled rejection reported far
from the emitter and carrying no hint of which event it came from; with
capture, the rejection becomes an `error` event on the emitter, which is where
a handler for it already is. The switch exists per emitter, per prototype and
process-wide, because the emitters that most need it — streams, which want a
rejected handler to destroy them — are constructed by libraries rather than by
the application that wants the behaviour.

An `error` emitted with a value that cannot be inspected — one whose custom
inspection throws — falls back to string coercion. The error being reported is
the emitter's, and letting the value's own bug replace it loses the one that
matters.

**The one deliberate difference.** Node's `EventEmitter` is a *function*, so
ES5-era subclassing writes `EventEmitter.call(this)`. Ours is a `class`, which
cannot be called without `new`. Keeping the class is the right TypeScript and
the right shape for a compiler that lays out classes; the alternative is a
function with a prototype assembled by hand, which is neither. `class X extends
EventEmitter` works exactly as it does in node.

Two representation choices are upstream's rather than ours, and both are
load-bearing. The listener store holds *either* one listener or an array,
because `emit` branches on it and a single-listener emitter then allocates no
array. And the store has a null prototype, so an event named `toString` is a
key that is absent until something registers it rather than an inherited
method.

## `querystring`

Complete from node v24.20.0 `lib/querystring.js`: `parse`, `stringify`,
`escape`, `unescape`, and the `decode`/`encode` aliases. All 4 test files pass.

The parser is one pass with no allocation per character — it tracks where the
last field began and slices only at a separator — and it decides whether a key
needs decoding by watching for `%` followed by two hex digits as it scans,
rather than making a second pass. Both are upstream's design and the reason
`parse` is fast on a long query, so they are transcribed rather than replaced
with `split`.

All four test files pass.

One structural detail is worth naming, because it is the kind of thing a
rewrite loses. `parse` reads `unescape` off the module object at call time, not
from a module-local binding, so replacing `querystring.unescape` changes what
`parse` does — and node's tests check exactly that. But it compares against the
*original* function to decide whether a custom decoder was supplied. Both halves
are needed: read late, compare against the original.

## `buffer`

`Buffer` as a `Uint8Array` subclass, from node v24.20.0 `lib/buffer.js`.
Subclassing rather than wrapping is the design: it is what makes a `Buffer`
accepted anywhere bytes are, and it is what node does.

| | |
| --- | --- |
| allocation | `alloc`, `allocUnsafe`, `allocUnsafeSlow`, `from`, `of`, `concat`, `SlowBuffer` |
| encodings | `utf8`, `hex`, `base64`, `base64url`, `latin1`/`binary`, `ascii`, `ucs2`/`utf16le` |
| reading | `toString`, `toJSON`, `write`, the `read*`/`write*` integer and float family |
| comparison | `equals`, `compare`, the static `compare` |
| searching | `indexOf`, `lastIndexOf`, `includes` |
| other | `copy`, `slice`, `subarray`, `fill`, `swap16`/`32`/`64`, `byteLength`, `isBuffer`, `isEncoding`, `isUtf8`, `isAscii`, `atob`, `btoa`, `constants` |

All 50 applicable files pass, none hollow. Among the exclusions: two need
`--allow-natives-syntax` to drive V8's optimiser, which is a question about V8
rather than about `node:buffer`.

**This number was 51 and the 51 was not real.** `Buffer` is a global as well as
an export, and node's tests write `Buffer.concat(...)` unqualified far more
often than they write the export -- so for as long as we did not install ours
as the global, they were grading node's `Buffer` against itself. Running the
suite with our module replaced by an empty object left **46 of the 51 still
passing**, which is what a number that cannot go red looks like.

Ours is installed as the global now and the suite measures it. The failures are
real and are mostly one thing: argument validation. Node throws
`ERR_INVALID_ARG_TYPE` from almost every method for almost every wrong
argument, and a module reached from JavaScript has to, because JavaScript has
no types to have stopped the caller.

The accessor family is complete as of this pass: `readBigInt64BE`/`LE`,
`readBigUInt64BE`/`LE` and their writes, the variable-width
`readIntBE`/`readUIntLE` family, and the lowercase `Uint` spelling of every
unsigned accessor, which node offers alongside `UInt` and a great deal of code
uses. All of them agree with node on the boundary values -- the signed minimum,
the unsigned maximum, and a six-byte integer, which is the widest a `double`
holds exactly and the reason `byteLength` is a validated argument rather than a
documented convention.

Bounds errors are node's three, which are three because the distinctions
matter: a non-integer offset is a mistake about the argument, an offset past
the end is a mistake about the range, and a buffer too short for the access at
all is neither -- there is no legal offset to suggest, so it reports
`ERR_BUFFER_OUT_OF_BOUNDS` against the buffer rather than the argument. One
`boundsError` reports all three and every accessor routes through it, which is
node's structure; writing the three cases out twice is how the `byteLength`
argument came to report a range error for a caller who had passed a string.

Every write bounds its value as well as its offset, and the range is spelled
the way node spells it: `>= 0 and <= 65535` up to four bytes and
`>= 0 and < 2 ** 48` past that, because a six-byte maximum written out is a
number nobody reads. The threshold is a width of four and it took a
differential run to find -- node's own check takes the *last byte index* rather
than the width, so its `> 3` is my `> 4`.

**348 write cases agree with node**, across every fixed and variable width, at
each type's minimum and maximum and one past each: the boundary values are the
whole point, since a write that is right in the middle of its range is right in
any implementation.

**`Buffer.from` accepts what node accepts, and the differential is why.** I
widened it by reasoning — a `SharedArrayBuffer` is memory, an iterable is a
sequence, a `DataView` is bytes — and every one of those inferences was wrong.
Node rejects a `Set`, reads a `Uint16Array` as one byte per *element* rather
than as its memory, and answers an *empty* buffer for a `DataView`. That last
is not a special case: `fromObject` accepts anything with a `length` **or** a
`.buffer` that is an array buffer, so a view qualifies on its buffer and then
contributes nothing, because its `length` is not a number.

Transcribed rather than inferred, it agrees with node on all twelve shapes
including the `{ type: "Buffer", data: [...] }` that `toJSON` produces — which
is how a buffer survives `JSON.parse(JSON.stringify(buf))`.

`Buffer` is callable without `new`, which is three test files: `Buffer(10)` is
`alloc` and `Buffer("ab")` is `from`, both deprecated and both used. It lives
in `shape.mjs` rather than in the TypeScript, because a module cannot export a
callable class and because the deprecated spelling is a compatibility surface
rather than something a compiled program should carry.

`kMaxLength` was wrong: 2**32 - 1 where node reports 2**53 - 1 on a 64-bit
build. It is not an amount of memory anyone has; it is the largest integer a
`double` indexes exactly, and node reports the representational limit rather
than an allocatable one.

I had recorded the opposite conclusion here -- that installing the global broke
node's own modules -- on the strength of watching the count fall from 51 to 15
and not reading the failures. It did not break anything. The count fell because
the measurement started working.

The UTF-8 decoder is the WHATWG Encoding standard's, state variable for state
variable. That is not pedantry about which spec to cite: the standard defines
how many U+FFFD an invalid sequence produces, and `E8 AA 62` is *one* bad
sequence followed by `b`. A decoder that restarts one byte past the lead emits
three characters where node emits two, and no test over ASCII would ever show
it. 60,000 random byte sequences now agree with V8 exactly.

`allocUnsafe` returns zeroed memory here and does not in node, which hands back
a slice of a pool. The name is kept because the API is the contract, and code
that reads before writing is wrong either way.

Floats go through a one-element typed array rather than hand-rolled bit
manipulation: reproducing IEEE-754 rounding by hand is a way to be subtly wrong.
The integer accessors are byte arithmetic, as upstream's are, because they are
what a protocol parser calls in its inner loop.

## `string_decoder`

Complete from node v24.20.0. Node's JavaScript here is a shell over
`internalBinding('string_decoder')` — the state machine that carries an
incomplete character across `write` calls is C++, because it runs once per chunk
of every stream. What it implements is what this implements.

Two of three files pass. The third uses `StringDecoder.call(decoder)`, the same
class-versus-function difference described under `events`.

Getting this right needed three corrections that no small test would have found,
and all three were located by fuzzing against node rather than by reading:

- **`utf8CheckByte` accepted `C0..C1` and `F5..F7` as lead bytes.** They cannot
  begin a sequence: the first pair can only introduce an overlong encoding of
  ASCII, the second something past U+10FFFF.
- **The byte after a lead has a lead-specific range.** `E0` forbids `80..9F`,
  `ED` forbids `A0..BF`, `F0` forbids `80..8F`, `F4` forbids `90..BF`. Checking
  only `80..BF` accepts overlong encodings and surrogates.
- **`end()` has to reset.** Node documents that a decoder can be reused after
  it; ours flushed without clearing, so the *next* stream's first `write`
  completed a character from the previous one.

The last one is the kind of bug that survives a test suite: every single-stream
test passes, and only reuse exposes it.

## `punycode`

Complete, from node v24.20.0 `lib/punycode.js`: `encode`, `decode`, `toASCII`,
`toUnicode`, `ucs2.decode`, `ucs2.encode`, `version`. Its one test file passes.

The algorithm is RFC 3492's, variable for variable — `bias`, `delta`, `damp`
and `skew` are the RFC's names, and renaming them would only make the reference
harder to follow.

Including the deprecation warning, which node's own test asserts on. Node
suppresses it when the caller is inside `node_modules`, on the grounds that a
dependency's use of a deprecated module is not something the application can
fix; a compiled program has no `node_modules` to be inside, so ours always
warns.

## `console`

Complete, from node v24.20.0 `lib/internal/console/constructor.js` and
`lib/internal/console/global.js`. **All 17 applicable files pass.**

| | |
| --- | --- |
| output | `log`, `info`, `debug`, `dirxml`, `warn`, `error`, `dir`, `trace`, `assert` |
| counting | `count`, `countReset` |
| timing | `time`, `timeEnd`, `timeLog` |
| grouping | `group`, `groupCollapsed`, `groupEnd` |
| other | `clear`, `table`, `profile`, `profileEnd`, `timeStamp`, `Console` |

Almost all of it is `util.format` and a stream write. What is left is the state
the API implies — a timer table, a counter table, an indentation level — and
the care taken not to let a failed write take the program down, since a
debugging aid that crashes the thing being debugged is worse than useless. A
stream can fail synchronously (a file, a TTY) or asynchronously (a pipe), so
both are handled; a stack overflow is rethrown, because swallowing that hides
the actual bug.

**Two decisions are ours and worth recording.**

`Console` takes streams, as node's does. `node:stream` does not exist yet, and
the two streams the global console needs have to come from somewhere, so
`runtime/node/internal/stdio.ts` provides them: an `EventEmitter` over two write
bindings, with the small surface `console` actually asks of a stream — write a
string, say whether you are a terminal, accept an error listener. It becomes
`process.stdout` when `node:process` and `node:stream` land. The *interface* is
the part that survives, because it is what `console` was written against.

The global `console` is a real `Console` instance where node builds a bare
namespace object with the methods bound onto it. The methods are own bound
properties either way — `const { log } = console` works, `Reflect.ownKeys`
agrees — so the only observable difference is what `Object.getPrototypeOf`
returns, and nothing observes it. In exchange the class keeps private fields
instead of the symbol-keyed properties a non-instance would force, which is
also the shape a compiler can lay out.

`console.table` and `console.clear` pulled in two pieces of shared code that
belong outside this module and are now in `internal/`: the box-drawing table
(`cli-table.ts`, which measures columns in terminal *columns* rather than code
units, so a CJK ideograph counts as two) and the cursor sequences
(`readline-callbacks.ts`, which `node:readline` will want).

## `diagnostics_channel`

Complete, from node v24.20.0 `lib/diagnostics_channel.js`: `channel`,
`subscribe`, `unsubscribe`, `hasSubscribers`, `tracingChannel`, `Channel` and
`TracingChannel` with `traceSync`, `tracePromise` and `traceCallback`.

All 32 applicable files pass. Six of them were exclusions until this tranche,
and they are the six worth explaining, because the reason they were excluded
was a prediction. They assert that *node's own* `http`, `net` or `udp`
publishes to a well-known channel, and a subsystem that is node's publishes
into node's registry rather than into ours. The note here said they would pass
when the subsystem was ours and not before. That is now measured instead of
predicted: `net`, `http` and `dgram` are substituted alongside this module
through `uses`, they publish, and the six pass.

| test | what it exercises |
| --- | --- |
| `test-diagnostics-channel-net.js` | `net.client.socket`, `net.server.socket`, and the `net.server.listen` tracing channel across a successful and a failing bind |
| `test-diagnostics-channel-udp.js` | `udp.socket` |
| `test-diagnostics-channel-http.js` | all seven `http.*` channels, including the error channel on a request whose host never resolves |
| `test-diagnostics-channel-http-server-start.js` | `http.server.request.start` and `http.server.response.finish`, carrying an `AsyncLocalStorage` context between them |
| `test-diagnostic-channel-http-request-created.js` | `http.client.request.created` against `http.client.request.start` — a header set after construction must be absent from the first and present in the second |
| `test-diagnostic-channel-http-response-created.js` | `http.server.response.created` |

The last of those is the sharpest, and it is the reason two of the seven http
publish sites are where they are rather than one line earlier: `created` and
`start` differ only in *when* they fire, so a subscriber can tell them apart
only by what the request looked like at the time.

The exclusions that remain name subsystems we do not have — `http2`, `tls`,
`worker_threads`, `child_process`, `cluster`, Web Locks and the module loader.
They stay excluded under the same rule, which is now a rule with a
demonstrated positive case rather than only negative ones. 22 more skip on
`--expose-gc` or on node internals.

`node:console` is the first caller: `console.log` publishes its raw arguments
before formatting them, so a subscriber sees the objects that were logged
rather than their printed form — and a subscriber that mutates one changes what
gets printed, which node's test checks.

**One deliberate difference.** Node has two classes here, `Channel` and
`ActiveChannel`, and swaps an instance's prototype between them as its first
subscriber arrives and its last leaves, so that publishing to a channel nobody
listens to reaches a `publish` that is an empty function. That is a V8
inline-cache trick with no semantic content, and it is the reason node also has
to define `Symbol.hasInstance`. One class with a subscriber array that is empty
until someone subscribes says the same thing; the branch in `publish` costs a
length check.

The registry holds channels weakly, as node's does. A channel that nobody
references and nobody subscribes to is dead weight, and a process that names
channels dynamically would otherwise leak one per name. The finalizer clears
the entry only if nothing has taken the name in the meantime, since
finalization is not synchronous with collection.

## `util`

`inspect`, `format`/`formatWithOptions`, `types` (43 predicates), the three
comparisons, `deprecate`, `debuglog`, `promisify`, `callbackify`, `styleText`,
`parseEnv`, `stripVTControlCharacters`, `toUSVString`, `aborted`, the
`getSystemError*` family, and `TextEncoder`/`TextDecoder`.

**The Encoding pair is a re-export, and the identity is the point.**
`test-global-encoder.js` asserts `TextDecoder === util.TextDecoder` and
`TextEncoder === util.TextEncoder` — not that both work, that both are the same
object. Two separate correct implementations would fail it. So `util` re-exports
web-platform's canonical Encoding and declares the `encoding` group in its
`globals` file, which installs the same classes as the globals for its own test
run. The group is declared per module rather than installed for everyone, for
the reason already recorded against `abort`: a canonical global handed to a host
function expecting the host's own is not understood.

**Nothing was claiming that file.** It is named `test-global-encoder.js`, which
matches no module's pattern, and the unclaimed audit could not see it either —
`util` is on the incidental list, so a file importing only `assert` and `util`
was discounted to nothing. The audit built to find tests in no denominator had a
blind spot of exactly that shape, and it is the seventh instance of this bug.

**This list said `inherits` until it was checked against the module.** It is
not there and should not be: `util.inherits` is a §13 language non-goal, and
`util/not-applicable` has said so all along — "entirely observable function and
prototype mutation (`ctor.super_`, `ctor.prototype`, descriptors), and no
operation in the flat NTS object model". The exclusion was right and this
sentence was wrong, which is the more embarrassing direction for a prose list
to be wrong in: it claimed credit for something the module had deliberately
refused. Prose that lists a surface is unfalsifiable unless something compares
it to the surface, which is what the section below now does.

All 20 applicable files pass. The count understates the difficulty: `util`'s tests compare
`inspect` output character for character, so a single spacing difference fails
a file that is otherwise entirely correct. The measures that say more:

- **All three comparisons agree with node on 480,000 random structures** —
  `node tooling/conformance/fuzz-deep-equal.mjs [cases] [seed]`, over eight
  seeds. The generator makes pairs that are usually equal and sometimes differ
  in one place, because two random structures are almost never equal and a
  fuzzer that answers `false` on both sides proves nothing.
- **`format` matches on every specifier** — `%s %d %i %f %j %o %O %c %%`,
  including `-0`, bigints, `numericSeparator`, and deferring to a custom
  `toString`.
- **`inspect` agrees with node on 88.5% of 5,000 random nested structures.**
  What that pool disagrees about is line-breaking of deeply nested values. What
  it *never asked about* is the subject of the next paragraph, and the sentence
  that used to end this bullet — "not content" — was wrong.

**A census beats a bigger pool, and this is the evidence for it.**
`tooling/conformance/census-inspect.mjs` enumerates 61 value kinds by hand,
runs them through the substitution and through host node, and diffs. **38 of
61 agree**, up from 35 when it was written. The 61 are enumerated *against a written-down set*, and that is the
whole difference from a pool: every kind `formatByShape` has a branch for, plus
every kind node's own `inspect` special-cases that ours does not. Anyone can
tell whether the list has fallen behind by reading those two branch lists
against `census-inspect-cases.cjs`; nobody can tell whether a generator has
fallen behind, because the distribution it samples was never written down. Two pools of 5,000 and 480,000 random structures had reported
health for `inspect` while every `Promise` printed as `{}`, because neither
generator ever produced one; growing either pool samples the same distribution
more times. Sixty-one deliberate kinds found ten gaps in a single run.

Of the 26 that differ, seven are refusals today: `[Function]` where node
prints `[Function: named]`, `[AsyncFunction: af]`, `[GeneratorFunction: gf]` or
`[class Klass]`, and `{ x: 1 }` where node prints `Point { x: 1 }`. A
function's name and a constructor's name are the observable metadata this
profile does not represent at run time.

They are recorded as rows to look at again rather than as closed non-goals, and
the distinction matters. The compiler lane's view is that a function's name is
a fact it *has* at lowering and simply does not carry into the running program,
because until now nothing needed it — and `inspect` is something that needs it.
Filing them permanently under §13 would turn "nothing asked for this yet" into
"this cannot be done", which is the kind of hardening a ledger should resist.

**The most serious difference is not in that list and is not about
formatting.** Node prints `[Getter]` and calls nothing; ours calls the accessor
and prints its value, and an accessor that throws makes `inspect` itself throw
rather than printing `[Getter]` and carrying on. `inspect` is what runs in
logging, error paths and assertion messages, so today logging an object
performs its side effects, and logging an object with a throwing getter takes
down the logger. That is a correctness and robustness defect, and it sits above
every row in the table below.

**And it is true of one axis only, which the first version of this paragraph
did not say.** The census runs through the conformance substitution, so it
measures `inspect` running on node against this source — the behaviour axis,
which is the right thing for it to measure and is not evidence about the
compiled artifact. On the compiled axis the defect is not reachable, because
the property walk does not lower at all: reading a member by a *runtime* key is
refused (`NTS1001 key, which Point does not declare`), so `formatProperty` and
the loop that calls it are a refusal rather than a wrong answer. "Our `inspect`
invokes getters" is therefore true for a program that runs this source on node
and vacuous for a compiled one, and a reader who is not told that will assume
it means both.

Its fix needs one bit per key — *is this an accessor?* — and the first version
of this paragraph asked for the wrong thing. It asked for
`Object.getOwnPropertyDescriptor`, which is a refusal and, more to the point,
the wrong shape: a descriptor is a dynamic object this compiler has no map for,
while "field or accessor" is something a layout already knows. The descriptor is a long way off — but so, it
turns out, is the narrow primitive, and for a reason that goes deeper than
either. A helper taking a key string has nothing to look the key up in: a
descriptor here records where an object's references *are* and not what they
are called, deliberately, which is why an uncaught throw is handed its message
by the compiler rather than finding it at run time. Adding a member-name table
is a descriptor change across three backends and a per-object cost paid by
every program to answer a question almost none of them ask.

So the blocker is not accessors. It is the computed member read, and there are
three spellings of that rather than the two this paragraph first claimed:

| spelling | status |
| --- | --- |
| `p[key]`, `key: string`, `p` a fixed struct | TypeScript's own `TS7053` — never reaches the compiler |
| `p[key]`, `key: keyof P` | the layout is fully known and the compiler holds the field names; **refused today**, a `✗` on the compiler lane and being taken there |
| `p[key]` through an index signature | needs the dynamic ordinary-object map this compiler exists not to have — a `∅` |

**`inspect` is in the third row, and that is a fact about this source rather
than about the compiler.** Its walk runs on `InspectableObject`, which is
`{ readonly [key: string]: unknown }`, reached by narrowing an `unknown`
parameter — because `inspect` is polymorphic over every object a program can
hold. There is no `T` whose `keyof` could type the key, and no single layout
for `Object.keys` to enumerate. So even when the second row is built, it will
not reach here.

The shape that would fit is an `inspect` written as a per-type walk rather than
a per-key one, since `Object.keys` of a *known* layout is decided at compile
time and each member access would then be a literal. That is a different
`inspect` and no longer node's: a transcription changes when node changes,
while a reinvention has to be re-derived, and `test-util-inspect.js` is already
excluded as an irreducible mix, so a divergent formatter would have almost no
oracle left to check it against. Carrying a named refusal is the better trade
than an unfalsifiable formatter, and that is the choice being made here rather
than a blockage being reported.

The rest are genuine formatting gaps, and none appears in any exclusion:

| kind | ours | node |
| --- | --- | --- |
| `Promise` pending / resolved / rejected | `{}` | `Promise { <pending> }`, `Promise { 7 }`, `Promise { <rejected> ... }` |
| boxed `BigInt`, boxed `Symbol` | `{}` | `[BigInt: 10n]`, `[Symbol: Symbol(s)]` |
| generator and async-generator objects | `{}` | `Object [Generator] {}` |
| `Map`/`Set`/array/string iterators | `{}` | `[Map Entries] { [ 'a', 1 ] }` |
| null-prototype object | `{}` | `[Object: null prototype] {}` |
| `arguments` | `{ '0': 1 }` | `[Arguments] { '0': 1 }` |
| `Symbol.toStringTag` | omitted | shown among the keys |

**Three of those rows are closed, and which three is the useful part.**
`AggregateError`'s `[errors]` and an `Error`'s `[cause]` are printed now, and
they were the ones worth doing first: both are set by the constructor as
non-enumerable, so `Object.keys` never reports them and an error printed from
its enumerable keys alone was dropping exactly the part a reader needs — what
it was caused by, or what the aggregate aggregates. Node adds the two by name
and brackets them, which is how it spells a key that is not enumerable, and
a `cause` a program assigns itself *is* enumerable and prints unbracketed in
both. `WeakRef` and `FinalizationRegistry` now show their brand rather than
`{}`, recognised with `instanceof` against the real classes.

**Most of what is left shares one root, and it is not `inspect`'s.** Boxed
`BigInt` and `Symbol`, generator objects, all four iterator kinds and
`arguments` are each downstream of a `util.types` predicate that answers
`false` on purpose — `isGeneratorObject`, `isMapIterator`, `isArgumentsObject`
and their siblings each carry a comment saying a runtime kind tag for an erased
value is what they need, and that inspecting an object's shape instead would
accept user objects incorrectly. Those are honest stubs rather than gaps, and
they close together or not at all.

**One row is deliberately left open, which is worth saying out loud.** The
null-prototype marker needs `Object.getPrototypeOf`, and the only `Object`
statics this profile lowers are `keys` and `hasOwn`; everything else is a
refusal. Writing it would buy `[Object: null prototype] {}` on the
TypeScript-on-node axis at the cost of another `NTS1001` on a shared gate whose
ceiling this corpus has already moved twice today. A cosmetic row is not worth
that, and the trade is recorded rather than the row being silently skipped.

The `Promise` row is the compiler lane's on both sides, and cheaply so: a
promise here is `NtsPromise`, a struct that runtime allocates, and its state is
a field it owns.

Three things about `inspect` are worth recording because they look arbitrary
and are not. `groupArrayElements` lays short array entries out as a padded grid
with numbers right-aligned — thirty numbers one per line is unreadable and
thirty on one line is too wide — and its column arithmetic is a fitted
heuristic, so changing the constants changes the output. `compact: 3` means
"combine a subtree less than three levels deep", which requires tracking the
deepest recursion reached; a child truncated to `[Object]` must *not* count
towards it, or every parent breaks onto multiple lines. And a symbol key prints
as `Symbol(x)` with no brackets — the brackets mark a *non-enumerable*
property, and `__proto__` is quoted as `['__proto__']` so that the printed
output could be pasted back without meaning something else.

Colours go through one `stylize` function chosen once per `inspect` call, so a
nested value cannot end up coloured differently from the one containing it.
`util.inspect.colors` and `util.inspect.styles` are two tables rather than one
because both are public and mutable, and the aliases (`grey`, `faint`,
`blackBright`) are non-enumerable getters onto their targets, so changing
`gray` changes `grey` with it.

Not implemented: `getCallSites` (needs V8's structured stack), `MIMEType`,
`TextEncoder`/`TextDecoder`, `parseArgs`, `diff`, and the `AbortSignal`
helpers. `parseEnv` is a paraphrase rather than a transcription — node's is
C++ in `node_dotenv.cc` — and it differs on inline comments inside quotes.

**One thing is unreachable from here and reachable in the compiled world.**
`util.format('%s', obj)` where `obj` had its prototype set to `null` prints
`[Object: null prototype]` for us and `[Foo: null prototype]` for node. V8
records the constructor name in the object's map at allocation and does not
expose it to JavaScript; node reads it through a binding. On node we cannot get
it. Compiled, we own the object model, so we can — an instance knows what
constructed it whatever happens to its prototype afterwards. It is the first
case where the compiled artifact can beat the oracle it is measured against
rather than only match it, and worth remembering when the two disagree.

## `assert`

Every function: `ok`, `equal`/`notEqual`, `strictEqual`/`notStrictEqual`,
`deepEqual`/`notDeepEqual`, `deepStrictEqual`/`notDeepStrictEqual`,
`partialDeepStrictEqual`, `throws`/`doesNotThrow`, `rejects`/`doesNotReject`,
`ifError`, `match`/`doesNotMatch`, `fail`, `AssertionError`, `CallTracker`, the
`Assert` class, and the `strict` variant.

All 10 applicable files pass. `assert`'s tests check the *message text* of every
failure, and rightly so: that text is what a developer reads when a test fails,
and it is most of what this module produces.

**The message is the product.** `AssertionError` picks between four renderings
depending on what differs:

| what differs | rendering |
| --- | --- |
| two short primitives | `1 !== 2`, inline |
| two long strings | a character diff, with a caret under the first character that differs |
| two structures | a line diff, unchanged runs collapsed to `...` |
| structurally equal | one copy, and a heading saying they are different objects |

The line diff is Myers' algorithm — the shortest edit script between the two
inspected values. That is not an optimisation. A line-by-line comparison of two
objects differing by one inserted key reports every line after it as changed,
and the reader has to find the one that matters. The diff also knows that an
inspected object puts a comma after every entry but the last, so inserting a
key at the end changes the line before it too; telling it so keeps one change
from reading as two.

The diff inspects with `compact: false`, which puts every entry on its own
line. That is what lets it mark the single line that changed.

**One algorithm, three relations.** `deepStrictEqual`, `deepEqual` and
`partialDeepStrictEqual` all live in `util/src/deep-equal.ts`, because a rule
learned in one is otherwise missed by the others — and it had been. Details
that were wrong in the obvious implementation:

- **`==` applies only when both sides are primitives.** `'a' == ['a']` is true
  in JavaScript, because the array coerces through `toString`. Node does not
  call those deep-equal, and a top-level `==` makes it say they are.
- **A type check is a guard, not an answer.** Two regexps with the same source
  can still differ in their own properties, so the type comparison has to fall
  through to the key walk rather than returning `true`.
- **Partial comparison is containment, and containment differs by kind.** An
  array must appear as a *subsequence*, not at the same indices. A set or map
  needs every entry matched by a distinct one, and matched structurally rather
  than by lookup, since an object key in the expectation is a different object
  from the equal one in the value. A `WeakMap` is never equal to another,
  because there is no way to look inside one. `Reflect.ownKeys` sees none of
  this, and using it made two different `Map`s compare equal.
- **Holes are not values.** Node has a partial-comparison test over a sparse
  array with a length in the hundreds of millions. Materialising it took
  fourteen seconds and gave the wrong answer; walking `Object.keys` is instant
  and right.
- **`deepEqual` on arrays is not symmetric.** `deepEqual([0], [null])` holds
  and `deepEqual([null], [0])` does not: a `null` on the expected side matches
  an element that is anything, because a hole reads as `undefined` and loose
  comparison has always treated the two as interchangeable. It is node's rule,
  it applies to array elements only, and `{ a: 0 }` and `{ a: null }` are not
  loosely deep-equal.

**One algorithm, and it took three tries to mean it.** The three relations
shared a file before they shared any code, and the loose walk was missing four
things the strict one had: the guard for kinds with nothing to compare, the
structural matching for `Set` and `Map` members, boxed primitives, and -- one
level down, after the first three were fixed -- the map-value comparison inside
the shared helper still called the strict relation directly. Each was a case
where a missing branch does not fail; it falls through to the key walk, which
finds two objects with no own enumerable properties and calls them equal.

That answer is well-formed. It is the *right* answer for a `WeakRef`, which
node also calls deep-equal to another for exactly this reason, and the wrong
one for a `WeakMap` -- and nothing at the point of the fall-through
distinguishes them. Every gate was green while all four were live: node's own
tests, the module suites, the type checker. The fuzzer is what found them, and
it is in the repo so the number in this file can be re-run rather than
believed.

**Two things are absent rather than wrong.** `assert.ok(x)` with no message
should read the failing expression out of the source and report `The expression
evaluated to a falsy value: assert.ok(x)`. Node does that with V8's structured
stack positions and a bundled JavaScript tokenizer; neither is reachable from
here, so the generated message is the ordinary diff — true, but it says less.
And one file spawns a real `node` to check what an uncaught assertion prints,
which is a statement about node's binary.

## `url`

Two APIs, and the older one is deprecated. Both are implemented.

| | |
| --- | --- |
| WHATWG | `URL`, `URLSearchParams`, `URL.parse`, `URL.canParse` |
| legacy | `Url`, `parse`, `format`, `resolve`, `resolveObject` |
| paths | `fileURLToPath`, `pathToFileURL`, `urlToHttpOptions` |
| domains | `domainToASCII`, `domainToUnicode` |

26 of 36 applicable test files pass. **The number that matters more is the Web
Platform Tests corpus, which this passes in full: 891 of 891 parses and 278 of
278 setter cases.** That is the same `urltestdata.json` and `setters_tests.json`
node checks `ada` against, and it grades the algorithm where node's own tests
grade the module's surface.

```sh
node tooling/conformance/wpt-url.mjs          # the parse corpus
node tooling/conformance/wpt-url-setters.mjs  # the setter corpus
```

**Written from the standard, not transcribed.** There is nothing to transcribe:
node hands `URL` to the C++ `ada` parser, so its JavaScript is a shell over a
binding. What both implement is https://url.spec.whatwg.org/, and the corpus is
common to both.

Five corrections took it from 840 to 891, and every one is a case where the
obvious implementation is quietly wrong rather than obviously wrong:

| the rule | what goes wrong without it |
| --- | --- |
| a host ending in a number is *parsed* as IPv4, and failing is a failure | `http://foo.2.3.4` becomes a domain that will not resolve rather than the error it is |
| an opaque host forbids only the forbidden-host set | a non-special scheme's host is an arbitrary string, and rejecting controls rejects valid URLs |
| a space before `?` or `#` in an opaque path is encoded | the URL does not survive its own serialisation |
| a `file:` URL against a `file:` base keeps host *and* drive letter | `/x` against `file://h/C:/a` loses the host |
| `^` is in the path percent-encode set | one character short of node's output, everywhere |

**IDNA is reduced, and the reduction is stated where the code is.** UTS-46's
mapping is a table over every code point in Unicode; node reaches it through
ICU. Ours is three rules that cover what a domain actually contains: NFKC and
case folding for the table's "mapped" entries, an explicit set for its
"ignored" ones, and rejection of what no domain may contain. Nothing in the
corpus needs more, which bounds the gap without closing it.

The legacy half is transcribed from node and lives in its own file, so that
node's rules -- which are specified nowhere -- and the standard's cannot be
confused for one another by a reader or by a later edit.

Two details worth recording:

- **`URLSearchParams` coerces with a template literal, not `String()`.**
  `String(symbol)` answers where `` `${symbol}` `` throws, and the interface
  says it throws. One character of difference, and node's tests check it.
- **Its iterator is a class rather than a generator.** A detached `next` then
  reports which receiver it wanted; a generator reports its own internals,
  which is a message about our implementation rather than about the reader's
  code.

Not implemented: `URLPattern`, and `URL.createObjectURL`/`revokeObjectURL`,
which need a blob registry that belongs to the runtime rather than to this
module.

## `timers`

Complete from node v24.20.0: `setTimeout`, `setInterval`, `setImmediate` and
the three that cancel them, the `Timeout` and `Immediate` handles with
`ref`/`unref`/`hasRef`/`refresh`/`close`, `Symbol.toPrimitive` and
`Symbol.dispose`, and all of `timers/promises` including the async-iterator
`setInterval` and the WICG `scheduler`. All 53 applicable files pass, 0 of
them hollow; 8 more skip.

The architecture is node's, and the obvious alternative is worse. Giving every
timeout its own host timer makes `setTimeout` a syscall and puts ten thousand
pending timeouts in the loop's heap. Node instead keys a linked list by
duration: every `setTimeout(fn, 40)` joins the `40` list, and because they all
wait the same length of time, one enrolled later always expires later — so the
list is sorted by construction and enrolling is an append. Only the *lists*
compete, through a binary heap ordered by expiry, and the loop holds exactly
one timer. Insertion and removal are constant time; the logarithmic part is
over the number of distinct durations a program uses, which does not grow with
the number of timers.

That design is why `_idlePrev`, `_idleStart` and `refresh()` are observable at
all, and reproducing the observable surface without the design underneath would
have been a set of fields that mean nothing.

The seam to the loop is seven primitives, mirroring node's
`internalBinding('timers')`: install the two drains, arm and disarm the timer,
arm the check-phase slot, two ref toggles, and a synchronous tick drain. Node
installs its drains once at bootstrap through `setupTimers`; so does this. A
host holding one reference per scheduled timer would be back to one host timer
per `setTimeout`.

Two departures from node's code, both forced by where the seam sits:

- **Re-arming happens here, not in the host.** Node returns the next expiry
  from `processTimers` and its C++ re-arms. Ours calls the host directly, so
  the decision stays on the side that owns the heap — and it happens in a
  `finally`, because a callback may throw. An interval whose callback throws
  has to keep running, which browsers do and node matches, and it only can if
  the exception on its way out still leaves the loop armed.
- **The ref count toggles the host when it reaches zero.** Node decrements a
  shared count without telling anyone, because its loop re-reads that count
  each time it re-arms. Nothing re-reads it here, so a process whose remaining
  timers were all unrefed would refuse to exit.

`Reflect.apply` rather than `callback.apply(...)`, because the callback is the
caller's object and `apply` is one of its properties. `fn.apply = 'not a
function'` is a strange thing to write and a real thing to receive; node has a
regression test for it.

`async_hooks` is no longer absent, and this is where the prediction in this
paragraph turned out to be half right. Timers now emit the
init/before/after/destroy quartet and carry an async context frame across the
gap they span, so an `AsyncLocalStorage` set before `setTimeout` is readable
inside it. The two remaining failures did **not** move, because they are
`domain` tests and `domain` is a module of its own built on top of these
events, not a consequence of them. "Those two will pass when `async_hooks`
exists" was wrong in a specific and useful way: it named a dependency and
assumed it was the only one.

Eight files skip. Three want `NodeEventTarget` to count listeners on a
non-`AbortSignal` event target, which is `events`' to provide; three want
`internal/test/binding`; two want child-process helpers.

## `async_hooks`

Two audiences, and the module reads oddly until they are separated.
`AsyncLocalStorage` is for programs — it answers "which request is this?" and
is very nearly the only part of this module used in the wild. `createHook` is
for tools: a callback on every asynchronous resource the process creates,
enters, leaves and discards, which is enough to reconstruct a causal graph of
everything that happened. All eleven `AsyncLocalStorage` files pass.

**The two mechanisms underneath are different and easy to conflate.**
Asynchronous *context* propagates by itself across a promise: V8 attaches it to
the continuation, so `await` needs no help and there is exactly one seam.
Asynchronous *identity* propagates nowhere by itself, and neither does context
across a gap the engine does not bridge — a timer, an immediate, a tick, a
socket read, a filesystem request. Those are captured when the work is
scheduled and restored when it runs, by hand, at each site. Which is why this
module is not self-contained: the machinery lives in `internal/`, as node has
it, because a program that never mentions `async_hooks` still schedules timers
and those report themselves.

**Four primitives are declared for the compiled runtime**, and all four are
things the language cannot express:

| | |
| --- | --- |
| `nts_async_context_get` / `_set` | the continuation-preserved slot |
| `nts_promise_hook_install` / `_uninstall` | watching promises created, entered, left, settled |
| `nts_on_collected` | a resource became unreachable |
| `nts_enqueue_microtask` | a microtask that is not a promise |

A value cannot be made to survive an `await` from inside JavaScript, and a
promise cannot be watched from inside JavaScript, because both are things the
engine does between one piece of user code and the next. On the node host they
stand on V8's, through `AsyncLocalStorage` and `v8.promiseHooks`. **A passing
test therefore says the logic is right given working primitives, and says
nothing about whether nts has them** — which is a weaker claim than any other
module's row in this document makes.

**What is instrumented**, each at every callback the runtime hands it:
`nextTick` (`TickObject`), `Timeout` and `Immediate`, `fs` (`FSREQCALLBACK`, at
all thirty-one operations), `net.Socket` (`TCPWRAP`) and `net.Server`
(`TCPSERVERWRAP`), and the HTTP parser (`HTTPINCOMINGMESSAGE` on the server
side, `HTTPCLIENTREQUEST` on the client side).

**The subtle one is `asyncReset`.** A keep-alive socket handed to a second
request is doing new work for a new caller, so it takes a new identity and the
old one is reported destroyed. Without it a connection reused fifty times looks
to a leak hunter like fifty resources still open, and a hook attributes the
second request to whichever request happened to release the socket. Node keeps
the real id on the handle and a mirror on the socket, which `http.Agent` sets
to `-1` while the connection sits in the pool; the split matters, because if
the `-1` were the only copy there would be nothing left to report destroyed on
reuse. Both of node's regression tests for this date from a 2018 bug.

Eight files are not applicable, with the reason recorded per file: four spawn a
real `node` and assert on the child, and four run the whole test inside a
`worker_threads` Worker on node's own `async_hooks` from an `eval` string. The
Worker four were **passing**, and the sabotage run is what found them — they
pass with this module blanked, because it was never loaded in there.

One hollow pass remains and is being kept rather than explained away: the test
wraps `runInAsyncScope` in its own `try/catch`, so a blanked `AsyncResource`
throws a `TypeError` the test swallows. What it actually checks is a native
abort on mismatched async ids, which nothing here can observe.

## `readline`

Two quite different programs share one class, and the `terminal` flag chooses
between them.

Without a terminal it is a line splitter: bytes arrive, a `StringDecoder` turns
them into characters, and every line ending produces a `line` event. That is
what a program gets when its input is a pipe or a file, and it is nearly all of
what runs anywhere outside an interactive session.

With a terminal it is an editor. The terminal is in raw mode, so nothing
arrives pre-assembled — every keystroke is delivered as it happens, and the
class owns the cursor, the visible line, the history, the kill ring and the
undo stack. Everything a user believes their terminal is doing, from the left
arrow to Ctrl+W to meta+y, happens here.

They are one class rather than two because a program cannot know which it will
get. `createInterface({ input: process.stdin })` is the same call whether stdin
is a terminal or a pipe, and the `line` events have to mean the same thing.

**The key decoder is a generator, and it will not compile.** A terminal does not
say which key was pressed; it sends bytes, and for anything that is not a
printable character those bytes are an escape sequence whose spelling depends
on which terminal is at the other end — xterm, rxvt, Cygwin and putty disagree,
and several spell the same key more than one way. Node's decoder is a generator
driven one character at a time, so the parser's position *is* the program
counter rather than a set of hand-named states, and this is a transcription of
it. `nts` reports exactly that:

```
`yield`, which needs the generator object a call to `function*` returns
an async generator
```

Which is the intended order of events. Writing it as an explicit state machine
would lower today and would not be node's algorithm, and the standing rule here
is that a refusal naming the real construct is worth more than a workaround
that hides it.

**`events.on` arrived with it**, because the async iterator over `line` belongs
in `node:events` and not here. The part that makes it more than three lines is
backpressure: events arrive whether or not anyone is consuming them, so an
iterator over a busy emitter is a queue that grows without bound — which is how
a program that reads lines slower than they arrive runs out of memory rather
than slowing down. There are high and low water marks, two queues (either
events are waiting for consumers or consumers are waiting for events, never
both), and the emitter is paused and resumed across them. Its own test file
still skips for `internal/event_target`, so it is exercised through `readline`
rather than directly — worth knowing before trusting it.

The cursor functions are not here. `cursorTo`, `moveCursor`, `clearLine` and
`clearScreenDown` live in `internal/` because `console.clear()` needs two of
them, and loading a line editor in order to clear a screen would be absurd;
node splits them for the same reason. `CSI` is a template tag rather than a
table of constants, again as node has it, so a sequence reads as
`` CSI`${row};${col}H` `` at the point of use and the escape and bracket appear
once.

**Two bugs the suite found that reading had not**, both the same kind. The
line-ending pattern had U+2028 and U+2029 written as themselves; U+2028 *is* a
line terminator in JavaScript source, so the regular expression literal ended
mid-line and every file in the module failed to load with `Invalid regular
expression: missing /`, pointing at a line that looks perfectly correct. And
the history object read `context.historySize` to default its own size — node's
line, but circular here, because the interface's `historySize` *is* the history
object's `size` and the object does not exist yet when it asks.

**The completer took three attempts, and the wrong two say what the problem
is.** A two-argument completer is given a callback; anything else is awaited —
and that is a difference in *timing*, not in spelling. A completer that answers
immediately has to complete the line immediately, because node's own tests emit
a keystroke and assert on the output on the very next line with no turn of the
loop between them. Promisifying the callback form put a microtask in the way and
made a synchronous completer indistinguishable from one that never ran. Making
everything synchronous unless it returned a thenable fixed those and broke the
promise tests, which require that `readline/promises` *does* take a turn. Node
resolves it by having two `Interface` classes — the callback module wraps a
one-argument completer into the callback form before constructing, the promises
module does not — so the choice belongs to whoever hands the completer over.
One class and one normalisation at the module boundary puts it in the same
place.

Four of the passes came from wiring `internal/util/inspect` into the module's
`internals`: four of node's tests measure the width of what they expect on
screen using the same helper `Interface` uses to place the cursor, and handing
them ours rather than node's is the difference between checking our arithmetic
and checking that two copies of node's agree.

Absent: the REPL's history-file persistence, which is the REPL's and not a line
editor's — a `readline` that read a dotfile in a user's home directory because
it was constructed would be doing something node does not.

## `process`

The object every other module reaches for, and node's only global that is also
a module. Node has no `lib/process.js` worth the name -- the real file is four
lines re-exporting the global -- so this is assembled from
`lib/internal/process/*` and `lib/internal/bootstrap/node.js` the way node
assembles it at startup.

It is an `EventEmitter`, which is not decoration: `exit`, `beforeExit`,
`uncaughtException` and every signal are delivered as events, and a program's
only way to react to its own shutdown is to listen. So `node:events` is its one
sibling dependency, and `node:os` is the other -- the signal table `kill` needs
is read from `<signal.h>` at build time, because `SIGUSR1` is 10 on Linux and
30 on macOS and hard-coding it would be right on exactly one platform.

`process.env` is a `Proxy`. Node implements it with V8 property interceptors on
an exotic object, and interceptors are what a `Proxy` is; a plain object with
the environment copied into it would be a different thing, because `getenv` in
a linked C library has to see what JavaScript just assigned. The type
discipline is deliberate and worth knowing: the environment maps strings to
strings and can represent nothing else, so a symbol key or an accessor
descriptor is refused rather than coerced, while everything else is coerced --
including `undefined`, which becomes the four characters `undefined`. It also
inherits from `Object.prototype`, so `process.env.hasOwnProperty` is the
function until a variable of that name shadows it.

Three seams cross from the runtime into this module, and all three are places
where nothing above the seam can see the event:

- **The lifecycle.** `beforeExit` fires when the loop has drained but the
  process has not ended, and a listener may schedule more work and be asked
  again; `exit` fires once. Only the loop knows its queues are empty.
- **Uncaught exceptions.** By the time an exception is loose the frame that
  could have caught it is gone, so the runtime hands it to `process`, which
  runs a capture callback or emits `uncaughtException`. A capture callback wins
  over the event, because a program that installed one asked to be the last
  word.
- **Exceptions from a tick callback.** Same reason, one level down: the stack
  above a tick callback is the runtime's, so a throw there has to be caught by
  whoever is draining the queue.

**A cast swallowed an operator.** `signalNumber` began as
`if (signal === (signal as number | 0))`, transcribed from node's
`sig === (sig | 0)`. In TypeScript `signal as number | 0` parses as a *type* --
the union of `number` and the literal `0`, which is just `number` -- so the
bitwise or is not there at all and the test reads `signal === signal`. It was
true for everything, so `process.kill(0, "test")` passed the string
`"test"` to the system call instead of raising `ERR_UNKNOWN_SIGNAL`. The fix is
one pair of parentheses. Nothing about the line looks wrong, which is the
point: a cast and an operator that share a token are a hazard specific to
transcribing C-shaped code into TypeScript.

**A rule with two implementations had two behaviours.** `nts_uv_err_name` and
`nts_uv_err_message` were defined in both `fs` and `util`'s native halves,
having been added to each when that module needed them. They had already
diverged -- one asked `getSystemErrorMessage` and fell back to a hand-written
table, the other read `getSystemErrorMap` and answered `unknown error` -- so
which behaviour a module got depended on which bindings file it happened to
load. They are in `internal/` now, whose own header had already written down
why: *a binding defined twice with two slightly different bodies is a bug that
only shows up in whichever module is tested second.*

**Two `nextTick`s, and only one of them was a tick anybody could observe.**
`process.nextTick` called the binding directly while `internal/tick.ts` called
it through the shared implementation, so the same operation under two names did
two different things: one reported itself to `async_hooks` and carried the
caller's context to its callback, and the public one — the one programs
actually use — did neither. Node has one implementation and so does this. It is
the same finding as the duplicated `nts_uv_err_*` bindings above, one level up:
not two definitions of a binding, but two callers of one.

All 69 applicable files pass, none hollow; 7 skip and 55 are not
applicable.

Absent: `process.binding` (node's deprecated internal escape hatch),
`process.stdin` (a readable stream, which is `node:stream`'s to provide), and
anything worker-related. Seventeen files spawn a real `node` and assert on what
the child printed, and seven call `execve` successfully -- which does not fail
the runner, it *ends* it, because the kernel loads another program over this
one. Both sets are listed with reasons in `not-applicable`.

## `http`

The module with no native half at all. Node's parser is llhttp, a C library;
this profile's is TypeScript, so `node:http` here is a complete HTTP/1.1
implementation rather than a wrapper around one. Once `net` supplies the
socket, HTTP is a text protocol and there is nothing left that needs the
operating system. **All 396 applicable files pass, none hollow.**

Everything round-trips: this client against node's server, node's client
against this server, and this against itself. Node's client is a strict reader
and did not have to be met halfway.

**The parser is a state machine because bytes arrive in pieces.** A header may
be split across three reads and a chunk size mid-digit, so there is no "parse
this message" function -- only a machine that consumes what it has, remembers
where it was, and asks for more. Its suite (`tooling/conformance/http-parser.mjs`)
delivers every message a byte at a time as well as whole, which is the case a
whole-message test cannot reach.

**Two refusals in it are security rather than strictness.** A message carrying
both a `Content-Length` and a `Transfer-Encoding` is refused, and so is a space
before a header's colon. Both are shapes where a proxy and an origin server can
be made to disagree about where a message ends, which is request smuggling. RFC
9112 requires the first; the second is the same hazard by a different route.

**The framing decision is the whole of the outgoing side.** A declared length
means the body is that many bytes; no length on HTTP/1.1 means chunked; no
length on HTTP/1.0 means the body ends when the connection does, so the
connection cannot be reused. A response whose declared length disagrees with
its body desynchronises the connection -- the next response begins where the
reader is still counting.

And "no length and no chunking" means *until close* only for a message that may
have a body at all. A `GET` cannot, so for it the same condition means the body
is empty. Treating it as until-close made every bodiless request send
`Connection: close`, which ended keep-alive for the commonest case.

**The server refuses to reuse a connection whose request body was never read.**
Those bytes are still in the socket and would be parsed as the start of the
next request, which is how a server ends up answering a message nobody sent.

**`IncomingMessage` was constructed with `autoDestroy: false`, and that was a
guess.** Node uses the stream's default, and destroying a finished readable is
what emits `close` — so `req.on('close')`, which is how a server learns a
request is over and how it learns a client hung up mid-request, was never
firing. The comment beside the option explained the high water mark, which the
constructor did not set; an unexplained option with a comment about something
else is worth re-deriving rather than trusting.

The parser is an asynchronous resource, and which one depends on what it is
parsing: `HTTPINCOMINGMESSAGE` for a request parser, `HTTPCLIENTREQUEST` for a
response parser. They are the two ends of one connection and a tool watching a
proxy has to tell them apart. It is freed when the connection goes, which is
the only moment anyone can say a parser is finished — one sitting between
messages on a keep-alive socket looks exactly like one that will never be used
again.

Absent: HTTPS, HTTP/2, `http.OutgoingMessage`'s legacy `_headers` accessors,
and the informational-response paths beyond `100-continue`.

## `dgram`

UDP, which is a different shape from TCP rather than a simpler one. There is no
connection, so there is nothing to accept and nothing to end: a socket is bound
to a port and receives whatever arrives at it, from anyone. That is why
`message` carries the sender and TCP's `data` does not — on a connection the
peer is a property of the socket, and here it is a property of each packet.
`connect` is not a handshake either; for a datagram socket it means "remember
this address and refuse the others".

**The bug worth recording is that node's `bind` is asynchronous and the seam
was built as though it were not.** Reporting success from the call meant
`listening` was emitted before the socket had a port, so `address()` inside a
bind callback threw. That was 25 of the failures — 15 passing became 40 on the
one change — and `connect` had the identical shape. Both report through a
callback now, which is what `net`'s `listen` already did: the precedent was one
directory away and unread.

Three smaller ones. A function in first position is a callback and not a port,
so `bind(cb)` was rejected with "Port should be >= 0 and < 65536. Received
[Function]". `address()` threw a stand-in errno, saying `EPERM` where an
unbound socket should say `EBADF` — for these errors the reason *is* the
message. And the socket operations were using the filesystem's error wording:
node has three of these sentences and its tests match the text of each, so
`uvException` puts the path first, `errnoException` names no syscall for the
process credential calls, and `exceptionWithHostPort` reads `getsockname
EBADF`. A fourth was nearly added under a name the second already had.

Absent: `bindSync` and `connectSync`, the send-queue accessors, the deprecated
`sendto`, and anything needing `cluster` or `net.BlockList`.

## `net`

`Socket` as a `Duplex`, `Server`, the address predicates, and a seam of one
handle per connection and per listener. All 132 applicable files pass, none hollow.

A TCP socket's two halves are genuinely independent: the direction you write
and the direction you read are separate streams over one connection, and either
can end without the other. That is what `FIN` means on the wire, and it is why
`allowHalfOpen` exists — sending it says "I have nothing more to send", not
"stop sending to me". Node closes anyway by default, because most programs do
not want the half-open state and the ones that do know they want it.

**`push(null)` records an end-of-file; it does not deliver one.** A readable
with no consumer never asks again on its own, so a socket nobody reads never
emits `end` or `close` — which is most of the sockets in a server that only
writes. Node's EOF path is two calls, `stream.push(null)` then
`stream.read(0)`, and the second is the whole of the delivery. This was found
by measuring rather than reading: a plain `Readable` here behaves exactly as
node's does, including *not* emitting `end` without a consumer, so the
difference had to be in `net` and was.

**`listening` must not be emitted until the bind has succeeded.** Binding is
asynchronous and can fail for reasons only the kernel has — an address that is
not local, a port already taken — so reporting it synchronously is a claim
about something that has not happened. The seam reports it instead, and the
failure carries the address and port, because `EADDRINUSE` alone does not tell
a program which of its listeners collided.

The socket turns the stream's own `close` off and emits its own. A stream's
carries nothing; a socket's carries whether it is closing because of an error,
which is what a listener deciding whether to reconnect needs.

**A read deferred is not a read dropped.** `Socket._read` returned early while
the connection was still being established, which looks harmless and is not:
the early return leaves the readable's `reading` flag set with nothing on the
way to clear it, so the *next* read declines as redundant and the socket never
starts reading at all. Any consumer that attaches a `data` listener before the
connection completes gets nothing, forever.

Nothing about that failure looks like a socket failure. The request goes out,
the server replies, and the bytes arrive at the kernel and stop one layer
above it. None of the 139 tests here caught it, because none attaches a `data`
listener before `connect` resolves — it was found by building `node:http` on
top, where a client is handed a socket and immediately starts parsing what
comes back. That is the argument for building the consumer rather than more
tests for the provider.

A socket and a server are each asynchronous resources now, and every callback
the runtime hands them — connect, data, end-of-file, read error, write
completion, shutdown, accept — runs in the owner's scope. This is the case
`AsyncLocalStorage` exists for: a server that sets a request id and reads it
back after a socket read, which without this finds whatever the most recent
connection to arrive had set. The callbacks arrive from the loop with no
context at all, because the code that opened the connection returned long ago.

The subtle part is `asyncReset`. A keep-alive socket handed to a second request
is doing new work for a new caller, so it takes a new identity and the old one
is reported destroyed; a connection reused fifty times would otherwise look to
a leak hunter like fifty resources still open. Node keeps the real id on the
handle and a mirror on the socket that `http.Agent` sets to `-1` while the
connection is pooled, and the split is load-bearing — if the `-1` were the only
copy there would be nothing left to retire on reuse.

Absent: `BlockList`, `SocketAddress`, the auto-select-family connection
strategy, and the IPC/child-process paths.

## `zlib`

Compression is a C library — zlib, brotli, zstd — and this module is everything
around it: the option validation, the flush semantics, the stream integration,
the error codes and the one-shot forms. The same division as `node:fs`, where
the system call is the kernel's. All 66 applicable files pass, none hollow.

**The flush flag is the thing to understand.** A compressor is allowed to hold
input back — that is how it finds matches — so nothing is guaranteed to come
out until it is told to flush. `Z_NO_FLUSH` compresses best and may emit
nothing at all for a small chunk. `Z_SYNC_FLUSH` ends the current block so the
reader can see everything so far, at the cost of a few bytes of framing.
`Z_FINISH` ends the stream. A caller who wants a compressed stream to be usable
incrementally — a live log, a protocol — has to ask, and getting it wrong looks
like a stream that never delivers.

`flush` also names two different things and node gets away with it. The
`Transform` option `flush` is the hook called at the end of a stream; zlib's is
a numeric mode. Node passes its whole options object to `Transform`, which
ignores the number because it tests `typeof flush === "function"` — benign, and
only because JavaScript let the collision happen unnoticed. Here the stream
options are built explicitly rather than spread, so the two cannot be confused.

`windowBits` is special twice over, and both are transcribed rather than
simplified. Zero is invalid when compressing and *meaningful* when
decompressing, where it tells zlib to take the window size from the header of
the stream being read — the only correct choice for a stream that came from
somewhere else. And the floor differs by format: `windowBits: 8` makes a valid
deflate stream but not a valid gzip one, so gzip's minimum is one higher.

The constants are hard-coded rather than read from a binding, which is the
opposite of what `node:os` does for signals — and the difference is the point.
A signal number is a property of the operating system, so `SIGUSR1` is 10 on
Linux and 30 on macOS and reading it at build time is the only way to be right
on the second platform. These are properties of a *file format*: `Z_FINISH` is
4 in every zlib everywhere, because a stream written on one machine has to be
readable on another.

The seam is an incremental engine — create, feed with a flush mode, take what
comes out, close — which is what `zlib.h` offers and what a compiled build will
call directly. Node does not expose an incremental engine synchronously, so
each handle on the node side is one of node's own streams with its output
collected. That is asynchronous, and it fits, because `Transform._transform`
takes a callback anyway.

## When a refusal was right about the code

The compiler refuses constructs it cannot lower, and the usual reading of a
refusal is "a feature is missing". Once so far it has been the other way, and
the case is worth keeping because it is the outcome that justifies the whole
arrangement.

`node:fs` had four cycles in its module graph, all of them running through
`main.ts`, and the compiler refused the module's initialization rather than
guess at the evaluation order. Node tolerates such a cycle because a hoisted
`function` is callable before its module has finished evaluating; a compiler
with no temporal dead zone cannot make that promise, so a module-scope `let`
read across the cycle would answer `0` rather than throwing.

Every edge back into `main.ts` turned out to be one function: `flagsOf`, which
turns `"w+"` into open flags. A pure function over a string, depending on
nothing but the constants, sitting in `main.ts` only because that is where it
was first written — and two other files had to reach back into the module's
public surface to get it. Moving it to `flags.ts` dissolved all four cycles at
once.

That is not a rewrite to please the compiler, which would have been the wrong
trade. It was a real defect: the function was in the wrong place, and the
refusal is what found it.

The cost had also been larger than one diagnostic suggested. A refused
initializer leaves a program that builds and *runs* without its module code, so
`fs` was compiling with none of its top-level statements executed and nothing
in the numbers said so. The compiler now says that outright when it happens.

## `fs`, the asynchronous half

The callback surface, `fs/promises` with `FileHandle`, and
`createReadStream`/`createWriteStream`. All 328 applicable files pass, none
hollow.

The module's own header used to say the callback forms were absent because
"they need an event loop and a thread pool to run the work on, and there is no
point having `readFile(path, cb)` call `cb` before it returns". There is a loop
now. Every async function here is the same system call as its `*Sync` twin,
handed to the loop's thread pool instead of run on the calling thread — which
is why the two share their argument handling and their errors.

One binding per operation, mirroring `uv_fs_*`, rather than a single generic
dispatch. The generic form would be less code and would have to name operations
with strings, which moves a mistake the compiler could catch into a place where
it becomes "no such operation" at run time.

**Every operation here is one filesystem request, which is one asynchronous
resource** — node calls it an FSReqCallback. Each reports itself to the hooks
and carries the caller's context to its callback, so an `AsyncLocalStorage` set
before `fs.readFile` is still set inside it. The wrapping happens where the
callback is validated, because that is the only line all thirty-one operations
share: the error-conversion helper looked like the choke point and is not, since
half the operations use an inline closure instead in order to build a `Stats` or
a `Dirent` or a `Buffer` first. Instrumenting there would have covered half the
module and left the other half silently uninstrumented rather than broken.

That wrapper cost a test on its first attempt, and the number is why it was
found: `fs` went 72 to 71. It forwarded `(error, value)`, and `read` answers
with `(error, bytesRead, buffer)`. **A fixed arity in a place everything funnels
through drops arguments silently.**

**The promise forms wrap the callback forms**, where node implements both
directly on its binding. The only difference that makes is one microtask, which
is what a promise costs anyway; a second implementation of the argument
handling would be a second place for it to be wrong.

`FileHandle` is the one place where the promise API is a different *design*
rather than a different spelling. A file descriptor is an integer that means
nothing on its own and that nothing will close for you; a handle carries its
own operations, knows whether it is closed, and can be disposed. `close` is
idempotent, because a handle closed by a `finally` and again by a `using`
declaration is ordinary code and making the second throw would turn tidy
cleanup into a failure.

**The file streams wait for their own I/O before closing.** It is normally safe
to close a descriptor with operations outstanding, but libuv implements file
I/O with synchronous calls on a thread pool — so a descriptor closed during a
pending read can be reused by the operating system before that read runs, and
the read then succeeds against a different file. A destroyed stream waits for
`kIoDone` before closing.

**The two watchers are different tools, not two spellings.** `fs.watch` asks
the operating system — inotify, FSEvents, `ReadDirectoryChangesW` — which is
cheap and prompt and not uniform: whether a rename is one event or two, whether
a filename is reported at all, and whether a directory watch sees into
subdirectories are platform answers rather than node's. `fs.watchFile` polls
`stat` and compares, which is uniform and portable and costs a system call per
file per interval forever. Watchers on one path are shared, so a library and
its caller watching the same file poll once rather than twice, and polling
stops when the last listener leaves.

Absent: `opendir`, `cp` and `glob`.

## `stream`

The largest module in node's library — 7,763 lines across `lib/stream.js` and
`lib/internal/streams/*` — and the one everything else is built on. **All 241
applicable files pass, none hollow.**

Written: `Stream` and its legacy `pipe`, `Readable`, `Writable`, `Duplex`,
`Transform`, `PassThrough`, `pipeline`, `end-of-stream`, `add-abort-signal`,
`destroy`, the high-water-mark rules, the predicates, `Readable.from`, the
async iterator, the iterator helpers (`map`, `filter`, `flatMap`, `drop`,
`take`, `reduce`, `toArray`, `some`, `every`, `find`, `forEach`) and
`stream/promises`, `compose`, `duplexify` (`Duplex.from`), `duplexPair`,
`Readable.prototype.wrap` and the operators.

**The bit-packed state is not reproduced, and that is a decision rather than a
shortcut.** Node stores about thirty booleans per stream side in a single
integer under a private symbol, with generated accessors over the bits. That is
a workaround for V8, where every field is a slot and a differently-ordered
assignment produces a different hidden class. A compiler that lays objects out
as flat structs with fixed offsets gets nothing from the packing and pays for
it in readability, so the state here is ordinary named fields. Every predicate
reads the same property names either way, and the interop symbols — which node
registers with `Symbol.for` so that a bundled copy of `readable-stream` can
read node's state — are preserved exactly.

Three things in this module are worth knowing before reading it:

- **`write` returning `false` is advice, not refusal.** The chunk was accepted.
  A producer that ignores it will buffer without limit, which is why the
  failure mode of getting backpressure wrong is memory rather than an
  exception.
- **Adding a listener changes the stream.** A `data` listener switches a
  readable from paused to flowing; a `readable` listener switches it back.
  This is the documented behaviour and it surprises everyone.
- **`pipeline` exists because `pipe` leaks.** `a.pipe(b).pipe(c)` does not
  propagate failure: if `b` fails, `a` is never told and keeps reading. Every
  joint needs that bookkeeping and `pipeline` is it, done once.

`Transform` is where the two halves meet, and its trick is worth naming: to
stop an inflating transform from turning a 4 MB write into an out-of-memory, it
holds the *write callback* rather than the data. One chunk goes through, and if
the readable side is now full the callback that would admit the next chunk is
kept until somebody reads.

**Nine failures are the class-versus-function difference**, the same one
recorded under `events` and `string_decoder`. Node's constructors are ordinary
functions with an `if (!(this instanceof X)) return new X(...)` guard, so
`Readable(opts)` works without `new` and `Stream.call(this, opts)` is how
node's own `Duplex` inherits. An ES class cannot be called without `new`, and
wrapping one in a callable function breaks subclassing -- a base constructor
that returns an object makes that object the derived `this`, so the subclass's
prototype drops out of the chain. Classes are kept: they are the shape the
compiler is being taught to lower, and a function-with-prototype-assignment
implementation would trade that for compatibility with a 2010 calling
convention.

**The three subpaths this section used to list as absent are written.**
`stream/iter` is in `src/iter/`, `stream/consumers` in `src/consumers.ts`, and
the WHATWG adapters -- `Readable.toWeb`/`fromWeb`, the `Writable` and `Duplex`
pairs -- in `src/web-adapters.ts`, with `shape.mjs` exposing the module under
its `stream/web` spelling. The reasoning recorded here for deferring them
("writing it while `fs` sits at 11 of 212 would be the wrong allocation") was
right at the time and has been overtaken: `fs` is at 328 of 328.

## `fs`

The synchronous surface, from node v24.20.0 `lib/fs.js`: `statSync`,
`lstatSync`, `fstatSync`, `existsSync`, `accessSync`, `readFileSync`,
`writeFileSync`, `appendFileSync`, `openSync`, `closeSync`, `readdirSync`,
`mkdirSync` (including `recursive`), `rmdirSync`, `rmSync`, `mkdtempSync`,
`unlinkSync`, `renameSync`, `copyFileSync`, `linkSync`, `symlinkSync`,
`readlinkSync`, `realpathSync`, `chmodSync`, `chownSync`, `truncateSync`,
`utimesSync`, plus `Stats`, `Dirent` and `constants`.

**This section describes the module's first half and is kept for the reasoning
in it, not for its numbers.** When it was written, 11 of 260 files passed and
the shortfall was three absent subsystems -- the callback forms, the file
streams, `fs.promises`, and the two watchers -- each deferred because they need
an event loop and a thread pool, and `readFile(path, cb)` calling `cb` before
it returns is not the function node documents.

All four landed; see *`fs`, the asynchronous half* above. The module measures
**328 of 328, none hollow.** The deferral was the right call and the reason it
was right is the part worth keeping: writing those forms against a runtime that
could not run them would have produced something shaped like node's API and
behaving like nothing.

`readFileSync` returns a `Buffer` when no encoding is given and a string when
there is one, as node does. `writeFileSync` takes either. Those are two
bindings rather than one: encoding a `Buffer` into a string to reuse the text
binding re-encodes every byte above 0x7f, which is a corruption rather than a
conversion.

Errors are libuv's, built from `uv_err_name` and `uv_strerror` through the
binding, so `err.code`, `err.errno`, `err.syscall` and `err.path` carry what
node's carry and the message reads the same:

```
ENOENT: no such file or directory, stat '/nope/x'
```

## The whole compiled axis, measured in one run

This table had been owed for a long time and was started four times: twice
abandoned when I handed the machine to another lane, once discarded for tree
movement, once for editing the running wrapper. **It completed at `06:01:45` on
2026-09-08**, over all 22 modules, against a compiler pinned at a scratch copy
(`NTS_BIN`) so a peer's rebuild could not substitute the thing under test.

    module                interpreted        compiled artifact
    assert                 10 / 10   h0      c-did-not-compile
    async_hooks           114 / 114  h0      c-did-not-compile
    buffer                 53 / 53   h0      built-exports-partial
    console                17 / 17   h0      c-did-not-compile
    dgram                  75 / 75   h0      c-did-not-compile
    diagnostics_channel    32 / 32   h0      c-did-not-compile
    events                 30 / 30   h0      c-did-not-compile
    fs                    338 / 338  h0      c-did-not-compile
    http                  403 / 403  h0      c-did-not-compile
    net                   146 / 146  h0      c-did-not-compile
    os                      7 / 7    h0      partial            <- 4 of 7
    path                   19 / 19   h0      every-pass-hollow
    process                87 / 87   h0      c-did-not-compile
    punycode                2 / 2    h0      green              <- 2 of 2
    querystring             6 / 6    h0      built-exports-nothing
    readline               24 / 24   h0      c-did-not-compile
    stream                248 / 248  h0      c-did-not-compile
    string_decoder          3 / 3    h0      built-exports-nothing
    timers                 54 / 54   h0      c-did-not-compile
    url                    49 / 49   h0      built-exports-nothing
    util                   24 / 24   h0      c-did-not-compile
    zlib                   66 / 66   h0      c-did-not-compile

    1,807 / 1,807 interpreted, 0 hollow
    compiled: 1 green, 1 partial, 15 do not compile, 5 build and do not work

**The interpreted column sums to exactly 1,807**, which is the standing green
total. That is worth stating because it means this single run confirms both axes
rather than one — the compiled measurement did not come at the cost of a stale
green number, and the two columns describe the same tree at the same moment.

**The five that build and do not work are the useful rows**, and they are three
different kinds of failure that a pass/fail column would have flattened:

- `built-exports-nothing` — `querystring`, `string_decoder`, `url`. The addon
  compiles, links and loads, and its export table is empty. Nothing refused.
- `built-exports-partial` — `buffer`. Some names publish and the ones the tests
  need do not.
- `every-pass-hollow` — `path`. **The name means every *pass* was
  degenerate, not that every test passes**, and I misread my own label within an
  hour of writing this table down. Run the same artifact directly and it is
  `2 passed, 17 failed, 1 skipped`. Both passes are
  `require('path/posix') === require('path').posix` holding because each side is
  `undefined`, so `real = pass - degenerate = 0` and the row is correct.

  The addon publishes **4 names** — `_makeLong`, `delimiter`, `sep`,
  `toNamespacedPath` — and none of `join`, `resolve`, `normalize`, `basename`,
  `dirname`, `extname`, `parse`, `format`, `relative`, `isAbsolute`. So `path`
  is a badly incomplete surface whose only two green cells are hollow, not a
  nearly-working module with a harness bug, which is what my first description
  of this row implied. The two readings call for opposite work.

  This row is the reason the sweep runs sabotage on the compiled lane and not
  only the interpreted one: without it, `path` reports two passes and nothing
  says they are worth nothing.

`c-did-not-compile` covers 15 modules and is the least informative outcome in
the table — it is one word for at least four distinct compiler refusals plus, in
`dgram` and `timers`, a native half that does not exist to link against.

### Provenance, because a sweep that outlived its tree says nothing

Three commits landed inside the run's window (`05:50:14`–`06:01:45`). All three
were confined to `runtime/web-platform/` and `tooling/conformance/web-platform/`,
which is another lane's. Checked rather than assumed, in three ways:

- no file under `runtime/node` was touched in the window
- no file under `runtime/web-platform/src` was **modified** — the only two src
  changes are *additions* of new files
- `web-platform-reach.mjs` reports **0 of 22** modules reach either new file

The build and test tooling the sweep itself reads — `build.sh`, `sweep.mjs`,
`run.mjs` — was not touched. So the run describes one tree. The reason this is
written down rather than trusted: five earlier sweeps were discarded for exactly
this, and a contaminated sweep is indistinguishable from a clean one in its own
output.

## Fifteen modules, and one front door

`c-did-not-compile` covers 15 rows and reads as fifteen problems. Pulling on
`path` — which *does* build — says it is substantially one.

`path` publishes four names: `_makeLong`, `delimiter`, `sep`,
`toNamespacedPath`. It does not publish `join`, `resolve`, `normalize`,
`basename`, `dirname`, `extname`, `parse`, `format`, `relative` or `isAbsolute`.

**The obvious explanation is wrong.** It is not the ABI — not variadics, not
object returns. `toNamespacedPath(path: string): string` publishes and
`normalize(path: string): string` does not, and those signatures are identical.
And the missing ten are not in `program.c` **at all**: `toNamespacedPath____posix`
is defined there, `normalize____posix` is not. They were never lowered, so no
wrapper ever had the chance to drop them.

The discriminator is the first line of the body:

    toNamespacedPath   return path;                    publishes
    normalize          validateString(path, "path");   never lowers

From there it is three calls, and the last one refuses:

    validateString                       internal/validators.ts:19
      new ERR_INVALID_ARG_TYPE(...)      renders the bad value into the message
        inspectString                    internal/errors.ts:401
          `\u${code.toString(16)}`       :440   NTS1001

`ERR_INVALID_ARG_TYPE` cannot build its message without rendering the offending
value, and rendering a control character means a hex escape. **So no module can
validate an argument, and validating an argument is the first thing every one of
node's entry points does.**

### The front door has fourteen locks, not one

That paragraph originally ended "the fifteen are not fifteen independent compiler
gaps; a large share of them are one shared front door", and the second half of
that was measured afterwards and came back worse.
`tooling/conformance/blocker-reach.mjs` runs `hir` over every module, normalises
each refusal to its *shape*, and counts distinct modules stopped. **Fourteen
shapes reach all twenty-one modules**, not one:

    reach  own  shape
       21   11  an erased value where a concrete representation is wanted
       21   10  X, a global member with no definition here
       21    9  X on a union, whose members lay their fields out differently
       21    9  a conversion to number from this type
       21    7  X of something without one
       21    5  an X against something this compiler has no class for
       21    5  `toString` on a number
       21    5  a conversion to string from this type
       21    4  an X narrowed to BigInt
       21    4  X on a typed array
       21    4  a base X of unrepresentable type
       21    3  a regular expression literal
       21    1  a parameter of unrepresentable type (a union of X | undefined)
       21    0  an X with options
       20   11  a method X with no declaration in the hierarchy

So the radix `toString` is **necessary and nowhere near sufficient**, and
`path.normalize` needs all fourteen cleared rather than that one. The claim that
survives is the shape of the problem — these are shared rather than per-module,
and they sit on `internal/errors.ts` and `internal/validators.ts`, which
everything imports. The claim that did not survive is that one of them was the
door.

**Read the table as a necessity ordering, not a sufficiency one.** A shape at 21
must be fixed for any module to clear the front door; fixing it alone clears
nothing. The number that would predict a module going green is "modules for which
this is the *last* remaining shape", and today that is zero for all fourteen.

**Reach is also not cost.** `computed-member-write` blocks a great deal and is a
representation decision worth a week; something blocking two modules may be an
afternoon. Cost-if-unfixed is not value-per-hour — a mistake this lane already
made once and wrote into that fixture, and a table sorted by reach quietly
re-makes it unless the caution travels with it.

The `own` column is the better one for choosing work: it counts modules where the
shape appears in the module's *own* source rather than in something it imports.

**The control was run rather than assumed**, because the claim was nearly
recorded without it: argument-less `code.toString()` lowers clean —
`1 function(s), nothing refused`. The radix argument is the entire refusal, which
is why `blockers/number-tostring-radix` passes a literal `16`.

Two more sit in the same inspector: a regex literal at errors.ts:469, which is
the regex-engine-sized item and not a small fix, and BigInt in a template at
:481, already fixtured as `narrowed-bigint`.

**Nothing here was worked around.** Deleting the hex escape from `inspectString`
would likely light `path` up, and `code.toString(16)` is how that line is
correctly written — so this is a fixture and not a patch, for the same reason
errors.ts still carries the regex literal.

## The compiled artifact, which is the gate, and its first green row


**`punycode` passes node's own tests as a compiled addon.** On the compiler as
it ships, from a clean build directory:

    node:punycode against node's own tests — target/node/punycode.node
      pass  test-punycode.js
      pass  local/error-identity-static.js
      2 file(s): 2 passed, 0 failed

**Not degenerate** — keep the addon's names and destroy its behaviour and both
files fail. **Not diverging** — 80,128 comparisons against node's own punycode,
0 divergences. **The deprecation warning is a real process event**, carrying
`DEP0040`, rather than a line of text on stderr.

It was **incomplete**, and the sweep said so on the row itself:

    | `punycode` | green | 2 / 2, incomplete: version absent |

`version` did not publish. The module passed every test it had while its surface
was one string constant short of node's, and that annotation exists precisely
because a first row on an axis that has only ever reported zero gets quoted.

**It publishes now**, at `f4b8595c`, and the row carries no qualifier:
`decode, encode, toASCII, toUnicode, ucs2, version`, all six agreeing, 2 of 2 on
the compiled axis. The resolution had been wrong in two ways — it named another
module's global rather than this one's, and it reported a global as a missing
function — and *"no function answers to this name" was never the same claim as
"this export is absent"*. The fixture that reported it,
`blockers/value-export`, is now a regression guard rather than a blocker.

**The stage table below predates this row and is otherwise current.** `punycode` lowers completely — 21 functions, nothing
refused, all of it verifying — builds to a 275KB `.node`, and computes
`decode`, `encode`, `toASCII` and `toUnicode` correctly on real vectors while
emitting DEP0040 through the native warning seam. Node's own test now fails on
`Cannot read properties of undefined (reading 'encode')` rather than on
`punycode.encode is not a function`: every assertion passes until it reaches
`ucs2`, an exported object literal of two functions, which the backend cannot
yet name. That measurement required routing around the annotated-const write
refusal locally; the workaround was reverted and is not in the tree, so the
figure is the compiled axis *with one gap bypassed* and is labelled as such
wherever it appears. The full traverse is in `nodejs-plan.md`.

### Measured with node's tests actually running

Every earlier figure on this axis came from `--addons --no-tests`, which reports
*where a module stops building*. That is a proxy. A module whose tests only
touch the exports that already publish would pass without anyone noticing, and
this document had been ranking by how much of a shape publishes rather than by
whether the tests pass.

Run properly, with node's own tests against each compiled addon:

    15  c-did-not-compile
     4  built-exports-nothing     buffer, querystring, string_decoder, url
     2  built-exports-partial     os (4 of 23), punycode (4 of 6)
     1  all-passes-degenerate     path (2 of 17)

**Nothing slipped through.** The proxy and the measurement agree, which is worth
knowing rather than assuming — and `punycode` has moved from
`built-exports-nothing` to `built-exports-partial`, the only cell on this axis
that changed today.

**Every blocker is a fixture now**, in `tooling/conformance/blockers/`, with
`blockers-check.mjs` re-measuring them against whatever compiler is current and
reporting `FIXED` loudly rather than as a pass. Two of the five are invisible to
`nts hir` — `f64[]` lowers cleanly and fails at the wrapper — so the runner
takes its command from the expectation rather than assuming one.

### All 22 modules, measured in one sweep

`sweep.mjs --addons --no-tests`, on a pinned binary. This is the compiled axis
entire, and the shape of the zero matters more than the zero:

| where it stops | modules |
| --- | :---: |
| `c-did-not-compile` | 15 |
| `built-exports-nothing` | 5 |
| `built-exports-partial` | 1 (`os`, 4 of 6) |
| `all-passes-degenerate` | 1 (`path`, 2 of 17, both degenerate) |

244 clang errors, of which **228 are one bug**: the struct emitter writes fields
of type `void`.

    struct NtsObj_Type1769 {
        NtsHeader header;
        void abort;  void close;  void start;  void type;  void write;
    };

That is a WHATWG `UnderlyingSink`; the neighbouring one is a `QueuingStrategy`.
With clang's error limit at 20 per module, 228 is a floor and not a count.

**The sentence that stood here was wrong, and correcting it split one bug into
two.** It read "object types whose members are functions or optional lower their
field type to `void`", which is a description of what the void structs have in
common rather than of anything that causes them. Two structs in the same
generated file disprove it, because they are only *partly* void:

```c
struct NtsObj_Type7151 {          struct NtsObj_Tuple249 {
    NtsHeader header;                 NtsHeader header;
    NtsString * kind;                 NtsValue _0_;
    NtsString * name;                 void _1_;
    NtsString * rawName;          };
    int32_t index_;
    void value;
    void inlineValue;
};
```

Four fields resolve and two do not, so void-ness is per field and "the struct
was emitted with nothing resolved" cannot be the rule. (The first count of this
said `ReadableByteStreamState` was partly void too. It was not: the pattern had
matched `void * __defaultReads`, a legitimate pointer. An instrument and the
thing it measures.)

**Optionality is exonerated, by control rather than by argument.** The obvious
suspect is the optional member, since `QueuingStrategy.highWaterMark?: number`
is void in the real output and an optional number is not an exotic type. Both
controls compile clean, emitting `NtsValue`:

```ts
interface Sink { type?: undefined; write?: (c: number) => void }
interface Strategy { highWaterMark?: number; size?: (c: number) => number }
```

So `undefined` alone is not sufficient either — `type?: undefined` is fine. It
is `undefined` as a **required** member that emits `void value;`, which is the
shape `util/src/parse-args.ts` declares in one arm of `ParseArgsOptionToken`,
and those two fields are exactly the two that voided. Fixtured as
`blockers/undefined-required-field`, and it reaches two modules and eight sites:
four in `util`, four in `http/src/parser.ts`, every one of them an arm of a
discriminated union.

That leaves the eight all-void structs — all Streams option dictionaries — as a
**second and still-unreproduced cause**; their standalone forms compile. Both
are the compiler lane's, and both are needed, because every one of the eight
also carries a `type?: undefined` or reaches something that does: repairing only
the second leaves a `void` field and clang still rejects the struct.

Worth naming about the shape of this blocker, since it is the first of its kind
here: **it refuses nothing**. `hir` is silent, `emit-c` reports success, and the
only thing that objects is clang. No refusal count could ever have shown it,
which is why it survived every measurement in this document until the generated
C was read directly.

Three modules — `async_hooks`, `diagnostics_channel`, `timers` — have one clang
error each (two for `timers`), and it is the same one: a closure pointer passed
where `nts_enqueue_microtask(NtsTask task)` declares a three-field struct.

**That one was not the compiler's, and it took following the symbol to find
out.** The chain runs from `program.c` through the enclosing `emitDestroy` to
`internal/async-hooks.ts`, where this profile had written

```ts
declare function nts_enqueue_microtask(callback: () => void): void;
```

in four files, claiming a runtime symbol whose real signature is the struct.
The lowering was faithful and the runtime was correct; a `declare function` had
taken a name that already meant something else, and nothing could see it until
the link. The binding is `nts_node_enqueue_microtask` now, with
`internal/microtask.c` adapting through the runtime's own `nts_callback_task`.

**The adapter is staged rather than working, and the reason is worth keeping.**
`nts_callback_task` takes a slot index, and the runtime calls straight through
it — `methods[entry->slot]` — so a wrong slot is a null call, not a type error.
The compiler assigns the closure's call slot after every named method in the
program, and the emitted vtables say what that means here:

```
async_hooks         { 0,0,0,0,0,0,0,0, Closure3__call }   slot 8
diagnostics_channel { 0,0,0,0,0, Closure18__call }        slot 5
buffer              { 0,0,0,0,0, Closure2__call }         slot 5
punycode            { Closure5__call }                    slot 0
```

The worst possible distribution for a hardcoded constant: `punycode`, the module
with no methods and the one anybody would test first, is the single program
where `0` is right. The three modules this was written for would have
typechecked, compiled, linked and crashed on their first microtask — a failure
that looks like success until it runs, and strictly worse than the clang error
it replaced. Neither this profile nor the runtime can derive the number, because
a descriptor's method table carries no count to scan; only `program.c` knows it,
and the compiler lane is publishing it as `nts_closure_call_slot`.

**Neither fix produces a passing module, and the distinction is the useful part
of this measurement.** Seven modules already compile — `buffer`, `os`, `path`,
`punycode`, `querystring`, `string_decoder`, `url` — and every one of them stops
at the export table rather than at clang. Fixing the microtask struct makes three
more modules compile and publish nothing; fixing the void fields makes twelve
more compile and publish nothing. **The first module that can actually pass is
still `punycode`, on the same two items**: an exported object literal of
functions, and the annotated-const write. Nothing in this sweep is ahead of them.

`tooling/conformance/blockers.mjs` prints the per-module version of this:
which exports published, which wait on a lowering and which on the backend
naming a kind of export, ranked by how many exports each chain root gates.

### The same oracle, asked more questions

Node's tests are a fixed set of inputs a human chose. Node itself is not: it can
be asked anything. `differential-ts.mjs` compares a module against
`node:<module>` on generated inputs, and `differential-addon.mjs` asks the same
of a compiled addon.

**It found a real bug in `querystring` on its first serious run** — 20
divergences over 4,000 generated queries, in a module whose four pinned files
all passed:

    parse("a&__proto__")   ours {"__proto__": "", "a": ""}
                           node {"a": "", "__proto__": ""}

`parse` has to give `__proto__` special treatment, because assigning it on an
ordinary object hits the legacy setter instead of creating an own property. The
special case built a fresh object with `__proto__` first and copied everything
already parsed in behind it, so **the key order depended on whether `__proto__`
appeared at all**. It is observable beyond enumeration:
`stringify(parse(s))` came back with the pairs reordered, which is how the
differential saw it. The fix is one line — spread first, computed key last — and
`querystring/test/proto-order-static.js` holds it: reverting the fix leaves
`test-querystring.js` green and fails only that file.

**And then a second, larger one in `url`.** `domainToASCII` and
`domainToUnicode` look like the IDNA mapping and are not: node parses the
argument as the *host* of a special-scheme URL and serialises the result, so
they inherit IPv4 shorthand, IPv6 canonicalisation, delimiter handling and the
forbidden domain code points. This profile applied the mapping to the whole
argument and returned it unchanged when it could not convert it:

    domainToASCII("http://a")          ours "http://a"   node ""
    domainToASCII("1.2.3.4//x#f")      ours ""           node "1.2.3.4"
    domainToASCII("0x7f.1")            ours "0x7f.1"     node "127.0.0.1"
    domainToASCII("[::FFFF:1.2.3.4]")  ours ""           node "[::ffff:102:304]"

**8,046 divergences over 4,000 generated URLs.** None of it is reachable by any
of the 45 pinned `url` files, and the 891-case WPT corpus this profile passes
does not reach it either — both test *URLs*, and this is a pair of functions
beside them. Fixed in three measured steps: the forbidden set took it from
8,046 to 178, delimiter truncation to 36, and routing through the parser's own
`parseHost` to 0.

The care went into what *not* to share. `http://a%2Fb/` percent-decodes to the
host `a/b`, which the URL Standard makes a parse failure; the public function
truncates at a `/` instead. One function served both, so the parser now keeps
`hostToASCII` — a host somebody already extracted — and `domainToASCII` works
out which part of its argument is a domain. **They were one function, and every
call site got whichever behaviour it happened to have.**

**And a third in `buffer`, three bugs in one layer.** `Buffer.from(str,
"base64")` does not see a JavaScript string: V8 writes one byte per UTF-16 code
unit — the low byte — and node decodes that. So `U+0452` is indistinguishable
from `"R"` (0x52), and `U+013D` terminates the payload exactly as `"="` does.
This profile indexed its tables by the whole code unit, making every character
above U+00FF a skip. Hex had the same defect.

Separately, `byteLength` counted only alphabet characters where node computes a
**bound from the length** — strip at most two trailing `=`, multiply what is
left. So `byteLength("A===", "base64")` was 0 against node's 1, and a
40-character string with no valid characters in it was 0 against node's 30.
That is the allocation `Buffer.from` sizes against, so it did not merely
misreport: **it truncated.**

4,142 divergences, cleared in three measured steps — `byteLength` to 1,330, the
base64 low byte to 12, the hex low byte to 0. None of it is reachable from
node's own 76 `test-buffer-*.js` files, and the reason is worth stating: there
is no reason to write a base64 test whose input is Cyrillic. **The oracle's
inputs are the ones a human thought to write down.**

Every rule here was verified against node rather than read off its source. The
padding-on-a-low-byte case was expected to go the other way.

**And a fourth in `util`, through an option nothing asserted.**
`util.format("%o", x)` is `inspect(x, { showHidden: true, depth: 4 })`, so every
`%o` in a program depends on `showHidden` — and an array was printing without
its `[length]`. 101 divergences over 800 generated format templates.

Arrays and typed arrays report their statically nameable hidden properties now.
Two gaps are asserted rather than left: a function's `[name]`, `[arguments]`,
`[caller]` and `[prototype]` are the function metadata §13 refuses, and a boxed
`String` prints its label where node adds `{ [length]: 2 }`.

Writing the function assertion taught me the first. **I expected `[Function: f]`
and the test failed** — a compiled function is a pointer, so its `.name` is the
same refusal that keeps `[name]` off the list. The expectation was wrong and the
implementation was right, which is the better way round and not the way it
usually goes.

Current state, all lanes:

| corpus | comparisons | divergences |
| --- | ---: | ---: |
| `punycode`, TypeScript | 16,128 | 0 |
| `punycode`, compiled addon | 80,128 | 0 |
| `path`, TypeScript | 36,234 | 0 |
| `querystring`, TypeScript | 16,076 | 0 |
| `url` incl. file URLs, TypeScript | 12,192 | 0 |
| `assert` incl. failure messages, TypeScript | 7,615 | 0 |
| `events` as a state machine, TypeScript | 6,040 | 0 |
| `fs` paths and error codes, TypeScript | 8,568 | 0 |
| `buffer`, TypeScript | 44,225 | 0 |
| `path` with `win32`, TypeScript | 42,882 | 0 |
| `string_decoder`, TypeScript | 14,688 | 0 |
| `util` (`format`, `%o`), TypeScript | 7,416 | 0 |
| `zlib` byte-for-byte, TypeScript | 3,130 | 0 |

**A corpus can assert a precondition, and `fs` is why.** It reads a directory
inside the repository; the base was a *relative* path, so from any other working
directory both sides would have answered `ENOENT` to everything, compared equal,
and reported perfect agreement over nothing. **That is this document's own
hollow-pass failure, appearing inside the tool built to find it** — and
comparison cannot catch it, because two identical failures are identical. A
corpus now declares what must be true, it is asserted against node rather than
compared, and a false one fails the run. Demonstrated by pointing the base at a
directory that does not exist: it stops and names it, where before it reported
2,268 comparisons and no divergences.

Eleven corpora. **Four found bugs and seven did not**, and the six matter: until
today the answer for each of them was that nobody had asked. `assert` compares
the full `deepStrictEqual` failure text, not only the verdict — an
implementation can decide every comparison correctly and print something else.
`events` is a state-machine fuzz over generated *programs*, because its
subtleties are all sequencing and no argument to `emit` makes
removal-during-emit happen. `zlib` is byte-for-byte against node's compressor at
three levels, not merely a round trip.

Two processes are needed on the TypeScript lane, because inside the
substitution `require("node:path")` and `require("path")` are the same object
and node's real module is unreachable from there. Inputs are generated once in
the host and handed to the probe as a file rather than regenerated from a shared
seed, so both sides answer identically the same questions instead of two
sequences that are supposed to agree.

**The differential runs inside the sweep now**, at 200 iterations, alongside the
three audits and for the same argument that put them there. All three bugs it
has found showed up in the first few hundred inputs — systematic divergences are
dense, and the long runs are for confidence rather than discovery. The full pass
over every corpus is `differential-ts.mjs --all`, worth running when a corpus
changes or an encoding is touched.

Both tools have a recorded negative control. The addon one crashed rather than
reported the first time it had a real defect to find; the TypeScript one yields
11 divergences when `querystring`'s original ordering is restored. **A check with
no demonstrated failure is a claim, not a measurement.**

### Where node's tests stop being a sufficient oracle

Node's pinned tests are the oracle for this profile, and for behaviour they are
a very good one. For a *compiled* artifact they have a systematic blind spot,
and it is worth stating because it will not announce itself.

The compiler lane came within one fixture of shipping a build where
`e instanceof Error` is false for every widened error in this profile — the
object laid out as the declared type, carrying the right `message`, the right
`name`, the right string form, and the wrong class. Their own fixture caught it.
**This corpus would not have.** Measured across the 22 modules:

    52 of 1,890 pattern-claimed upstream files assert a constructor or
    `instanceof` at all

and six modules have **none**: `punycode`, `path`, `string_decoder`,
`async_hooks`, `timers`, `readline`. Three of those six are the closest in the
profile to compiling.

That is not a flaw in node's tests. `parallel/test-punycode.js` asserts its
three throws with `/^RangeError: Invalid input$/`, matching the error's *string
form*, which is built from `name` and `message`. On node, `throw new
RangeError(...)` cannot produce something that fails `instanceof RangeError`, so
there is nothing there to test. **It is what an oracle looks like when the
invariant it would be testing cannot fail in the implementation it was written
against.** A compiled artifact is a different implementation, and it can fail.

The same shape covers every invariant that is free on node and not free when
compiled: object identity, prototype chains, error subclassing,
`Symbol.toStringTag`. `local/*-static.js` is where those belong, because upstream
will never assert them.

**What can be asserted is bounded by the substitution, and finding that out cost
a false alarm.** A probe reported `new Readable() instanceof EventEmitter` as
**false**, where node says true — which reads as exactly the class of defect
this section is about. It is not one. `stream`'s `uses` lists `buffer` and
`zlib/iter`, so `require("events")` inside that context is the *host's*
EventEmitter while `Readable` extends *this profile's*, and `instanceof` was
comparing two different classes. Asked properly, the chain is
`Readable -> Stream -> EventEmitter -> Object`, which is node's shape exactly.

So an `instanceof` assertion across two substituted modules is a claim about the
harness as much as the code, and it holds only when the second module is in the
first's `uses`. Within one module, and against the canonical globals a module
declares, the assertion means what it says. **The measurement was a claim about
the lane that produced it**, and the first reading of it was wrong in the
direction that would have sent a compiler session looking for a bug that is not
there.

These, by contrast, are real and hold today, and nothing asserts them:
`url.URL === globalThis.URL`, `url.URLSearchParams`, `buffer.Buffer`,
`buffer.Blob`, `buffer.File` and `buffer.atob`, each identical to its global.

**Export key order diverges in eight modules, and is recorded rather than
fixed.** `Object.keys(require(m))` is observable, and node's order is its
own module's assignment order. This profile's is **alphabetical** — and the
reason is worth knowing before anyone tries to fix one: `shape.mjs` spreads the
TypeScript module's namespace object, and a module namespace's keys are sorted
by specification. **No arrangement of `export` statements can change it.** The
only lever is a `shape.mjs` that names its keys explicitly, which is exactly
what `punycode/shape.mjs` does and says it does. Measured against node for all
22:

| module | first divergence |
| --- | --- |
| `dgram` | node `createSocket, Socket` — ours `Socket, createSocket` |
| `events` | node `addAbortListener, once, on` — ours `captureRejections, …` |
| `http` | node `METHODS, STATUS_CODES, Agent` — ours `Agent, ClientRequest, …` |
| `net` | node `SocketAddress, BoundSocket` — ours `BoundSocket, Server` |
| `process` | node `version, versions, arch` — ours `_events, _eventsCount, …` |
| `stream` | node `isDestroyed, isDisturbed` — ours `Stream, Duplex` |
| `url` | node `Url, parse, resolve` — ours `URL, URLSearchParams, Url` |
| `util` | node `_errnoException, …` — ours `TextDecoder, TextEncoder, …` |

**Exported function arity diverges too, and is recorded on the same terms.**
`fn.length` is observable and node's suite does assert it in places, though not
on any of these:

    querystring.unescapeBuffer     1  node 2
    url.URL                        0  node 1
    url.URLSearchParams            1  node 0
    url.fileURLToPath              2  node 1
    url.fileURLToPathBuffer        2  node 1
    util._errnoException           3  node 0
    util._exceptionWithHostPort    5  node 0
    util.isDeepStrictEqual         2  node 3
    events.EventEmitterAsyncResource  1  node 0

Several have visible causes — node's `_errnoException` is bound, so its `length`
is 0 where a plain declaration reports its parameters — and none is reached by a
pinned test, or the sweep would not be where it is. Listed so the next person to
find one knows it was seen rather than missed.

**Exactly one pinned test in node's whole `parallel/` suite enumerates a
module's keys** (`test-permission-fs-supported.js`, and the permission model is
not in this profile), so the oracle cannot see any of this. It is listed because
an unobserved difference is still a difference, and because `punycode`'s
`shape.mjs` goes out of its way to preserve node's insertion order — somebody
already decided this mattered, for one module, and the other twenty-one were
never checked.

**`util`'s entry was written up as "a regression this author introduced" and
that was wrong, which is worth keeping.** The claim was that `util`'s order
matched node's until the Encoding re-export went in at the top of `main.ts`. It
did not. Removing that pair from the comparison, `util` still diverges at index
2 — node has `callbackify` where this profile has `aborted`. The re-export
deepened an existing divergence and moved its first difference from index 2 to
index 0; it did not create one.

The check that caught it took one command, and the sentence had already been
committed. **A claim about the code, written in a document, with nothing
measuring it** is the same shape as the comment-versus-test rule recorded
elsewhere here — and this document asserts that rule two sections above the
place it broke it.

**Then the fix for it did nothing, and that was measured too.** Moving the
Encoding re-export next to `parseArgs`, where node has it, left `TextDecoder` at
index 0. The mechanism was misremembered twice: the order does not come from
this profile's source at all. It comes from the namespace object `shape.mjs`
spreads, and that is sorted. The statement now sits beside `parseArgs` because
node exports it there, and the comment says the move changed nothing.

Three exist now.

**`punycode/test/error-identity-static.js`** was the first, and it was proved by
mutation rather than assumed: replacing `throw new RangeError(m)` with a plain
`Error` carrying `name = "RangeError"` leaves `test-punycode.js` **passing** and
fails the new file with *"decode(" ") threw RangeError that is not a
RangeError"*. Upstream cannot see the defect; this can. **It then found a real
one on its first run against the compiled addon** — see blocker 6 in
`nodejs-plan.md`.

**`path/test/error-identity-static.js`** is the same for
`ERR_INVALID_ARG_TYPE`, which is the most-thrown error in the profile:
`validateString` is upstream of eleven of `path`'s exports by itself. Upstream
asserts it as `{ code, name }` — two own properties, both assignable to a plain
`Error`. Replacing `validateString`'s throw with exactly that leaves **all 17
upstream `path` files passing** and fails only this one.

**`buffer/test/uint8array-identity-static.js`** asserts that a `Buffer` is a
`Uint8Array`. **Zero** of node's 76 `test-buffer-*.js` files check that. It is
the most load-bearing structural invariant here — the relationship is what lets
a `Buffer` reach anything expecting bytes, and `fs`, `stream`, `net` and `zlib`
all move bytes through it. Unlike the other two it is *not* demonstrated by
mutation, and the file says so: the invariant is structural, so the TypeScript
edits that break it break indexing and every method with it, and upstream fails
too. What is checked is that it is not hollow — blanking the module fails it on
`Buffer.from` being undefined, so it is this profile's `Buffer` under test and
not the host's.

`check.sh <module>` without `--ts` builds a Node-API addon and runs node's own
tests against it. That is the artifact that ships, and the `--ts` lane is the
interim gate for a module whose prerequisites have not landed.

```sh
NTS_BIN=<a pinned copy> node tooling/conformance/sweep.mjs --addons --no-tests
```

reports every module and, more usefully, **where each one stops** —
`emit-refused`, `c-did-not-compile`, `built-exports-nothing`,
`built-exports-partial`, or `green` — with the clang error-class histogram. The
stage is the actionable half: a count of "not green" tells a compiler session
nothing, and the stage tells it which pass to look at.

The last two are split because after the export-table fix below they mean
different work. **Nothing published** means every name the module exports is a
class, or a `const` bound to a native function; the blocker is class values
crossing the ABI. **Some published** means the table is right as far as it
goes and the absent entries are the ones whose types cannot cross — an object
return, an array return. `os` is the second kind and `string_decoder` will be
the first.

That command exists because this axis had a result before it had an
instrument. It was first measured by a shell loop typed by hand, whose first
version mis-parsed its own output and reported every module as failed. A
hand-typed loop is not something a later reader can re-run to check the claim,
which is the objection this document already makes to a hand-copied table.

Measured across all twenty-two modules with one pinned binary
(SHA-256 `38a8de6d…`):

**The axis moved for the first time, and what it moved to is a segfault.**
The compiler session fixed the defect where a function refused at emit time had
its body dropped and every call to it left standing. Across that one binary:

```
c-did-not-compile   17 -> 15
punycode   c-did-not-compile -> compiles, publishes decode/encode/toUnicode/toASCII
url        c-did-not-compile -> compiles, publishes 1 name
```

`punycode` is the first module in this profile to produce a loadable compiled
artifact. **It dumps core on its first real call.**

```
require('target/node/punycode.node').encode('')              -> ""
require('target/node/punycode.node').toUnicode('example.com')-> "example.com"
require('target/node/punycode.node').encode('a')             -> SIGSEGV
require('target/node/punycode.node').decode('abc')           -> SIGSEGV
```

The two that work are the two that return before touching the string's
contents. Everything that iterates it dies.

**And it is not a `punycode` bug.** `querystring` compiles too, publishes
`escape`, and fails with an identical signature:

```
querystring.escape('')    -> ""
querystring.escape('a')   -> SIGSEGV
```

Two independently written modules sharing no code — `punycode.encode` goes
through `ucs2decode`, `querystring.escape` through `encodeStr` and a lookup
table — and in both **the empty string works and any non-empty string dies.**
The string object arrives and its length reads as zero correctly; it is
indexing past that point that kills the process. The common factor is string
element access in compiled code, not a missing symbol.

That withdraws the first guess recorded here. `punycode.encode` calls the
still-refused `ucs2decode`, which made the dangling-call defect an attractive
explanation; it does not explain `querystring.escape`, which calls nothing
refused.

**Diagnosed, and it was neither of the two candidates below.** The compiler's
next binary answered it in its own diagnostic text:

```
querystring/src/main.ts:118  NTS1003 `escape` cannot be compiled because it reads
                             `noEscape`, whose initializer was lost with the module
                             evaluation refused above
punycode/src/codec.ts:236    NTS1003 `encode` ... reads `delimiter`, whose
                             initializer was lost ...
```

**It was reading a module-level constant whose initializer never ran.**
`module#init` is refused, so the module's top-level bindings have no
initializer, and the previous binary emitted the read anyway — of uninitialized
memory. The empty-string paths were not avoiding per-character work; they were
avoiding *module state*. `escape` returns on `len === 0` before touching
`noEscape`; `encode` returns before reading `delimiter`.

**So the export tables collapsing in that binary is correct behaviour, not a
regression.** `punycode` 4 names to 0, `querystring` 1 to 0, `os` 11 to 4,
`url` 1 to 0 — because the compiler now refuses a function that reads a lost
initializer instead of emitting a read of uninitialized memory. Zero exports
beats four that segfault. `built-but-crashes` went 2 to 0 in the same run, and
`c-did-not-compile` 15 to 14.

**This is the memory-unsafe form of a failure this document already records.**
*Conventions* notes that module-level statements were once dropped silently,
costing twenty-three statements across this profile including all of IDNA in
`url`, and that they run now as a `module#init` an embedder calls first. What
had not been established is what happens when that init is *refused* rather
than absent: the reads still emitted, and the failure stopped being a wrong
answer and became a crash.

How far it reaches, counting `initializer was lost` per module:

```
process 30    os 12    url 12    querystring 6    punycode 2
```

`module#init` is upstream of the export table for at least five modules. For
`punycode` it is now the *entire* remaining distance to publishing — the
`emitWarning` roots in `internal/process-warning.ts` are what block it, since
`ucs2decode` costs only `ucs2` itself.

The backtrace, from the compiler session, names it in one frame:

```
SIGSEGV in nts_concat_into (into=0x0, a=0x7ffff7aff070, b=0x0)
   b is `delimiter`, and program.c holds
     static NtsString * delimiter = 0;
   with no module#init anywhere in the file.
```

And the lowering had *announced* it, in terms that are the bug rather than a
warning about it: *module evaluation … which the refusal above loses in full
and so will not run; **the program still builds**, and every module-scope value
it would have computed stays at its static initializer.* For a number a static
initializer of zero is a wrong answer. For a reference it is a null
dereference, and it was emitted knowingly.

**The narrowing below is kept because it was wrong, and it was wrong by one
step.** It intersected the crash paths against the working ones correctly and
produced two false candidates. The early returns fire before *the null global
is read* — not before per-character work. Same two data points, one inference
short. And the second candidate looked strong for a reason worth keeping:
`querystring` has fourteen null globals and `noEscapeTable` is one of them, so
indexing it really is where the process dies — the array is null, not the index
wrong.

**A crashing artifact does not need this kind of reasoning at all.** `clang -g
-O0` over the emitted `program.c` with a four-line `main`, then
`gdb -batch -ex run -ex bt`, takes about ninety seconds and names the variable.
Two hours of intersecting behaviours produced two wrong answers where the
disassembly had the right one for free, and it does not touch the corpus.

**Narrowed to two candidates by intersecting the crash paths against the
working ones.** Both working paths return before any per-character work —
`encodeStr` at `internal/querystring.ts:52` on `len === 0`, `ucs2decode` by
never entering its loop. What both crash paths do and neither working path
does:

| candidate | `encodeStr` | `ucs2decode` |
| --- | --- | --- |
| `str.charCodeAt(i)` on a non-empty string | `let c = str.charCodeAt(i)` | `str.charCodeAt(counter++)` |
| indexing a `number[]` | reads `noEscapeTable[c]` | writes `output[outputIndex++]` |

They cannot be separated from behaviour alone. `ucs2decode` calls
`new Array<number>(str.length)` before its loop, so pre-sized allocation runs
for the empty string too — at `n = 0`, which would work under a bug that only
bites at `n ≥ 1`. `encodeStr` allocates nothing, which is why `charCodeAt` is
the stronger candidate, but it indexes a module-level constant array
immediately afterwards.

Separating them needs an artifact exporting a function that calls `charCodeAt`
and nothing else. That cannot be built from here without adding a function to
node's source purely to probe the compiler, which is the thing this document
forbids for better reasons than this test is worth.

**This document's own instrument was hiding both, which is why the stage list
now has a `built-but-crashes`. It is the worst of the day's instrument
failures, and not for the reason first recorded here.** The others reported
success while measuring nothing. This one did not fail to measure — it
*measured and misclassified*, and a misclassification survives scrutiny in a
way silence does not. Someone reading `built-exports-partial 0 / 4` would go
looking for missing exports, find them, and be right about everything except
what mattered. The sweep reported `punycode` as
`built-exports-partial 0 / 1, 4 names published` and `querystring` as
`0 / 4, 1 name published` — which reads as *the test failed for want of
exports* and is indistinguishable from `os`, whose surface genuinely is
incomplete. **Two of the four artifacts that build were segfaulting and both
were being reported as coverage gaps**, and on an axis that has never had a
pass they would have gone on being reported that way indefinitely. A crash and a coverage gap want completely different work, and it
was found only by running the test by hand to check a prediction about why it
had failed. The sweep loads each artifact in a child process and calls every
export once before it judges anything now; a segfault reported as a missing
export is worse than no report at all.

**The axis is still at zero on passes, and the two that once said otherwise are
the reason this document keeps a hollow column.** `path` reports 2 of its 17
against the compiled artifact, and both are degenerate. They are:

```js
assert.strictEqual(require('path/posix'), require('path').posix);
assert.strictEqual(require('path/win32'), require('path').win32);
```

The addon publishes exactly one name, `toNamespacedPath`. `path.posix` and
`path.win32` are both `undefined`, so each assertion compares `undefined` with
`undefined` and holds. Nothing about the module is being measured; the test is
satisfied by the surface being *equally absent* on both sides.

**Sabotage does not catch this one, and the reason is worth keeping.** Blanking
the module makes both files fail — so the hollow column reads 0 — but they fail
because the subpath stops resolving, not because the comparison stops holding.
The control fires for the wrong reason and reports a clean bill. That is the
second time this document has recorded a pass that survives its own control:
the first was `test-console-self-assign.js`, satisfied by assigning a writable
global to itself.

So the honest headline is unchanged from the previous measurement: **no
module's compiled artifact passes a test that measures it.** I published the
opposite for about twenty minutes on the strength of a number I had not asked
the standard question of, which is the question this file exists to insist
on — *what would this test have to see to fail?*

**The instrument asks it now, so the next one does not depend on somebody
remembering.**

```sh
node tooling/conformance/run.mjs --module path --addon <artifact> --mutate-addon
```

keeps the addon's exported names and destroys their behaviour: every exported
function throws, every exported value becomes something nothing expects. A file
that still passes did not depend on what the module *does*. `--addons` runs it
against every compiled pass automatically and subtracts the survivors, so a
module whose passes are all degenerate reports `every-pass-hollow` rather
than a number — which is what `path` reports today, `2 / 17, 2 degenerate`.

That stage was called `all-passes-degenerate` until 2026-09-08, when it misled
its own author into writing "every test passes" in a summary table. Rows recorded
above under the old name keep it, because they record what the tool printed.

The distinction from sabotage is the whole point and is worth stating in one
line: **sabotage removes the module and asks whether the suite is connected to
it; mutation keeps the module's shape and asks whether a pass depends on its
behaviour.** The first is a control. Only the second has resolution, and the
compiled lane had only the first until a pass it could not see through was
published.

| stage reached | modules | |
| --- | ---: | --- |
| `c-did-not-compile` | 17 | |
| `built-exports-nothing` | 2 | `buffer`, `string_decoder` — everything they export is a class |
| `built-exports-partial` | 2 | `os` (11 names), `querystring` (1) — the table is right, the absent entries cannot cross the ABI |
| `partial` | 1 | `path`, 2 / 17 — **both degenerate; see above** |
| `green` | 0 | |

Measured with a pinned `nts` whose SHA-256 begins `982ffe1f`, carrying the
compiler session's layout-merge and export-table fixes. It is a copied binary
rather than a commit because those fixes were still in their gate when this was
taken; the figures get re-anchored to a commit when there is one.

What moved, against the `38a8de6d` row above: `path` from one clang error to
compiling at all, which is real even though its passes are not; `async_hooks` 2
errors to 1; `zlib` 16 to 15; `http` 21
to 20; the whole `use of undeclared identifier` class gone. And the four
export tables shed the foreign names they had been carrying — `os` 15 published
to 11, `querystring` 5 to 1, `buffer` and `string_decoder` to none at all.
**Those last two going to zero is the fix working, not a regression**: their
surface is classes, and the four names they used to publish were `buffer`
internals that were never theirs.

**The export tables are short for two causes and one cascade, and the cascade
is where the leverage is.** I recorded a third cause here — optional and
defaulted parameters — on the strength of four published names taking only
required parameters and four unpublished ones taking optional ones. **That was
a coincidence in a sample of four.** The compiler session asked the compiler
instead of the signatures:

```
os/src/main.ts:410  NTS1003 `getPriority` cannot be compiled because it calls
                    `validateInt32`, which was refused above
```

`getPriority` and `setPriority` never reach the N-API wrapper at all. They are
refusal *cascades*, and following one down lands on a single root:

```
internal/validators.ts:21  `validateString`   ... calls `ERR_INVALID_ARG_TYPE#constructor`
internal/validators.ts:27  `validateObject`   ... calls `ERR_INVALID_ARG_TYPE#constructor`
internal/validators.ts:33  `validateNumber`   ... calls `ERR_INVALID_ARG_TYPE#constructor`
internal/validators.ts:39  `validateBoolean`  ... calls `ERR_INVALID_ARG_TYPE#constructor`
internal/validators.ts:68  `validateFunction` ... calls `ERR_INVALID_ARG_TYPE#constructor`
```

**`ERR_INVALID_ARG_TYPE` is the validator node's internals reach for
everywhere,** so one refused constructor takes every argument-validating
function in the profile with it — which is most of the public surface, because
node validates its arguments everywhere. Its own roots are five refusals in
`internal/errors.ts`: an `instanceof` against a class the compiler has none
for, `Array.isArray` of an open type, `JSON.stringify`, a regular-expression
literal, and an `unknown` narrowed to BigInt.

That is better news than the cause I inferred. Optional parameters would have
bought `querystring` two names and `os` two. A cascade is a tree, so the
leverage is at the root and it is profile-wide.

**Every absence has one of four shapes and they are distinguishable without
editing a line of source:**

```sh
NTS_TSGO=<tsgo> <nts> emit-c runtime/node/<mod>/tsconfig.json --out /tmp/x --napi 2>&1 | grep <name>
```

`no wrapper for X: <reason>` — the N-API wrapper declined it.
`NTS1001` — the lowering refused it.
`NTS1003` — something it calls was refused; follow it to the root.
*silence* — it is not a function at all, like `export const totalmem`.

**Measured: the cascade is larger than the refusal in every module checked,
and the ledger's refusal count excludes it.**

Profile-wide the cascade is 4,033 diagnostics, of which 744 name a validator
or `ERR_INVALID_ARG_TYPE` as their *immediate* cause — `fs` 115, `http` 89,
`zlib` 49, `stream` 46, `dgram` 44. The transitive share rooted there is larger
and is not computed here.

| module | root refusals (`NTS1001`) | cascaded (`NTS1003`) | what this file's `refused` column says |
| --- | ---: | ---: | ---: |
| `os` | 100 | 127 | 100 |
| `querystring` | 101 | 126 | 101 |
| `string_decoder` | 97 | 129 | 97 |
| `buffer` | 93 | 123 | 93 |
| `path` | 33 | 52 | 33 |

The `refused` column matches `NTS1001` exactly in all five, so **6,866 counts
root refusals and is not inflated by cascades** — the concern that it might be
does not survive the check.

**The bias runs the other way, it has a direction, and it is large.** A
cascaded function is counted neither as lowered nor as refused, so it leaves
the measurement entirely. Profile-wide there are **4,033 such diagnostics**
against 12,181 lowered and 6,866 refused:

```
counted    12,181 lowered + 6,866 refused = 19,047
invisible   4,033 cascaded, in neither column
rate as recorded                       64.0%
rate if each cascade is one function   52.8%
```

Eleven points, and the direction is what makes it a bias rather than
imprecision. **The functions a root refusal blocks are exactly the ones it
removes from the denominator** — `ERR_INVALID_ARG_TYPE#constructor` takes the
whole validator layer out of both columns, and the validators are the
population its refusal is *about*. So the more leverage a root has, the more of
its own impact it hides, and closing a high-leverage root will move the rate
*less* than closing a trivial one, because it drags a pile of previously
uncounted functions into the denominator as it lands.

Stated as inference on one point: whether each `NTS1003` line is one function
or one call site is not established here, so 4,033 is an upper bound on the
invisible population and 52.8% a lower bound on the rate. The direction of the
bias does not depend on which it is.

**`call to undeclared function` is two different bugs wearing one error
message,** which is worth separating because only one of them announces
itself:

- **`punycode`** refuses `error` — `NTS2002 a value of type ``never`` reached
  code generation`, against `function error(type: ErrorType): never` in
  `codec.ts` — and then emits its **eight call sites anyway**. A refusal that
  leaves its callers behind stops being a refusal and becomes a link error.
- **`net`** calls `updateReadableListening` and two
  `PriorityQueue_4047___percolate*` methods that are **neither emitted nor
  refused**. Nothing in the build output mentions them. That is the same
  outcome reached silently, and it is the worse of the two: a named refusal is
  a measurement and a missing symbol is not.

None of it is a defect in this profile: every one of those modules is 100% green
on the TypeScript-on-node lane. The split is entirely between `emit-c` output
and clang, so it is recorded here and reported to the compiler session rather
than worked around — a refusal that gets quietly avoided stops measuring
anything, and rewriting these modules to emit compilable C would destroy the
one thing this corpus is for.

**The clang error classes, whole corpus, counted against one binary.** The
counts below were taken with the `nts` whose SHA-256 begins `38a8de6d` —
approximately the compiler session's `b6a4a83` plus its then-uncommitted
`ManagedType::View` work, which they committed afterwards as `b5e732ef`.
Anchoring them matters more than usual here: a class going from 57 to 6 has to
be readable as a fix landing rather than as a second count of a moved target,
so when a class is closed the new figure gets a new binary next to it.

| count | error |
| ---: | --- |
| 57 | `no member named 'X' in 'NtsObj_Y'` |
| 23 | `field has incomplete type 'void'` |
| 22 | `call to undeclared function 'X'` |
| 16 | `redefinition of 'X'` |
| 16 | `operand of type 'NtsValue' where arithmetic or pointer type is required` |
| 11 | `passing 'NtsObj_ClosureNN *' to incompatible type 'NtsTask'` |
| 6 | `static assertion expression is not an integral constant expression` |

Two of those are worth separating from the rest. The missing-member class is
not scattered: `NtsObj_Context` is emitted without `loose`, `pairs`,
`breakLength` or `budget`, and `NtsObj_DuplexOptions` without `a`,
`backpressure` or `signal`, while code in the same file reads them — and the
layout `static_assert`s in those same files are failing. That reads as one
layout decision disagreeing with itself rather than seven omissions. And
`call to undeclared function 'PriorityQueue_4047___percolate…'` in `net`,
`readline` and `timers` is a generic instantiation referenced but never
emitted.

**`path` is diagnosed, and it is a layout merge.** The compiler session took
the reproducer below and found the cause; recorded here because the error text
points somewhere else entirely. Node's `path` has

```js
function normalizeString(path, allowAboveRoot, separator, isPathSeparator)
```

whose fourth parameter is a *function*. It is emitted as

```c
NtsString *normalizeString(NtsString *, bool, NtsString *, NtsObj_Ctor_Error *);
```

— the `Error` **constructor**. `nts_vtable_NtsObj_Ctor_Error` is the only
vtable in the whole program, and the call slot it names is a closure's,
attached to the wrong layout. `Ctor_Error` is a class-used-as-a-value, so its
layout is deliberately empty; a function-type layout is deliberately empty too.
Layout merging asks whether two shapes are the same, and cannot tell two empty
things apart. Guards exist for error classes, for signature layouts and for
constructor tokens, and each requires the *same* family on both sides — so the
three same-family pairs are guarded and the three cross-family pairs are not.
`path` is token × signature.

The invariant, stated by that session and worth keeping here because this
document is where its consequences are counted: **a layout whose name is its
identity must not merge with any differently-named layout, whatever family the
other is in.**

**The prediction that went with it was wrong, and this is the entry that says
so.** I wrote that the 57 missing-member errors looked like the same mistake
seen from the other side, and that some of them might fall out with the `path`
fix; the compiler session said the same and made it the first thing they would
check. Measured, A/B with one corpus and two binaries: `async_hooks` 2 clang
errors to 1, `path` 1 to 0 and compiling, `zlib` 16 to 15, every other module
unchanged. The `NtsObj_Context` errors are untouched, and they are the
*opposite* defect — two distinct layouts both named `Context`, each emitting
`struct NtsObj_Context`, which is over-separation rather than over-merging, and
the size assertion catching precisely what it was put there for. Two people
predicting the same wrong thing is worth as much shelf space as either of them
being right, which is why it stays here instead of being edited out.

**The export table is fixed and the fix makes some tables empty, which is
correct.** `Func::exported` was set from the `export` modifier, which does not
know which file it is in, so the table was every `export` in the linked
program — that is why a `string_decoder` addon carried a Blob revoker. It is
now the entry module's export list. `string_decoder` and `buffer` publish
nothing at all afterwards, and that is the honest answer rather than a
regression: their surface is classes, the four names they used to carry were
`buffer` internals that were never theirs, and class values crossing the ABI is
separate and much larger work. `os` keeps its eleven, and its twelve absent
ones now separate into two causes — four return objects or arrays that cannot
cross the ABI, and three are `export const totalmem = nts_os_totalmem`, a const
bound to a native function, which is not a function declaration and so was
never in the table to be filtered.

**Two modules fail on a single clang error each, which makes them the cheapest
things on this list to look at.**

```
path:   program.c:1464:78: use of undeclared identifier 'Ctor_Error__call'
        static void *const nts_vtable_NtsObj_Ctor_Error[] =
            { 0, 0, 0, 0, 0, (void *)Ctor_Error__call };

events: program.c:6109:27: passing 'NtsObj_Closure27 *' to parameter of
            incompatible type 'NtsTask'
            nts_enqueue_microtask(v17);
```

And a tuple whose second element lowered to nothing, which is the
`incomplete type 'void'` class in one picture:

```c
struct NtsObj_Tuple2206 {
    NtsHeader header;
    NtsValue _0_;
    void _1_;
};
```

**The four that link fail for a sharper reason than "it did not initialize",
and it is worth reading the export tables side by side.** `buffer` 0/51, `os`
0/6, `querystring` 0/4, `string_decoder` 0/3, every one at load. The addons
load fine; what they contain is wrong:

| addon | what it exports |
| --- | --- |
| `string_decoder` | `utf8Length`, `normalizeEncodingName`, `byteLengthIn`, `revokeObjectURL` |
| `buffer` | the same four, and nothing else |
| `querystring` | those four, plus `escape` |
| `os` | those four, plus `hostname`, `type`, `release`, `version`, `machine`, `arch`, `platform`, `homedir`, `tmpdir`, `endianness`, `uptime` |

Three things are wrong with that and they are probably one bug.

**Every addon carries the same four foreign names.** `normalizeEncodingName`
and `byteLengthIn` are internal helpers in `buffer/src/encodings.ts`;
`revokeObjectURL` is in `buffer/src/blob.ts`. A `string_decoder` addon has no
business exporting a Blob function. These are private helpers of a
transitively-imported module appearing as the module's public surface.

**The module's own exports are missing.** `string_decoder/src/main.ts` exports
the `StringDecoder` class and the addon contains none of it — which is exactly
what *SD is not a constructor* means. `querystring/src/main.ts` exports
`QueryString`, `parse`, `stringify`, `unescape`, `decode` and `encode`; the
addon has `escape` alone.

**What survives in `os` says what the filter is.** The eleven that made it are
exactly the ones returning a string or a number. Everything returning an object
or an array — `constants`, `cpus`, `networkInterfaces`, `userInfo`, `loadavg` —
is gone, as are the values that are not functions at all, `EOL` and `devNull`.
A class (`StringDecoder`) and an object literal (`QueryString`) do not survive
either.

Read together: **the N-API export table is not the module's export list.** It
looks like the free functions with scalar-representable signatures, gathered
from the whole linked program rather than from the module being built. No
`shape.mjs` can repair that — the functions are not in the artifact to be
reached — and each of those four `shape.mjs` files was checked against its
module's real exports before this was written, so the facade is asking for the
right things.

Ten of the twenty-two builds also print `no wrapper for module#init: a class
member`, and see *A compiled module was missing its initialization entirely*
under **Conventions** for what a missing initializer costs. But `os` and
`querystring` print no such refusal and still fail, so the export table is a
defect in its own right rather than a consequence of that one.

### The axis has never once reported a pass, including to itself

Worth separating from the compiler's side of it, because it is a fact about
this document's instruments rather than about `nts`.

**No module's compiled artifact has ever produced a single non-degenerate
pass.** Not one, across twenty-two modules, in every measurement taken. Which
means the stage classification, the mutation check and the distance ordering
below all measure a quantity that has only ever been zero — and
`sweep.mjs --addons` has never had to print `green`. An instrument that has
never returned a positive result has not been tested against the case it
exists for. The `green` branch is unexercised code in a checking tool, which
is precisely the category this file keeps finding things in.

So the first green module, whenever it arrives, tests two things: the compiler,
and whether this apparatus can recognise success when it sees it. The second is
not rhetorical — the one time this axis reported passes at all, they were
`undefined === undefined`, and the control in place at the time said clean.

**That half no longer has to wait for the compiler.** A positive control lives
in `tooling/conformance/positive-control.cjs`: `punycode`'s own TypeScript,
handed to the instrument through the `--addon` path. Not a compiled artifact
and not pretending to be one — a subject whose answers are known good.

```sh
node tooling/conformance/run.mjs --module punycode      --addon tooling/conformance/positive-control.cjs                 # 1 passed
node tooling/conformance/run.mjs --module punycode      --addon tooling/conformance/positive-control.cjs --mutate-addon  # 0 passed
```

The first says the pass path works, so **a zero on this axis is the compiler
and not the harness** — a claim that had been assumed all along and never
checked. The second is the false-positive test on the mutation detector, which
had only ever been shown to fire when it *should*: a real pass is not called
degenerate.

**Building it immediately found a defect in the harness.** `--addon` was
resolved in the child, which runs with `cwd` set to node's checkout so upstream
tests resolving `./test/...` find it — so a relative `--addon` resolved against
`third_party/node` and reported `Cannot find module` naming a path nobody had
typed. Every existing caller passed an absolute path, so nothing had ever hit
it. `run.mjs` resolves it against the caller's directory now.

### Past the compile barrier there are exactly two blockers

Eight of twenty-two modules compile now, up from four this morning. That is
enough to characterise what stops the ones that get that far, and it is not a
long tail:

| module | compiles | publishes | what stops it |
| --- | :---: | ---: | --- |
| `path` | yes | 1 | class values — its surface is `posix`/`win32` namespaces |
| `buffer` | yes | 0 | class values — `Buffer` is a class |
| `string_decoder` | yes | 0 | class values — `StringDecoder` is a class |
| `punycode` | yes | 0 | `module#init` refused, via `emitWarning` — 2 functions lost |
| `querystring` | yes | 0 | `module#init` refused, via a closure call — 6 lost |
| `os` | yes | 4 | `module#init` refused, via `readConstants` — 12 lost |
| `url` | yes | 0 | `module#init` refused, via a closure call — 12 lost |
| `process` | yes | 0 | `module#init` refused, via `refreshEnvironment` — 30 lost |

**Measured demonstration that this is a choke point rather than a queue.** Two
of `punycode`'s three blockers were closed in one compiler change —
`ucs2decode` as a function value, and `a call of a function value in a program
with no closures`, which went with it because that refusal fires only when the
program has no closure slot at all. Both real, both gone. The artifact axis did
not move by one:

```
before   14 c-did-not-compile   6 built-exports-nothing   1 partial   1 degenerate   0 green
after    14                     6                          1           1              0
```

`punycode` still publishes nothing, because its one remaining root — `code`,
which `Error` does not declare — still refuses `module#init`, and everything
else in the module is a cascade from that. Closing two of three left it exactly
where it was. **A module behind a refused initializer does not get closer to
publishing until the initializer runs**; there is no partial credit, which is
what distinguishes a choke point from a list.

**Two causes, five modules and three modules.** `module#init` being refused
costs **62 functions across five modules**, none of them individually a
language feature — every one is a cascade from a single initializer that did
not run. The other three publish nothing because their entire public surface is
classes, which is the ABI question and a much larger one.

The four immediate causes of the refused init are different — `readConstants`,
`refreshEnvironment`, `emitWarning`, and a closure call in two modules — and
their own roots differ again: a call of a function value, a regular-expression
literal, `this` outside a method, a name from an enclosing scope. So this is
not one fix.

**And none of it is this profile's to fix, which was checked rather than
assumed.** The one category that would be ours is a place where this source
*deviates* from node's and the deviation causes a refusal — that would be a
fidelity bug, and correcting it would improve faithfulness and reduce refusals
at the same time. Checked at the roots:

| refusal site | ours | node's |
| --- | --- | --- |
| `internal/validators.ts:15` | a regex literal, `LINK_HEADER_VALUE` | `internal/validators.js:59`, `const octalReg = /^[0-7]+$/` |
| `internal/net.ts:54` | `Number.parseInt(part, range)` | `NumberParseInt` from `primordials`, which *is* `Number.parseInt` |

Same constructs. The `primordials` difference is the one *Conventions* already
prescribes — node destructures its primitives to survive a program that
reassigns `String.prototype.slice`, and a compiled program has no such
prototype — so the ordinary spelling is the faithful one here rather than a
deviation. **There is no source change available in this lane that would be
anything other than rewriting node's library to suit what lowers.** What it is, is **one choke point**: five export tables are empty
for the same structural reason, and each is one initializer away from
publishing rather than a module's worth of features away.

### The shortest path to one green module

Nothing on this axis is close, but `punycode` is closest and it is worth
naming exactly, because "0 of 22 and blocked" is not a target and this is.

It has **one** applicable test file, and its whole public surface lowers —
`encode`, `decode`, `toASCII` and `toUnicode` draw no diagnostic at all, and
the N-API wrapper declines none of them. Three named things stand between that
and a green row:

Three blockers when this was written. **Two are closed and one remains:**

| blocker | state |
| --- | --- |
| `NTS2002`, `error(type): never` refused with its eight call sites emitted anyway | **closed** — it was the segfault, not a compile error |
| `NTS1001 ucs2decode, a function used as a value` | **closed**, and it closed `a call of a function value in a program with no closures` for free: that refusal fires when the program has no closure slot at all, and wrapping `ucs2decode` gave the program a closure |
| `NTS1001 code, which Error does not declare` | **open**, and not cheap |

The last one is `internal/process-warning.ts:55`:

```ts
interface ProcessWarning extends Error { code?: string }
const warning: ProcessWarning = new Error(message);
if (code !== "") warning.code = code;
```

An `Error` is allocated with `message` and `name`; the declared type says it
also has a `code` slot, and there is nowhere to put the value. The honest
repair allocates at the *declared* type, which base-first layout makes cheap to
upcast — but the descriptor then belongs to `ProcessWarning`, so
`warning instanceof Error` stops holding unless the provided-error hierarchy is
taught about it. **That is a class-values feature, not a lowering arm**, and
the compiler session has declined to put a number on it. Recorded that way
rather than as one item left, because a distance table that counts it as one
would be lying by arithmetic.

**A third item recorded here was withdrawn.** String-literal `const` folding
for `delimiter` was named as a blocker and is not one: the refusal is at *read*
time, firing only when `module#init` is absent, so if the initializer runs
`delimiter` is assigned and nothing needs folding. It was an optimisation
mistaken for a requirement by someone who had just been looking at the null
pointer it caused.

That is the complete list for the smallest module in the profile — three
compiler features for one test file.

**And `punycode` is not merely first, it is in a different league.** Counting
the distinct `NTS1001` refusal *kinds* each module's emit reports — a proxy for
"how many compiler features stand in the way", with the message text
generalised so that the same refusal about two different names counts once:

| module | distinct refusal kinds | applicable tests |
| --- | ---: | ---: |
| `punycode` | **3** | 1 |
| `path` | **17** | 17 |
| `async_hooks` | **23** | 110 |
| `diagnostics_channel` | **24** | 32 |
| `timers` | **30** | 53 |
| `os` | **33** | 6 |
| `buffer` | **33** | 50 |
| `querystring` | **35** | 4 |
| `string_decoder` | **35** | 3 |
| `events` | **43** | 28 |
| `util` | **57** | 20 |
| `url` | **59** | 45 |
| `assert` | **61** | 10 |
| `process` | **62** | 69 |
| `console` | **69** | 17 |
| `readline` | **83** | 24 |
| `net` | **91** | 132 |
| `dgram` | **93** | 75 |
| `stream` | **103** | 241 |
| `zlib` | **106** | 66 |
| `http` | **122** | 396 |
| `fs` | **143** | 328 |

**Three, then seventeen.** Every other module in the profile is between six and
forty-eight times further from green than `punycode` is, and the two largest,
`http` and `fs`, need well over a hundred distinct features apiece.

This is the ordering the stage histogram does not give. `path` reaches
`all-passes-degenerate` and `punycode` does not compile at all, which reads as
`path` being ahead — and on distance it is six times behind. Where a module
*stops* and how far it is from *moving* are different measurements.

**And neither of them is a priority ordering, which is a correction to what
this section first said.** It claimed the distance column says "which one to
attack first". It does not. The compiler session put it better than I will:
*distance to green is a fine ordering when the destination is the thing you
want, and ordering by proximity is how you end up doing the four cheapest
things and none of the important ones.* A green Node module is this document's
goal; it is not the compiler's, whose goal is a compiler that does not emit
wrong answers. When those coincide it is luck.

They coincided for `punycode`, and the reason its first blocker is being taken
is **not** that it is closest. It is that a function refused at emit time has
its body dropped, a diagnostic pushed, and **every call to it left standing** —
the HIR pass that drops callers of refused functions runs earlier and cannot
see a backend refusal. C catches it at link time. A lane that resolves lazily,
or a call that is simply never reached, would ship it. That is a wrong answer,
and it would be worth fixing if this profile did not exist.

So read the column as what it is: **how far each module is from a green
artifact, and nothing about what anyone should do next.**

Two caveats on the column. Distinct refusal kinds is a proxy: some kinds are
one feature and some are a family, and cascaded functions are not counted at
all, so a module whose refusals are concentrated under one root is closer than
its number suggests. And it says nothing about the N-API side — `string_decoder`
needs 35 features *and* class values across the ABI, which is why its addon
publishes nothing today.

Reproduce any of it with one line:

```sh
NTS_COMPILER=<pinned> tooling/conformance/build.sh path
```

The generated C for the six informative modules is kept outside the tree at
`~/.cache/nts-node-addon-evidence/`, because a rebuild clobbers
`target/node/<module>.build`. It carries the emitting binary's SHA-256 beside
it. Nothing in it has been reduced or bisected by hand, deliberately: three of
these classes may be one bug, and hand-reduction would cost a day to establish
what one fix will show for free.

## The counted lane, run for the first time

The default provider never frees. That is fine for a bump-allocated program that
exits, and it makes a whole class of defect *structurally* invisible: a release
too few leaks where nobody looks, and a release too many is never observed.
`tooling/conformance/counted-lane.sh` builds every module that builds under
`NTS_CONFORMANCE_RC=1` — `--rc` on `emit-c` and `-DNTS_PROVIDER_RC` on clang,
both halves, since either alone compares a program that never releases against
an allocator expecting it to — with `-DNTS_POISON=1` riding along so a freed
slot reads `a5d03c3c3c3c3c3c` rather than a zero indistinguishable from a
legitimate one.

**Run over every module, not the seven that were known to build.** The lane's
list used to be hardcoded, and the first thing deriving it from `runtime/node`
produced was an error nobody had seen: `timers` had not been compiled since the
microtask binding was renamed, so `blockers/callback-binding` lived in a module
the instrument never built. Complete sheet, twenty-two modules:

| builds and runs | does not build |
| --- | --- |
| `buffer` `os` `path` `punycode` | `assert` `async_hooks` `console` `dgram` |
| `querystring` `string_decoder` `url` | `diagnostics_channel` `events` `fs` `http` |
| | `net` `process` `readline` `stream` |
| | `timers` `util` `zlib` |

Seven build, fifteen do not, and **`punycode` is the only one that passes** — 2
of 2, 55 retain/release sites, 80,128 differential comparisons against node with
0 divergences. The other six all fail at the export table or the shape rather
than at anything counting reveals, so the counted lane tells us nothing new about
them and says so.

| module | result | rc sites, before → after module evaluation |
| --- | --- | ---: |
| `buffer` | 0 passed, 54 failed, 41 n/a | 271 → 271 |
| `os` | 0 passed, 7 failed, 4 n/a | 203 → **303** |
| `path` | 2 passed, 17 failed, 1 skipped | 98 → 98 |
| `punycode` | **2 passed, 0 failed** | 55 → 55 |
| `querystring` | 0 passed, 6 failed, 1 n/a | 209 → **289** |
| `string_decoder` | 0 passed, 3 failed, 1 n/a | 272 → 272 |
| `url` | 0 passed, 47 failed, 3 n/a | 328 → **526** |

**The right-hand column is the most interesting number here and it was not what
the lane was built to measure.** A retain/release site exists only where the
lowering emitted code, so the count is a rough size of the compiled program.
Three modules grew sharply when module evaluation stopped being all-or-nothing —
`url` by 60%, `os` by half, `querystring` by 38% — and the four that did not
grow are the four that never lost their initializer. So the excision's effect is
visible in a number nobody chose for the purpose, from a lane built to catch
use-after-free, which is the kind of corroboration worth more than the intended
measurement. Their *test* results did not move at all: all three still fail at
the export table or the shape.

**Every number is identical to the uncounted run.** Six of the seven fail at the
export table, which they do either way, so counting tells us nothing new about
them. The one that matters is `punycode`: it passes both its tests with 55
retain/release sites live and poison on, so the green module does not depend on
an allocator that never frees, and nothing on its paths reads a slot after
release. That is the first evidence on this axis that the passing module passes
for the right reason.

**Two tests are thin evidence for that claim, so the lane asks a harder
question.** A module's test count is the number of questions node thought to
ask, and two of them cannot see a release too many — the failure that matters
here reallocates a slot and returns a *plausible* wrong answer, which is exactly
what a small fixed corpus is worst at catching. So a module that passes under
counting is then differentiated against node's own implementation on the same
build:

    punycode   2 / 2                                          [55 rc sites]
               80,128 comparisons over 20,000 random inputs and 32 fixed:
               0 divergences, 0 property failures

That is the counted, poisoned artifact answering identically to node across
twenty thousand generated inputs, not the uncounted one. It is the strongest
statement this axis can currently make about any module.

**The first run of this lane reported the same green row and it was worthless,
which is the part worth keeping.** It passed `punycode` 2/2 while
`punycode.build/program.c` held *zero* retain/release sites — an uncounted build
reported as a counted pass, the exact false negative the lane exists to prevent.
The cause was not the switch: `build.sh` under `NTS_CONFORMANCE_RC=1` emits 55
sites, verified by diffing against a build without it. The cause is that
`target/node` belongs to no session and three of them share this tree, so
another lane rebuilt `punycode` fifteen seconds after this one wrote it and
substituted the artifact under test.

So the lane now probes its own switch twice: once after the build, where zero
sites under the counted flag is never legitimate and is reported as NOT COUNTED
rather than run; and once after the tests, where a changed site count means
another session rebuilt the module mid-run and the row is discarded as
OVERWRITTEN. A lane that cannot tell a counted build from an uncounted one
cannot report anything, and this one could not, twice, before it printed a
number anybody would have believed.

## Four identities node's own tests never assert

52 of node's 1,890 pinned files check a constructor or an `instanceof` at all.
That is not an oversight: node's tests spend their assertions on behaviour, and
they under-test whatever cannot fail on node. A structural identity written as a
plain assignment in `lib/` is exactly that — there is no way for the assignment
to produce a different object, so there was never an invariant there to test.

A compiled profile has no such guarantee. Every one of these is a *sameness*
rather than an equality, and every one of them is lost by a repair that looks
correct and passes every upstream test:

| what | where node writes it | what the plausible repair does |
| --- | --- | --- |
| `querystring.decode === querystring.parse` | `lib/querystring.js:54,57` | publishes a wrapper function, both names work, identity gone |
| `path.posix.posix === path.posix`, and all four slots | the tail of `lib/path.js` | builds a namespace per access, graph becomes infinite |
| `require('events') === require('events').EventEmitter` | `module.exports = EventEmitter` then a self-assignment | publishes a namespace with `EventEmitter` on it; the bare spelling breaks |
| `Transform -> Duplex -> Readable -> Stream` | `ObjectSetPrototypeOf` in `lib/internal/streams/*` | gives each class a flat prototype; a `Duplex` that is not a `Readable` still reads |

None of the four is asserted anywhere in `parallel/`. All four are asserted here
now, and **each was controlled by breaking it** — the repair applied at the
boundary where it would really land, confirming the file fails, then restored.
A test written for a failure that has never been demonstrated is a claim.

**The `querystring` and `os` cases are the pair worth remembering, because they
are indistinguishable in the compiler's output and opposite in the source.**
`emit-c` says "refused by nothing" for both `export const totalmem =
nts_os_totalmem` and `export const decode = parse`. The first is a bug — the alias put a
function with **no name** on the public surface, `os.freemem.name` being `""`
where node has `"freemem"` — and rewriting it as a function fixed the surface
and doubled what `os` publishes.

*That sentence first read "the binding's name was on the public surface, so
`os.freemem.name` was `"nts_os_freemem"`", and it was wrong.* The host stand-in
is `globalThis.nts_os_freemem = () => os.freemem()`, and a property assignment
infers no name, so the alias carries an empty one rather than the binding's. It
was corrected by running the control for `os/test/binding-name-static.js`, which
printed `freemem.name is empty` where the claim predicted a leaked symbol — the
defect is real, the fix is unchanged, and the detail that made it sound urgent
had gone into a commit message, this document and two other lanes unchecked.
Twelve `process` functions had the same emptiness, which is the whole of the
defect in both modules. The second is
correct as written, and the same rewrite would destroy it. The compiler cannot
tell them apart; only the source can.

**The stream file names one trap explicitly.** In this lane a test for `stream`
receives the *host's* `node:events`, not this profile's, so asserting that
`Readable.prototype` chains up to that object compares two unrelated classes. An
earlier probe did exactly that and reported that `Readable` is not an
`EventEmitter`. The file asserts that the base of the chain *behaves* as an
emitter instead, which is the property the link exists to provide.

## One message, four kinds of work

`no wrapper for X: is exported and is not a function this backend can name` is
the most-quoted line in this document, and it was read for weeks as a single
backend limitation. It is four, and they have nothing to do with each other:

| kind | example | fixture | status |
| --- | --- | --- | --- |
| a value | `export const version = "2.1.0"` | `value-export` | **fixed** at `f4b8595c` |
| a class | `export class Decoder {}` | `export-class` | real work: constructor, prototype, finalizer |
| a shorthand property | `export const ucs2 = { decode, encode }` | `export-object-shorthand` | a spelling — explicit keys publish |
| a module namespace | `export * as posix from "./posix.ts"` | `export-namespace` | how `path` is built |

**The shorthand one is the reason this table exists.** `punycode` publishes its
`ucs2` and a bare fixture of "an exported object literal of functions" did not,
on the same binary, which should not have been possible. `punycode` writes
`{ decode: codec.ucs2decode, encode: codec.ucs2encode }` — explicit keys,
because the functions it names live in another module and the shorthand was
never available to it. So the module that works does not work because of
anything it knows. It works because of a spelling its imports forced on it, and
this document described that as a backend limitation for as long as it stood.

Two candidates and a control separated it: explicit keys with differently named
locals published, explicit keys with *identically* named locals published,
shorthand refused. The name collision between property and local was the better
hypothesis and is wrong.

**A fifth thing hides behind a message that is not printed at all.** An alias —
`export const decode = parse` — publishes both names and builds *two*
`napi_create_function` calls over one implementation, so `querystring.decode ===
querystring.parse` is false on the compiled axis and true on node. Nothing
refuses, no wrapper is reported missing, both names are in the export table, and
an export-surface diff finds nothing absent. Only an identity comparison
disagrees, and node's own tests contain none. `blockers/export-alias-identity`.

That entry was also filed on a wrong premise of this document's own: the
per-module blocker chains listed `decode -> parse` and `parse -> parse` together
under "cannot name this kind of export", which could not have been about
aliasing, since `parse` is a plain exported function. Both were absent because
neither had been compiled — the module having lost its initializer. **A grouped
diagnostic is not a cause**, three times in one day, and twice it was passed to
another lane before being checked.

## Two implementations of one thing, and the small one was wrong

`internal/errors.ts` built its inspected strings from `JSON.stringify(value)
.slice(1, -1)`, patched the NUL case, and shipped everything else in JSON's
notation rather than node's. The two agree on almost nothing across U+0000 to
U+009F: JSON writes four-digit lower-case unicode escapes, node writes two-digit
upper-case hex ones, and JSON does not escape U+007F to U+009F at all. So an
error message naming a string with a control character in it was wrong in every
case but one.

`runtime/node/util/src/inspect.ts` **already had node's table exactly right**,
including the five named escapes and the surrogate handling. The wrong copy is
the private one in `internal/`, and the correct implementation had been in the
tree the whole time. Checked after aligning them: 165 cases compared against
node across that range plus surrogate and non-ASCII inputs, 0 differing.

**The duplication is deliberate and should stay.** There is no cycle —
`util/src/inspect.ts` imports only its own siblings, so `internal/errors.ts`
could import it — but `internal/errors.ts` is compiled into all twenty-two
programs and `util.inspect` is large, so deduplicating would put a full
inspector into every artifact to serve error messages that need a fraction of
it. The function's own header already says a real `util.inspect` belongs in
`node:util` and will replace it. What was wrong was not that a second copy
exists; it was that nothing compared the two.

Quote selection remains an approximation, and is now documented as one rather
than left to be discovered: node picks its quote character to avoid escaping, so
`util.inspect("it's")` is double-quoted, and this always single-quotes and
escapes.

Found by following a defect the web-platform lane hit from the other direction.
Theirs was an encoder written on the premise that `JSON.stringify` output is
ASCII, which would have refused a legitimate cookie octet; this is a formatter
written on the premise that its escapes are node's. **Same premise, opposite
consequence**, and neither lane's tests could have found the other's.

## A refusal count measures the module as written

Every per-module frontier number in this document is a property of the source,
not of the module. That sounds obvious written down and it is not how any of
these counts have been read.

The web-platform lane measured it directly. One spec requirement — Web IDL's
`@@toStringTag` as a data property on thirty-five interface prototypes —
implemented three equally conformant ways:

| spelling | primary refusals |
| --- | ---: |
| a shared helper called from each class | **42** |
| module-scope `Object.defineProperty` per interface | one per interface |
| a `static {}` block inside each class | **0** |

The helper costs 42 because passing a class or a prototype to a function is
`a class used as a value`, which the lowering does not do yet. The `static {}`
block costs nothing because `this` inside it is not the class used as a value.
Their slice ended **eight primaries below where it started** while adding
conformance, which is not the direction that number normally moves.

**So a falling frontier count is not on its own evidence that the compiler
grew**, and a module with a high one is not necessarily using more of the
language. Where several conformant spellings exist, the count is measuring which
was chosen. That does not weaken any blocker filed here — each is a construct
with no conformant alternative, which is what a fixture demonstrates and a count
cannot — but it does mean the per-module tables above answer "what does this
source ask for" rather than "what does this module need".

It is the same distinction as `punycode` publishing its `ucs2` only because its
imports forced explicit keys on it: a number that describes the writing, read as
though it described the thing written.

## The all-void structs: six reductions that do not reproduce it

Eight structs in `util`'s generated C lose **every** field to bare `void`, and
all eight are WHATWG Streams option dictionaries. `blockers/undefined-required-
field` explains the *other* void fields — a required member typed `undefined` —
and does not explain these. This is a second cause and it has no fixture,
because six attempts to reduce it all compile clean.

Recording the negatives, because they are what is left of the search space:

| reduction | result |
| --- | --- |
| `interface Sink { type?: undefined; write?: (c: number) => void }` | `NtsValue`, clean |
| `interface Strategy { highWaterMark?: number; size?: ... }` | `NtsValue`, clean |
| generic `Sink<W>`, never instantiated | no struct emitted at all |
| `Sink<number>` and `Strategy<number>`, materialised and read | `NtsValue`, named `NtsObj_Sink_25_` |
| `Sink<W>` held by a `class Writable<W>`, built as `Writable<number>` | no struct emitted |
| an argument literal written with **method shorthand** | `NtsValue`, named `NtsObj_Sink` |

So it is **not** optionality, **not** `undefined` in an optional position, **not**
genericity, **not** instantiation, **not** reaching the type through a class type
parameter, and **not** method shorthand — the last tested specifically because
shorthand *property* syntax turned out to lose a symbol elsewhere
(`blockers/export-object-shorthand`), which made it the best remaining guess.

**The one positive observation is about naming.** A materialised generic emits as
`NtsObj_Sink_25_`, carrying its declared name and its instantiation; a
method-shorthand literal emits as `NtsObj_Sink`. Every one of the eight broken
structs is `NtsObj_TypeNNNN` — anonymous — while `NtsObj_UnderlyingByteSource`
and `NtsObj_ReadableByteStreamState` sit in the same generated file with their
names and their fields resolved. So whatever happens to the eight happens
*before* the field types are decided: the type arrives already anonymous, and a
struct emitted from an anonymous type has no properties to read. That would also
explain why all its fields go void together, where a partially-void struct like
`NtsObj_Type7151` is the other cause, one field at a time.

That is a reading of the output and not a measurement, and it is recorded as
such. What the negatives buy is a much smaller space for the compiler lane to
search than the module name alone would have given them.

**And then the ninth reduction was not a reduction at all — it was noticing that
`util` cannot reach a stream.** `util` imports `core/events.ts` and
`core/encoding.ts` and nothing else of the web-platform lane's. Neither mentions
streams. So the question that should have been asked on the first day is not
"which shape of dictionary breaks" but **"how is a stream dictionary in this
program at all"**:

    util/src/main.ts -> core/events.ts -> provider/environment.ts
                     -> provider/web-platform-runtime.ts -> fetch/body.ts
                     -> streams/readable.ts -> UnderlyingSource, QueuingStrategy

Four hops inside another lane's source. `WebPlatformRuntime` is a provider
interface and names the platform's types, `body` names `ReadableStream`, and the
dictionaries come with it — into a program that **cannot construct a stream at
run time at all**. Nothing on that path is ever built by `util`.

Every one of the earlier reductions had the type *used*, so the obvious next
hypothesis was that the shape which breaks is a type in the program that nothing
constructs — reached only because something else in the file graph mentions it in
a type position, which is a thing nobody writes a test for because it looks like
dead code rather than a case.

**That does not reproduce either.** An interface reachable only through a
type-only import, held as a field of a class nobody instantiates, emits
`NtsObj_Sink` with all five fields resolved to `NtsValue`. Ten reductions now,
all clean.

So what this chain establishes is **provenance and not cause**: it explains how a
stream dictionary is in `util`'s program at all, which was a real puzzle and had
gone unasked for a week. It does not explain why the fields are `void`. Those are
two different questions and the first one being answered was worth having on its
own — but the story was good enough that it was written here as though it settled
the second, and it does not.

This was found by fixing `tooling/conformance/web-platform-reach.mjs`, which had
been stopping at the first web-platform file rather than walking through it. The
same fix corrected a scope answer given to that lane twice: `streams/readable.ts`
reaches **twelve** of twenty-two modules, not one.

## The closure call slot, a blocker with no diagnostic

`async_hooks`, `diagnostics_channel` and `timers` each failed clang on one line,
which turned out to be this profile's own `declare function` claiming the runtime
symbol `nts_enqueue_microtask` with a different signature. That is repaired: the
binding is `nts_node_enqueue_microtask` and `internal/microtask.c` adapts through
the runtime's own `nts_callback_task`.

**The adapter is staged rather than working, and nothing will tell you so.** The
converter takes a slot index and the runtime calls straight through it —
`methods[entry->slot]` — so a wrong slot is a null call rather than a type error.
The compiler assigns a closure's call slot *after* every named method in the
program, and the emitted vtables say what that means:

    async_hooks          { 0,0,0,0,0,0,0,0, Closure3__call }    slot 8
    diagnostics_channel  { 0,0,0,0,0, Closure18__call }         slot 5
    buffer               { 0,0,0,0,0, Closure2__call }          slot 5
    punycode             { Closure5__call }                     slot 0

The worst possible distribution for a hardcoded constant: `punycode`, the module
with no methods and the one anybody tests first, is the single program where `0`
is right. The three modules this was written for would typecheck, compile, link,
and crash on their first microtask — a failure that looks like success until it
runs, and strictly worse than the clang error it replaced.

**It cannot be derived here, and that is checked rather than assumed.**
`NtsDescriptor` carries `void *const *methods` and **no count**, so there is
nothing to scan and no way to find the last entry. Only `program.c` knows the
number. The compiler lane is publishing it as `nts_closure_call_slot`; until it
appears in `nts_runtime.h`, `microtask.c` carries `0` behind a `TODO` and those
three modules are not to be run against it.

**The slot is the *second* problem, and this document reported it as the only
one for most of a day.** `internal/microtask.c` does not compile at all. A
`declare function` taking a callback emits its prototype with a
**program-specific** closure struct:

    program.c:1864  void nts_node_enqueue_microtask(NtsObj_Closure20 *);
    microtask.c:47  void nts_node_enqueue_microtask(NtsHeader *callback)
    error: conflicting types for 'nts_node_enqueue_microtask'

The number is assigned per program — `timers` gets 20, `diagnostics_channel`
gets 18 — so a `.c` compiled against every module cannot name the parameter type,
and no other spelling is compatible rather than coercible.
`blockers/callback-binding` reduces it to eight lines.

**It stayed invisible because the instrument never built the module.** `timers`
had not been compiled since the binding was renamed, and the counted lane's list
was hardcoded to the seven modules that built the night it was written — which
does not include `timers`. The error belonged to a module the lane could not
see. It surfaced within minutes of the lane being changed to derive its set from
`runtime/node` rather than recall it.

And the reasoning error underneath is worth naming: this lane traced the original
`NtsTask` mismatch, found the binding collision, renamed it, and reasoned forward
to the slot — correctly, and one step too far. **Nothing ever asked whether the
file compiled.** The blocker reported was the one gone looking for rather than
the one in front of it.

Two measured facts sit under it. `nts_schedule_unreferenced_immediate` and
`nts_on_collected` also take callbacks and **neither has a C implementation at
all** — they exist only as stand-ins in `bindings.node.mjs` for the interpreted
lane, so no callback-taking binding in this profile has ever had a working
compiled implementation. And what would fix it is a *stable* parameter type at
the runtime boundary — `NtsHeader *`, or the `NtsTask` shape `nts_callback_task`
already takes — which would also make the slot moot if the stable form carried
the call site with it.

**The slot is fixtured, and the sentence that stood here said it could not be.** That
sentence read: "there is no fixture for this and there cannot usefully be one",
on the grounds that nothing refuses, `emit-c` succeeds, clang succeeds, and the
addon links and loads. All of that is true and none of it is a reason. It was a
claim about `blockers-check.mjs`'s vocabulary presented as a claim about the
defect — which is the same confusion this blocker is itself made of, an
instrument's limits mistaken for the world's.

What the defect needs is a statement of **absence**: `program.c` does not contain
`nts_closure_call_slot`. The checker grew `lacks-c` for it, and
`blockers/closure-call-slot` holds while the constant is missing and reports
`FIXED` the day it appears — at which point the `0` in
`runtime/node/internal/microtask.c` becomes the symbol and the fixture becomes a
guard. Three lines of checker for a blocker that had been written off as
untestable.

## A byte view is two failures, and `string_decoder` is two fixes

`string_decoder` was reported here — and to the compiler lane, twice — as **one
fix from green**: its entire public surface is `class StringDecoder`, so
`blockers/export-class` looked like the only thing in the way. That was assembled
from the one blocker that had been measured, with no second-order check. Its
methods are

    write(buf: ArrayBufferView | string): string
    end(buf?: ArrayBufferView): string
    text(buf: ArrayBufferView, offset: number): string

and **none of those shapes crosses**. Publishing the class would publish a
constructor whose methods cannot be called. The check that disproves it is four
standalone functions with those signatures and it takes two minutes; it was run
after the claim had been stated twice and written down once.

**Behind "a byte view does not cross" there are two different failures wanting
different work.** Measured in one file, on one binary:

| parameter | outcome |
| --- | --- |
| `values: number[]` | **published** |
| `bytes: Uint8Array` | lowers; wrapper declines — *"takes TypedArray: its signature does not cross"* |
| `buf: ArrayBufferView` | **does not lower** — *"a parameter of unrepresentable type"* |

A `Uint8Array` parameter is compiled and only the Node-API wrapper will not carry
it, which is the same place `f64-parameter` was fixed and therefore a known kind
of work. `ArrayBufferView` never lowers, because it is an interface rather than a
concrete view type, so it needs the lowering *and then* the wrapper. **A fix that
stops at `Uint8Array` — the obvious first step — publishes nothing for this
module.** Fixtured as `blockers/arraybufferview-parameter`.

**The reach is the argument for its priority.** `buffer` takes byte views
everywhere, `fs.read` and `fs.write` take them, `zlib` takes them, and `stream`
passes them through in object mode. Anything in this profile that moves bytes
across the Node-API boundary wants this, which puts it above `export-class` on
value even though `export-class` unblocks more module *names*: a published class
with uncallable methods is worth nothing.

## It is a stack, not a count

This document, and the working goal built from it, said that fifteen modules do
not compile and **that is two bugs rather than fifteen** — 228 of 244 clang
errors being one struct emitter writing `void` fields, plus three modules with an
`NtsTask` mismatch. That was an accurate reading of what was visible. It is the
wrong *shape* of claim, and the measurement that showed it is worth recording.

The `void` fields are fixed. A required member typed `undefined` takes storage
now, `util`'s emitted C has zero bare `void` members where it had enough for 228
errors, and the same rule covers tuple elements. **The counted lane over all
twenty-two modules then reported the same seven building and the same fifteen
not.** Zero modules moved.

What was underneath, in the same files:

| blocker | where it surfaced |
| --- | --- |
| a property named `header` duplicating the object header | `assert` |
| two same-named interfaces emitting one struct name | `console` (`Context`), `fs` (`Blob`) |
| a callback binding's parameter type being per-program | `events`, `timers` |

Each was masked by a louder error earlier in the same translation unit. Fixing
the top of the stack revealed the next layer rather than clearing the modules.

**So the count was never counting what it appeared to.** "228 of 244 errors are
one bug" is true and does not mean "fixing one bug clears 228 errors' worth of
modules" — it means one bug was loud enough to hide the others. A clang error
count measures *what the compiler reached first*, and a translation unit stops
being informative after its first few failures.

The honest inventory is the fixture directory, and it is twenty-one entries. Not
"fifteen modules, N bugs" — that number has been revised three times today and
each revision looked like progress while being a fact about how much was
visible.

## The interpreted lane cannot see a divergence in the C

`os.tmpdir()` disagreed with node on the compiled axis and agreed on the
interpreted one, and the reason is structural rather than accidental.

Node's chain takes the first **non-empty** of `TMPDIR`, `TMP`, `TEMP`, then
`/tmp`. `uv_os_tmpdir` takes the first that is **present**. Measured against node
directly:

    TMPDIR=/tmpdir TMP=/tmp TEMP=/temp   ->  /tmpdir
    TMPDIR=""                            ->  /tmp
    TMPDIR="" TMP=""                     ->  /temp
    TMPDIR="" TMP="" TEMP=""             ->  /tmp

Through libuv the second line answered `/tmp` for the wrong reason and the third
answered `/tmp` outright, because an empty `TMPDIR` ended the search. The chain
is spelled in TypeScript now, which is where `lib/os.js` spells it.

**It could not have been caught on the interpreted lane, because the stand-in
was node.** `bindings.node.mjs` had `globalThis.nts_os_tmpdir = () =>
os.tmpdir()`. A stand-in that delegates to the host cannot disagree with the
host: it can establish that the binding is *called*, and nothing about what the
binding *computes*.

**This is not one binding. It is 78.** Counting stand-ins in `runtime/node/**`
that call straight into node's own implementation — `os.hostname()`,
`process.cwd()`, `fs.closeSync()`, `os.getPriority()`, and seventy-four more —
every one is a place where the C could diverge from node and the interpreted
lane would report nothing.

**And the shape fix that exposed it applies to exactly one module, which was
also measured rather than assumed.** `buffer` and `url` crash at load in their
shapes for the same reason `os` did — a dereference of an export the addon does
not publish. Degrading them would gain nothing: `buffer` publishes only
`kMaxLength`, and `url`'s `URL` class is not published at all, so every test in
both needs a name that is missing rather than a shape that survives. `os` was the
only module where a tolerant shape had 17 real functions behind it.

So the honest statement about the green axis is narrower than it has been
written here: **1,807 of 1,807 validates this profile's TypeScript. It does not
validate the C bindings at all.** Those are checked only by the compiled lane,
and only for the modules that reach it — which is one. Seventy-seven of the
seventy-eight have never been compared against node by anything.

That is the sharpest form of "a measurement on one axis is a claim about that
axis only" this project has produced, because here the second axis is not merely
unmeasured — the first one is *constructed so that it cannot fail*.

**One of the seventy-eight is now measured.** `os`'s addon loads, so its
seventeen published names can be compared against node's own `os`:

    34,238 comparisons over 2,000 generated environments and 14 fixed
    0 divergences, 0 property failures

The corpus takes an *environment* as its input rather than a string, because the
defect it was written for was in which variable was consulted rather than in what
was done with the value. Controlled by reverting `tmpdir` to the libuv chain and
rebuilding: it reports `tmpdir(["", "", "/temp"])` giving `/tmp` against node's
`/temp` immediately, and returns to zero when the fix is restored.

**And the unvalidated surface is larger than the stand-in count suggested.**
78 stand-ins delegate to node, which is the number that explains *why* the
interpreted lane cannot see a divergence. The number that says *how much is
unchecked* is the count of declared bindings, because only the compiled lane can
validate C and only two modules reach it:

| module | declared bindings | compared to node |
| --- | ---: | ---: |
| `fs` | 133 | 0 |
| `process` | 54 | 0 |
| `net` | 30 | 0 |
| `dgram` | 21 | 0 |
| `zlib` | 20 | 0 |
| `os` | 18 | **17** |
| `util` | 10 | 0 |
| `timers` | 8 | 0 |
| everything else | 14 | 0 |

**308 declared, 25 compared** — and the second figure moved without a single
module compiling. `tooling/conformance/binding-probe.sh` builds an addon around a
few of a module's bindings by linking a handful of TypeScript declarations
against the module's real `.c`. A binding does not need its module; it needs its
own C, the shared runtime, and something that calls it.

Eight of `fs`'s bindings, exercised against node in a module that does not build:

    access missing      -2   ENOENT      agrees
    access existing      0               agrees
    access empty        -2   ENOENT      agrees
    chmod missing       -2   ENOENT      agrees
    rmdir missing       -2   ENOENT      agrees
    rmdir on a file    -13   EACCES      agrees
    mkdir existing     -17   EEXIST      agrees
    realpath           /etc/hostname     agrees

**Its first run found `blockers/libc-name-collision`**, which is the most
dangerous defect in this document: an exported function whose name is also a
libc symbol is silently replaced by libc's, with no refusal, no clang error, and
plausible return values. `fs` exports fourteen such names.

Fourteen of `process`'s, in a module that also does not build — `cwd`,
`execPath`, `argv0`, the four `get{e,}{u,g}id` calls, `env` present and absent,
`envHas` both ways, and the memory and uptime shapes. All agree.

Eleven of `internal`'s, which every module shares — the errno-to-name mapping
that node exposes as `util.getSystemErrorName` and that sits under every error
path in the profile, checked across `ENOENT`, `EACCES`, `EEXIST`, `EISDIR`,
`EINVAL`, `EPIPE` and `ECONNRESET`, plus platform, release and the two TTY
probes. All agree.

**309 declared, 169 compared** — counted as *distinct binding names*, which is
lower than the per-module figures add up to and is the honest total.

**And re-runnable, which for most of a day they were not.**
`binding-probe.sh` built an addon and the comparison happened by hand in a
terminal, so "43 bindings compared to node" was a claim about one afternoon
rather than a check anything could repeat. A binding that regressed the next
morning would still have been reported as compared and green.
`tooling/conformance/probe-compare.mjs` rebuilds every probe and re-asserts every
expectation — **21 probes, 266 comparisons, 0 divergences** — and `--self-test`
injects one wrong expectation into a real binding call, so the harness is known
to be able to fail rather than assumed to.

Porting the hand-run comparisons into it **found five wrong checks, every one
mine and none of them a binding**. I had written expectations against probe files
without reading what they return:

    probeUptimeShape   answers `typeof`                I matched a decimal
    probeUuidShape     answers `length:versionNibble`  I ran a v4 regex on it
    probeFstatShape    answers the column count        I looked for the file size
    probeCrc32         narrows to bytes itself with
                       `charCodeAt(i) & 0xff`          I compared against UTF-8

The last one is the instructive one: the probe is latin1 *by construction, in its
own TypeScript*, so the only input where latin1 and UTF-8 differ reported a
divergence and the binding was right both times. Every probe was reasonable and
every expectation of mine was about a different object. The expected values are
now derived from node where they can be — the uuid shape from node's own
`randomUUID`, the fstat count from the fourteen numeric fields node's `Stats`
carries — rather than written down.

A DIFF also carries the observed value now. A check spelled `mine: /re/.test(x)`
reported `mine=false`, which is the least useful thing it could say, and finding
these five meant fixing that first. The
per-module sum was 50; it double-counted `nts_process_env`, which two probes
exercise, and counted `os`'s seventeen published *module functions* as bindings
when several of them are served by one `nts_os_static_information` call. A count
of things measured has to be a count of distinct things.

Alongside those 43, `os`'s published surface is differentiated against node at
34,238 comparisons — a different kind of coverage over the same native half.

**Two kinds of probe, and the second is how most of the remainder will have to be
reached.** The first takes a path and answers an errno. The second has to
*create* the resource it measures: `fs`'s descriptor bindings are reached by
opening a file through `nts_fs_open`, using it, and closing it in one call, so
nothing leaks when an assertion fails. `open`, `close`, `fsync`, `fdatasync` and
`fstat` agree with node, including `EISDIR` for a directory opened write-only and
`EBADF` for a descriptor that was never open. `net` and `dgram` will need the
same shape around a socket.

The count is derived from the `declare function` lines across `probes/`, so a
declaration that is never called would inflate it. Two — `fchmod` and
`ftruncate` — were written into the first descriptor probe and never exercised;
they are removed rather than left to count as measured.

Two facts about reachability that the declared counts do not show. **`dgram` has
zero bindings reachable without a live socket** — all 21 take a handle — so
probing it is a different and slower kind of work than probing a module whose
bindings take a path. And **`runtime/node/timers/` contains no `.c` file at
all**: its eight declared bindings have no native implementation, only stand-ins
for the interpreted lane, so there is nothing there to compare. `punycode` is green and contributes nothing to
this column, because it has no native half — it is string algorithms, which is
part of why it was the first module to pass and why passing it said less about
the C than the row implied.

That reorders what a compiled module is *worth*. `fs` is not merely the largest
module; it is 133 native functions that no instrument in this repository has ever
compared against node. Getting it onto the compiled axis is worth more than its
test count suggests, and less pleasant, because the first differential over 133
unchecked bindings is unlikely to return zero.

**The corpus is marked `addonOnly`, and that flag is the honest part.** Adding it
put `os` into `differential-ts.mjs --all`, which the sweep runs — and on that lane
every one of those calls resolves to node's own `os` through the stand-ins. It
would have compared node against node and reported zero divergences for ever: a
green row that cannot fail, introduced by the corpus written to expose exactly
that. The TypeScript lane skips it out loud, because a missing row and a passing
row look identical in a summary.

## An addon exported 360 symbols and called libc instead of itself

An exported function whose name is also a libc symbol was **silently replaced by
libc's**. A probe exporting `access` over `nts_fs_access` answered `0` for every
input — missing path, empty path, root-only path, existing file. Renaming the
export to `probeAccess` and changing nothing else gave `-2`, `0`, `-2`: ENOENT,
correct, agreeing with node. The binding was right the whole time.

No refusal, no clang warning, an addon that links and loads and returns plausible
values. Every instrument here reported success.

**The mechanism took two wrong explanations to reach, and the second was mine.**
The first guess was that `build.sh` force-includes `<unistd.h>` so the
declaration conflicts. It does not, and clang says nothing. `nm` settles it: the
addon **defines** `T access` and never calls it. A shared object linked without
`-Bsymbolic` routes calls to its own globals through the PLT, and the dynamic
linker resolves them against the global symbol table, where libc was bound first.

The two facts that pin it are worth keeping. Node's own `fs` is **unaffected** by
loading the addon, because node and libuv resolved their `access` before it
loaded — so nothing interposes on them. And a `static` internal function is safe:
an internal `read` emits as `static double read(double)` and runs correctly,
because a static definition has no dynamic symbol to preempt.

**Two fixes were needed, closing opposite directions of one hazard.**

| direction | fix | why the other cannot close it |
| --- | --- | --- |
| libc preempts the program | `-fvisibility=hidden` in `build.sh` | an escape list cannot enumerate libc's dynamic symbol table |
| the program preempts libc *for the runtime* | escaping the emitted C symbol | hidden visibility does not apply in a standalone binary, where the program's symbols win |

The second is not hypothetical: `nts_runtime.c` makes **58** calls to `memcpy`,
`strlen` and their neighbours, so a program exporting `strlen` would have the
runtime calling it on every string operation. That is why `<string.h>` and
`<math.h>` were escaped from the beginning; POSIX was simply missing from the
list.

**Hidden visibility took `punycode.node` from 360 exported dynamic symbols to
2** — the two Node-API entry points. Among the 358 were the bundled QuickJS
internals, `cr_free`, `cr_init`, `cr_op`. `access` was found only because a probe
happened to name an export after it.

Found by `tooling/conformance/binding-probe.sh` on its first run, in `fs`, a
module that does not compile.

## What the interpreted lane structurally cannot see

**Check this list before filing anything found on that lane.** It is a predicate,
not a caveat: each entry is a question the lane is incapable of answering, so a
"divergence" in one of these categories is the instrument speaking, not the
module.

The lane runs this profile's *source* on node, against node. That makes it a
hybrid, and every boundary between "ours" and "node's" is a place the two can be
silently swapped.

**1. Any binding whose stand-in delegates.** 54 of them call node's own
implementation — `globalThis.nts_os_tmpdir = () => os.tmpdir()`. That lane agrees
with node by construction whatever the C says. Reached instead by
`binding-probe.sh`, which builds an addon around a binding *without* compiling
its module; 53 of the 54 are covered that way, and `standin-blindspot.mjs` counts
the rest.

**2. `Buffer` identity for any value a module computes itself.** There are two
`Buffer` classes at run time — node's and this profile's — and which one a value
carries depends on whether it came from module code or from a delegating
stand-in. `Buffer.isBuffer` in a test is *node's*. So "is this a Buffer" is not
answerable on that lane for anything a module built. See the section below.

**3. Anything platform-conditioned.** The lane compares two implementations on
*this* machine. A defect that is correct on the only platform anyone runs — a
positive errno normalised to negative, an endianness assumption, a pointer that
is not 8 bytes — is invisible to it, to sabotage, to the counted lane and to the
probes. The only thing that catches those is a convention applied uniformly, and
a wrapper that enforces the convention beats a rule people follow.

**4. Object identity through `deepStrictEqual`.** Not a lane property but an
assertion-library one, and it compounds with 2: a class instance and a plain
object with the same fields compare equal, so a test meaning "the right class
came back" means "the right fields came back". Use `instanceof`, which works.

Each of these was found by investigating something as a defect first. The list
exists so the next one is cheaper.

## Two `Buffer` classes in one process — and the cause, found after recording the wrong one

`os.userInfo({ encoding: "buffer" })` answers values that fail
`Buffer.isBuffer`. In the **same process**, `fs.readFileSync` answers values that
pass. Their `.constructor` objects are different objects with the same name.

**The first version of this section said the cause was unknown and implied `os`
was resolving to a second copy of the module. That was wrong**, and one more
probe settled it — printing the two constructors:

    os.userInfo's Buffer   class Buffer extends Uint8Array { stat...   <- this profile's
    globalThis.Buffer      function Buffer(arg, encodingOrOffset, l    <- node's own

They are not two copies of one class. They are **this profile's `Buffer` and
node's**, and which one you get depends on where the value came from:

- **module code** constructs this profile's `Buffer` — `os/src/main.ts` does
  `Buffer.from(bytes)` on its own imported class
- **a stand-in** returns node's, because `fs`'s stand-ins delegate to node's real
  `fs`, which answers host Buffers

`Buffer.isBuffer` in a test is node's, so it accepts the stand-in's output and
rejects the module's.

**So it is an interpreted-lane artifact, not a defect in `os`.** In a compiled
build there is one `Buffer` — this profile's — and `isBuffer` is this profile's
too, so the question does not arise. Which also means the interpreted lane
*cannot* check `Buffer` identity for any value a module computes itself: another
entry for the list of things that lane is structurally unable to see, alongside
the 54 delegating stand-ins.

The four things ruled out before the answer arrived are kept because each was
worth ruling out: it is not the global (`globalThis.Buffer ===
require("node:buffer").Buffer`), not the import spelling (`os` and `fs` write it
identically), not the module under test (`os` is wrong under `--module fs` too),
and not a stale build artifact (`os/node_modules/.tsbuild` holds no JavaScript).

**What it cost to get wrong**: one commit that recorded "cause not known" and
implied a module-resolution bug. The probe that settled it was four lines and I
wrote it after publishing rather than before.

## `deepStrictEqual` cannot see a prototype, and that weakens the suite

The most consequential §13 consequence found so far, and it is not in a module —
it is in the assertion library every other test uses.

Node's `deepStrictEqual` compares prototypes. This one cannot:

    Buffer.from([1])          vs  new Uint8Array([1])     node: differ   here: equal
    Object.create(null)       vs  {}                      node: differ   here: equal
    new (class { x = 1 })()   vs  { x: 1 }                node: differ   here: equal

§13 lists `getPrototypeOf`, `setPrototypeOf` and `__proto__` together — *"there
is no chain to read or rewrite"*. A comparator with no access to a prototype
cannot distinguish two objects that differ only by one. This is the decision
applied, not a gap in the port.

**But it weakens every test in this profile that uses `deepStrictEqual`**, which
is most of them. An assertion that a call returns a `Stats` rather than an object
literal with the same fields does not actually check that. A test that means "the
right class came back" silently means "the right fields came back".

That is worth knowing *before* it is relied on. It does not invalidate the
suite — field values are still compared exactly, and most assertions are about
values — but any test whose point is the *identity* of a returned object needs
`instanceof`, which does work, rather than `deepStrictEqual`.

The other twenty-four rows match node exactly, including the ones people get
wrong from memory: `NaN` **equals** `NaN`; `0` and `-0` **differ**, nested as
well as at top level; an array hole differs from an explicit `undefined`; `Map`
and `Set` ignore insertion order; a `Map` key of `NaN` matches; two `Uint8Array`s
of the same bytes are equal while a `Uint8Array` and an `Int8Array` are not; a
boxed `new Number(1)` differs from `1` and matches another boxed one; two
mutually circular objects are equal; and a non-enumerable own property is
ignored.

## The harness bug that reported a pass

Five self-inflicted comparison bugs today, and the fifth is the only one that
could report **success**.

`stream`'s survey has two asynchronous cases. The first version resolved each one
**from its error handler**. But `end()` called twice emits *nothing* on node — so
that promise never resolved, `Promise.all` never fired, the output file was never
written, and the comparison read **the previous run's file** and reported a clean
pass across all fourteen rows.

Every other harness bug today was a false *negative*: a divergence reported that
was not one. Those get investigated and closed. This one is a false *positive*,
and a false positive is the failure mode that survives — nobody investigates a
green row.

Two changes came out of it, both general:

- **Resolve on a timer, not on the event.** "No error arrived" is a real answer,
  and a harness that can only record errors cannot express it.
- **Delete the output file before the run.** A comparison that can silently read
  stale data is worse than one that fails, because the staleness is invisible in
  the result.

The rest of that survey is clean: 14 cases, 0 divergences — `write()` answering
`false` once the buffer *reaches* highWaterMark rather than after, `destroy()`
being idempotent, `push(null)` then `push(x)` giving `ERR_STREAM_PUSH_AFTER_EOF`,
`read()` on an empty stream being `null` rather than `undefined`,
`readableFlowing` being `null` before anything and `false` after `pause()`, and
`cork`/`uncork` routing two writes through `writev` as one call.

## Two surfaces that came back clean, which is also a result

**`console`, 21 cases, 0 divergences.** Node formats through one
`util.formatWithOptions` and indents through one group-depth counter, so upstream
`group` + `log` + `groupEnd` cannot disagree with `count` about how a line is
prefixed. Here they are separate methods on a class keeping its own depth. The
boundaries all hold: `groupEnd` called more times than `group` does not go
negative, a multi-line string inside a group gets the indent on *every* line,
`%s` with more arguments than placeholders and with fewer, a literal `100%` with
no specifier after it, `console.table` given a primitive and given a non-array,
and `countReset` on a counter that was never started (which warns and continues).

**`readline`, 15 cases, 0 divergences.** Node splits in one place with one
buffered remainder, so upstream a CRLF arriving in two chunks and one arriving in
one cannot take different paths. Here the buffering is TypeScript, and every case
is a chance for the remainder to be dropped, doubled or mis-joined: a CRLF split
across two chunks **and across three**, a lone CR at end of input, CR-only
endings, a BOM that must survive into the first line, a NUL inside a line, no
trailing newline at all, and an entirely empty input that emits *nothing* rather
than one empty line.

A survey that finds nothing is worth the same as one that finds something,
provided it could have failed — and both of these are built so a plausible
mis-implementation fails. The `readline` one in particular splits the same CRLF
three different ways precisely because a buffer that handles two chunks can still
lose the middle one.

## An ordering divergence, recorded rather than pinned

**Node runs all expired timers, then the immediate, and it is stable across five
runs. This profile is not — three runs gave two different orders.**

    node   tick1,tick2,micro1,tick-in-micro,timeout0,timeout-neg,timeout-last,immediate1  (x5)
    here   tick1,tick2,micro1,tick-in-micro,timeout0,timeout-neg,immediate1,timeout-last
           tick1,tick2,micro1,tick-in-micro,immediate1,timeout0,timeout-neg,timeout-last  (x2)

The `nextTick` and microtask half is exactly right — `tick1,tick2` before
`micro1`, and a `nextTick` queued *inside* a microtask still running before any
timer. What is wrong is the boundary between the timer queue and the immediate
queue.

The cause is visible in the stand-in: it arms **one** host timer for the whole
timer queue and re-arms after each drain. So a timer that becomes due *during* a
drain gets a fresh host timeout queued behind an immediate that was already
armed, where node's timers phase would have taken it in the same pass.

**It is recorded here and not asserted anywhere.** A test that pins an order this
implementation does not yet guarantee is a flaky test, and a flaky test is worse
than a documented gap: it teaches everyone reading the suite to re-run rather
than to look. The rule from `cpSync` again, arrived at from the other direction —
there the divergence was stable and asserting it would have pinned a defect; here
it is unstable and asserting *either* answer would be wrong half the time.

What the timers test does assert is the part that is deterministic: a `Timeout`
is an object, `ref`, `unref`, `hasRef` and `refresh` all return the handle so
they chain, and `clearTimeout(undefined)` is a no-op answering `undefined` rather
than a throw. `Symbol.toPrimitive` is absent by §13 and asserted as such.

## `EventEmitter`, where the answer depends on *when*

Node keeps one listener array per event and copies it before emitting, so
upstream every question about mutation-during-emit has one implementation and one
answer. Here the list is a class with its own copy-on-emit discipline, and each
of these is a separate decision it could get wrong independently.

**Sixteen cases whose answer is not derivable from the documentation**, fifteen
matching:

- a listener removed *during* an emit still runs that time
- a listener added during an emit does **not** run that time
- `removeAllListeners` mid-emit still lets the already-copied ones run
- `on(f); on(f); removeListener(f)` removes one, not both
- `listeners()` returns a copy, so mutating it changes nothing
- `newListener` fires *before* the listener is added, `removeListener` after
- `eventNames()` keeps insertion order and mixes strings with symbols

**The sixteenth is §13, not a defect.** Node's `once` wrapper carries a
`.listener` property pointing at the original function, so
`rawListeners(e)[0].listener` is a function there and `undefined` here. §13 says
it directly — *"a function here is a C function, not an object with
properties"* — so the relationship is a typed record (`ListenerRecord.original`)
rather than a property on a callable.

Asserted rather than omitted, on the rule the `buffer` test records. **Both times
§13 turned an apparent defect into a decision today, the tell was a comment in
this profile's own source saying so** — which was then checked against §13 rather
than trusted. A source comment claiming a decision is a lead, not a citation.

## Eighty-three error classes each carried a key node does not have

Node builds every `ERR_*` from a single factory in `lib/internal/errors.js`, so
upstream `constructor`, `name`, `code`, the prototype chain and the own-key set
cannot disagree **between two error types**. This profile has roughly a hundred
separate classes, and they can.

    Object.keys(err)   was: code,name
                      node: code

`this.name = "TypeError"` inside a class extending `TypeError` is redundant — the
name is already there through the prototype — but assigning it makes it an *own*
property. Eighty-three assignments, all saying what the base already said,
visible through spread, `JSON.stringify` and `util.inspect` on every error this
profile throws.

**Removed structurally rather than case by case**: an assignment goes only when
the class's base chain already yields that exact name. Three survive it —
`AbortError` and `SystemError` genuinely differ from their base, and node makes
those own too. Node's `ERR_FS_EISDIR` was checked specifically rather than
assumed, and it does have an own `name` of `"SystemError"`.

### The message node writes in C++

`fs.accessSync("/tmp", "x")` answers **`mode must be int32 or null/undefined`** —
no quoted name, no `The ... argument` prefix, no `Received` suffix — because
`accessSync` hands `mode` straight to `binding.access`. The `code` is still
`ERR_INVALID_ARG_TYPE`.

That cannot be produced through the template and **should not be**: the template
is correct about every case node builds in JavaScript, and bending it to fit one
C++ message would make it wrong about the other ninety-nine.
`ERR_INVALID_ARG_TYPE_BINDING` exists for the handful node writes in C++, so
matching node here did not mean weakening the thing that is right.

A change in `internal/errors.ts` reaches every module, so `util`, `assert`,
`stream` and `events` were re-run rather than assumed. All unchanged.

## The shape of every `fs` error, which was wrong in three ways

Node builds these in one C++ helper, so upstream `code`, `errno`, `syscall`,
`path` and the message cannot disagree with each other and there is nothing a
test could catch. Here every call site passes its own arguments to
`uvException`, and all three findings were in that passing.

**Every single-path error carried two own keys node does not have.** `path`,
`dest` and `filename` were declared as optional class fields, and under
`useDefineForClassFields` a *declaration* is emitted as an own property whether
or not it holds anything:

    Object.keys(err)   was: code,dest,errno,filename,path,syscall
                      node: code,errno,path,syscall

Visible through spread, `JSON.stringify` and `util.inspect`. `filename` is read
nowhere at all — only `fs/src/watchers.ts` *sets* it, on errors it has already
caught. Both are attached at the call site now and the class declares neither.

**`err.constructor` was `UVExceptionError`.** Node's `fs` errors are a plain
`new Error(...)` with fields attached, so `constructor` is `Error` and
`constructor.name` is `"Error"`. Fixed with the same `override get
["constructor"]` the `ERR_*` classes in `internal/errors.ts` already use.

**Node's synchronous `opendir` error carries no path at all** — not in the
message, not as a property; own keys exactly `code`, `errno`, `syscall`. Its
*asynchronous* and *promises* forms **do** carry it, on the same failure, for the
same directory. That asymmetry is node's, nothing upstream pins it, and it is
matched rather than improved: a path there would be more useful and would be a
divergence.

### The row that is deliberately not asserted

`Object.getPrototypeOf(err) === Error.prototype` is `true` on node and `false`
here, because node's really *is* an `Error` and this is a subclass. Reaching it
needs an unchecked assertion, which this profile does not do.

So it is **recorded here and not asserted** — the same rule as `cpSync`. §13 does
not cover it, so it is not a declared decision either; it is a known limit, and
the honest place for a known limit is a document rather than a test that pins it.

### Four harness bugs, all in normalisation

The first run of this survey reported **all 25 rows divergent**. `String.replace`
with a *string* argument replaces only the first occurrence, and a two-path
message names the temp directory twice — the second half kept a random directory
name that could never match across two runs.

That is the fourth self-inflicted comparison bug of the day, and they are all in
the **normalisation** step rather than the comparison: a working directory that
differs between runs, a separator that also appears in the data, a transport that
loses a property, and a replace that stops after one. Deciding whether two
strings are equal is not where this kind of harness goes wrong. Reducing two runs
to comparable form is.

## Buffer input forms, and the one thing a test *may* assert about us

Node coerces every `Buffer.from` input in one place, so upstream a test that an
`ArrayBuffer` works is a test that a `DataView` works. Here each form reaches its
own branch. Node's coverage of the unusual ones is thin: of 69
`test-buffer-*.js` files, **3** mention `Symbol.toPrimitive` or `valueOf`, **2**
construct a `DataView`, and **3** touch `indexOf` at all.

**Thirty of thirty-two match node exactly** — including `Buffer.from` on an
`Int8Array` of negative values, a `Uint16Array` (which reinterprets rather than
converts), an `ArrayBuffer` with offset and length, a plain `{length, 0, 1}`
object, and `indexOf` with a `Uint8Array` needle.

The two that differ are **refusals this compiler makes on purpose**:

    Buffer.from({ valueOf: () => "zz" })              node: Buffer[122,122]
    Buffer.from({ [Symbol.toPrimitive]: () => "yy" }) node: Buffer[121,121]
    both here: ERR_INVALID_ARG_TYPE

`ToPrimitive` dispatch and `Symbol.toPrimitive` are both in
`docs/conformance/typescript.md` §13, *What this compiler is not* — "one decision
made once", explicitly not a backlog item.

### The rule this pins down

Those two rows are **asserted**, not omitted. That is the opposite of what the
`fs` byte-path test does with `cpSync`, and the difference is the whole rule:

> A test may not assert what this implementation *happens to do*. It may assert
> a **declared decision**. The difference is whether the divergence is written
> down somewhere as intended.

`cpSync` rejecting a Buffer is a defect nobody chose, so asserting it would pin a
bug as expected behaviour — and that test would pass here and fail against node,
which is backwards. `Buffer.from({valueOf})` throwing is §13 being applied, so
asserting it is asserting the decision. **If §13 ever admits `ToPrimitive`, those
two rows fail and say so**, which is exactly the notification that should happen.

## 440 StringDecoder cases, and a claim that did not follow

The compiler lane found that a **lone surrogate literal compiles to three
U+FFFD** — `"\ud800".length` is 3 where node says 1 — and flagged
`string_decoder` and `util` as downstream, since both are full of surrogate
handling.

**They are not, and the reason is worth keeping.** `grep` for `\ud8xx` and
`\udcxx` literals across all of `runtime/node`: **zero**. Not one lone-surrogate
literal in the profile. The defect is in the *type record* — a literal resolved
by the frontend — and the surrogate handling in these modules is **computed at
run time**. "Full of surrogate handling" is true; "therefore this defect reaches
it" does not follow. Same shape as reading `recursive` in a signature and
inferring a directory walk.

So the computed half was measured rather than reasoned about: **7 encodings × 8
inputs × every split point = 440 cases, 0 divergences.**

Splitting a multi-byte sequence across two `write()` calls is the entire reason
`StringDecoder` exists, and node has **three test files** for it. They are good
files and three cannot cover that surface — upstream there is no reason to,
because the decoder is one piece of C++ that either holds partial state correctly
or does not. Here it is TypeScript with its own buffering.

The cases a hand-written test does not think to write, all covered:

- a split landing **inside a four-byte sequence** that is a surrogate pair in
  UTF-16
- a lone `0x80` continuation with no lead byte
- an overlong `C0 80`
- the boundaries at offset `0` and at `length`, where the decoder is handed an
  empty chunk

Every expected value was read off node rather than derived. For the malformed
inputs there is no specification answer to derive: U+FFFD substitution counts and
placement are what node does, and matching node is the goal.

`string_decoder` is 4 of 4, up from 3.

## Ninety-six encoding spellings, and the one that disagreed

Node normalises encodings in one place and hands the same canonical value to
every consumer, so upstream a test that an alias works in one call *is* a test
that it works in all of them. Here each call reaches its own path — `readFile`
decodes through `requireTextEncoding`, `readdir` and `readlink` through
`normalizeFileResultEncoding`, `realpath` through `encodeFileName` — and they can
disagree with each other and with node independently.

Twenty-four spellings across four calls. **Ninety-five of ninety-six matched, and
the one that did not is a wrong error code:**

    readFile/buffer  node: THROW:ERR_UNKNOWN_ENCODING   was: ERR_INVALID_ARG_VALUE
    readFile/BUFFER  node: THROW:ERR_INVALID_ARG_VALUE   agreed

`"buffer"` is a valid *option* value for `readdir`, `readlink` and `realpath`,
which all answer Buffers for it — so node's option validation lets it through and
`readFile` fails later, at `Buffer.prototype.toString("buffer")`, with a
different code. **Exactly the lowercase spelling**: `"BUFFER"` and `"Buffer"`
fail node's earlier validation and get the generic error. That was checked
against node for all three, because a case-insensitive compare here would be
wrong in the direction that looks more correct.

### The fix landed in a function where it could never run

`normalizeFileResultEncoding` and `requireTextEncoding` end with the same four
lines. Replacing the first match put the new branch in the first of them, where
`"buffer"` returns two lines earlier and the code is unreachable. **The test still
failed, which is the only reason I looked again** — a passing test after that
edit would have shipped a fix that does nothing, in a file that reads as though
it works.

Every expected value in `encoding-aliases-static.js` was read off node rather
than written from the documentation. `fs` is 342 of 342.

## Thirteen `fs` functions rejected a Buffer path

**Node accepts a Buffer wherever it accepts a string path**, and a POSIX filename
is a byte sequence that need not decode as UTF-8. `unlinkSync`, `mkdirSync`,
`rmdirSync`, `chmodSync`, `chownSync`, `utimesSync`, `lutimesSync`, `renameSync`,
`copyFileSync`, `linkSync`, `readlinkSync` and `rmSync` all threw
`ERR_INVALID_ARG_TYPE` on one. Only `truncateSync` worked, and only because it
delegates to `openSync`, which was already byte-aware.

**None of node's 260 `fs` test files passes a Buffer path**, so nothing upstream
could have found it. On node the path is bytes in C++ end to end and only becomes
a string at the boundary; there is no separate byte code path that could be
wrong. Here there is — `getValidatedBytePath` and a `_bytes` binding per
operation — and it is different code from the string route with different bugs.

It was found by writing the assertion the oracle had no reason to write: a
filename of `61 ff fe 62`, two bytes of which are illegal anywhere in UTF-8, and
then watching `unlinkSync` refuse to remove the file `readdir` had just listed.

Eleven new native bindings, each a thin wrapper over the same shared helper its
string twin now calls, so the two cannot drift. `readlink_bytes` answers the
*target* as bytes too, since a symlink target is no more required to decode than
a filename is. Two-path calls normalise both sides to bytes when either is: a
string always has a byte spelling and the reverse is not true.

**The recursive walks were the part worth care.** Recursive `mkdir` splits on the
byte `0x2f` rather than on a string `"/"`, and the byte `rm` joins children from
`scandir_bytes` rather than through a template literal — because building a child
path through a string asks the kernel to remove a *different* file than the one
`readdir` just reported.

`cpSync` is the fourteenth and is **not fixed**. Its implementation is an
eight-function family typed on `string`, and it carries a design question this
change was not the place to answer: node hands the user's `filter` callback
strings, so a byte-path `cp` has to decide what the filter sees.

### And eleven more in `fs.promises`

Fixing the synchronous half raised the obvious next question. **Eleven of
twenty-one `fs.promises` functions rejected a Buffer path too** — `chmod`,
`chown`, `utimes`, `unlink`, `mkdir`, `rmdir`, `copyFile`, `rename`, `link`,
`readlink` and `rm`.

**All eleven are fixed.** Four of them — `mkdir`, `rmdir`, `rm` and `readlink` —
were set aside in the first pass as recursive composites needing byte-aware
directory walking. Reading them instead of assuming showed the recursion lives
**in the binding**: `nts_fs_mkdir_async` already takes a `recursive` flag and
`nts_fs_rm_async` already takes `recursive`, `force`, `maxRetries` and
`retryDelay`. Four functions written off as a day's work were a one-line dispatch
each.

So **twenty-four public `fs` functions rejected a Buffer path** in total,
thirteen synchronous and eleven asynchronous, and twenty-three are fixed. Only
`cpSync` remains.

The async family has no C at all — the entire asynchronous half of `fs` is
stand-in only — so the byte variants are declarations and stand-ins matching
their string twins.

**And the stand-ins caught a mistake of mine.** The seven I wrote by hand used
`(e) => cb(e ? e.errno : 0)`, where the seam's convention is `relay`, which routes
through `codeOf` and normalises a *positive* errno to negative. Node's `fs` errors
are negative on Linux, so it would have worked here and diverged on a platform
where they are not — a defect that passes every test on the machine that has it.
All seven go through `relay` now, like every other stand-in in the file. That keeps the pair consistent rather than leaving one
spelling of the same call working and the other not.

The test also asserts the **errno survives the byte route**, not only the success
path: `unlink` on a missing Buffer path still reports `ENOENT`. A byte-path fix
that lost the error mapping would pass every success assertion above it.

`fs` interpreted is **341 of 341**, up from 338 before any of this. Sabotage
fails all 341.

### A test may assert what node does, never what this implementation does

The first draft of the family test asserted that `cpSync` **throws** — pinning
the defect as expected behaviour. It passed against the module and failed against
node, which is exactly backwards for a test whose whole purpose is to check the
module against node. The assertion is gone; the gap is recorded here instead,
which is where a gap belongs.

`fs` interpreted is **340 of 340**, up from 338. Sabotage fails all 340, so
neither new test is hollow. 22 of 22 modules typecheck. The ABI audit covers 188
bindings now, 0 disagreeing.

## An error identity three libraries disagree about, and node barely tests

**Two of node's sixty-five `zlib` test files assert an error's `code` at all.**
That is not sloppiness upstream. On node all three decompressor families are
constructed by the same C++ from the same library return, so `code`, `errno` and
`message` cannot disagree with each other — an assertion that cannot fail does
not get written. Here they are assembled in TypeScript from **three separate
native readings** (`nts_zlib_last_status`, `nts_zlib_last_error_code`,
`nts_zlib_last_error_message`), and any one of them can be wired to the wrong
source silently.

    zlib    Z_DATA_ERROR                  errno  -3   negative
    brotli  ERR__ERROR_FORMAT_PADDING_1   errno -14   negative
    zstd    ZSTD_error_prefix_unknown     errno  10   POSITIVE

**The sign flip is the row worth keeping.** An implementation that normalised
every library's status into one negative-errno convention would pass every
round-trip test, every corrupt-input test that only checks *that* it threw, and
`test-zlib-invalid-input.js` in full — and would still hand callers `-10` where
node hands them `10`. There is no test in the upstream suite that could see it.

`inflateRaw` is also asserted to report a *different* message from `inflate` on
the same bytes, which is a real signal that the raw and framed paths are not
silently one call.

Written as `runtime/node/zlib/test/error-identity-static.js`. **Validated against
node before being run against the module**, so the expected values are the
oracle's answers rather than mine — the ordering matters, and getting it backwards
is how a test comes to assert what the implementation already does.

**Not hollow**: blanking the module fails it on `inflateSync code`, and the
interpreted lane goes from 67 passing to 0. `zlib` is 67 of 67, up from 66.

## The native half, compared: 165 of the 177 that exist

"169 of 309 bindings compared" is the number, and it understates by measuring
against a denominator that includes 132 bindings with **no C to compare**. The
comparable population is the 177 that link, and **165 of those have now been run
against node** — up from 43 at the start of the day, all of them hand-run and
none of them repeatable.

**The remaining twelve are blocked, not pending**, which is the distinction worth
keeping:

    3   nts_process_abort, nts_process_execve, nts_process_really_exit
        declared `never`. A probe cannot survive them and one that forked to
        survive them would be measuring the fork.

    3   nts_os_constants, nts_os_cpus, nts_os_network_interfaces
        heterogeneous tuple returns -- blockers/heterogeneous-tuple-return

    1   nts_node_enqueue_microtask, declared by four modules
        a closure parameter, whose C type the compiler names per program --
        blockers/callback-binding

    1   nts_zlib_write, which answers a Promise

So there is no queue left on this axis that work alone would clear. Every
remaining row needs either a compiler fix that is already fixtured, or is
unreachable by construction and always will be.

### The strongest results, which are the ones about bytes

Most comparisons ask whether a binding answers the number node answers. Four ask
something harder:

- **`zlib` compresses byte for byte like node** at levels 1, 6 and 9, raw and
  framed, over five payloads. One check asserts that levels 1 and 6 produce
  *different* sizes, because otherwise every other row passes for a build that
  ignores the level.
- **brotli and zstd do too**, through the parameterized form. Both round-trip as
  well, but the round-trip is the weaker claim: a compressor that is
  self-consistently wrong round-trips perfectly and passes every test `zlib` has.
- **Streaming in three pieces produces the identical stream to one call.** That
  is the property a stateful compressor exists to have, and no round-trip can
  see it — an engine that silently restarted between writes still inflates back
  to the right answer.
- **A `read_bigint` position past 2^53 reads nothing** rather than wrapping to a
  small offset, which is what a bigint truncated through a double would do.

## What the probes actually find, which is not what I expected

Worth stating plainly, because it changes what the tool is for.

**Every defect the probes have found, they found by failing to build — not by
comparing.** Every single *comparison* divergence has turned out to be my
expectation rather than the binding. Seven of them in one day:

    probeUptimeShape          answers `typeof`, I matched a decimal
    probeUuidShape            answers `length:versionNibble`, I ran a v4 regex
    probeFstatShape           answers a column count, I looked for a file size
    probeCrc32                is latin1 by construction, I compared UTF-8
    write_file_utf8_fd        answers an errno, I expected a byte count
    opendir                   fails with 0, I guarded on negative
    statfs                    answers 8 columns, I expected node's public 7

Two of those are worth separating out, because they failed in the direction that
matters. Guarding `opendir` on `handle < 0` **reported a missing directory as a
success**. And comparing `crc32` against UTF-8 reported a divergence on the one
input where the encodings differ, twice, while the binding was right both times.

What the probes *have* found, all through build failure:

- the `libc` name collision — an exported `access` silently replaced by glibc's
- `nts_crc32` taking `NtsArray *` against a `Uint8Array` declaration
- seven more `zlib` signatures with the same disagreement
- `heterogeneous-tuple-return`, which is the second blocker under `os.constants`
- `sort-array-of-references`, which blocks `util.inspect({ sorted: true })`

So the instrument's value is concentrated in **getting a binding to build and run
at all**, and the comparisons are regression guards for what that reveals. That
is still worth 195 of them — a guard that has never fired is doing its job as
long as it *can* fire, which is what `--self-test` is for. But it would be wrong
to read "0 divergences" as "the probes are finding the bugs". They are finding
them one layer earlier, at the point where a wrong type or a missing symbol stops
the addon from linking, and the comparison is what confirms the fix.

The corollary for anyone extending this: **when a probe fails to build, that is
the result, not an obstacle to the result.** Three of the five findings above
were discovered while reaching for something else and were nearly filed as
"probe didn't work".

## The bindings nothing could disagree with node about

There is a category worse than "not yet checked": **no instrument in this tree
was capable of reporting these wrong.**

    the interpreted lane calls a stand-in, and a stand-in that delegates --
      globalThis.nts_os_tmpdir = () => os.tmpdir()
    agrees with node by construction whatever the C does

    the compiled lane would catch it, but only for a module that builds,
    and fifteen of twenty-two do not

A binding that is *both* stubbed by delegation and unprobed is therefore
unmeasured in the strict sense. `tooling/conformance/standin-blindspot.mjs`
counts them, and the count is meant to go down:

    310 stand-in(s); 54 delegate to node; 53 of those are probed
    1 binding(s) no lane can disagree with node about

**It started at 17 and the seventeen were named rather than counted**, because a
count cannot be worked through. Ten were `fs`: `stat` and `stat_bigint`, utf8 and
byte reads and writes by descriptor, and the `_bytes` path variants — `access`,
`realpath`, `mkdtemp`, `symlink` — which take and answer a path as a byte column
rather than a string. Those are the likeliest to be wrong and the least likely to
be noticed, because a test suite written in JavaScript passes strings.

Six more were `process`, and they looked unprobeable: `cpu_usage`, `rss`,
`memory_usage` and `resource_usage` **fill a caller-provided array and answer an
errno**, so the result is the mutation rather than the return. A homogeneous
number tuple crosses as `NtsArray *`, so the array can be handed in from
TypeScript and read back after the call, which turns a mutation into something
comparable. `umask` mutates process-global state the runner shares, so it is
probed as a round trip inside one call — set `0o077`, keep what came back,
restore, read again — and the previous mask it answers is node's own `umask`
exactly.

**The one that remains is `nts_os_cpus`**, and it is blocked for a reason that is
written down and reproducing: its declaration is `[string[], number[]]`, and the
compiler gives a heterogeneous tuple a struct return no C binding in this tree
can produce. See `blockers/heterogeneous-tuple-return`.

### Two habits that came out of this

**Compare by magnitude only where the value moves, and say why.** `cpu user
time` and `rss` differ between two calls by construction, so an equality check
there fails for a reason that is not a defect. The bands are chosen so a *unit*
error still cannot pass: milliseconds where microseconds belong is a factor of a
thousand, and a 10× band catches it.

**A count is not a shape.** `resource_usage` is checked as errno, column count,
*and* how many columns are non-negative — because a count alone passes for a
binding that fills the first two columns and leaves fourteen zeroes, which is
precisely what a short `memcpy` does.

## A defect class neither lane can see, and the audit that closes it

A binding is a triple: a `declare function` in TypeScript, an implementation in
C, and a stand-in in `bindings.node.mjs`. The first two have to agree about
*types* or the emitted C does not compile. **Nothing was checking that**, and the
reason it went unchecked for so long is that neither running lane is capable of
noticing:

- the **interpreted** lane's stand-ins delegate to node's own implementations, so
  it agrees with node whatever the C says — 78 of them do this
- the **compiled** lane would object, but only for a module that gets far enough
  to emit C, and fifteen of twenty-two never do

So a type mismatch sits silently until the day its module starts compiling —
which is precisely the day when the most other things are also changing, and the
worst possible time to first meet it.

**Two were found by hand, both in `zlib`, both the same shape.** A parameter
declared `Uint8Array` implemented as `NtsArray *`, when a `Uint8Array` lowers to
`NtsView *` — different structs. `nts_crc32` was the first. The second was seven
more signatures in the same file: `input` and `dictionary` on `nts_zlib_create`,
`nts_zlib_create_params`, `nts_zlib_write`, `nts_zlib_write_sync`,
`nts_zlib_oneshot` and `nts_zlib_oneshot_params`, plus the bytes four of them
return. The header's own contract line reads *"Every signature mirrors
src/native.d.ts exactly"*, and had been false since the file was written.

Both were found by a probe that was reaching for something else and failed to
build. That is two finds at the cost of two derailed tasks, so the third one is a
tool: `tooling/conformance/binding-abi-audit.mjs` reads every declaration and
every C prototype and compares them directly.

    177 binding(s) with a prototype checked, 0 disagreeing;
    131 declared with no prototype found

The 177 is the same number the `nm` audit calls linkable — two tools written for
different reasons agreeing on a count, which is worth more than either alone.

**Controlled rather than trusted.** Reintroducing the exact
`nts_zlib_write_sync` signature that was wrong this morning produces:

    MISMATCH  nts_zlib_write_sync
              returns Uint8Array -> NtsView *, C says NtsArray *
              param 2 is Uint8Array -> NtsView *, C says NtsArray *

and restoring it returns to 0. A check that has never been observed to fail is a
claim about a check, not a measurement of a tree. It runs in the sweep now; it
reads sources and builds nothing, so it is free.

### What the fix was worth measuring against

`zlib` compresses **byte for byte identically to node** — 28 comparisons across
deflate at levels 1, 6 and 9, `deflateRaw`, and inflate-of-deflate, over five
payloads including a 430-byte one and high bytes, 0 divergences.

That comparison is the point. `zlib`'s own tests round-trip through one
implementation, so **a compressor that is self-consistently wrong passes all of
them**. One of the checks asserts that levels 1 and 6 produce *different* sizes,
because otherwise every row above it passes for a build that ignores the level
and always deflates at one setting.

## 132 of 309 bindings have no C at all

The compiled axis is not only blocked by compiler defects. **Of 309 distinct
declared native bindings, 177 link and 132 do not** — they exist as
`declare function` in TypeScript and as a stand-in in `bindings.node.mjs`, and
nowhere else.

**This said 125 of 308 for most of a day and understated the gap by seven**, in
the direction that flattered the work. Two mistakes, and the second only showed
up because of the first. The count came from a regex over `runtime/node/<mod>/*.c`,
which (a) never looked in `runtime/c`, where shared bindings like
`nts_checkpoint` actually live, and (b) matched six things that are not
definitions. Noticing (a) while writing a `timers` probe forced a re-run, and the
re-run disagreed with itself — so neither regex was trusted and the question was
settled with a linker instead: every `.c` under `runtime/` compiled standalone
(14 objects, 0 failures) and `nm -g --defined-only` asked for the symbols that
actually exist. **That is the number below, and it is the one a link would
agree with**, which is the only opinion that matters here.

The row that was missing entirely is `internal`: 22 declared, 7 with no symbol.
It had been folded into "the rest" as complete.

| module | declared | in C | no C |
| --- | ---: | ---: | ---: |
| `fs` | 133 | 73 | **60** |
| `net` | 30 | 2 | **28** |
| `dgram` | 21 | 0 | **21** |
| `process` | 55 | 47 | **8** |
| `internal` | 22 | 15 | **7** |
| `timers` | 8 | 1 | **7** |
| `assert` | 1 | 0 | **1** |
| the rest | 60 | 60 | 0 |
| **distinct** | **309** | **177** | **132** |

The module column sums to 330 rather than 309 because a shared binding is
declared by every module that uses it; the distinct row is the one to quote.

`runtime/node/dgram/` contains **no `.c` file whatsoever**. `runtime/node/timers/`
contains none either. Verified by hand on a sample: `nts_udp_new`,
`nts_net_address_text`, `nts_net_set_keepalive`, `nts_timers_schedule` and
`nts_fs_lutimes_async` each have a stand-in and no C.

**So "fifteen modules do not compile" understates it.** Compiling is necessary
and not sufficient: `dgram` would fail to *link* with 21 undefined symbols, `net`
with 28, `fs` with 60. Every compiler fix in `blockers/` is upstream of a module
that still has to be finished afterwards.

**Why this was invisible is the same reason as everything else in this section.**
The interpreted lane runs against the stand-ins, so a binding with no C is
indistinguishable from one with a correct C — both answer correctly, and the
1,807 passing files say nothing about which. The compiled lane would say so
immediately, and reaches two modules.

It also changes what the counted lane's "did not build" rows mean. Those modules
are not fifteen instances of one distance from the goal: `os` and `zlib` have
complete native halves waiting on the compiler, and `dgram` has no native half at
all.

## `util` emits accessors that read the wrong field

In `util`'s generated C, every accessor on `Request` reads the field *after* the
one its source names:

    get method()     returns this.requestMethod    emits v0->requestHeaders
    get redirect()   returns this.requestRedirect  emits v0->requestCredentials
    get integrity()  returns this.requestIntegrity emits v0->requestKeepalive
    get url()        returns this.parsedURL.href   emits v0->blobURLObject

Checked against `runtime/web-platform/src/fetch/request.ts` line by line. Four
accessors, four shifts, all by exactly one position, in declaration order.

**Three of the four are caught by clang only because the neighbouring field has a
different type** — `NtsObj_Headers *` into an `NtsString *`, a `bool` into an
`NtsString *`, `NtsObj_Blob *` into an `NtsObj_URLRecord *`. Where two adjacent
fields share a type this compiles silently and returns the wrong value. `Request`
has eight consecutive `NtsString *` members, so most of that class's accessors
would have been silently wrong rather than loudly.

**It is not reduced, and six attempts failed.** A plain class, a class in another
module, a class with an unrepresentable member, a subclass, a subclass of an
`abstract` base, and a class whose first field has an index-signature type all
emit correct accessors. So it is none of those alone.

**The mechanism, which took a wrong first answer to reach.** The first reading
here was that `NtsObj_Request` "does not contain a `bodyState` member at all".
It does — at position **21, last**, after every one of `Request`'s own fields.
Grepping the struct for the member and getting no match from the first twenty
lines is not the same as the member being absent, and that is the claim that went
out before it was checked.

So the struct is written **derived-fields-first with the base's field appended
last**:

    NtsHeader header;
    NtsString * requestMethod;      <- Request's first own field
    NtsObj_Headers * requestHeaders;
    ... eighteen more of Request's own ...
    NtsObj_BodyState * bodyState;   <- Body's field, last

while the accessors index **base-first**, which is the ordinary layout. Under
that model `requestMethod` is index 2 and the struct's index 2 is
`requestHeaders` — every access lands one late, which is exactly what the four
accessors do.

**Eight reductions fail to produce that ordering.** A plain class; a class in
another module; a class with an unrepresentable member; a subclass; a subclass of
an `abstract` base; a subclass whose base is in another module; a class whose
first field is an index-signature type; and two subclasses of one abstract base —
all emit the base field **first** and read correctly. So the trigger for
base-last ordering is something none of those has, and it is not inheritance,
module boundaries, abstractness, or field-type representability on their own.

**The two passing modules are not affected by it, and that was checked rather
than hoped.** After writing that "the module compiles" carries more weight than
it can bear, the obvious next question is whether this profile's own green rows
are among the casualties:

    punycode   0 accessors emitted at all -- it has no class getters
    os        95 accessors, 2 miscompiled: Blob.size, File.lastModified
              both with 0 call sites -- a declaration and a definition, nothing
              reaching them

So `punycode` 2 of 2 and `os` 4 of 7 stand as measured. The two miscompiled
accessors in `os`'s program arrive through the provider chain that also drags in
the stream dictionaries, and nothing in `os` calls them. That is a narrower and
better answer than "the counts mean less than they read": for these two modules,
they mean exactly what they say.

**And a second, worse one in the same file.** `Response__get_status` ignores its
receiver entirely:

    double Response__get_status(NtsObj_Response * v0) {
        (void)v0;
        double v1;
        v1 = 0.0;

where `response.ts:117` says `return this.responseStatus;` and the struct has
`int32_t responseStatus` in it. **No refusal is reported for that line** — `hir`
says nothing about `response.ts:110-129`. Its sibling accessors on the same class
are correct: `statusText`, `redirected`, `type` and `url` all read their fields.

That one has no type mismatch to catch it. It compiles clean, links, loads, and
answers `0` for every response's status. **A `fetch` that checked `response.ok`
or `response.status` would take the wrong branch, always, with nothing anywhere
reporting a problem.**

`NtsObj_Response` also has its `bodyState` near the *front*, unlike
`NtsObj_Request` — so the base-last ordering is not universal either, and these
are two defects rather than one with two faces.

Ten reductions have failed to produce either: the nine above, plus a mutable
`private` field with a getter, which was the obvious guess from
`responseStatus` being mutable where `responseStatusText` is `readonly`.

Recorded unreduced because the real-world instance is unambiguous and the
compiler lane is looking at `util` now. A fixture would be better and does not
exist yet.

## What stops all of it compiling

> Re-derived from a type graph that is no longer truncated. See the note under
> *Modules* for why the earlier version of this section could not be trusted.

**12,278 functions lower to HIR across twenty-two modules, against 6,794
refused.** The wording matters and this file got it wrong for most of a day.
*"Functions lower"* reads as a claim about the product; it is a claim about one
stage. The C backend refuses some of these afterwards, and the artifact axis is
where that shows — this document's own rule about a green step being a claim
about what it looked at applies to a green number too.
The prose below was written against 1,509, and before that 946; read its
*reasoning* and not its arithmetic until each claim is re-derived.

> **Measured: 4,498 of the 12,298 — 36.6% — are refused afterwards by the C
> backend.** So roughly 7,800 functions reach an artifact, and this column has
> been about 1.6× that all along. `sweep.mjs --compiles` reports the third
> figure per module now.
>
> | module | backend-refused | | module | backend-refused |
> | --- | ---: | --- | --- | ---: |
> | `fs` | 715 | | `readline` | 259 |
> | `http` | 577 | | `process` | 252 |
> | `dgram` | 394 | | `url` | 231 |
> | `net` | 316 | | `os` | 144 |
> | `zlib` | 308 | | `querystring` | 137 |
> | `stream` | 295 | | `punycode` | 6 |
>
> **And 95% of it is call cascades, which corrects the emphasis elsewhere on
> this page.** Grouped by the reason the backend gives:
>
> ```
> 4,267   cannot be compiled because it calls X      (95%)
>   231   cannot be compiled because it reads X      (5%, all lost initializers)
>    12   module#init itself
> ```
>
> **Walked to their terminals, the cascades converge on 340 places, not on a
> handful and not on four thousand.** Deduplicating function names across
> modules gives 1,188 distinct cascaded functions reaching 340 distinct
> terminals, and the ten largest cover 443 of them — 37%:
>
> ```
> 114  determineSpecificType            23  getValidatedBytePath
> 114  ERR_OUT_OF_RANGE#constructor     21  asRequest
>  64  trackPromise                     16  decodeIn
>  35  EventEmitter#emit                16  Socket##healthCheck
>  25  Readable#read                    15  destroyQueue
> ```
>
> Two of the top three are `internal/errors.ts` again —
> `ERR_OUT_OF_RANGE#constructor` and the `determineSpecificType` that builds its
> message — which is the same layer `ERR_INVALID_ARG_TYPE` sits in and the same
> finding from a different direction: **node validates its arguments
> everywhere, so its error constructors are under everything.**
>
> **The largest terminal was checked and it is a genuine root, one construct at
> one line.** `determineSpecificType` spans `internal/errors.ts:24–76` and is
> never the subject of its own refusal message — its reason is reported as a
> construct instead, at line 34:
>
> ```
> internal/errors.ts:34  NTS1001 an `unknown` narrowed to BigInt,
>                        which it cannot be read back as
>
>   case "bigint":
>     return `type bigint (${value}n)`;
> ```
>
> That gives a chain worth reading end to end:
>
> ```
> errors.ts:34   an `unknown` narrowed to BigInt        one construct
>   -> determineSpecificType                            114 cascades
>   -> ERR_INVALID_ARG_TYPE#constructor
>   -> validateString / validateObject / validateNumber / validateBoolean / …
>   -> most of the profile's public surface
> ```
>
> This morning's walk stopped at `ERR_INVALID_ARG_TYPE` and called it the root.
> It is not the root; it is one link. **The root is a single `case "bigint"` in
> a function that builds an error message**, and it is under the validator layer
> that is under everything else.
>
> **The artefact caveat is now discharged for all ten.** None of the top ten
> terminals is ever the subject of its own `cannot be compiled` line, so none
> is a function whose cascade edge this parse missed — they are genuine roots.
>
> Attributing a *reason* to each is a weaker exercise and is labelled as such.
> Locating a function by grep and taking the `NTS1001`s within seventy lines of
> it gives candidates, not attributions: the same method offers
> `determineSpecificType` a second reason at line 87 when the function ends at
> 76. Read the right-hand column as "constructs near this root", and only
> `determineSpecificType`'s has been checked against the function's actual
> range.
>
> ```
> determineSpecificType     an `unknown` narrowed to BigInt          (verified)
> ERR_OUT_OF_RANGE#ctor     a `new` with arguments and no constructor
> trackPromise              a module-scope variable of unrepresentable type
> Readable#read             an `in` naming a name on an object
> getValidatedBytePath      an `instanceof` against a class this compiler lacks
> decodeIn                  `toString` on a number
> Socket##healthCheck       a function returning the type parameter `Result`
> EventEmitter#emit         — not located
> asRequest                 — not located
> destroyQueue              — not located
> ```
>
> Three of ten could not be located at all, which is the honest yield of a
> grep-and-window heuristic and the reason this is still a shape rather than a
> work list.
>
> One caveat still limits the table above: names are deduplicated across
> modules, so 1,188 is distinct functions and not the 4,267 per-module
> citations.
>
> The `module#init` choke point is real and it is what empties five modules'
> *export tables* — but it accounts for 231 of the 4,498, not the bulk. The
> mass is ordinary cascade from root refusals: a function refused because
> something it calls was refused. **Those are two different facts and this
> document had been letting the first stand for both.** The choke point governs
> whether a module publishes; the cascades govern how much of it would be there
> if it did.
>
> Every module loses a substantial fraction, so this is not one pathological
> case — it is the ordinary distance between the two stages. The compiler
> session predicted the quantity existed and guessed its scale from the one
> instance either of us had seen: *"today it was five functions in one module
> and nobody knew."* It is five functions in `punycode` and 4,498 across the
> profile.
>
> **This column counts HIR lowering and is blind to what the C backend
> refuses.** `nts hir` reports `punycode` at **16 functions lowered, 3
> refused**. `emit-c --napi` on the same module and the same binary then
> refuses six more — `encode`, `decode`, `mapDomain`, `toASCII`, `toUnicode`,
> the module's entire public surface — and its artifact publishes nothing.
>
> That is not a discrepancy to reconcile; the two commands run different
> passes. The HIR pass that drops callers of refused functions runs long
> before the backend can refuse anything, so a backend refusal is invisible
> here by construction. **So 12,278 is an upper bound on what reaches an
> artifact, and for some modules a very loose one.**
>
> The clearest demonstration is a pair of binaries where the two axes moved in
> opposite directions: `adc9e193` and `8c305c87` report *identical* totals,
> 12,278 / 6,794, while between them the artifact axis went from five modules
> building with two segfaulting to eight building with none. A whole class of
> defect was fixed and this column did not move by one.

**This axis is moving, and a single anchored figure understates that.** Three
measurements inside one hour, each from its own pinned copy while
`target/release` moved on underneath:

| binary | lowered | refused |
| --- | ---: | ---: |
| `982ffe1f` | 12,181 | 6,878 |
| `81d82619` | 12,226 | 6,839 |
| `adc9e193` | **12,278** | **6,794** |

Roughly +50 lowered and −45 refused per rebuild, sustained. The per-module
table below carries the `982ffe1f` figures and is re-derived when a change is
large enough to be worth a per-module read; the totals are the pinned pairs
above.

**The compiled-artifact axis did not move across any of the three.** 17
`c-did-not-compile`, 2 `built-exports-nothing`, 2 `built-exports-partial`, 1
`all-passes-degenerate`, 0 green, identical each time — and `punycode`'s three
named blockers are unchanged across all three binaries.

That divergence is the clearest thing this document has ever had to say about
why it keeps two axes. **What lowers is improving steadily and what ships has
not moved at all.** A profile reporting only the first would look like healthy
progress; a profile reporting only the second would look stalled. Both are
true, they are measuring different things, and the gap between them is the
N-API boundary rather than the lowering.

The compiled-artifact axis did **not** move across the same pair — 17
`c-did-not-compile`, 2 `built-exports-nothing`, 2 `built-exports-partial`, 1
`all-passes-degenerate`, 0 green, identical to the previous run. Worth stating
because the two axes came from one binary and one afternoon: a compiler change
can move what lowers without moving what ships, and this is what that looks
like.

| module | lowered / refused | | module | lowered / refused |
| --- | :---: | --- | --- | :---: |
| `fs` | 1560 / 1168 | | `console` | 433 / 246 |
| `http` | 1338 / 989 | | `util` | 408 / 189 |
| `dgram` | 880 / 555 | | `assert` | 401 / 210 |
| `zlib` | 829 / 785 | | `os` | 375 / 100 |
| `net` | 825 / 511 | | `string_decoder` | 371 / 97 |
| `stream` | 805 / 684 | | `querystring` | 366 / 101 |
| `url` | 629 / 197 | | `buffer` | 360 / 93 |
| `readline` | 625 / 363 | | `events` | 331 / 125 |
| `process` | 575 / 247 | | `timers` | 281 / 66 |
| `async_hooks` | 259 / 57 | | `diagnostics_channel` | 257 / 59 |
| `path` | 257 / 33 | | `punycode` | 16 / 3 |

Taken with `sweep.mjs --compiles --no-tests`, `stat`ing `target/release/nts`
before and after and finding the mtime unchanged across the run. That guard is
not ceremony here: this tree is shared with the compiler lane and the binary
moved three times during the tranche that produced the test table — 01:19:47Z,
02:43:11Z and 03:03:02Z. A run spanning any of those is the mixed-binary
measurement this document already says to discard. The reason this one could be
taken at all is that `--compiles --no-tests` finishes in seconds and fitted
between two rebuilds.

The per-module figures are deliberately *not* in the *Modules* table any more.
They come from a different run against a different artifact, on a cadence set
by another session, and a stale figure sitting in a live table reads as
current — which is how that table came to claim 766 passing files while the
sweep said 1,719.

**Which half moved, measured rather than assumed.** 946 → 1,509 → 12,181 is a
joint measurement of two things that both grew — this corpus, and the compiler
lowering it — and a profile total that only rises is measuring reach and can
call that progress. One pinned binary over two corpora separates them:

| | lowered | refused |
| --- | ---: | ---: |
| `runtime/node` at `0cd8645f`, compiler of that day | 1,509 | — |
| `runtime/node` at `0cd8645f`, **today's** compiler | **6,576** | 3,969 |
| `runtime/node` today, today's compiler | **12,181** | 6,878 |

**Read it as a rate, because the raw counts move for two reasons.** Today's
compiler enumerates about 10% more functions from the same source than the one
that produced the 1,509 — the functions-seen ratio is 1.05–1.13 for twenty of
the twenty-two modules, with only `os` at 1.20 and `punycode` at 1.25, and
`punycode`'s is four functions. A uniform ratio across every module is what a
change in the compiler's own accounting looks like; corpus drift would hit some
modules hard and leave others alone. So part of any raw gain is simply more
functions being counted, and the fraction is the figure that survives it:

| | functions seen | lowered | **rate** |
| --- | ---: | ---: | ---: |
| `0cd8645f`, compiler of that day | 9,583 | 1,509 | **15.7%** |
| `0cd8645f`, today's compiler | 10,545 | 6,576 | **62.4%** |
| today's corpus, today's compiler | 19,059 | 12,181 | **63.9%** |

**The compiler went from lowering a sixth of this corpus to lowering
five-eighths of it** — 15.7% to 62.4% on source that did not move, which is
4.0× in rate and is not an artifact of the counting change. Separately, the
corpus grew 1.81× (10,545 functions to 19,059) at almost exactly the same
lowering rate, 62.4% to 63.9%. That second fact is worth as much as the first:
the modules written since are neither harder nor easier to lower than the ones
that were there, so the corpus grew without changing what it is a test of.

**Which half rests on what.** The 1,509 is inherited — it comes from this
document at `0cd8645f`, taken by another session at compiler `9bb54c1e`, and
the two commits are the same day. Its own per-module column sums to exactly
1,509 across the same twenty-two modules, and the uniform functions-seen ratio
says it describes this corpus rather than a different one; that is the evidence
for trusting it, and it is circumstantial. **Everything about the compiler's
improvement depends on it.** Everything about the corpus's growth does not:
those two rows are both mine, taken minutes apart with one pinned binary
(SHA-256 `38a8de6d…`), and comparing them needs no inherited number at all.

The tranche that produced the current test numbers does not disturb these. It
changed `runtime/node/http` and `runtime/node/net`, and neither module has a
compiled half: `net.c` is eleven lines of default values and the socket
operations have no C at all. That is also why changing `nts_net_write` from
`number[]` to `Uint8Array` and adding `nts_net_lookup_all` touched only the
`declare function` and `bindings.node.mjs` rather than the usual triple — and
those are the shapes that C has to satisfy whenever it is written.

**Three causes account for most of it, measured across the two largest
modules.** In `process` (219 refusals) and `stream` (498):

| cause | `process` | `stream` |
| --- | :---: | :---: |
| a parameter of unrepresentable type `unknown` | 62 | 120 |
| an object with an optional property | — | 117 |
| a base `Uint8Array` (that is, `Buffer`) | — | 76 |
| a property of type `T | undefined` | 76 | 54 |
| a function declaration outside every walk | 11 | 14 |
| a base `Set` | 10 | — |
| `for await` | — | 8 |

`unknown` in parameter position is the largest and the least avoidable: it is
node's own signature for every validator — `validateString(value: unknown,
name: string)` — and `internal/validators.ts` is imported by every module here.
Whatever fraction of those 182 is real, it is the same fraction everywhere.

The optional-property entries are one shape wearing three hats. `_maxListeners`,
`exitCode` and `depth` are all "a numeric property that may be absent", and
`stream`'s 117 "object with an optional property" is the same thing from the
other side — an options object with `{ highWaterMark?: number }`. Together they
are about 200 across the two modules.

`Buffer extends Uint8Array` is 76 in `stream` alone and will be in `fs`, `net`
and `zlib` too, since everything that moves bytes touches it.

Two entries do not mean what they look like. **"A function declaration outside
every walk" is not dead code** — it is a conservation check, that every
function the checker knows about is either lowered or refused and never
silently absent. All of ours are `get`/`set` accessors inside an object literal
passed to `Object.defineProperty`, which nothing in the lowering walks yet.
They are correctly refused rather than wrongly written, and deleting them would
be deleting working code to make a counter smaller.

**The `base Set` entry is deliberately left alone.** It is
`allowedNodeEnvironmentFlags`, which subclasses `Set` because node's does and
because the subclass is what makes the object immutable from outside. Ten
refusals is not worth replacing it with a delegation layer that would then be a
divergence from node to maintain and explain. A refusal naming the real
construct is more useful than a workaround that hides it.

Every module together, ranked — a work queue ordered by how much of the Node
surface each item unblocks, rather than by how often it appears in a corpus of
test files. The counts below were taken across eight modules and have not been
retaken since `console`, `diagnostics_channel` and the `assert` rewrite landed;
the ranking has not changed, but the absolute numbers are now low.

**`Object` is now the top blocker, and it arrived by a route worth recording.**
The compiler used to treat a name declared only by `lib.d.ts` as an FFI import:
it emitted a prototype, produced a link error, and reported the enclosing
function as lowered. Once that was fixed, twenty-five sites across the profile
started refusing honestly, and `fs` fell from 28 lowered functions to 20. The
drop is the measurement starting to work -- those eight functions were being
emitted incomplete.

What the profile asks of it, counted across `runtime/node`:

| | sites | | sites |
| --- | ---: | --- | ---: |
| `Object.prototype.hasOwnProperty` / `propertyIsEnumerable` | 24 | `Object.getOwnPropertyDescriptor` | 6 |
| `Object.defineProperty` | 21 | `Object.create` | 5 |
| `Object.is` | 15 | `Object.setPrototypeOf`, `Object.assign` | 4 each |
| `Object.keys` | 14 | `Object.getOwnPropertyNames`, `freeze` | 3 each |
| `Object.hasOwn` | 9 | `String(x)` | 47 |
| `Object.getPrototypeOf` | 8 | `Number(x)` | 6 |

`Object.prototype.hasOwnProperty.call(x, k)` is the single most common shape
here: it is what a key walk is made of, and every comparison, every inspection
and every option-object read is a key walk.

**Two rows in that table are features rather than builtins, and counting them
beside the others overstates how cheap the list is.**

`Object.keys` needs a shape at run time, which is the machinery `for...in`
needs. It is not `Object.is`, which is three comparisons and a `-0` check.

`String(x)` is the one I had wrong. Twenty-two of the forty-seven are
`String(value)` where `value` is typed `unknown` — they are validators and
error constructors, and the point of the call is that the argument arrived from
JavaScript and could be anything. `String(symbol)` must answer `"Symbol(x)"`
where `` `${symbol}` `` must throw, `String(null)` is `"null"`, and `String({})`
runs `toString` off the prototype chain. So it is `ToString` on `unknown`,
which is the same dynamic dispatch as the blocker it appears to be cheaper
than. The statically-typed subset is about eight sites and is not worth a
feature on its own.

I also proposed **144 template literal interpolations** as the separable case,
on the grounds that most have statically known operands. That was wrong for a
third time and in the same way. `${count}` needs `ToString(number)` — the
shortest decimal that round-trips through a double, which is Ryu or Grisu and a
real algorithm. Only the interpolations taking a *string* are concatenation,
and I have not counted those: `typescript` in this repo is `tsgo`, which
exposes no JavaScript API, and asking the checker properly means going through
the compiler's own transport rather than adding a second TypeScript to the tree
to grep with.

**Three wrong answers in a row, all from counting syntax.** `String(x)` looked
like 47 conversions and is 22 dynamic dispatches. `Object.keys` looked like a
builtin and needs a run-time shape. `${x}` looks like concatenation and is
float formatting. A shape does not say what is underneath it, and a ranked
table built by grepping is a work queue that sends someone to the wrong item.
Where a number here is a count of syntax rather than of the thing it stands
for, it says so.

**Two refusal classes arrived from compiler changes aimed elsewhere, and both
are worth naming because neither is in the compiler's own corpus.**

*Twenty-five refusals from duplicate function names, since fixed.* `format`
collided seven ways, `parse` six, and `basename`, `dirname`, `join` and the
rest of `path`'s interface four each -- `path/src/posix.ts` and
`path/src/win32.ts` genuinely define one interface twice, because node ships
both. Two C functions may not share a name, so the refusal was correct; the
resolution was to qualify the name by the file it came from rather than to
refuse it.

**What clearing that class actually bought is the most useful number in this
file.** Twenty-five refusals went away and the profile gained *two* lowered
functions: `path` 5 to 6, `url` 28 to 29.

Template literals and `ToString(number)` then took it from **151 to 206**, and
`path` alone from 7 to 23 -- the largest single move so far, because message
construction is everywhere and every interpolation of a number needed a float
formatter.

For contrast, and it is the other half of the same lesson: accessors landing
took the profile from **121 lowered to 151**, across ten of thirteen modules --
`fs` alone from 20 to 30. One feature bought fifteen times what clearing
twenty-five refusals did, because an accessor was the *last* blocker on a great
many functions where a name collision was one of several. Nothing in a refusal
histogram distinguishes those two cases. Refusals went **up** by 35, because a
function that used to stop at the name collision is now walked further and
refuses for its real reasons.

So refusal counts and lowered counts are different currencies and do not
convert. A function refused for three reasons does not lower when one is fixed;
`basename@posix` is nameable now and still refuses for an `unknown` parameter,
a `null | number` property and a rest parameter. That makes a ranked refusal
histogram a fair guide to *breadth* -- how many places a feature is wanted --
and a poor predictor of *progress*, and every ranked table in this document
should be read that way.

*Twelve functions the compiler reached by neither walk.* All of them methods in
an object literal in argument position:

```ts
Object.defineProperty(prototype, "constructor", { get() { return Base; } });
new Proxy(target, { apply(fn, thisArg, args) { … } });
```

They were compiling to nothing while the compiler reported success, which is
the class of failure that never enters a refusal histogram and so never enters
a work queue. They are still refused, and not for the reason both sides
believed: accessors landing did not move them, because they were never blocked
on the accessor. Nothing walks an object literal in *argument position* at all,
so the `get()` inside `Object.defineProperty(o, k, { get() { … } })` is never
reached to be blocked on anything. A plausible attribution that survived two
people looking at it, corrected by an instrument that counts rather than
explains. Found by the compiler's conservation law — every declaration is
either lowered or refused, never neither — which is the one instrument here
that can see a thing that is *absent*. Every gate on this side was green while
they sat in the tree: they are unreachable from behaviour, because the
behaviour is node's.

Since the counts below were taken, one other item has moved to the top of the
list and is not in the table. **`class X extends Error`** now underlies every module in the
profile: `internal/errors.ts` is four abstract bases -- over `Error`,
`TypeError`, `RangeError` and `URIError` -- with twenty-one codes subclassing
them, and `path`, `fs`, `buffer`, `util`, `assert`, `console` and
`diagnostics_channel` all throw them. Each subclass needs one field beyond
`message` and `name`: a `string` `code`, which is what node's tests and
application code both branch on.

| refused | count | what it is |
| --- | ---: | --- |
| **`unknown`** | **~296** | 236 as a property, 60 as a parameter — one feature |
| an object with an optional property | 46 | `{ encoding?, flag?, mode? }`, which is most of `fs`; also every class extending `Error`, because `stack` and `cause` are optional |
| a name declared outside this function | 45 | module-scope tables: `hexTable`, `WINDOWS_RESERVED_NAMES`, the encodings |
| a structured type (flags 0x100000) | 27 | `Uint8Array` used as a parameter type |
| a property of unrepresentable type (a function type) | 15 | a callback stored in a record |
| indexing something that is not an array | 11 | `Record<string, number>` |
| a rest parameter | 8 | `resolve(...args)`, `join(...args)` |
| `toUpperCase` / `toLowerCase` | 8 | the win32 device comparison, encoding names |
| a parameter with a default | 8 | `getPriority(pid = 0)` and most options |

**Two things about this table are worth more than the ranking.**

The first row reads as one item only after a correction. `a property of
unrepresentable type (an object type)` looks like it is about records, and it is
not: `unknown` reaches the diagnostic as `TypeKind::Object` and prints as "an
object type", so a property typed `unknown` is indistinguishable from a property
typed `{…}`. Records nest fine — named, inline, two deep, built as a literal,
in an array — which is what makes the label misleading rather than merely vague.
Two lines reproduce it:

```ts
export class Holder { context: unknown = 0; }
export function make(): number { const h = new Holder(); return 1; }
```

And **the counts are per use site, not per cause.** There are six `unknown`-typed
properties in the whole profile. One of them — `context` on an error class in
`internal/errors.ts` — produces 176 of the 236, because every module imports
those errors and nearly every function can throw. A ranked histogram of use
sites promotes whatever lives in a shared module, which is the direction that
wastes the most time. Read this table as a list of causes, not a tally.

Why `unknown` is unavoidable here rather than a style choice:
`validateString(value: unknown, name: string)` exists because a module reached
through the Node-API wrapper is called from JavaScript, which has no types —
`readFileSync(42)` has to throw node's error rather than open a file named
`42`.

**What the profile does with `unknown`, read rather than counted.** 174
parameters, and the validators are ten of them:

| | sites | |
| --- | ---: | --- |
| carried | 56 | `...args: unknown[]` through `console`, `events`, `diagnostics_channel`. Stored in an array and passed on; nothing at the site looks at it. |
| examined | 55 | `inspect`, `format`, `deep-equal`, and `util/types`'s 36 predicates. Full generality. |
| tested | 10 | the validators. A closed `typeof` test — and an open error path. |
| the rest | ~53 | `assert`'s comparison and message machinery, mostly examined. |

The validators look like the cheap case and are not, for a reason that is not
in the test. `typeof value !== "string"` narrows, and the value flows on as a
`string`; but the `throw` hands the still-open value to `determineSpecificType`,
which dispatches on every kind and calls `inspect` for anything left. So
`unknown` reaches a type test *and* a general renderer, and the renderer is on
the path the validator exists to take.

The first row is why this needs whole-program analysis rather than a local
choice. Within `node:console`, `log(...args: unknown[])` only moves the value —
a boxed pointer would do. It is `formatWithOptions`, in `node:util`, that
examines it. The cheapest representation for `console`'s `unknown` is decided
by a use that is not in `console`.

### Module evaluation, and what a refusal count is a count *of*

A module-scope statement that cannot lower no longer takes the rest of the
module's initialization with it. Each is tried on its own and skipped alone, so
a module is not dark because of one line — the other session's work, and the
difference between "this module does not initialise" and "this line does not".

**That holds for a refused literal and not for a refused call, and the exception
is expensive.** A module-scope initializer that *calls a function containing a
refusal* still takes the whole initializer with it: no `module__init` is emitted
at all, every module-scope variable stays at its `= 0`, and every function that
reads one is dropped as uncompiled — including functions with no relationship to
the refusal. Fixtured as `blockers/modscope-refusing-call`, whose control is the
same file with a callee that lowers, and which publishes everything.

It took three failed reproductions to find, and the ones that failed are worth
keeping because they are what makes the claim above true: a refused *literal* at
module scope costs only the export that reads it, and that holds whether it sits
above or below the surviving statement, and whether it is in the same module or
an imported one.

**What it costs is read wrongly by every instrument here.** `os` ends with
`export const constants: OsConstants = readConstants()`, and `readConstants`
refuses on a property access. That one statement is why `osInformation` is never
assigned, and with it `type`, `release`, `version`, `machine`, `arch`,
`platform`, `endianness`, `EOL`, `devNull` and `constants` are never compiled —
ten of the fifteen names missing from an addon that publishes 8 of 23. `emit-c`
reports each as "no function of that name was compiled", which reads like an
export-table problem; `hir` reports no refusal on any of those lines, because
there is nothing wrong with them; and the per-module blocker chains name
`architecture` and `byteOrder` as roots, which are consts rather than causes.
Three instruments, three answers, none of them the statement responsible.

Fourteen of the twenty-four built modules emit no `module__init` — `os`,
`querystring`, `url` and `util` among them, all four of which compile and
publish nothing.

**111 statements are skipped across the twenty modules**, at `f1c6959`.

The first count of these was 187, and reporting it that way was a mistake worth
keeping. `internal/errors.ts` is compiled into all twenty programs, so one line
in it reports twenty times; ranked by *refusals* the top entry was "a class used
as a value" at 114, which deduplicated to **nine lines**. The ranking inverts
when you deduplicate — by distinct lines the largest entry is `Object`, which is
a missing builtin table rather than a representation decision. **A count is only
a count if you know what its unit is**, and the two units disagree about what to
do next:

- **by blast radius**, nine lines that wire up prototypes across many modules
  each;
- **by distinct work**, fourteen sites wanting one builtin.

Four of those nine lines were `internal/errors.ts`'s
`reportBaseConstructor(NodeTypeError.prototype, TypeError)` and its siblings —
76 refusals from four lines — and going to look at them found something the
refusal count could not have: **they never worked.** The getter went on the
*base* prototype, and every concrete error class shadows it with the
`constructor` that class syntax gives it. `err.constructor` had been returning
`ERR_INVALID_ARG_TYPE` where the comment promised `TypeError` since the file was
written. It is on all 48 concrete classes now, as node has it, and works.

The way that surfaced is the part to keep. The rewrite was meant to be
behaviour-preserving, so the check was written to confirm nothing broke; it
failed, and the same check against the previous commit failed identically.
**A test written to confirm a refactor is safe is also a test of whether the
thing was ever working** — and it was nearly not written, for exactly the reason
that makes it valuable.

Per-module *refused* counts rose as a result — `buffer` 187 to 229 — because 48
accessors that did not exist are now 48 honest refusals, while lowered stayed at
1,309. That is the right direction: a refused accessor costs `err.constructor`
in a compiled build, where a refused module-scope statement cost every value the
line would have computed.

**And the ranking inverted, because four lines were deleted rather than
lowered.** What remains, deduplicated, is 39 distinct lines:

| refusals | lines | construct |
| ---: | ---: | --- |
| 38 | 5 | a class used as a value |
| 30 | 14 | `Object` — a global with no definition here |
| 13 | 7 | a function used as a value |
| 13 | 2 | a `for...of` of unexpected shape |
| 7 | 3 | a `for...of` binding of this shape |
| 5 | 5 | a module-scope variable holding a reference |
| 3 | 1 | a name from an enclosing scope |
| 2 | 2 | a closure over a name from more than one scope up |

`Object` is now the largest by distinct lines, 14 to 5, and it is the entry that
is a missing builtin table rather than a representation decision. The five
remaining class-as-value lines are `EventEmitter.prototype.on =
EventEmitter.prototype.addListener` and two beside it in `events` (ten modules
each), plus one in `stream/main.ts` and one in `stream/transform.ts` (four
each). Unlike the four that went, those are node's own shape and cannot be
written away.

Both counts were reproduced independently from the other session's tree at
`d728129`, which is the only reason they are stated without hedging.

## What stops `path` compiling

> Re-derived from a type graph that is no longer truncated. See the note under
> *Modules* for why the earlier version of this section could not be trusted.

### Measured end to end: seventeen exports, two published, one chain

`path` builds — `target/node/path.node`, 236968 bytes — and publishes
`toNamespacedPath` and `_makeLong`. Nothing else. All eleven public functions
refuse through a single chain, and `nts layouts` prints it directly:

    basename dirname extname format isAbsolute join matchesGlob
    normalize parse relative resolve                      (11 of 11)
      <- validateString                    internal/validators.ts:21
      <- ERR_INVALID_ARG_TYPE#constructor  internal/errors.ts:347
      <- determineSpecificType             internal/errors.ts:24

**`toNamespacedPath` publishes only because it is the one function in
`posix.ts` that does not validate its argument.** That is the entire difference
between the two names that survive and the eleven that do not — not the star
re-export, not the name, not the signature. A hypothesis about each of those
was tested and discarded before the chain was found.

`determineSpecificType` is a `switch (typeof value)` over an `unknown` whose
arms read the value back at the narrowed type. Three roots, not one:

| site | construct |
| --- | --- |
| `errors.ts:34` | `case "bigint"` — an `unknown` narrowed to BigInt, read back |
| `errors.ts:53` | `case "symbol"` — the same, for Symbol |
| `errors.ts:89` | `staticObjectName` — `instanceof` with no class for the right side |

The narrowing is the refusal, not the conversion: `String(v)` refuses exactly
where `` `${v}n` `` does, an `if` behaves as a `switch` arm does, and a
parameter *declared* `bigint` compiles.

**And the source cannot be written differently, which was checked rather than
assumed.** Node's own `determineSpecificType` (`lib/internal/errors.js:996`) is
this function line for line — the same `switch (typeof value)`, the same
`` `type bigint (${value}n)` ``, the same `` `type symbol (${String(value)})` ``.
The only divergence is the `object` arm, where node reads
`value.constructor.name` and this profile calls `staticObjectName` instead,
because reading a constructor's name is a §13 non-goal. So the two narrowed
reads are node's code shape and not ours, there is no faithful rewrite that
avoids them, and the only place this can be fixed is the compiler. `instanceof` was tested per class —
`Uint8Array`, `ArrayBuffer` and `Promise` work; `DataView`, `Map`, `Set` and
`Date` have no class.

**Only the first refusal in a function is reported, and that is worth knowing
before estimating from a refusal count.** Stubbing the bigint arm and
rebuilding left the count at exactly 32: line 34 disappeared and line 53
appeared, having been there all along. Each of the three roots cost a separate
build to discover. So **a refusal count is a count of refused functions, not of
work** — `path` reads as 32 and is really 32 functions with an unknown number
of constructs behind them. Every estimate made from such a count in this
document is a lower bound.

The remaining exports are the same value-and-namespace gap `punycode` hit:
`sep` and `delimiter` are string constants, `posix` and `win32` are
`export * as` namespaces. For `path` the namespaces are the larger half, since
node's tests use `path.posix.*` and `path.win32.*` throughout.

Two entries in the *not published* list are a false positive rather than work:
`FormatInputPathObject` and `ParsedPath` come from `export type { ... }`, are
erased at compile time, and have nothing to publish. Reported to the compiler
lane.

**The shape of this is worth stating plainly.** The largest gate on the
compiled axis is the error-message formatter, and it is the code least
exercised by the happy path. `determineSpecificType` exists to spell the tail
of an `ERR_INVALID_ARG_TYPE` message, and it costs the whole of `node:path`.

**Three causes account for most of it, measured across the two largest
modules.** In `process` (219 refusals) and `stream` (498):

| cause | `process` | `stream` |
| --- | :---: | :---: |
| a parameter of unrepresentable type `unknown` | 62 | 120 |
| an object with an optional property | — | 117 |
| a base `Uint8Array` (that is, `Buffer`) | — | 76 |
| a property of type `T | undefined` | 76 | 54 |
| a function declaration outside every walk | 11 | 14 |
| a base `Set` | 10 | — |
| `for await` | — | 8 |

`unknown` in parameter position is the largest and the least avoidable: it is
node's own signature for every validator — `validateString(value: unknown,
name: string)` — and `internal/validators.ts` is imported by every module here.
Whatever fraction of those 182 is real, it is the same fraction everywhere.

The optional-property entries are one shape wearing three hats. `_maxListeners`,
`exitCode` and `depth` are all "a numeric property that may be absent", and
`stream`'s 117 "object with an optional property" is the same thing from the
other side — an options object with `{ highWaterMark?: number }`. Together they
are about 200 across the two modules.

`Buffer extends Uint8Array` is 76 in `stream` alone and will be in `fs`, `net`
and `zlib` too, since everything that moves bytes touches it.

Two entries do not mean what they look like. **"A function declaration outside
every walk" is not dead code** — it is a conservation check, that every
function the checker knows about is either lowered or refused and never
silently absent. All of ours are `get`/`set` accessors inside an object literal
passed to `Object.defineProperty`, which nothing in the lowering walks yet.
They are correctly refused rather than wrongly written, and deleting them would
be deleting working code to make a counter smaller.

**The `base Set` entry is deliberately left alone.** It is
`allowedNodeEnvironmentFlags`, which subclasses `Set` because node's does and
because the subclass is what makes the object immutable from outside. Ten
refusals is not worth replacing it with a delegation layer that would then be a
divergence from node to maintain and explain. A refusal naming the real
construct is more useful than a workaround that hides it.

`nts hir` refuses 38 constructs and lowers 1 function. Ranked, and every one of
them is in [`typescript.md`](typescript.md) as a language feature rather than
anything specific to Node:

| refused | count | what needs it |
| --- | ---: | --- |
| a name declared outside this function | 19 | the `CHAR_*` constants and `WINDOWS_RESERVED_NAMES`, imported at module scope |
| a parameter of unrepresentable type (`unknown`) | 6 | `validateString(value: unknown, …)` — a JavaScript caller can pass anything |
| an object with an optional property | 5 | `format`'s `{ dir?, root?, base?, name?, ext? }` |
| a rest parameter | 4 | `resolve(...args)`, `join(...args)` |
| this expression | 2 | template literals |
| this string method | 1 | `toUpperCase` / `toLowerCase`, in the win32 device comparison |
| this statement | 1 | `break` / `continue` |

None of these is a design question. They are the ordinary language, and the
module compiles unchanged when they arrive.

## What stops `os` compiling

> Re-derived from a type graph that is no longer truncated. See the note under
> *Modules* for why the earlier version of this section could not be trusted.

**Three causes account for most of it, measured across the two largest
modules.** In `process` (219 refusals) and `stream` (498):

| cause | `process` | `stream` |
| --- | :---: | :---: |
| a parameter of unrepresentable type `unknown` | 62 | 120 |
| an object with an optional property | — | 117 |
| a base `Uint8Array` (that is, `Buffer`) | — | 76 |
| a property of type `T | undefined` | 76 | 54 |
| a function declaration outside every walk | 11 | 14 |
| a base `Set` | 10 | — |
| `for await` | — | 8 |

`unknown` in parameter position is the largest and the least avoidable: it is
node's own signature for every validator — `validateString(value: unknown,
name: string)` — and `internal/validators.ts` is imported by every module here.
Whatever fraction of those 182 is real, it is the same fraction everywhere.

The optional-property entries are one shape wearing three hats. `_maxListeners`,
`exitCode` and `depth` are all "a numeric property that may be absent", and
`stream`'s 117 "object with an optional property" is the same thing from the
other side — an options object with `{ highWaterMark?: number }`. Together they
are about 200 across the two modules.

`Buffer extends Uint8Array` is 76 in `stream` alone and will be in `fs`, `net`
and `zlib` too, since everything that moves bytes touches it.

Two entries do not mean what they look like. **"A function declaration outside
every walk" is not dead code** — it is a conservation check, that every
function the checker knows about is either lowered or refused and never
silently absent. All of ours are `get`/`set` accessors inside an object literal
passed to `Object.defineProperty`, which nothing in the lowering walks yet.
They are correctly refused rather than wrongly written, and deleting them would
be deleting working code to make a counter smaller.

**The `base Set` entry is deliberately left alone.** It is
`allowedNodeEnvironmentFlags`, which subclasses `Set` because node's does and
because the subclass is what makes the object immutable from outside. Ten
refusals is not worth replacing it with a delegation layer that would then be a
divergence from node to maintain and explain. A refusal naming the real
construct is more useful than a workaround that hides it.

16 of 31 functions lower. The rest:

| refused | count | what needs it |
| --- | ---: | --- |
| indexing something that is not an array | 3 | `Record<string, number>` for `os.constants` |
| a parameter of unrepresentable type (`unknown`) | 3 | the validators |
| an object with an optional property | 3 | `NetworkInterfaceInfo.scopeid` |
| a parameter with a default | 2 | `getPriority(pid = 0)` |
| a union of `number \| undefined` | 1 | `setPriority(pid, priority?)` |
| `null` where it is not a reference | 1 | `UserInfo.shell` is `string \| null` |
| an array method on a non-numeric array | 1 | `push` onto `CpuInfo[]` |
| a name declared outside this function | 1 | |

## Conventions

**Faithful, not adapted.** Bodies are transcribed from node. Where a construct
is not supported, the code keeps node's version and does not compile yet.
Rewriting `break` into a flag would compile today and would have to be unwound
later, and the refusal list would stop being an accurate measure of what is
missing.

**Scaffolding is ours.** Node destructures its primitives from `primordials`
and hangs its functions off one object literal per platform. Ours are ordinary
imports and ordinary exports. `primordials` exists so that node's library
survives a program that reassigns `String.prototype.slice`; a compiled program
has no such prototype, so the indirection buys nothing.

**The native half is `declare function`.** One declaration, satisfied two ways:
compiled it is an extern linked against the module's own C; on node the
declaration erases and the call becomes a global lookup, which the module's
`bindings.node.mjs` supplies. The same source runs both ways, and `nts check`
is what compares them.

**libuv, not reimplementation.** The C calls the same library node calls, so
node's semantics are inherited rather than reimplemented and then tested for.

**A compiled module was missing its initialization entirely, and neither axis
showed it.** Module-level statements used to be dropped silently: the program
compiled, reported success, and behaved as though the lines were not there.
The compiler runs them now, as a `module#init` an embedder calls first, and
what had been vanishing across this profile is twenty-three statements:

| module | what a compiled build was missing |
| --- | --- |
| `url` | `setDomainToAscii` and `setDomainConversions` — **all** of IDNA, so every non-ASCII host would have gone through unconverted |
| `events` | the `kCapture` default on the prototype, so `captureRejections` read `undefined` |
| `buffer` | the `Uint` aliases and the custom inspection |
| `console`, `assert` | the callable-without-`new` wrappers, which *are* those objects' public shape |
| `internal/errors` | `reportBaseConstructor` on all four bases |
| `internal/colors` | `refresh()`, so every colour was the empty string |
| `util` | the colour aliases |
| `os` | the `Symbol.toPrimitive` that makes `` `${os.hostname}` `` the hostname |

Only `punycode`'s lowers today. **Twenty-three of the twenty-four are blocked
by one refusal**, and it is not the one the histogram suggested:

```
top-level statements in a second module, whose evaluation order
this compiler cannot see
```

filed against eleven files at `1:1`. `Object` and the non-constant module-scope
initializer are real and are *behind* it — what those statements would refuse
on next, not what they refuse on now — so moving either would unblock nothing.

And it explains `punycode`: it is the only module here that imports nothing
from another profile module, which is the same rule seen from the other side.

**The join that found this is the point.** A histogram of refusal causes named
`Object`; joining refusal *locations* to statement locations named evaluation
order. The first would have sent someone to the wrong work. It nearly did —
matching on line numbers found nothing, because this refusal is filed against
the file rather than the statement, and only widening the join to the file
surfaced it.

There is a sharper version of the question, too. Because one refused statement
loses the *whole* initializer, the useful question is not "which cause appears
most often" but "which cause, removed, lets a module have **any**
initialization". Those give the same answer here and come apart as soon as two
causes are live in one file.

**Worth naming as a gap in this document's own measurement.** The `compiles`
column counts lowered *functions*. These are statements, so a module could
have shown a rising function count while its initialization silently did
nothing — and did. A number that cannot express a whole category of failure is
a number that will not report it.

**A module owns all three halves of its bindings.** A binding is a triple: a
`declare function` in the TypeScript, a stand-in in `bindings.node.mjs`, and
the C. All three live in the module's directory, so the pair a reader has to
check against each other can be read side by side:

```
runtime/node/fs/     src/*.ts  bindings.node.mjs  fs.c  fs.h
runtime/node/os/     src/*.ts  bindings.node.mjs  os.c  os.h
runtime/node/internal/  *.ts   shared.c  shared.h  process.c  nts_node.h
```

`internal/` is what more than one module needs, in both languages — the same
rule for the TypeScript and for the C. A binding lands there when a *second*
module declares it: `nts_process_env` is read by `console`, `path` and `util`,
so it is not `path`'s to own, and it moves into `node:process` when that
exists.
