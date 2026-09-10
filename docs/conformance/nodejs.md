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

## The counted lane again, over nine modules and on the current binary

The earlier run covered the seven that built then. Nine build now, so it was
re-run on the 14:18 probe binary from a tree pinned at `9b116611`:

    module                counted                    rc sites
    async_hooks           0 of 115                      148
    buffer                0 of 55                       196
    diagnostics_channel   0 of 32                       147
    os                    4 passed, 4 failed            229
    path                  2 of 22, 1 skipped             26
    punycode              3 of 3                         55
    querystring           0 of 7                        214
    string_decoder        0 of 4                        197
    url                   0 of 52                       454

**1,666 retain/release sites, and every result is identical to the uncounted
lane.** No invalid HIR, no `NOT COUNTED` row, no `OVERWRITTEN` row, no crash
under poison. Reference counting still changes nothing observable.

`punycode` additionally ran **140,224 differential comparisons** against node
over 20,000 random inputs and 32 fixed, with **0 divergences and 0 property
failures**, while counted — and it is 3 of 3 now rather than 2 of 2, because the
export-surface test added today runs in that lane too.

The three modules that were not in the earlier run — `async_hooks`,
`diagnostics_channel` and `string_decoder` — are there because
`callback-binding` and a prototype fix in `internal/nts_node.h` let them build.
All three publish too little to pass anything, which is the same story the
uncounted lane tells; the point of running them here is that counting does not
add a failure to a module that had none of its own.

## Most `charCodeAt` calls in this profile take the truncating path

The web-platform lane established that an index crossing a `number` **parameter**
stops being an integer: a loop-local index is proved int32 and reaches
`nts_str_char_code_at_int`, while a parameter is a double and reaches
`nts_str_char_code_at`, which truncates through `ToIntegerOrInfinity` and
compares twice in floating point — per character. Worth 46% on their scan row.

Counted in the emitted C of every module that builds:

    module            fast (int)   slow (double)
    punycode               3            1
    path                   2            0
    os                     6           10
    buffer                 6           10
    string_decoder         6           10
    querystring            6           13
    url                   14           14

**Five of seven take the slow path more often than the fast one.** The two that
do not are `punycode` and `path` — and `punycode` is the one module on this axis
that passes.

Not acted on here. The cause is inference across a parameter boundary and the
compiler lane has the general form; restructuring this profile's helpers to keep
indices loop-local would be a per-site workaround for something better fixed
once, which is the same judgement as the three declined rewrites above. Recorded
because it is a measurement of *this* profile that nobody had taken, and because
a module that compiles and is slow is a different problem from one that does not
compile — this axis will reach the first kind eventually.

## A sixth hollow fixture, and the property it named was the wrong one

`refused-callback-null-vtable` reported `reproduces` on the gated commit. It is
fixed.

It expected `emits-c 0u, 0u, 0, 0, "Closure0"` — the null method table — and
**that string is still emitted**. What changed is that nothing reaches it. On the
gated build, `timers` has exactly two closures with a null slot, `Closure54` and
`Closure55`, and **neither is referenced by address**; the two addresses the
program does take belong to `Closure20`, which has a real vtable.

**A null `methods` pointer on an unreferenced static is harmless. A null
`methods` pointer the host can call through is a crash on the first
invocation.** The expectation named the pointer and not the reachability, so it
could not tell those apart — and reachability is the entire defect.

It is now `lacks-c &nts_fnval_NtsObj_Closure0`: the closure's address is never
taken.

**Two wrong expectations for one fixture inside an hour**, both of the same kind.
The first replacement was `lacks-c nts_install(`, which fails against a correct
program because the *declaration* `void nts_install(NtsHeader *);` contains that
text. A string that does not mean what the property means, twice.

### And the fixture was never a faithful reproduction

Checked against the 15:39 binary as well: **the call was never emitted there
either.** So this fixture reproduced the *symptom* — a descriptor with a null
slot — without ever reproducing the *condition* that makes it a bug. It looked
like a minimal reproduction of the `timers` defect and was a minimal
reproduction of something harmless standing next to it.

That is the sixth fixture of mine to report a fixed defect, and the first where
the fault was in the reduction rather than in the expectation. The reduction was
built by taking the smallest program that produced the error text I had seen,
which is the wrong stopping rule: the smallest program that produces the *text*
is not the smallest program that has the *defect*.

## The axis on the gated commit, as three numbers

`445ea94b`, gate green on all three backends. Measured from a worktree pinned at
this lane's HEAD, through `build.sh`, binary copied to scratch:

    builds      20 of 22        fs and process are the two
    load        20 of 20        dgram fixed; it was the only one that did not
    pass        1 of 22         punycode, 3 of 3

Reported as three because they are three different claims and collapsing them is
how "twenty modules compile" gets heard as progress on an axis that measures
passing. Only `punycode` has zero failures. `os` is 4 passed / 5 failed and
`path` is 2 passed / 19 failed; neither is green and neither is close in the way
a test count suggests.

**And the summary line I first wrote for this said `passing: 3`.** It counted
modules with *any* passes rather than modules with *no failures* — `punycode`,
`os`, `path`. One `grep -c` on the wrong predicate, in the same run where the
point being made was that three numbers must not be collapsed into one. Caught
by recomputing it per module before writing it down, which is the only reason
this section does not say three.

### The failure counts went up, and that is the tests working

`os` 4 failed to 5, `assert` 11 to 12, `stream` 249 to 254. Fifteen
export-surface tests were added today and each fails against an addon that does
not publish its surface. That is the intended reading: a module publishing 3 of
15 exports should fail a test that says so, rather than only failing the
scattered files that happen to touch an absent name.

## The `export-class` arm split: no module moves on classes alone

Measured on `445ea94b`, separating the two arms of *is not a function this
backend can name* by asking the source what each unwrappable name is:

    module                class  binding  other   refusals behind it
    zlib                     16      12       2       23
    http                      7       6       1       10
    net                       5       0       1        8
    stream                    5       2       4       16
    async_hooks               4       1       0        5
    assert                    3      18       0        2
    buffer                    3       1       1        7
    timers                    3       4       1       12
    url                       3       0       0       10
    diagnostics_channel       2       0       0        5
    events                    2       4       1        7
    console                   1       1       2        1
    dgram                     1       0       0        1
    process                   1       1       2        2
    readline                  1       1       1       11
    string_decoder            1       0       1        0
    querystring               0       1       0        7
    os / path / util          0       0       0     6 / 11 / 1

**No module moves on the exported-class arm alone.** Every one has refusals
behind it — functions that were never compiled — so publishing its classes would
leave it publishing a class and not the functions beside it.

The compiler lane's guess was `zlib` and `events` move and `assert` does not.
`assert` is right, and for the reason guessed: 18 of its 21 are the
`export const x = obj.method` arm. But `zlib` has 23 refusals and `events` has
7, so neither moves on either arm.

### The exception is one module, and it is not a class question

`string_decoder` is the **only module in the profile with zero refusals**. Its
two unwrappable exports are:

    StringDecoder      export class StringDecoder
    default            export default { StringDecoder }

A class, and an object literal containing that class. So the answer to "do the
two arms ship together or separately" is: **separately buys exactly one module,
and only if a value-shaped `default` ships with the class.** Everything else
needs the refusal queue drained as well.

**That is a stronger argument for shipping them together than the reach numbers
were**, and it is the opposite of what the 82-vs-74 split suggested. Eighty-two
sites is a real count and it is not a count of modules that would move.

## `0 hollow` had never been measured, and it is true

The profile is described everywhere — including in this lane's own goal — as
*1,796 of 1,796 with 0 hollow*. The second half of that had never been checked.

`sweep.mjs` computes `degenerate` from `runAddon(module, artifact, true)`, which
is the **compiled** path. The interpreted lane, where every one of those passes
lives, had no hollow measurement at all. The number was inherited, repeated, and
never produced.

Measured across all twenty-two modules with `run.mjs --sabotage`, which blanks
the module and leaves its declared dependencies intact:

    0 file(s) still passing with every module blanked

Against **1,832** that pass unblanked. Every module reports `0 passed` when
emptied — `fs` 344 to 0, `stream` 249 to 0, `http` 404 to 0.

**The claim was true.** That is the outcome worth having and it is not the point.
The point is that a number this document has quoted for weeks was an assertion
until this run, and it was cheap to check — one pass over the modules, four
minutes.

`tooling/conformance/hollow-lane.sh` makes it repeatable, and refuses an empty
run rather than reporting zero hollow passes for a glob that matched nothing.

**Two claims in this document were unmeasured this afternoon.** This one was
true. The other — that five fixtures still reproduced — was false, and had been
for hours. The difference between them was not care taken at the time; both were
written by someone who believed them. It was that one had a cheap check nobody
had run and the other had a check that could not fail.

## Five fixtures were reporting defects that had been fixed

`emits-c <text>` is a **substring match**, and a fragment taken from broken
output can occur in correct output too. Five of mine did:

    identity-across-subtype    emits-c (double)v
    upcast-to-base             emits-c NtsObj_Base * made
    async-returning-object     emits-c nts_promise_fulfill_tagged(
    closure-as-function-value  emits-c NtsObj_Fn__
    erased-truthiness          emits-c (bool)v

`(double)v` was the pointer comparison when the fixture was written. On the
16:24 binary it matches `v15 = (double)v14` — an ordinary int-to-double
conversion in correct output. The fixture reported `reproduces` and would have
gone on reporting it forever.

**All five were fixed by the compiler lane and all five said otherwise**, which
means every "still reproduces" this lane reported in the last few hours was
worth less than it read. Found by compiling each fixture's output with clang
rather than trusting the harness: twelve of thirteen `emits-c` fixtures produce
C that now compiles.

### The harness gained the form it was missing

For a defect whose whole nature is that clang rejects the output, the honest
expectation is *this does not compile*. `blockers-check.mjs` now has
`fails-to-compile [text]`, which runs the compiler — with the same
force-includes `build.sh` uses, since without them a missing prototype is an
implicit declaration and a fixture about a prototype reports clean.

The five are converted, and the run went from **35 as expected, 6 loud** to
**31 as expected, 10 loud**. The four extra are all fixes landing.

**This is the same failure as `path.sep`, one level up.** There, a shim supplied
the value a test was checking, so the test could not fail. Here, a fixture
checked a string the correct output also contains, so the fixture could not
fail. Both were written carefully by someone who had just written the thing they
were checking, and neither was controlled against a *fixed* compiler — only
against a broken one, where they passed for the right reason by accident.

A fixture needs both controls: it must fail when the defect is absent, not only
hold when it is present.

## A `uses` file is a substitution list, and I read it as a dependency list

**The worst mistake of the day, and it is mine.** I wrote an audit on the
premise that a `uses` file declares the modules a module depends on, found that
eight of thirteen "import something they do not declare", and added the missing
names.

`run-one.mjs` reads that file and, for each entry, **replaces node's
implementation of that module with ours** when a test requires it. A module a
`uses` file does not name is a deliberate choice: the test keeps node's real
implementation as a stable dependency so that only the subject is under test.

Adding the names substituted our `util` into `http`'s tests and our `os` into
`process`'s, and **ten tests that had passed began to fail**:

    http     404 passed, 0 failed  ->  398 passed, 8 failed
    process   87 passed, 0 failed  ->   85 passed, 2 failed

Reverted; both are back. **The lists were right and my reading was wrong.**

This is the fifth rule — *an instrument and the thing it measures can both be
reasonable and still not be about the same object* — and I produced it by
building an instrument for an object that does not exist. The audit was
internally sound. Every finding it reported was true of the claim it was
testing. The claim was not about `uses`.

**What made it dangerous is that it was actionable.** The previous instrument
faults today produced numbers I doubted and checked. This one produced a
to-do list, and I did it. A correction is cheap when the wrong output is a
count; it costs ten passing tests when the wrong output is a change.

The audit now checks the only thing that means anything about these files: an
entry naming a module or subpath that does not exist, which substitutes nothing
and hides that it substitutes nothing. It says in its own output that it does
not compare the list against the module's imports, so the next reader does not
repeat the reasoning.

### The part that was true

`dgram/uses` names `net`, `dgram` calls `nts_net_default_auto_select_family`,
and `build.sh` linked neither. That was a real bug and the file did hold the
information — but as a side effect of what it is for, not as a declaration the
build was meant to read. The archive fix stands on its own.

## The `uses` files knew about the `dgram` bug, and nothing read them

A `uses` file names the other profile modules a module depends on. Thirteen
modules have one, and **nothing had ever read one back**.

`dgram/uses` names `net`. `dgram` calls `nts_net_default_auto_select_family`.
`build.sh` consulted neither the file nor `net`'s C, and the addon compiled,
linked, and failed at `require`. **The declaration that would have prevented an
afternoon's diagnosis was already in the tree, correct, and unread.**

> **Superseded by the section above.** The "8 import something they do not
> declare" reading is wrong: a `uses` file is a substitution list, and what it
> omits is deliberate. Acting on it cost ten passing tests. Kept because the
> `dgram` half is true and because the reasoning is worth seeing next to its
> correction.

Read back:

    13 modules with a `uses` file
     8 import something they do not declare
     5 declare something they do not import directly

    events    imports util               declares async_hooks
    stream    imports events, string_decoder   declares buffer, zlib/iter
    process   imports fs, net, os, stream, util
    readline  imports buffer, events, string_decoder, timers, util
    net       imports buffer, diagnostics_channel, stream, timers
    http      imports async_hooks, process, timers, url
    fs        imports path, readline

**Only the undeclared direction is an error.** The looser half — declaring
something not imported *directly* — is usually a transitive dependency and is
reported rather than failed. A list that fails on its looser half stops being
maintained, which is how a list gets to be unread for as long as this one was.

### And this audit also opened with false findings

The first run reported `stream` and `zlib` declaring each other spuriously,
because an entry may name a **subpath** — `stream/uses` says `zlib/iter` — and
reading the whole line as a module name manufactures a mismatch. A parsing
artefact wearing the shape of a finding.

**Third time today an instrument of mine opened with false findings**, after
`shape-blindspot.mjs`'s three false-alarm classes and `skip-audit.mjs`'s
sixty-one. The pattern is consistent enough to state as a rule rather than an
anecdote: **a new instrument's first output is a draft.** Every one of these was
caught by reading a flagged row and finding it implausible, which is not a
method — the method is to plant a known-good and a known-bad input and require
the tool to separate them before any row is believed.

## The skip lists, read back for the first time

429 `not-applicable` entries across the profile. A skip removes a file from a
denominator, so **every percentage in this document is computed without them** —
including the 1,832 of 1,832 above. Each carries a reason, each was read by a
person when it was written, and nothing had ever read them back.

    429 entries; 0 without a reason, 0 naming a file the suite does not have

Three ways an entry can be wrong, and the middle is the dangerous one:

    no reason   a bare filename, so the skip is unjustified
    stale       names a file the pinned suite does not have, so it excludes
                nothing and hides that it excludes nothing
    unclaimed   names a file the module's pattern never matches, so the skip
                is inert for a different reason

`skip-audit.mjs` checks the first two and is wired into the sweep. The third
needs the pattern machinery and is not covered.

### The audit's own first answer was 61 false findings

Checking `test/parallel` alone reported **61 stale entries**. The modules name
files in `client-proxy`, `pseudo-tty` and other suites, and an entry may carry a
directory prefix of its own. Sixty-one wrong findings, every one shaped exactly
like a real one, from an instrument that assumed the shape of the thing it was
measuring.

**That is the second time today that fault appeared inside a tool written to
check for it** — `shape-blindspot.mjs` had three false-alarm classes before its
zero meant anything, and this had one worth sixty-one rows. The rule holds in
the mirror: an instrument that reports a count must report the size of what it
examined, and an instrument that reports *findings* must be shown to produce
none on a clean input before its findings are read.

Controlled both ways: a planted bare filename reports `NO REASON`, a planted
nonexistent file reports `STALE`, and removing them returns the run to zero.

## The two modules that do not compile are two causes, both known

Measured through **`tooling/conformance/build.sh`** on the 15:39 binary — naming
the instrument because measuring these two the other way is what produced the
last correction in this document. A bare `clang -fsyntax-only` after `emit-c`
has none of the force-include flags and reports every binding a module reaches
as an implicit declaration.

    fs        1 error
    process  11 errors

**`fs` is one error**, and it is the one the compiler lane predicted and still
believes: `v2 = v0->callback` in `Closure59__call`, a captured field declared
erased and read back as `NtsObj_Fn675__3 *`.

**`process`'s eleven are two causes.**

    8  nts_str_to_lower_case   3 undeclared + 5 that follow from it
    3  redefinition of 'version', 'platform', 'environment'

The five `incompatible integer to pointer conversion assigning to 'NtsString *'
from 'int'` are **not a separate defect**: an implicitly declared function
returns `int` in C, so every assignment of its result to a pointer is an error
downstream of the missing prototype. Counting them apart would have made this
module look five problems worse than it is.

The prototype half is the `const` mismatch — `nts_unicode.h` says
`const NtsString *`, the emitter writes `NtsString *`, and force-including the
header to fix the declaration breaks two other modules on the conflict. The
compiler lane has that, with a better shape than the one-line version: have the
generated table cover every runtime header the build force-includes and emit no
prototype for a name it already declares.

The redefinitions are a **global** colliding with a name a C header already
holds — the `field-named-header` shape one namespace over, where the guard
covers function names and not globals.

So: twenty of twenty-two compile, and the two that do not are one error and two
causes between them, all three of which are named and none of which is this
lane's.

## The chain in `determineSpecificType`, five links deep and still moving

`internal/errors.ts`'s `determineSpecificType` is a `switch (typeof value)` in
which **every arm is its own lowering problem**. Clearing one reveals the next,
and this document has now watched it happen five times:

    an `unknown` narrowed to BigInt     errors.ts:34    fixed
    an `unknown` narrowed to Symbol     behind it       fixed
    `String(symbol)`                    errors.ts:53    fixed
    `toString` on a number, radix       errors.ts:463   open (13 modules)
    `JSON.stringify`                    errors.ts:70    **current head**

Measured on the 15:39 binary, that head's cone in `os` is **96 functions**, and
it gates `getPriority` and `setPriority` through `validateInt32` ->
`ERR_INVALID_ARG_TYPE`. Every module imports this file, so the same head sits
under every argument check in the profile.

`JSON` is in §16's **gap** column rather than the not-a-goal column, so it is a
blocker; it had no fixture while it sat behind four other refusals in the same
function. Now `blockers/json-stringify`.

**And it is not avoidable by writing the source differently.** Node reports a
string argument as `type string ('abc')` and switches to `JSON.stringify`
exactly when the value contains a single quote, so the message stays parseable.
Doing that without it means reimplementing JavaScript string escaping — which
`inspectString` two hundred lines below already had to do for the control range,
and which is recorded there as agreeing with node "on almost nothing".

**This is the fifth prediction in this document that a cone would empty and did
not.** The caveat printed by `cascade-reach.mjs` — *clearing the head of a cone
can reveal the next refusal in the same function, so a cone sizes a queue rather
than a step* — was written after the first. Five links in, the useful statement
about this function is not any one head but that it has a queue, and the queue
is what `os` is waiting on.

### Fixture state on that binary

Six report loudly, and all six are the compiler lane's fixes landing rather than
regressions: `callback-binding`, `duplicate-type-name`, `erased-truthiness`,
`field-named-header` and `narrowed-bigint` FIXED, `literal-const-export`
CHANGED. Five of those were filed from this lane today.

## Why the compiling modules publish nothing: two causes, nearly equal

Ten modules that compile and publish nothing or almost nothing, counted by the
reason `emit-c` gives for each export it cannot wrap:

    module                 cannot name   not compiled   other
    assert                     21             2           2
    console                     4             1           0
    events                      7             7           0
    stream                     11            16           2
    url                         3            10           2
    zlib                       30            23           0
    querystring                 1             7           0
    string_decoder              2             0           0
    diagnostics_channel         2             5           0
    dgram                       1             1           0
    -----------------------------------------------------------
                               82            74           6

**Not one cause. Two, and they are the same size.**

*is not a function this backend can name* — 82 sites — is a **backend
capability**: a class, or a value, or a `const` alias. `assert` is the extreme
case at 21 of 25, and the shape is
`export const deepEqual = looseAssertions.deepEqual` — an alias to a property of
an object, which is the same thing the ledger already records for `os`'s four
native-binding aliases.

*no function of that name was compiled* — 74 sites — is a **refusal**, and those
are the fixtures already filed.

### This makes `export-class` the largest lever on the axis

It was sized at three modules — `string_decoder`, `async_hooks`,
`diagnostics_channel` — when the twelve behind `duplicate-type-name` could not
be measured at all. Now that they compile, it is **82 export sites across ten
modules**, and it is half of everything standing between this profile and a
green module.

It also keeps the ordering argument that put it last: publishing a class whose
methods are refused is worse than the refusal. Both halves have to move, and the
74 refusals are the other half.

**The question this answers is one I asked in the wrong shape.** "Nine modules
at zero exports — if a single cause put nine there, it is the largest lever
left" assumed a single cause because nine identical outcomes suggested one.
They are two causes in a 50/50 split, and the only reason to know that rather
than guess is that the reasons were counted per module instead of read off one
of them.

## Eleven modules started compiling and not one gained a passing test

Measured on `target/release/nts` at 15:39, pinned to scratch, from a worktree at
`a6713613`. The compiler lane landed six fixes; five of them closed fixtures
filed from this lane.

    build floor: 9 of 9 still build, 0 regressed, 11 newly building

**Twenty of twenty-two modules compile.** Only `fs` and `process` do not. That
is the single largest movement this axis has had.

And the axis is **still 1 of 22**:

    module                exports   result
    punycode                   6    3 of 3          <- green
    os                        17    4 pass, 4 fail
    path                       4    2 of 22
    async_hooks               13    0 of 116
    readline                   7    0 of 25
    buffer                     3    0 of 56
    http                       2    0 of 409
    net                        2    0 of 154
    timers                     2    0 of 56
    util                       2    0 of 24
    assert console diagnostics_channel events querystring
    stream string_decoder url zlib          0 exports, 0 passed
    dgram                  load failed
    fs  process             do not build

**Nine of the eleven that newly compile publish nothing at all.** Not one module
gained a passing test.

This is the caveat that has been attached to every reach number in this document
— *compiling is necessary and not sufficient* — demonstrated at a scale that
leaves no room to argue with it. Eleven modules crossed the threshold in one
step, and the axis did not move.

It also retires a way of talking about this axis. "Fifteen modules do not
compile, and that is two bugs rather than fifteen" was true, and fixing those
bugs was worth doing, and it bought **zero** green modules. The next number to
watch is not how many compile; it is **how many publish their exports**, which
is what `sweep.mjs`'s `absent:` line was extended to report for every module
rather than only green ones.

## A fix of mine that regressed two modules, caught in two minutes

`process` reported three `call to undeclared function 'nts_str_to_lower_case'`.
The function is defined in `runtime/c/nts_unicode.c` and declared in
`nts_unicode.h`; that `.c` is already compiled and linked, so the definition was
always there and only the prototype was not. `build.sh` force-includes
`nts_node.h` and `shared.h` for exactly this reason, and `nts_unicode.h` is in
`runtime/c` rather than `runtime/node`, so neither of its two globs found it.

Adding it removed all three errors from `process`. It also **broke
`string_decoder` and `url`**:

    error: conflicting types for 'nts_str_to_lower_case'

    nts_unicode.h  NtsString *nts_str_to_lower_case(const NtsString *s);
    program.c      NtsString * nts_str_to_lower_case(NtsString *);

A `const` qualifier apart, and the same shape as `callback-binding` and the
`nts_process_emit_warning_object` regression earlier today: a hand-written
header and an emitted prototype that disagree, invisible while nothing includes
both.

**`build-floor.sh` caught it on the run after the change**, named both modules
and printed the conflicting line. Reverted; the floor is back to 9 of 9.

That instrument was written this morning because the gate's `profile` step emits
C and never compiles it, so a change breaking every module passes green. Its
first real catch was **my own change, four hours later**, and the trade it
caught is one I would have taken: three errors gone from a module that fails
anyway, against two modules that build today and would have stopped.

The underlying disagreement is real and is reported rather than worked around.
Force-including the header is the right shape and cannot be done until the two
prototypes agree.

## The interpreted axis, measured end to end rather than spot-checked

All 22 modules, `check.sh <module> --ts`, run today:

    assert       11 / 25     async_hooks  115 / 153   buffer       54 / 96
    console      18 / 38     dgram         76 / 109   diagnostics_channel 32 / 59
    events       31 / 51     fs           344 / 393   http        404 / 450
    net         147 / 178    os             8 / 12    path         21 / 22
    process      87 / 151    punycode       3 / 3     querystring   7 / 8
    readline    ...          stream       249 / 266   string_decoder 4 / 5
    timers       55 / 66     url           49 / 52    util         24 / 52
    zlib         68 / 74

    1,832 passed, 0 failed, 29 skipped, 429 not applicable

**Zero failures in every module.** The standing figure in the goal text is
1,796; this is 1,832, and the difference is tests added since — including three
export-surface files written today, one of which (`zlib`) was hollow when
written and is not now.

This is the axis the goal calls preparation, and it is the one condition of the
five that is unambiguously met. It is worth stating plainly *because* it is not
the product: 1,832 passing files on the interpreted lane is compatible with
1 of 22 on the compiled one, and the two numbers describe different objects.
The first says this profile's TypeScript is right; the second says almost none
of it survives lowering yet.

**Measured, not spot-checked.** Earlier in the day I had run four modules and
quoted the ledger for the rest — which is the same shape as reading a `no
wrapper` line and calling it a module's whole story. Running all twenty-two took
six minutes.

## A cascade that names a refusal nobody printed

`blockers/cascade-with-no-root`. The entire output for the file is:

    main.ts:24:9  NTS1003 `make` cannot be compiled because it calls
                  `Handle#hasRef`, which was refused above
    no wrapper for Immediate: is exported and is not a function this backend can name
    no wrapper for make: is exported and no function of that name was compiled

**There is no `above`.** Not one NTS1001 in the run. The single actionable
sentence points at something that does not appear in the output.

This is the diagnostic form of every instrument failure in this document: a
result that cannot be told apart from a different result. A cascade with a
visible root says what to fix. A cascade with no root says only that something,
somewhere, was not lowered — and is indistinguishable from one whose root was
printed and scrolled past.

**And `nts hir` reports `5 function(s), nothing refused` for the same file.**
Only `emit-c` produces the cascade. A blocker invisible to `hir` is not new
here — `f64[]` lowers cleanly and fails at the wrapper — but this one carries an
**NTS1003**, a *lowering* code, out of a run the lowering called clean. The
fixture's expectation had to name `emit-c` for that reason, which is the first
thing it demonstrates, before its own subject.

**A second instance, in `os`.** `userInfo` gets `no wrapper ... no function of
that name was compiled` and **nothing anywhere says why**. The only related line
in the run is `userInfoString, a declaration outside every walk` — a helper
called only from inside `userInfo`, and a consequence rather than a cause, since
a body that is never walked cannot reach what it calls. The output names the
shadow and not the object, and `userInfo` is one of the six exports keeping `os`
from green.

Three reductions tried, none reproducing: an overloaded function whose body
calls a local helper compiles clean; a generic union return gives
`returns an object` / `signature does not cross`, which is a wrapper limit that
says so; neither yields an `outside every walk` for the helper. Recorded as a
second instance rather than fixtured separately — what the two share is the
hole, not the shape.

Reached from `timers`, whose `Immediate` is generic over a tuple
(`class Immediate<Args extends unknown[] = []>`) and implements an interface.
The five real refusals there read *a member of `Immediate`, a class this
compiler has no type for*, which at least names a cause; the reduction lost the
cause and kept the cascade.

### Two neighbours, both of which refuse honestly

Found on the way and not fixtured separately, because each says why:

    new Immediate<[]>(fn, [])     an array literal of unrepresentable type
                                  (an untyped node)  -- the empty tuple
    #heap: (T | undefined)[]      `null` or `undefined` where what it stands in
                                  for is not a reference

The second is `priority-queue.ts:26` and is **not reproducible from that line
alone** — I wrote the identical field, with `<T extends object>` and the
optional second callback, and it compiled. Recorded as a failed reduction rather
than as a fixture.

## `timers` is two fixtured blockers from compiling, and both are named

The closest module on the axis, measured on the 14:18 probe binary. Its entire
clang output is two errors:

    program.c:1964  use of undeclared identifier 'Closure54__call'
                    -> blockers/refused-callback-null-vtable
    program.c:3684  operand of type 'NtsValue' where arithmetic is required
                    -> blockers/erased-truthiness

Nothing else. Both are compiler-side, and the second one is:

> **Superseded.** Both were fixed shortly after this was written, and `timers`
> compiles. The `erased-truthiness` fixture went on reporting `reproduces` for
> hours afterwards because its expectation was a substring correct output also
> contains — see "Five fixtures were reporting defects that had been fixed". The
> section is kept because the *reasoning* about the declined rewrite is what it
> is for, and that reasoning was right: the fix landed centrally, which is what
> declining it was protecting.

    clearImmediate(NtsValue v0)
        v10 = v8->_onImmediate_;     // object | null | undefined
        v47 = (bool)v10;

### A rewrite that would be exactly equivalent, and is not being made

`_onImmediate` is `object | null | undefined`, and **an object is always
truthy** — so `if (x)` and `if (x !== null && x !== undefined)` cannot disagree
here. The second spelling lowers today. One line would remove one of `timers`'
two errors.

It is not being made, for the same reason `readConstants` was not restructured
and `assert`'s `header` field was not renamed. `erased-truthiness` is 8 sites in
`stream`, 8 in `fs` and 3 each in `events` and `assert`; those are not all
nullable-object tests and most cannot be rewritten this way.

**And that judgement was vindicated within the hour**: the compiler lane fixed
it centrally, `!x` routes through `truthy`, and all nineteen sites went with it.
One line here would have bought `timers` a smaller error count and left the
other eighteen. Spelling around it
here buys one module a smaller error count and removes the pressure from a defect
that has to be fixed centrally regardless.

**Three such rewrites have now been declined and recorded** — this one,
`readConstants`'s computed member write, and `assert`'s `header` field, which
alone was 10 of that module's 20 errors. Each was legal, unobservable, and would
have improved a number. That they are written down is the point: a reader who
finds `if (x)` here and wonders why it was not spelled around has the answer,
and the count in the ledger is the count of the profile rather than the count of
what was convenient.

## `assert`'s twenty errors are five known shapes, and one was new

Broken down rather than counted, on the 14:18 probe binary:

    10  field-named-header      (6 static-assertion + 2 sizeof + 2 duplicate member)
     4  erased-truthiness       (NtsValue where arithmetic required)
     3  async-returning-object  (NtsArray * to NtsHeader * parameter)
     2  identity-across-subtype (pointer cannot be cast to double)   <- new
     1  error limit reached, so there is more behind

Four of the five already had fixtures. The fifth is new and is now
`blockers/identity-across-subtype`:

    if (candidate === entry)     // Extended vs Base

    v22 = (double)v11;   v23 = (double)v1;   v12 = v22 == v23;
    error: pointer cannot be cast to type 'double'

`===` between a subtype reference and a supertype reference is emitted as a
**numeric** comparison of two pointers. The operands have different C struct
types, so they cannot be compared directly, and the emitter takes the numeric
path rather than casting either to a common one — when `===` on two references
is address equality, which a cast to the shared base would give.

It is the identity form of `upcast-to-base`, which is the assignment form. Both
come from C not treating a derived struct as its base even when it begins with
one. They are separate fixtures because the fixes differ: the assignment needs a
cast on the right, the comparison needs a common type for both sides.

Traced to `MemoryHttpCacheStore.touch` in web-platform's cache store —
`interface MemoryEntry extends HttpCacheEntry`, compared in a linear scan. There
is no other way to write that.

### A rename that would have removed half of `assert`'s errors, not done

`field-named-header` is 10 of the 20, and the field is **mine**:
`assert/src/error.ts` returns `{ message: string; header?: string; skipped?: boolean }`.
Node's `AssertionError` exposes `actual code diff expected generatedMessage
operator` and no `header`, so the name is unobservable and renaming it would
break nothing.

**It was not renamed.** Ten of twenty errors is not the twenty, so `assert` would
still not compile — and a rename buys a smaller number in exchange for removing
the pressure on a compiler defect that any module could hit. The fixture exists
precisely so the collision is fixed once rather than avoided everywhere.

### And a negative result worth keeping

Eight minimal programs covering ordinary shapes — a getter/setter pair, an array
of objects, `Map<string, object>`, optional chaining, a typed `catch`, array
spread, a static method, a class implementing an interface — **all compile
clean, none refused.** The emitter handles ordinary object-oriented TypeScript.
The defects found today are specific rather than pervasive, which is a more
useful thing to know than another list of what is broken.

## Two more, both found by a hypothesis that was wrong

Chasing the `Closure54__call` defect produced two fixtures for defects that are
not it. Four hypotheses about that closure were tried and all four failed; two of
the failures emitted C that clang rejected for an unrelated reason, and those are
now `blockers/upcast-to-base` and `blockers/async-returning-object`.

**`upcast-to-base`** — a subclass instance assigned to a base-typed binding:

    export const made: Base = new Derived();

    error: incompatible pointer types assigning to 'NtsObj_Base *'
           from 'NtsObj_Derived *'

Eight lines, nothing refused. In C a derived struct is not a base struct even
when it begins with one, so an upcast needs a cast at the assignment and the
emitter writes it without. Reach is small — 2 sites each in `fs` and `readline`,
zero in the nine other modules checked — and the class hierarchy was only in the
probe to push a closure call slot above zero.

**`async-returning-object`** — an `async` function resolving to an object:

    export async function numbers(): Promise<number[]> { return [1, 2, 3]; }

    error: incompatible pointer types passing 'NtsArray *' to parameter of type
           'NtsHeader *'

Seven lines. **This one is not the `callback-binding` shape**: the runtime's
signature is already `void nts_promise_fulfill_tagged(NtsPromise *, NtsHeader *,
...)`, both sides agree, and the *call site* is emitted without the cast. It is
the whole of `stream`'s `incompatible pointer types` count, and appears there
with `NtsObj_MemoryCacheStorageHandle *` as well — so it is any object, not
arrays.

### Three fixtures today came from guesses about something else

`closure-as-function-value`, `upcast-to-base` and `async-returning-object` were
all found while trying to reproduce a different defect. That is not luck twice
over: a wrong hypothesis about emission still produces a *program the emitter has
not seen*, and the corpus stopped being a source of new ones the moment twelve
modules failed at the same earlier error. **Minimal programs written to test a
theory are worth running even when the theory is wrong.**

The `Closure54__call` pair remains unreproduced after four attempts and is
recorded above with its evidence rather than fixtured.

## Two fixtures for what was behind the collisions

Both new, both reproducing on the 14:18 probe binary, and neither refuses
anything — `emit-c` reports success and publishes a wrapper, and the defect is a
line of C clang will not accept. So both assert against the emitted file.

**`blockers/erased-truthiness`** — a truthiness test on an erased value is a C
cast rather than a tag check:

    if (value)          ->   v5 = (bool)v0;      // v0 is NtsValue
    error: operand of type 'NtsValue' where arithmetic or pointer type is required

`NtsValue` is a tag and a payload, so there is nothing for `(bool)` to do with
it. JavaScript truthiness asks about the tag first — `undefined` and `null` are
false whatever the payload — and the payload second. That is a function, not a
conversion. **Most common remaining error in the corpus**: 8 sites in `stream`,
8 in `fs`, 3 each in `events` and `assert`, 1 in `timers`. It needs no new
`ManagedType`.

**`blockers/closure-as-function-value`** — a closure stored in a variable of a
*named function type* gets two C types that do not relate:

    error: incompatible pointer types assigning to 'NtsObj_Fn__4 *'
           from 'NtsObj_Closure0 *'

The declaration produces the structural spelling, the arrow produces a closure
object, and both are correct descriptions of the same value. The alias is
load-bearing: `let stored: Drain | undefined` produces it and an inferred `let`
does not, so the profile meets it where it writes its host contracts down rather
than everywhere it uses a callback. Second most common: 4 sites in `events`, 4
in `stream`, 3 in `fs`.

### One defect with no fixture, and it is being reported as such

`timers` emits a vtable entry for `Closure54__call` with no declaration and no
body — the symbol occurs exactly once in the whole file. Three sibling closures
get all three artefacts.

**And its sibling is worse, because it compiles.** The two closures are the
arguments to one call — `nts_timers_install(Closure55, Closure54)` in
`module__init`, which is `host.install(processTimers, processImmediate)`:

    Closure54  vtable references Closure54__call, which does not exist  -> clang error
    Closure55  descriptor's method table is 0                           -> compiles

    nts_desc_NtsObj_Closure55 = { ..., 0, 0, "Closure55", 0u, 0 };
    nts_desc_NtsObj_Closure20 = { ..., 0, nts_vtable_NtsObj_Closure20, "Closure20", 0u, 0 };

`Closure55` has **no method table at all**. `runtime/node/timers/timers.c` calls
a drain as `callback->descriptor->methods[nts_closure_call_slot]`, so that is a
null dereference on the first timer that fires. The compile error is the *safe*
half of this pair: it stops. The other one loads.

**Reproduced on the seventh attempt, by bisecting the module instead of
guessing the shape.** `blockers/refused-callback-null-vtable`:

    import { onTimers } from "./drain.ts";   // onTimers is refused
    nts_install(onTimers);

    nts_desc_NtsObj_Closure0 = { ..., 0u, 0u, 0, 0, "Closure0", 0u, 0 };
                                              ^ methods

**A refused function passed as a callback becomes a closure with a null method
table, and the program compiles.** No body was emitted because the function was
refused, but the descriptor, the static instance and the call site were all
emitted anyway.

**And the compiler says so itself before emitting them.** The refusal is
reported by name, once per closure:

    timeout.ts:488    NTS1003 `Closure55#call` cannot be compiled because it
                      calls `processTimers`, which was refused above
    immediate.ts:211  NTS2009 `Closure54#call` cannot be emitted because it
                      calls `processImmediate`, which this backend refused

So this is not the emitter losing track of something. It has concluded that the
body cannot exist, printed that conclusion — from the lowering in one case and
from the backend in the other — and then written the descriptor, the static
instance and the call site as though it had not. **The information needed to
refuse at the point the closure is taken as a value was already in hand and
already on stdout.**

That also explains the asymmetry between the pair: `Closure55` was refused by
the *lowering* and got no vtable at all, `Closure54` by the *backend* and got a
vtable pointing at a function that was never written. Two paths to the same
place, one of which compiles.

The bisect: removing the `promises` import moved the closure number 54 -> 40 and
kept the defect. Replacing `host.install(processTimers, processImmediate)` with
two local arrows made it **disappear**. `processTimers` is refused at
`timeout.ts:286`. That identified the trigger in two steps after six guesses had
failed.

**Six wrong hypotheses first**, and they are worth listing because each was
plausible and each cost a probe: a closure inside a refused function keeps its
body; a closure taken as a value keeps its body; an imported top-level function
passed as a callback emits correctly; a class hierarchy pushing the call slot
above zero emits correctly; a call through a `const` alias to a declared binding
emits correctly; and sixty closures in one program all get bodies, so it is not
position or count.

Two of those wrong guesses produced `blockers/closure-as-function-value` and
`blockers/upcast-to-base`.

**Bisection found in two steps what guessing had not found in six.** The
difference is that a bisect asks the program which half matters, and a
hypothesis asks me.

### The old note, kept because the reasoning was wrong in a useful way

**Three hypotheses were tried and all were wrong.** A closure inside a refused
function still gets its body. A closure taken as a value gets its body too —
that attempt is what produced `closure-as-function-value` instead, so the wrong
guess earned its keep. And an imported top-level function passed as a callback
emits correctly: both closures get vtables and `__call` bodies, and clang
accepts it.

So this is recorded with the evidence from the real module and **without** a
minimal reproduction, which is the honest state rather than a fixture that
reproduces something else under this name.



## `duplicate-type-name` worked completely, and nothing newly builds

Measured on the compiler lane's 14:18 probe binary, from a pinned tree:

    build floor: 9 of 9 still build, 0 regressed, 0 newly building

    stream 0 redefinitions   fs 0   events 0   assert 0   timers 0

Every name collision is gone in every module checked. **And not one of the
twelve compiles.** Both facts are the result.

What the fix did was uncover the layer clang's twenty-error limit had been
hiding. Those modules were never twelve-modules-from-compiling; they were
twelve-modules-from-being-**measurable**, which is the caveat attached to the
reach number when it was reported — and it turned out to be the whole story
rather than a hedge.

    stream    8 operand of type NtsValue    4 incompatible pointer types
    fs        8 operand of type NtsValue    3 incompatible pointer types
    events    4 incompatible pointer types  3 operand of type NtsValue
    assert    6 static assertion expression is not an integral constant
    timers    1 undeclared identifier       1 operand of type NtsValue

**This is the clang-level form of "a cone sizes a queue rather than a step."**
The first time it was a refusal chain inside one function; here it is an error
limit hiding the errors behind the ones it printed. Two different mechanisms,
the same shape of wrong expectation, and the second was predicted by having
written the first one down.

### `timers` is two errors and both are exact

**A closure reaches the descriptor emitter and not the body emitter.**

    program.c:1964  nts_vtable_NtsObj_Closure54[] = { ..., (void *)Closure54__call };
    error: use of undeclared identifier 'Closure54__call'

    forward declarations   Closure0  Closure19  Closure20
    definitions            Closure0  Closure19  Closure20
    vtables reference      Closure0  Closure19  Closure20  Closure54

`Closure54__call` occurs exactly once in the file — that vtable line. Three
closures get all three artefacts and the fourth gets one.

**A truthiness test on an erased value is a cast rather than a tag check.**

    program.c:3684  v47 = (bool)v10;   // v10 is NtsValue
    error: operand of type 'NtsValue' where arithmetic or pointer type is required

One site in `timers`, eight each in `stream` and `fs`, three in `events` and
`assert` — **the most common remaining error in the corpus** now that the
collisions are cleared, and it needs no new `ManagedType`.

## A test comparing node with node, and passing for it

`events/test/prototype-surface-static.js` asserted that every name on node's
`EventEmitter.prototype` is on ours. Its comment said *"node's own class, read
at run time rather than listed, so this tracks the running node"*. It did not:

    same=true   sameProto=true

**The harness substitutes the module under test for the `node:` specifier too**,
so `require("node:events")` and `require("events")` are one object, and the file
compared node's prototype with itself. It passed for as long as it existed and
could not have failed for the reason it was written.

Found while writing the same shape for `zlib` and probing the two specifiers
before trusting them — not by anything going wrong. My own new `zlib` test had
the identical fault and would have shipped with it.

The fix in both: read node's names from a **child `node -p`**, which has no
harness hooks, so what it prints is node's.

### What each found once it was real

`zlib`, under sabotage, now names all 47 missing exports instead of tripping its
own floor. In the ordinary lane it found nothing — but the first version reported
`Z_MAX_CHUNK is Infinity, node's is null`, which was **my transport, not a
divergence**: `JSON.stringify(Infinity)` is `null`. Values cross as strings now.
I came within one commit of recording a false divergence in this document.

`events` immediately surfaced `_events`, `_eventsCount` and `_maxListeners` —
**the exact three its own comment had already called implementation state**, and
the reason it was written missing-only rather than as an equality. The author
anticipated them; the hollow comparison meant nothing ever had to handle them.
Excluded by name, not by an `_` prefix rule, because `_` does not mark private
here — `path._makeLong` is public API in this same profile.

Both now fail informatively when the module is blanked. `events` previously
failed the sabotage lane with `Cannot convert undefined or null to object` from
inside `getOwnPropertyNames`: a true failure naming neither the module nor the
reason, and indistinguishable from a broken harness.

**Every other test in this profile that reads a `node:` specifier as an oracle
has this fault**, and finding them is a sweep worth running rather than a thing
to notice one at a time.

## `typecheck: 0 of 22` was a missing tool, not a broken profile

The first full sweep run from a pinned worktree reported:

    typecheck: 0 of 22 module(s) typecheck against their own tsconfig
      assert: undefined
      async_hooks: undefined
      ...

Read literally, the entire TypeScript profile had stopped typechecking. The same
command in the checkout says **22 of 22**.

A `git worktree` has no root `node_modules` — they are gitignored — so `tsc` is
not installed in it. `pnpm exec tsc` then prints the literal string `undefined`
followed by `Command "tsc" not found`, and the audit reported that first line
faithfully, once per module.

**Twenty-two identical failures are a property of the environment, never of
twenty-two modules**, and nothing in the output said which it was. Two fixes:

- `audit.mjs --typecheck` now probes for the checker first and reports
  `INSTRUMENT FAILURE -- tsc is not available here` instead of counting
  twenty-two failures. Controlled both ways: the checkout reports 22 of 22, the
  worktree reports the instrument failure.
- `pinned-tree.sh` copies `runtime/node/*/node_modules` into the tree it makes.
  256K in total, only `.tsbuild` directories. Copied rather than linked, because
  a link would make the pinned tree share build state with the checkout, which
  is the coupling the pin exists to remove.

That is the fifth instance today of one shape: **a result that cannot
distinguish absence-of-problem from absence-of-measurement.** This one is the
most dangerous of the five, because the number it produced was not a suspicious
zero — it was a plausible catastrophe, and the natural response to it is to go
looking for what broke the profile.

## The sweep already knew which exports were missing and declined to say

`shapeNamesMissingFrom` derives, from a module's own `shape.mjs`, the names that
shim needs and the addon does not publish. It was gated on `stage === "green"`,
because the case it was written for was `punycode` passing everything with
`version` absent.

But the modules that most need it are the ones that **build and fail**. Their
missing names are the whole explanation, and without them a row reads as a
behaviour problem:

    buffer   0 of 55   ->  11 absent: Blob Buffer File SlowBuffer atob btoa constants isAscii ...
    path     2 of 22   ->  12 absent: basename dirname extname format isAbsolute join ...
    os       4 of 8    ->   6 absent: constants cpus getPriority networkInterfaces setPriority userInfo

`buffer` at 0 of 55 looks like fifty-five broken assertions and is one fact: it
publishes 3 of its 15 exports. Every test that touches an absent name fails with
a TypeError about `undefined`, which names nothing.

**I derived all three of those by hand today, one addon at a time, before
noticing this line already knew how and was declining to say it.** The gate was
a reasonable choice for the case it was written against and became wrong when
the axis grew a category it did not anticipate — modules that build and publish
almost nothing, which did not exist when it was written.

Now computed for every module that produced an artifact, labelled `incomplete:`
on a green row and `absent:` otherwise, since the two mean different things: one
is a caveat on a pass, the other is the reason for a failure.

## One failure, four instruments, four mechanisms

Named by the compiler lane and worth stating once for all of them: **a result
that cannot distinguish absence-of-problem from absence-of-measurement.** Four
separate instruments had it today and no two shared a mechanism:

- `counted-lane.sh` — `$(grep -c ... || echo 0)` yields `"0\n0"`, the `-eq` test
  errors, the `if` falls through. Dead since written, and dead only in the case
  it existed for.
- `cascade-reach.mjs` — a cone membership test matched `join` against
  `join@posix`. A silent zero from a name mismatch, indistinguishable from a
  real negative.
- `cascade-reach.mjs` again — reported `INSTRUMENT FAILURE` for `punycode`, the
  one module that lowers completely, because its text could not tell "compiles
  cleanly" from "the frontend never ran".
- a comparison harness reading a stale output file, reporting the previous run's
  result as a pass.

So the remaining instruments were audited for the same property rather than
waiting for each to fail:

    standin-blindspot.mjs   zero is its GOAL, so a broken run read as success.
                            Now refuses when it scanned no stand-ins or no probes.
    binding-abi-audit.mjs   "0 checked, 0 disagreeing" is what a clean audit and
                            a broken one both print, and the sweep matches any
                            line containing "disagreeing". Now refuses at zero --
                            and diagnoses a missing input rather than throwing an
                            unhandled ENOENT from inside `readFileSync`, which
                            was loud but said nothing about which file.

Both controlled by running a copy from a directory where their inputs do not
exist. `standin-blindspot` reports what it scanned; `binding-abi-audit` names
the missing header.

**The general form: an instrument that reports a count must also report the size
of what it examined**, because the two zeros are otherwise the same sentence.
`standin-blindspot` is the sharpest case in the tree — zero blind spots is the
outcome the whole file exists to reach, so the broken run and the finished one
printed the same line.

## `ArrayBufferView` as a parameter type: 17 modules, 621 sites

Measured on the gate binary, every module through `emit-c`:

    zlib      127      fs        64      process   54
    dgram      43      http      43      readline  43
    stream     43      net       42      assert    34
    console    34      util      34      events    31
    string_decoder 9   buffer     5      os         5
    querystring 5      url        5

    none: async_hooks, diagnostics_channel, path, punycode, timers

`Buffer#toString` is the concentrated form — six sites each in eight modules,
one each in four more. **One method, refused for one parameter type, reached
from everywhere.** `blockers/arraybufferview-parameter` already exists.

This is why `export-class` moved behind it, and the reason is stronger than
reach. A class published while its methods are refused is **worse than the
refusal**: an export table entry for a `StringDecoder` whose `write` and `end`
do not exist is an artifact that looks loadable and fails at the first call. The
refusal at least says so. That argument came from the compiler lane and it is
the one I should have reached myself when I called `export-class` "the entire
module".

The measured order on the compiled axis is now:

1. `duplicate-type-name` — twelve modules cannot compile at all
2. `arraybufferview-parameter` — 17 modules, 621 sites
3. `export-class` — three modules, and only useful after 2

## How far each building module actually is, measured

After being wrong about `string_decoder` by reading an export line instead of
the program behind it, the same question asked of all nine that build:

    module               primary refusals   stopped by cascade
    punycode                      0                  0        <- passes 3 of 3
    path                         33                 53
    async_hooks                  53                 40
    diagnostics_channel          55                 44
    buffer                       79                137
    string_decoder               83                143
    querystring                  85                139
    os                           86                141
    url                         168                229

**`punycode` at zero is the shape of a module that is actually done.** Nothing
else is within an order of magnitude of it, and that is the answer to "which is
nearly green": none of them. `os` reads as closest on *tests* — 4 passed, 4
failed — and is eighth of nine on refusals, which is the same trap as
`string_decoder` seen from the other side. A test count measures how much of a
module the oracle happened to exercise; a refusal count measures how much of it
exists.

`path` and `async_hooks` are the two smallest, and neither is small.

### And the guard that called the success case a failure

Running this over `punycode` reported `INSTRUMENT FAILURE: produced no
diagnostics at all`. Its text read *"Either it compiles cleanly — which would be
news — or the frontend never ran"*, and it could not tell those apart, so the
one module in the corpus that lowers completely was reported as a broken
measurement.

The two are distinguishable and now are: a frontend that never started writes no
`program.c`; a module with nothing to refuse writes a real one. Controlled in
both directions — `punycode` reports *"no refusals at all"* and exits 0, and the
same run with `NTS_TSGO` pointed at nothing reports the instrument failure and
exits 2.

A guard that calls the success case a failure trains its reader to ignore it,
which is worse than not having it.

## `string_decoder` is not one fix away, and I said it was

Recorded because the error is the one this document exists to catch, made by
the person keeping the document.

I read `no wrapper for StringDecoder: is not a function this backend can name`,
counted two exports and one cause, and reported that `export-class` was **the
entire module, 2 of 2**. I never checked whether the class's methods compile.
They do not:

    src/main.ts:30   a parameter of unrepresentable type (`ArrayBufferView`)
    StringDecoder#fillLast   cannot be compiled because it calls `Buffer#toString`
    StringDecoder#flush      ... `Buffer#toString`
    StringDecoder#utf8Text   ... `Buffer#toString`
    StringDecoder#utf16Text  ... `Buffer#toString`
    StringDecoder#base64Text ... `Buffer#toString`

83 primary refusals and 143 functions stopped by cascade, headed by
`determineSpecificType` at 93 and `decodeIn` at 15. `export-class` would publish
a class whose every method had been refused.

**That is a description of a grouped diagnostic mistaken for a blocker** — the
third of the five rules — applied to a module rather than to a message. The
wrapper line is a true statement about one export and says nothing about the
program behind it, and I treated the two as the same claim. The tell was
available and I did not look for it: a module with two exports and 83 primary
refusals is not one fix from anything.

### `diagnostics_channel` had a cause nobody had measured

It builds, publishes **zero of seven exports**, and every one is refused through
a single field:

    #map = new Map<string | symbol, WeakRef<Channel>>()

`Map` is representable — the two sibling `Map` fields beside it are not refused.
It is `WeakRef` alone, and §16 puts `WeakRef` and `FinalizationRegistry` in the
**gap** column rather than the not-a-goal column, so it is a blocker and it had
no fixture. Now `blockers/weakref-property`.

The registry cannot be written another way and stay correct: node holds channels
weakly precisely so a process that names channels dynamically does not leak one
per name, and the `FinalizationRegistry` beside it clears an entry only when
nothing has taken the name in the meantime. A strong map compiles and is a
different program.

## A floor for compilation, because nothing was checking it

Emitting C and compiling it are different claims, and only one was being made.
The gate's `profile` step emits for all twenty-two modules and never runs a
compiler over any of it, so **a change that breaks the compilation of every node
module passes the gate green**. That is not hypothetical: it happened today, and
was caught by rebuilding everything for an unrelated measurement. That is luck.

`tooling/conformance/build-floor.sh` replaces the luck, and it is checked in
**both** directions:

    9 of 9 still build, 0 regressed, 0 newly building

A name in `FLOOR` that stops building is a regression. A name in `BLOCKED` that
starts building is reported by name — because that is the half that rots. A
known-to-fail list nobody updates becomes a list nobody reads, and a module that
started building is then invisible; the same failure as a `-Werror` suppression
outliving its cause. Newly-building does not fail the run: the right response is
to move the name and record why, not to hold the run red until somebody does.

Controlled by reintroducing the exact prototype regression in a worktree copy —
three modules report `REGRESSED` and name the conflicting prototype and its
file.

It lives in this lane rather than the gate deliberately. Twenty-two modules
through clang is a serialised twenty-minute resource that three sessions queue
on, and lengthening it is not this lane's to do.

## Twelve of the thirteen that do not build are stopped by one shape

Measured on the gate binary, every module built from a pinned tree. Nine build
now, thirteen do not, and **twelve of the thirteen fail on a type-name
collision** — `blockers/duplicate-type-name`, which already reproduces.

    NtsObj_Frame              11 modules
    NtsObj_Blob                8
    NtsObj_File                8
    NtsObj_ExternalBlobPart    8
    NtsObj_Context             4
    NtsObj_DuplexOptions       4
    plus BlobExternalSource, FileOptions, Socket, URLSearchParams

The struct name is derived from the declared name alone, so two unrelated types
with the same source-level name collide in one program. `Frame` is the clearest
case — two entirely different things, from modules that never import each other:

    struct NtsObj_Frame {          struct NtsObj_Frame {
        NtsHeader header;              NtsHeader header;
        bool isArray;                  bool fin;
        int32_t start;                 int32_t opcode;
        NtsArray * items;              NtsView * payload;
        NtsArray * keys;               NtsValue compressed;
        NtsArray * values;         };
    };

A frame in an inspect walk and a frame in a WebSocket. Both correct, both
named `Frame`, and the second definition is a redefinition plus a failed size
assertion.

**This is the largest single lever on the compiled axis**, and it is larger than
anything else outstanding: `export-class` unblocks three modules,
`computed-member-write` unblocks `os`'s `constants`, and this one is in the way
of twelve. It is not a claim that twelve go green — every module here also has
`no member named` errors behind the collision, and compiling is necessary and
not sufficient, as five modules that build and publish almost nothing show.

`timers` is the thirteenth and is not this: it fails on an undeclared identifier
and an `NtsValue` arithmetic operand.

### The current state of the axis, in exports

    builds & passes    punycode 6 exports, 3 of 3
    builds             os 17, async_hooks 13, punycode 6, path 4, buffer 3,
                       diagnostics_channel 0, querystring 0, string_decoder 0,
                       url 0
    does not build     assert console dgram events fs http net process
                       readline stream util zlib   (name collision)
                       timers                      (undeclared identifier)

`os` at 4 passed and 4 failed is the nearest module to a second green, and its
four failures are `constants` (computed member write, whose dynamic construction
is deliberate — `SIGUSR1` is 10 on Linux and 30 on macOS, so a transcribed table
would be silently wrong on one of them) and `getPriority`/`setPriority` (the
`errors.ts` chain).

## The prediction was wrong, and which half of it was wrong matters

Measured on the compiler lane's gate binary, from a worktree pinned at my HEAD.
Three of its fixes are in it: `callback-binding`, `literal-const-export`, and
the bigint and symbol narrowings.

**I wrote that `path` would go from 2 of 21 to about 20 of 21. It is 2 of 22.**

The number was wrong. The reasoning was not, and the difference is the whole
lesson. `cascade-reach` on the same binary shows `determineSpecificType` still
at the head of the cone, still gating the same eleven exports — and its shape
has changed:

    before   errors.ts:34   an `unknown` narrowed to BigInt
    after    errors.ts:53   a conversion to string from this type

That is a `String(symbol)`, one link along the same chain, and the cone **grew**
from 33 to 36 rather than emptying. The eleven exports are still one *function*
away. They were never one *fix* away, and the claim should have been written
that way — which is exactly the caveat recorded two sections above, now
demonstrated on a real prediction instead of argued.

Writing it down first is what made that legible. A prediction recorded only
after the fact would have become "the chain was longer than expected", which
explains nothing and cannot be checked.

### What the fixes did buy, in exports

    async_hooks           did not compile  ->  builds, 13 exports
    diagnostics_channel   did not compile  ->  builds,  0 exports
    string_decoder        did not compile  ->  builds,  0 exports
    buffer                 1 export        ->  3 exports
    path                   4 exports       ->  4 exports
    punycode               6 exports, 3 of 3

`callback-binding` did what it was measured to do: `async_hooks` and
`diagnostics_channel` compile *and link*, confirming their native halves were
complete. And `literal-const-export` is confirmed on a real module rather than
on its fixture, with precisely the two names predicted:

    INSPECT_MAX_BYTES = 50
    kStringMaxLength  = 536870888

**Still 1 of 22 green.** Four modules now build that did not, and none of them
publishes enough to pass a test. `async_hooks` exports thirteen internal names
and none of its public four — `AsyncLocalStorage`, `AsyncResource`,
`createHook`, `executionAsyncResource` — which are classes, so it waits on
`export-class` with `string_decoder` and `diagnostics_channel`.

### A regression, caught only because the whole set was rebuilt

`buffer` and `string_decoder` went from building to **not** building:

    error: conflicting types for 'nts_process_emit_warning_object'
    incompatible pointer types passing 'NtsHeader *' to 'struct NtsObj_Error *'

A compiled object crossing into a hand-written binding is an `NtsHeader *` on
both sides now, and `internal/nts_node.h` still named the per-program error
struct — the `callback-binding` shape, in this lane's own file rather than the
compiler's. Two modules stopped by a declaration here, not by anything the
compiler could not do.

Nothing was lost by widening it: the implementation is `(void)warning;`, and the
parameter exists only because the Node host stand-in forwards that object.
**It would not have been found by measuring the modules that were already
interesting** — it appeared in two that already built, and only rebuilding
everything showed it.

## The `void` struct fields are gone, measured over the whole corpus

The standing description of this axis is *"228 of 244 clang errors are one
struct emitter writing `void` fields"*, with three WHATWG Streams dictionaries
as the evidence:

    struct NtsObj_Type1880 { NtsHeader header;
        void abort; void close; void start; void type; void write; };

`blockers/void-struct-fields` stages that shape as the plan described it — a
generic interface of optional callbacks over its own type parameter — and **it
does not reproduce**.

**The first version of that claim was made on the wrong sample**, and the error
is worth recording because it is the same one twice in one day. It searched the
seven modules that *build*; the `void` fields were reported from modules that do
not. Redone over all twenty-two — every `program.c` `emit-c` produced, 24MB of
generated C:

    assert 0   async_hooks 0   buffer 0     console 0    dgram 0
    diagnostics_channel 0      events 0     fs 0         http 0
    net 0      os 0            path 0       process 0    punycode 0
    querystring 0              readline 0   stream 0     string_decoder 0
    timers 0   url 0           util 0       zlib 0

Zero, including `fs` at 2.2MB and every module that pulls in WHATWG Streams.
What the shape produces now is a clean refusal, `a parameter of unrepresentable
type (Sink)` — a diagnostic rather than invalid C.

So the fixture is a **regression guard**, and it cannot honestly be anything
else. `emits-c` cannot state this, because correct output has no `void` field
either and such an expectation would pass for the wrong reason forever; and a
fixture that manufactured a reproduction would report a fixed compiler as broken
from now on. The blocker that remains under this shape is a different one and is
open: a generic interface of optional callbacks is still unrepresentable as a
parameter, and that is what the historical sentence should be replaced with
wherever it still appears.

## A second blind spot, in `shape.mjs` rather than `bindings.node.mjs`

The stand-in blind spot is well recorded here: 64 of 332 stand-ins delegate to
node's own implementation, so no lane can disagree with node about them. **The
shape shims have the same failure and it had not been looked for.**

`path/shape.mjs` built the object node's tests see with

    pathVariant(exports, "/", ":")

and used those two literals for `sep` and `delimiter`. The module exports both.
So every test that read `path.sep` was reading a constant *the harness*
supplied, and the value under test never reached the object being tested.

Demonstrated in both directions, on the interpreted lane:

    module exports sep = "\\", old shim   21 of 21 passed, 0 failed
    module exports sep = "\\", new shim    3 failed

`posix.ts` could have shipped a backslash and node's entire suite would have
agreed with node. Fixed by reading both from the module, with **no fallback** —
a module that does not export `sep` should fail loudly rather than be handed the
right answer by its own harness.

### And one that cannot be fixed, now labelled instead

`url/shape.mjs` installs three `Symbol.toStringTag` values on **this lane's**
`URL` and `URLSearchParams` — `runtime/node/url/src/url.ts:36`. The first
version of this note attributed them to web-platform's classes; that lane
checked and corrected it. `runtime/web-platform` has **no `URL` class at all**,
only `URLSearchParams`, and its own classes install the tag themselves in a
`static {}` block as the non-writable, non-enumerable, configurable data
property WebIDL requires — asserted by its own `webidl-surface.test.ts` against
its own barrel, so that test was never passing on this harness.

Installing the tag here is a different act from the enumerability shaping beside
it: enumerability is a descriptor on
members the module really defines, while a `toStringTag` is a member the
compiled module does not define at all, because there is no `Symbol.toStringTag`
in this lowering. `Object.prototype.toString.call(new URL(...))` reads
`"[object URL]"` because the shim says so — and would read it for any object
handed to `shape`.

There is no other way to produce it today and node's tests read it, so it stays;
but it is now named in the file as evidence about the shim rather than about the
artifact. **A survey of every `shape.mjs` for values it supplies rather than
passes through belongs on this list**, and `url` and `path` are the only two
found so far by grep — which is a weaker instrument than the question deserves.

## `punycode` was already whole, and nothing said so

It has been carried as "green and incomplete — `version` absent". Measured on
2026-09-08 against node in the same process:

    decode  encode  toASCII  toUnicode  ucs2  version      <- ours
    decode  encode  toASCII  toUnicode  ucs2  version      <- node's

Same six names, same types, `version` reads `"2.1.0"` on both, and `ucs2`
carries `decode` and `encode`. The claim was historical. **Nothing asserted any
of it**, which is why it could stay in the ledger unchallenged.

Node ships two test files for this module and neither reads `version` or
enumerates the surface — upstream `punycode` is a vendored userland library
whose exports cannot go missing, so there was no failure for a test to catch.
A compiled artifact *can* lose an export silently, and the ledger said it had.

`local/export-surface-static.js` asserts the whole surface: the sorted key list
by `deepStrictEqual` so an *added* name fails too, the exact `version` string,
and `ucs2` as an object of two functions round-tripping a surrogate pair — so
`ucs2.decode` cannot be a `charCodeAt` map and pass.

Pinning `version` is deliberate. It is a string constant, and a constant export
is exactly what the backend was dropping until this morning: a numeric literal
was folded into its readers with nothing left for the export table to name.
Strings were unaffected, which is the only reason this one survived.

**`punycode` compiled is now 3 of 3**, and the new file fails under
`--sabotage`, so the extra pass is not a hollow one.

## Every module, every cone: one shape reaches all of them

`cascade-reach.mjs` run over all 22 modules on the 11:30 binary. Refusal shapes
ranked by how many modules they head a cone in, with the missing exports those
cones contain:

    21 modules,  24 exports   an `unknown` narrowed to BigInt
    13 modules,   3 exports   `toString` on a number
    13 modules,   1 export    a conversion to string from this type
    13 modules,   0 exports   a module-scope variable of unrepresentable type
    11 modules,   0 exports   a rest parameter whose element type has no representation
    10 modules,   2 exports   a method without a body
    10 modules,   0 exports   a rest parameter of unrepresentable type
     8 modules,   0 exports   `length` of something without one

**`narrowed-bigint` heads a cone in twenty-one of twenty-one.** Not the largest
by a margin worth arguing over — the next shape reaches thirteen. It is in
`internal/errors.ts`, which every module imports, and it is the head of the
chain `validateString` -> `ERR_INVALID_ARG_TYPE` -> `determineSpecificType` that
sits under every argument check in the profile.

The export counts are floors for the reason recorded above, and they are
*conservative in a second way here*: a module that does not reach the wrapper
stage at all contributes no "missing export" lines, so the fifteen that fail to
compile contribute zero to that column while being just as blocked.

`toString` on a number at thirteen modules is `blockers/number-tostring-radix`,
already filed.

This is the argument for the hypothesis in the next section mattering more than
its size suggests: if narrowing an erased value to bigint turns out to be
statically false rather than unrepresentable, then the cheapest available fix is
also the one with the widest reach in the entire profile.

### A third way the count is not what it looks like

**Clearing the head of a cone can reveal the next refusal in the same
function.** The compiler lane fixed the bigint narrowing and the count moved by
`-3` and then `+1`: `determineSpecificType` is a `switch (typeof value)` and
every arm is its own narrowing, so clearing the bigint arm let the lowering
reach the *symbol* arm, refused for a different reason. Behind that, a string
conversion; behind that, `toString(16)` — which is `number-tostring-radix` at
thirteen modules.

The cone was measured correctly and is real. What it cannot see is what it is
standing in front of. So a cone is an upper bound on what one fix unblocks only
when the refusal at its head is the **only** one in that function; otherwise it
sizes a queue rather than a step, and `cascade-reach.mjs` now says so on every
run alongside the other two caveats.

That is not an argument against the ordering — it is the argument for it. Each
link is small, and all of them are in one file that twenty-one modules import.

## `narrowed-bigint` may be dead code rather than a missing representation

Not yet established, and recorded here as a hypothesis with the thing that would
refute it named, because acting on it is a decision in another lane.

The compiler lane sized this as the largest of three fixes: a bigint is
`__int128`, an `NtsValue` payload is a pointer or a double, so erasing one needs
a heap box and a tag that does not exist.

**That last clause runs the other way too.** There are eight tags —
`UNDEFINED`, `BOOLEAN`, `NUMBER`, `STRING`, `FUNCTION`, `SYMBOL`, `OBJECT`,
`NULL` — and none is a bigint. An `unknown` *is* an `NtsValue`. So no `unknown`
can hold a bigint, and `typeof value === "bigint"` where `value: unknown` is
**provably false rather than unrepresentable**. If that holds, the branch is
unreachable and the fix is to lower it as dead, with no new tag and no box.

The rule has to be narrow and appears to be: narrowing an **erased** value to
bigint is statically false. A value whose static type is already `bigint` is a
real `__int128` and works today — `nts_hrtime_ns` returns one, and
`nts_bigint_as_intn` takes one. This is not "bigint is unsupported".

Both blocked sites fit: `determineSpecificType(value: unknown)` interpolates
`${value}n` into an error message, and `ERR_OUT_OF_RANGE`'s constructor compares
an `unknown` against `2n ** 32n`. Neither can be reached with a bigint in hand.

**What would refute it:** a Node-API wrapper that accepts a JavaScript BigInt
from a caller and hands it in as an erased value. That would need a tag to do
it, and there isn't one, so the expectation is that it already refuses or
coerces — but that is a check in the compiler lane's code, not this one's, and
the hypothesis is worth nothing until somebody runs it.

## A prediction, written down before the fix so it can be wrong

Measured 2026-09-08, the same modules on both lanes:

    module           interpreted        compiled
    path             20 of 21           2 of 21
    os                8 of 8            4 pass, 4 fail
    string_decoder    4 of 4            0 of 5
    fs              344 of 344          does not compile

`path` has **no native half** — it declares no binding that is missing, and it
is pure TypeScript over `internal`. So the gap between 20 and 2 is not behaviour
and cannot be: it is that eleven functions are absent from the export table,
for the single reason traced above.

**The prediction: when `narrowed-bigint` lands, `path` compiled goes from 2 of
21 to about 20 of 21, without any change to `runtime/node/path`.** Not exactly
20 — a compiled module can still differ from an interpreted one, and this
document exists largely because it does — but the direction and the magnitude
are a claim, and a result of 5, or of 20 with three new failures, refutes the
reasoning rather than merely disappointing it.

`string_decoder` carries the same shape with a different fix: 4 of 4
interpreted, 0 of 5 compiled, and the only thing between them is `export-class`.

This is written before the fix deliberately. Every other number in this document
was recorded after the fact, which makes them measurements but not tests of the
reasoning that produced them. `fs` at 344 passed and **0 failed** is the control
for a different question — that the byte-path and error-shape work landed today
did not regress the lane it was written for.

## What the building modules are missing, in exports rather than tests

Seven modules build. Only one passes. Asking each addon what it actually
publishes explains every one of the six failures, and it is a shorter list than
the test counts suggest:

    module           exports published / expected
    buffer            1 / 15
    os               17 / 23
    path              4 / 15
    punycode          2 / 2      <- the one that passes
    querystring       0 / 9
    string_decoder    0 / 2
    url               0 / n

`string_decoder` is the cheapest of all of them: it exports a class and a
`default`, both reported as *not a function this backend can name*. One
capability, `blockers/export-class`, is the whole module.

**`path` is the one that moves most for one fix.** All eleven of its missing
functions — `basename`, `dirname`, `extname`, `format`, `isAbsolute`, `join`,
`matchesGlob`, `normalize`, `parse`, `relative`, `resolve` — are refused for a
single reason: they call `validateString`, which calls
`ERR_INVALID_ARG_TYPE#constructor`, which calls `determineSpecificType`, which
is `blockers/narrowed-bigint`. Four links, one shape.

Measured the same way: `url` 3, `os` 2 (`getPriority`, `setPriority`),
`buffer` 1 (`SlowBuffer`). Seventeen exports across four modules from one fix.

### A name mismatch nearly published the opposite conclusion

The first run of this check reported that **none** of `path`'s missing exports
were in that cone. The compiler names the function `join@posix`; the export
table wants `join`; matching the plain name found nothing. A silent zero from a
name mismatch is indistinguishable from a real negative result, and it survived
only because the answer was surprising enough to check twice.

`cascade-reach.mjs` now matches on the name before any scope suffix and prints
which exports a cone would unblock, so the question is answered by the tool
rather than by a hand-written filter each time.

### And the count is a floor

`querystring` reports **zero** unblocked exports while all eight of its function
exports are refused — two of them by the very shape at the top of its own list.
A function whose own body holds an NTS1001 is refused *directly* and is
therefore in no cone at all, so fixing that shape unblocks it without ever
appearing in the number. The tool now says so on every run rather than leaving
a reader to infer it from a figure that looks complete.

## The counted lane, run over every module, with its control

Run 2026-09-08 from a worktree pinned at `46e1c9e5` so it could not be
contaminated by the three sessions committing into the main checkout. It took
**under four minutes**, not the forty the earlier estimate assumed — most
modules fail to build quickly.

Seven of twenty-two build under reference counting. The other fifteen fail to
compile, which is the same set and the same errors as uncounted.

    module           counted            uncounted (control)   rc sites
    buffer           0 of 55            0 of 55               196 -> 0
    os               4 pass, 4 fail     4 pass, 4 fail        229 -> 0
    path             2 of 21            2 of 21                26 -> 0
    punycode         2 of 2             2 of 2                 55 -> 0
    querystring      0 of 8             0 of 8                214 -> 0
    string_decoder   0 of 5             0 of 5                197 -> 0
    url              0 of 52            0 of 52               454 -> 0

**Every module gives an identical answer counted and uncounted.** Across 1,371
retain/release sites and 196 test files, reference counting changes no observable
behaviour — no invalid HIR, no wrong answer, no crash under poison. `punycode`
additionally ran 140,224 differential comparisons against node over 20,000 random
inputs with **0 divergences** while counted.

The right-hand column is the reason to believe the left one. Without a control
the counted run says only "these seven behave like this"; the interesting claim
is the comparison, and a lane reporting one half reads as though it had measured
both.

### The guard that could never fire

Running the control is what exposed it. `counted-lane.sh` refuses a build with
zero retain/release sites, because a green row from an uncounted build is
precisely the false negative it exists to prevent — and the comment above that
guard records the incident that prompted it, a `punycode` 2 of 2 from a build
with no counting in it.

    sites=$(grep -cE 'nts_retain|nts_release' "$program" 2>/dev/null || echo 0)
    if [ "$sites" -eq 0 ]; then

`grep -c` prints `0` **and exits 1** when it matches nothing, so `|| echo 0`
appends a second zero. `sites` becomes the two-line string `"0\n0"`, the `-eq`
test fails with *integer expected*, and the `if` takes the else branch —
proceeding exactly as though the build had been counted.

So the guard has been dead since the day it was written, and it is dead
*specifically* in the one case it exists for: zero is the only value that
reaches the broken branch. Nothing in a normal run could reveal it, because a
normal run never has zero. It took the control, where every module legitimately
has zero, to make the branch reachable at all.

Fixed, and then demonstrated: with counting disabled the lane now says
`NOT COUNTED -- built clean but emitted no retain/release; result would be
meaningless`, where before it printed two shell errors and carried on.

## Why `buffer` builds and then fails all 55 of its tests

It builds — under reference counting too, 196 retain/release sites — and it
publishes **one of its fifteen exports**. That is the whole explanation for the
test result, and it took asking the addon rather than reading the sweep label.

The fourteen missing exports fall into two groups, and they need different work:

    is not a function this backend can name   (6)
      Blob  Buffer  default  File  constants  INSPECT_MAX_BYTES
      kStringMaxLength

    no function of that name was compiled     (8)
      SlowBuffer  atob  btoa  isAscii  isUtf8  resolveObjectURL  transcode

The second group is the refusal cascade — `atob` and `btoa` are class
expressions the walk does not enter, the rest sit behind `narrowed-bigint`. The
first group is a backend capability, and **two of them turned out to be a
defect rather than a limit**.

### A literal-initialised numeric export is dropped; a computed one is not

    export const fromLiteral = 50;          // never published
    export const fromComputed = 2 ** 53 - 1; // published

Both read by compiled code, differing only in whether the right-hand side is
written out or arrived at. Fixtured as `blockers/literal-const-export`.

It is not about the value — 50 and 536870888 both fail, `2 ** 53 - 1` and
`50 + 0` both succeed. **It is also not about a rule I first thought I saw.** A
first pass put nine exports in one file and produced the opposite answer, which
read as a rule about small integers; isolating one variable at a time gave the
real one. That is the fourth time this document records a measurement that
changed when the thing being measured was made smaller.

The asymmetry is the argument that it is a defect. A backend declining to export
values would decline both; one exporting them would export both. Folding a
literal into its readers and then having nothing left to name is the only way to
arrive at this shape — and it costs `buffer` its `kStringMaxLength` and
`INSPECT_MAX_BYTES`, both of which node's tests read.

## The refusal that costs the most is not the one the counts name

A refused function refuses everything that calls it, so the price of one primary
refusal is the size of its transitive cone rather than one line of output.
`tooling/conformance/cascade-reach.mjs` computes that for one module.

It matters because the obvious reading is wrong. In the `os` program there are
87 primary refusals and 140 further functions stopped by cascade. Tally the
`because it calls X` lines and the worst offenders look like `checkedOffset`
(28) and `checkedIntegerWrite` (21) — **both of which are themselves cascaded**.
The actual root is `ERR_OUT_OF_RANGE#constructor`, whose cone is 74 and which
appears in the flat count nine times. The ranking anyone would naturally read
does not merely lack precision; it names the wrong function.

Across three modules the largest single lever is one shape,
`blockers/narrowed-bigint` — an `unknown` narrowed to BigInt, in
`internal/errors.ts`, which every module shares:

    os       74 + 24 + 5    of 140 cascaded
    buffer   71 + 24        of 136
    fs       96 + 93 + 13   of 940

Two sites do nearly all of it: `errors.ts:34` in `determineSpecificType` and
`errors.ts:403` in `ERR_OUT_OF_RANGE`'s constructor, both `typeof input ===
"bigint"` against an `unknown`.

Traced end to end, that is why `os` exports 17 names instead of 23.
`ERR_OUT_OF_RANGE` stops `validateInt32`, `validateInteger`, `validateUint32`
and `validateNumberRange` in `internal/validators.ts` — imported by every
module — and `checkSize`, `boundsError` and `checkedIntegerWrite` in `buffer`.
In `os` it is precisely why `getPriority` and `setPriority` are missing.

### The rest of what `os` is missing, since it is the nearest partial

    cpus               heterogeneous-tuple-return
    getPriority        narrowed-bigint, via ERR_OUT_OF_RANGE -> validateInt32
    setPriority        narrowed-bigint, same chain
    constants          computed-member-write  (`table[name] = value`)
    networkInterfaces  computed-member-write  (`result[name] = ...`)
    userInfo           `userInfoString`, a declaration outside every walk
                       -- no fixture yet

Named by fixture rather than by diagnostic text, which is the distinction that
cost three days once already: `constants` reads as "`name`, which `an anonymous
type` does not declare", and that sentence is a description of a grouped
message rather than of anything that refuses. The thing that refuses is a
computed member write, and there is a fixture for it.

Four of the six failing test files come from `constants` and `priority` being
absent. **So `os` is not one fix from green — it is three**, on three separate
blockers, and the earlier reading of it as the nearest module to finish was
measuring distance in test files rather than in compiler work.

**Attribution of a root to a shape is a guess and is printed as one.** The
diagnostics say which function calls a refused one, but not which function
contains a given NTS1001, so the tool matches by line range and prints the
candidates rather than choosing when the range is ambiguous.

## A whole class of code here was verified by nothing at all

Every node module's C is exercised only *through* its module, and fifteen of
twenty-two modules do not compile. So on the morning of 2026-09-08 the position
was: `zlib.c`'s seven changed signatures, `fs.c`'s eleven new `_bytes` bindings
and `timers.c`'s entire handle policy had **never been executed by anything**.
The ABI audit proves the *types* agree with the TypeScript. That is a different
claim from the code working, and it is easy to read the first as the second.

`tooling/conformance/c-tests.sh` runs `runtime/node/*/test/*.c`. Three files,
33 checks, and they can run *before* the compiler is ready — which is where this
lane spends most of its time.

    fs       bytes   10 check(s) pass
    timers   host    14 check(s) pass
    zlib     bytes    9 check(s) pass

Each was controlled by sabotage, and the controls are the point rather than the
pass count. Twelve defects were introduced; **eleven were caught immediately and
the twelfth found a real gap**, described below.

### What these can ask that node's suite cannot

Three of the checks are only possible because this profile has a seam where node
has one piece of C++:

- **An immediate must not leave the loop asleep.** `uv_backend_timeout` does not
  consider check handles, so a `uv_check_t` alone means the loop blocks in poll
  and a bare `setImmediate` never runs. Asserted by *asking* the loop its
  intended timeout rather than by running it, because the failure is an
  indefinite block and a blocked test reports nothing at all.
- **An immediate may reschedule itself.** Stopping the check handle after the
  drain rather than before disarms what the drain just armed: one immediate,
  then silence.
- **A path containing `0xff` is reachable only by bytes.** It has no string
  spelling, Linux does not care, and it is the single case where a byte binding
  that quietly went through a string loses. Node cannot have this bug, so node
  has no test for it.

### The control that found something

Five sabotages of `timers.c`; four caught. The fifth — deleting the re-apply of
ref state inside `schedule` — passed. Chasing it: `ensure_handles` unreferences
all three handles at install, so that re-apply is what makes a plain
`setTimeout` hold the process open. Every test called a `reset` helper that
called `toggle_ref(true)` first and referenced the handle by hand, masking it.

**The missing thing was an assertion, not a redundant line.** Two checks now run
before any `toggle_ref`, and with them all six sabotages are caught including
the check-handle twin. A suite that passes a broken implementation is the exact
failure this document keeps a hollow column for, and it appeared inside the
tooling built to find it — for the second time.

## What actually stops the fifteen, measured rather than remembered

The standing description of this axis was *"228 of 244 clang errors are one
struct emitter writing `void` fields"*. That is historical. Profiled on the 11:16
binary, every module built with `NTS_COMPILER` pinned:

    120  no member named X in X
     49  redefinition of X
     12  incompatible pointer types
     11  too many errors emitted, stopping now
     10  static assertion: NtsObj_Frame is not the size nts computed
      7  operand of type NtsValue where arithmetic or pointer type is required
      6  conflicting types for X
      6  static assertion expression is not an integral constant expression
      4  NtsObj_DuplexOptions.signal is not where nts computed
      4  NtsObj_Context is not the size nts computed

**Twelve modules hit clang's twenty-error limit**, so their counts are floors and
the totals above understate. Three do not:

    async_hooks           2 errors
    diagnostics_channel   2 errors
    timers                4 errors

### And would they link? Two yes, one no

"One fixture from compiling" is worth nothing if the module then fails to link,
so I asked the linker rather than assuming. Declared `nts_*` bindings against
the set that actually has C:

    async_hooks           1 declared /  0 with no C
    diagnostics_channel   0 declared /  0
    timers                8 declared /  7 with no C

`runtime/node/timers/` contained **no `.c` file at all**, so no amount of
compiler work would have produced a loadable addon for it. That half is this
lane's, and it is now written: one `uv_timer_t` and one `uv_check_t`, the
bookkeeping left in TypeScript where node keeps it. All seven declared symbols
resolve; the module still does not compile, so this closes a link gap and
nothing else.

The third handle in that file is a libuv fact worth recording: `uv_backend_timeout`
does not consider check handles, so with only a `uv_check_t` started the loop
blocks in poll and a bare `setImmediate` never runs — the handle is active, the
loop is alive, and it is asleep. Node overrides the backend timeout itself; an
addon has no such hook, so a permanently unreferenced `uv_idle_t` is started
alongside to force the iteration.

### Two modules are one fixture from compiling

`async_hooks`'s two errors are **the same call site**:

    program.c:1900  void nts_node_enqueue_microtask(NtsObj_Ctor_TypeError *);
    nts_node.h:50   void nts_node_enqueue_microtask(NtsHeader *callback);
    program.c:5307  nts_node_enqueue_microtask(v17);   incompatible pointer

That is `blockers/callback-binding` — the compiler names a closure type per
program, so the one `.c` every module links against cannot spell it.
`diagnostics_channel` is the same two with `NtsObj_Closure18`. `timers` is the
same two plus an undeclared `Closure54__call` and one `NtsValue` arithmetic
error.

So the goal text's guess — *"async_hooks, diagnostics_channel and timers are one
`NtsTask` struct mismatch each"* — was right about the **shape** and wrong about
**which** mismatch. One closure-type mismatch each, not a struct.

**Compiling is necessary and not sufficient.** Five modules already build and
still export nothing or pass degenerately, so these two could land in
`built-exports-nothing` like `querystring`. That is not knowable until the
fixture is fixed, and claiming otherwise would be the third kind of error this
ledger records.

## The compiled axis has not moved all day, and that is the finding

Re-measured at 11:16 on the current binary, after the closure-merge fix, the
materialize repair and the signature-layout fix landed:

    green                  1   punycode, 2 of 2
    partial                1   os, 4 of 7
    built-exports-nothing  3   querystring, string_decoder, url
    built-exports-partial  1   buffer
    every-pass-hollow      1   path
    c-did-not-compile     15

**Identical to the morning's table.** Three compiler fixes landed between them
and none touched this. That is worth stating rather than re-measuring hopefully:
the fixes were for wrong *answers*, and what stops these modules is *refusals*.
A wrong answer outranks a refusal — that ordering has been right all day — but it
means this axis stays where it is until the refusals are taken.

**`os` is two fixtures from green and they must go together.** It fails three of
seven and all three are `os.constants` being undefined:

    computed-member-write        `table[name] = value`, os/src/main.ts:541
    heterogeneous-tuple-return   nts_os_constants(): [string[], string[], number[]]

Fixing the first alone moves `os` from a refusal to a *build failure*, which is
why they are one piece of work rather than two. `string_decoder` is the fourth
module and wants `arraybufferview-parameter` plus `export-class`.

All four still reproduce on the newest binary. The compiler lane has taken the
first pair.

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

> **Superseded 2026-09-08.** This section is correct for the compiler it was
> written against and is kept as the record of how the bug was characterised.
> The `void` fields are **gone**: `emit-c` over all twenty-two modules, every
> `program.c` produced, 24MB of generated C, count zero. The per-field analysis
> below — that void-ness is per field rather than per struct — is the reasoning
> that made it findable, and `blockers/void-struct-fields` is now a regression
> guard rather than a reproduction. Do not carry "228 of 244" forward; the
> current census is at the top of this document.

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
`fn.length` is observable and node's suite does assert it in places. As
measured, that list was:

    querystring.unescapeBuffer     1  node 2
    url.URL                        0  node 1
    url.URLSearchParams            1  node 0
    url.fileURLToPath              2  node 1
    url.fileURLToPathBuffer        2  node 1
    util._errnoException           3  node 0
    util._exceptionWithHostPort    5  node 0
    util.isDeepStrictEqual         2  node 3
    events.EventEmitterAsyncResource  1  node 0

**Superseded 2026-09-09.** The wrapper now sets `length` from the signature
rather than leaving it 0, and seven of those nine are gone: `querystring` and
`url` report **0 wrong arity**, and the tree-wide figure fell from 95 to 21.
Controlled on eight signature forms — required, optional, defaulted, erased,
two required, required-then-optional, rest, none — the wrapper emits
`1,1,0,1,2,2,0,0`, which is what JavaScript reports for the same eight
functions. All eight correct.

What is left is one family and one name, and the family is not a defect in the
usual sense:

    util._errnoException         ours 3  node 0    node's is bound
    util.types.* (19 of them)    ours 1  node 0    node's are native bindings

Every one of the nineteen is ours 1 / node 0, checked rather than assumed. A
native binding reports 0 because it declares no JavaScript parameters; a
declaration that says what it takes reports 1. Ours is the more informative
number and node's is the bar, so it stays on the list.

**A separate question the same fix opened: `length` and the wrapper's argument
check can disagree.** Against 22 freshly built artifacts, two functions demand
more arguments than their own `length` reports — `async_hooks.emitBefore`
(length 3, demands 4) and `emitAfter` (length 1, demands 2). Both are
harness-only raw exports that node does not have and `shape.mjs` omits, so no
node test can reach them: real, and inert.

That figure was **10** before it was 2, and the difference is why this paragraph
names its artifacts. `unusable-exports.mjs` named `target/node` literally and
ignored `NTS_ADDON_OUT`, so it measured whatever another lane had last built
while appearing to measure a private directory — `os.getPriority` length 0
demanding 1, all of punycode, `url.isURL`, every row of it stale. Rebuilding
`os` into a private directory made them vanish. Three other instruments had the
same defect — `accessor-audit.mjs`, `sweep.mjs`, which also *wrote* into the
shared directory, and `check.sh` — and all four take the variable now.

**An output-directory variable is a claim about a script until that script is
the one you checked.** The ten rows were written up as a consequence of the
length fix and were three sentences from being sent as evidence against it.

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

### 2026-09-10: fifteen of seventeen publish, and the two that do not are named

> This supersedes *Measured end to end: seventeen exports, two published, one
> chain* below, which is kept for the chain it found. That measurement is no
> longer true in its headline number: the `validateString` chain has been closed
> and `path` now publishes **15 of node's 17 names**. Re-derived today against a
> pinned compiler with `NTS_ADDON_OUT` set, so this is not `target/node`.

Missing from the addon: **`format` and `matchesGlob`**. They have different
causes and only one of them is a lowering gap.

| name | decline | whose |
| --- | --- | --- |
| `format` | `no wrapper for format@posix: takes an object` (and `@win32`) | wrapper generator |
| `matchesGlob` | `is exported and no function of that name was compiled` | a cascade, below |

Both are written in my source — `internal.ts:117` and `posix.ts:31` — so neither
is an absence I can close by writing TypeScript.

`matchesGlob` cascades from four roots in `glob-matcher.ts`, and the split
matters because two of them are one known thing:

| site | construct | |
| --- | --- | --- |
| `glob-matcher.ts:28` | `new RegExp(...)` — a `new` with arguments and no constructor | RegExp |
| `glob-matcher.ts:41` | `this.expression.test(value)` — a method with no declaration in the hierarchy | RegExp |
| `glob-matcher.ts:453` | `parts.indexOf("**", globstar + 1)` — an array method with this many arguments | |
| `glob-matcher.ts:596` | `patternIndex * columns` — a name from an enclosing scope | |

**Rewriting my own source would not unblock it.** Lines 28 and 41 are `RegExp`
construction and `RegExp.prototype.test`; either alone stops the chain, and
neither has a supported form to rewrite into. The remaining two are separately
fixable and separately pointless while the first two stand. `globStar` appears
in the emitted C and `matchesGlobPattern` does not, which is the cascade
boundary made visible.

The build carries **22 `NTS1001` and 7 wrapper declines**.

#### The one failure that is mine, and what it costs to fix

`test-path-resolve.js` fails compiled and **passes interpreted**. It is not a
`resolve` defect: compiled `resolve` agrees with node on fourteen inputs across
the default, `posix` and `win32` entry points, and both namespaces cross
correctly (`typeof posix === "object"`, `posix.resolve` a function,
`posix.sep === "/"`).

The failing line is `test-path-resolve.js:87`:

    process.cwd = () => '';
    assert.strictEqual(path.resolve(), '.');

Node's own `lib/path.js` calls `process.cwd()`, so the patch is honoured there.
Ours resolves the cwd differently per lane:

- **interpreted** — `nts_process_cwd` is shimmed to JS `process.cwd()`, sees the
  assignment, returns `''`, and `resolve()` degrades to `'.'`;
- **compiled** — `runtime/node/internal/process.c:19` calls `uv_cwd()` in C and
  never consults the JS binding.

So the class is **native code bypassing a JS-patchable host binding**, not
anything about paths. The machinery to fix it already exists in the same file:
`process.c:203` holds a `napi_env` and `nts_emit_warning_through_node` already
reaches `global.process` and calls a named method through it.

**Done, and the trade I expected was not there.** I wrote the paragraph that
used to sit here before measuring: that routing the cwd through JS would add a
Node-API round trip to every `resolve` of a relative path to satisfy one test of
a degenerate cwd. That reasoning was wrong in the direction that mattered.

    node   process.cwd()                11.3 ns/op
    ours   resolve("a","..")  [cwd]    907.0 ns/op
    node   resolve("a","..")  [cwd]    296.9 ns/op
    ours   resolve("/a","b")  [no cwd] 312.2 ns/op
    node   resolve("/a","b")  [no cwd]  57.8 ns/op

Node's `process.cwd()` is **11.3 ns** — node caches the cwd and invalidates on
`chdir`. `uv_cwd()` is a `getcwd` syscall every time. Calling *into JS* is the
cheap side and the C shortcut was the expensive one.

The number I had not looked for is the one that matters: **we are 5.4x slower
than node on `resolve` with no cwd involved at all** (312.2 vs 57.8 ns). The cwd
hop was never what made that row slow.

`nts_process_cwd` now asks `global.process.cwd` first and falls through to
`uv_cwd` whenever there is no host, the member is not a function, or the call
fails — which is every standalone binary. `test-path-resolve.js` passes
compiled, taking `path` from **13 passed / 7 failed to 14 / 6**, and the
interpreted lane is unchanged at 20 / 0.

Two things about the change worth keeping:

- **The recursion guard is real, not defensive decoration.**
  `runtime/node/process/src/control.ts:68` defines our own `cwd()` as
  `nts_process_cwd()`. In the addon lane the host global is real node's
  `process`, so it does not loop — but that is a fact about the harness rather
  than a property of the code, so a re-entry flag falls through to `uv_cwd`.
- **The first version of this compiled, linked, ran, and did nothing.**
  `NTS_HAVE_NODE_API` is defined by `process.c` itself from an `__has_include`
  probe that sat at line 206, below my uses at 9 and 17, so the preprocessor
  deleted them. Nothing warned. `nm` on the artifact showed the new symbol
  absent and `U uv_cwd` still there; hoisting the probe above its first use was
  the whole fix.

#### What the controls say about the two new passes

Run after the fact, and the answer is not uniform across them:

    path: 15 pass -- 13 behaviour, 2 shape-only, 0 hollow
    os:    5 pass --  3 behaviour, 2 shape-only, 0 hollow

**`test-path-resolve.js` is behaviour.** The cwd fix bought a pass that depends
on the compiled code doing the work, and it fails under all three controls.

**`local/legacy-make-long.js` is shape-only.** The `_makeLong` alias is a
statement about which object a name points at, and a shim can satisfy it without
the implementation answering anything. That is a real pass on a narrower claim
than the axis is usually reported to make, and it is written here as shape-only
rather than folded into "13 to 15" — one of the two gains is behaviour and the
other is not.

`0 hollow` holds in both modules: nothing passes under `--sabotage`,
`--empty-exports` or `--mutate-addon`.

#### Where `path` stands after both fixes: 15 passed, 5 failed

Two changes landed in this module today, and the module went **13 passed / 7
failed to 15 / 5** compiled while the interpreted lane held at **20 / 0**.

The second was `_makeLong`. `local/legacy-make-long.js` asserts
`path._makeLong === path.toNamespacedPath` with `strictEqual`, and node means it
literally — `lib/path.js:1710` is `win32._makeLong = win32.toNamespacedPath`,
the same function object. `runtime/node/path/shape.mjs` was reading
`exports._makeLong`, which is a *second* wrapper over the same body: deep-equal
in behaviour and never reference-equal. Pointing the shim at the shaped member,
as node does, is the whole change. Worth noting it is a one-off — a sweep of
`path`, `util`, `os`, `buffer`, `string_decoder`, `querystring`, `events` and
`assert` for `x.a = x.b` alias lines in node's `lib/` found this pattern in
`path` and nowhere else.

**All five remaining failures have named causes and none of them are mine:**

| file | cause |
| --- | --- |
| `test-path-glob.js` | `matchesGlob` — the `RegExp` cascade above |
| `test-path-parse-format.js` | `format` — `no wrapper: takes an object` |
| `local/edge-inputs-static.js` | the same `format`, 2 of 183 cases |
| `local/export-surface-static.js` | the same two, across the top level and both namespaces |
| `test-path-makelong.js` | an object argument at the wrapper boundary |

The last one deserves its own line because I read it wrong first. The stack
points at `test-path-makelong.js:51`, which is `toNamespacedPath(true)`, and I
wrote that a boolean had no representation. Surveying every type says
otherwise:

    ""  "abc"  null  undefined  100  0  false  true   ->  identity, ours and node
    {}  []                                            ->  ours throws, node returns identity

**Every primitive crosses by identity; objects and arrays do not.** The failing
call is line 49, `path.toNamespacedPath(path)`, passing the module object.
Node's contract is `if (typeof path !== 'string') return path`, so matching it
needs `unknown` at the boundary — already filed as
`blockers/unknown-at-the-boundary`, and not something to reach for with an
assertion.

`process.cwd` is reassigned by two files in node's suite —
`test-path-resolve.js` and `test-util-inspect.js` — so the class is small and
now closed for both. Two more (`test-util-styletext.js`,
`test-util-styletext-hex.js`) replace `process.env` wholesale, which
`nts_process_env` would need the same treatment to see; that one is **not** done
and the caching argument above does not transfer to it unmeasured.

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

### Re-measured 2026-09-08: `os` publishes 17 of node's 23

The table this section used to end with is withdrawn rather than patched. It
read `a parameter with a default | 2 | getPriority(pid = 0)`, and there are
**zero** such refusals in `os` today — `getPriority` lowers with its default
handled, as `export func getPriority(pid: f64) -> f64`. A row naming a function
that lowers is worse than no row, because it sends someone to fix a construct
that works.

What the addon actually publishes, against node in the same process:

    node has, we do not:  constants  cpus  getPriority  networkInterfaces
                          setPriority  userInfo
    we have, node does not:  (none)

Six exports, and they divide into two groups that need entirely different work.

**Two lower and are dropped by cascade.** `getPriority` and `setPriority` both
appear in the IR and neither is named by any NTS1001. They sit in
`determineSpecificType`'s cone, which is 96 of `os`'s 141 cascaded functions and
is rooted at `errors.ts:70`, `JSON.stringify`. For these two the cone is a step
rather than a queue — checked, not assumed, and it is the first time that has
come out this way.

**Four do not lower, and only five of `os`'s 86 refusals are in its own source:**

| export | site | refusal |
| --- | --- | --- |
| `cpus` | `main.ts:306` | an erased value where a concrete representation is wanted |
| `userInfo` | `main.ts:428` | an erased value where a concrete representation is wanted |
| `networkInterfaces` | `main.ts:340` | `name`, which `NetworkInterfaceMap` does not declare |
| `constants` | `main.ts:541` | `name`, which `an anonymous type` does not declare |
| `networkInterfaces` | `main.ts:395` | `userInfoString`, a declaration outside every walk |

The other 81 refusals are shared code reached through the tsconfig cone —
`errors.ts`, `blob.ts`, `encodings.ts`, `validators.ts` — and belong to whatever
module fixes them first, not to `os`.

So `os` is **two shapes and one chain** away from whole, not six separate
problems. The `does not declare` shape already has four fixtures.

### The `erased value` shape is narrower than its diagnostic

It had no fixture, and writing one moved it a long way from what the message
says. A value indexed out of an array is `T | undefined`; narrowed by a guard
that throws, it lowers when read, compared, returned, used in arithmetic, and
written into an object as `key: value`. It refuses **only in shorthand
position**:

    const first = xs[0];
    if (first === undefined) throw new Error("");
    return first + 1;        // lowers
    return { lo: first };    // lowers
    return { first };        // REFUSED

`{ first }` is sugar for `{ first: first }` and the checker gives them the same
type. A backend that could not put a narrowed value into an object would refuse
both, so the asymmetry is the argument that this is a defect.

`blockers/narrowed-shorthand-property` holds three functions and **two of them
are controls that must stay clean**. That is not decoration: the fixture was
written as "narrowed into an object literal", asserted the correct diagnostic,
reproduced, and pointed at the wrong construct. Only the explicit-spelling
control lowering cleanly located it. A fixture with one control says its defect
is present; it takes a second to say what the defect *is*.

Both real sites use shorthand because node's code does — `cpus` assembles a
`CpuInfo` from seven guarded values, `userInfo` a `UserInfo` from three.
Rewriting either to `key: value` would compile today and would be rewriting
correct source to hide a refusal.

## Shorthand properties are not resolved, and two diagnostics say so

`{ x }` refuses. `{ x: x }` compiles. Same program, same type, at module scope
and inside a function body alike:

    export function lowers(n: number): number { return n + 1; }

    export const Explicit  = { lowers: lowers };   // lowers
    export const Shorthand = { lowers };           // REFUSED
    function inBody() { return { lowers }; }       // REFUSED

**The message depends only on what the name refers to.** A narrowed local reads
`an erased value where a concrete representation is wanted`; a module-scope
function reads `a shorthand naming nothing in scope`. One root, two texts, and
two fixtures — `narrowed-shorthand-property` and `shorthand-naming-a-function`
— kept separate so a fix covering one value kind cannot leave the other
reproducing with nothing to say so.

The second message is also wrong about its own cause. The name it calls "nothing
in scope" is an exported function declared in the same file that lowers on its
own, which sends a reader hunting for a typo. The compiler has the honest
phrasing already and uses it elsewhere in the same run: *a module-scope variable
whose initializer was refused above*.

### Measured after the fix: the share was 9, and a sample of four said 70

`fc0df644` closed it. Profile-wide, on a fresh pin:

    a shorthand naming nothing in scope       22  ->  0
    an erased value where a concrete...      141  -> 132

**Nine of the 141 were shorthand.** The table below was published with the
second row marked as a ceiling on an unmeasured share, and with four sampled
sites of which two were shorthand. Extrapolating that sample would have put the
share near seventy. It was off by a factor of eight.

That is the whole argument for the row being written as a ceiling rather than
summed into the first. A four-site sample is not a measurement of a 141-site
population, and the temptation to report `163` was strongest precisely because
both messages come from one defect in the cases that led there.

The axis did not move: no module publishes a new export. 31 refusals removed,
zero exports — the same shape as `AnyView` the same evening. Two correct and
worthwhile fixes, no movement, and the reading is not that the fixes were wrong
but that the remaining distance is concentrated at the wrapper.

### What it costs, and the half of that I did not measure

| | count | confidence |
| --- | ---: | --- |
| `a shorthand naming nothing in scope` | **22** | certain — the wording is shorthand-specific |
| `an erased value where a concrete representation is wanted` | 141 | an **upper bound**; shorthand is one of at least three causes |

The 22 span 13 modules, with three each in `fs`, `http` and `process`.

Adding them and reporting 163 would be wrong, and it is the tempting move
because both messages come from the same defect in the cases that led here.
Four distinct `erased value` sites, sampled:

    os/main.ts:306          model,                                    shorthand
    os/main.ts:428          return {                                  shorthand
    buffer/blob.ts:684      const source: BlobStreamSource<...> = ..  not
    node/validators.ts:243  const given = value ?? byDefault;         not

Two of four. So the second row is a ceiling on a fraction nobody has measured,
and it is written here as one rather than quietly summed into the first.

### How it was nearly filed as something else

It surfaced in `querystring`, at the module object node's own tests replace
methods on:

    export const QueryString = { unescapeBuffer, unescape, escape, stringify, parse, ... };

**Every name in that literal had also been refused further up**, through the
`decodeURIComponent` chain. So the reading that fits every available fact is a
cascade: the shorthand names something that never lowered, and the diagnostic is
clumsy but honest. That story would have sent the compiler lane to look at
refusal propagation.

A control naming a function refused nowhere still refuses. **A fixture with one
control tells you the defect is present; it takes a second to tell you what the
defect is.** Three fixtures were wrong in exactly that way on 2026-09-08 —
this one, `narrowed-shorthand-property` (filed as being about object literals
when it is about one spelling of them), and `refused-callback-null-vtable`
(reproducing the text on a binary where the defect was fixed).

## What one fix is worth: `AnyView` measured against all 22 modules

`arraybufferview-parameter` reproduces, and it is faithful — three NTS1001s,
every one from the fixture's own `src`, and a `hir` diagnostic cannot appear in
a correct compiler's output. It is a real defect. What had never been measured
is what removing it **buys**, and the answer changed the recommendation.

Primary NTS1001 refusals per module on `445ea94b`, split by whether the message
names `ArrayBufferView`:

| module | total | anyview | residual | | module | total | anyview | residual |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |
| punycode | 0 | 0 | **0** | | os | 86 | 5 | 81 |
| path | 33 | **0** | 33 | | process | 1990 | 54 | 1936 |
| async_hooks | 53 | **0** | 53 | | events | 1124 | 31 | 1093 |
| diagnostics_channel | 55 | **0** | 55 | | util | 1189 | 34 | 1155 |
| timers | 58 | **0** | 58 | | assert | 1210 | 34 | 1176 |
| buffer | 79 | 5 | 74 | | console | 1241 | 34 | 1207 |
| string_decoder | 83 | 9 | 74 | | readline | 1341 | 43 | 1298 |
| querystring | 85 | 5 | 80 | | net | 1508 | 42 | 1466 |
| url | 168 | 5 | 163 | | dgram | 1531 | 43 | 1488 |
| zlib | 1759 | 127 | 1632 | | stream | 1660 | 43 | 1617 |
| | | | | | http | 1964 | 43 | 1921 |
| | | | | | fs | 2107 | 64 | 2043 |

**No module reaches residual 0.** Four are `anyview = 0` exactly — `path`, and
all three of the NtsTask trio — and for those the conclusion is airtight in a way
reachability cannot weaken, because zero is zero. Elsewhere it is 2–7% of that
module's primary refusals. So the fix is worth making and is not worth
sequencing work behind, and those are different questions about the same fixture.

### It landed in `ac27dac4`, and the table held

Measured against the committed binary: builds and loads are unchanged, no module
went green, and the residual column is now simply the total. The prediction the
table made was the narrow one and it was right.

What the cone-wide table could **not** show, and what makes the change worth
having had, is the same fix measured against a module's *own* source:

    string_decoder, own-source refusals    445ea94b  4
                                           ac27dac4  1

Three of its four were `ArrayBufferView`. The survivor is `ArrayBuffer.isView`,
a different missing global. So over a whole cone this fix is 2–7% and moves
nothing; over the source of the module it was written for it is three of four.
**Both sentences are true and they are not interchangeable**, and the table above
was built to answer the first question while being quoted against the second.

`arraybufferview-parameter` is a guard now. One case did not survive the split:
a value narrowed to `AnyView` by excluding the other arm of a union with `typeof`
still cannot be read back, while `instanceof`, `=== undefined` and the plain
parameter all can. That is `blockers/anyview-readback-after-typeof`, and its
three controls are the content — without them the diagnostic reads as "AnyView
cannot be read back", which is false.

### The controls, which are the reason the table is publishable

A refusal count has been wrong here twice, so each of these was run rather than
reasoned:

- **Cascades are not counted**, and the evidence first given for that was
  worthless. It read "`NTS1003` is 0 for `path`, so the 33 are primary" — and
  **`nts hir` never emits `NTS1003` at all**. Zero for every module, always, so
  the check could not have failed. A control that cannot fail is not a control,
  and this one was published as one.

  The conclusion survives, on evidence that can fail: `hir` and `emit-c` agree
  exactly on the `NTS1001` count — `path` 31 and 31, `os` 80 and 80,
  `string_decoder` 74 and 74 — while `emit-c` additionally reports 51, 146 and
  152 cascade lines that `hir` does not. So `hir`'s count is the primaries, and
  the two tools disagreeing on `NTS1003` is what shows it rather than one tool
  reporting zero.
- **Lines are sites.** 33 lines are 33 *distinct* `file:line:col`, so no site is
  double-counted; the 17 distinct *messages* are a different and smaller number.
- **The instrument distinguishes silence from absence.** `punycode` reads
  `0 / 0 / 0`, and it is the one module that lowers completely. A frontend that
  never ran reads the same as a module with no refusals unless something
  separates them.

### What actually unblocks `path`

From `cascade-reach.mjs`, and it is not on the list above:

```
36  determineSpecificType        <- 36 of path's 53 cascaded functions
    unblocks 11 exports: basename dirname extname format isAbsolute join
                         matchesGlob normalize parse relative resolve
    errors.ts:70  `JSON.stringify`, a global member with no definition here
 6  inspectValueWithin           errors.ts:518   `length` of something without one
 3  parseInteger                 glob-matcher.ts:336 a conversion to number
 2  validateArray                validators.ts:94 `length` of something without one
```

`blockers/json-stringify` is filed and reproducing.

**Two things this does not say.** A cone counts what a refusal stopped *through
other functions*, so a function refused on its own account is in none of them and
the export counts are floors. And clearing the head of a cone can reveal the next
refusal in the same function — **a cone sizes a queue rather than a step.**
Eleven exports is the largest single move available on `path`, which is a
different claim from `path` going green.

## The last seven surface tests, and the four defects they found

Every module in the profile now pins its export surface against node's, taken
from a child `node -p`. The last seven — `dgram`, `util`, `net`, `http`,
`process`, `readline`, `fs` — went in on 2026-09-08 and found four defects on
their first run. **Node ships nothing that enumerates a module**, so none of
this could fail upstream and none of it was visible here.

| module | found |
| --- | --- |
| `http` | published `HTTPParser`, `checkInvalidHeaderChar`, `checkIsHttpToken`, `methods` — node has none of them — and had lost the names of `request` and `get` |
| `util` | `isArray` skipped `DEP0044` entirely |
| `process` | published a **binding** as public API, and carried five wrong names |
| `fs` | nothing. The first failure was the test's own bug |

### `process.getActiveResourcesInfo` was the binding

`getActiveResourcesInfo = nts_process_active_resources` assigned the binding
straight to the public field, so the exported function *was* the binding — its
identity is the stand-in's on the interpreted lane and the C function's on the
compiled one. It read:

    process.getActiveResourcesInfo.name === "resourcesAfterHarness"

which is the name of a **harness shim** in `bindings.node.mjs` that subtracts the
runner's own pipes from the resource count. The same aliasing once left
`os.freemem.name` empty and published 4 of `os`'s 23 names.

### What a function's name is compared against

Not the key it is filed under. That cost the `fs` test its first failure against
a correct module: `fs.FileReadStream.name` is `"ReadStream"` **on node too**,
because `FileReadStream` *is* `ReadStream` under a second key.

So the check reads node's `.name` for each key, and the aliases are pinned
separately — a check node's own tests could never need, because on node two keys
holding one object are the same object by construction. An artifact publishing
two distinct functions with the right names and the right behaviour passes
everything else and is still wrong: replacing one key would not change what the
other sees.

### Names that differ where ours is right

`process.chdir`, `cwd` and `umask` are internal wrappers on node, so node's names
are `wrappedChdir`, `wrappedCwd`, `wrappedUmask`. `_fatalException`, `setegid`,
`seteuid`, `setgid` and `setuid` are **anonymous** on node, assigned to members
where named evaluation does not apply. Ours are declarations with correct names,
and copying an accident of node's assignment would be making this code worse.
Each is pinned with its reason; an unpinned mismatch still fails.

That is the opposite direction from `http.get`, which was an arrow assigned to a
member and so had no name at all while node's did. There, matching node was the
fix. The two cases look identical in a diff of the test and are opposite in what
they ask for.

### What is pinned absent

`util` 8, `process` 28, `net` 2, `http` 1, `dgram` 1 — each with a reason rather
than a bucket, and `dgram`'s carrying the argument `shape.mjs` already made: a
throwing stand-in is a worse answer than no property, because a test checking for
it would see something that looks implemented. `readline` and `fs` pin the empty
list, which is the strongest form.

Every one of the seven fails under `--sabotage`.

## Reference counting types a global's save-temporary from the wrong side

`counted-lane.sh` covered all twenty building modules for the first time on
2026-09-08 — it had only ever run over nine, and the set moved under it when
eleven more started building. **Six of the twenty fail to build under counting**,
and five of them are one defect:

    static NtsObj_WritableLike * stdout = 0;      <- the binding
    NtsObj_StandardStream * v1506;                <- the save-temporary
    v1506 = stdout;                               <- error
    stdout = (NtsObj_WritableLike *)v1258;
    nts_release((NtsHeader *)v1506);

Counting inserts the temporary so the previous value can be released after the
store. It is the only construct that reads the binding back, and it takes the
type of the value being *stored* rather than of the storage being *read*.

**Five identical error texts are not automatically one bug**, so this was checked
rather than counted: `assert`, `console`, `fs`, `readline` and `util` each emit
`static NtsObj_WritableLike * stdout` with a narrower save-temporary. `process`
is the sixth and fails on something else — two globals colliding with C header
names, which is a known separate item.

`blockers/rc-widened-global-save` reproduces it in eleven lines, and the
uncounted build of that same program compiles with **zero** errors.

### The harness gained a form for it, and the control is mechanical

`emit-c --napi --rc ->` passes flags through. When a fixture names a flag, the
check now also builds *without* it and requires that build to be clean.

A fixture saying "this fails under `--rc`" makes two claims and the second is the
whole content. Asserting only the failure would hold equally well for a program
that does not compile at all — a different defect with a different owner. That
control was prose in the first draft, and **prose is not a control**.

Inverting the condition flips the fixture's verdict, so the branch is
load-bearing. It has not been shown to reject a real mis-attributed fixture,
because no program in this tree currently emits non-compiling C without `--rc`:
all five `fails-to-compile` fixtures went FIXED the same day. That is a good
state for the compiler and an untested state for the check, and they are worth
recording as two different facts.

## A declared type is a promise the wrapper does not enforce

The compiler trusts a parameter's declared type as a fact about every possible
caller — which it is, inside TypeScript, and which is the basis of
specialization. Through the Node-API wrapper it is a promise nothing checks:

    export function walk(rounds: 64): number   // sums 0..rounds

    nts    walk(2147483647) = 1073742848
    node   walk(2147483647) = 2305843005992468500

No error and no refusal. The emitted signature is `f64`, because an exported
function is a root and a root is a wall, so the wrapper takes a plain `double`;
the integer body is entered on a guard that asks only whether the argument is a
whole `int32`; and the accumulator inside was proven small from `[64, 64]`. Three
correct facts that are not correct together. The compiler lane's fixture is
`blockers/literal-parameter-trusted-past-the-boundary`.

**Inside TypeScript this caller cannot exist. Through our wrapper it can**, which
is what makes it ours to size.

### How much of this profile is exposed: five parameters, one of them numeric

`tooling/conformance/literal-params.py`:

| | count | numeric |
| --- | ---: | ---: |
| exported declarations (roots) | 5 | **1** |
| every signature, exported or not | 49 | **1** |

The one:

    runtime/node/readline/src/promises.ts:113
    export class Readline { … clearLine(dir: -1 | 0 | 1): this { … } }

`readline/promises` publishes `Readline`, so it is public API rather than an
internal helper. The other four are string or boolean literals —
`fs.validateOwnerId(name: "uid" | "gid")`,
`stream.getHighWaterMark(duplexKey: …)`, and two overload signatures of
`stream.isIterable`. **Numeric is the column that matters**: a broken string
literal mis-selects a branch, a broken numeric one silently returns a wrong
number.

**It is a class method, so it does not cross the boundary today.** It crosses
when the export-class arm lands, which means the reachable instance of this
unsoundness and the arm appear at the same moment.

Node's own tests cannot reach it either: `test-readline-promises-csi.mjs` passes
`-1`, `0` and `1` and nothing else. The differential harness sweeping values the
declared type forbids is the only reason it surfaced — and for a *root* that is
correct behaviour, not a bug in the harness. The type is a promise the boundary
does not yet enforce, so sweeping past it is the check that the promise is kept.

### The measurement was wrong twice first, in the direction that matters

The first version scanned comments and counted `export function walk(rounds: 64)`
out of the **prose of the fixture that raised the question** — a parser reporting
a population that included the documentation of the population.

The second missed class methods, which is where the only numeric case lives. It
would have answered **"four, none numeric"** — and none-numeric is precisely the
answer that makes enforcing the boundary look unnecessary.

So the script runs two passes that must agree on the numeric count and names
which one to distrust when they do not: the restricted one, because it is the
one holding a notion of "exported" that a parser can get wrong. That branch was
controlled by disabling the class-method regex, which reproduces the second
failure exactly.

## Three globals that do not collide with what everyone said they did

`process` fails to compile with 20 clang errors across three names, and the
whole profile carried them as *"globals colliding with C header names —
`version`, `platform`, `environment`"*. **None of the three collides with a C
header name.** Each is two **program** declarations colliding with each other, a
function against a variable:

    14304  NtsString * version(void);                     <- os.version()
    16555  static NtsString * version = 0;

    14307  NtsString * platform(void);                    <- os.platform()
    16570  static NtsString * platform = 0;

    14843  static NtsString * environment(NtsString *);   <- internal/color-depth.ts:21
    16428  static NtsObj_FileURLProvider * environment = 0;

The name came from a real `header` collision found the same day and generalised
to three cases that look similar and are not. That is how a wrong reading
survives: `version` and `platform` sit one namespace over from a genuine libc
collision, and the fix for the genuine one — the `access_` escape — does nothing
for these.

### The neighbours name the fix

    static NtsString * sep351 = 0;
    static NtsString * delimiter352 = 0;
    static NtsString * delimiter354 = 0;
    static NtsArray  * table358 = 0;
    static NtsString * version = 0;        <- no suffix

The module-scope variable namer **already disambiguates**, and already has a
suffix scheme. `version` got no suffix because its collision is with a function.
So this is not "add mangling"; it is "the two namers do not share a namespace",
which is smaller, more specific, and checkable by reading the emitter rather
than by guessing at inputs.

### A diagnosis without a reproduction, labelled as one

**Six attempts failed to reduce it**, every one the same way: the function half
emitted, the variable half was folded or stayed in SSA, and there was nothing
left to collide with. What was ruled out —

    let x: T | null                      with setter and getter
    const x: Record<string, string|undefined>       plain
    const x: Record<string, string|undefined>       re-exported under a second name
    readonly class field from a binding, one module-scope instance
    const x: number[]

— so whatever makes `process` emit a file-scope global is none of those.

No fixture was filed and the directory was deleted rather than left holding a
program that does not reproduce. The evidence is `process`'s own emitted C,
which builds and can be re-read at any time; it is the *reduction* that is
missing, and the two are worth distinguishing when handing work over.

## The counted lane's answer needs a control the lane does not run

Six of the twenty building modules failed to *build* under reference counting.
Five shared one defect (`blockers/rc-widened-global-save`), and with it fixed:

| module | counted | uncounted (control) |
| --- | --- | --- |
| `assert` | 0 passed, 12 failed, 1484 rc sites | 0 passed, 12 failed, 5 rc sites |
| `console` | 0 passed, 19 failed, 1542 rc sites | 0 passed, 19 failed, 5 rc sites |
| `readline` | 0 passed, 26 failed, 1746 rc sites | 0 passed, 26 failed, 5 rc sites |
| `util` | 0 passed, 25 failed, 1507 rc sites | 0 passed, 25 failed, 5 rc sites |

Identical on both sides, with ~1500 retain/release sites in one and 5 in the
other. **The allocator sees no defect these tests can reach**, and the `0 passed`
is the export-table story rather than a counting one — it is the same number
uncounted.

**The right-hand column is not produced by `counted-lane.sh`.** Its "pass" means
the module built and its tests ran, and the comparison that makes a row mean
anything — *the same, counted and uncounted* — has to be run separately. Read
without it, those four rows say `0 passed` and look like a finding.

## What `string_decoder` needs beyond the class arm

Zero own-source refusals, and two wrapper declines left. Five of its six files
must pass; one is not-applicable.

Four of the five — `split-sequences-static.js`, `export-surface-static.js`, and
node's `-end` and `-fuzz` — use only `write` and `end`, and the export-class arm
settles them. The fifth is `core-static.js`, which reads the instance internals:

    assert(decoder.lastChar.equals(new Uint8Array([0xe1, 0, 0, 0])));
    assert.strictEqual(decoder.lastNeed, 2);
    assert.strictEqual(decoder.lastTotal, 3);

Checked against node rather than assumed, since over-asserting in our own test
would be our own fault: node exposes all three as **prototype accessors**, and
`lastChar` is a **Buffer** — `<Buffer e1 00 00 00>`, with `.equals` a function.
The assertions match node's behaviour, so the bar is right.

Which makes green require the class arm **plus** three accessors crossing the
boundary **plus** `lastChar` arriving as something that answers `.equals`; ours
is `managed<view<u8>>` in the IR. Node ships nothing that reads those three, so
without this file the module would report 5 of 5 on the class arm alone.

If accessors are out of scope for a pass, the file stays as it is and the module
reports **4 of 5 with the reason named**. A green row bought by dropping the only
test that reads the accessors is not a green module.

## Five modules whose cascade counts are suspect until re-measured

The compiler lane found a lowering bug on 2026-09-09: a constructor call was
named from the **source text of the identifier**, so a class whose name is
declared in two files was called as `Frame#constructor` while its definition was
`Frame@parse#constructor`. The caller was then dropped as "calls something
refused" — **with no refusal anywhere**. A cascade with no root at the bottom of
it.

`runtime/node` declares 290 classes and four names twice:

| name | declared in | one program? |
| --- | --- | --- |
| `Socket` | `dgram/src/main.ts`, `net/src/main.ts` | yes — `dgram` links `net` |
| `Server` | `http/src/server.ts`, `net/src/main.ts` | yes — `http` links `net` |
| `Interface` | `readline/src/interface.ts`, `readline/src/promises.ts` | yes — one module |
| `DrainWaiter` | `stream/src/iter/broadcast.ts`, `stream/src/iter/classic.ts` | yes — one module |

Every pair lands in a single program, which is the condition. So **`dgram`,
`net`, `http`, `readline` and `stream` may each carry fictional cascades**, and
any conclusion drawn from what they do *not* reach is suspect until re-measured
against a binary carrying the fix.

The one that matters most here is `dgram`. Its native half is complete, and the
reading that only two of its twenty-one bindings are reached — and that
`createSocket` is stopped by its own refusals — rests on which functions were
dropped. `Socket` is one of the two duplicated names, and `dgram.createSocket`
returns a `Socket`. If that cascade was fictional, `dgram` is closer than it
measured.

**Re-measure before quoting any of it**: `dgram` and `net` own-source refusals,
what `cascade-reach.mjs` says about `createSocket`, and the export tables of all
five.

## The native half is complete, and it bought nothing on the axis

**331 declared bindings, none without C**, as of 2026-09-09. `nm -D` on every
artifact the floor builds finds no undefined `nts_` symbol at all, and
`build-floor.sh`'s pinned set is empty — it held seventeen names that morning.

    dgram    21 of 21     the directory held no .c at all
    net      30 of 30     net.c was eleven lines holding two option defaults
    fs       71 of 71     the entire async surface, plus the watchers
    process   9 of 9      with assert's one
    internal  4 of 4

The last to go was `nts_async_context_get`, unwritable until the
return-position escape landed: its prototype named a per-program struct no
shared translation unit could spell. Thirteen modules carried it, each loading
and waiting to abort on first call.

**And the axis did not move.** Measured against the rebuilt artifacts:

    punycode    3 files, 3 passed, 0 failed
    path       22 files, 2 passed
    every other building module   0 passed

`dgram` is 0 of 110 with all 21 of its bindings defined — `createSocket is not
a function`, because its own refusals stop the module. This is the sharpest
version of *necessary and not sufficient* the axis has produced, and it is worth
stating plainly rather than letting "native half complete" read as progress.

What it did buy is permanent: thirteen modules no longer carry a latent
abort-on-first-call, and no module's compiled artifact can now fail for want of
a definition.

## The native half, and what finishing it did not buy

Written 2026-09-09: `dgram` 21 of 21, `net` 30 of 30, `process` and `assert`
9 of 9, `internal` 4 of 4. `runtime/node/dgram/` and `runtime/node/net/` had no
usable `.c` at all — `net.c` was eleven lines holding two option defaults.

**It was found by reading the artifacts, not the source.** `nm -D` on the built
addons said thirteen of the twenty were carrying undefined `nts_` bindings while
`build-floor.sh` reported every one as "builds and loads". A shared object binds
lazily, so an undefined function symbol is not an error until something calls
it: they initialised and would have aborted on first call. `punycode` was the
only one with none, and the only one that passes.

Rebuilt after: `net`, `http` and `dgram` went from 10, 10 and 14 undefined to
**one** each, and that one was `nts_async_context_get` — which could not be
written until the return-position escape landed, and is written now.

**And it bought no passing tests.** `dgram` measured **0 of 110** with all 21 of
its bindings defined: `createSocket is not a function`, because its own
thirteen refusals stop the module. Necessary and not sufficient, which is the
half of that sentence worth keeping.

### Three bindings that do less than their names

`nts_process_on_before_exit` and `nts_process_on_exit` retain their callback and
never call it. Both events are decisions of whoever owns the loop, and an addon
is loaded into a running Node process whose loop it does not start, drain or
end. `atexit` is not the point either: it runs after the runtime is torn down,
so calling a compiled closure from it reaches into a heap that is gone — a crash
on the way out in place of a missing event.

`nts_process_active_handles` and `_active_requests` answer empty. Node hands back
the handle *objects*; a compiled program's `Socket` is one of its own objects and
`uv_handle_t` has no back pointer to it. `uv_walk` gives handles, not owners.
`nts_process_active_resources` is the part that can be answered, because a
**name** survives the crossing where an object does not.

`nts_on_collected` registers nothing. This runtime has no weak reference and no
finalization primitive at all, so a `destroy` hook does not fire for a resource
it owns. **No fixture** — it needs a runtime primitive rather than a binding, so
there is no program that reproduces it, only an absence.

## `os` regressed out of the floor, and the first bisect was four copies of one run

`os` was 17 of 23 exports and the second-closest module. It no longer compiles:

    program.c:1982  error: conflicting types for 'nts_os_cpus'
                    emitted:  NtsObj_Tuple1416 *
                    os.h:25:  NtsArray *

`nts_os_cpus(): [string[], number[]]` is a heterogeneous tuple, which is
`blockers/heterogeneous-tuple-return` reaching a real module. Bisected:
`445ea94b` builds it, `fc0df644` does not.

**Three bindings have that shape and only one conflicts today**, because only one
is reached — `nts_os_network_interfaces` and `nts_os_constants` are behind
refusals and will produce the identical conflict when their callers lower.
`nts_os_user_info` and `nts_os_loadavg` are homogeneous and emit `NtsArray *`,
which agrees with `os.c`.

### The bisect that said the opposite

The first run of it built `os` with four older pinned binaries and reported that
every one failed — so the regression was not the compiler's. **All four had used
the same live binary.** `tooling/conformance/build.sh` read only
`NTS_COMPILER` and fell back to `target/release/nts`, so
`NTS_BIN=<pin> build.sh <module>` was silently unpinned. `build-floor.sh` accepts
either and passes `NTS_COMPILER` down, so floor runs were always pinned; only
direct calls were affected.

It honours both now, controlled after the change rather than declared. **A pin
that is silently ignored is worse than no pin: it produces a control that looks
run and is not**, and four copies of one measurement look like agreement.

## The counted lane over all twenty-two, with its control

Re-run once `fs`, `process` and `os` started building: **22 rows, 0 differing.**
Every module behaves identically counted and uncounted, with between 26 and
2,157 retain/release sites against a handful uncounted. The allocator sees no
defect these tests can reach.

`punycode`'s row had to be measured twice. The first read four files instead of
three, because a probe for the hollow lane went into `punycode/test` **while
this was running** — the same mistake as editing a script mid-execution, in
different clothes. Clean: `3 files, 3 passed, 0 failed, 55 rc sites`, identical
in both columns.

## The counted lane over every building module, with its control

`tooling/conformance/counted-vs-uncounted.sh`, 2026-09-09:

    identical counted and uncounted : 19
    differing                       : 0
    did not build either side       : 3   (fs, os, process)
    retain/release sites, counted   : 17,652

**Nineteen modules behave identically under reference counting**, with between
26 and 1,784 retain/release sites each against a handful uncounted. The
allocator sees no defect these tests can reach. Zero differing rows is the
result; it is not a blank.

The right-hand column is the whole point and `counted-lane.sh` does not produce
it. Its "pass" means *the module built and its tests ran*, so its rows read
`0 passed, 12 failed` — which looks like a defect in reference counting and is
the export table's doing, identical on both sides. Four rows said exactly that
earlier in the day and said nothing else.

The comparison was controlled by inverting it: `punycode` flags and the run
reports one differing; restored, none. A comparison never seen to fire is a
claim about agreement rather than a measurement of it.

### The summary line was mangled, and by me

The run printed all twenty-two rows and then died on a syntax error in its own
last `echo`. Nothing was wrong with the script: **it was edited while it was
running.** Bash reads a script incrementally from a byte offset, so an insertion
near the top shifts everything after it and the interpreter resumes mid-token.

The edit was adding a comment recording that the comparison had been controlled
— which makes it the second mistake in one sequence, the first being a commit
whose message described a note the failed edit never wrote. A claim about a
control that lives only in a commit message is one `git log` away from being
lost.

The data survived because every row is printed as it completes and only the
trailing summary was in the shifted region. That is luck rather than design, and
the totals above were recomputed from the rows rather than read off a line the
script never got to print.

## The wrapper enforces a declared type where node does not, and it costs a test

`path.posix.toNamespacedPath` is a no-op on POSIX. Node's implementation is the
whole of `return path;`, with no validation, and node's own test asserts that:

    assert.strictEqual(path.posix.toNamespacedPath(null), null);
    assert.strictEqual(path.posix.toNamespacedPath(true), true);

Ours is typed the way node's own `.d.ts` types it —
`toNamespacedPath(path: string): string` — and the emitted wrapper enforces
that:

    if (!nts_napi_expect(env, nts_from_napi_string(env, argv[0], &a0),
                         "expected a string argument")) goto nts_napi_cleanup;

So the compiled module **throws for the two arguments the test checks**, while
the interpreted lane passes — by type erasure, since `path: string` disappears
and the body returns whatever it was handed. `test-path-makelong.js` is the only
failure in `path` that is not a missing export, and it is this.

### It is the mirror of the literal-parameter unsoundness

That one is the wrapper **not** enforcing a declared fact: `walk(rounds: 64)`
called with `2147483647` enters an integer body proven small from `[64, 64]` and
answers a wrong number. This one is the wrapper **enforcing** a declared type
that node's runtime does not. Both come from the same gap between what a
signature says and what node does, and they fail in opposite directions —
silently wrong, and loudly wrong.

That matters for the fix under consideration on the compiler side, which is to
have the wrapper enforce declared facts. Enforcement is right and it is not
free: it makes the profile disagree with node exactly where node's own types are
narrower than its behaviour.

### Not fixable from this side

Widening the declaration is the obvious move and it is worse. Measured:

    export function narrow(value: string): string   -> published
    export function wide(value: unknown): unknown   -> no wrapper for wide:
                                                       returns unknown

`unknown` in return position has no wrapper at all, so matching node's leniency
in the type costs the export entirely — one failing assertion becomes a missing
function and every other test of it fails too.

So this is filed as a diagnosis rather than a fixture. There is nothing to
reproduce in isolation: the wrapper's check is correct in general and the
divergence only exists against a specific node API whose runtime is more
permissive than its published type.

## What crosses the wrapper, measured in both directions

**Inward, four types: `number`, `string`, `boolean`, `number[]`.** Fourteen
functions, one parameter each, differing in nothing else
(`blockers/parameter-boundary-carries-four-types`):

    number        ok        Uint8Array     takes TypedArray, outward only
    string        ok        Uint8Array[]   takes TypedArray[]
    boolean       ok        Row            takes an object, outward only
    number[]      ok        Row[]          takes an object[]
                            string[]       takes string[]
                            boolean[]      takes bool[]
                            v?: number     takes unknown
                            number|string  takes unknown

**Outward, `number[]` is the only array**
(`blockers/array-return-only-carries-numbers`). A single object crosses out; an
array of them does not.

Two consequences worth having in one place.

`Uint8Array` crosses **outward only**, so `StringDecoder#write(buf)` cannot be
called even once the class publishes and its accessors work. That is a fourth
requirement on the module beside the class arm, the accessors and `lastChar`
answering `.equals` — and it was on nobody's list.

`v?: number` declines as **`takes unknown`**, identically to a genuine
`unknown`. An optional number is the shape node uses everywhere:
`timers.setTimeout(after?: number)`, `fs.cp(suppliedCallback?: Callback)`.

### The populations, and how far to trust them

    71 signatures      return an array whose element is not a number
   ~335 functions      take at least one parameter that cannot cross
    66 signatures      return a view in return position (view-returns.py)

The first and third are counted from a return annotation and are firm. **The
middle one is a characterisation and not a count**: the classifier reads any
capitalised annotation as an object, and some are aliases for unions or views,
so the split between categories moves while the total does not. The view-return
figure went 99 → 104 → 66 across three refinements, which is the reason to
label the uncertainty rather than let the number be quoted as exact.

## Four roots stand between `string_decoder` and the axis, and it owns none of them

Measured 2026-09-09 with `tooling/conformance/own-refusals.sh` and a compiler
copied to a scratch path. Root refusals only -- NTS1001. NTS1003 is cascade: of
`querystring`'s 151, 149 say "calls X, which was refused above", so counting
them measures how far a root travels rather than how many roots there are.

| module | own | cone | buffer | internal |
| --- | --- | --- | --- | --- |
| `punycode` | 0 | 0 | - | - |
| `string_decoder` | 0 | 74 | 43 | 31 |
| `querystring` | 3 | 78 | 43 | 32 |
| `os` | 4 | 80 | 44 | 32 |
| `path` | 6 | 31 | - | 25 |
| `buffer` | 43 | 74 | - | - |
| `fs` | 214 | 2082 | - | - |
| `stream` | 472 | 1660 | - | - |

`punycode` is the only module with an empty cone, and it is the only module on
the axis. That is one observation, not a law, but it is the shape the rest of
this section explains.

**A cone-wide count is not a per-module one.** `string_decoder` reports 74 and
owns nothing. Every refusal standing between it and a published export belongs
to something it imports, and `path` is the control that makes this legible: it
does not import `buffer`, and its cone is 25 rather than 74.

### The chain, one link at a time

`emit-c --napi` ends with `no wrapper for StringDecoder: is a class whose
constructor was not compiled`, which is why the addon publishes **zero** exports
and every one of node's tests fails on an absent class. Four roots produce that:

| root | at | reaches |
| --- | --- | --- |
| `` `toString` on a number `` | `buffer/src/encodings.ts:279` | `decodeIn` → `Buffer#toString` → six `StringDecoder` methods |
| `` an `instanceof` against something this compiler has no class for `` | `buffer/src/main.ts:194` | `objectToBuffer` → `Buffer.from` → `bytesOf` |
| `` `JSON.stringify`, a global member with no definition here `` | `internal/errors.ts:70` | `determineSpecificType` → `ERR_INVALID_ARG_TYPE#constructor` → `StringDecoder#write` → `#end` |
| `` `length` of something without one `` | `internal/errors.ts:518` | `inspectValueWithin` → `inspectValue` → `ERR_UNKNOWN_ENCODING#constructor` → `StringDecoder#constructor` |

The first three were already filed: `number-tostring-radix`,
`instanceof-no-class`, `json-stringify`. The fourth is new and is
`length-after-array-isarray` -- `Array.isArray` narrows an `unknown` to `any[]`,
which has no layout, so the `.length` the narrowing existed to reach is refused.
It is the one that matters most, because it is the link that lands on the
*constructor* and so decides whether the class exists at all.

**The fourth root was wrong on the first pass.** The cascade line for
`inspectValue` truncates at "calls \`inspectValu..." in a terminal, and the next
NTS1001 after `inspectValue`'s own line 558 is at 640 -- which is inside a
different class further down the file, reporting `map` on a typed array. Reading
the chain link by link instead of pattern-matching the nearest line number gave
`length`. A fixture filed on the first answer would have reproduced a real
refusal that blocks nothing here.

### Seven of `buffer`'s forty-three are one form

`constructor-overload-signatures`: bodiless overload signatures, four on
`Buffer` and four on `Blob`. `new Buffer(size)` and `new Buffer(str, enc)` are
genuinely different calls, so there is no spelling of those classes that is both
correct and free of the form. The fixture's overloads differ in arity rather
than in type deliberately -- the obvious `number | string` spelling refuses a
second time for an unrepresentable union, and a fixture with two causes cannot
say which one a fix addressed.

**One filing was withdrawn.** Seven more of buffer's roots read "a value of type
BigInt where `unknown` is expected", all on `checkedBigIntWrite(this, value,
...)`. Four probes failed to reproduce it: a bigint literal into an `unknown`
parameter, a `bigint`-typed parameter into one, the same call from a method of a
class extending `Uint8Array` with buffer's own literal bounds, and a narrowed
bigint into a constructor argument typed `unknown`. All four lower cleanly, and
both tsconfigs extend the same base, so it is not a compiler-option difference.
The fixture was deleted rather than kept as a near-miss. What is ruled out is
recorded here; the cause is still unknown.

## `path` moved, and the widest remaining root is the one filed tonight

The `instanceof` family completing let `validateString` compile. `path` went
from 4 published exports to 10 -- later 12, once a rest parameter crossed --
`normalize`, `isAbsolute`, `relative`,
`dirname`, `basename`, `extname` joined the four that were there, none bound to
`undefined`. Wrapper declines 13 to 7, cone roots 28 to 27, compiled lane 2
passed to 3.

**The new pass is real.** `test-path-posix-relative-on-windows.js` fails under
`--mutate-addon` and under `--empty-exports`; the two survivors are the presence
checks that were already there. Behaviour-dependent passes across the profile go
from six to seven. `path` is 3 of 21, so the axis is still 1 of 22.

Where `path` stops now: a rest parameter on `resolve` and `join` (filed tonight
as `rest-parameter-at-the-wrapper` -- it lowers and does not cross), an object
parameter on `format`, an object return on `parse`, `matchesGlob` behind
glob-matcher's own six roots, and the two namespaces.

### The counted lane on the two that changed

The full twenty-two-row table above was derived against the previous compiler.
Only `path` and `net` changed surface, so only those two were re-derived rather
than spending an hour confirming twenty that did not move:

```
path  22  3 passed, 18 failed, 1 skipped  [434 rc]  identical
net  179  0 passed, 148 failed, 7 skipped [2017 rc]  identical
```

`path`'s refcount traffic went from 70 to 434. That is the useful half: the pair
being identical could mean the allocator saw nothing, and a sixfold rise says the
eleven newly-compiled functions are running under counting rather than the row
having gone quiet.

`net` is 0 passed with one more export than before, which is the correct
outcome. `setDefaultAutoSelectFamily` being published does not make a test pass,
and a count that moved on it would have meant something was wrong.

### The whole surface, rebuilt on the same compiler

All twenty-two addons rebuilt against the compiler carrying tonight's fixes, and
their published surfaces read against the counts from earlier in the evening:

```
net    2 -> 3   gained setDefaultAutoSelectFamily
path   4 -> 10
                the other twenty are unchanged
names bound to undefined, across all twenty-two: 0
```

Two modules moved and twenty did not, which is the useful shape: `validateString`
compiling is not a general unblocking, it is `path`'s eleven functions and one of
`net`'s. Everything else is behind a different root.

The zero in the last line is `METHODS` and `methods` staying gone. It is checked
across the whole profile rather than in `http` alone, because the defect was a
value-export path publishing a global whose initializer had been excised, and
nothing about that was specific to `http`.

### A frequency table over cones cannot rank roots, and here is why

The obvious way to find the highest-leverage root is to count how many modules
each one appears in. Done across the four nearest -- `string_decoder`,
`querystring`, `os`, `path` -- it returns twelve roots tied at four of four:

```
4  `X` on a union, whose members lay their fields out differently
4  `X` on a typed array
4  `X` on a number
4  indexing an array of any
4  a regular expression literal
4  an `instanceof` against something this compiler has no class for
...
```

Every one of them appears in every cone, because all four modules import
`internal/`, and `internal/errors.ts` alone carries most of these forms. The
table ranks nothing.

**Which is the cone-versus-module rule wearing different clothes.** A count over
cones tells you what `internal/` contains; it cannot tell you what any module is
*waiting on*, because a root in a cone may sit under a function nothing calls.
`indexing an array of any` and `a regular expression literal` are tied at four
of four here, and only the first one is between `string_decoder` and a
constructor.

The ranking that worked was following each blocked export to its own root, one
cascade line at a time -- slower, one module at a time, and the only method that
distinguished `errors.ts:533` from eleven roots with identical coverage.

### `url` and `buffer` traced, and four more forms had no fixture

```
buffer   43 own, 70 cone, 12 declines, publishes 3
url      40 own, 147 cone, 14 declines, publishes 0
```

`buffer`'s twelve: `isUtf8` and `isAscii` take `unknown`; `Blob` and `File` are
classes without constructors; `Buffer`, `default` and `constants` are export
forms; `SlowBuffer` waits on `Buffer.allocUnsafeSlow`, `transcode` on `decodeIn`
-- which is `toString` on a number again -- and `atob`/`btoa` on the walk
diagnosis above.

`url`'s fourteen: ten functions never compiled, three classes without
constructors (`URL`, `URLSearchParams`, `Url`), one `takes unknown`. Its cone
fell 155 to 147 on tonight's fixes; its own forty did not move.

Two of `url`'s own forms were the largest in the module and neither was filed:

**`rest-parameter-of-unrepresentable-elements`**, nine of forty, and
`async_hooks` reports it first as well. A rest parameter lowers when its
elements have a representation:

```ts
append(...given: [] | [name: string] | [name: string, value: string]): void
```

is `searchparams.ts:287`, and a union of tuples has no single element type to
lay out. Distinct from `rest-parameter-at-the-wrapper`, where the parameter
lowers and the wrapper declines it -- this one never reaches the wrapper.

**`in-with-a-computed-key`**, seven of forty. `"a" in row` lowers, `key in row`
does not. The same representation decision as `computed-member-read` and
`-write`, through a third operator, filed separately because a fix for member
access need not carry `in`.

Its control had to build its own object rather than take one: an object
*parameter* draws `takes an object, which crosses outward only`, which would
have left the control declined for a reason with nothing to do with `in`. That
is the fourth failure mode from this document's own rules -- a control that
fails for its own reason says nothing about the subject.

### A named "declaration outside every walk", handed over unreproduced

`buffer` declines twelve exports. Two of them, `atob` and `btoa`, are refused
with

```
main.ts:1877:32  NTS1001 `atob`, a declaration outside every walk
main.ts:1923:53  NTS1001 `btoa`, a declaration outside every walk
```

and the same form at `os/src/main.ts:395` is what holds `userInfoString` and
through it `os.userInfo`. So it costs three exports across two modules.

**The reported location is not the declaration.** `main.ts:1877` is
`code === 0x0d || code === 0x20;`, inside `isBase64Whitespace`; `atob` is
declared at 1881. The diagnostic carries the right name and a span pointing
into a different function, which is the second time tonight a location has been
unreliable for this kind of message -- `EventEmitter#emit`'s root reported at a
line holding a JSDoc comment.

**Not filed, because it did not reproduce.** The obvious hypothesis was that the
walk starts somewhere and never reaches a function nothing calls. A module with
one unreferenced exported function, one helper, and one exported function that
uses the helper lowers cleanly and publishes both -- no refusal of any kind. So
"exported but unreferenced" is ruled out.

What is left unexplored: both real sites call a refused constructor
(`ERR_INVALID_ARG_TYPE`), so the form may be a *secondary* effect of a cascade
rather than a cause -- the declaration losing its place once its body is
refused. That would make it a diagnostic-quality problem rather than a blocker,
and would explain why an isolated reproduction fails. `class-expression` covers
the anonymous variant (`an anonymous declaration outside every walk`) and is a
different thing: there the declaration genuinely has no name to place.

Handed over as a diagnosis with what was ruled out, rather than as a fixture
that reproduces something else.

### `querystring` is 0 of 8, and every one of its eight declines is filed

```
QueryString     is not a function this backend can name   export-object-shorthand
escape          <- hexTable's initializer <- a closure <- `toString` on a number
parse           <- addKeyVal <- `key`, which ParsedUrlQuery does not declare
unescapeBuffer  <- Buffer#slice
decode, encode, stringify, unescape   the same three own roots
```

Own roots, unchanged at three: `decodeURIComponent` (`missing-builtin`) at
`main.ts:110`, and the computed-member pair at `:189` and `:248`.

**`hexTable` is worth its own line.** It is `internal/querystring.ts:9`, an IIFE
building `%00`…`%FF` once:

```ts
export const hexTable: string[] = (() => {
  const table = new Array<string>(256);
  for (let i = 0; i < 256; ++i) {
    table[i] = `%${((i < 16 ? "0" : "") + i.toString(16)).toUpperCase()}`;
```

`i.toString(16)` is `toString` on a number, which is `number-tostring-radix` --
the same root as `buffer/src/encodings.ts:279`, where `byte.toString(16)` holds
`decodeIn` and through it `Buffer#toString` and six `StringDecoder` methods. One
expression, two modules, and in this one it reaches `escape` through a refused
closure and a lost initializer.

So `querystring` needs five things and has a fixture for each: the
object-literal export form, `number-tostring-radix`, `computed-member-read`,
`computed-member-write`, and `missing-builtin`. Nothing here is undiagnosed.

### `string_decoder` is 0 of 5, and all five say the same thing

```
test-string-decoder-end.js     SD is not a constructor
test-string-decoder-fuzz.js    StringDecoder is not a constructor
local/core-static.js           StringDecoder is not a constructor
local/export-surface-static.js typeof StringDecoder: 'undefined', expected 'function'
local/split-sequences-static.js THROW:TypeError on the first case
```

Not four of five, not nearly anything. Zero, with one reason: the class has no
constructor, because `ERR_UNKNOWN_ENCODING#constructor` calls `inspectValue`
which calls `inspectValueWithin`, refused at `errors.ts:533` for `indexing an
array of any`. `core-static.js` is untouched and stays untouched; the bar it
sets is node's.

**Two tests were reporting less than they knew.** `split-sequences-static.js`
and `fs/test/encoding-aliases-static.js` recorded a throw as
`THROW:${error.code ?? "?"}`, so any error without a `code` -- every plain
`TypeError` -- arrived as `THROW:?`. `path/test/edge-inputs-static.js` had the
better form all along, `error.code ?? error.constructor.name`, which is why its
66 divergences could be read as 26 `ERR_MISSING_ARGS` and 26 `TypeError` rather
than 66 question marks. Both now use it. Interpreted lane unchanged: both still
pass.

That is the third instrument this evening that knew more than it said, after the
lowering that names one refused class per function and the assertion loop that
stops at the first mismatch.

### The pass count did not move and the module did

A rest parameter crosses now. `path` publishes 12:

```
resolve  normalize  isAbsolute  join  relative  _makeLong
toNamespacedPath  dirname  basename  extname  delimiter  sep
```

`join` and `resolve` are the two a caller reaches for first. None of the twelve
is bound to `undefined`.

**The compiled lane reads 3 passed, 18 failed. It read 3 passed, 18 failed
before.** Every test that exercises `join` or `resolve` also dereferences
`path.win32`, which is still undefined, so not one file changed state.

The edge table saw it:

```
before  66 of 183 diverge   basename 26, parse 26, join 11, format 2, resolve 1
after   54 of 183 diverge   basename 26, parse 26, format 2
```

`join`'s eleven cases and `resolve`'s one are gone -- they cross *and* they
compute node's answers. 129 of 183 match now, up from 117.

That is the whole argument for the change made to this file a few hours
earlier. Asserting inside the comparison loop gave one line; the pass count
gives one bit; and both would have reported this fix as nothing happening. A
module can improve by twelve behaviours while every count that is watched stays
still.

### Nothing that crosses answers wrongly

Swept every module that publishes anything, reading the *reason* each local test
failed rather than the count:

```
os        os.constants is undefined                       absence
readline  readline.createInterface is not a function      absence
net       BlockList is not a constructor                  absence
util      util.format is not a function                   absence
timers    setTimeout is not a function                    absence
buffer    Blob is not a constructor                       absence
http      Class extends value undefined                   absence
path      66 divergences, every one a wrapper blocker     absence
punycode  none                                            --
```

**Every failure is something not being there.** Not one is a function that
crossed and returned a wrong answer. `os`'s `constants-signals-static.js` looked
like a value mismatch -- "Expected values to be strictly equal, + 'undefined' -
'object'" -- and is `typeof os.constants` against `"object"`, so it is the same
absent export wearing a comparison. `timers`' "fn was called 0 times" is the
shape that usually arrives far from its cause, and here it is `setTimeout`
missing two lines up.

Scoped to what was measured: the local static tests across those nine modules,
plus `path`'s 183-case edge table against node. It does not cover every one of
node's pinned tests, and a wrong answer could still be sitting behind an absence
that fails first -- which is exactly what masked the typed-array count.

What it does say is that the compiled axis has an absence problem and not,
so far, a correctness problem. That is worth knowing before anyone reads "0
passed, 410 failed" as 410 things computing the wrong answer.

### The six functions that started crossing are correct, and one test was hiding it

`path/test/edge-inputs-static.js` compares 183 edge cases against node. It
asserted inside its comparison loop, so it stopped at the first mismatch --
`basename("")`, case 2 of 183 -- and reported one line about six functions whose
other 180 results had already been computed. It now collects every divergence
and summarises by operation before listing them, because a 66-line list is
truncated in the harness output and 66 lines nobody sees is the same one-bit
signal in a longer form.

The bar is unchanged: any divergence still fails the file.

```
operation    cases  diverging
dirname         26      0   all match
extname         26      0   all match
isAbsolute      26      0   all match
normalize       26      0   all match
relative        11      0   all match
basename        28     26
parse           26     26
join            11     11
format           2      2
resolve          1      1
```

**117 of 183 match, and every one of the 66 divergences is a filed wrapper
blocker.** *Superseded later the same evening: once a rest parameter crossed,
`join`'s eleven and `resolve`'s one went, leaving 54 divergences and 129
matches. The table above is the earlier state and is kept because the reasoning
about which controls the two `basename` matches provide is what identified the
optional-parameter blocker.*

`parse` returns an object, `join` and `resolve` take rest parameters,
`format` takes an object, and `basename` diverges on exactly the 26 cases that
call it with one argument -- the two that match are `basename("a/b.txt",
".txt")` and `basename("a/.txt", ".txt")`, the only two-argument calls in the
table.

That is the optional-parameter diagnosis confirmed from the other side: the
function computes node's answer whenever it is allowed to run, and throws
whenever the optional argument is omitted.

And it is the first behavioural evidence that the functions which started
crossing this evening are right. Five of the six match node on every case they
are given -- 115 cases across `dirname`, `extname`, `isAbsolute`, `normalize`
and `relative` -- which no lane could say while one early assertion was stopping
the comparison.

**Swept for a second instance and there is not one yet.** Nineteen local tests
assert inside an indexed loop, which is the same shape. It costs signal only
where the module's functions actually run, and today that is `path` and
`punycode`, which passes everything it is given. The others fail before the
loop: `async_hooks/test/providers-static.js` dies on
`Object.keys(undefined)` for a missing export, not on a comparison. So the
nineteen were left alone rather than rewritten -- the pattern will start costing
signal as each module's exports arrive, and rewriting a test whose module
publishes nothing is churn that cannot be checked.

### "66 signatures in nine modules" cannot be re-derived, because it never said what it counted

The typed-array gap is carried in this profile's standing description as "66
signatures in nine modules". Attempting to re-derive it produces a different
answer for every population you pick:

| population | signatures | modules |
| --- | --- | --- |
| exported free functions naming a typed array | 54 | 7 |
| the same, plus class and object methods | 116 | 12 |
| the carried figure | 66 | 9 |
| visible as `takes TypedArray` wrapper declines | 0 | 0 |

66 sits between the two defensible counts and matches neither. Without the
population it was taken over -- exported surface only? everything reachable at
the boundary? methods included? -- it cannot be reproduced, and a number that
cannot be reproduced cannot be watched for movement.

The zero at the bottom is the masking already described: those functions do not
reach the wrapper, so the one lane that would name them says nothing.

**Both new counts needed a correction before they were even that good.** The
first pass reported 53 free functions. It reused one global `RegExp` across
every module without resetting `lastIndex`, so the scan for each module began
wherever the previous module's had stopped and the first match in each file was
skipped. 53 became 54 when the regex was reset per module. The rule this
document already carries is to say which lane a number is from and what it
counts; the other half is that a number is only as good as the traversal that
produced it, and a stateful matcher is a traversal with a memory.

### No local test exists without running, checked rather than assumed

A test file that exists and never runs reads as coverage in every count while
measuring nothing -- the same shape as a vacuous pass, one level out. So it was
checked.

Local discovery in `run.mjs` is `readdirSync(localDir).filter(f =>
f.endsWith(".js"))`, unfiltered otherwise, so no `.js` file in a module's `test/`
directory can be missed. Confirmed against four modules by counting files on
disk against files the harness reported: `punycode` 2 and 2, `os` 5 and 5,
`path` 5 and 5, `string_decoder` 3 and 3.

The gap that discovery *could* have is a test written with another extension.
There are five non-`.js` files across every `test/` directory: four C tests --
`fs/test/bytes.c`, `internal/test/utf8.c`, `timers/test/host.c`,
`zlib/test/bytes.c` -- which `sweep.mjs` already reports as "module C: 4
file(s)", and one `.cjs` inside `process/test/fixtures/`, which is a fixture a
test spawns rather than a test.

179 local `.js` tests, all discovered; 4 C tests, all known to the sweep; 1
fixture correctly excluded. Nothing is written and unrun.

### Every module's compiled lane, measured rather than inferred

All twenty-two run against their own addon on the current pin, addons rebuilt
after the entry change:

```
punycode              3p    0f     <- the only module with no failures, and
                                      its surface is exactly node's
os                    4p    5f
path                  3p   18f
stream                2p  248f
util                  1p   24f
timers                1p   55f
fs                    1p  344f
assert 0p 12f   async_hooks 0p 116f   buffer 0p 55f   console 0p 19f
dgram 0p 77f    diagnostics_channel 0p 33f   events 0p 32f   http 0p 410f
net 0p 148f     process 0p 90f   querystring 0p 8f   readline 0p 26f
string_decoder 0p 5f   url 0p 50f   zlib 0p 68f
```

**The one green module checks out at the surface too**, which is worth
confirming rather than assuming since it is the whole of the axis. Against
node's own `punycode`: the same six names, nothing missing, nothing extra,
`ucs2` with the same two members, `version` identical at `"2.1.0"`. Its
`export-surface-static.js` already asserts each of those and is written to fail
when a name is *added*, not only when one is absent.

That test pins the version as a literal rather than reading node's, and the
choice is argued in the file: a compiled artifact publishing `undefined`, an
empty string or a number would pass every other test in the module. Comparing
against node would catch a different failure -- node revising its vendored
copy -- at the cost of depending on a deprecated module continuing to exist.
Left as it is, because the reasoning for the literal is stated and sound.

**Fifteen passes across seven modules, and seven of the fifteen depend on
behaviour.** The other eight are accounted for individually and none is a
mystery: `fs` 1, `stream` 2 and `timers` 1 are vacuous -- `undefined` compared
with `undefined` -- `util` 1 and two of `path`'s 3 are presence checks that
survive `--mutate-addon`, and one of `os`'s 4 reads a constant the mutation lane
cannot poison.

So the axis is 1 of 22 by the strictest reading and by every weaker one. No
module other than `punycode` passes everything it is given, and no module other
than `punycode`, `os` and `path` holds a single pass that depends on what the
module does.

**This is the inventory in its measured form.** The per-module blocker tables
above say what each module is waiting on; this says what each currently
achieves. They are different questions and the second is the one that answers
"which modules can pass" without inference.

### Which modules are waiting on the wrapper, and which on the lowering

Splitting each module's declines into the wrapper's own type boundary and
everything else -- cascades from lowering, and export forms:

```
a wrapper type-boundary blocker (10)
  assert       takes an object[], outward only
  async_hooks  returns unknown; takes an object; takes unknown
  buffer       takes unknown
  events       takes an object
  http         takes an object
  os           returns an object[]
  path         returns an object; takes an object
  stream       takes unknown
  timers       returns an object; takes an object; takes unknown
  url          takes unknown

only lowering or export form (11)
  console  dgram  diagnostics_channel  fs  net  process
  querystring  readline  string_decoder  util  zlib

nothing at all (1)
  punycode
```

**Six forms make up the whole of the wrapper's type boundary**, and after this
evening every one is named by some fixture's *expectation*:

| form | fixture |
| --- | --- |
| `takes an object` | `object-parameter-at-the-wrapper` |
| `takes unknown` | `unknown-at-the-boundary` |
| `returns unknown` | `unknown-return-at-the-boundary` |
| `returns an object` | `object-return-at-the-wrapper` |
| `returns an object[]` | `array-return-only-carries-numbers` |
| `takes an object[]`, outward only | `parameter-boundary-carries-four-types` |

**Two of those were found missing by auditing expectations rather than text.**
A grep for `returns unknown` across fixture sources finds it -- in the *comment*
of the fixture that asserts the inward half. Nothing asserted it. Same for
`returns an object`, where the existing fixture asserts the positive case, that
a scalar-field object return publishes, and nothing asserted that a nested one
does not.

That is the same mistake as the earlier survey that matched redacted diagnostic
forms against literal fixture text: searching the wrong field of the right file.
Twice, three hours apart, in opposite directions -- once finding nothing that
existed, once finding everything that did not.

### What was filed, and what was declined

Fifteen fixtures filed and four blockers declined, against a set that stood at
59 when the evening began and reads 84 now, all as expected on the current pin.

Filed, with the count that justified each -- distinct sites in `runtime/node`
where the form is a lowering refusal, or occurrences where it is a wrapper
decline:

```
iterable-and-buffer-union-properties  169   four types a class field cannot hold
in-naming-an-optional-key              52
method-on-a-structural-type            42
union-members-lay-fields-out-diff      40
optional-chained-method-call           38
rest-parameter-of-unrepresentable-el    9   url's largest own form
in-with-a-computed-key                  7
constructor-overload-signatures         7   buffer's Buffer and Blob
unknown-at-the-boundary                 5   async_hooks 4, buffer 2
object-parameter-at-the-wrapper         5   timers
typed-array-methods                     3   at, includes, indexOf
array-join-is-not-provided              1   the head of the widest chain
length-after-array-isarray              1   fixed the same night, now a guard
optional-parameter-at-the-wrapper       1   path.basename
assigning-to-array-length               1   url's URLSearchParams
```

Declined rather than filed, each with what was ruled out:

- **`a rest parameter that is not an array`**, 38 sites, the largest form left
  unfiled. Two probes produce a *different* message -- `a rest parameter of
  unrepresentable type`, which is already filed as
  `rest-parameter-of-unrepresentable-elements` -- for both a generic rest
  (`<A extends unknown[]>(...args: A)`, which is `internal/tick.ts:39`'s
  `nextTick`) and a call to one. And the reported location does not contain the
  construct: `dgram/src/main.ts:988` is `this.#contextFrame = undefined;`. Two
  spellings that ought to produce it produce something else, and the sites point
  somewhere else, so anything filed here would reproduce a neighbour.

- **buffer's bigint into `unknown`.** Four probes: a literal, a typed
  parameter, a class method with buffer's own bounds, a narrowed value into a
  constructor argument. All four lower. Deleted rather than kept as a near-miss.
- **A named "declaration outside every walk"** -- `atob`, `btoa`,
  `userInfoString`. An unreferenced exported function lowers, so "exported but
  unreferenced" is ruled out. Its reported location is not the declaration.
- **NTS2008 `a value of type Erased cannot be erased yet`.** The message names
  its own missing piece; a runtime ownership question.
- **NTS2006 `closure class reached code generation with no method to call`.** A
  module-scope const initialised by a plain function call lowers cleanly, so
  that shape is ruled out. Checked that it predates this profile's own
  `quoteJSONString` import rather than assuming.

**Three fixtures needed their control rebuilt** because the first control was
declined for its own reason: an object parameter in `in-with-a-computed-key`, a
`TypedArray` parameter in `typed-array-methods`, an object parameter again in
`method-on-a-structural-type`. Each time the fix was to construct the value
rather than accept it. The fourth failure mode in this document's own rules is
not a rare case; it was the single most common mistake of the evening.

### Ranking refusal forms, and the denominator that ranked web-platform

Choosing what to file next needs an ordering. The obvious one -- how often each
refusal form appears -- gives this:

```
1300  assigning to this property
 971  a member of `X`, a class this compiler has no type for
 490  indexing `X`, which stands for `X` here
```

Every one of those is a per-module cone count summed over twenty-two modules. On
distinct sites *inside `runtime/node`*, `assigning to this property` is **13
sites, one of which is in this profile**: the other twelve are in
`web-platform`, which every cone contains, so it inflates by roughly a hundred
rather than by the profile's average of nine.

Ranked correctly -- distinct sites, `runtime/node` only:

| form | sites |
| --- | --- |
| a property of unrepresentable type (`AsyncIterableIterator \| undefined`) | 62 |
| a property of unrepresentable type (the `ArrayBuffer` family union) | 58 |
| `X`, which `X` does not declare | 66 |
| an `in` naming a key the type declares optionally | 52 |
| a method with no declaration in the hierarchy | 42 |
| a name from an enclosing scope | 41 |
| a field on a union whose members lay out differently | 40 |
| a rest parameter that is not an array | 38 |
| captured above its own declaration | 37 |

The four unrepresentable-property types together are 169 of the 315 sites of
that form and were the largest unfiled group in the profile; the ordering that
ranked `assigning to this property` first had them nowhere near the top.

**The lesson is not that the denominator was wrong.** It is that the denominator
was written up as wrong -- the 9.4x note is a few sections above this one -- and
then used anyway, an hour later, to choose what to work on. Knowing a number is
inflated does not stop it being the number you reach for when you need an
ordering.

### 61 exports are declared, not published, and not declined by name

`tooling/conformance/unaccounted-exports.sh` subtracts what a module publishes
and what the wrapper declined *by name* from what its entry file declares. The
remainder is surface nobody was told about:

```
fs    44 declared,  0 published,  0 declined  ->  44 unaccounted
util  20 declared,  2 published,  1 declined  ->  17 unaccounted
every other module                            ->   0
```

**Validated where the arithmetic is exact**: `punycode` 6-6-0, `os` 23-17-6,
`querystring` 8-0-8, `diagnostics_channel` 7-0-7, `dgram` 2-0-2 all reach zero.
A check that has never returned zero for a healthy module is not a check.

`util` was invisible before this. It declines exactly one export by name,
`getStringWidth`, publishes two, and declares twenty. The seventeen in between
get nothing.

**What the backend says, which is not nothing but is not about the exports
either.** `fs` carries 41 `an object type with no layout`, eighteen of them for
one type alone, plus 6 NTS2009 and 2 NTS2008. `util` carries 8. So the backend
is loud and the wrapper is silent: `addon.c` was written, it contains zero
`napi_set_named_property`, and no `no wrapper for X` line accompanies it. The
wrapper stage ran and produced neither publications nor declines.

**The first version of this check was wrong in the usual direction.** It counted
every `export` in every file of a module -- including internal helpers shared
between files -- and reported every module as having a gap: `fs` 232, `zlib`
188, `util` 82. A module's public surface is its entry file, not its directory.
That is the fourth population error in this document's own measurements tonight,
after the typed-array count, the wrapper-decline double-count and the cone
summation, and in every case the wrong number was the larger and more
interesting one.

Both limits under-report. Declared reads only `export function|class|const` from
`src/main.ts`, so a surface arriving through `export *` is undercounted -- `fs`
has eleven such lines, which makes 44 a floor -- and a name published under an
alias counts as unaccounted.

### What each module is waiting on, all twenty-two on one compiler

`decl` is wrapper declines, `own` is NTS1001 sites in the module's own `src/`.

| module | decl | own | dominant decline |
| --- | --- | --- | --- |
| `punycode` | 0 | 0 | — everything crosses |
| `fs` | 0 | 211 | — nothing reaches the wrapper |
| `util` | 1 | 81 | function never compiled |
| `dgram` | 2 | 13 | function never compiled |
| `string_decoder` | 2 | 0 | not a function this backend can name |
| `console` | 5 | 20 | not a function this backend can name |
| `path` | 5 | 6 | not a function this backend can name |
| `os` | 6 | 4 | function never compiled |
| `process` | 6 | 45 | not a function this backend can name |
| `diagnostics_channel` | 7 | 19 | function never compiled |
| `querystring` | 8 | 3 | function never compiled |
| `buffer` | 12 | 43 | function never compiled |
| `net` | 13 | 45 | function never compiled |
| `readline` | 14 | 71 | function never compiled |
| `url` | 14 | 40 | function never compiled |
| `async_hooks` | 15 | 20 | function never compiled |
| `events` | 16 | 30 | function never compiled |
| `assert` | 24 | 45 | not a function this backend can name |
| `http` | 25 | 147 | function never compiled |
| `timers` | 27 | 25 | function never compiled |
| `stream` | 28 | 470 | function never compiled |
| `zlib` | 53 | 98 | not a function this backend can name |

**Zero declines means two opposite things, and the table would mislead without
this line.** `punycode` has none because all six of its exports cross.
`fs` has none because nothing gets far enough to be declined. A module with no
complaints from the wrapper is either finished or has not arrived.

**The cause, found by the compiler side and verified here.** `public_api`
considers only modules that nothing imports. A module that any other module
imports contributes no exports *and no declines* -- which is why the silence is
not an empty publication section but no publication section at all.

`fs/src/utf8-stream.ts` imports `openSync`, `writeSync`, `mkdirSync` and
`fsyncSync` from `./main.ts`, and `main.ts:158` re-exports `Utf8Stream` from
`./utf8-stream.ts`. A two-module cycle, both value imports. `main.ts` is
therefore "imported", skipped, and all 303 go with it.

`util` is not a cycle. `util/src/width.ts` imports `stripVTControlCharacters`
from `./main.ts` and `main.ts` never mentions `width`, so `main.ts` is imported
and skipped and `width.ts` -- which nothing imports -- becomes the entry.
`width.ts` exports exactly three: `getStringWidth`, `isFullWidthCodePoint`,
`isZeroWidthCodePoint`. **That is util's published surface**: two published, one
declined by name. The module's compiled surface is an orphan helper's.

The set is the confirmation. Grepping every module for a back-import of
`./main.ts` gives two hits, `fs` and `util`, and the unaccounted count is 44 and
17 with zero everywhere else. Two instruments built independently, the same two
modules.

**Neither is cheaply breakable from this side, and for the same reason in both
modules.** The back-import in each case reaches a *definition* in `main.ts`, not
a re-export:

```
fs    utf8-stream.ts needs openSync, writeSync, mkdirSync, fsyncSync
      -- defined in main.ts at 933, 507 and beside them
util  width.ts needs stripVTControlCharacters
      -- defined in main.ts at 206
```

So there is nowhere else to point the import. Breaking either cycle means moving
a function definition out of `main.ts` into a new file so that an entry
heuristic lands on the right root, which is restructuring correct source to suit
the compiler.

`width.ts` additionally is unreferenced by anything in util -- none of
`getStringWidth`, `isFullWidthCodePoint` or `isZeroWidthCodePoint` is named
anywhere else in the module -- but it is a faithful port of node's width logic
that `inspect.ts`'s table path will need, and `inspect.ts` already carries the
comments for that path. Deleting it would delete correct work waiting for its
caller.

The symmetry is the useful part: two modules, two different import shapes -- a
cycle and a one-way orphan -- and the same underlying fact, that a helper needs
something the module's entry file defines. Any rule that fixes this by moving
code is a rule about where definitions live, decided by an entry heuristic.

**And `fs`'s zero is a reporting gap, not just a state.** It declares 291
exported functions and 12 exported classes. Its emitted `addon.c` contains zero
`napi_set_named_property` calls -- `punycode`'s contains six -- and the compiler
prints **no decline naming any of the 303**. Six NTS2009 at the backend and 211
own roots, and not one line that says why `readFileSync` is absent.

Every other module accounts for its missing surface: `zlib` declines 53 exports
by name, `stream` 28, `http` 25. `fs` declines none and publishes none. Someone
asking "why is `fs.readFile` not there" gets no answer from the tool, which is
the same shape as `asRequest` blocking 21 functions with nothing printed, at
twelve times the scale.

`string_decoder` is the other instructive row: 2 declines and **0 own roots**,
which is the whole of its position. Nothing in the module is wrong. It is
waiting on `indexing an array of any` four cascades away, and on the
export-class arm for `default`.

`stream` at 470 own roots and `fs` at 211 are the two that are not close, and
`http` at 147 is third. `path` at 6 own and 5 declines is the nearest thing to a
module whose remaining work can be listed on one hand.

### The profile on one binary, and the 9.4x that summing cones costs

All twenty-two modules emitted with one compiler, so the numbers are comparable
end to end for the first time in this document.

| measure | value |
| --- | --- |
| NTS1001 summed over the twenty-two cones | 19,034 |
| **NTS1001 distinct sites** | **2,020** |
| of those, inside `runtime/node` | 1,469 |
| **NTS2xxx distinct sites** | **65** |
| NTS2xxx summed over cones | 316 |
| wrapper declines | 283 |

**Summing per-module cone counts inflates by 9.4x.** Every module imports
`internal/`, so every refusal in `internal/errors.ts` is counted twenty-two
times. The per-module cone column elsewhere in this document is the right number
for "what stands between this module and its exports"; it is the wrong number to
add up, and 19,034 is what adding it up produces. The same applies to NTS2xxx:
316 summed, 65 distinct.

The 283 wrapper declines decompose as before, and the shape holds on the fresh
measurement:

```
131  is exported and no function of that name was compiled   lowering
 99  is exported and is not a function this backend can name  export form
 30  is a class whose constructor was not compiled            lowering
 10  takes an object                                          the wrapper
  8  takes unknown                                            the wrapper
  2  returns an object                                        the wrapper
  1  takes an object[], which crosses outward only            the wrapper
  1  returns unknown                                          the wrapper
  1  returns an object[]                                      the wrapper
```

161 of 283 are lowering, 99 are export forms, and **23 are the wrapper's own
type boundary** -- up from 21 because `path` now reaches the wrapper with two
more signatures than it did.

`path` itself reads 5 declines, down from 7: `join` and `resolve` cross now.

### There is a third stage, and this document had not been counting it

Refusals come in three kinds and only two have been measured here. `NTS1001` is
the lowering refusing an expression. `no wrapper for X` is the Node-API wrapper
declining a signature. Between them sits **`NTS2xxx`, the backend refusing to
emit**, and across sixteen modules re-emitted on one compiler there are 311 of
them:

| code | form | count |
| --- | --- | --- |
| NTS2006 | `no declaration for X to take a signature from` | 59 |
| NTS2009 | `X cannot be emitted because it calls X, which this backend refused above` | 56 |
| NTS2006 | `an object type with no layout: type NNNN` | ~50 |
| NTS2008 | `a value of type Erased cannot be erased yet; a reference payload needs retain and release` | 15 |
| NTS2006 | `closure class X reached code generation with no method to call` | 13 |

Only `an object type with no layout` is filed, as
`array-of-object-literals-has-no-layout`. The other three forms have no fixture,
and the largest of them has 59 occurrences across thirteen modules.

**Two of the five forms are cascade, and the first reading of this was wrong.**

`NTS2009` says so in its own text. `NTS2006 no declaration for X to take a
signature from` does not, and it was briefly written up here as
`EventEmitter#emit`'s long-missing root. It is not. Those 59 occurrences name
just **six** methods --

```
21  Readable#destroy      11  EventEmitter#emit      6  ImmediateHandle#invoke
12  HttpCacheBody#open     8  Readable#resume        1  EventEmitter#removeListener
```

-- and each is refused upstream: `Readable#destroy`, `Readable#resume` and
`EventEmitter#removeListener` carry an NTS1003 naming them, and `emit` carries
an NTS1001 *inside its body*. The backend cannot find a signature for a method
the lowering already refused, and says so once per call site.

So `EventEmitter#emit`'s root is `events/src/main.ts:621` --
`` `EventEmitter`, a class used as a value `` -- reading a static off the class
from inside the class. That is `class-as-value`, already filed. The dash in the
ranked table was right to be a dash, and filling it with the first diagnostic
that mentioned the name would have pointed at a consequence.

**What is left is genuinely the backend's**, and two of the three forms have no
fixture: `an object type with no layout` (~50, filed as
`array-of-object-literals-has-no-layout`), `a value of type Erased cannot be
erased yet` (15, unfiled), and `closure class X reached code generation with no
method to call` (13, unfiled).

Both unfiled forms are handed over as diagnoses rather than fixtures, because
neither reproduced.

`NTS2008 a value of type Erased cannot be erased yet; a reference payload needs
retain and release` sits at `internal/tick.ts:84` and `fs/src/async.ts:461`. The
message names the missing piece itself -- an erased value holding a reference
needs retain and release before it can be dropped -- which is a runtime
ownership question rather than a shape this side can reduce.

`NTS2006 closure class X reached code generation with no method to call` reaches
four modules: `process`, `dgram`, `net`, `http`. Its site is
`web-platform/src/json/text.ts:39`, a module-scope const initialised by a call:

```ts
const SHORT_ESCAPES: string[] = buildShortEscapes();
```

**Ruled out: that shape on its own.** A module-scope const initialised by a
plain function call, with a loop in the callee, lowers and crosses cleanly. So
whatever makes the compiler build a closure class here is not "a const
initialised by a call".

**Also checked, and it is not mine.** `text.ts` is the file this profile started
importing tonight for `quoteJSONString`, so the obvious suspicion was that the
import introduced these. It did not: the same four modules carried the same form
in logs taken before the import. Counted rather than assumed, because a new
dependency and a new diagnostic appearing in the same evening is exactly the
coincidence that reads as cause.

**And it does not overturn `asRequest`.** That one was called unreportable
because `fs/src/request.ts` carries no NTS1001 or NTS1003 anywhere. Re-checked
against every diagnostic code in the fresh log: still zero. The file has no
diagnostic of any kind, and `asRequest` still blocks 21 distinct functions with
nothing printed about it.

The lesson is the one this document keeps relearning in new places. A search
scoped to the codes you already know about returns the blockers you already know
about, and reports the rest as absent.

### Every wrapper decline in the profile, and 59% of them are not the wrapper's

282 declines across the twenty-two modules, by reason:

| reason | count | what it actually is |
| --- | --- | --- |
| `is exported and no function of that name was compiled` | 134 | lowering |
| `is exported and is not a function this backend can name` | 95 | export form |
| `is a class whose constructor was not compiled` | 32 | lowering |
| `takes an object` | 8 | the wrapper |
| `takes unknown` | 6 | the wrapper |
| `takes a rest parameter` | 2 | the wrapper |
| `returns an object` | 2 | the wrapper |
| `takes an object[], which crosses outward only` | 1 | the wrapper |
| `returns unknown` | 1 | the wrapper |
| `returns an object[]` | 1 | the wrapper |

**166 of 282 are lowering failures reported at the wrapper**, because a function
that never compiled has nothing to wrap. Another 95 are the export-form family
-- a class, a namespace, a value, a shorthand -- which is a naming question
rather than a type-crossing one. The wrapper's own type boundary accounts for
**21**.

That decomposition is worth having before anyone reads "282 wrapper declines" as
282 things wrong with the wrapper. It is 21 things wrong with the wrapper and
166 things wrong upstream of it.

**And it explains an absence.** This document has carried "66 signatures in nine
modules sit behind the typed-array gap" for a while. There is not one
`takes TypedArray` decline in the profile today. The gap is real -- no emitted
wrapper builds a typed array, counted separately and still zero -- but those 66
signatures are not reaching the wrapper to be declined. They are inside the 134
whose functions never compiled. A blocker can be masked by a blocker in front of
it, and the count that names it goes to zero without the blocker moving.

### `path`'s eighteen failures, and two of them are the wrapper's

Reading the failures rather than the count:

```
8   dereference `path.win32`, which is undefined      export-namespace
1   matchesGlob                                       glob-matcher's own six roots
1   `path.posix.join` absent                          rest-parameter-at-the-wrapper
1   basename throws ERR_MISSING_ARGS                  optional-parameter-at-the-wrapper
```

The `win32` eight are not a shape problem. The shim builds `posix` from the flat
exports and points `posix.posix` at itself, which is node's own identity
(`path.posix === path` is true on a posix host); what it cannot do is invent
`win32`, whose functions the addon does not publish because the namespace export
is declined. A shim that supplied them would be answering for the module.

**Two of the four causes are wrapper properties rather than lowering ones**, and
that is a different queue from the refusal chains. `basename` compiled, linked
and published, and then rejects `basename(p)` -- the call node makes everywhere
-- because `suffix?: string` crosses as required.

**Scope, measured rather than assumed: one.** Across all twenty-two addons,
exactly one published function has an optional parameter in its declaration, and
it is `path.basename`. The gap is narrow today because so little is published;
it widens with every function that starts crossing. (Counted by cross-referencing
each addon's published function names against `export function NAME(` in that
module's source, so a function published under an alias or declared as a const
arrow would not be seen.)

### `os` did not move, and tracing why found the convergence

`os` is unchanged at 6 declines. `getPriority` and `setPriority` cascade on
`validateInt32`, and `validateString` compiling did not bring its siblings:

```
validateInt32, validateInteger, validateNumberRange, validateUint32
                                <- ERR_OUT_OF_RANGE#constructor
validateArray                   <- ERR_INVALID_ARG_VALUE#constructor
  -> validateStringArray, validateBooleanArray
validatePort                    <- ERR_SOCKET_BAD_PORT#constructor
```

All three constructors call `inspectValue`, `inspectValue` calls
`inspectValueWithin`, and `inspectValueWithin` is refused at `errors.ts:533` --
**indexing an array of any**, which is `indexing-an-array-of-any`, filed
tonight after `length-after-array-isarray` was fixed and revealed it two lines
later.

Within the `os` cone alone -- one module's cone, not the profile -- 16 distinct
functions are one or two hops from `inspectValue`. It also holds
`ERR_UNKNOWN_ENCODING#constructor`, which is what leaves `StringDecoder`
without a constructor and `string_decoder` publishing nothing.

So the widest remaining root and the one blocking the nearest module are the
same expression, and the fixture for it was filed four hours after the fix that
exposed it.

## The native half: 328 of 331, and which `nm` you ask decides the answer

Re-derived tonight. 331 distinct `nts_*` bindings are declared across
`runtime/node`; 328 have C somewhere. Three do not:

```
nts_next_tick                internal/tick.ts
nts_promise_hook_install     internal/async-hooks.ts
nts_promise_hook_uninstall   internal/async-hooks.ts
```

No `.c` file under `runtime/node` mentions any of them. The microtask machinery
they sit beside does exist -- `internal/microtask.c` implements
`nts_node_enqueue_microtask` -- so these are a bounded gap and not a missing
subsystem. `nextTick` is not a microtask: node runs its queue *before* promise
microtasks, and that ordering is the whole content of the binding.

**Neither of the two kinds is simply unwritten, and the distinction is the
point of listing them.**

`nts_promise_hook_install` and `nts_promise_hook_uninstall` are **blocked**. A
Node-API addon cannot install a promise hook: the whole promise surface of
`js_native_api.h` and `node_api.h` is `napi_create_promise` and
`napi_is_promise`, and `promise_hook` appears in neither header. `SetPromiseHook`
is `v8::Isolate`'s, one layer below anything an addon can reach. Writing this C
is not work that is waiting to be done; it wants an API that is not there.

`nts_next_tick` is **not yet reachable**. No emitted `program.c` in any of the
twenty-two builds references it -- its callers are refused upstream -- so it
blocks no link today. Its declaration is generic over a tuple
(`<Args extends unknown[]>(callback: (...args: Args) => void, args: Args)`), and
`microtask.c` records at length what happens when a `.c` guesses the prototype
the compiler will emit for a callback binding: the closure parameter is spelled
per program (`NtsObj_Closure20 *` in one module, `18` in another), a shared `.c`
cannot name it, and the mismatch is invisible until a module gets far enough to
link. Writing this one now would be guessing a signature that nothing has
emitted yet, which is the same mistake with a longer feedback loop.

**The instruction says derive it with `nm`, and the subtler trap is which `nm`.**
The first attempt used `nm -D --defined-only`, which reads the *dynamic* symbol
table, and reported **95** bindings with no C -- including every `nts_udp_*` in
`dgram`, a file whose C was written this session. Plain `nm` finds
`nts_udp_bind_sync` in `dgram.node`; `nm -D` does not, because the symbol is not
exported from the shared object. Nothing was wrong with the reasoning and
everything was wrong with the table:

```
nm -D --defined-only   95 declared bindings "with no C"    <- wrong table
nm     (all symbols)    3 declared bindings with no C      <- the answer
grep 'declare function' across all names   109              <- wrong population
                                                              (host shims too)
```

Three numbers, one question, and only the third is an answer. The rule this
document already carries -- *derive it with `nm`, never a regex* -- was written
after two regexes disagreed. It needs the other half: `nm` against the right
table, and the declared population narrowed to what the question is about.

## The counted lane over all twenty-two, with its uncounted control

Re-derived against the compiler carrying tonight's four fixes, one module at a
time. Left column is `NTS_CONFORMANCE_RC=1`, right is the same module built
without it. The bracketed figure is refcount operations observed.

| module | tests | counted | rc | uncounted |
| --- | --- | --- | --- | --- |
| `punycode` | 3 | 3 passed, 0 failed | 55 | identical |
| `os` | 13 | 4 passed, 5 failed | 282 | identical |
| `path` | 22 | 2 passed, 19 failed, 1 skipped | 70 | identical |
| `stream` | 267 | 2 passed, 248 failed, 4 skipped | 1731 | identical |
| `fs` | 394 | 1 passed, 344 failed, 7 skipped | 2214 | identical |
| `timers` | 67 | 1 passed, 55 failed | 244 | identical |
| `util` | 53 | 1 passed, 24 failed | 1530 | identical |
| `assert` | 26 | 0 passed, 12 failed | 1508 | identical |
| `async_hooks` | 154 | 0 passed, 116 failed | 186 | identical |
| `buffer` | 97 | 0 passed, 56 failed | 196 | identical |
| `console` | 39 | 0 passed, 19 failed | 1566 | identical |
| `dgram` | 110 | 0 passed, 77 failed, 2 skipped | 1808 | identical |
| `diagnostics_channel` | 60 | 0 passed, 33 failed | 185 | identical |
| `events` | 52 | 0 passed, 32 failed | 1422 | identical |
| `http` | 451 | 0 passed, 410 failed | 1265 | identical |
| `net` | 179 | 0 passed, 148 failed, 7 skipped | 1786 | identical |
| `process` | 152 | 0 passed, 90 failed | 2195 | identical |
| `querystring` | 9 | 0 passed, 8 failed | 267 | identical |
| `readline` | 28 | 0 passed, 26 failed | 1770 | identical |
| `string_decoder` | 6 | 0 passed, 5 failed | 236 | identical |
| `url` | 53 | 0 passed, 50 failed | 505 | identical |
| `zlib` | 74 | 0 passed, 68 failed | 1768 | identical |

**22 of 22 with an uncounted control, 0 differing.** Every row shows refcount
traffic -- 55 at the low end, 2,214 at the high -- so no identical pair is the
allocator having seen nothing. That is the distinction the lane was written for:
an identical pair is a result, and only a blank one would not be.

### Fourteen passes on the compiled axis, and only six depend on behaviour

Run again with `--mutate-addon`, which keeps the addon's exported names and
destroys their behaviour:

| module | passes | survive mutation |
| --- | --- | --- |
| `punycode` | 3 | 0 |
| `os` | 4 | 1 |
| `path` | 2 | 2 |
| `timers` | 1 | 1 |
| `util` | 1 | 1 |

**Surviving mutation is not the same as being fake, and the difference is in
`poison` itself.** It replaces exported *functions* and passes data values
through untouched, so a test that reads a constant cannot fail under it however
wrong that constant is. Naming the five survivors is what separates them:

```
test-path-posix-exists.js    presence
test-path-win32-exists.js    presence
test-util-types-exists.js    presence
test-os-eol.js               a constant, and that assigning to it throws
test-timers-promises.js      deepStrictEqual(timers/promises, timers.promises)
```

Three assert that a name is there; mutation keeps names, so they survive. One
asserts `os.EOL` and that `os.EOL = 123` throws -- both real properties of our
module, neither of them behaviour, and neither expressible as a defect by a lane
that only poisons functions. The last compares two of our own values to each
other, so mutation transforms both sides identically and the equality holds.

So the fourteen decompose as **three vacuous** (`fs` 1, `stream` 2 --
`undefined` on both sides, not ours at all), **five that mutation cannot
challenge** (presence, a constant, a self-comparison), and **six that depend on
what the module does** -- `punycode` 3 and `os` 3.

An earlier sentence here said "eleven real ones". That counted everything that
was not vacuous, which is the wrong cut: it treats a lane's silence as evidence.
Only `punycode` passes everything it is given, and only `punycode` has every one
of its passes survive mutation.

## The interpreted lane after the `errors.ts` import: 22 of 22, 1,851 passing

`internal/errors.ts` is imported by every module, so changing it is a change to
all twenty-two interpreted lanes at once. Measured module by module afterwards:

```
assert       12    console       19    fs      345    path       21    stream        250
async_hooks 116    dgram         77    http    405    process    88    string_decoder  5
buffer       55    diagnostics_c 33    net     148    punycode    3    timers         56
events       32    os             9    querystr  8    readline   26    url            50
util         25    zlib          68
```

**1,851 passed, 0 failed, across all twenty-two.**

**Re-measured at the end of the session, after everything else.** By then this
profile had also gained `EventEmitter.usingDomains` as a class static with the
shim line removed, three edited local tests, and `"files": ["src/main.ts"]` in
all twenty-two tsconfigs. Each was checked when it landed; the point of running
the twenty-two again is that four changes verified separately are not the same
claim as four changes verified together. Same total, same distribution, still
zero failures.

**100% and 0 hollow are two measurements, and both were taken.** The counts
above establish the first: no test that passed before the import fails after
it. They say nothing about the second -- a file that passes with the module
*blanked* -- which is a different property and was last measured by the sweep
before this change.

So it was measured again, `--sabotage` per module, in the same batches:

```
assert 0   console 0    fs 0     path 0       stream 0
async_hooks 0  dgram 0  http 0   process 0    string_decoder 0
buffer 0   diagnostics_channel 0  net 0  punycode 0  timers 0
events 0   os 0         querystring 0  readline 0   url 0
util 0     zlib 0
```

**22 of 22, zero files still passing with the module blanked.** The lane that
produced it is the one that reported `HOLLOW punycode 1 file(s)` when a test
asserting `1 + 1 === 2` was planted in it, so the zero is a measurement rather
than a lane that has never found anything.

The argument -- that swapping one string-quoting implementation for a
verified-equivalent one cannot turn a real pass hollow -- was correct. It was
still worth the twenty-two runs, because "correct argument" and "measured" are
not the same claim and this document is where the difference is kept.

## The table re-derived after tonight's three fixes

Every number below is from the compiler as of `d3378707`, emitted module by
module and deduplicated the same way as before. Root refusals only.

| module | own | cone | own before | cone before |
| --- | --- | --- | --- | --- |
| `punycode` | 0 | 0 | 0 | 0 |
| `string_decoder` | 0 | 71 | 0 | 74 |
| `querystring` | 3 | 75 | 3 | 78 |
| `os` | 4 | 77 | 4 | 80 |
| `path` | 6 | 28 | 6 | 31 |
| `dgram` | 13 | 1518 | 13 | 1521 |
| `diagnostics_channel` | 19 | 52 | 19 | 55 |
| `async_hooks` | 20 | 51 | 20 | 54 |
| `console` | **21** | 1244 | 24 | 1250 |
| `timers` | 25 | 56 | 25 | 59 |
| `events` | 31 | 1134 | 31 | 1137 |
| `url` | 40 | 155 | 40 | 158 |
| `buffer` | 43 | 71 | 43 | 74 |
| `net` | 45 | 1499 | 45 | 1502 |
| `process` | 45 | 1964 | 45 | 1967 |
| `assert` | 45 | 1217 | 45 | 1220 |
| `readline` | 71 | 1340 | 71 | 1343 |
| `util` | 88 | 1196 | 88 | 1199 |
| `zlib` | 98 | 1755 | 98 | 1758 |
| `http` | **147** | 1951 | 148 | 1955 |
| `fs` | 214 | 2079 | 214 | 2082 |
| `stream` | 472 | 1657 | 472 | 1660 |

Three roots were cleared tonight: `length` after `Array.isArray` at
`internal/errors.ts:518`, and `JSON.stringify` at `internal/errors.ts:70` and
`:1470`. All three are in `internal/`, so all three are in every module's cone,
and every cone falls by exactly 3 -- **except two**.

`console` falls by 6 and `http` by 4, and their *own* counts move too, from 24
to 21 and from 148 to 147. The four extra are `console/src/main.ts:451`, `:485`,
`:595` and `http/src/outgoing.ts:190`, and all four are the same `length` of
something without one. The fix cleared that form wherever it appeared, not only
at the site it was filed from -- five sites, not one.

**Which is the useful reading of this table.** A root filed from one module is
not a fact about that module. The two own-count changes are the only evidence in
the profile that the fix reached past `internal/`, and a cone-only view would
have shown a uniform -3 and said nothing about it.

**What did not move.** `string_decoder` is still 0 own and still publishes
nothing; `os` is still 17 of 23 with the same six names absent; `path` still
publishes four; `querystring` still publishes nothing. The axis is unchanged.
Twenty-two of twenty-two still build. Zero of twenty-four wrappers call
`nts_to_napi_view` or `napi_create_typedarray` -- counted excluding the helper's
own definition, which is emitted into every `addon.c` and which a plain grep
reports as twenty-two modules building typed arrays.

## `http` gained two exports and neither of them is a value

After tonight's rebuild the addon key counts moved in exactly one place:
`http` from 2 to 4, gaining `METHODS` and `methods`. It reads as progress and is
not:

```
getHTTPParserPoolLimit  function
maxHeaderSize           number
METHODS                 undefined   <--
methods                 undefined   <--
```

`http` is unchanged at 0 passed, 410 failed. Node has 35 methods in `METHODS`,
and `node.methods !== node.METHODS`; ours compare equal because both are
`undefined`.

The wrapper is not obviously at fault from the C. It emits the right thing:

```c
extern NtsArray * METHODS;
nts_to_napi_strings(env, METHODS, &value);
napi_set_named_property(env, exports, "METHODS", value);
```

The global behind it is never initialized -- `parser.ts:291` reports
`invalidMethodOffset cannot be compiled because it reads methods, whose
initializer was not compiled` -- so the name arrives bound to nothing. The
wrapper declines a *function* it could not compile and says so; it publishes a
*value* whose initializer was refused.

**A name bound to `undefined` is worse than an absent one.** It satisfies "the
module publishes something", it makes any export-surface check that asks only
for presence agree, and it is exactly as incapable of being the subject of a
passing test. Surveyed across all twenty-three built addons, this is the only
occurrence: `http`, two names.

`vacuous-lane.mjs` counted `Object.keys(m).length` and so read `http` as four
exports. It now counts defined values and names the undefined ones separately,
and exits non-zero on either. The hole was in the instrument whose whole premise
is that `exports > 0` means the module has a subject.

**Gated the same night, and verified here rather than taken.** A global whose
initializer was excised kept its binding, zeroed, and the value-export path
published it. It is now declined:

```
no wrapper for METHODS: is exported and is not a function this backend can name
no wrapper for methods: ...
```

Rebuilt against the compiler that carries the gate -- not the addon already on
disk, which was built before it -- the loaded module has two keys,
`getHTTPParserPoolLimit` and `maxHeaderSize`, and none bound to `undefined`.
`vacuous-lane` agrees: 2 exports, 0 undefined, 0 vacuous.

`http` is still 0 passed, 410 failed, which is the correct outcome. The gate
removed a misleading surface, not a missing capability, and a test count that
moved on it would have meant something was wrong with the tests.

## `JSON.stringify` is gone from `errors.ts`, and it did not free `validateString`

`internal/errors.ts` had the only two `JSON.stringify` call sites that mattered,
both with a `string` argument. `JSON` has no definition in a compiled program
and giving it one would mean a second statement of 25.5.4.3's escaping rule in
C. It is already stated once, in TypeScript, and `internal/utf8.ts` already
re-exports the UTF-8 codec across the same boundary, so the import is the
established shape here rather than a new coupling:

```ts
import { quoteJSONString } from "../../web-platform/src/json/text.ts";
```

**Checked, not assumed.** `quoteJSONString` returns the value with its quotes,
so it substitutes directly. 65,633 strings -- every UTF-16 code unit including
lone surrogates, astral pairs, and every pair drawn from the escape-adjacent
units -- agree with node's `JSON.stringify`. The harness reports 2,161
differences when handed a quoter that does no escaping, so the zero is a result
and not a broken comparison. `text.ts` imports nothing and
`web-platform/src/json` never imports `runtime/node`, so there is no cycle.

Interpreted lanes before and after, unchanged: `path` 21/0, `string_decoder`
5/0, `os` 9/0, `util` 25/0, `buffer` 55/0.

### What it bought, and what it did not

```
string_decoder cone roots   73 -> 71
path cone roots             31 -> 28
validateString              still refused
path's public surface       still absent, all thirteen names
```

`determineSpecificType` had a second root, and clearing the first exposed it:

```
ERR_INVALID_ARG_TYPE#constructor  <- determineSpecificType
  <- staticObjectName             <- `instanceof` with no class, errors.ts:102
                                       if (value instanceof DataView) ...
```

**It is the same class, in the same form, as `buffer/src/main.ts:194** --
`objectToBuffer`'s `value instanceof DataView`, which is what holds `Buffer.from`
and through it `bytesOf`. One missing class now sits under both the widest chain
in the profile and one of `string_decoder`'s four roots. `instanceof-no-class` is
already filed and its fixture already names `DataView`.

**Third time tonight that clearing a root revealed the next.** `length` at
`errors.ts:518` revealed indexing at `:520`, two lines away, on the chain that
had been named the shortest. `JSON.stringify` at `:70` revealed
`staticObjectName` at `:102`. "Five cleared and five revealed" was written down
as a `buffer` observation; it is a property of cones. The ranked table above
counts immediate causes for exactly this reason, and a refusal delta is still
not a measure of a fix.

## The profile's blockers, ranked by how many functions each one stops

Every NTS1003 names one callee: "cannot be compiled because it calls X, which
was refused above". Counting distinct blocked sites per X, across all twenty-two
emit logs, deduplicated because modules share cones:

| immediate callee | distinct functions it blocks | its own root |
| --- | --- | --- |
| `ERR_INVALID_ARG_TYPE#constructor` | 67 | `JSON.stringify` — `errors.ts:70` |
| `uvException` | 32 | `` `dest`, which `UVExceptionError` does not declare `` — `uv.ts:102` |
| `EventEmitter#emit` | 28 | — |
| `checkedOffset` | 28 | `boundsError` → `ERR_INVALID_ARG_TYPE` |
| `validateString` | 22 | `ERR_INVALID_ARG_TYPE` |
| `checkedIntegerWrite` | 21 | `ERR_INVALID_ARG_TYPE` |
| `asRequest` | 21 | **never reported** — see below |
| `Socket##healthCheck` | 16 | — |
| `displayBytePath` | 15 | — |
| `coerceToUSVString` | 14 | — |
| `Buffer.from` | 13 | `objectToBuffer` → `instanceof` with no class |
| `validateInteger` | 12 | `ERR_INVALID_ARG_TYPE` |

Four of the top six reduce to the same constructor. Taking the union of every
site whose immediate callee is `ERR_INVALID_ARG_TYPE#constructor`, any
`validate*`, `checkedOffset`, `boundsError`, `checkedIntegerWrite` or
`checkedBigIntWrite`:

**198 distinct functions sit one or two hops from `ERR_INVALID_ARG_TYPE`**, and
its own root is a single expression — `JSON.stringify` in
`determineSpecificType`, `internal/errors.ts:70`.

The second entry is already filed too: `uvException`'s root is the same
undeclared-property form as the fixture that spells it `` `dest`, which
`Carrier` does not declare ``.

### `asRequest` blocks twenty-one functions and is never reported as refused

`fs/src/request.ts` carries **zero diagnostics**. Not one NTS1001, not one
NTS1003, in any of the twenty-two emit logs. And `asRequest` is named as the
blocking callee 42 times across 21 distinct functions:

```
  lines saying `asRequest` was refused:        0
  lines naming `asRequest` as the callee:     42
  distinct functions blocked:                 21
```

This is `cascade-with-no-root`, which is already filed, at the largest scale
measured. The cost is specific: someone working on `fs` -- the module with 214
own roots and 2082 in its cone -- cannot reach this one from the output. Every
other heavy blocker's file carries diagnostics to read (`dir.ts` 27,
`async.ts` 282, `dgram/src/main.ts` 49, and `uvException` and `decodeIn` have
findable NTS1001 roots at `uv.ts:102` and `encodings.ts:279`). This one has
nothing to read at all.

**866 of the 1,144 callees named in cascades have no NTS1003 line of their own,
and that number is not the answer.** A function refused directly by NTS1001
correctly has no NTS1003 -- its diagnostic is the NTS1001 in its body, which is
findable. The 866 is an upper bound on the unreportable set, not a measurement
of it. `asRequest` is the case where the distinction was checked and came out
on the unreportable side.

**What this table is not.** It counts immediate causes, so the transitive set is
larger than any row. It does not predict pass counts: a function can have more
than one refused callee, and clearing a root reveals whatever stood behind it --
`buffer` went 79 to 79 with five cleared and five revealed. A refusal delta is
not a measure of a fix. The table says where the weight sits, and nothing more.

## `JSON.stringify` is under eighty refused functions, including all of `path`

`path` owns six root refusals, all in `src/glob-matcher.ts`, and publishes four
exports: `_makeLong`, `toNamespacedPath`, `delimiter`, `sep`. Every function a
caller actually wants is absent, and all of them cascade the same way:

```
posix.ts:119  `join@posix` cannot be compiled because it calls `validateString`
validators.ts:21  `validateString` ... calls `ERR_INVALID_ARG_TYPE#constructor`
errors.ts:372     `ERR_INVALID_ARG_TYPE#constructor` ... calls `determineSpecificType`
errors.ts:70      `JSON.stringify`, a global member with no definition here
```

Counted across all twenty-two emit logs, deduplicated by site because modules
share cones:

```
80  distinct functions whose immediate refusal cause is a `validate*` call
67  distinct functions whose immediate cause is ERR_INVALID_ARG_TYPE
```

Every node module validates its arguments, so the validators are load-bearing
everywhere: `fs` 67 such sites, `process` 60, `http` 49, `url` 24, `path` 23.

**This is reach, not a promise.** These are *immediate* causes; the transitive
set is larger, and clearing a root does not green what stood behind it -- a
function can have more than one refused callee, and `buffer` went 79 to 79 once
with five cleared and five revealed. What can be said is where the weight sits.

So the two candidates for "fix one thing" are different in kind, and both are
already filed:

- `json-stringify` has the widest reach. It is under `validateString`, and
  through it under most of `path`'s public surface and part of
  `string_decoder#write`.
- `length-after-array-isarray` is the shortest path to a module changing state.
  It is the only one of `string_decoder`'s four roots that lands on the
  *constructor*, and without a constructor the class has no wrapper and the
  addon publishes nothing at all.








## 483,056 comparisons against node on inputs no pinned test uses: 0 divergences

2026-09-10, interpreted lane, `differential-ts.mjs --all`. This is the goal
text's directive — node's pinned tests under-test whatever cannot fail on node —
run as a differential rather than as new hand-written assertions.

| module | comparisons | inputs | divergences |
| --- | ---: | ---: | ---: |
| `buffer` | 116,725 | 4,025 | 0 |
| `path` | 84,882 | 4,042 | 0 |
| `string_decoder` | 72,288 | 4,016 | 0 |
| `zlib` | 40,130 | 4,013 | 0 |
| `util` | 36,216 | 4,024 | 0 |
| `url` | 32,192 | 4,024 | 0 |
| `punycode` | 28,224 | 4,032 | 0 |
| `fs` | 28,168 | 4,024 | 0 |
| `assert` | 20,115 | 4,023 | 0 |
| `querystring` | 16,076 | 4,019 | 0 |
| `events` | 8,040 | 4,020 | 0 |
| `console` | 4,030 | 4,030 | 0 |
| `diagnostics_channel` | 4,020 | 4,020 | 0 |
| `readline` | 4,030 | 4,030 | 0 |
| `async_hooks` | 4,030 | 4,030 | 0 |
| `process` | 4,015 | 4,015 | 0 |
| `stream` | 4,030 | 4,030 | 0 |
| `net` | 16,120 | 4,030 | 0 |
| `http` | 12,117 | 4,039 | 0 |
| `dgram` | 4,020 | 4,020 | 0 |
| `timers` | 4,020 | 4,020 | 0 |

**21 modules measured, 543,488 comparisons, 0 divergences.** Ten corpora were
added tonight — `console`, `diagnostics_channel`, `readline`, `async_hooks`,
`process`, `stream`, `net`, `http`, `dgram` and `timers` — contributing 60,432
of them, and `net` found a real defect (the section above).

**This is every module the instrument can cover.** The one absence is `os`, and
it is skipped with a reason rather than missing: its bindings stand in as node
on this lane, so the comparison would be node against node. `differential-addon.mjs`
is where that question belongs.

`console` is a state-machine fuzz like `events`, because its behaviour is what
it *writes* and the parts worth comparing are stateful: `group` indentation
nests, `count` tallies per label. Both streams are captured and returned
together, since `warn`, `error` and a failing `assert` go to stderr while the
rest go to stdout, and which stream a line lands on is exactly what a
reimplementation gets wrong unnoticed.

Two operations are excluded and named rather than normalised. `time`/`timeEnd`
write a duration and `trace` writes a stack, so both diverge every run for
reasons that are not defects. `countReset` on an unseen label emits a **process**
warning rather than writing to the console's streams, so this corpus has no
channel to compare it on — and suppressing the warning to keep the output
readable is the mistake that once hid a difference two tests depended on.

`diagnostics_channel` is the third state-machine corpus. It reaches what a value
fuzz cannot: publishing to a channel nobody holds, subscribing the same function
twice, unsubscribing during a publish that is walking the list, and whether
`channel(name)` twice returns the same object — node keys a registry
process-wide by name, and a reimplementation that builds a fresh channel each
time passes every single-channel test and breaks every cross-module one.

### Both new corpora found themselves first

**`console`: 423 divergences over 430 inputs, every one the harness.** The sink
was a duck-typed object with a `write`; node's `Console` writes nothing to such
an object while ours wrote correctly, so the run reported that the module under
test was right and node was empty. It is a real `Writable` now.

**`diagnostics_channel`: 6 over 420, also the harness.** Ours logged one publish
twice. The channel name was derived from the program text, which is not unique —
`"sp"` is in the `fixed` seeds *and* the generator emits it, so the second
occurrence inherited the first's subscriber. A per-invocation counter fixed it.

`readline` fuzzes the four cursor functions over argument shapes the pinned
tests do not reach — `NaN`, `Infinity`, `undefined`, a fractional column, a
negative count, a `dir` outside -1..1 — and compares the **return value**
alongside the bytes, because each answers a boolean saying whether the stream
took the write and a reimplementation can emit the right escape with the wrong
boolean. It was clean on its first run, so it was controlled before being
believed: **23 of its 30 fixed inputs write bytes, they produce 21 distinct
results, and a sabotage that makes `clearLine` ignore its direction argument is
caught by 5 of 30.** A corpus with no demonstrated failure is a claim.

`async_hooks` runs `AsyncLocalStorage` as a program of nested `run` calls,
`enterWith`, `exit`, `disable` and reads, executed as a fold rather than a loop
so the remainder of the program runs *inside* each callback and nesting means
something. It reaches what no single call can: an inner `run` seeing its own
store with the outer one restored afterwards, `exit` making `getStore()`
undefined for its callback and restoring on the way out, `enterWith` persisting
past the call it was made in where `run` does not.

**Synchronous only, and that is a real limit rather than an oversight.** The
point of `AsyncLocalStorage` is propagation across an `await`, and comparing
that means comparing timing, which a value-compare corpus cannot do. The
asynchronous half is uncompared and is named as such in the corpus itself.

Its controls: 30 distinct results over 30 fixed inputs across 135 log lines, and
a sabotage where `exit` does not clear the store is caught.

`process` is the thinnest of the five and is recorded as thin: **5 distinct
results over 15 fixed inputs**, because its value-shaped surface really is small
once the rest is excluded. `hrtime`, `uptime`, `memoryUsage`, `cpuUsage`,
`resourceUsage` and `pid` answer differently every call by design; `exit`,
`abort`, `kill` and `chdir` change the host rather than answer about it. What
remains is argument validation and pure conversion — `hrtime` compared for
shape and validation only, `env` for presence and type, `cwd()` for its
invariants rather than its value. A sabotage returning a one-element array from
`hrtime` is caught by 5 of 15.

`stream` compares the **synchronous** half, which is more than it sounds:
`write()` answers a boolean saying whether the buffer is under the high water
mark, `read()` in paused mode answers from the buffer, and
`readableLength`/`writableLength` are exact byte counts. Those three are what
backpressure *is*, and a reimplementation that gets the bytes right and the
booleans wrong looks correct until something upstream honours the return value.
Events and `pipe` are excluded and named: they answer over time.

**Its first version was clean and nearly vacuous**, which is the failure mode
worth recording. The writable was `write(_c, _e, cb) { cb(); }`, and calling the
callback synchronously drains the buffer on every write — so `writableLength`
never grew, `write()` answered `true` forever, **1 of 30 inputs saw a `false`,
and a sabotage making `write()` always return `true` was caught by 1 of 30.**
Holding the callbacks instead keeps the buffer full: 11 of 30 see a `false` and
the same sabotage is caught by 11.

That shape is worse than a harness that reports false divergences, because it
**looks like a pass**. The number to read on a new corpus is therefore the
sabotage count, not the divergence count — 0 divergences is the desired answer
and 1-of-30 detection is a failing one.

`emitWarning` was in the `process` corpus and was removed rather than quieted. A valid call
*emits*, and 400 iterations put hundreds of warnings on the process's stderr —
side effects a comparison corpus has no business producing. `NODE_NO_WARNINGS`
was not an option: it once hid a difference two pinned tests depend on.

The tell in the other two was the **shape** of the divergence rather than the count:
every input diverging with an empty oracle means the oracle is not wired up, and
an output that is the right output *repeated* means state leaking between
iterations. A real defect is usually a minority of inputs and a *different*
answer, not the same answer twice.

### What it could not run, which is now one module

That number means nothing without this beside it. **Twenty-one of twenty-two
modules were measured**, up from eleven this morning. One more was skipped with a stated reason:

    os: skipped on this lane -- its bindings stand in as node here;
        run differential-addon.mjs against the built addon instead

and **none is now absent without a reason.** `dgram`, `http`, `net` and
`timers` were all written off earlier tonight as "sockets and timers answer over
time to a peer, which a value-compare corpus has no way to hold" — a
generalisation from the modules' *names* that cost `net`'s defect its discovery
for several hours. Each has a pure surface:

| module | what is comparable | what is excluded |
| --- | --- | --- |
| `net` | `isIP`/`isIPv4`/`isIPv6`, `BlockList` | `connect`, `createServer`, `Socket` |
| `http` | `validateHeaderName`/`Value`, `STATUS_CODES`, `METHODS` | everything that speaks to a socket |
| `dgram` | `createSocket`'s validation, before a socket exists | the socket itself |
| `timers` | validation, `ref`/`unref`/`hasRef`/`refresh` | the firing, which needs a clock |

`http`'s two validators are worth more than conformance: `validateHeaderValue`
is what stops response splitting, so accepting a bare CRLF where node rejects it
is a security difference. 31 of its 39 fixed inputs catch a sabotage that makes
`validateHeaderName` accept everything.

`timers` probed `Symbol.toPrimitive` and the probe was **removed rather than
kept red**. Node's `Timeout` carries it and answers the timer id; ours does not.
That is a real difference and it is **deliberately out of scope** — §13 lists
`Symbol.toPrimitive` as an excluded runtime operation hook and
`test-timers-to-primitive.js` is marked not applicable for exactly that reason.
Implementing it would contradict a declared non-goal; leaving the probe in would
report 8 divergences on every run for a decision already made, which teaches a
reader to ignore the number. It is recorded here and dropped there. These are the modules whose surfaces are sockets, streams and timers
rather than values in and values out, so the generator has nothing to generate.

So the claim this supports is narrow and worth stating exactly: **for the eleven
value-shaped modules, the TypeScript answers what node answers on four thousand
generated inputs each, well outside what the pinned tests reach.** It says
nothing about the other eleven, and a reader who takes "0 divergences" as a
property of the tree would be taking it from a 50% sample.

The instrument earned that caution once already: it found the `querystring`
`__proto__` ordering bug on its first serious run, 20 divergences over 4,000
queries in a module whose pinned tests all passed.

## `hidden-exports.mjs`'s six findings are six non-defects, and here is why

2026-09-10. Chased all six because the goal text points at this instrument —
"those found `http` publishing internals node lacks and `process` publishing a
binding as public API" — and that was true when it was written. It is not true
of the six standing tonight.

    0 node-own name(s) published and not on the module, 6 reaching no test at all
        http      getHTTPParserPoolLimit
        readline  kClearLine kClearScreenDown kClearToLineBeginning kClearToLineEnd
        util      styles

All six are absent from node's public surface, which is what makes them look
like the old defect. **Every one is already corrected by its shim**, and the
instrument reads the module's *raw exports* rather than the object node's tests
receive:

| name | what the shim does |
| --- | --- |
| `util.styles` | `util.inspect.styles = exports.styles` and then `delete util.styles` — node has it at `inspect.styles`, and that is where ours lands |
| `http.getHTTPParserPoolLimit` | `delete http.getHTTPParserPoolLimit`, and it is read at `shape.mjs:304` to serve the internal stand-in |
| `readline`'s four `kClear*` | placed on the `internal/readline/utils` stand-in's `CSI`, not on the public surface |

**The four `readline` constants are not untested either**, which is the second
thing worth writing down. `hidden-exports.mjs` says so itself — *"reachability is
the question here, not usability"* — and it means no test reads them **by name**.
Their values are pinned behaviourally by `local/cursor-static.js`:

    [-1, '\x1b[1K'],   [0, '\x1b[2K'],   [1, '\x1b[0K'],   and '\x1b[0J'

so `clearLine(stream, 0)` writing the wrong bytes fails there. A by-name
assertion would restate a weaker claim than the one already held, so none was
added.

Node's own `test-readline-csi.js` asserts the same four against the same
literals and is **not applicable** here for a documented §13 reason: its `CSI`
must be a callable template tag *and* carry observable function-object
properties at once. The applicability rule is right and stays; the values it
would have checked are checked anyway.

> The instrument is not wrong — it answers reachability and says so. It is worth
> a section because six findings that each need a shim read to dismiss is
> exactly the shape that gets re-chased every few weeks.

## Typed arrays cross outward now, and the module count for it is zero for the wrong reason

Re-derived 2026-09-10 on a pin taken at 01:29, with a standalone probe rather
than a module, because no module can currently ask the question.

    returnsU8(): Uint8Array         crosses -- no decline
    takesU8(u: Uint8Array): number  REFUSED -- takes TypedArray, which crosses outward only
    returnsNumberArray(): number[]  crosses

**The standing goal text's "no emitted wrapper builds a typed array at all —
zero across 24 addons" no longer holds.** The outward direction works;
`blockers/view-returned-to-the-host` asserts `nts_to_napi_view(env, result,
&out)` is emitted and reproduces. Only the inward direction refuses, which
`blockers/view-parameter-crosses-outward-only` states in exactly the words above
and also reproduces.

### The count is zero and that is not progress

The goal text says "66 signatures in nine modules sit behind that gap". Counted
across all 22 module build logs tonight:

    wrapper declines naming a typed array, either direction:  0
    wrapper declines in total across the sweep:             479

**Zero is the wrong number to report as an improvement.** The two lines that
matched a first, careless grep for `crosses outward only` were
`registerDestroyHook: takes an object` and `printSimpleMyersDiff: takes an
object[]` — the same phrase about a different type, which is the trap this
ledger already records for typed-array counting once before.

The declines are absent because **the affected functions are refused at lowering
and never reach wrapper generation**. `string_decoder` is the clean example:
every one of its members cascades from `Buffer.from`, so no signature of its
gets far enough for the wrapper to have an opinion about a typed array.

So the honest statement of the gap is: the inward half is open, it is filed and
reproducing as a fixture, and **no module currently demonstrates it** — not
because it is closed but because those modules stop earlier. A census that reads
module logs alone would report this gap as gone.

> This is the fourth instrument this month that answered cleanly about the
> subset it could reach. The rule stands: an absent diagnostic is not a closed
> defect.

## The native half is done: 349 of 352

Re-derived 2026-09-10 with `nm --defined-only` against compiled objects, which
is the only method this ledger accepts for it — two regexes once gave two
different wrong answers.

    352 declared binding(s), 3 with no C anywhere, across 18 module(s)

The three are all in `internal`, and they are the same three recorded before:

    nts_next_tick
    nts_promise_hook_install
    nts_promise_hook_uninstall

**The standing goal text is stale here by a wide margin**, and says so of itself.
It names "roughly 125 of 309 declared bindings have no C anywhere" with three
worked examples. All three are now zero:

| module | goal text (2026-09-09) | measured 2026-09-10 |
| --- | --- | --- |
| `dgram` | 21 of 21 missing | 21 declared, **0** missing |
| `net` | 28 of 30 missing | 30 declared, **0** missing |
| `fs` | 60 of 133 missing | 155 declared, **0** missing |

So "compiling is necessary and not sufficient — `dgram` would fail to link
whatever the compiler does" is **no longer true**. `dgram` has all 21 of its
bindings, and nothing in the tree is gated on absent C except the three
`internal` names above.

The instrument reports what it could not run, which is the reason to trust the
rest of it:

    3 C file(s) did not compile and contributed no symbols:
        runtime/node/fs/test/bytes.c
        runtime/node/timers/test/host.c
        runtime/node/zlib/test/bytes.c

All three are test-support files, not bindings, and the count above is stated
knowing their symbols read as missing.

A missing binding is a link failure waiting for the lowering to arrive rather
than one happening now: a module only fails to link once something calls it.






## A real defect, found by the assertion the oracle had no reason to make

2026-09-10. `net.BlockList` raised the wrong error code for an invalid address,
on **every** input, and nothing in the tree noticed.

    ours   add-ipv4:ERR_INVALID_ARG_VALUE
    node   add-ipv4:ERR_INVALID_ADDRESS

430 of 430 generated addresses diverged. The interpreted lane was **150 passed /
0 failed** for `net` throughout — node's pinned tests never assert this code,
which is the whole point of the directive that produced it.

### Why it was there to find

I had written `dgram`, `http`, `net` and `timers` off as "sockets answer over
time to a peer, which a value-compare corpus has no way to hold", and that was a
generalisation from the module's *name*. Each of them has a pure surface:
`net.isIP`/`isIPv4`/`isIPv6` are address parsers with no I/O, and `BlockList` is
rules in, boolean out. Dismissing a module as asynchronous is not the same as
checking whether any of it is.

### One control said it was there, a second said what it was

`addressFromInput` and `normaliseFamily` sit fourteen lines apart in
`block-list.ts` and both threw `ERR_INVALID_ARG_VALUE`. Only one of them was
wrong, and node's contract had to be read for each separately:

| input | node | ours before |
| --- | --- | --- |
| bad address | `ERR_INVALID_ADDRESS`, an **`Error`** | `ERR_INVALID_ARG_VALUE` |
| bad family string | `ERR_INVALID_ARG_VALUE`, a `TypeError` | correct already |
| bad family type | `ERR_INVALID_ARG_TYPE` | correct already |
| family `undefined` | accepted | correct already |

**Changing both sites would have fixed one case and broken three.**

### The fix

`ERR_INVALID_ADDRESS` did not exist in `internal/errors.ts`, and it is absent
from node's `lib/internal/errors.js` too — node raises it from C++, which is why
grepping node's JavaScript for it finds nothing and only running node finds it.
Added as a `NodeError` with the fixed message `Invalid socket address`, matching
the observed shape: an `Error`, not a `TypeError`, carrying `code` and nothing
else.

After: **`net` 16,120 comparisons, 0 divergences**, and the whole suite 18
modules, 523,331 comparisons, 0 divergences. Interpreted unchanged — `net`
150/0, `path` 20/0, `os` 9/0 — which matters because `internal/errors.ts` is
shared by every module in the tree.










## The layout fix landed and cleared exactly what it said; my count did not mean what I read it as

2026-09-10, 04:47 pin. MainClaude's base-fields-first ordering for interface
extension landed:

    04:26   struct NtsObj_Extended { header; c; a; b; }
    04:47   struct NtsObj_Extended { header; a; b; c; }

**It cleared `FileOptions -> BlobOptions` exactly as described**, with no source
change and nothing flattened — which is why holding through two rounds of
contradictory advice was the right call.

    string_decoder  fo 6 -> 5   passes 0 -> 0
    os              fo 6 -> 5   passes 5 -> 5

    before   1 DNSExceptionError->UVError  1 FileOptions->BlobOptions  2 UVExceptionError->UVError
    after    1 DNSExceptionError->UVError                             2 UVExceptionError->UVError

### I predicted four would clear, and one did

The prediction came from my own site survey printing `string_decoder 4 site(s)`.
That number counted **refusal lines mentioning the module**, not four
`FileOptions` sites. There was only ever one. Three ways of counting the same
build disagree:

    lines matching "is wanted"   6    <- what `fo=` reports
    pair instances               4
    distinct pairs               3

A diagnostic wraps across lines, so a line count over-reports; a pair count
collapses repeats; only the distinct-pair count answers "how many kinds". **All
three are in this ledger under the same word "sites" at different points**, and
the 564 total is a line count.

This is the `built=` column again in a different place: a number that means
something other than what it is read as, in an instrument I wrote. The `built=`
case made "did not compile" and "tests failed" the same row; this one makes
"one diagnostic" and "several sites" the same number.

**The totals stand as line counts and should be read as such.** They are still
comparable across pins, which is what they were used for — every before/after in
this ledger counted the same way on both sides. What they are not is a count of
distinct casts, and I used them as one when predicting.

## All 22 measured on the post-refusal pin: 564 refusals, 0 passes lost

2026-09-10, 04:26 pin. The field-order refusal converts a raw pointer cast
between structurally-incompatible types into a decline, so it could only move
the axis down. Every module was rebuilt and rerun, `built=` verified on each.

    process 62   http 60   net 51   dgram 51   zlib 50   stream 50
    readline 30  console 26  assert 25  util 23  events 17  url 11
    string_decoder 6  querystring 6  os 6  buffer 6  fs 82  timers 2
    punycode 0   path 0   diagnostics_channel 0   async_hooks 0

**Not one module's pass count changed.** `punycode`, `path`,
`diagnostics_channel` and `async_hooks` carry zero sites and are the control:
had any moved, the survey would have been wrong rather than the refusal free.

`readline` at 30 with no sites of its own is the clearest illustration of cone
multiplication — `internal/stdio.ts`'s `StandardStream -> WritableLike` reaches
it twice, and every cone that passes through a shared internal counts it again.

### The 49 sites are three kinds, and only one is mine

MainClaude measured the field disagreements behind them: **746 by name, 54 by
type, 0 by the `Object(id1)`/`Object(id2)` artifact** they had flagged as a
possible over-count. That caveat is withdrawn and the count stands.

| kind | example | who fixes it |
| --- | --- | --- |
| interface extends interface | `FileOptions -> BlobOptions`, 8 sites | **layout ordering** — inherited fields first, no source change |
| class to unrelated interface | the `stream` family, most of the 75 | **neither** — needs a representation decision |
| API-inherent two shapes | `Stats`/`BigIntStats`, `StatFs<number>`/`StatFs<bigint>` | **nobody** — the two shapes are node's contract |

The middle row is the one that changed tonight's picture. The 746 name
disagreements are `_events`, `_eventsCount`, `_maxListeners` against
`_readableState`, `destroyed`, `_writev` — **`EventEmitter`'s fields sitting at
the front of `Readable` and `Writable` because those classes extend it,
correctly, base-first.** So `ErrorOrDestroyStream { destroyed, … }` can never be
a prefix of `Readable`: `destroyed` is index 0 in the interface and index N in
the class, and no ordering rule fixes that without deciding which order wins.

Confirmed here rather than taken, and the diagnostic now says it itself:

    a pointer cast between two structs that do not agree about where their
    shared fields are -- a base's fields keep their offsets in a subclass and
    a structural type's do not

So this was described all evening as one layout problem and it is two, and only
the smaller one has a cheap answer. The larger one is the design step
`blockers/method-syntax-in-an-interface` names — what an interface's
representation should be when both an object literal and a class instance can be
one — and the stream family stays refused until it is decided.

> The limit on "0 passes lost" is the more useful half: none of these refusals
> sits in a cone a **currently-passing** test reaches, and 15 of 22 modules pass
> fewer than three files each. Re-measure after `Buffer.from` and the
> object-parameter wrapper clear, when those cones open.

## The field-order refusal cost the axis nothing

2026-09-10, 04:00 pin against the 03:44 one. MainClaude's refusal turns a raw
pointer cast between structurally-incompatible types into a decline. It could
only move the axis down, so it was measured rather than assumed.

| module | field-order refusals | passed before | after |
| --- | ---: | ---: | ---: |
| `punycode` | 0 | 3 | 3 |
| `path` | 0 | 15 | 15 |
| `string_decoder` | 6 | 0 | 0 |
| `os` | 6 | 5 | 5 |
| `querystring` | 6 | 1 | 1 |
| `buffer` | 6 | 2 | 2 |
| `console` | 26 | 0 | 0 |
| `events` | 17 | 0 | 0 |
| `util` | 23 | 2 | 2 |

**Not one module moved.** 84 new refusals across nine modules and no passing
test file lost. `punycode` and `path` carry zero sites and are the control: had
either moved, the site survey would have been wrong rather than the refusal
free.

"Correct and free" is a different fact from "correct and costly", and only the
measurement separates them. A refusal that converts a silent misread into a
decline is right either way — but it would have been worth saying plainly if it
had cost `os` its fifth pass, and it did not.

### `FileOptions` needs no source change, and both of us were wrong once

The site is `interface FileOptions extends BlobOptions` passed to `super`. The
emitted structs:

    struct NtsObj_BlobOptions { header; endings; type; }
    struct NtsObj_FileOptions { header; lastModified; endings; type; }

**`endings` and `type` are `NtsValue` in both.** The representations agree and
only the position differs, so base-fields-first for interface extension clears
it with nothing changed in my source.

Getting there took two corrections in opposite directions. I formed a hypothesis
that the refusal over-fires on interface extension, held it back for want of a
layout, and the layout refuted it — extension is derived-first, so the site is a
live hazard. MainClaude then measured that the *representations* also disagreed
and told me not to flatten; that turned out to be an artifact of a probe file
mixing a class and an interface of the same shape, where structural merging put
them on one layout and the class's assignment made a field a `Float` where a
literal made it an `Int`.

**Neither of us had it right alone.** Had they not hedged I would have flattened
`FileOptions` on base-first reasoning; had they not retracted I would have left
it flattened for a reason that was not real. The 8 sites stay untouched and the
fix is a layout ordering in the compiler.

## The field-order refusal reached my lane, and my hypothesis about it was wrong

2026-09-10, 04:00 pin. MainClaude landed a refusal for a value passed where a
structural type of different field order is wanted — the fix for a raw pointer
cast that segfaulted or misread silently. My sites, found before their list
arrived:

| site | shape | modules |
| --- | --- | ---: |
| `buffer/src/blob.ts:712` | `FileOptions` where a `BlobOptions` is wanted | `string_decoder` 4, `os` 4, `querystring` 4, `buffer` 4 |
| `events/src/main.ts:707` | `EventEmitterAsyncResourceOptions` where an `AsyncResourceOptions` is wanted | `console` 16, `events` 11 |

`path` and `punycode` have none. **All of them are interface-to-interface**, not
the class-to-interface case that was reported, so the refusal reaches further
than the bug that motivated it.

### The hypothesis, and why it was not sent

`buffer/src/blob.ts:712` is `interface FileOptions extends BlobOptions`, passed
to `super(fileBits, options)`. An interface *extending* another looks
prefix-compatible by construction — the same argument that makes
`blockers/upcast-to-base` a free cast for a subclass. So the natural reading is
that the refusal over-fires on the safe shape, and that reordering cannot be the
fix because there is nothing to reorder: `FileOptions` declares only
`lastModified` and inherits the rest.

**That reading is wrong, and the emitted C says so:**

    struct NtsObj_Base      { header; a; b; }
    struct NtsObj_Extended  { header; c; a; b; }    <- `c` first, not last
    struct NtsObj_Reordered { header; b; a; }

`Extended extends Base` puts the **derived** field first. `Base.a` is in the
first slot and `Extended.a` is in the second, so an `Extended` passed as a
`Base` reads `c` where `a` should be. The refusal is correct here and the site
is a live hazard.

**Class inheritance is base-first; interface extension is not.** That asymmetry
is the actual finding, and it is a layout question rather than a coercion one.

> The hypothesis was held back specifically because the layout was unverified,
> and it was the wrong hypothesis. Sending it would have argued a peer out of a
> correct refusal, on an analogy that sounded right and was not — the same shape
> as the 28-candidate regex list that was also not sent.


## The axis re-derived on a 03:44 pin: unchanged, and that is the result

2026-09-10. My standing figure came from a 02:32 pin and **five compiler builds
had landed since** — 03:14, 03:18, 03:37, 03:41, 03:44. Quoting it further would
have been the stale-baseline failure, so all 22 modules were rebuilt and rerun
on the newest.

    41 passed, 1,821 failed, 15 module(s) with a pass, 1 whole
    built=no: 0 of 22

**Not one module differs from the 02:32 measurement.** Every row is identical,
including `punycode` whole at 3/0 and `string_decoder` at 0/5.

That is worth stating rather than skipping, because the five builds in between
were not idle: MainClaude's optional-`in` work cleared `buffer/src/main.ts:189`,
`{ ...base, k: v }` began lowering across 25 sites and 158 refused functions, and
`"length" in xs` on an array started answering. **Three real compiler fixes and
the axis did not move by one test file.**

The reason is the one this ledger recorded earlier tonight: a refusal is
function-granular, so a module is held shut by the *last* refusal in each cone
rather than by their number. `Buffer.from` had four heads, one is cleared, and
`string_decoder` needs all four.

> The pass count is a poor instrument for progress at this stage and a good one
> for honesty. Nothing here was hidden by it; the fixes are real and the ledger
> says where they landed instead.

## The `os` corpus was calling fifteen of twenty, and now calls twenty

2026-09-10. The corpora were never audited for how much of a module's public
surface they reach. `os` turned out to call **15 of its 20 functions**, and the
five it missed were not incidental: `getPriority`, `setPriority`, `userInfo`,
`networkInterfaces`, `cpus`. `getPriority`'s validation is where tonight's
wrapper-coercion finding lives, and nothing was comparing it.

All five are added. `setPriority` appears **through its validation only** —
every input is one that must throw before reaching the system call, because a
successful call renices the host process and a comparison corpus has no
business doing that. The others are compared for shape rather than value:
`cpus()` for `model` and `times.user` being present and typed, `userInfo()` for
its five fields, `networkInterfaces()` for its keys mapping to arrays of
addressed records. Their values are machine-specific and their shapes are not.

Against the compiled addon: **30,280 comparisons, 0 divergences**, and the
harness named what it could not ask —

    not compared, absent from the addon: userInfo-shape, networkInterfaces-shape

which is the two exports that do not publish, skipped rather than counted as
false divergences.


### Finishing the audit: `timers` and `querystring` were also short

The audit was left unfinished for corpora that build an object before calling
anything, so it was finished with an instrument that wraps namespaces and
constructors as well as top-level names.

    path                 21/39   -> 29/39
    console               1/25   not measurable this way
    stream                2/22   -> 7/22
    url                   8/14   -> 11/14
    readline              4/7   -> 7/7
    querystring           4/7   -> 7/7
    diagnostics_channel   4/6   -> 6/6
    timers                2/6   -> 6/6

**`timers` was comparing 2 of 6 functions.** `setInterval` and `setImmediate`
have the same synchronous surface as `setTimeout` — validation, `hasRef()`,
`ref()`/`unref()` returning the handle — and none of it was compared. Added,
with each handle cleared in the same call: an interval left running keeps the
process alive and the sweep never ends.

**`querystring` was comparing 4 of 7.** `encode` and `decode` are node's
documented aliases for `stringify` and `parse`, and `unescapeBuffer` is the safe
fast decoder `unescape` falls back to. An alias that stops aliasing is exactly
the kind of break no pinned test catches, and nothing was watching it.

**`stream` was comparing 2 of 22.** Its five pure predicates — `isDestroyed`,
`isDisturbed`, `isErrored`, `isReadable`, `isWritable` — take a value and answer
a boolean with no I/O, and none was compared. Added, and asked about a stream in
a **known state** rather than a fresh one: destroyed, errored, read from, ended,
plus a plain object and `null`. A predicate that answers correctly for a new
stream and wrongly for a used one is the failure worth catching, and only a
state machine reaches it.

That is 40 answers per input across eight states, and node's answers are not
uniform — `fresh.isDestroyed` is `false`, `destroyed` and `errored` are `true`,
and `null.isDestroyed` is **`null`** rather than a throw. A sabotage making
`isDestroyed` always answer `false` is caught.

`stream` remains 7 of 22 rather than complete: the rest are `pipeline`,
`finished`, `compose`, `Readable.from` and the constructors, which answer over
time and belong to a harness that can compare ordering.

**`url` was comparing 8 of 14**, and the three added are the ones with the most
behaviour per call. `URLSearchParams` is compared as a **state machine**,
because that is what it is: the same key appended twice keeps both in order,
`set` collapses them to one *in the first one's position*, `sort` is stable
across equal keys, and `delete` takes every match. Constructing one and reading
it back reaches none of that.

    append2:a=1&b=2&a=3&a=1&a=2
    set:a=3&b=2          <- three `a` entries collapsed, in the first's slot
    delete:b=2

The serialisation is compared at every step, because **the ordering is the
behaviour** — two implementations can agree on `getAll` and disagree on
`toString`. A sabotage where `set` appends instead of replacing in place is
caught, and it is the exact break that a `getAll`-only comparison would miss.

`domainToASCII` and `domainToUnicode` went in alongside: pure IDNA string
functions that answer `''` rather than throwing on input they cannot convert,
which is a difference a reimplementation gets wrong quietly.

**`path` was calling 21 of 39 and none of them top-level.** Every call went
through `posix.` or `win32.`, so the twelve names the module publishes directly
were never compared.

That is not redundancy, and `_makeLong` is why. On a posix host
`path.normalize` should **be** `path.posix.normalize` — the same function
object, not merely one that agrees — and earlier today `path._makeLong` answered
correctly while being a *different* function from `toNamespacedPath`, which
`local/legacy-make-long.js` asserts with `strictEqual`. Right answers, wrong
object.

So identity is compared alongside the answers, and the control shows the two are
not the same check:

    sabotage: top-level `normalize` re-wrapped, answering identically
      caught by the identity check       yes
      caught by the answer comparison    no

**`diagnostics_channel` was 4 of 6**, missing `tracingChannel` and `Channel`.
`traceSync` carries an **ordering contract**, and ordering is normally the half
a value comparison cannot hold — here it can, because the whole sequence is
synchronous and the subscriber writes a log:

    normal    start,end
    throwing  start,error,end     <- `error` before `end`, not after

A reimplementation that emits `error` after `end`, or skips `end` when the
traced function throws, answers every single-event test correctly and gets this
wrong. Controlled: a sabotage that publishes an extra `end` after the error is
caught, `start,error,end` against `start,error,end,end`.

**`readline` was 4 of 7**, and the last name was `emitKeypressEvents`, which
turns bytes on a stream into `'keypress'` events. The decoding is a state
machine and is synchronous end to end, so a value comparison holds it:

    "abc"      -> a, b, c            three keys
    "E[A"      -> up                 one key, the escape sequence consumed
    "E"        -> []                 a lone escape is held, waiting for more
    "E[1;5A"   -> up with ctrl

What is compared is the **sequence** of `(name, ctrl, meta, shift)` tuples,
because a decoder that produces the right keys in the wrong order, or splits one
sequence into two, answers every single-key test correctly. 46 distinct
decodings over 50 fixed inputs, all emitting at least one key.

Its control is the weakest of the seven and is recorded as such: a sabotage that
drops the `ctrl` flag is caught by **2 of 50**, because only two fixed inputs
carry a modifier. That is not vacuous — it can fail, and does — but it is thin,
and the honest reading is that this corpus tests *decoding* well and *modifiers*
barely.

The suite is **21 modules, 595,855 comparisons, 0 divergences** — up 52,369 from
the twenty new calls. `path` is 29 of 39; the ten left are `format`,
`matchesGlob` and `_makeLong` across the two namespaces, which is the surface
that does not publish compiled anyway.

**`console` is still not measurable by this instrument and is left saying so.**
Its corpus calls methods on a constructed `Console` instance, and those methods
are own properties of the instance rather than of the namespace or the
prototype — the arrow-field shape recorded in
`blockers/an-arrow-class-field-using-this`. A namespace shim cannot see them.
The remaining rows above are real gaps and are recorded as open rather than
closed quietly.

### Two wrong measurements before the right one

Worth recording because both looked plausible and both undercounted.

The first matched a function's name against each call's **label**, and reported
`console 0/25` — the console corpus calls `log`, `warn` and `error` from inside
a `call()` whose label is `"console-program"`, so the heuristic could not see
them.

The second wrapped every function on the **module namespace** with a counter,
which is accurate for corpora that call top-level functions and blind for those
that go through a constructor or a namespace. It reported `console 1/25` and
`path 1/13` — both wrong, because those corpora call `new m.Console(...)` and
`m.posix.resolve` respectively.

Only the rows where a corpus calls top-level functions directly are trustworthy,
and `os` is one of them. **The other rows in that table are not evidence**, and
the audit is unfinished for every corpus that builds an object first.

## Auditing the applicability rules: no unjustified exclusion, and two proven

2026-09-10. The standing rules forbid weakening applicability rules. That
protects against loosening them; it does not check whether the ones already in
place are earned. A test wrongly marked not-applicable hides a result as surely
as a weakened one, so the six exclusions across `os` and `path` were read and
two were **controlled rather than trusted**.

Every one carries a reason, and they fall into two kinds:

| kind | example |
| --- | --- |
| §13 language non-goal | `test-os-checked-function.js` — replaces a method on node's private `os` binding |
| hollow oracle | `test-os-constants-signals.js` — passes against a module that implements nothing |

The second kind is the interesting one, because "this test cannot fail" is a
claim about a test rather than about our code, and it is checkable.

**`test-os-constants-signals.js`, proven.** Line 10 is

    assert.throws(() => constants.signals.FOOBAR = 1337, TypeError);

Against an empty module, `constants` is `undefined`, so `constants.signals`
throws `TypeError: Cannot read properties of undefined` — **the same `TypeError`
the test asserts**. It passes whether or not the module implements a single
signal. The real module reads 33.

**`test-path-posix-exists.js`, proven.** Line 6 is

    assert.strictEqual(require('path/posix'), require('path').posix);

Against a module with no `posix`, both sides are `undefined` and
`undefined === undefined` holds. The assertion cannot distinguish a correct
self-reference from a total absence. `test-path-win32-exists.js` is the same
assertion for `win32`.

So these exclusions are **the `0 hollow` discipline applied to applicability**:
they remove tests that would otherwise contribute passes no implementation
earned. Counting them would inflate `os` from 5 to 6 and `path` from 15 to 17,
and every one of those three would be hollow.

> This is the "control your own harness" rule turned on the applicability rules
> themselves. Reading the reason beside an `n/a` is not the same as running the
> test against nothing and watching it pass.

## `Buffer.from` has four heads; one is cleared and `string_decoder` has not moved

2026-09-10, 03:14 binary against the 02:53 one. MainClaude's optional-`in` work
landed between them, and this is the before and after on the same file and the
same lines rather than a delta:

    02:53   184  an `in` on something that is not an object
            189  an `in` naming `length` on an `object` … declares optionally
            196  an erased value where a concrete representation is wanted
            218  `i`, which `UnknownArrayLike` does not declare

    03:14   184  an `in` on something that is not an object
            196  an erased value where a concrete representation is wanted
            218  `i`, which `UnknownArrayLike` does not declare

**189 is cleared, confirmed positively rather than by absence**: a probe holding
`hasArrayLikeShape` and `isTypedArrayView` side by side publishes the first and
refuses only the second.

**`string_decoder` is unmoved** — 0 passed / 5 failed, five cascades still
naming `Buffer.from`. Which is exactly the shape the standing rules warn about:
a refusal cleared is not a fix delivered, and what replaced it has to be shown.
Here nothing replaced it; three of the four heads were always there and the
module needs all four.

### The root of 184 is not an `in` at all

A verbatim copy of `isTypedArrayView` in a standalone program reproduces the
refusal **and reports a second one in the same file**:

    a base `ArrayBufferView` of unrepresentable type (`ArrayBufferView`)

`ArrayBuffer.isView(value)` narrows `value` to `ArrayBufferView`, and an `in` on
a type the compiler cannot represent reads as "not an object". So 184 is
`ArrayBufferView`'s representability wearing an `in` message — the third
instance today of a diagnostic naming something other than its cause.

### A rewrite I considered and did not make

`isTypedArrayView`'s structural test could be nominal — `value instanceof
Uint8Array || value instanceof Int8Array || …` — and **that form compiles
cleanly**, checked rather than assumed. It would not be a weakening either: the
set of typed-array classes is fixed and enumerable, and node's own `Buffer.from`
uses nominal bindings rather than structural tests, so it is arguably the closer
shape.

**It would still gain nothing.** 196 and 218 are separate heads in the same
cone, and `Buffer.from` needs all three cleared. Rewriting a hot central
dispatch to clear one of three, with the risk that carries, is churn — so it is
recorded here rather than done, with the measurement that says why.

> 218 is worth one line for whoever takes it: `UnknownArrayLike` **does**
> declare `readonly [index: number]: unknown`. The refusal says `i` is not
> declared, which reads as the index signature not being consulted for a
> non-literal index.

## The compiled lane, differentially: 0 behaviour divergences in three modules

2026-09-10, on a post-`a80dcb8a` pin. `differential-ts.mjs` asks whether the
**TypeScript** answers what node answers. `differential-addon.mjs` asks it of
the **built artifact**, which is the compiled axis's own question and had never
been swept.

    punycode  140,224 comparison(s) over 20,000 random + 32 fixed   0 divergences
    os        340,238 comparison(s) over 20,000 random + 14 fixed   0 divergences
    path      420,882 comparison(s) over 20,000 random + 42 fixed   40,084 divergences

**`os` at 340,238 comparisons is the one worth pausing on.** It is the module
`differential-ts.mjs` *skips* — its bindings stand in as node on the TypeScript
lane, so the comparison there would be node against node — and this is the
instrument that skip points at. It has now been asked, and it agrees with node
everywhere.

### `path`'s 40,084 divergences are one missing export

Not forty thousand defects, and the arithmetic says so exactly. At 2,000
iterations:

    42,882 comparison(s) over 2,000 random inputs and 42 fixed
     4,084 divergence(s)

**4,084 = 2,042 × 2.** Every input diverges exactly twice — `posix.format` and
`win32.format`, one per namespace — and every printed divergence is
`format is not a function`. There is no third thing hiding in the count.

`format` declines with `no wrapper for format@posix: takes an object`, which is
already filed as `blockers/object-parameter-at-the-wrapper` with `path`'s cost
recorded on it. So the compiled `path` addon has **zero behaviour divergences**:
everything it publishes answers what node answers on twenty thousand generated
inputs, and the only difference is a name it does not publish at all.

**A missing export diverges on every input, so the count measures the input
volume and not the defect count.** Reporting "40,084 divergences in `path`" would
be true of the number and false of the artifact — the same shape as a refusal
delta standing in for a fix, in a different instrument.


### `buffer` reported "0 divergences" over 0 comparisons

Widening the sweep to three more modules produced two results and one blank:

    querystring   2,019 comparison(s)   0 divergences
    util          2,024 comparison(s)   0 divergences
    buffer            0 comparison(s)   0 divergences

**`buffer`'s addon publishes five names and its corpus calls twenty-nine
others.** The overlap is empty, so nothing was compared, and the instrument
printed `0 comparison(s) ... 0 divergence(s)` and exited 0. Read down a column
of modules, that row is indistinguishable from a module that agreed with node
everywhere.

The reporter already listed the absent names above that line. It was not enough:
nobody reads the absent list when the number beside it is zero.

`differential-addon.mjs` now refuses to report a run that compared nothing as a
run — it prints `NOTHING WAS COMPARED`, says the zero is a blank rather than a
result, and exits non-zero. Verified both ways: the guard fires on `buffer` and
stays silent on `punycode`.

This is the same failure this ledger recorded for the `stream` corpus a few
hours earlier — a check that exercises nothing announces itself as a pass, which
is what everybody wants to see — and it is the reason the sabotage count, not
the divergence count, is the number to read on any new comparison.


### The compiled differential cannot advance the axis, only describe it

Sweeping `differential-addon.mjs` wider was the obvious next lever and it does
not exist. Three more modules, 1,500 iterations each:

    string_decoder   0 comparison(s)   [BLANK]
    events           0 comparison(s)   [BLANK]
    assert           0 comparison(s)   [BLANK]

**All three addons publish nothing at all** — zero names, so there is nothing
the corpus can call and nothing to compare.

The instrument's reach is therefore **downstream of the axis**: it can ask
questions only of modules that already publish, which are exactly the modules
that are not blocked. A blocked module offers it no surface, so no amount of
sweeping turns one into a passing one. It describes the axis; it cannot move it.

That is worth stating plainly because the opposite is intuitive — a differential
found `net.BlockList`'s wrong error code in the interpreted lane, so reaching
for it again on the compiled side looks like the same move. It is not: the
interpreted lane runs the TypeScript directly and every export is present, while
the compiled lane can only see what the wrapper published.

**The guard added earlier tonight paid for itself immediately.** Three blanks in
one sweep, each of which would have printed `0 comparison(s) ... 0
divergence(s)` and exited 0 an hour ago — three rows that would have read as
three clean modules.

## The counted lane: 22 of 22, 0 differing

2026-09-10, on a pin taken after `a80dcb8a`. **This is the standing goal's named
missing deliverable and it is met.** Every building module measured counted and
uncounted, side by side, with the comparison `counted-lane.sh` does not make.

| module | files | counted result | rc sites |
| --- | ---: | --- | ---: |
| `process` | 153 | 1 passed, 90 failed | 3,875 |
| `fs` | 395 | 2 passed, 344 failed, 7 skipped | 3,468 |
| `net` | 181 | 2 passed, 148 failed, 7 skipped | 2,816 |
| `dgram` | 110 | 0 passed, 77 failed, 2 skipped | 2,782 |
| `zlib` | 74 | 1 passed, 67 failed | 2,561 |
| `readline` | 29 | 1 passed, 26 failed | 2,544 |
| `stream` | 269 | 1 passed, 249 failed, 4 skipped | 2,500 |
| `console` | 39 | 0 passed, 19 failed | 1,998 |
| `util` | 54 | 2 passed, 23 failed | 1,962 |
| `assert` | 26 | 0 passed, 12 failed | 1,887 |
| `events` | 52 | 0 passed, 32 failed | 1,800 |
| `http` | 451 | 1 passed, 405 failed, 4 skipped | 1,652 |
| `url` | 53 | 0 passed, 50 failed | 1,479 |
| `os` | 13 | 5 passed, 4 failed | 1,021 |
| `querystring` | 9 | 1 passed, 7 failed | 889 |
| `string_decoder` | 6 | 0 passed, 5 failed | 824 |
| `buffer` | 98 | 2 passed, 54 failed, 1 skipped | 822 |
| `path` | 23 | 15 passed, 5 failed, 1 skipped | 559 |
| `timers` | 70 | 2 passed, 56 failed | 441 |
| `async_hooks` | 155 | 2 passed, 115 failed | 403 |
| `diagnostics_channel` | 60 | 0 passed, 33 failed | 384 |
| `punycode` | 3 | 3 passed, 0 failed | 55 |
| **22** | | **0 differing** | **36,722** |

**Every row is identical between the two columns**, across **36,722
reference-counting sites**. Reference counting changes nothing observable in any
module in the tree.

Two things are worth reading off the table rather than the headline:

- **The site counts span two orders of magnitude** — `punycode` at 55 against
  `process` at 3,875. "0 differing" is a far stronger statement about `process`
  than about `punycode`, and a single number for the lane hides that.
- **A module failing 405 files still has to fail them identically.** `http` is
  1 passed / 405 failed on both sides. The lane is not asking whether a module
  passes; it is asking whether the allocator changes what it does, and a
  failing module answers that question as well as a passing one.

`path` is the row that matters most from today's work: **15 passed / 5 failed
counted, matching the uncounted axis exactly**, so both fixes made in that
module today hold with reference counting enabled.

### It was recorded as unmet at 10 of 22, and that was the wrong call

Five runs were killed by something outside the command with no diagnostic, and I
wrote the deliverable up as unmet with its partial rows. The write-up ruled out
the disk, my own timeouts, `cargo`, and the loop shape by check rather than
assumption — and then offered four successive explanations, each contradicted by
the next attempt:

    "long runs die here"            four longer runs completed the same night
    "the loop is the problem"       decomposing made it die sooner, 2 rows not 5
    "batches of five work"          a batch of six died
    "it is the work per task"       `events` alone, 52 files, died where a
                                    batch totalling 54 had just completed

The last guess was that heavy `clang` work from the other two sessions was
contending for the box, and that **retrying would burn capacity a peer was
actively using**. That was defensible when written and wrong within the hour:
contention eased, the same batches completed on the first retry, and the
remaining twelve modules landed in seven more runs.

**The error was recording a transient condition as a settled one.** The
mechanism is still unknown and is still written down as unknown — a `killed`
status says something stopped the process, not that the process failed, and
nothing here established what. But a deliverable marked unmet should carry a
retry rather than a conclusion, and this one carried a conclusion.

## Every compiled pass classified: 41 = 31 behaviour + 10 shape-only + 0 hollow

2026-09-10, post-`code`-fix pin. **The classification reconciles exactly with
the axis** — 41 passes counted by the runner, 41 accounted for here — which is
the check that neither number was assembled by hand.

| module | pass | behaviour | shape-only | hollow |
| --- | ---: | ---: | ---: | ---: |
| `path` | 15 | 13 | 2 | 0 |
| `os` | 5 | 3 | 2 | 0 |
| `punycode` | 3 | 3 | 0 | 0 |
| `async_hooks` | 2 | 1 | 1 | 0 |
| `buffer` | 2 | 1 | 1 | 0 |
| `fs` | 2 | 1 | 1 | 0 |
| `net` | 2 | 2 | 0 | 0 |
| `timers` | 2 | 2 | 0 | 0 |
| `util` | 2 | 2 | 0 | 0 |
| `http` | 1 | 0 | 1 | 0 |
| `process` | 1 | 0 | 1 | 0 |
| `querystring` | 1 | 1 | 0 | 0 |
| `readline` | 1 | 1 | 0 | 0 |
| `stream` | 1 | 1 | 0 | 0 |
| `zlib` | 1 | 0 | 1 | 0 |
| **15** | **41** | **31** | **10** | **0** |

**`0 hollow` across every module that has a pass**, under all three controls —
`--sabotage`, `--empty-exports`, `--mutate-addon`. Nothing in the compiled lane
passes because a test could not fail.

Three modules — `http`, `process`, `zlib` — have **only** a shape-only pass. Their
single pass each is a statement about a surface rather than about behaviour,
and reporting them in a bare "15 of 22 modules have a pass" makes them sound
like the others. They are not the same claim.

### The first version of this table was wrong and the arithmetic said so

The run before this one covered fourteen modules and summed to **39 against an
axis of 40**. Two separate errors, and neither was visible in any single row:

- **`fs` was missing from my own module list.** Not skipped with a reason, not
  reported as unmeasurable — simply absent from the loop I wrote, and a table
  of fourteen plausible rows says nothing about the fifteenth.
- **`timers` read 2 where the sweep read 1**, because the two ran on different
  pins. That one was real drift rather than an error, and it is why the sum was
  39 and not 38.

The sum not matching the axis is what surfaced both. **A per-module table that
is never added up cannot catch a missing module**, and this one is now stated
with its total beside the independent count it has to equal.

## What `fs` is actually waiting on: two items are 35% of it

2026-09-10, post-`code`-fix pin. `fs` is **2 passed, 344 failed** of 395 files,
unchanged by that fix, and it is the largest module in the tree.

### The tests say "not a function", and mean "not compiled"

Ranked by test files rather than by diagnostic text, the top failures are all
absences:

    40  Expected values to be strictly deep-equal:
    36  mkdirSync is not a function
    31  fs.writeFileSync is not a function
    30  fn was called 0 times, expected 1
    22  fs.openSync is not a function
    21  fs.mkdirSync is not a function
    12  fs.mkdtempSync is not a function
    11  cpSync is not a function
    10  fs.createWriteStream is not a function
    10  fs.createReadStream is not a function

**Not one of the top ten mentions an error, a code or a type.** Whatever the
fourteen files predicted to move on the error-`code` fix were waiting for, this
is what the module is waiting for.

And the wrapper is not the wall either — **95 of its 123 wrapper declines are
`is exported and no function of that name was compiled`**, which is a cascade,
not a wrapper gap. Every one of the six named functions above declines for that
reason. The 2,027 `NTS1001` are the module.

### 202 own roots, 63 constructs, and two of them are a third of it

| count | construct |
| ---: | --- |
| **43** | `#closeCapability` of unrepresentable type — `PromiseWithResolvers<void> \| undefined` |
| **19** | `reject`, captured above its own declaration, where it has no value yet |
| 12 | a rest parameter that is not an array |
| 10 | `null`/`undefined` where what it stands in for is not representable |
| **8** | `resolve`, same capture form as `reject` |
| 8 | an optional-chained method call (`a?.b()`) |
| 7 | an erased value where a concrete representation is wanted |
| 7 | a method call on something without methods |

`promises.ts:584` declares `#closeCapability: PromiseWithResolvers<void> |
undefined`, and it accounts for **43 of 202 roots on its own**. The
`resolve`/`reject` pair is one shape too — the `new Promise((resolve, reject) =>
…)` executor, where both names are referenced from a closure written above their
own binding, at 27 sites between them.

**Two items, 70 of 202 roots, 35% of the module.** Nothing else in the table is
above 12.

> The 63-construct spread is why `fs` sits last but one in the roots table and
> why it will not clear in one step. It is also why naming the top two matters:
> a module with 63 distinct blockers gets read as "everything is broken" and
> deprioritised, when a third of it is two shapes.

## The `code` on a thrown error had two halves, and I measured the wrong one

### Re-measured after the `code` fix: 40 to 41, and not where it was expected

The prediction was that the fourteen `fs` files where a missing error `code` was
the only wall would move. **They did not.** Full axis on a post-fix pin, all 22
modules, one per invocation:

    before: 40 passed, 1,822 failed, 15 module(s) with a pass, 1 whole
    after:  41 passed, 1,821 failed, 15 module(s) with a pass, 1 whole
    built=no: 0 of 22

The only module that moved is `timers`, +1 — and the hollow run had already read
`timers` at 2 against the sweep's 1 before this fix landed, so even that one is
probably not it.

`fs` is unchanged at 2, and its refusal profile is **byte-identical** across the
two pins:

    NTS1001          2027  ->  2027
    wrapper declines  123  ->   123

That identity is expected rather than suspicious, and the reason is the shape of
the defect: the two-modifier bug **emitted no diagnostic**. It dropped a store
silently. So the fix changes what a compiled program *does* and not what it
*refuses*, and a census of refusals cannot see it in either direction.

**This is the refusal-delta rule reading the other way.** The usual failure is
counting a drop in refusals as progress; here the count did not move at all and
a real fix landed underneath it. Verified separately: `os.getPriority` on eight
range inputs went from 0 of 8 agreeing on `code`, `name` and
`instanceof RangeError` to 8 of 8.

So the fix is real, it is worth having, and **it bought one test file or none**.
Whatever those fourteen `fs` files were waiting on, the error `code` was not
their only wall.


2026-09-10. I reported that `ERR_OUT_OF_RANGE` arrives as a plain `Error` with
the code moved into `name`, measured in `os` and `buffer` with `path`'s
`ERR_INVALID_ARG_TYPE` as the control, and I could not reduce it — a fixture
with a `TypeError` subclass and a `RangeError` subclass written the same way
failed its own control.

**It failed its own control because the fixture had one modifier and the real
code has two.** MainClaude found it:

    class A { a = "1"; }                     store emitted
    class B { readonly a = "22"; }           store emitted
    class C { public readonly a = "333"; }   no store, and no diagnostic

A property declaration with **two or more modifiers lost its initialiser**. The
modifiers occupy one slot with any number of children and the slot walk took
one, so every slot after them shifted, the name read back as `readonly`, the
lowering looked for a field of that name, found none, and continued — which is
right for a member that is not a field and exactly wrong for a field whose name
it has misread.

`internal/errors.ts` writes `override readonly code = "ERR_…"` on **ninety-four**
classes. So `code` was never set inside the compiled program at all, and nothing
at the boundary could have carried it. Every fixture in the tree used at most one
modifier, which is why it survived.

The boundary half I did measure was real and is also fixed: `nts_thrown_class`
answered with the class's own name, so the wrapper's comparisons against
`RangeError`/`TypeError` missed and it built a generic error with `name` set to
the class — the right string under the wrong property.

**Verified here rather than taken.** `os.getPriority` on eight range inputs:

    8 of 8 agree on `code`, on `name`, and on `instanceof RangeError`

None agreed before, on any of the three.

### What this cost me, and it is the fixture rule again

My deleted fixture was right to be deleted — it did not reproduce. But the
*reason* it did not is the finding: a reduction that simplifies away a modifier
simplifies away the defect. That is [[reduction-removes-the-precondition]] in a
new place, and the tell was there in the failing control, which I read as "my
minimal shape does not reproduce what `path` does" and stopped at rather than
asking why one modifier differs from two.

MainClaude's own `a-thrown-code-at-the-boundary` has the mirror problem and they
labelled it rather than widening it: its class writes `code = "ERR_FIXTURE"` with
no modifiers, so it only ever reproduced the boundary half and **would have gone
green on that fix alone while every error in the tree still arrived without a
code**.

> The three module measurements in the `os` section above stand as measurements
> and their stated cause was the wrong half. Corrected here rather than edited
> there, so the wrong reading stays visible next to what replaced it.


## Both lanes, 2026-09-10

Re-derived end to end tonight, one module per invocation so a lost run costs one
row rather than the sweep. All 22 rows present in both lanes — a module that
produces no row is indistinguishable from one that was never run, so the count
of rows is stated beside the count of passes.

**Interpreted — TypeScript on node: 1,859 passed, 0 failed, 22 of 22 rows.**

    assert 12   async_hooks 117   buffer 56    console 19   dgram 77
    diagnostics_channel 33         events 32   fs 346       http 405
    net 150     os 9              path 20      process 89   punycode 3
    querystring 8                 readline 27  stream 250   string_decoder 5
    timers 58   url 50            util 25      zlib 68

Unchanged from the last confirmed figure, which is the point: `process.c` and
`path/shape.mjs` both changed today and neither cost anything here.

**Compiled — Node-API addon: 40 passed, 1,822 failed, 15 of 22 modules with at
least one pass, 1 whole.** All 22 build.

The two lanes are not comparable as ratios and the gap is not a defect count.
The interpreted lane runs the same TypeScript through node, so it measures
whether the source is right; the compiled lane measures whether this compiler
can express it. Everything in the gap is the second question.

`punycode` remains the only whole module. `path` is the nearest at 15 of 20
applicable, and `string_decoder` is the nearest by work remaining rather than by
passes — see the root table above.

> Every number here is from 2026-09-10 and is historical the moment it is read.
> The compiled figures come from a pin taken at 00:59; the interpreted lane has
> no compiler in it.

## Ranking the 22 by roots in their own source

2026-09-10. Pass counts say which modules are furthest along. They do not say
which are closest to *clearing*, because a module with two passes and forty
roots of its own is further from whole than one with no passes and none.

The count that answers it is **`NTS1001` roots reported inside the module's own
`src/`** — a root is a construct the compiler refuses outright, while a cascade
(`NTS1003`) is only a consequence of one. A module with zero roots is blocked
entirely on other people's work.

| module | own roots | cascades | wrapper declines |
| --- | ---: | ---: | ---: |
| `punycode` | **0** | 0 | 0 |
| `string_decoder` | **0** | 5 | 2 |
| `os` | 1 | 1 | 2 |
| `querystring` | 1 | 3 | 5 |
| `path` | 4 | 9 | 7 |
| `dgram` | 13 | 34 | 2 |
| `diagnostics_channel` | 19 | 7 | 7 |
| `async_hooks` | 20 | 5 | 13 |
| `console` | 20 | 5 | 5 |
| `timers` | 28 | 7 | 29 |
| `events` | 30 | 19 | 16 |
| `buffer` | 35 | 20 | 10 |
| `process` | 38 | 32 | 5 |
| `url` | 39 | 48 | 13 |
| `net` | 45 | 63 | 13 |
| `assert` | 49 | 5 | 24 |
| `readline` | 71 | 6 | 14 |
| `util` | 73 | 22 | 33 |
| `zlib` | 97 | 9 | 66 |
| `http` | 145 | 88 | 25 |
| `fs` | 202 | 257 | 123 |
| `stream` | 456 | 142 | 65 |

**`punycode` is 0 / 0 / 0 and it is the one whole module.** That is the check on
the instrument rather than a result from it: the only module that has cleared
everything is the only one with nothing left, and nothing else in the table
comes first by accident.

Two things this ordering says that the pass counts do not:

- **`string_decoder` sits second, on zero passes.** Every one of its five
  declines is somebody else's, all of them `Buffer.from`/`Buffer.alloc`. By
  passes it looks worse than `buffer` or `util`; by what stands between it and
  whole it is second in the tree.
- **`dgram` is the next tier at 13, ahead of `console` and `events` at 20 and
  30**, which have comparable pass counts. Nothing in the pass column suggests
  that order.

`assert` is the clearest case of the opposite reading: 49 roots and 24 wrapper
declines, and its entire published surface refuses with `is exported and is not
a function this backend can name`. It is a small module by test count and a
large one by work.

### Distinct constructs, which reorders the middle of the table

Raw root counts overstate a module where one construct is refused at many call
sites. Counting **distinct** refusal texts instead:

| module | roots | distinct | the one that dominates |
| --- | ---: | ---: | --- |
| `string_decoder` | 0 | 0 | — |
| `os` | 1 | 1 | `userInfoString, a declaration outside every walk` (the Buffer one) |
| `querystring` | 1 | 1 | `decodeURIComponent`, a builtin this compiler does not provide |
| `path` | 4 | 4 | nothing repeats; two are `RegExp` |
| `diagnostics_channel` | 19 | **5** | 12 of 19 are `#map` of type `Map<string \| symbol, WeakRef>` |
| `async_hooks` | 20 | **6** | 10 of 20 are members of one class, `AsyncLocalStorage` |
| `dgram` | 13 | 10 | 3 are `a?.b()` |
| `timers` | 28 | 13 | 6 are a module-scope initializer that was refused |
| `console` | 20 | 14 | 5 are `this` outside a method |
| `events` | 30 | 24 | 3 are `null`/`undefined` where what it stands in for has no representation |

**`diagnostics_channel` and `async_hooks` move up several places.** By roots they
sit behind `dgram`; by distinct constructs they are ahead of it, and each is
dominated by a single item — a `WeakRef`-valued `Map` in one and one class in
the other. `events` moves the other way: 30 roots and 24 distinct is the most
varied work in the near tier, and nothing there concentrates.

Both dominant items are already filed. `weakref-property` expects
`a property #map of unrepresentable type (Map<string, WeakRef>)` and already
names `diagnostics_channel` in its own prose; the live message differs only in
the key being `string | symbol`.

> Provenance: counted from per-module build logs on a pin taken at 00:23.
> `string_decoder`, `os` and `path` were re-derived on a 00:59 pin unchanged.
> Roots are counted as reported, so a single construct refused at two call sites
> counts twice — the column is an ordering, not an inventory.

## `Buffer.from` is the largest single item on the compiled axis

2026-09-10. Found by taking `string_decoder` as the smallest remaining module
and reading what it actually stops at, rather than by ranking diagnostics.

`string_decoder` is **0 of 5 compiled, 5 of 5 interpreted**, and it has **zero
`NTS1001` roots in its own source**. Every decline is a cascade:

    src/main.ts:32   bytesOf                    calls `Buffer.from`
    src/main.ts:105  StringDecoder#constructor  calls `Buffer.alloc`
    src/main.ts:120  StringDecoder#write        calls `bytesOf`
    src/main.ts:172  StringDecoder#text         calls `bytesOf`
    src/main.ts:147  StringDecoder#end          calls `StringDecoder#write`

Which is why four of its five failures are one sentence, `StringDecoder is not a
constructor`, and the wrapper's own words are `no wrapper for StringDecoder: is
a class whose constructor was not compiled`. Two names hold the module shut.

The root is `Buffer.from`'s polymorphic dispatch, `buffer/src/main.ts:184-218`:
an `in` on something that is not an object, an `in` naming `length` on an
`object`, an erased value where a concrete representation is wanted, and `i`
which `UnknownArrayLike` does not declare.


### The three prerequisites `string_decoder` was said to need are all present

The standing goal text says `string_decoder` "needs the export-class arm, three
prototype accessors to cross, and `lastChar` to reach the host answering
`.equals`". Probed individually on the 01:29 pin, because the module itself
cannot ask any of these questions while `Buffer` blocks it:

| prerequisite | measured |
| --- | --- |
| the export-class arm | **present** — a class with a constructor, a method and a getter crosses with no decline, and `addon.c` emits `napi_define_class` |
| prototype accessors | **cross** — the getter lands in the accessor slot, not the method slot |
| a typed array reaching the host | **crosses outward**, per the section above |

The accessor is emitted as a real one rather than a method that happens to
answer:

    { "add",   NULL, nts_napi_Counter__add, NULL, NULL, NULL, napi_default, NULL },
    { "value", NULL, NULL, nts_napi_Counter__get_value, NULL, NULL, napi_default, NULL },

Third slot is the method, fourth is the getter. `add` fills the third and
`value` fills the fourth.

**So the remaining distance is one item, not four.** `StringDecoder` declines as
`is a class whose constructor was not compiled`, and the constructor is not
compiled because it calls `Buffer.alloc`. Everything the class would need on the
far side of that already works.

**What this does not license.** `local/core-static.js` wants `lastChar`,
`lastNeed` and `lastTotal` as prototype accessors with `lastChar` a Buffer
answering `.equals`. The *mechanisms* are all present, and that is not the same
as the assertion passing — the outward typed-array path has never carried a
Buffer subclass with `.equals` on it, because no module has got far enough to
try. Whether the module comes to 4 of 5 or 5 of 5 is undetermined until `Buffer`
lands, and it is written here as undetermined rather than as either number.

### Reach, and then what clears

Thirteen of 22 modules carry functions cascading directly from
`Buffer.from`/`Buffer.alloc` — 101 of them before their own downstream
cascades:

    fs 14   process 14   http 11   zlib 9   dgram 8   net 8   stream 7
    readline 6   string_decoder 6   url 6   buffer 4   os 4   querystring 4

Reach is the wrong column and this ledger has said so before. The one that
answers the question is roots-of-their-own:

| module | own roots | what that means |
| --- | --- | --- |
| `string_decoder` | **0** | clears outright on `Buffer.from`/`alloc` |
| `querystring` | 1 | `decodeURIComponent`, a builtin this compiler does not provide |
| `os` | 1 | which is the Buffer refusal itself, wearing a different message |
| `url` | 39 | |
| `readline` | 71 | |
| `zlib` | 97 | |

So the honest claim is **one module clears and two are one item away**, not
"thirteen modules are blocked on Buffer". `string_decoder`'s ceiling afterwards
is **4 of 5**, not 5 — `local/core-static.js` wants `lastChar`, `lastNeed` and
`lastTotal` as prototype accessors with `lastChar` a Buffer, which is node's
shape and stays as it is. Four of five, with the reason.

### The same cause wears two diagnostics

This is the part that cost an hour and belongs beside
[[one-message-is-not-one-cause]] in the ledger's own terms:

    string_decoder   NTS1003  `bytesOf` … calls `Buffer.from`, which was refused above
    os               NTS1001  `userInfoString`, a declaration outside every walk

**The `os` message does not contain the word Buffer.** It names a helper and a
walk, which is why the first hour there went into the helper's declaration
position and then into `userInfo`'s overload signatures — a fixture for the
overload theory was written, did not reproduce, and was deleted. The
`String.fromCharCode` substitution answered it in one build.

Any census that ranks by message text splits this single item in two and ranks
both too low. The 2026-09-09 ordered list in this file does exactly that.

> Provenance: the 13-module counts are from sweep logs built on a pin taken at
> 00:23. `string_decoder` and `os` were re-derived on a 00:59 pin and are
> unchanged.

## `os` is 4 of 9, and four of the five failures name one export

### 2026-09-10: 5 of 9, and the three causes behind the four failures

> Re-derived against a pin taken at 00:59 from `target/release/nts`, with
> `NTS_ADDON_OUT` set. The section below is 2026-09-09 and reads 4 of 9. The
> same numbers came from a 00:23 pin and a 00:59 pin, so they do not turn on
> which of MainClaude's commits was in the tree.

**Interpreted: 9 passed, 0 failed.** Every one of the four compiled failures is
a boundary or lowering question, not a behaviour I got wrong.

| file | cause |
| --- | --- |
| `test-os-process-priority.js` | the wrapper coerces before my validation runs |
| `local/constants-table-static.js` | `userInfo` — `Buffer` used inside the module |
| `local/core-static.js` | `networkInterfaces` — `returns Record<string, unknown[]>` |
| `local/export-surface-static.js` | the two above, as `2 wrong type` |

#### The validation is dead code compiled

`validateInt32(value: number, …)` opens with `if (typeof value !== "number")`,
and compiled **that branch can never be taken**. The wrapper converts the
argument to a double before my TypeScript sees it, so node's seven type cases
arrive as numbers:

    getPriority(null)   ours 0 -> no throw     node ERR_INVALID_ARG_TYPE
    getPriority(false)  ours 0 -> no throw     node ERR_INVALID_ARG_TYPE
    getPriority('foo')  ours NaN -> range      node ERR_INVALID_ARG_TYPE
    getPriority({})     ours "no representation at the boundary"

Node validates in JavaScript and sees the value it was handed. This is the same
root as `path.toNamespacedPath`, which node defines as
`if (typeof path !== 'string') return path` — **two modules, one fixture**,
`blockers/unknown-at-the-boundary`. MainClaude reached the same finding
independently at 01:12 in `2d544711`, from the `setPriority(1, "y")` side.

#### `userInfo` is blocked by `Buffer`, and the message does not say so

    os/src/main.ts:395:2   NTS1001 `userInfoString`, a declaration outside every walk
    os/src/main.ts:443:13  NTS1003 `userInfo` … calls `userInfoString`, refused above

`userInfoString` is one line: `Buffer.from(bytes).toString(encoding)`. Two
experiments place it and neither is a guess:

- **inlining the helper moved the refusal onto `userInfo` itself**, so the
  helper's declaration was never the thing;
- **replacing the `Buffer` call with a `String.fromCharCode` loop removed every
  `os/src/main.ts` decline and published `userInfo`.** That change was reverted
  immediately — it is a diagnostic, not a fix, because
  `os.userInfo({ encoding: 'buffer' })` genuinely returns Buffers.

So the cause is using `Buffer` inside a compiled module, and the diagnostic names
a function and a walk. This is the seventh time in this ledger that the message
describes something other than the cause. It could not be reduced to a fixture:
`Buffer` is not ambient in a standalone blockers program, the same wall
`process` hit earlier today.

#### `ERR_OUT_OF_RANGE` loses its `code` crossing the wrapper

Measured, not reduced. Three modules, and the third is what makes it a claim
about one class rather than about error identity in general:

| module | thrown | arrives as |
| --- | --- | --- |
| `os` | `ERR_OUT_OF_RANGE` | `Error`, own props `[stack, message, name]`, `name = "ERR_OUT_OF_RANGE"`, no `code` |
| `buffer` | `ERR_OUT_OF_RANGE` | the same, in a build sharing only `internal/errors.ts` |
| `path` | `ERR_INVALID_ARG_TYPE` | `TypeError`, own props `[stack, message, code]`, `code = "ERR_INVALID_ARG_TYPE"` — node's shape exactly |

The `os` message is byte-identical to node's. Only the identity is wrong, and
`assert.throws(fn, { code: 'ERR_…' })` is how node's suite states nearly every
error expectation — so this sits underneath an unknown number of failures that
currently look like unrelated behaviour differences.

`internal/errors.ts` declares `NodeTypeError extends TypeError` and
`NodeRangeError extends RangeError` with the same three members, so the
declaration is not the difference.

**I could not reduce it.** A fixture with a `TypeError` subclass and a
`RangeError` subclass written the same way — including the
`override get ["constructor"]()` that `errors.ts` puts on every base — failed
its own control: the minimal `TypeError` subclass did not cross intact either,
so it does not reproduce what `path` does. It was deleted rather than left in
the suite certifying nothing. The reduction is open, and the three module
measurements above are what stands.


Compiled lane, `target/node/os.node`, 2026-09-09:

```
pass  test-os-eol.js            FAIL  test-os-process-priority.js       ...priority
pass  test-os-fast.js           FAIL  local/constants-signals-static.js
pass  test-os-homedir-no-envvar FAIL  local/constants-table-static.js   ...signals
pass  local/binding-name-static FAIL  local/core-static.js              ...priority
 n/a  test-os-userinfo-...      FAIL  local/export-surface-static.js    os.constants is undefined
```

Four of the five say the same thing. `os` publishes seventeen exports and
`constants` is not among them:

```
hostname type release version machine arch platform homedir tmpdir
endianness uptime totalmem freemem availableParallelism loadavg EOL devNull
```

The wrapper's reason is `no wrapper for constants: is exported and no function
of that name was compiled` -- the same sentence it gives for `getPriority`,
`networkInterfaces`, `setPriority` and `userInfo`, which are functions that
cascaded. It is not the `is not a function this backend can name` arm, so this
is not the value-export family: `punycode` publishes `ucs2`, an object whose
members are functions, and `version`, a string. Object-valued exports cross.

The initializer is what did not:

```
os/src/main.ts:547  the initializer of `constants35` was not compiled
                    because it calls `readConstants`, which was refused above
os/src/main.ts:541  `name`, which `an anonymous type` does not declare
                      table[name] = value;
```

So `os.constants` is behind `computed-member-write`, which is already filed.

**That fixture and its read half are the highest-leverage pair in the profile.**
`computed-member-write` gates `os.constants`, which four of `os`'s five
compiled-lane failures name. `computed-member-read` gates `querystring`, whose
`ParsedUrlQuery` is an interface whose whole purpose is an index signature, and
which publishes nothing at all across 8 tests. Two modules, one representation
decision -- an index-signature type has no members and its keys are not known
until run time.

Both halves are filed separately and deliberately: a fix that lands writes and
not reads would flip `computed-member-write` to `guard ok` and nothing would say
the other half was still open.

## A pass on a module that publishes nothing is measuring something else

Twelve of the twenty-two addons publish **zero** exports. `--sabotage` blanks a
module and `--mutate-addon` keeps its names while destroying their behaviour;
both interrogate exports, so both are silent on an addon that has none. Nothing
to blank, nothing to poison, and an assertion comparing two absent values agrees
with itself under every lane we have.

`vacuous-lane.mjs` does no mutation. It states the arithmetic: an addon
publishing nothing cannot be the subject of a passing test.

```
fs      1 pass, 0 exports   test-fs-promises-exists.js
stream  2 pass, 0 exports   test-global-webstreams.js, test-stream-aliases-legacy.js
```

Both trace to the absent-export guards. Those guards are right -- one missing
export should report as one missing export, not as "the module did not load" for
every test in the module -- but they turn absence into `undefined` on *both*
sides of an identity assertion. `stream.Readable` is `undefined` because
`shape()` returned `{}`; `require('_stream_readable')` is `undefined` because
`callableConstructor` guards the same way; five such comparisons pass in a row.
`test-global-webstreams.js` is the other form: the `stream/web` subpath hands
back node's own `node:stream/web`, so both sides of every assertion are node's.

Neither moves the axis -- `stream`'s `export-surface-static.js` already fails,
and two passes sit inside 248 failures -- but the lane exists so that they
cannot be counted as progress as a module approaches green.

**The first draft could not have found them.** It used `execFileSync`, which
throws on the non-zero exit `run.mjs` gives whenever a test fails, so it reported
"not measurable" for `events`, `querystring` and `url` at once and would have
concluded "0 vacuous" while blind to exactly the population it searches.
`spawnSync` fixed it; 1 module measurable became 4.

### The blind-spot probe had two blind spots of its own

`shape-blindspot.mjs` reported `SUPPLIES 131 fs` the first time `fs` became
probeable. All 131 were `[object Undefined]`: the probe counted `undefined` as a
value the shim invented. A shim answering `undefined` is not answering for the
module, it is saying the module has nothing there. Absence is now reported as
absence -- `passes through fs (131 name(s) absent from the addon)` -- and
"supplies a value" keeps meaning what it says. Absence is still worth printing,
because it is the surface `vacuous-lane` searches.

The second was found by controlling the probe rather than reading it. Assigning
`qs.__probeControl = 42` inside `querystring`'s shim changed nothing in the
output. `querystring` returns `QueryString` itself rather than a copy -- so that
a test replacing `querystring.unescape` replaces the property `parse` will read
-- which means everything the shim adds is added to a sentinel, and the sentinel
proxy answered every key with a fresh sentinel and had no `set` trap. Writes
landed on the hidden function target and were masked on read. The shim could
have invented any value it liked and the probe would have said `passes through`.

With writes recorded, the control fires (`SUPPLIES 1 querystring`) and a real
finding appears that was never visible before: **`events` supplies 4**.

The traps must delegate to `Reflect` rather than answer `true`. Written the
short way they violate the proxy invariants for the non-configurable
`prototype`, `length` and `name` the function target carries, and `stream` went
from probeable to "shape() calls into the module" -- a regression in the
instrument that would have been read as a fact about the shim.

## The same defect reports three different messages depending on the entry set

`path`'s own-source roots went from six to four with no compiler landing and
no source edit, and the four `a property `expression` of unrepresentable type
(`RegExp`)` refusals in `src/glob-matcher.ts` were replaced by two messages
that name neither `RegExp` nor a property:

    glob-matcher.ts:28:22  a `new` with arguments and no constructor
    glob-matcher.ts:41:11  a method `test` with no declaration in the hierarchy

Read as a delta that is four cleared and two revealed, and the obvious reading
-- that `RegExp` fields now lower -- is wrong. **Nothing was fixed, and no
compiler moved.** The cause was `5e4af45d`, *this* session's commit naming the
entry explicitly in all twenty-two module tsconfigs. Before it, `include:
${configDir}/src/**/*` made every file in `src/` a root and
`GlobSegmentMatcher`'s declaration was walked. After it, `files:
["src/main.ts"]` reaches `glob-matcher.ts` only transitively and the class is
never walked.

**A harness change was read as compiler progress**, which is the same error as a
stale baseline and was caught only because the two messages were too specific to
be a coincidence. The control is below: the *same pin* reports six refusals
under `include` and four under `files`.

Held everything constant except the entry set -- one pin (v9, 09:11), all
extending `runtime/node/tsconfig.module.json` with `rootDir` at the repo root,
all compiling the identical 665-line `glob-matcher.ts`:

| entry set | what it reports for the same class |
| --- | --- |
| `files: [glob-matcher.ts]` | 4x `a property `expression` of unrepresentable type (`RegExp`)` at 23, 34, 269, 587 |
| `include: [path/src/**/*]` | the same four |
| `files: [path/src/main.ts]` | `a `new` with arguments and no constructor` (28), `a method `test` with no declaration in the hierarchy` (41) |

**The control that says the two runs are comparable** is the pair of refusals
they agree on: `an array method with this many arguments` at 453:25 and
`` `columns`, a name from an enclosing scope `` at 596:37, identical in both.
Without that pair the difference could have been two different files, two
different line numberings, or a failed compile.

Reached transitively, `GlobSegmentMatcher`'s declaration is never walked. So
`new RegExp(...)` finds no constructor to call and `expression.test(value)`
finds no hierarchy to search -- both true statements about a walk that did not
happen, and neither one a fact about `RegExp`.

Hand-written probes confirm the direction. Every route to a `RegExp` that walks
the declaration reports the property:

| probe | message |
| --- | --- |
| field assigned from `new RegExp(pattern)` | a property of unrepresentable type (`RegExp`) |
| field assigned from `/a/` | a property of unrepresentable type (`RegExp`) |
| field assigned from a parameter | a property of unrepresentable type (`RegExp`) |
| field from a parameter, then `.test()` in a method | the property, twice -- **not** `no declaration in the hierarchy` |
| `new RegExp(pattern, nocase ? "i" : "")` in a constructor | the property -- **not** `with arguments and no constructor` |
| local `const re = /a/; re.test(v)` | a regular expression literal, which needs a regular expression engine |
| local `const re = new RegExp(p); re.test(v)` | a `new` of unrepresentable type (`RegExp`) |

No hand-written program reproduces either of `path`'s two messages. That is
what says they are not features in their own right.

### What this costs a count

`a method X with no declaration in the hierarchy` is the message
`method-on-a-structural-type` was filed against, at 42 sites. Some unknown
share of those 42 are receivers of an unrepresentable type reached without
their declaration being walked, which is a different fix. **A count taken by
grepping message text across the profile is a count of message texts, not of
causes** -- and here one cause wears three.

`regexp-as-a-property` still reproduces on the same pin, so it stays. It is the
form that survives when the declaration is walked, which is the form a fix has
to address.

## The native half is 328 of 331, not 60% -- and the missing three are all in `internal/`

The standing figure was "roughly 125 of 309 declared bindings have no C
anywhere -- dgram 21 of 21, net 28 of 30, fs 60 of 133", and it named the
native half as the tranche that needs no compiler. **Re-derived with `nm`
against compiled objects, the gap is three.**

| module | declared | with C | without |
| --- | ---: | ---: | ---: |
| fs | 155 | 155 | 0 |
| process | 55 | 55 | 0 |
| net | 30 | 30 | 0 |
| **internal** | **22** | **19** | **3** |
| dgram | 21 | 21 | 0 |
| zlib | 20 | 20 | 0 |
| os | 18 | 18 | 0 |
| util | 10 | 10 | 0 |
| timers | 8 | 8 | 0 |
| buffer 3, path 2, stream 2, and one each in assert, async_hooks, console, events, readline, url | 12 | 12 | 0 |
| **total** | **352** | **349** | **3** |

352 counts a name once per module that declares it; 331 are distinct, 328 of
those have C. The three are `nts_next_tick`, `nts_promise_hook_install` and
`nts_promise_hook_uninstall`, declared in `internal/tick.ts` and
`internal/async-hooks.ts`. `nts_next_tick` is declared generic
(`<Args extends unknown[]>`), which no other binding is.

**Method, because the method is the whole result.** Every `runtime/node/*/*.c`,
`runtime/node/internal/*.c` and `runtime/c/*.c` compiled to an object with the
flags `build.sh` uses, then `nm --defined-only` over all fifteen objects.
Declared names came from `declare function` with `node_modules` excluded --
without that exclusion `@types/node` contributes 674 more names and the count
reads 1005.

**Three controls, because the number that was wrong was wrong three ways.**

1. *Symbol class.* `nm -D` reads the dynamic table, which an unlinked `.o` does
   not have; it previously reported 95 missing. Splitting `T`/`W` from `t`/`w`
   answers the question that actually matters -- a `static` implementation is
   present in the source and still fails to link. 656 global, 458 local, and
   **none of the three missing names is among the local ones**, so none is
   hidden by `static`.
2. *Absence in C at all.* Each of the three greps to zero hits across every
   `.c` and `.h` under `runtime/`. They are declared in TypeScript and
   implemented nowhere, rather than implemented somewhere this survey did not
   compile.
3. *`sed` on non-matching input.* The first extraction ran `sed s/.../.../`
   over grep output; `sed` passes through what it does not match, so unmatched
   lines were counted as names. That is the shape of the original error too:
   a regex that answers even when it has not matched.

What this changes: the native half is not a tranche of work. "Compiling is
necessary and not sufficient, `dgram` would fail to link whatever the compiler
does" is not supported by this measurement -- `dgram`'s twenty-one bindings all
have global definitions in `dgram/dgram.c`.

## Weak collections have no representation, and `internal/async-hooks.ts` is behind it

`a module-scope variable of unrepresentable type` reports at 18 distinct sites
and is not a fact about module scope. Four probes on one pin:

| at module scope | result |
| --- | --- |
| `const base = 5` | lowers |
| `new Map<string, number>()` | lowers |
| `new Map<object, number>()` | lowers |
| `new WeakMap<object, number>()` | **refused** |
| `new WeakSet<object>()` | **refused** |

`Map<object, number>` is the control that says the most: it holds the same keys
and differs only in being strong. Filed as
`weak-collections-have-no-representation`.

**One gap, three messages, by position.** The same `WeakMap` reports
differently depending on where it is written -- module scope gets `a
module-scope variable of unrepresentable type`, a function body gets ``a `new`
of unrepresentable type (`WeakMap` with no recorded arguments)``, and a class
field gets ``a property `table` of unrepresentable type``. `RegExp` behaves the
same way across five positions, which is why
`regular-expression-literal` was filed separately from `regexp-as-a-property`
rather than folded into it. **Counting sites by message text counts texts.**

Eight weak-collection sites in `runtime/node`, six at module scope and two as
class fields. The one that costs the most is `internal/async-hooks.ts:83`,
`externalAsyncIdentities` -- ten functions in that file are NTS1003 behind it
(`growExecutionStack`, `pushAsyncContext`, `popAsyncContext`,
`executionAsyncResource`, `hasHooks` and the four `…HooksExist` predicates that
call it), and every module imports `internal/`.

**Ruled out**: that the weakness is what cannot be represented, for lack of a
collector to observe it. Nothing in those eight sites tests collection -- all
eight use it as a side table whose keys outlive the lookup, so a `WeakMap` that
never dropped a key would satisfy every one of them. What the refusal costs is
the table, not the weakness.

## `a regular expression literal` is 21 sites and the honest one of five

Filed as `regular-expression-literal`, with `value.indexOf("a")` as the control
so the refusal cannot be read as "string methods do not lower". `http` 11,
`web-platform` 4, `internal` 3, `util` 2, `readline` 1. `http`'s eleven are
header and URL grammar written as patterns rather than scanners.

Ruled out: that a pattern with no metacharacters could lower as a substring
search. `/a/` is refused identically -- the decision is made on syntax, before
anything reads the pattern.

## Three refusal forms that resisted isolation, handed over as diagnoses

Each of these is a large form in the profile that no minimal program reproduced.
They are written here rather than filed because a fixture that does not
reproduce is worse than none -- it goes green on a compiler that fixed nothing.
What each one rules out is the useful part.

### `a member of X, a class this compiler has no type for` -- 99 sites, the largest

Named classes, by cone-summed occurrence rather than site: `PipeState`,
`ByteTeeState`, `TeeState`, `ReadableStreamAsyncIterator`, `ByteTransferSource`,
`AsyncLocalStorage`, `Immediate`, `CustomEvent`, `StorageContextEntry`. The
live reproducer is `async_hooks/src/local-storage.ts`, where **every** member
access on `AsyncLocalStorage` and `StorageContextEntry` reports it and no
property refusal appears at all -- which is the surprise, because the class
holds `#contexts = new WeakMap<AsyncContextFrame, StoredContext<T>>()` and a
`WeakMap` field reports as a property everywhere else.

**Ruled out, each probed on one pin and each lowering cleanly:**

| probe | result |
| --- | --- |
| a generic class `Box<T>` with a member | lowers |
| a generic class with a default, `Box<T = unknown>` | lowers |
| instantiated at `unknown` | lowers |
| two instantiations in one program | lowers |
| a non-generic class with a `WeakMap` field | reports the **property**, not this |
| a generic class whose field is `WeakMap<object, T>` | reports the property |
| the same class `implements` an interface | reports the property |
| the class in a transitively-reached file, entry elsewhere | reports the property |

So it is not genericity, not defaults, not `unknown`, not multiple
instantiations, not an unrepresentable member on its own, not `implements`, and
not the entry-set effect that explains `path`'s two messages. Something about
`local-storage.ts` that none of eight reductions carries is required.

### `` `this` outside a method `` -- 39 sites, 2 filed

`this-in-a-static-method` claims the two in `net/src/main.ts` where a `static`
method declares its receiver as a `this` parameter. The other 37 are not that.
**Seven shapes ruled out, each probed on v10 and each lowering cleanly:**

| probe | drawn from |
| --- | --- |
| `this` in a default parameter value, own property | `buffer/src/main.ts:575` |
| the same, reading an **inherited** property | `Buffer extends Uint8Array` |
| `override toString(encoding?, start = 0, end = this.length)` -- line 575 verbatim | `buffer` |
| `this` in an arrow-function class field | `console/src/main.ts:263` |
| the same with a rest parameter and a `#private` call | `console:333` |
| an arrow declared **inside a method body**, capturing `this` | `console/src/main.ts:417` |
| a getter reading `this.#size` | `stream/src/duplex.ts` |

Every one of those is copied from a site that reports the message, and every one
lowers in isolation. Combined with the reported column landing on the `get` and
`override` *declaration* lines rather than on any expression, the likeliest
reading is that **the location is not the construct** -- and the second
likeliest, after tonight, is that it keys on something program-wide that a
reduction deletes.

`stream/src/duplex.ts` supplies nine and every one is reported at a `get` line
whose body reads `this._writableState`. Since a plain getter lowers, **the
reported line is probably not the construct.** These diagnostics carry a
location and no enclosing name, and `path` has already shown a reported position
that does not describe what refused.

### `a rest parameter that is not an array` -- 39 sites

Second attempt, second failure to isolate. The live site is
`internal/tick.ts:83`, `nextTick(() => { throw err })` -- a generic rest
parameter `...args: A` where `A extends unknown[]` is instantiated at the empty
tuple. Ruled out: a plain `...args: number[]`; a generic `...args: A` called
with no arguments; the same called with one argument. All three lower, including
the shape the site appears to be.

**Standing note on all three.** The instrument that produced them -- counting
distinct diagnostic texts over the profile -- has now been wrong in the same
direction three times tonight: `a method X with no declaration in the hierarchy`
(42 sites, at least three causes), `a module-scope variable of unrepresentable
type` (18 sites, not about module scope), and `a member of X` (99 sites, and the
`AsyncLocalStorage` case suggests it is downstream of something else). **A form
count is a lower bound on causes and an upper bound on nothing.**

## `string_decoder`'s last mile is four chain *heads*, and clearing one did not shorten it

The standing description is "zero own-source refusals, two wrapper declines
left". The first half is true and the second half is downstream. On v10
`string_decoder` publishes **0 of 1** -- `StringDecoder` is declined as `is a
class whose constructor was not compiled`, and `default` as `is exported and is
not a function this backend can name`. Both are consequences. Nothing about the
wrapper is in the way.

Every refusal in `string_decoder/src/main.ts` is NTS1003, and the ten of them
name exactly five callees, three of which leave the module:

    bytesOf                     <- Buffer.from
    StringDecoder#write         <- bytesOf
    StringDecoder#constructor   <- ERR_UNKNOWN_ENCODING#constructor
    StringDecoder#text          <- Buffer#toString
    #fillLast #flush #utf8Text #utf16Text #base64Text  <- Buffer#toString
    StringDecoder#end           <- StringDecoder#flush

Each of the three traces to exactly one root construct, read off the emitted log
rather than attributed by proximity:

| chain | root | fixture |
| --- | --- | --- |
| `ERR_UNKNOWN_ENCODING#constructor` -> `inspectValue` -> `inspectValueWithin` | `internal/errors.ts:563`, `` `key` on a union whose members lay their fields out differently `` (was `:547`, `join`, until it cleared) | `union-members-lay-fields-out-differently` |
| `Buffer.from` -> `objectToBuffer` | `buffer/src/main.ts:196`, an erased value from two narrowings | `intersection-from-two-narrowings` |
| `Buffer#toString` -> `decodeIn` | `buffer/src/encodings.ts:279`, `` `toString` on a number `` (a radix, `byte.toString(16)`) | `number-tostring-radix` |

**Corrected by the instrument that replaced the hand trace.** The table above
is three chains found by reading the log by hand. `last-mile.mjs`, which walks
declaration *ranges* rather than following one cascade at a time, finds a
fourth: `buffer/src/main.ts:575`, `` `this` outside a method ``, reported on
`Buffer#toString`'s own declaration line --

    override toString(encoding?: string, start = 0, end = this.length): string

-- so that function carries a root of its own *and* the `decodeIn` chain behind
it. Following the cascade alone missed it, which is why the tool records roots
inside a range and keeps following.

**So `string_decoder` is four roots, three of them filed.** The fourth is in the
bucket that resists isolation: `` `this` outside a method `` has been probed six
ways now -- a default parameter reading an own property, reading an *inherited*
property, on an `override` method of a `Uint8Array` subclass with the same two
defaults as line 575, an arrow-function class field, the same with a rest
parameter, and a getter -- and every one lowers. See the diagnoses section.

It is also four and not two, and not one. `intersection-from-two-narrowings`
alone would publish nothing -- the constructor would still be refused, so the
class still would not cross. A fixture landing is not a module landing.

### The count of chains is not the honest unit either, and one day proved it

The sentence above originally ended "and the count of chains is the honest
unit". **That was wrong within hours.** The compiler lane provided `join` on all
three receivers, clearing `internal/errors.ts:547` -- the head of
`string_decoder`'s constructor chain, and the root that
`last-mile.mjs --all` had just ranked as blocking **eight of twenty-two
modules**, the highest-value fix in the profile by that measure.

`string_decoder` went from 65 refusals and 0 published to **65 and 0**. `os`
went 71 and 17 to 71 and 17. Not one site moved.

    - errors.ts:547:41  `join` on a typed array
    + errors.ts:563:74  `key` on a union, whose members lay their fields out differently

One out, one in, sixteen lines down the *same function*. The emitter reports one
construct per function and stops, so a cleared head reveals the next -- and the
replacement is harder than what it replaced: a dynamic property read across
layouts is a representation question, not a missing method.

**This is the stationary form of "a refusal delta is not a measure of a fix".**
The familiar version is `buffer` going 79 to 79 with five cleared and five
revealed. This one is worse to detect, because it is a single chain whose length
and count are both unchanged. The only instrument that distinguished cleared
from replaced was **diffing the two lists rather than their lengths**, which
were identical.

So `last-mile.mjs` output is *where each chain currently ends*. That is the
right thing to read when choosing what to work on next, and it is not a count of
remaining fixes. Its header now says so; the first version said the opposite.

### Re-derived on v14: three heads, and the `errors.ts` chain is gone

    buffer/src/main.ts:196       an erased value where a concrete representation is wanted
    buffer/src/main.ts:575       `this` outside a method
    buffer/src/encodings.ts:279  `toString` on a number
    UNRESOLVED Buffer.alloc      (stopped at `Uint8Array#fill`)

Four heads became three. `internal/errors.ts` is no longer among them -- the
chain through `ERR_UNKNOWN_ENCODING#constructor` cleared -- and a new one
appeared through `Buffer.alloc`, which `last-mile.mjs` cannot follow past
`Uint8Array#fill` and says so rather than guessing.

Still `0` own roots, still **2** wrapper declines, still **0** published:

    no wrapper for StringDecoder: is a class whose constructor was not compiled
    no wrapper for default: is exported and is not a function this backend can name

Both are consequences. "Two wrapper declines left" is true and describes the
symptom; the module is three lowering chains from publishing anything, and one
of the three is the `` `this` outside a method`` form that eight reductions have
failed to isolate.

**Method note.** The roots were found by taking each NTS1003's named callee,
finding that function's line range in its own file, and reading which NTS1001
falls inside it. `blockers.mjs` deliberately does not do this: it reports the
cone's constructs with their files and lines and leaves attribution to a person,
because "the diagnostic gives a location and not an enclosing name". Doing it by
range rather than by nearest-line is what keeps that from being a guess -- and
`decodeIn` is the case that would have defeated proximity, since it lives in
`encodings.ts` while every NTS1003 naming it is in `main.ts`.

## The chokepoint is a function, not a construct: `inspectValueWithin` blocks 15 of 22

`last-mile.mjs --all` on v10, ranking root constructs by **how many modules
reach them** rather than by how many sites print a message:

| modules | where | construct |
| ---: | --- | --- |
| **15** | `internal/errors.ts:547` | `` `join` on a typed array `` |
| 8 | `buffer/src/main.ts:196` | an erased value where a concrete representation is wanted |
| 6 | `events/src/main.ts:621` | `` `EventEmitter`, a class used as a value `` |
| 4 | `internal/async-hooks.ts:451` | a method `init` with no declaration in the hierarchy |
| 3 | `buffer/src/encodings.ts:279` | `` `toString` on a number `` |
| 3 | `internal/errors.ts:653` | `` `map` on a typed array `` |
| 3 | `internal/uv.ts:102` | `` `dest`, which `UVExceptionError` does not declare `` |
| 3 | `internal/errors.ts:911` | an `Error` with options |
| 3 | `url/src/url.ts:41` | a rest parameter whose element type has no representation |
| 3 | `timers/src/timeout.ts:421` | a module-scope variable whose initializer was refused above |

The fifteen for `errors.ts:547` are async_hooks, buffer, dgram, events, fs,
http, net, os, process, readline, stream, string_decoder, timers, util and zlib
-- every module that formats an error message, which is every module that has
one.

**And then it was cleared, and nothing moved.** The compiler lane provided
`join` on all three receivers. `string_decoder` went 65 refusals and 0 published
to 65 and 0; `os` went 71 and 17 to 71 and 17. The head advanced sixteen lines
inside the same function, from `547` to `563`, `` `key` on a union whose members
lay their fields out differently ``.

**So the unit this table is really measuring is the function, not the line.**
Fifteen of twenty-two modules are blocked by `internal/errors.ts`'s
`inspectValueWithin`, which contains at least two independent constructs and
will contain a third if that one clears. Ranking by construct made it look like
one fix worth fifteen modules. Ranking by *function* says: this one function is
worth fifteen modules and costs an unknown number of fixes, of which two are now
known and the second is harder than the first.

That is a better question to hand the compiler lane than a ranked list of lines,
and it is the same correction in a different coat: a count sizes a corpus, not a
feature.

### Per-module shape

    module                  own  chains        module                  own  chains
    punycode                  0       0        process                  44       8
    string_decoder            0       4        assert                   47       3
    os                        3       1        net                      47      22
    querystring               3       4        readline                 71       3
    path                      4       4        util                     81      16
    dgram                    13       9        zlib                     98       8
    console                  19       0        http                    146      30
    diagnostics_channel      19       3        fs                      196      76
    async_hooks              20       5        stream                  467      61
    timers                   25       4
    events                   30      12
    buffer                   37       4
    url                      40      18

`punycode` at 0 and 0 is the control that says the instrument reads a finished
module correctly. `console` owns nineteen roots and reaches none -- all of its
work is its own. `string_decoder` owns none and reaches four -- all of its work
is someone else's. Those two are the extremes and they are both real.

### Own roots by how many modules write them

Not a site count -- a count of modules whose *own* source carries at least one:

    10 modules  `null` or `undefined` where what it stands in for is not a reference
     7 modules  a rest parameter whose element type has no representation
     7 modules  an erased value where a concrete representation is wanted
     7 modules  `this` outside a method
     7 modules  an optional-chained method call (`a?.b()`)

These are the constructs the profile writes everywhere, as opposed to the ones
it happens to route through. Four of the five are filed; `` `this` outside a
method `` is the one that resisted isolation six ways and is carried as a
diagnosis.

## A program-wide fact deciding a local outcome, three times in one night

Three defects found in one evening share a shape worth naming, because the
thing that hides all three is the same and it is *good fixture practice*.

**1. The wrapper's dispatch table.** `ParsedPath` is five `string` fields, no
methods, no base, and it was declined as `returns an object`. The wrapper's test
for "this is a class and copying it loses behaviour" was
`!layout.methods.is_empty()`, and `Layout::methods` holds one entry per dispatch
slot **in the whole program**, with `None` where a layout does not implement
that slot. `ParsedPath`'s was `[None, None, None, None, None, None]`. An object
return was refused by dispatch existing *anywhere*. Reproduced from the other
side here: a five-string record crosses in a slot-free program and does not
cross beside a `Shape`/`Square` hierarchy that never touches the boundary.

**2. `an `in` naming X on an `object`, which Y declares optionally.** 42 distinct
sites -- stream 23, fs 6, net 3.

    class Opts { port: number }   ...  "port" in given  -> lowers
    class Opts { port?: number }  ...  "port" in given  -> REFUSED

`Opts` is not taken, returned or mentioned by the refused function. One `?` on a
declaration it never touches decides whether the `in` lowers. Filed as
`in-on-an-object-with-an-optional-declarer`, with both classes in one program so
the difference cannot be anything else.

**3. A call of a function value in a program with no closures.** Not a defect --
a stated limitation -- but the same shape, and it broke a control rather than a
subject. `fn(x)` is refused when the program contains no closure anywhere, so
the control in `call-and-apply-on-a-function-value` refused for a reason with
nothing to do with `.call`, and the first draft read "all three refuse". The
fixture now carries `makeAdder` as a **precondition, not a subject**.

### Why good practice hides them

A minimal reduction keeps the subject and deletes everything else. That is
correct for a local defect and exactly wrong here: what was deleted *was* the
precondition. Three consequences, each of which has now cost something:

- **A fixture can stop reproducing by being improved.**
  `object-return-carries-scalar-fields-only` had nine functions, six declines,
  three controls and **no class anywhere**, so its program had zero dispatch
  slots, every method table was genuinely empty, and it passed identically
  before and after the defect existed. It could not fail. It now carries a
  dispatched hierarchy nothing crosses, purely so the program is not slot-free.
- **A control can be declined for its own reason** and read as agreement. Four
  fixtures tonight needed a precondition restored for this: the two object
  parameters, the TypedArray parameter, and the closure above.
- **Two programs differing by one character in unrelated code** is the
  reproduction. Neither program is smaller than the other, so "reduce until it
  stops" terminates at the wrong place.

**How to test for it:** when a reduction stops reproducing, put back the thing
you deleted *last* before concluding the fixture is wrong. And when a fixture
passes on the first try, check that it can fail -- `--sabotage`,
`--mutate-addon`, and for a boundary fixture, whether the program contains the
global feature the defect keys on.

## The compiled axis on v10: 23 passes across 7 modules, and `path` moved 3 to 11

Node's own tests run against each built `.node`, on pin v10 (`d537f7a7`).

| module | passed | failed | | module | passed | failed |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| **path** | **11** | 10 | | assert | 0 | 12 |
| **os** | 4 | 5 | | async_hooks | 0 | 116 |
| **punycode** | **3** | **0** | | buffer | 0 | 55 |
| stream | 2 | 248 | | console | 0 | 19 |
| fs | 1 | 344 | | dgram | 0 | 77 |
| timers | 1 | 55 | | diagnostics_channel | 0 | 33 |
| util | 1 | 24 | | events | 0 | 32 |
| | | | | http | 0 | 410 |
| | | | | net | 0 | 148 |
| | | | | process | 0 | 90 |
| | | | | querystring | 0 | 8 |
| | | | | readline | 0 | 26 |
| | | | | string_decoder | 0 | 5 |
| | | | | url | 0 | 50 |
| | | | | zlib | 0 | 68 |

**23 passed, 1,835 failed, 7 modules with at least one pass.** The axis was 15
passes across the same 7 modules; **all eight of the gain is `path`**, and it is
the `export * as posix` landing -- `path` publishes 15 names now, with `posix`
and `win32` as namespace objects, against 12 before.

**It is still 1 of 22 whole.** `punycode` is the only module that passes
everything it is given.

### Controlled, because a pass that cannot fail is not a pass

Every number above is the plain run. Two controls per module, `--sabotage`
(hand the test a blank module) and `--mutate-addon` (keep every exported name,
destroy the behaviour behind it):

| module | plain | `--mutate-addon` | `--sabotage` | behaviour-dependent |
| --- | ---: | ---: | ---: | ---: |
| `punycode` | 3 | **0** | **0** | **3 of 3** |
| `path` | 11 | 3 | 0 | **8 of 11** |
| `os` | 4 | 1 | 0 | **3 of 4** |

`punycode` is the strongest row in the profile: every one of its three passes
fails when the behaviour behind the names is destroyed, so none of them is
passing on the shape of the export surface.

`path` is 11 and **not** "nearly all of 21". Three of the eleven survive an
addon whose behaviour is gone -- they check that a name exists and is callable,
which is a real thing to check and is not evidence the implementation is right.
The honest sentence is *8 behaviour-dependent passes of 21 files*, and it is the
sentence to repeat when this number is quoted.

`os` is 3 of 4 the same way. Its 5 failures are downstream of `constants` being
absent, which is behind `computed-member-write`.

**Corrected, and by a load rather than by either of us recalling.** This
paragraph first said `os` "cannot load at all until `computed-member-write`
lands". That is false. `os.node` loads, publishes **17 of 23** names, and
answers `arch()` with `x64` and `EOL` with `"\n"`; `constants` is absent and
tolerated. The claim came from a comment in `computed-member-write` describing a
failure that had since been fixed **in this lane's own file** --
`os/shape.mjs:15` no longer dereferences `exports.constants` unguarded, and the
note recording that it did was left standing. A stale note about one's own fix
reads exactly like a current fact.

So `computed-member-write` is not a hard gate on `os` loading. It is one of six
missing names. That is a smaller claim than the one it replaces and it is the
one that survives being run.

Not controlled at the time: `stream` (2), `fs` (1), `timers` (1), `util` (1) --
counted in the 23 and not claimed as behaviour-dependent.

### Corrected: the four uncontrolled ones are all hollow, so the number is 14

`sweep.mjs` computes this itself and names it. `degenerate` is the count of
passes that survive `--mutate-addon`; `real` is `pass - degenerate`; and
**`every-pass-hollow`** is the stage label for `real === 0`. Run on v11:

    punycode   green                3 / 3
    path       partial             11 / 21, 3 degenerate, absent: format, matchesGlob
    os         partial              4 / 9,  1 degenerate, absent: constants, cpus, …
    stream     every-pass-hollow    2 / 250, 2 degenerate
    fs         every-pass-hollow    1 / 345, 1 degenerate
    timers     every-pass-hollow    1 / 56,  1 degenerate
    util       every-pass-hollow    1 / 25,  1 degenerate

So the honest total is **14 behaviour-dependent passes across 3 modules**, not
23 across 7. `stream`, `fs`, `timers` and `util` contribute **zero** -- every one
of their four passes survives an addon whose behaviour has been destroyed.

The hand-derived controls agree with the sweep exactly -- 3 degenerate for
`path`, 1 for `os`, 0 for `punycode` -- which is worth something as independent
arithmetic. What it does not excuse is the reason they were needed: **the
instrument already had the answer and I built a second table without it.**
`addon-table.sh` counted raw passes out of `run.mjs`, and a raw pass count is
the one number this axis has been saying for months is not the measurement.
Declining to claim the four uncontrolled modules was right; running the sweep's
own summary first would have been better.

## Index-signature tables have to cross the boundary, in both directions

Asked by the compiler lane before building the representation, because the
answer decides its shape: does anything in the profile need a table to *cross*,
or only to work inside the compiled program? Surveyed rather than recalled --
every `[k: string]:` declaration in `runtime/node`, then which of them appear in
an entry file's exported signature.

**Seven declarations. Five cross, in three modules, and two of the five are
inbound.**

| where | direction | shape |
| --- | --- | --- |
| `os.networkInterfaces(): NetworkInterfaceMap` | out | `[name: string]: NetworkInterfaceInfo[] \| undefined` |
| `os.constants: OsConstants` | out | an object with **four** `Record<string, number>` fields |
| `querystring.parse(…): ParsedUrlQuery` | out | `[key: string]: string \| string[] \| undefined` |
| `querystring.stringify(obj?: ParsedUrlQueryInput)` | **in** | `[key: string]: StringifiableValue` |
| `util.parseArgs(config?: ParseArgsConfig)` | **in** | `options?: { [longOption: string]: ParseArgsOptionDescriptor }`, nested one level |

Internal only, and satisfied by a representation that never leaves the program:
`stream/src/utils.ts:75` (`StreamState`, a state bag whose index signature sits
beside eight named optional fields), and `stream/src/iter/pull.ts:57` and `:62`.

**So the representation alone does not publish `os.constants`.** That export is
an object with four map fields and one number: it needs the object-return path
*and* a map crossing, and its element type is `NetworkInterfaceInfo[] |
undefined` in the other `os` case -- an array of objects, behind
`array-of-object-literals-has-no-layout`. Two of the five are inbound, so a
one-directional design covers three.

The cheapest useful subset is `querystring.parse`: one outbound table of
`string | string[] | undefined`, no nesting, no array-of-objects. `querystring`
is 0 of 8 on the compiled axis and `parse` is the export its shape is built
around.

## `os` is one export from being the second whole module

`os.node` loads and publishes 17 of 23 names. On the compiled axis it is 4 of 9
applicable files. **Every one of the five failures is `constants`:**

    test-os-process-priority.js        Cannot read properties of undefined (reading 'priority')
    local/constants-signals-static.js  Expected values to be strictly equal
    local/constants-table-static.js    Cannot read properties of undefined (reading 'signals')
    local/core-static.js               Cannot read properties of undefined (reading 'priority')
    local/export-surface-static.js     os.constants is undefined, node's is object

**The control is the interpreted lane, which passes 9 of 9 on the same files.**
There `constants` is present through the module's own stand-in, and the five
files that fail compiled all pass. So the difference between 4 and 9 is one
export and nothing else -- not a behaviour divergence anywhere in the module, and
not the other five missing names, which no test reaches.

That makes `os` the only module in the profile where a single export decides
whether it is whole. `punycode` is 3 of 3; `os` would be the second, and the
compiled axis would read 2 of 22.

**What `constants` costs is more than the index-signature representation.** It
is declared

    export interface OsConstants {
      UV_UDP_REUSEADDR: number;
      signals: Record<string, number>;
      errno: Record<string, number>;
      priority: Record<string, number>;
      dlopen: Record<string, number>;
    }

-- an object with four map fields and a number, exported as a value. It needs
the object-return path, a map representation, and that map crossing the
boundary. Its builder is refused twice at `os/src/main.ts:541`,
`table[name] = value`, which is `computed-member-write`.

**This is a better ranking signal than reach.** `internal/errors.ts:547` was
reached by fifteen modules and clearing it moved none of them. `os.constants` is
reached by one module and would take it from 4 to 9. Reach counts how many
chains pass through a point; it does not say what is on the other side. The
question worth asking of a blocker is not how many modules touch it but **what
becomes true when it clears**, and that is answerable only where the other lane
already shows the answer -- which is exactly what a module at 9 of 9 interpreted
and 4 of 9 compiled provides.

## The `join` landing, diffed across all 22 modules: one out, one in, same fifteen

The compiler lane cleared `` `join` on a typed array `` and sampled two modules,
both unchanged. Diffing the root lines of `last-mile.mjs --all` across the
landing -- v10 `d537f7a7` against v11 `f5e561fa` -- says the sample generalises
exactly:

    434 root lines before        434 after

    - runtime/node/internal/errors.ts:547  `join` on a typed array
    + runtime/node/internal/errors.ts:563  `key` on a union, whose members lay their fields out differently

**One construct out, one in, sixteen lines down the same function.** And the
replacement inherited the *identical* reach set -- both are reached by the same
fifteen modules: async_hooks, buffer, dgram, events, fs, http, net, os, process,
readline, stream, string_decoder, timers, util, zlib.

Nothing about this is visible in a count. Both numbers are 434, both reach
counts are 15, and the only thing that changed is which line the chain stops at.

## What each module gains: `prize.mjs`, and the exports worth the most

`prize.mjs` runs node's own tests twice per module -- against the TypeScript on
node, and against the compiled `.node`. A file that **passes interpreted and
fails compiled** is one the implementation already gets right and the artifact
cannot yet reach. That set is the prize, and the compiled failure names what is
missing.

| module | interp | compiled | to gain | most-named export |
| --- | ---: | ---: | ---: | --- |
| http | 405 | 0 | 405 | *(`undefined`, 405 — the parser answers nothing)* |
| fs | 345 | 1 | 344 | `mkdirSync` (57), `writeFileSync` (33), `openSync` (31) |
| stream | 250 | 2 | 248 | `Readable` (80) |
| net | 148 | 0 | 148 | **`createServer` (96)** |
| async_hooks | 116 | 0 | 116 | **`createHook` (65)** |
| process | 88 | 0 | 88 | **`_fatalException` (73)** |
| dgram | 77 | 0 | 77 | **`createSocket` (68)** |
| zlib | 68 | 0 | 68 | `createGzip` (6) — spread thin |
| timers | 56 | 1 | 55 | `setTimeout` (27) |
| buffer | 55 | 0 | 55 | `from` (19), `alloc` (15) |
| url | 50 | 0 | 50 | `pathToFileURL` (2) — spread thin |
| diagnostics_channel | 33 | 0 | 33 | `tracingChannel` (15), `channel` (9) |
| events | 32 | 0 | 32 | `EventEmitter` (22) |
| readline | 26 | 0 | 26 | `createInterface` (9), `Interface` (8) |
| util | 25 | 1 | 24 | `inspect` (3) — spread thin |
| console | 19 | 0 | 19 | `Console` (10) |
| assert | 12 | 0 | 12 | `apply` (2) — spread thin |
| **path** | 21 | **11** | 10 | `format` (2), `matchesGlob` (1) |
| querystring | 8 | 0 | 8 | `parse` (4) |
| **os** | 9 | **4** | 5 | `constants` — all five |
| string_decoder | 5 | 0 | 5 | `StringDecoder` (2) |
| **punycode** | 3 | **3** | **0** | — |

`punycode` at 0 to gain is the control: the instrument reads a finished module
as finished.

**Single exports worth the most test files**, which is a ranking nothing else
here produces: `net.createServer` 96, `stream.Readable` 80,
`process._fatalException` 73, `dgram.createSocket` 68, `async_hooks.createHook`
65, `fs.mkdirSync` 57, `timers.setTimeout` 27, `events.EventEmitter` 22,
`buffer.from` 19, `diagnostics_channel.tracingChannel` 15.

**And the two ends of the profile are both worth knowing.** `os` needs one
export for five files and would be the second whole module. `zlib`, `url`,
`util` and `assert` have no dominant name at all -- their gains are spread over
twenty-odd exports each, so no single fix moves them and they are late whatever
happens.

**A caveat this table needs.** "To gain" is what the compiled lane would gain
*if the named export appeared and behaved*. It is an upper bound per file: a
file can fail for the first missing name and then fail again on a second. The
one place that is settled is `os`, where the interpreted lane passes all nine
and the five compiled failures name a single export.

## `punycode` is whole on 140,224 comparisons, not on three files

`punycode` is the profile's one complete module on the compiled axis, and until
now the evidence for that was three test files passing. Three files is a thin
basis for a claim that carries the whole axis, so:

    differential-addon.mjs punycode target/node/punycode.node --iterations 20000
    140224 comparison(s) over 20000 random inputs and 32 fixed:
      0 divergence(s), 0 property failure(s)

Against **node's own `punycode`**, asking the compiled artifact and node the same
questions. Together with the mutation control -- all three files fail under
`--mutate-addon`, so none passes on the shape of the export surface -- that is
the strongest module-level claim in the profile, and it is the bar the other
twenty-one are measured against.

**The gap this found in the instrument.** `sweep.mjs` runs a differential every
time and prints eleven modules with zero divergences, which reads as the
compiled lane being compared against node. It is not: the sweep calls
`differential-ts.mjs`, the **TypeScript** lane. `differential-addon.mjs` exists
and the sweep never invokes it, so **no compiled artifact in this profile had
ever been differentially compared against node** until this run.

That is the same failure the vacuous-lane work found one level up: a check that
runs, reports zero, and is measuring the lane that cannot disagree. The
interpreted lane's stand-ins call node's own implementation for the native half,
so its differential agrees with node by construction wherever the C would be
what differs -- which is exactly the half a compiled artifact replaces.

`punycode` is a fair first target for it because it has no native half at all.
The modules where this matters most are the ones with C behind them, and they
are also the ones with no compiled exports to compare yet.

## The first compiled differentials: `os` clean, `punycode` clean, `path` finds `basename`

Run against the v11 addons, asking node's own module the same questions:

| module | comparisons | inputs | divergences |
| --- | ---: | ---: | ---: |
| `punycode` | 140,224 | 20,032 | **0** |
| `os` | 85,238 | 5,014 | **0** |
| `path` | 105,882 | 5,042 | 20,168 |

`os` publishing 17 names that agree with node across 85,238 comparisons is a
stronger statement than its 4 passing test files, and it is the answer to
"is the rest of `os` right, or merely untested" -- the five missing exports are
missing, and the seventeen present are correct.

**`path`'s 20,168 are two causes and neither is a wrong answer.** Classified by
what the compiled side did:

    m[ns].format is not a function                  -- the absent export, known
    the compiled function requires 2 arguments      -- an arity divergence

The second is the finding. `basename(path: string, suffix?: string)` publishes
with its optional parameter **required**:

    path.basename("/a/b.txt")           THREW: the compiled function requires 2 arguments
    path.basename("/a/b.txt", ".txt")   "b"
    posix.basename("/a/b.txt")          THREW
    win32.basename("C:\a\b.txt")        THREW

So the single-argument form -- which is how `basename` is almost always called --
throws, and the two-argument form is correct. This is
`optional-parameter-at-the-wrapper`, already filed and still reproducing, and
what the differential adds is its cost: **it is not a corner, it is the common
call of one of node's most-used path functions.**

Probed across every published function in both modules, called with one
argument: `path` 11 functions, **2** throwing the arity error (`basename`, and
`relative`, which genuinely takes two and throws in node as well -- a false
positive of the probe, not a divergence). `os` 15 functions, **0**.

**Note what found it.** `path` is 11 of 21 on node's own tests and 8 of those
are behaviour-dependent, and none of that says `basename("/a/b.txt")` throws.
The pinned corpus calls it the way its author wrote the test; the differential
calls it the way the corpus does not. Three real bugs came out of the
TypeScript-lane differential for the same reason, and this is the first one from
the compiled lane -- which had never been run.

## 316 exported functions take an optional parameter, and the top of the prize table is behind two gates

`path.basename` throwing on its one-argument form is not a `path` problem. Every
exported function with an optional or defaulted parameter publishes with that
parameter **required**, and the profile has 316 of them:

    fs 143   stream 59   zlib 39   util 16   timers 12   url 8   http 7
    process 6   readline 6   events 4   os 4   path 4   querystring 4
    assert 1   async_hooks 1   dgram 1   net 1

The counts do not rank the harm, because **the single entries at the bottom are
the two most valuable exports in the profile.**

    net.createServer(options?, connectionListener?)   -- both optional
    dgram.createSocket(type, listener?)               -- listener optional

`prize.mjs` puts `net.createServer` first at **96 test files** and
`dgram.createSocket` third at **68**. Node's own dgram tests call it

    createSocket("udp4")   14 times
    createSocket()          3 times

-- so at least seventeen of the calls that would exercise the 68 use fewer than
two arguments and would throw, *after* the lowering work that publishes it is
done. `net`'s tests include `createServer()` with no arguments at all.

**So the prize table has a second gate it does not show.** It measures what a
module gains when the named export appears, and `optional-parameter-at-the-
wrapper` decides whether an export that appears can be *called the way node
calls it*. The two are independent and both are required, and the table would
read the same either way. That is a limitation of the instrument worth writing
next to it rather than discovering when `createSocket` lands and 17 tests still
fail.

`os` is the counter-example that shows this is not universal: 15 published
functions, **0** throwing the arity error, and 85,238 differential comparisons
with no divergence. Its four optional-parameter functions are among the six that
do not publish yet.

**How this was found is the point.** Not by counting -- `optional-parameter-at-
the-wrapper` has been filed for hours and its site count was never taken. It
turned up because `path` began publishing, the compiled differential ran for the
first time, and `basename("/a/b.txt")` threw where node returns `"b"`. A blocker
with a fixture and no cost attached is easy to rank below its worth.

## The index-signature representation landed: refusals fell, exports did not move

Measured on v12 (`80f0d31c`, the commit after `55968463`), against v11:

| module | own roots | published exports |
| --- | --- | --- |
| `os` | **3 -> 1** | 17 -> **17** |
| `querystring` | **3 -> 1** | 0 -> **0** |
| `path` | 4 -> 4 | 15 -> 15 |

Both `table[name] = value` sites in `os` cleared, and both computed-member roots
in `querystring`. `os`'s only remaining own root is `main.ts:433`,
`null-in-a-union-of-references`; `querystring`'s is `main.ts:110`,
`decodeURIComponent`.

**Not one export crossed.** The axis is unchanged.

**What did change is the shape of `os.constants`'s decline**, and it is the one
piece of real progress the count cannot show:

    v11   no wrapper for constants: is exported and no function of that name was compiled
    v12   no wrapper for constants: is exported and is not a function this backend can name

The first is a cascade -- `constants` did not compile. The second says it
compiles and cannot *cross*. One of the three capabilities it needs is done, and
the other two are the object-return path and a map crossing outward. The
compiler lane said this in advance, which is why it is progress rather than a
surprise.

**This is the third time tonight the same shape has appeared**, and it is worth
naming as a rule rather than a coincidence:

- `join` cleared and `string_decoder` went 65 refusals to 65, 0 published to 0.
- `errors.ts:547` was reached by fifteen modules; clearing it moved none.
- The index-signature representation cleared four own roots across two modules
  and published nothing.

Each was real work that made the compiler strictly better. **None of them moved
the axis, and in all three cases the refusal count moved.** The count is
measuring the corpus, and the corpus is large enough that a genuine fix is
invisible in it either way -- down four, unchanged, or down forty.

`prize.mjs` is the instrument that would have predicted all three: `os` gains
five files and only when `constants` *crosses*, `querystring` gains eight and
only when `parse` does. Neither names a refusal count.


## The wrapper enforces TypeScript's types; node's runtime does not

Three divergences found in `path` on the compiled axis are one family. Measured
against `node:path` with `path.node` **built here from a pin**, after a first
reading was taken from an artifact another session had rebuilt with a newer
compiler -- which reported `basename` agreeing and sent me looking for a fix
that had not landed on my pin.

| call | ours (v12) | node |
| --- | --- | --- |
| `basename("/a/b.txt")` | `TypeError: the compiled function requires 2 arguments` | `"b.txt"` |
| `toNamespacedPath(null)` | `TypeError: expected a string argument` | `null` |
| `_makeLong(100)` | `TypeError: expected a string argument` | `100` |
| `resolve(42)` | `Error: could not gather the rest arguments` | `TypeError`, `ERR_INVALID_ARG_TYPE` |
| `join("a", 1)` | `Error: could not gather the rest arguments` | `TypeError`, `ERR_INVALID_ARG_TYPE` |

`dirname`, `normalize`, `extname` and `isAbsolute` agree.

**One cause in three shapes:** an optional parameter published as required; a
parameter declared `string` rejected where node passes the value through; and a
rest element rejected with the wrapper's own bare `Error` in place of the
module's coded one.

**The general statement**: the boundary derives its argument checks from the
TypeScript signature, and node's runtime does not enforce those signatures.
`@types/node` declares `toNamespacedPath(path: string): string`; node returns
`100` for `toNamespacedPath(100)` and `test-path-makelong.js` asserts the looser
contract nine times. Where the two disagree, node is the oracle.

`win32.toNamespacedPath` is the sharpest case: our body **already** reads
`if (typeof path !== "string" || path.length === 0) return path`, transcribed
from node. The implementation is right and the boundary never lets it run.

**On pin v13 the arity shape is closed.** `basename` agrees with node in both
forms. `path` moves **11 passes to 12** on the compiled axis and its control
moves with it -- 3 degenerate under `--mutate-addon` either way, so **8
behaviour-dependent becomes 9**. That is the first divergence closed on this
axis, and the first axis movement from fixing a *behaviour* rather than
publishing an export. Four of eight probed calls now agree, up from three.

A *defaulted* parameter deliberately stays required: the lowering inlines the
initializer at each call site and the HIR does not carry the expression, so the
wrapper has nowhere to read it. Thirty-one exported functions keep throwing,
correctly, until there is a shim.

**Widening is not available yet, and the set is smaller than it looks.** Exactly
one exported function in `runtime/node` guards a parameter against the type its
own signature declares -- `win32.toNamespacedPath` -- which with the posix half
and the `_makeLong` alias is four published names. Everything else that guards a
non-string already declares `unknown` honestly. But `toNamespacedPath` returns
its argument, so widening the parameter widens the return, and both
`unknown-at-the-boundary` and `unknown-return-at-the-boundary` still reproduce:
the export would go from "publishes and throws on non-strings" to **not
publishing at all**, taking `path` from 15 to 11. The erased crossing has to
land in both directions before this is a trade worth making.

### And a fourth, which is the stand-in and not the wrapper

`test-path-resolve.js` sets `process.cwd = () => ''` and expects
`path.resolve()` to answer `'.'`. Our `resolve` calls the native binding
`nts_process_cwd`, so the compiled artifact reads `getcwd(3)` and never sees the
patch. The **interpreted lane passes only because its stand-in is
`globalThis.nts_process_cwd = () => process.cwd()`** -- a live closure over the
patchable property.

Every shared stand-in is written that way: `nts_process_env`,
`nts_stdout_is_tty`, `nts_platform`, `nts_process_pid`, `nts_hrtime_ns`. So any
pinned test that mutates node state and expects our module to observe it passes
interpreted **by construction** and can never pass compiled.

`--sabotage` cannot see that class -- such a test still fails when the module is
blanked, so it is not hollow by the definition this lane uses. It means
**`prize.mjs`'s "to gain" includes files that are not winnable at all**, and one
of `path`'s ten is this. Second caveat on that instrument.

It is left red and explained rather than reclassified. A number that goes up
because a test was moved to `not-applicable` is the thing this ledger exists to
refuse.

### How this section came to be written twice

The first copy was lost. The heredoc that wrote it failed while `/tmp` was full,
the insert script read an empty file, replaced the anchor with nothing, and
printed `recorded`. The commit was one blank line and the message described sixty.
**The record step had no control on it**: nothing checked that the text it was
about to insert existed. An audit of every section written this session found
this one missing and the other fourteen present, which is the only reason it is
here. A step that reports success without checking its own output is the same
defect as a test that cannot fail, one level further out.

## `os.node` segfaults during `require`: a `Record` field is never allocated

The index-signature representation landed and `os` stopped loading. Before, on a
pin built from the commit prior: loads, publishes 17 names, `arch()` answers
`x64`, 4 of 9 applicable tests pass. After: **SIGSEGV during `require`**, exit
139, nothing on stdout or stderr, **0 of 9**. `path` and `punycode`, rebuilt
from the same pin, are unaffected -- neither has an index-signature type.

    #0  nts_map_set ()
    #1  module.init ()
    #2  napi_register_module_v1 ()

The crashing call is `program.c:14265`, inside `readConstants()`, which
`module__init` runs to build `export const constants`:

        v66 = v8->dlopen;
        v63 = v66;
        …
        nts_map_set(v63, v76, v78);

**`readConstants` contains zero `nts_map_new` calls.** The whole emitted program
has exactly one, and it belongs to `objectUrlStore` in `buffer/src/blob.ts`. So
the four `Record<string, number>` fields of `OsConstants` are never given a
table, and the first write goes through whatever the struct held.

The shape that escaped the compiler lane's `examples/string-keyed-table` is
likely **a record that is a field of an object literal** rather than one bound
to a name: a named table gets its `nts_map_new`, a field of a returned object
literal does not.

### What this cost me, which is the part worth keeping

Two hours earlier this ledger recorded the same landing as "four own roots
cleared, zero exports crossed" and treated it as the familiar disappointment
where a real fix does not move the axis. **That was wrong in a way the entry
could not see.** It did not publish nothing; it published a crash.

The measurement was `emit-c` refusal counts and a grep for
`napi_set_named_property` in the emitted wrapper. Both are static reads of text
the compiler produced. Neither runs anything. `os` publishes 17 names by that
measure on the pin where it segfaults on load.

**And `os` is the one module where this ledger had already proved that loading
is what matters.** The `computed-member-write` note claiming `os` "cannot load"
was corrected earlier the same night, by the compiler lane, *by loading it* --
and the correction is three sections above this one. Having been handed that
lesson, the next measurement of the same module was still taken by counting.

The build floor says "22 of 22 still build". Building is not loading, and
nothing between the two was checking. A `require()` of every built addon costs
under a second each and would have caught this the moment it landed.

## `os`'s last own root: `a declaration outside every walk`, and it is not what it says

With `null-in-a-union-of-references` fixed, `os` has **one** own-source root
left:

    os/src/main.ts:395  `userInfoString`, a declaration outside every walk

`userInfoString` is called three times, at 443, 444 and 445, inside `userInfo`
-- and `userInfo`'s own diagnostic is `cannot be compiled because it calls
userInfoString, which was refused above`. So the compiler treats it as the root
and says it is outside every walk, while a walk reaches it from an exported
function twelve lines further down.

**Two hypotheses probed and both refuted**, each on the live binary:

| probe | reported |
| --- | --- |
| a helper reached only from an exported function, calling a refused thing **locally** | the real cause at the helper (`a regular expression literal`), and NTS1003 for the caller |
| the same, with the refused thing **in another module** | the real cause at the root, NTS1003 for the helper, NTS1003 for the caller |

So it is not "a helper whose callee was refused" -- that shape reports the
callee's actual construct, in one file or across two. Whatever makes
`userInfoString` different is not reachability from an export and not the
callee living elsewhere.

`userInfoString` is

    function userInfoString(bytes: number[], encoding: Encoding): string {
      return Buffer.from(bytes).toString(encoding);
    }

Both `Buffer.from` and `Buffer#toString` are refused in `buffer`, and both are
chains this ledger has already traced -- `objectToBuffer` at
`buffer/src/main.ts:196` and `decodeIn` at `encodings.ts:279`. A third attempt
at isolating this form; it stays a **labelled diagnosis** rather than a fixture,
with the two shapes above ruled out.

**What it costs**: `userInfo` is one of `os`'s six declines, and it is the only
one whose chain ends here rather than at `constants`. So `os` is `constants`
plus this, and nothing else -- `cpus` needs `returns an object[]`,
`networkInterfaces` needs `getCIDR`, and `getPriority`/`setPriority` both wait on
`validateInt32` -> `ERR_OUT_OF_RANGE#constructor`.

## Calling every published export with no arguments: 14 of 31 disagree with node

A zero-argument call is the one invocation that is always well-formed to
attempt, and it is where a wrapper's argument checks meet the module's own. Run
against every published function in the artifacts that have one:

| module | published functions | differ on `f()` |
| --- | ---: | ---: |
| `path` | 11 | **9** |
| `punycode` | 4 | **4** |
| `util` | 1 | **1** |
| `os` | 15 | **0** |
| `buffer`, `string_decoder` | 0 | 0 |

**`os` at 0 of 15 is the control**, and it says what the other rows mean: its
published functions take no required parameters, so no wrapper check fires and
the module answers. This is about required parameters, not about wrappers.

**Every difference is the same one: the wrapper's check pre-empts the module's
validation, so node's error code is replaced.**

    ours   path.dirname()        TypeError  code ERR_MISSING_ARGS      "the compiled function requires 1 argument"
    node   path.dirname()        TypeError  code ERR_INVALID_ARG_TYPE  "The \"path\" argument must be of type string…"

    ours   punycode.decode()     TypeError  code ERR_MISSING_ARGS
    node   punycode.decode()     TypeError  code undefined             "Cannot read properties of undefined (reading 'length')"

    ours   path.toNamespacedPath()   throws
    node   path.toNamespacedPath()   returns undefined

**This is not straightforwardly a defect and the fair reading matters.**
`ERR_MISSING_ARGS` is a real node error code and a `TypeError` carrying it is
more informative than what node's `punycode.decode()` does, which is to fall
into a property read on `undefined`. Where node has no validation, ours is
arguably better. Where node *does* validate -- which is every `path` function --
ours replaces `ERR_INVALID_ARG_TYPE` with `ERR_MISSING_ARGS`, and node is the
oracle.

**It costs at least one test file.** `path/test/error-identity-static.js` asserts
`thrown.code === "ERR_INVALID_ARG_TYPE"` for each function, and it is one of
`path`'s nine remaining failures. It fails first on `resolve`, whose code is
`undefined` because the rest gatherer raises a bare `Error` -- the same family
with a different sub-case:

    a rest parameter     bare `Error`, no code, "could not gather the rest arguments"
    a missing argument   `TypeError`, code `ERR_MISSING_ARGS`
    node                 the module's own coded error, whatever it is

**And it qualifies "punycode is whole."** `punycode` is 3 of 3 on node's tests,
all three behaviour-dependent, and 140,224 differential comparisons with zero
divergences -- and all four of its published functions answer a zero-argument
call differently from node. The differential's corpus always supplies an
argument, and node's own tests never call these with none. **Whole means whole
on every question anyone has asked**, and this is a question nobody had.

## The wrapper's argument check is load-bearing, because the declaration deleted the module's own

`path.dirname()` answering `ERR_MISSING_ARGS` where node answers
`ERR_INVALID_ARG_TYPE` reads as the wrapper being wrong. It is not.
`dirname(path: string)` lowers `path` to `NtsString *`, so the module's own
`validateString(path, "path")` is **dead code** -- `typeof path !== "string"` is
statically false for a parameter the type says is a string, and it folds away.
Remove the wrapper's check and `dirname()` does not produce node's error; it
dereferences a null pointer.

So the wrapper is standing in for a check the type system deleted. That is the
same cause as `win32.toNamespacedPath`, whose transcribed
`if (typeof path !== "string") return path` never runs.

**Two symptoms, one cause: where `@types/node` is stricter than node's runtime,
the declaration deletes the guard and the boundary enforces the declaration.**

### How much validation the declaration currently deletes

Surveyed across every exported function whose parameter is declared `string`,
`number` or `boolean` *and* validated at runtime:

| | count | modules |
| --- | ---: | --- |
| validation the declaration deletes **entirely** -- type-only validators (`validateString`, `validateBoolean`, `validateFunction`, `validateObject`, `validateArray`, `validateBuffer`) | **23** | `path` 16, `fs` 2, `util` 2, `net` 1, `process` 1, `url` 1 |
| validation that keeps live work -- range and value validators (`validateInteger`, `validateInt32`, `validatePort`, `validateOneOf`, `validateEncoding`) | 9 | `os` 3, `fs` 2, `http` 1, `net` 1, `stream` 1, `util` 1 |

The second row still folds its *type* test and keeps its range test, so those
nine are half-deleted rather than dead.

**This is the number the erased-parameter crossing is worth**, and it is not the
four names an earlier survey here scoped it at. That survey asked which
functions guard against their own declared type with an inline `typeof`, and
found exactly one -- `win32.toNamespacedPath`. The larger set is the functions
whose guard is a *call* to a validator, which the same fold deletes just as
completely and which no `typeof` search finds. **A survey answers the question it
was written to ask**, and the first one was written to find inline guards.

A lower bound in two ways: it counts only the first validator call per function,
and only parameters declared with a primitive type.

## Re-derived on pin v14: 22 of 22 build and load, and eleven publish something

The standing description says "twenty of twenty-two build and load; `fs` and
`process` do not". **Re-derived by building both from v14 and requiring them:
they build, and they load.**

    fs        loads, 1 name(s) published
    process   loads, 0 name(s) published

So it is **22 of 22**, and the sentence that replaces it has to separate three
things the old one ran together -- building, loading, and publishing:

| published names | modules |
| ---: | --- |
| 17 | `os` |
| 15 | `path` |
| 13 | `async_hooks` |
| 7 | `readline` |
| 6 | `punycode` |
| 3 | `net`, `buffer` |
| 2 | `timers`, `http` |
| 1 | `util`, `fs` |
| **0** | `assert`, `console`, `dgram`, `diagnostics_channel`, `events`, `process`, `querystring`, `stream`, `string_decoder`, `url`, `zlib` |

**Eleven of twenty-two publish nothing at all**, and they still build and load --
which is why "builds" was never the interesting number and why `loads.sh`
reports the published count beside the verdict rather than a bare `ok`.

The axis, re-derived on the same artifacts with its control:

    punycode    3 passed,  0 degenerate  ->  3 behaviour-dependent
    path       12 passed,  3 degenerate  ->  9
    os          4 passed,  1 degenerate  ->  3

**15 behaviour-dependent passes across 3 modules, and still 1 of 22 whole.**
99 fixtures, 99 as expected on v14.

Three of the standing numbers in the session brief are now stale and this is
what they read instead:

| standing | re-derived |
| --- | --- |
| "roughly 125 of 309 declared bindings have no C" | **3 of 331**; `dgram` 21/21, `net` 30/30, `fs` 155/155 |
| "twenty of twenty-two build and load; `fs` and `process` do not" | **22 of 22** |
| "no emitted wrapper builds a typed array at all -- zero across 24 addons" | **still true** -- see the correction below |
| "`os` is 17 of 23" | still 17 of 23 published; 4 of 9 applicable tests, 3 behaviour-dependent |
| "TypeScript-on-node stays 100% with 0 hollow" | **holds**: 1,851 of node's own test files pass across 22 modules, 0 hollow, 22 of 22 typecheck |
| "`string_decoder`: zero own refusals, two wrapper declines" | both still true, and it publishes **0** -- the declines are consequences of three lowering chains |
| "roughly 125 of 309 declared bindings have no C" (re-run) | **331 declared, 328 with C, 3 without** -- identical to the earlier derivation, on 15 freshly compiled objects |

### Correction: the typed-array claim is not stale, and I misread a helper as a call

Grepping every emitted `addon.c` for `napi_create_typedarray` finds two calls in
**all twenty-two**, which reads as every wrapper building one. It is not. Both
calls are inside `nts_to_napi_view`, a `static napi_status` helper the emitter
writes into every addon whether or not anything uses it.

`nts_to_napi_view` occurs **22 times across 22 addons** -- once each, and that
once is its definition. **Zero call sites.**

So "no emitted wrapper builds a typed array at all" is still exactly true, and an
earlier note here saying `bef165c7` had made it stale was wrong. The evidence for
that note was a `grep -c` over emitted C, which counted a definition that is
emitted unconditionally.

This is the same error this ledger has spent the night documenting in other
places -- a count over emitted text mistaken for a fact about behaviour -- and it
is worth recording that it happened *here*, in the section written to re-derive
stale numbers, immediately after four instruments had been built specifically
because static reads mislead. **The habit is not fixed by knowing about it.**

## The widening: four divergences closed, and not one test file gained

With the erased crossing landed, `toNamespacedPath` is declared
`(path: unknown): unknown` in both namespaces, and `_makeLong` follows as its
alias. Against `node:path`, on a `path.node` built here from the same pin:

    toNamespacedPath(null)     same     null
    toNamespacedPath(100)      same     100
    _makeLong(false)           same     false
    toNamespacedPath("/a/b")   same     "/a/b"
    toNamespacedPath({})       DIFFER   ours TypeError, node returns the object

**Four of six.** The object case raises `an argument of this type has no
representation in the compiled runtime` rather than answering wrongly, which is
the correct half of the trade and is still a divergence.

**And the axis did not move.** `path` is 12 passed and 9 behaviour-dependent
before and after, publishing 15 names either way. `test-path-makelong.js` still
fails, because node's own file asserts

    assert.strictEqual(path.toNamespacedPath(path), path);

-- passing **the module object**. The two cases the widening cannot reach are in
the same file as the four it fixed, so closing four bought nothing a test can
see.

That is the fourth time tonight a real improvement moved no number, and it is
the cleanest instance: the change was correct, verified against node on five
inputs, and its whole visible effect is that a file which failed on `null` now
fails on `{}`. **"Four divergences closed" and "zero files gained" are both
true, and only the second is what the axis counts.**

The line that made the widening legal is the one that had been dead since it was
written: `win32.toNamespacedPath`'s transcribed
`if (typeof path !== "string" || path.length === 0) return path` could never run
under `path: string`, and it is what narrows `unknown` to `string` for the body
below it. The dead guard was the precondition for its own resurrection.

## The counted lane over all 22 modules, with its uncounted control: 0 differ

The goal text asks for "the counted lane covering every building module with its
uncounted control". Until tonight that was not satisfiable: seven modules built,
so the set was a remembered list of seven. **22 build now, and the run has been
made over all of them.**

    22 module(s) measured, 0 reported `did not build`
    29,394 retain/release sites across the profile
    0 module(s) differ between the columns

Heaviest: `process` 2,964 sites, `fs` 2,941, `dgram` 2,201, `net` 2,179,
`readline` 2,164. Lightest that still runs: `punycode` 55, `timers` 321.

Every row is identical counted and uncounted -- same file count, same passes,
same failures, same skips. `NTS_CONFORMANCE_RC=1` selects reference counting on
both halves and `-DNTS_POISON=1` rides along, so a freed or unwritten slot reads
`a5d03c3c3c3c3c3c` rather than a zero indistinguishable from a legitimate one.

**What an identical pair means, and what it does not.** It does not mean the
allocator is correct. Most of these modules publish nothing, so most of these
tests never reach compiled code at all: `zlib` runs 74 files with 2,159
retain/release sites emitted and 0 published names, and its 68 failures are
`zlib.createGzip is not a function` on both sides. An identical pair there is
the allocator **seeing nothing these tests can reach**, which the script's own
footer says and which is a result rather than a blank.

The rows where it means something are the three that publish and pass:
`punycode` 3 of 3 at 55 sites, `path` 12 of 22 at 435, `os` 4 of 13 at 512 --
identical counted and uncounted, so nothing those tests exercise is freed early
or twice.

### And the run before this one was wrong in a way worth keeping

The first attempt reported **thirteen modules as `did not build`** and
`0 module(s) differ` -- and all thirteen were false. Mid-run, tidying pinned
binaries down to "current and previous", I deleted the pin the run was using.
`build.sh` re-invokes `$NTS_COMPILER` per module, so every module after `http`
failed for a reason with nothing to do with the module.

**`loads.sh` had said 22 of 22 build forty minutes earlier**, which is the only
thing in the room that could contradict the table -- and it is an instrument
built for something else entirely.

Two rules out of it. A long run holds a live reference to its pin, so "keep two
pins" has to mean two **plus whatever is in flight**; the tidy rule that cannot
get this wrong is *delete only pins older than the one two runs back*. And an
instrument reporting `did not build` cannot distinguish "this module does not
compile" from "the compiler was not there" unless it is written to -- the same
shape as `no addon built` reading as a module being far away when it is one
function's body.

The invalid table is kept as `cvu-INVALID-deleted-pin.txt` rather than deleted.

## The erased crossing published nine more names, in six modules, and moved no test

`unknown` crosses in both directions now. Published names, before and after, on
builds this lane made from each pin:

| module | before | after |
| --- | ---: | ---: |
| `async_hooks` | 13 | **16** |
| `buffer` | 3 | **5** |
| `timers` | 2 | **3** |
| `util` | 1 | **2** |
| `stream` | 0 | **1** |
| `url` | 0 | **1** |
| `os`, `path`, `readline`, `punycode`, `net`, `http`, `fs` | unchanged | unchanged |

**Nine names, six modules, and two of them off zero for the first time.**
Thirteen of twenty-two now publish something, up from eleven.

**The axis did not move.** `punycode` 3 real, `path` 9 real, `os` 3 real --
**15 behaviour-dependent passes across 3 modules**, exactly as before, and still
1 of 22 whole.

That is the fifth time tonight, and by now the pattern is the finding rather
than the disappointment:

    join provided                       string_decoder 65 refusals -> 65, 0 published -> 0
    errors.ts:547 cleared               reached by 15 modules, moved none
    index-signature representation      4 own roots cleared, 0 exports crossed
    toNamespacedPath widened            4 of 6 divergences closed, 0 files gained
    erased crossing, both directions    +9 published names, 0 files gained

Every one was correct work that made the compiler strictly better. **None of
them moved the number the goal counts.** The reason is not that the work is
small -- it is that a test file passes only when *every* name it touches is
present and behaves, and these modules are far enough back that adding one name
to `stream` leaves 248 files failing on the next one.

`prize.mjs` is the instrument that says so in advance: `stream` has 248 to gain
and its most-named absent export is `Readable` at 80 files. One name is not the
unit; the unit is whatever a file needs, all of it.

## `path` decomposed: four causes, and one test it can never pass

`path` is 12 of 21 on the compiled axis and 21 of 21 interpreted. Every one of
the nine it is missing, with what each waits on:

| cause | files | which |
| --- | ---: | --- |
| **`format` absent** -- takes an object inbound, five *optional* string fields | **3** | `test-path-parse-format.js`, `local/edge-inputs-static.js` (2 of 183 cases, both `format`), `local/export-surface-static.js` |
| **error identity** -- the wrapper's check replaces the module's coded error | **2** | `test-path.js` (expects `{code: 'ERR_INVALID_ARG_TYPE', name: 'TypeError'}`, gets `{name: 'Error'}`), `local/error-identity-static.js` (`resolve: wrong code`) |
| **object representation** -- `toNamespacedPath(obj) === obj` | **2** | `test-path-makelong.js`, `local/legacy-make-long.js` |
| **`matchesGlob` absent** -- the `RegExp` chain in `glob-matcher.ts` | **1** | `test-path-glob.js` |
| **the stand-in** -- `process.cwd = () => ''` | **1** | `test-path-resolve.js` |

**So `path`'s ceiling is 20 of 21, not 21.** The last one is not a defect and
cannot be fixed: node's test replaces `process.cwd`, our `resolve` calls the
native `nts_process_cwd`, and the interpreted lane passes only because its
stand-in is a JavaScript closure over the patchable property. No compiler change
reaches it.

That matters for the goal as written -- "every module that can pass node's own
tests as a compiled addon does". **`path` cannot**, and the honest form of its
row will always be *20 of 21, with the reason*, unless that file is reclassified
by someone willing to own the reclassification.

**Ranked by files, the work is:** `format` 3, error identity 2, object
representation 2, `matchesGlob` 1. `format` is the largest single item on the
near end of the profile, and it needs the inbound half of an object crossing
with **optional** fields -- which the `unknown` crossing does not supply:
`format@posix` and `format@win32` still decline `takes an object` on the pin
where `unknown` crosses both ways.

## `path`'s namespaces are 11 of 17, and two of the six missing are a cycle

`path.posix` and `path.win32` publish as objects with **11 members each**;
node's have **17**. The six missing are the same in both:

    format        a function -- takes an object inbound
    matchesGlob   a function -- the RegExp chain
    sep           a VALUE, and it differs by namespace: "/" against "\"
    delimiter     a VALUE, ":" against ";"
    posix         a REFERENCE to the other namespace object
    win32         a REFERENCE to the other namespace object

Top-level `path.sep` and `path.delimiter` do publish. It is only the namespace
members that do not, so the gap is in how a namespace object is built rather
than in value exports generally.

**And the last two are not value members, they are a cycle with identity.**
Node's own structure:

    path.posix.posix === path.posix    true
    path.posix.win32 === path.win32    true
    path.win32.posix === path.posix    true

So each namespace object contains a reference to itself and to the other, and
`===` holds. Publishing `sep` and `delimiter` is a value member; publishing
`posix` and `win32` is **two objects that reference each other, built before
either is finished, with reference identity preserved**. Those are different
problems and only the first is "value members in a namespace".

`sep` is the member that matters most for behaviour: `"/"` against `"\"` is
exactly what a caller reaching for `path.win32.sep` wants, and it is the one
case where the two namespaces disagree in a way callers depend on.

`local/export-surface-static.js` already asserts `typeof path[ns].sep ===
"string"`, so this is a failing assertion that was written before the gap
existed rather than a new finding -- the file currently fails earlier, on
`path.format`, which is why the `sep` half had not surfaced.

## Both `path` namespaces against node, member by member: 0 value divergences

Every published function in `path.posix` and `path.win32` against its
`node:path` counterpart, over twenty inputs chosen for the shapes the two
implementations disagree about -- drive letters, UNC shares, backslash runs,
`\\?\` prefixes, trailing separators, empty and blank strings:

    400 case(s) where both returned a value:   0 differ
     40 case(s) differ only in which error was thrown

**`win32` is a second implementation and it is right wherever it answers.** It
is reached only through its own namespace, it has drive letters and UNC parsing
that `posix` never executes, and across 400 answers it agrees with node exactly.

**The entire divergence surface of `path`'s published members is error
identity.** All forty are the same family already documented: the wrapper's
argument check fires before the module's own validation, so `relative("/")` --
one argument to a two-argument function -- raises `ERR_MISSING_ARGS` where node
raises `ERR_INVALID_ARG_TYPE`.

That is a useful shape to have measured rather than assumed. It says the
remaining work on `path`'s *published* surface is one thing, not a list, and it
says the second implementation nobody has been exercising does not need
attention beyond it.

It also puts a number on the error-identity item: 40 of 440 comparisons here,
and 2 of `path`'s 9 failing files.

## The remaining standing numbers, re-derived

Four claims in the session brief had not been checked tonight. Three hold, one
was stale by one, and one only reproduces under a reading the sentence does not
state.

**`querystring` is 0 of 8, not 0 of 7.** Nine test files, 8 applicable, 0
passing. The rest of that sentence holds exactly: `shape.mjs` line 8 is
`const qs = exports.QueryString`, with a comment saying "It is `QueryString`
itself, not a copy", so that one object is the whole module.

**`string_decoder`'s bar is node's, and node's is what the brief says.**
Measured on `node:string_decoder` directly:

    lastChar    proto: accessor   value: Buffer(4)
    lastNeed    proto: accessor   value: 0
    lastTotal   proto: accessor   value: 0
    prototype keys: constructor, write, end, text, lastChar, lastNeed, lastTotal

All three are prototype accessors and `lastChar` is a `Buffer`.
`test/core-static.js` is **unmodified** -- 45 assertions, including
`assert(decoder.lastChar.equals(new Uint8Array([0xe1, 0, 0, 0])))`, which is the
`.equals` the host has to answer.

**"66 signatures in nine modules sit behind the typed-array gap" reproduces as
64 in ten, and only under one reading.** Three readings of "signatures":

| reading | count | modules |
| --- | ---: | ---: |
| exported functions mentioning a typed array anywhere | 51 | 9 |
| **signatures whose _return_ mentions one** | **64** | **10** |
| functions and exported-class methods, anywhere in the signature | 115 | 13 |

The middle row is the one the sentence means -- "no emitted wrapper *builds* a
typed array" is about returns, since building is what a return needs. It is 64
and not 66, which is drift rather than disagreement.

**And the declines do not mention typed arrays at all.** Collected across every
module: **488** wrapper declines, of which

    244  is exported and no function of that name was compiled
     99  is exported and is not a function this backend can name
     87  is a namespace member whose function has no wrapper
     38  is a class whose constructor was not compiled
     11  takes an object
      9  the rest -- object/object[] inbound and outbound, `Promise<void>`,
         `Map<string, string>`, `Map<f64, string[]>`

**Zero name a typed array in the reason.** Nineteen lines match a typed-array
word and every one of them matches on the *module or export name* -- `buffer`,
`Buffer`, `SlowBuffer` -- not on why it was declined. That distinction was
checked rather than assumed, because the first count of this was taken from a
partially-written file and said 222 declines and zero matches; both numbers were
wrong and only one of the conclusions was. Those 64 signatures are not declined *for* the
typed array; they are behind lowering refusals that stop them long before the
boundary is reached. So the typed-array gap is real and is not currently the
thing costing those signatures -- which is the difference between a blocker and
a blocker that is next.

## The nine names the erased crossing published: six work, three cannot be called

Each newly published export, called with the argument node accepts and compared
against `node:`:

| export | ours | node |
| --- | --- | --- |
| `util.toUSVString("ab")` | `"ab"` | same |
| `stream.getDefaultHighWaterMark(false)` | `65536` | same |
| `stream.getDefaultHighWaterMark(true)` | `16` | same |
| `async_hooks.executionAsyncId()` | `1` | same |
| `async_hooks.triggerAsyncId()` | `0` | same |
| `timers.clearImmediate(undefined)` | `undefined` | same |
| **`buffer.isUtf8(new Uint8Array([97,98]))`** | **throws** `an argument of this type has no representation in the compiled runtime` | `true` |
| **`buffer.isAscii(new Uint8Array([97]))`** | **throws**, same | `true` |
| **`async_hooks.executionAsyncResource()`** | **throws** `the compiled function returned a value with no JavaScript representation` | an object |

Six agree with node exactly. **Three publish and cannot be used at all.**

`isUtf8` and `isAscii` are declared `(input: Uint8Array | ArrayBuffer)`. The
erased parameter path accepts them at the boundary and then finds it has no
inbound representation for a typed array -- which is the same 64-signature gap
measured elsewhere in this document, now reached from the other side. Every
argument node accepts, including a `Buffer`, throws.

`executionAsyncResource` fails outbound rather than inbound: the value exists
and has no JavaScript representation.

**This is worse than not publishing, and worth saying plainly.** Before the
crossing, `buffer` published three names and `typeof buffer.isUtf8` was
`"undefined"`. Now it is `"function"` and every call throws. A presence check
passes where it used to fail, and only a call finds out -- which is exactly the
shape `vacuous-lane.mjs` exists to catch one level up, and exactly what
`prize.mjs`'s second gate warns about: **appearing is not the same as being
callable.**

It is not an argument against the crossing, which bought six working exports and
is a precondition for the rest. It is an argument for the boundary declining
what it cannot carry instead of accepting it and failing at the call -- the same
judgement the compiler lane already made for `{}` inbound, where a loud
`TypeError` was chosen over a wrong `undefined`. Here the loudness arrives one
call too late to stop the name being published.

## A test that reports its first finding and stops, and the assertion node never needs

Two defects in this lane's own surface tests, fixed in `buffer`, `async_hooks`,
`os` and `path`.

### `typeof` is not enough, because a published name can be uncallable

Every `export-surface-static.js` asserted that a name is a `function`. **None
asserted that it can be called.** Node has no reason to: there, a name of type
`function` is always callable.

Here it is not. The erased-parameter crossing published `buffer.isUtf8` and
`isAscii`, both declared `(input: Uint8Array | ArrayBuffer)`, and the boundary
has no inbound representation for a typed array -- so `typeof buffer.isUtf8`
became `"function"` while every argument node accepts throws, `Buffer` included.
`async_hooks.executionAsyncResource` fails the other way, on the return.

**Scalars do not catch it.** `isUtf8("")` reaches the module's own validation and
answers node's error exactly. Only the argument the function actually takes finds
the boundary, which is why the assertion has to name a real argument rather than
probe generically.

`os` is where the check passes: **15 published functions, 0 uncallable, 0 with
the wrong `.name`**. A check that cannot pass is not worth having, and that row
is what says this one can.

### A file that stops at its first finding has no other findings

All four asserted inside a `for` loop, so the first divergence ended the file.
What that hid:

| module | reported | hidden behind it |
| --- | --- | --- |
| `buffer` | `Blob is undefined` | eight more absent names, and both uncallable functions |
| `async_hooks` | `AsyncLocalStorage is undefined` | three more, the uncallable return, and the `extra` sweep the file's own comment calls "the direction this module's raw addon actually goes wrong in" |
| `os` | `constants is undefined` | the `extra` sweep, the function-name sweep, and all of `constants`'s shape |
| `path` | `format is undefined` | eight more, including **`win32.sep` and `win32.delimiter` absent** |

Every one now collects and asserts once. `path`'s hidden finding is the one that
mattered most: `path.posix.sep` is `"/"` and `path.win32.sep` is **undefined**,
because `shape.mjs` builds `posix` from the flat exports -- which carry the
top-level `sep` -- and `win32` from the namespace object, which publishes no
value members. That asymmetry is exactly the gap the compiler lane is about to
close, and no test could see it.

**This is the same shape as two findings on the compiler side**: reach counting,
where a construct blocking fifteen modules moved none of them; and the
stationary refusal count, where a fix cleared one head and revealed the next. In
all three the instrument reported the first thing it met and called it the
answer.

Interpreted stays green throughout -- `buffer` 55 of 55, `async_hooks` 116 of
116, `os` 9 of 9, `path` 21 of 21 -- so the new assertions pass where the
implementation works and fail only at the compiled boundary, which is what they
are for.

## "Published names" has been counting names node does not have

Every published-name count in this document -- `async_hooks 13 -> 16`,
`readline 7`, "thirteen of twenty-two publish something" -- was
`Object.keys(addon).filter((k) => addon[k] !== undefined).length`. **That counts
whatever the addon's export table contains, and the export table contains names
node does not export.**

Measured against `node:<module>`'s own key set:

| module | raw published | names node also has |
| --- | ---: | ---: |
| `os` | 17 | **17** |
| `path` | 15 | **15** |
| `punycode` | 6 | **6** |
| **`async_hooks`** | **16** | **3** |
| **`readline`** | **7** | **0** |
| `net` | 3 | 3 |
| `buffer` | 3 | 3 |
| `timers` | 3 | 1 |
| `util` | 2 | 2 |
| `http` | 2 | 1 |
| `stream`, `fs` | 1 | 1 |
| **`url`** | **1** | **0** |

**53 of 77, and 11 modules rather than 13.** `readline` publishes seven names
and **none of them is node's** -- `charLengthLeft`, `charLengthAt`,
`reverseString`, and four `kClear*` symbols. `url`'s one is `isURL`, which node
does not export either.

So `async_hooks` is not "16 published"; it is **3 of node's 6**, plus thirteen
internals.

**Corrected, and the correction is the more useful half: the extra names are
deliberate and the addon is not wrong.** `async_hooks/src/main.ts:38` re-exports
all thirteen with a comment saying why --

> Raw implementation exports for the conformance harness's node-internal facade.
> `shape.mjs` deliberately omits them from the public module object. Keeping the
> facade on this same export set prevents the compiled lane from importing
> TypeScript helpers beside the addon it is meant to measure.

-- and `readline/src/main.ts:49` says the same for its seven. So the addon
publishes exactly what its entry exports, the shim narrows to node's surface,
and both layers are doing what they were built to do. **This paragraph first
said "the addon's export table is what is wrong". It is not.** The finding was a
discrepancy between two numbers and the wrong side was named as the defect,
before reading the comment that explains it -- which is the same failure as
counting `nts_to_napi_view`'s definition as a capability.

What survives is narrower and still worth having: **a raw published-name count
includes the facade exports, so it is not a measure of public surface.** `os`
17, `path` 15 and `punycode` 6 are entirely node's; `async_hooks` 16 is three of
node's and thirteen of the harness's. Reported as one number they read the same.

**Why no test distinguishes them.** The `extra` sweep in each
`export-surface-static.js` runs against what `shape.mjs` returns, which is node's
key set by construction, so it cannot see the facade names either way. That is
correct for what the shim guarantees and it means **no test in this lane reads
the addon's export table directly** -- which is fine while the extra names are
deliberate, and would hide it if one day they were not.

**These particular numbers are from a mixed set of artifacts** -- another
session's gate rebuilt `buffer.node` one minute before the reading and the live
compiler has moved twice since this lane's pin -- so they are provisional and
the module list is what matters rather than the totals. The method correction is
not provisional: **a published-name count has to be intersected with node's key
set, or it counts internals as progress.**

## Tests that mutate what a stand-in closes over: 21 candidates, 1 confirmed

`test-path-resolve.js` sets `process.cwd = () => ''` and expects `resolve()` to
answer `'.'`. Our `resolve` calls the native `nts_process_cwd`, so the compiled
artifact reads `getcwd(3)` and cannot see the patch. **The interpreted lane
passes only because its stand-in is `globalThis.nts_process_cwd = () =>
process.cwd()`** -- a live closure over the patchable property.

Every shared stand-in is written that way. So the question is how many pinned
tests do the same thing, and the answer is a **candidate list**, not a ceiling:

| module | files searched | mutating | examples |
| --- | ---: | ---: | --- |
| `console` | 30 | **7** | `test-console.js`, `test-console-count.js`, `test-console-clear.js` |
| `process` | 114 | 3 | `test-process-raw-debug.js`, `test-process-really-exit.js` |
| `http` | 750 | 2 | `test-https-hwm.js` |
| `internal` | 29 | 2 | `test-internal-errors.js` |
| `path` | 22 | 2 | **`test-path-resolve.js`** (confirmed), `namespace-identity-static.js` |
| `dgram`, `net`, `os`, `stream`, `util` | — | 1 each | |

**One of the twenty-one is confirmed.** The rest are candidates and cannot be
confirmed until their modules publish enough to run: `console` publishes nothing
node has, so its seven fail today for a reason that has nothing to do with this,
and whether they would *also* fail for this reason is not measurable yet.

Four sites matching a pattern pointed at seventy once in this ledger and the
answer was nine, which is why this is a list and not a number. What can be said
now:

- The mechanism is real and demonstrated once.
- It is invisible to `--sabotage`: such a test still fails when the module is
  blanked, so it is not hollow by the definition this lane uses.
- It means **`prize.mjs`'s "to gain" is an upper bound in a second way** -- some
  of those files are not winnable by any compiler change.
- `console` is the module to watch. Seven of its files capture output by
  reassigning `process.stdout.write` or through node's `hijackStdout`, and our
  `nts_write_stdout` stand-in forwards to `process.stdout.write` at call time
  while the C writes to the descriptor. If those seven do diverge when `console`
  starts publishing, its ceiling is 12 of 19 rather than 19.

### Confirmed, without waiting for `console` to publish

`binding-probe.sh` builds an addon around a module's C without compiling the
module, so the mechanism can be measured directly.
`tooling/conformance/probes/stdout-capture.ts` declares `nts_write_stdout` and
calls it. Both directions:

    compiled binding      wrote to the terminal; the reassigned write captured ""
                          -> NOT OBSERVED
    interpreted stand-in  the reassigned write captured "HELLO-FROM-THE-STANDIN\n"
                          -> OBSERVED

So the stand-in is observed and the compiled binding is not, for `stdout` and
not only for `cwd`. And the seven files **assert on what they captured** --
node's `test-console-count.js` is

    process.stdout.write = (string) => buf = string;
    …
    assert.strictEqual(buf, 'default: 1\n');

and this lane's `count-static.js` does the same. With the compiled binding
writing to descriptor 1, `buf` stays empty and every assertion fails.

**`console`'s ceiling is 12 of 19, and that is measured rather than predicted.**
Two of the twenty-one candidates are now confirmed -- `test-path-resolve.js` by
running it, and this class by probing the binding both ways.

### And the next candidate probed the same way came out the other way

`os/test/core-static.js` sets `process.env.TMPDIR` and asserts what
`os.tmpdir()` answers -- the same shape: a test mutating node state and
expecting our module to see it. Probed with
`tooling/conformance/probes/env-capture.ts`:

    process.env.NTS_PROBE_VALUE = "set-from-javascript";
    compiled nts_process_env read "set-from-javascript"   -> OBSERVED

**It is not a divergence.** Node's `process.env` setter calls `uv_os_setenv`,
which updates the real environment, so the C's `getenv` sees it. The stdout case
cannot work that way because a reassigned `process.stdout.write` changes a
JavaScript property and nothing else.

**So the shape of a case does not decide its answer**, and this is why the
twenty-one are a list. Had they been treated as a population, `os` would have
been written off as having an unwinnable test -- and `os` is the one module a
single export makes whole. Its ceiling is **9 of 9**.

### Answered per binding, which is smaller and more durable than per test

One answer per binding covers every pinned test that reaches it. Measured with
`probes/standin-observability.ts` and `probes/env-capture.ts`, each mutation
applied the way node's own tests apply it:

| binding | mutation | compiled binding |
| --- | --- | --- |
| `nts_process_env` | `process.env.X = "…"` | **OBSERVED** -- `uv_os_setenv` updates the real environment |
| `nts_write_stdout` | `process.stdout.write = fn` | NOT OBSERVED -- writes descriptor 1 |
| `nts_write_stderr` | `process.stderr.write = fn` | NOT OBSERVED -- writes descriptor 2 |
| `nts_platform` | `process.platform = "win32"` | NOT OBSERVED -- read `"linux"` |
| `nts_stdout_is_tty` | `process.stdout.isTTY = true` | NOT OBSERVED -- read `false`, which is what `isatty(1)` says |

The last row is worth reading carefully: the binding is **right about reality**
and merely does not see the lie. That is the correct behaviour for a compiled
artifact and it still fails a test that told the lie and expects it back.

So the rule is the one the `env` case forced: **a stand-in is observed where the
C is not, and only where the mutation does not reach the operating system.**
`process.env` reaches it; a reassigned property does not; `platform` and `isTTY`
are read from the host at the point of call and cannot be reached at all.

Two confirmed divergent test files, one confirmed not, and five bindings with a
settled answer each -- which is what the remaining eighteen candidates will be
decided by, one lookup rather than one probe.

### Applied by lookup: 20 test files the compiled binding cannot observe

With one answer per binding, every pinned and local test file in the profile can
be classified without probing each. Files whose mutation touches a binding the
compiled artifact cannot see:

| files | via | examples |
| ---: | --- | --- |
| 5 | `isTTY` | `color-options-static.js`, `test-console-tty-colors.js`, `test-repl-colors.js`, `test-util-styletext.js` |
| 4 | `process.stderr.write` | `test-process-raw-debug.js`, `test-process-warning.js`, `test-global-console-exists.js` |
| 3 | `process.stdout.write` | `count-static.js`, `test-console-count.js`, `test-internal-errors.js` |
| 3 | both writes | `test-console.js`'s siblings -- `test-console-group.js`, `test-console-instance.js`, `test-common.js` |
| 2 | `isTTY` + both writes | `test-console.js`, `test-console-diagnostics-channels.js` |
| 2 | `process.cwd` | `test-path-resolve.js`, `test-util-inspect.js` |
| 1 | `isTTY` + `process.stdout.write` | `test-console-clear.js` |

**20 files.** The earlier scan said 21 candidates; that scan was case-insensitive
and matched `hostProcess.platform ===` as an assignment, which is how `os` came
to look like it had one. It does not.

`isTTY` is the largest group and was not in the original list at all -- five
files across `console`, `repl` and `util` set `process.stdout.isTTY` to choose a
colour path. The compiled binding answers `isatty(1)`, which is **right about
reality** and not what the test told it.

Every one of these is a file that passes interpreted by construction. None is a
defect in a module. They are the shape of the ceiling, and the ceiling is per
module: `console` 12 of 19, `path` 20 of 21, `os` 9 of 9.

## Re-derived on v17 (`4cbf4cf2`): the axis moves to 17, and three divergence shapes close

Thirteen modules rebuilt from one pin, then measured.

### The axis

    punycode    3 passed,  0 degenerate  ->  3 behaviour-dependent
    path       14 passed,  3 degenerate  -> 11        (was 12 and 9)
    os          4 passed,  1 degenerate  ->  3
    buffer      0 passed,  0 degenerate  ->  0

**17 behaviour-dependent passes across 3 modules**, up from 15. Still 1 of 22
whole. The two `path` files are the namespace value members: `win32.sep` is
`"\\"` and `posix.sep` is `"/"`, and both namespaces now carry 13 members
against node's 17.

**`buffer` 5 published to 3 moved its compiled count by nothing** -- 0 either
way, as the compiler lane predicted. Both names it lost were uncallable, so
removing them cost no test and the export count is now honest. That is the sixth
correct-work-no-movement of the night and the first from *removing* names.

### Published, counted as node's own

    os 17   path 15   punycode 6   async_hooks 3   buffer 3   net 3
    fs 2    util 2    http 1       stream 1        zlib 1
    readline 0 of 7   timers 0 of 2   url 0 of 1

**54 of node's own names across 11 modules.** `fs` gained one and `zlib` came
off zero. `timers` lost `clearImmediate` to the opaque-signature decline and now
publishes two names, neither node's.

### The divergence family: three of four shapes closed

    basename("/a/b.txt")      agrees    (arity)
    toNamespacedPath(null)    agrees    (parameter type)
    resolve(42)               agrees    (rest element, and the error identity with it)
    join("a", 1)              agrees
    dirname()                 DIFFERS   ours ERR_MISSING_ARGS, node ERR_INVALID_ARG_TYPE

Both namespaces, member by member, over twenty inputs chosen for what `posix`
and `win32` disagree about:

    400 case(s) where both returned a value:   0 differ
     40 case(s) differ only in which error was thrown

All forty are the **missing-argument** case -- `relative("/")`, one argument to a
two-argument function. That is the arity check firing before the module's own
validation, and the compiler lane has shown it is load-bearing: `dirname(path:
string)` compiles `path` to `NtsString *`, so `validateString` is statically
dead and removing the check dereferences null rather than reproducing node's
error. It is the last shape of the four and the only one that is not simply a
fix.

`path` is 14 of 21 with 7 to gain: `format` 2, object representation 2,
`matchesGlob` 1, `process.cwd` 1 (unwinnable), and its surface test, which now
reports six findings at once instead of one.

## The rest parameters are `paths`, and `resolve`'s message now matches node

`posix.ts` and `win32.ts` declared `resolve(...args)` and `join(...args)`;
node's are `...paths`. The wrapper's rest gatherer reports the **TypeScript
parameter name**, so ours said `args[0]` where node says `paths[0]`.

Renamed in all four -- 22 occurrences, 0 type errors, interpreted 21 of 21
unchanged:

    ours resolve: The "paths[0]" argument must be of type string. Received type number
    node resolve: The "paths[0]" argument must be of type string. Received type number (42)

Identical except that node appends the value.

**`join` still differs and the reason is not naming.**

    ours join: The "paths[1]" argument must be of type string. Received type number
    node join: The "path" argument   must be of type string. Received type number (1)

Node's `join` is `...paths` too, and its message says `"path"` because **its own
loop validates each element** as `validateString(arg, "path")` -- which is
exactly what `posix.ts:120` does. The gatherer cannot know that; it reports the
parameter it gathered into. So `join`'s remaining difference is the
wrapper-pre-empts-validation class, one instance further along, and not
something a rename reaches.

### And a third artifact measured that was not mine

The reading before this one said `path` was **14 of 21 on v17**. It is 12 on
v17. The 14 was the other session's gate, which now builds addons and had
rebuilt `path.node` between my build and my measurement -- so I measured their
binary and attributed it to my pin. The rename then looked like a two-test
regression, which is how it was caught.

Third time tonight: once with `basename` appearing to agree, once with the
mixed-artifact published counts, now this. **`build.sh` writing into
`target/node` means any measurement there is a measurement of whoever built
last**, and the only defence is to rebuild immediately before reading and to
treat a surprising improvement as a provenance question first.

On v18 -- rebuilt and read in the same minute -- `path` is 14 of 21 with the
rename in place, so the rename costs nothing and buys `resolve`'s message.

## An expectation that names something unconditional cannot fail

`rest-element-error-replaces-the-modules-own` was filed with

    expect: emit-c --napi -> emits-addon could not gather the rest arguments

which is `nts_napi_check`'s **fallback message**, written into every emitted
addon whether or not anything reaches it. Counted in the fixture's own addon
across the fix that closed the defect:

| text the expectation named | pre-fix binary | fixed binary |
| --- | ---: | ---: |
| `could not gather the rest arguments` (as filed) | 1 | **2** |
| `nts_napi_rest(env, info, 0, true, "args"` (repaired) | **0** | 1 |

The filed expectation is present **on both sides** -- it went up rather than
away -- so the fixture would have reported `reproduces` after the defect was
gone, forever. The repaired one names the gatherer's call site with the
fixture's own parameter name, scores zero before and one after, and is what a
guard has to be.

**This is the second of its kind in two days and the pair is sharper than
either.** The compiler lane's guard expected `the compiled function requires 1
argument` while the old compiler emitted `requires 1 arguments` -- the plural was
unconditional, so the expectation was a *substring* of the wrong output. Mine
named a message that is written unconditionally. Both are the same shape:

**The text a fixture names must be text that the fix changes.** Error strings
are the most tempting thing to name and the worst candidate, because they are
emitted once into every artifact and reached rarely -- so they are present when
the defect is present, present when it is gone, and identical either way.

The way to tell is the one both were found by: **run the guard against a binary
that predates its own fix.** Reading it cannot distinguish the two cases; a
count of 1 and 2 across the change does it immediately.

## What `os.constants` has to be, beyond crossing

`os` is five files behind one export and it is the only module in the profile a
single export makes whole. Those five assert more than the value's presence, and
the requirements are worth having before the crossing is built rather than after
it lands and two of the five still fail.

Measured against `node:os` directly:

    os.constants          frozen: false
      signals             frozen: TRUE     33 keys
      errno               frozen: false    79 keys
      priority            frozen: false     6 keys
      dlopen              frozen: false     5 keys

**Only `signals` is frozen.** That asymmetry is node's, not a transcription
choice, and `constants-signals-static.js` asserts it directly:

    assert.strictEqual(Object.isFrozen(constants.signals), true);
    assert.throws(() => (constants.signals.FOOBAR = 1337), TypeError);

The file is `"use strict"`, so the second line needs the assignment to *throw*
rather than silently fail -- which follows from frozen, and would not follow
from a plain object that merely refuses new keys.

So the full requirement is:

1. `constants` crosses as an object -- the object-return path.
2. Its four table fields cross -- the map crossing outward.
3. `signals` arrives **frozen**, and the other three do not.
4. `SIGUSR1` is read from the platform: 10 on Linux, 30 on macOS, which is why
   `readConstants` builds the table rather than transcribing it.

**Point 3 is already done, and by this lane's own file.** `os/shape.mjs:39` is

    if (constants !== undefined) Object.freeze(constants.signals);

with the note at line 9 saying why: *"Node publishes null-prototype constant
tables and freezes `signals`. Copying into that public shape leaves the
statically assembled TypeScript records ordinary and keeps all metaobject work
at this host boundary."*

So the asymmetry is expressed in the right place and the boundary does not have
to carry it. **This is the second time tonight a requirement handed to the
compiler lane turned out to be satisfied by a file of mine whose note had not
caught up** -- the first was claiming `os` could not load. Both times the survey
read the requirement off node and off the tests without reading the shim that
already met it.

That is not an argument against surveying node. It is an argument for reading
the shim in the same pass: the shim doing metaobject work deliberately is
exactly the design that lets the crossing not have to, so a requirement derived
from node alone will always overstate what the compiler owes.

`core-static.js` also destructures `PRIORITY_BELOW_NORMAL` and `PRIORITY_LOW`
from `constants.priority`, so the `priority` table has to carry its five names
and not only exist.

## `util.types` publishes 31 predicates and none can be asked about a reference

Comparing every published node-name against node found one divergence outside
`path`:

    util.types.isDate(new Date())     ours  TypeError: an argument of this type
                                            has no representation in the compiled runtime
                                      node  true

It is not one predicate. `util.types` publishes **31 of node's 43**, and every
one of them refuses a reference at the boundary while answering for scalars:

    types.isDate  isMap  isSet  isWeakMap  isWeakSet  isPromise  isNativeError  …
      4 shape(s) hit the boundary, 1 reached the module's own validation, 8 succeeded

`isDate("")` returns `false` correctly. `isDate(new Date())` cannot be asked.
**These are predicates whose entire purpose is to answer about references**, so
publishing them and refusing the reference is the `buffer.isUtf8` shape at
thirty-one times the scale -- and unlike `isUtf8` they are not fully unusable,
which is why the first version of the instrument reported `util` clean.

Across the profile, 39 of 103 published functions refuse at least one argument
shape at the boundary:

    util          31   every `types` predicate
    path           6   `toNamespacedPath({})` and its aliases in both namespaces
    async_hooks    1   `executionAsyncResource`, unusable -- outbound
    url            1   unusable
    os             0
    punycode       0

**The `path` six are deliberate.** An object with no representation raises a
loud `TypeError` rather than answering wrongly, which is the trade the compiler
lane chose and this ledger agreed with. The `util` thirty-one are not deliberate
-- nothing chose to publish a predicate that cannot see its own subject.

### Correction: the refusal is deliberate, and that is the stronger finding

The section above called the `path` six deliberate and the `util` thirty-one
not: "nothing chose to publish a predicate that cannot see its own subject."

**Wrong, and wrong in the direction this ledger exists to catch.** Something did
choose, and wrote it down. `blockers/unknown-at-the-boundary` is the fixture:

> A string, number, boolean, `null` and `undefined` cross carrying their tag.
> An object, array, function, symbol or bigint raises a `TypeError` naming the
> limitation, **because answering `undefined` for a value the caller really
> passed is the wrong-value failure this compiler refuses everywhere else.**

One choice, made once, for a reason this ledger agrees with. It produces the
`path` six and the `util` thirty-one alike. I asserted intent without reading
the directory where intent is recorded -- the same error as claiming `os`
could not load from a stale comment in my own fixture.

### What survives the correction, and it is sharper

The trade is: refuse loudly rather than answer wrongly. **It is priced on the
value being read.** For `toNamespacedPath(v)`, which returns `v`, that price is
real -- there is no answer without the value.

`util.types` does not read the value. Measured across all 42 exported
predicates:

    value .   value [   value (      0 occurrences -- none dereferences it
    instanceof / typeof                every one, and nothing else

29 take `(value: unknown)` and classify it; 13 take `(_value: unknown)` and
never read it at all, because cross-realm recognition "belongs to the engine
metaobject model and is intentionally not approximated here".

So the stated reason for the refusal does not reach these functions. Nothing
here would answer `undefined` for a value the caller passed, because nothing
here answers *from* the value -- it answers from its brand. `isDate` needs a
type tag, not a materialised `Date`.

Measured on the addon, `isDate` against node:

    undefined null "" "x" 0 1 true      ours false     node false    7 agree
    [] {} new Date() new Map() /a/
    new Error() new Uint8Array () => {}  ours TypeError node false/true  8 differ
    (no argument)                        ours arity     node false

**The one node answers `true` for is the only argument the function exists to
recognise.** Seven scalars agree, and they are the seven a `Date` predicate is
never called with.

That is the argument for an inbound brand check, and it is not "the boundary
has a bug". It is that a representation-free classification is a *different*
operation from carrying a value, the refusal was priced for the second, and 42
functions in one module need only the first.

### Two instrument corrections this took

`unusable-exports.mjs` reported `util` clean twice before this.

**It walked only the top level.** `util.types` is a plain object, not a function,
so 31 predicates were never called. It now walks one level into published
objects.

**And it stopped at the first success.** `isDate("")` succeeds, so `anyOk` was
true and the boundary failures behind it were never counted. The criterion is
now "any shape hits the boundary", split into `UNUSABLE` (none succeeded) and
`UNREACHABLE FOR SOME ARGUMENTS` (some did) -- because a function that works for
scalars and refuses references is a different finding from one that refuses
everything, and calling both unusable would have been wrong in the other
direction.

## `string_decoder` has no refusals of its own

The goal names `string_decoder/test/core-static.js` and says to hold it as it
is. Worth saying where the module actually stands, because "0 published" reads
like the module is far away and it is not:

    string_decoder     64 NTS1001, 128 NTS1003, 0 names published
    its own src/       **0 refusals**

Every root is in something it imports:

    runtime/node/buffer/src/main.ts       24
    runtime/node/internal/errors.ts       17
    runtime/node/buffer/src/blob.ts       14
    runtime/node/internal/validators.ts    4
    runtime/node/internal/uv.ts            4
    runtime/node/buffer/src/encodings.ts   1

`blob.ts`'s fourteen arrive because `buffer/src/main.ts:35` re-exports `Blob`,
`File` and `resolveObjectURL`, so every module that imports `Buffer` compiles
Blob as well. That is buffer's structure and not a defect; it is worth knowing
when reading a root count, because fourteen of `string_decoder`'s sixty-four
belong to a class it never mentions.

### The three places its chains currently end

`last-mile.mjs` walks each cascade to the root inside the declaration it names:

    buffer/src/main.ts:575:54     `this` outside a method
    buffer/src/main.ts:196:26     an erased value where a concrete representation is wanted
    buffer/src/encodings.ts:279:10 `toString` on a number
    UNRESOLVED Buffer.alloc (stopped at Uint8Array#fill)

**Three chain heads is not three fixes.** That tool's own header records the
falsification: `join` landed on all three receivers, `errors.ts:547` cleared,
and `string_decoder` went from 65 refusals and 0 published to 65 and 0, with the
head moved sixteen lines down the same function to a harder problem. Read this
as where each chain ends today.

All three now have a reproducing fixture, which took one new one and two
checks that the message was the cause:

    `this` outside a method     blockers/this-in-a-default-parameter   NEW
    `toString` on a number      blockers/number-tostring-radix         `code.toString(16)`, the same construct
    an erased value             blockers/intersection-from-two-narrowings

The third is the one I would not claim. That fixture narrows by a builtin
(`ArrayBuffer.isView`) in one function and by a user guard in another; buffer
**stacks** them -- `ArrayBuffer.isView(value)`, then `hasArrayLikeShape(value)`,
then the call. A probe of the stacked form refuses at the same message and the
same column, but same message and same column is what I have twice today
mistaken for same cause. **The prediction, so it can be checked rather than
assumed: if clearing that fixture does not clear `buffer:196`, the stacked form
is a separate construct and wants its own.**

### Two guesses that were wrong before the fixture was right

Filing `this-in-a-default-parameter` took three reductions.

`this.length` in a default parameter on a **plain class** emitted no diagnostic,
so I read it as lowering fine and looked elsewhere. Then `extends Uint8Array`
emitted none either. Both were wrong for the same reason: with nothing exported
that reaches the class the wrapper declines it, lowering never walks the method,
and **the construct under test is never reached**. An absent diagnostic from a
program that was never lowered looks exactly like a clean bill.

The third reduction added entry points and checked `program.c` for the method
symbols -- `bodyRead` and `fromConst` present, `fromThis` absent -- which is the
difference between a probe that passed and a probe that did not run.

## `target/node` is shared, and every axis number today was read from it

The rule for the compiler is written down and I follow it: copy
`target/release/nts` to a scratch path, pass `NTS_BIN`, never measure the live
binary. The artifact directory needed the same rule and did not have it.

A 22-module axis run reported:

    buffer     97 file(s): 0 passed, 55 failed, 1 skipped, 41 not applicable

A re-run minutes later, same addon, `md5 c51f7e28d8fe4e320c3dc727badc73bd`, three
times in a row:

    buffer     97 file(s): 1 passed, 54 failed, 1 skipped, 41 not applicable

Nothing of mine had rebuilt anything. What had:

    14:02:01  target/node/fs.node
    14:02:26  target/node/http.node
    14:02:49  target/node/net.node
    14:02:53  target/node/os.node
    14:02:58  target/node/path.node

Another session running its own rebuild sweep, alphabetically, through the
directory my run was reading. `ps` showed `build.sh path` with no parent of
mine. **Nothing in any of my scripts could have told me** -- the addon is a file
at a fixed path, the run reads it, and a run that reads a different file than
the one it thinks it is reading produces numbers with no defect and no fix.

### The wrong explanation I had already started writing

`run.mjs:317` sets a 60-second per-test timeout, and I had been running
`blockers-check.mjs` -- 104 compiler invocations -- concurrently with the axis
sweep. A test timing out under load and being counted as a failure explains the
observation completely, it is a real hazard, and it is not what happened.

I found it only because I checked `ps` for what else was running before
re-running, and the thing that was running was somebody else's build. **A
plausible mechanism that accounts for the evidence is not the mechanism.**

### The fix, and what it does not cover

`build.sh` takes `NTS_ADDON_OUT` and `axis-controls.mjs` reads the same
variable, so a run builds into its own directory and measures what it built. The
default is unchanged, so no other caller or lane moves.

`loads.sh` still names `target/node` directly, and the first isolated run called
it -- so that run's LOAD section is against the shared directory and is
disregarded here. Fixing a callee while the run that calls it is in flight
produces a measurement half from each version, which is the same class of defect
as the one being fixed.

### Which numbers this invalidates

Every compiled-axis figure taken today after roughly 14:00 was read from the
shared directory during another session's sweep. The **17 behaviour-dependent**
figure and the per-module table behind it are withdrawn pending the isolated
re-run, not because they are known wrong but because they are not known to be
about any particular set of artifacts.

The `os` breakdown is kept: 3 behaviour, 2 shape-only, 0 hollow, derived
file-by-file and reproduced by hand against a stable addon before the sweep
started.

### `every-pass-hollow` is now `no-pass-behaviour-dependent`

The stage label `sweep.mjs` gives a module with `real === 0` said the passes
were hollow. It does not know that.

`real` is `pass - degenerate`, and `degenerate` is the pass count under
`--mutate-addon`. Mutation keeps the addon's names and destroys its behaviour,
so a test of a **frozen data table** survives it while still requiring the
module to exist. `os/test/constants-signals-static.js` is exactly that, and it
fails `--empty-exports` and `--sabotage`. Calling it hollow is wrong in the
direction that matters: hollow means "would pass with no module at all", and
this one would not.

The arithmetic is unchanged and the stage decision is unchanged -- a module
whose every pass is a data-shape check has not been shown to compute anything,
and that row should not read `partial`. Only the name moved, so it stops
claiming something the measurement cannot support.

Rows in this document from before this change carry the old label. They are
records of runs that emitted it and are left alone; `every-pass-hollow` and
`no-pass-behaviour-dependent` are the same condition, `real === 0`.

For the three-way split -- hollow, shape-only, behaviour -- run
`axis-controls.mjs`, which asks `--sabotage` and `--empty-exports` of the
compiled lane as well. `sweep.mjs` only ever asked those of the interpreted one.

## An isolated build: 22 build, 22 load, and where the refusals concentrate

Built with one pinned compiler into a private directory (`NTS_ADDON_OUT`), so
every number below is about artifacts this run produced and no other session
touched.

    22 module(s) built
    22 load, 0 crashed or failed, 0 not built

Published names, and how many are node's:

    os            17 (all)      readline       7 (0 of them node's)
    path          15 (all)      buffer         3 (all)
    async_hooks   16 (3)        net            3 (all)
    punycode       6 (all)      fs             2 (all)
    http           2 (1)        timers         2 (0)
    util           2 (all)      url            1 (0)
    stream         1 (all)      zlib           1 (all)

**Eight modules publish nothing**: `assert`, `console`, `dgram`,
`diagnostics_channel`, `events`, `process`, `querystring`, `string_decoder`.

### The two nearest are blocked entirely by what they import

    module              NTS1001   own src
    string_decoder           64         0
    querystring              66         1
    diagnostics_channel      49        19
    events                 1121        30
    assert                 1205        47
    process                1928        38

`string_decoder` has no refusals of its own at all, and `querystring` has one --
`decodeURIComponent`, a builtin the compiler does not provide. Their dependency
roots are the **same five files in the same counts**: buffer/main 24,
internal/errors 17, buffer/blob 14, internal/validators 4, internal/uv 4. The
same work reaches both.

### Ranked by modules blocked, not by refusal count

`blocking-files.mjs`, over the 22 build logs:

    file                        modules  sites  lines
    internal/errors.ts               21     17    357
    internal/validators.ts           21      4     80
    internal/uv.ts                   16      4     64
    internal/async-hooks.ts          15      7    105
    buffer/src/main.ts               13     23    342
    util/src/inspect.ts              13     17    221
    buffer/src/blob.ts               13     14    182
    util/src/types.ts                13      9    117
    internal/tick.ts                 13      4     45
    util/src/value-shape.ts          13      2     13

**Four sites in `internal/validators.ts` are on the path of 21 of 22 modules**,
and they are two causes:

    15:26   const LINK_HEADER_VALUE = /^(?:<[^>\r\n]*>)…/   a regex literal
    166:37  LINK_HEADER_VALUE.test(value)                   downstream of 15
    232:14  const OCTAL = /^[0-7]+$/                        a regex literal
    243:16  const given = value ?? byDefault                an erased value

Both columns are printed because the wrong one is four times larger and reads
like progress. `errors.ts` produces 357 NTS1001 lines and has 17 distinct
`line:col`; the 357 is 21 modules recompiling the same seventeen constructs.

### The parse was wrong in the direction that hides a blocker

The first version matched `NTS1001 (.*?) is not supported`. **295 lines do not
end that way** -- `NTS1001 \`atob\`, a declaration outside every walk` has no
such suffix -- and they were dropped in silence. `internal/uv.ts` came out as 2
distinct sites when it has 4, and `buffer/src/main.ts` as 21 when it has 23.

Worth the paragraph because of the direction. A parse that drops what it cannot
match makes a blocking file look *less* blocking, and nothing in the output says
so. The tool prints its unparsed count on every run now, and says what a nonzero
one means.

## The compiled axis, isolated and controlled three ways

Pin from 13:42, built into a private directory, every pass put through
`--mutate-addon`, `--empty-exports` and `--sabotage`.

    module      pass   behaviour   shape-only   hollow
    path          14          11            1        2
    os             4           3            1        0
    punycode       3           3            0        0
    stream         2           0            0        2
    timers         1           0            0        1
    fs             1           0            1        0
    util           1           0            1        0

    26 pass: 17 behaviour-dependent, 4 shape-only, 5 hollow, across 7 modules

**Five of the twenty-six passes are hollow** -- they pass with no module at all:

    path      test-path-posix-exists.js       test-path-win32-exists.js
    stream    test-global-webstreams.js       test-stream-aliases-legacy.js
    timers    test-timers-promises.js

So `stream` and `timers` demonstrate nothing on this axis; their entire presence
is hollow. Three modules show behaviour: `punycode` 3, `path` 11, `os` 3.

### What found them, and why nothing had

`--empty-exports`, and **no lane was asking it of the compiled axis**.
`sweep.mjs` runs `--sabotage` against the interpreted lane and `--mutate-addon`
against the addon, and neither catches these:

    path under --sabotage        (nothing passes)
    path under --empty-exports   test-path-posix-exists.js, test-path-win32-exists.js

`sweep.mjs`'s own comment predicted this exactly -- those files assert
`require('path/posix') === require('path').posix`, sabotage fails them "for the
wrong reason, the subpath stopping resolving", and so it "reported a clean
hollow count". The prediction was written down and the control was never run
against the compiled lane. `axis-controls.mjs` runs all three.

`vacuous-lane.mjs` does not cover them either: it states the arithmetic for a
module publishing **zero** exports, and `path` publishes fifteen.

### Against the previous number

The last figure from this lane was "27 raw, 10 degenerate, 17
behaviour-dependent". The 17 agrees. That is a coincidence and not a
confirmation: the earlier run read a directory another session was rebuilding,
its raw total was 27 against 26 here, and its 10 "degenerate" is 4 shape-only
plus 5 hollow plus one pass that no longer exists. Two numbers agreeing at the
bottom of different columns is worth less than either.

### One pin behind

`os` scores 4 here and scored 5 from the shared directory, and the extra was
`local/constants-signals-static.js`. The compiler moved at 13:56, fourteen
minutes after this pin was taken, and the shared directory had been rebuilt with
it. So `os.constants` works in a compiler this measurement does not include --
these numbers are one landing behind, in the conservative direction, and are
labelled by their pin rather than adjusted.

### Correction: "the narrower type cannot come back" was wrong, and the error was mine

This ledger recorded:

> `object` is narrower than `unknown` and it is the only one of the three that
> cannot come back.

From three functions:

    returnsUnknown(): unknown       -> 7          crosses
    returnsShaped(): { a: number }  -> {"a":7}    crosses
    returnsObject(): object         -> THREW

**Two variables move across those rows** -- the declared type and what the body
returns -- so the conclusion could have been about either, and it was about the
other one. The compiler lane emitted the missing function rather than accepting
the reading. Filling the cell in:

    unknownScalar(): unknown         -> 7          crosses
    unknownString(): unknown         -> "s"        crosses
    unknownReference(): unknown      -> THREW      <- the row nobody ran
    objectReference(): object        -> THREW
    shapedReference(): { a: number } -> {"a":7}    crosses

`unknown` and `object` lower to the same `erased` type and get a **byte-identical
wrapper**; `nts_to_napi_value` switches on the tag, converting UNDEFINED, NULL,
BOOLEAN, NUMBER and STRING and throwing on the rest. The rule is:

**An erased value carrying a reference cannot cross outward, whatever its
declaration says. A statically shaped object can.**

A string is the one reference that converts, which is what made a value-shaped
boundary look type-shaped. `async_hooks.executionAsyncResource` is behind this
wall, not behind its `(): object` declaration.

What the error nearly cost: an arm added to `cross` for `object`, which would
have done nothing, because there is no arm to add. The crossing exists and the
runtime refuses.

### And the inbound half is total

Asked the mirror question, the direction turns out not to be symmetric at all:

    shapedReference(): { a: number }        crosses outward
    shapedInbound(p: { a: number })         NOT PUBLISHED
    dateInbound(d: Date)                    NOT PUBLISHED
    classifyInbound(v: unknown)             published, throws on a reference

`no wrapper for shapedInbound: takes an object, which crosses outward only`.
**Nothing object-shaped crosses inward** -- not `unknown`, not `object`, not a
declared interface, not a builtin class, not an array of them. So inbound is not
an erasure problem the way outbound is; it is the whole direction.

That matters for what a fix has to be. Outward, the descriptor exists and the
question is which of three existing conversions to read it with. Inward, the
question is what to build, and there is no partial version already working to
extend.

### The instrument now stops rather than reporting this

`reference-boundary.sh` gained a guard that has nothing to do with references:
if `unknown` and `object` ever disagree, the run prints INSTRUMENT FAILURE and
exits. They are the same erased type with the same wrapper, so a disagreement
means the probe is wrong -- which is exactly the state this file shipped in.

## Driving the hollow count to zero cost two modules and gained one pass

The five hollow passes, and what each turned out to be.

**Two needed a control to see. Three did not.** `path`'s pair are only visible
under `--empty-exports`. The other three compare two absences in the *ordinary*
run -- no lane required, nobody had looked:

    stream.Readable / require('_stream_readable')   both undefined
    timers.promises / require('timers/promises')    both undefined, and
                                                    deepStrictEqual({}, {}) holds
    ReadableStream  / require('stream/web').…       both Node's own

### `path`: replaced, and the axis went up

`local/subpath-identity-static.js` keeps `require('path/posix') === path.posix`
and puts in front of it what an absent module cannot satisfy -- the subpath must
resolve to an object carrying a `join` that returns a string containing its
arguments. It passes plain and **fails under all three controls**, so it is
behaviour-dependent.

    path   14 pass: 11 behaviour, 1 shape-only, 2 hollow
      ->   13 pass: 12 behaviour, 1 shape-only, 0 hollow

One fewer pass and one more thing demonstrated.

### `stream` and `timers`: replaced with guards that fail

There is no passing replacement to write. The aliases and the promises namespace
do not exist, so a file that requires them to exist fails. Both were written
anyway:

    local/legacy-alias-identity-static.js   requires each alias to construct an
                                            instance of its class
    local/promises-identity-static.js       requires setTimeout, setImmediate and
                                            setInterval to be functions, and one
                                            of them to resolve

Each fails today and passes the moment its subject appears. **A failing guard is
a truer axis entry than a passing assertion between two absences**, and both
modules now report zero compiled passes, which is what they have.

`test-global-webstreams.js` gets no replacement at all. `shape.mjs:91` assigns
the platform `node:stream/web`, and the globals it is compared against are those
same objects, so nothing of ours is on either side of it until Web Streams are
implemented here rather than bridged.

### What moved

    before   26 pass: 17 behaviour-dependent, 4 shape-only, 5 hollow, 7 modules
    after    22 pass: 18 behaviour-dependent, 4 shape-only, 0 hollow, 5 modules

Four fewer passes, one more behaviour-dependent, two modules off the axis. The
pass count went down and the axis got stronger, which is the direction this
ledger exists to be able to report.

## Three modules were on the axis all along, behind a suite that could not reach them

`net`, `stream` and `async_hooks` each recorded zero compiled passes. Each has
working, published behaviour. Nothing was asking it anything.

    net          getDefaultAutoSelectFamily / setDefaultAutoSelectFamily /
                 getDefaultAutoSelectFamilyAttemptTimeout -- all three node's,
                 and every upstream `test-net-*.js` needs a socket
    stream       getDefaultHighWaterMark, answering 65536 / 16 / 65536 for
                 false / true / undefined, exactly as node does
    async_hooks  the async id stack: newAsyncId advances, a push makes an id
                 current, a nested push nests, pops restore

All three now have a `local/*-static.js` that passes and **fails all three
controls**, so each is behaviour-dependent rather than shape.

### Each test had to defeat a constant

Reading one default is a shape question -- `--mutate-addon` keeps the names and
destroys behaviour, and a stub answering a constant satisfies "returns a
number". So each file asks for something a constant cannot do:

    net          a write has to be visible to the next read
    stream       two arguments have to give two different answers, and
                 `undefined` has to take the byte-stream branch
    async_hooks  a counter has to advance, and **two** pushes with an
                 observation between them have to nest -- one push and one pop
                 is satisfied by a single slot

### `stream`'s shape was throwing the working function away

The shim did `if (Stream === undefined) return {}`. The addon publishes
`getDefaultHighWaterMark` and it answers correctly, and the shape discarded it
because an unrelated export was missing -- so through the module the name was
simply absent. Found by asking the raw `.node` with `process.dlopen` and getting
a different answer than the module gave.

`os/shape.mjs` records the same mistake from the other side: "a shape that
throws on a missing export reports one fact about the addon and hides seven."
This was the silent version.

Surveyed the rest rather than assuming. **Six shims bail this way and it bites
in one**: `process`, `events`, `console` and `querystring` publish nothing, so
theirs discard nothing, and `timers` discards `decRefCount` and `TIMEOUT_MAX`,
neither of which is node's.

### And `--empty-exports` was not reaching the facade

The `async_hooks` file uses `internal/async_hooks`, the facade `shape.mjs`
builds because node's own `lib/` reaches those names. It passed under
`--empty-exports`, so the hollow check flagged **my own test**.

The cause was in the harness. `run-one.mjs` blanked what `shape()` was given and
passed the *real* exports to `subpaths()`, `internals()` and `testBindings()`.
A test reaching the facade therefore saw a fully working module while the public
surface was empty. The control's claim is "a file that passes under this passes
without the module having supplied the thing it names", and the facade is the
module supplying it.

All four now take the same blanked input.

**The five hollow findings were re-checked against this rather than assumed**:
`path`'s pair go through subpaths built from the shaped object, `stream`'s two
are `undefined` on both sides either way, `timers` is `{}` on both sides, and
webstreams is node's own on both sides. All five stand.

## What a compiled-axis number has to be measured with, after today

Four things changed about how this figure is produced, each because a number
produced without it turned out to be about something else.

**A private artifact directory.** `target/node` is shared with the other
sessions. A 22-module run reported `buffer 0 passed` while another session
rebuilt the directory underneath it; a re-run minutes later on the same md5 said
`1 passed`. `build.sh`, `loads.sh` and `axis-controls.mjs` take
`NTS_ADDON_OUT`, so a run builds into its own directory and measures what it
built.

**A quiet machine.** `run.mjs` sets a 60-second per-test timeout. Measurements
taken while this session was also compiling -- `blockers-check.mjs` is 104
compiler invocations -- disagreed with the same measurement taken alone, twice:
`buffer` and `util` each gained a pass that had previously timed out. Neither
was a change in the artifact.

**Three controls, not one.** `plain - mutate` was reported for weeks as
"behaviour-dependent". It calls a frozen data table hollow and it misses a pass
that survives with no module at all. The split is `hollow` (passes under
`--empty-exports` or `--sabotage`), `shape-only` (survives `--mutate-addon`),
`behaviour` (fails all three).

**A control that reaches the facade.** `--empty-exports` blanked what `shape()`
was given and handed the real exports to `subpaths()`, `internals()` and
`testBindings()`. So a test reaching `internal/async_hooks` saw a working module
with an empty public surface, and passed. Fixing that immediately exposed a
sixth hollow pass in `util` that had been classified `shape-only`.

### The order these were found in is the argument for all four

Each was found by a measurement disagreeing with another measurement, never by
review:

    the shared directory      loads.sh contradicted a table built minutes earlier
    the quiet machine         a re-run on an identical md5 gave a different number
    the three controls        my own os test was about to be recorded as hollow
    the facade                the hollow check flagged my own async_hooks test

**Three of the four were found by an instrument reporting something wrong about
my own work.** That is the argument for pointing them at it.

## An instrument that could not see the bug it was built from

`stream/shape.mjs` discarded a working `getDefaultHighWaterMark` because an
unrelated export was missing. That was found by accident. `hidden-exports.mjs`
was written so it would be found on purpose: for each module, compare what the
addon publishes against what the shim hands to a test.

The first version asked **"is this name reachable through any of the four
paths"** -- `shape()`, `subpaths()`, `internals()`, `testBindings()`. Run against
the fixed tree it reported five hidden names, none of them node's, which read
like a clean bill.

Then it was controlled by putting the defect back. With `return {}` restored in
`stream/shape.mjs`, it still reported **`0 of them node's own`**.

`stream/internals()` maps `getDefaultHighWaterMark` under
`internal/streams/state`, so by the "reachable anywhere" rule the name was never
hidden -- while a test asking `require("stream")` for it got `undefined`. The
instrument was asking a question whose answer did not change when the defect
came back.

### Two questions, and only one of them is serious

    NOT PUBLIC   node has this name on its public surface, the addon publishes
                 it, and the object `shape()` returns does not carry it
    hidden       published and reachable through none of the four paths

`NOT PUBLIC` is the one that matters: node's own tests reach for the name on the
module, and this profile computes it and does not deliver it. That is what
`stream` was, and the reachable-anywhere rule could not express it because the
facade counted.

`hidden` is weaker and usually legitimate. On the fixed tree it is five names:
`readline`'s four `kClear*` constants and `util`'s `styles`, none of which node
has publicly either.

### What the control cost, and the rule it confirms

Restoring the defect meant editing a file the axis run was about to read, and
`axis-controls.mjs` was three modules away from `stream` when I checked. It was
held until the run finished -- **a control that contaminates a measurement in
flight is not free**, and this session has already withdrawn one set of numbers
for exactly that.

The restore itself is worth a line: `cp` is aliased here and prompts on
overwrite, which hung the command until it timed out and left the tree patched.
`git checkout -- <path>` restored it, which is safe only because the change
under test was already committed.

## `fs.Stats` crosses with its methods and without its fields

`fs.Stats` is the compiled `fs`'s only computation a test can reach, and it
works: constructed with a mode, it classifies correctly.

    0o040755  isDirectory() true    0o100644  isFile() true
    0o120777  isSymbolicLink() true

Eight prototype methods, all present, all right. And:

    Object.keys(stats)   []
    stats.dev            undefined      stats.mode      undefined
    stats.nlink          undefined      stats.uid       undefined
    stats.gid            undefined      stats.rdev      undefined
    stats.blksize        undefined      stats.ino       undefined
    stats.size           undefined      stats.blocks    undefined

**Ten declared fields, none of them on the instance.** `fs/src/stats.ts:23`
declares them as ordinary instance fields -- `dev: number`, `mode: number` --
and the constructor fills them, because the methods that read them answer
correctly. They are there; they are not reachable from the host.

### It is not the class-export gap

`blockers/export-class` is fixed and is about the other half: "a Node-API class
needs a constructor that allocates the instance, a prototype carrying the
methods, and a finalizer". All three of those work here. Nothing in that fixture
mentions fields, and nothing in the blockers directory does.

### What it costs

Every `fs` test that reads a stat reads a field. `stats.size`, `stats.mtimeMs`
and `stats.mode` are the point of the object; `isFile()` is the convenience.
`fs` has 394 upstream files and one pass.

Counted rather than asserted: **24 of node's `test-fs-*.js` read a `.size`,
`.mode`, `.mtimeMs`, `.nlink` or `.ino` off a stat**. That is the number this
one gap sits in front of, and it is a floor -- the grep is for five field names
on any object, so it undercounts files that destructure and overcounts nothing.

The same shape will meet `buffer`, `url` and `stream` as their classes land --
`export-class` names all three as wanting the class export next, and a class
whose fields do not cross is a class whose tests cannot read anything it
computed.

### One class, and the generality is not measured

This is `fs.Stats`. It is the **only** class instance any compiled module hands
back today -- `buffer`, `url` and `stream` do not publish theirs yet -- so there
is no second case to compare and no reduction has been run. Whether every class
crosses this way, or `Stats` does for a reason of its own, is open.

Saying so because the tempting sentence is "a class crosses with its methods and
without its fields", and one instance does not measure that. A sample of one is
the same error as four sites pointing at seventy.

### Why it is not a blocker fixture

The same reason as the reference boundary: it publishes cleanly and answers
wrongly at run time. `napi_define_class` is emitted, the constructor runs, the
methods work, and `blockers-check.mjs` reads emitted text. This is the second
case this week for a guard form that runs an expression against a loaded addon.

## The compiled axis: 11 modules, 25 behaviour-dependent, 0 hollow

Isolated artifacts, one pinned compiler, three controls on every pass, and the
machine quiet. Where the day started, and where it ended:

    start (contaminated)   27 raw across 7 modules, no hollow check on the addon
    isolated               26 pass: 17 behaviour,  4 shape-only, 5 hollow,  7 modules
    hollow driven to zero  22 pass: 18 behaviour,  4 shape-only, 0 hollow,  5 modules
    end                    32 pass: 25 behaviour,  7 shape-only, 0 hollow, 11 modules

    module        pass   behaviour   shape-only   hollow
    path            13          12            1        0
    os               5           3            2        0
    punycode         3           3            0        0
    async_hooks      2           1            1        0
    util             2           2            0        0
    net              1           1            0        0
    readline         1           1            0        0
    stream           1           1            0        0
    fs               2           1            1        0
    buffer           1           0            1        0
    zlib             1           0            1        0

`fs` re-measured after `local/stats-mode-static.js` landed: 2 pass, 1 behaviour,
1 shape-only, 0 hollow. **The total is 32 pass: 25 behaviour-dependent, 7
shape-only, 0 hollow, across 11 of 22 modules.**

### Six modules joined, and none of them because the compiler moved

The compiler is the same pin all day. What changed is that six modules were
carrying working behaviour nothing was asking about:

    net          the autoSelectFamily trio, and a write visible to the next read
    stream       getDefaultHighWaterMark, two arguments giving two answers
    async_hooks  the async id stack, with a nested push that needs a stack
    readline     charLengthAt and charLengthLeft, agreeing with node on
                 surrogate pairs and combining marks
    fs           Stats decoding seven mode kinds into 49 predicate answers
    util         a subpath identity with a predicate that has to answer

Each of these modules had **zero** compiled passes this morning, and every
upstream test for them needs a socket, a stream, a filesystem or an async
context node creates. The behaviour was published and unreached.

### And five passes went away

`path`'s two subpath-exists files, `stream`'s two, `timers`' one and `util`'s
one -- six in total -- were assertions between two absences. Three needed no
control to see: `stream.Readable` and `require('_stream_readable')` are both
`undefined` in the ordinary run.

`timers` has no compiled passes at all now, which is what it has. It is the only
module that went backwards, and it went backwards to the truth.

### What the number is not

It is not "24 of node's tests pass". It is 24 files that pass **and** fail
`--mutate-addon`, `--empty-exports` and `--sabotage`, across 11 of 22 modules,
against roughly 1,800 applicable upstream files. The interpreted lane is a
different number and always has been.

## My own test passed on the compiled lane because the defect stopped the harness

`net/test/default-family-static.js` asserted node's documented default:

    assert.strictEqual(net.getDefaultAutoSelectFamilyAttemptTimeout(), 250);

It **passed on the compiled lane and failed on the interpreted one**, which was
found only by running the new tests against both. The compiled lane was the one
that was wrong.

`third_party/node/test/common/index.js:182` runs on load, in node and here:

    net.setDefaultAutoSelectFamilyAttemptTimeout(
      platformTimeout(net.getDefaultAutoSelectFamilyAttemptTimeout() * 10));

So every file that requires `../common` -- including that one -- sees **2500**
in node. Verified directly rather than read:

    node -e 'require("../common"); require("net").getDefaultAutoSelectFamilyAttemptTimeout()'
    2500

The compiled addon publishes `getDefaultAutoSelectFamilyAttemptTimeout` and not
its setter, so `common`'s call cannot land and the value stays unscaled at 250.
**The assertion held because the missing setter stopped the harness doing what
node does.** That is the fourth failure mode in the fixture rules -- a control
that suppresses the thing it controls for -- arriving in a conformance test
rather than a fixture.

### Split rather than deleted

`attempt-timeout-static.js` asserts the relation instead of the literal:
`common` moved the value, so the scaled figure is strictly greater than the
unscaled 250. `platformTimeout` scales again on slow builds, so 2500 is not
stable across machines and the relation is.

    default-family-static.js   interpreted pass   compiled pass    (three controls fail)
    attempt-timeout-static.js  interpreted pass   compiled FAIL

The second is an honest guard on the missing setter, and it passes the moment
the setter publishes.

### Both lanes, for every new test

The eight local tests written today were run against the interpreted lane as
well, which is what caught this:

    async_hooks internal-context-stack   readline char-length
    util types-subpath                   path subpath-identity
    stream default-highwatermark         stream legacy-alias-identity
    timers promises-identity             net attempt-timeout

**All eight pass interpreted**, including the two written as deliberate
compiled-lane failures -- the TypeScript has the stream aliases and the timers
promises namespace, and only the addon does not. So the compiled-lane failures
are about the addon and not about the assertions.

## `hidden-exports` caught a second one, hours after it was written

The instrument was built from `stream/shape.mjs` discarding a working
`getDefaultHighWaterMark`. Pointed at a build made with a compiler four hours
newer, it found the same shape in a different module:

    process: 1 published; 1 node-own name(s) not on the module, 1 reaching no test
        NOT PUBLIC  env: object

`process/shape.mjs:18` is `if (instance === undefined) return {}`, where
`instance` is `exports.default ?? exports.process`. The compiled `process`
publishes **`env` and nothing else** -- the compiler lane landed it today, 105
keys all matching node -- and neither `default` nor `process` is published, so
the shape hands back `{}` and the environment is unreachable.

That is the third instance of one mistake:

    os/shape.mjs    the version that *throws* on a missing export, fixed with a
                    note: "reports one fact about the addon and hides seven"
    stream          `return {}`, discarding getDefaultHighWaterMark
    process         `return {}`, discarding env

**The guard is right and its scope is wrong.** Reaching through an absent export
does turn one missing name into "the module did not load", and every one of
these files says so. What none of them does is distinguish "cannot build the
public object" from "cannot build any of it".

### Six shims bail this way and now two of them bite

The survey run this morning found `process`, `events`, `console`,
`querystring` and `timers` bailing like `stream` did, and reported that four of
them published nothing so their bail discarded nothing. **That was true this
morning.** `process` publishes now, and the same line that was harmless became
the thing standing between a working `env` and every test that reads one.

A survey of what a guard currently costs is a measurement with a shelf life. The
instrument is what makes it cheap to re-take, which is the argument for having
written it rather than reading the six files once.

## Two locks on one door: the inspect chain is clear

`internal/errors.ts:505` was a regular expression literal, and the compiler lane
named it as the only thing left in front of `inspectValue`:

    function inspectPropertyName(name: string): string {
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : inspectString(name);
    }

**It was also a conformance bug.** Node's is
`lib/internal/util/inspect.js:249`, `/^[a-zA-Z_][a-zA-Z_0-9]*$/`, used at
`:2336` for the same decision -- and it has no `$`:

    node prints   { '$a': 1 }   { 'a$b': 1 }   { '$': 1 }     all quoted
    ours would    { $a: 1 }     { a$b: 1 }

Ours was the JavaScript identifier rule, which is a different rule. Nothing was
testing it, and it was found by reading node's source before touching the file
rather than after.

That is why it was rewritten. This ledger's own opening says writing a module to
fit today's compiler means writing something that is not node's algorithm; a
corrected predicate spelled as the character test it already was is not that.
The loop was checked against node's regex over **524 keys** -- every ASCII
character in first, middle and last position, plus the empty string, `__proto__`
and non-ASCII -- and differs on none.

### Neither half would have done it alone

With the radix work landed and `505` still a regex, the head moved exactly one
link:

    inspectPropertyName cannot be compiled because it calls inspectString

and `inspectString`'s sole refusal was `errors.ts:476:23`, `code.toString(16)`.
Two locks, one door, one key each. Measured on the compiler lane's current
binary:

    string_decoder NTS1001   64 -> 59
    errors.ts roots          17 -> 14
    chain heads               3 -> 1

    inspectString  inspectPropertyName  inspectValueWithin  inspectValue
    ERR_OUT_OF_RANGE  ERR_INVALID_ARG_VALUE  ERR_UNKNOWN_ENCODING
    ERR_INVALID_ARG_VALUE_RANGE  ERR_SOCKET_BAD_PORT
    validateInt32  validateInteger  validateNumberRange

    zero mentions, all of them

### What is left on `string_decoder` is the head I refused to claim

    buffer/src/main.ts:196  an erased value where a concrete representation is wanted
    UNRESOLVED Buffer.alloc (stopped at Uint8Array#fill)

One head, and it is the one recorded earlier as not covered by
`intersection-from-two-narrowings` -- that fixture narrows by a builtin and by a
guard in **separate functions**, and `buffer` stacks them. The prediction written
down then is now the only question left on this module.

## A newer compiler published more and passed no more

The same isolated three-control measurement, on a compiler an hour and a half
newer:

    13:42 pin   32 pass: 25 behaviour-dependent, 7 shape-only, 0 hollow, 11 modules
    15:18 pin   32 pass: 25 behaviour-dependent, 7 shape-only, 0 hollow, 11 modules

Identical, and the compiler did not stand still: `os` went from 17 published
names to 19 with `constants` and `cpus` among them, `process` from 0 to 1,
`util` and `buffer` and `zlib` and `async_hooks` each gained. **Not one of those
names converted to a pass.**

Worth stating plainly because the published-name count is the number that moves
every day and reads like progress. It is a ceiling, not a score: a name has to
be reachable through the shim, callable with the arguments node passes, and
answering what node answers before any test changes its verdict.

The one that did convert took work on this side too. `process` publishes `env`
and `process/shape.mjs` returned `{}` because `default`/`process` was absent, so
the environment was unreachable from every test -- the same correction `stream`
needed. It is shape-only, and labelled so: `env` is a data table and survives
`--mutate-addon`.

## A fixture form for defects whose emitted text is correct

Three findings this week could not be filed as blockers, for one reason:

    util.types              publishes 31 predicates, none askable about a reference
    executionAsyncResource  publishes, is called, throws on every call
    a class's fields        publish nothing, while its methods publish and work

`blockers-check.mjs` reads emitted text, and all three emit well-formed text.
The wrapper is there, the names are there, `napi_define_class` is there. What is
wrong only appears when something calls it.

    // expect: emit-c --napi -> calls <expression>
    // control: <expression>

The form links the emitted C plus `runtime/node/internal/*.c` into an addon,
loads it with `RTLD_NOW`, and evaluates both expressions with the addon bound to
`exports`. Nothing else is linked: a fixture is self-contained by construction,
so anything else being needed is a fact about the fixture rather than about the
compiler.

The expression must be **true**, so a blocker asserts the defect as it stands
and stops holding when it is fixed -- the same direction as the diagnostic
forms, and it prints `reproduces` rather than `guard ok`.

### The control line is required, and it is why the form means anything

Every expression about a name that is not published is false. Without a control
that must hold, `instance.latitude === undefined` is equally satisfied by a
class that never compiled, and the fixture would report the defect on a tree
where the defect had been replaced by a worse one.

`class-fields-do-not-cross` controls with
`new exports.Reading(1, 2).distance() === 3`: the constructor ran, the prototype
is there, and the fields were populated. Only then does `latitude === undefined`
mean what it says.

### Three failure paths, and the quietest one was made the loudest

Controlled on the day it was written, with a throwaway fixture pointed at each:

    control false     CONTROL FAILED, quoting the control and what it gave
    call false        FIXED, quoting the expression and `got: false`
    nothing emitted   NOTHING EMITTED -- "the compiler wrote no C, so the call
                      was never made. This is not the expression answering
                      false. Read the diagnostics above before reading anything
                      else."

The third was asked for by name by the compiler lane, and both lanes had paid
for it separately in the same week: an empty diagnostic list reading as a clean
bill cost me three reductions in one afternoon, and cost them a guard that saw
text naming what it never defined and called it success.

### What converting `class-fields-do-not-cross` cost and bought

It was filed as `lacks-addon "latitude"`, and that expectation is sound --
`latitude` appears four times in `program.c`, zero times in `addon.c`, and zero
times in three unrelated fixtures' addons. The weakness was not the text but the
classification: **every absence form is a guard**, so the file printed
`guard ok` while the defect was present. Green, in a directory where green means
fixed.

Now it prints `reproduces`, and the two boundary blockers are filed beside it.
110 fixtures, 110 as expected.

## The prize, per module, and the one name behind each pile

Both lanes over the twelve modules with a compiled pass, on one pinned compiler
and one private artifact directory:

    module          interp  compiled  to gain  inverted   most-named
    fs                 346         2      344         0   mkdirSync (57)
    stream             250         1      249         0   Readable (80)
    net                150         1      149         0   createServer (96)
    async_hooks        117         2      115         0   createHook (65)
    process             89         1       88         0   _fatalException (73)
    zlib                68         1       67         0   it (6)
    buffer              55         1       54         0   from (19)
    readline            27         1       26         0   createInterface (9)
    util                25         2       23         0   inspect (3)
    path                20        13        7         0   posix (1)
    os                   9         5        4         0   userInfo (1)
    punycode             3         3        0         0

    1,159 interpreted    33 compiled    1,126 to gain

**`punycode` is whole**: three of three on both lanes, nothing to gain. It is the
only module in that state.

`os` at 4 and `path` at 7 are the only other modules within single figures, and
they are the two that have had the most compiler work.

### The `most-named` column is the prioritisation

It counts the names appearing in the compiled-lane failure messages of the files
that pass interpreted. One name accounts for most of several piles:

    createServer   96 of net's 149
    Readable       80 of stream's 249
    _fatalException 73 of process's 88
    createHook     65 of async_hooks' 115
    mkdirSync      57 of fs's 344

These are not 1,126 separate problems. Five names stand in front of 371 files.

`createServer` also carries `[optional-param]`: it takes an optional parameter
and the wrapper publishes it as required, which is
`blockers/optional-parameter-at-the-wrapper` rather than anything about `net`.

### `inverted` is zero, and it was not free

The column reports files that pass **compiled** and fail **interpreted**, which
cannot be a compiled capability the TypeScript lacks -- the compiled lane is
built from that TypeScript. It is an assertion holding for a reason other than
the one it states.

Zero across all twelve. The column exists because there was one: a test of mine
asserted node's documented `getDefaultAutoSelectFamilyAttemptTimeout` of 250,
passed compiled, failed interpreted, and was right on neither lane --
`test/common/index.js:182` scales that default by ten on load, and the compiled
addon does not publish the setter, so the scaling could not land. It held
because of the defect.

    put back, the column reports it     INVERTED  local/default-family-static.js
    removed again                       0

A column that has never been seen with a row in it is a claim about a tree
rather than a measurement of one.

### What is not in the table

`http`. Its shim threw on its own addon's exports -- an unguarded
`class HTTPParser extends RawHTTPParser` where the addon publishes two names --
so **every http test failed at load with one message** and the module had no
compiled pass to compare. That is fixed and `test-http-max-header-size.js`
passes now, shape-only; the row will appear in the next sweep.

Related and clean: all **39** shim entry points across the 22 modules were called
with an empty exports object and none threw, so `--empty-exports` and
`--sabotage` are sound everywhere and the hollow counts they produced are not
distorted by a shim falling over under the control.

## What a class actually carries across the wrapper

Measured on a three-member reduction and on `fs.Stats` separately:

    constructor         crosses      new Holder(7) works
    prototype methods   crosses      .get() answers 7, Stats' eight predicates answer
    instance fields     **no**       Object.keys(instance) is [], every field undefined
    static methods      **no**       Holder.make is undefined
    static fields       **no**       Holder.LIMIT is undefined

`napi_define_class` is emitted, the constructor allocates, the prototype is
wired, and the descriptor list holds the prototype methods and nothing else.

Two fixtures, because the Node-API mechanisms differ -- a static is a descriptor
carrying `napi_static`, an instance field is not:

    blockers/class-fields-do-not-cross
    blockers/class-statics-do-not-cross

Whether one change adds both is the compiler lane's question. The evidence is
separate, so the fixtures are.

### The controls are what make either mean anything

Every expression about an absent name is `undefined`, so `Holder.make ===
undefined` is equally satisfied by a class that never compiled. Both fixtures
control with `new Holder(7).get() === 7` -- the constructor ran, the prototype is
there, the field was populated. Only then does the absence mean absence.

That control also carries the diagnosis: **the fields are populated and
unreachable, not unset.** `Stats` classifies seven mode kinds correctly from a
`mode` that reads `undefined` from the host.

### Where it costs, counted rather than guessed

    Buffer.from         19 of buffer's 54 gainable files    a static method
    stats.size et al    24 of node's test-fs-*.js           instance fields

and a prediction written into the fields fixture as a prediction:
`process/src/main.ts:512` is `_fatalException = fatalException`, a class field,
and `_fatalException` is the name in **73 of process's 88** gainable files.
Today those 73 fail because `process` publishes no instance at all, so this gap
is the wall *behind* that one and the fixture says so rather than claiming them.

This wall is specific to the modules whose public surface is a class --
`buffer`, `stream`, `url`, `string_decoder`. `path`, `os` and the rest reach the
host as plain functions and values, which is why they are the modules on the
axis.

## `http` joins the axis, and the reason it was not on it

    http: 1 pass -- 0 behaviour, 1 shape-only, 0 hollow

    32 pass  ->  33 pass: 25 behaviour-dependent, 8 shape-only, 0 hollow,
                 12 of 22 modules

`http/shape.mjs` had `class HTTPParser extends RawHTTPParser` unguarded, and the
compiled `http` publishes two names, so the heritage clause was `undefined`.
`class X extends undefined` throws at **definition** time, so `internals()` threw
while being built and **every http test failed with one message before its first
line ran**.

`os/shape.mjs` records this exact lesson -- "a shape that throws on a missing
export reports one fact about the addon and hides seven" -- and every other
reach-through in `http/shape.mjs` is guarded. This one was in a class heritage
clause, where no amount of reading the calling code makes it visible.

**`hidden-exports.mjs` had been reporting it all afternoon** as
`NOT ASKED http: internals() calls into the module`, and I read that as a
limitation of the probe. It says `SHIM THROWS` now, quotes the message, and adds
that every test loading the module meets the same throw.

## The optional parameter published as required, counted

`prize.mjs` marks a gainable name `[optional-param]` when the module declares it
with an optional parameter and the wrapper publishes it as requiring all of
them. Across the twelve modules with a compiled pass:

    module      opt names   name-mentions   of all named
    fs                 29             249             38
    net                 1              96             11
    zlib                9              16             28
    stream              2              15             14
    readline            2              10              5
    util                6               8             12
    os                  2               2              2

    51 name(s), 396 name-mentions

**396 is not 396 files.** It counts how many compiled failure messages name one
of these, and a file that fails naming three of them is counted three times. The
distinct-file union is smaller and is not measured here -- the sweep prints only
the first eight rows per module, so the union cannot be recovered from its
output. Reporting the mention count as a file count is the sampling error this
ledger has already paid for once, at a factor of eight.

What the table does support: **`fs` has 29 of the 51**, and 38 names are named
in its gainable failures at all, so more than three quarters of the names
standing between `fs` and its 344 files take an optional parameter. And `net`'s
single `createServer` is named in 96 of its 149.

### Correction: it is a second gate, and it is live for one name

The paragraph above originally called this "the largest quantified lever in the
profile". **It is not, and the check that says so took two minutes.**

`prize.mjs` marks the name and says so in its own output -- "appearing is not
enough" -- and I read the marker as the blocker. Asking the build logs which of
the 51 are declined for the *first* reason:

    module      opt names   never compiled
    fs                 29               29
    zlib                9                9
    util                6                6
    os                  2                2
    readline            2                2
    stream              2                1
    net                 1                1

    50 of 51 are declined with `is exported and no function of that name was
    compiled`. One is past that gate.

`createServer`, `createHook` and `mkdirSync` -- three of the five biggest piles
-- are all `no function of that name was compiled`, and `stream`'s `Readable` is
`a class whose constructor was not compiled`. The wrapper never sees them.

So the marker is a **prediction about the gate after the current one**, which is
what its own output calls it. The largest lever in the profile is whatever is
refusing those function bodies, and this table does not name it.

What survives: when those bodies compile, 50 names arrive at a second gate that
is already filed as `blockers/optional-parameter-at-the-wrapper`, and `fs` will
meet it 29 times.

### Why this is a ceiling rather than a promise

A name being published with the right arity does not make its file pass. These
counts say where the *first* failure is, and behind it are the ordinary reasons
a test fails: a socket, a stream, a filesystem, a class whose statics do not
cross. The number to watch when this lands is the axis, not the name count --
the last compiler landing added published names in six modules and moved the
axis by nothing.

## What actually refuses the five biggest modules

The `most-named` column says which name a test failed on. It does not say what
refused that name's body. `last-mile.mjs` over the five modules with the largest
prize:

    module        own roots   top construct
    stream              467   33x  #pendingEnd: PromiseWithResolvers | undefined
    fs                  195   43x  #closeCapability: PromiseWithResolvers | undefined
    net                  45    7x  `this` outside a method
    buffer               35    7x  a method without a body
    async_hooks          20   10x  a member of AsyncLocalStorage, a class this
                                   compiler has no type for

    762 own roots, 214 distinct constructs

### One type accounts for 76 of them

    43  a property `#closeCapability` of unrepresentable type
        (a union of `PromiseWithResolvers` | undefined)      fs/src/promises.ts:584
    33  a property `#pendingEnd` of unrepresentable type
        (a union of `PromiseWithResolvers` | undefined)      stream

**Each is one declaration.** `#closeCapability` is declared once, on
`FileHandle`, and refused at 43 sites because 43 places touch it. The same type
in `stream` is refused at 33. So 76 root sites are two field declarations and
one representation question: `PromiseWithResolvers<T> | undefined` as a class
field.

Next after it, and the same family:

    27  a property `#source` of unrepresentable type (`AsyncIterable`)
    22  a `for await` loop
    21  `reject`, captured above its own declaration, where it has no value yet

`AsyncIterable` as a field plus `for await` is **49 sites** and one subject.
`reject`/`resolve` captured above their declaration is the `new Promise((resolve,
reject) => …)` executor, which `fs` alone writes at four sites in three files.

So the shape of the remaining work in the two biggest modules is: **promises as
data, and async iteration.** Not 762 problems, and not the 214 distinct
constructs either -- the head of the distribution is very short.

### The reading this replaces

The `[optional-param]` count said 51 names with `fs` holding 29, and reading it
as the blocker was wrong: 50 of the 51 never compile, so the wrapper never sees
them. This table is what is in front of those bodies, and it is a different
subject entirely.

Both numbers are real. The difference is which gate they describe, and only one
of them is the gate that is live.

## `string_decoder`, stated plainly on both lanes

The goal names this module and asks for the number without rounding.

**Interpreted: 5 of 5 applicable, 0 failed, 1 not applicable.**

    pass  test-string-decoder-end.js
    pass  test-string-decoder-fuzz.js
    pass  local/core-static.js
    pass  local/export-surface-static.js
    pass  local/split-sequences-static.js
    n/a   test-string-decoder.js   mixed language non-goal (§13) plus host-engine
                                   stress; calls the exported class as a function

`local/core-static.js` is held exactly as it was and passes. It is the file that
asserts `lastChar` is a `Buffer` and compares it with `.equals`, alongside
`lastNeed` and `lastTotal` -- 46 assertions, node's own bar, unmodified since
`d59d0631`.

**Compiled: 0.** The addon builds and loads and publishes no names.

    no wrapper for StringDecoder: is a class whose constructor was not compiled
    no wrapper for default: is exported and is not a function this backend can name

Not "nearly": zero. The module has **no refusals of its own** -- every one of its
59 roots is in something it imports -- and its chains end in `buffer`.

"a single construct, `buffer/src/main.ts:196`, down from three this morning" stood
here until 2026-09-10 and was wrong in both halves. It is two constructs, and the
three it was counting down from included one that was never on the path. The
re-derivation is the next section.

So the two lanes say different things and both are true: the implementation is
finished against node's suite, and the compiler cannot yet carry a class to the
host. That is the order this ledger's opening describes as the intended one.

## Every refusal in `string_decoder` and `buffer` converges on one function

Re-derived 2026-09-10 05:19 on a pin taken at 05:18 from `target/release/nts`,
whose provenance is a peer's working tree rather than a commit. `NTS_ADDON_OUT`
private, `NTS_BIN` the pin. Counts are that build's, for those two modules.

`string_decoder`'s build reports **58 NTS1001 roots and 27 NTS1003 cascades**, and
not one root is in `runtime/node/string_decoder`:

    20  buffer/src/main.ts
    14  internal/errors.ts
    14  buffer/src/blob.ts
     6  internal/uv.ts
     4  internal/validators.ts

The cascade is a single tree with one function at its root:

    objectToBuffer
      +- Buffer.from -+- Buffer.of
                      +- Buffer#fill - Buffer.alloc - StringDecoder#constructor
                      +- search - Buffer#indexOf / #lastIndexOf / #includes
                      +- transcode
                      +- bytesOf - StringDecoder#write - StringDecoder#end
                                 \- StringDecoder#text

Every one of the module's five compiled failures, and eight of `buffer`'s exports,
sit behind it. The two wrapper declines are downstream of the same tree: the class
is declined because `StringDecoder#constructor` calls `Buffer.alloc`.

**Two roots, not one, and not the three previously recorded.**

    buffer/src/main.ts:196:26  objectToBuffer  an erased value where a concrete
                                               representation is wanted
    buffer/src/main.ts:218:30  fromArrayLike   `i`, which `UnknownArrayLike`
                                               does not declare

Neither appears as the subject of an NTS1003 line, so both are roots. Both must
clear: `objectToBuffer` refuses on its own account at 196 *and* calls
`fromArrayLike`, which refuses at 218.

**The third was never on the path.** `buffer/src/main.ts:184`, an `in` naming
`length` on a natively represented value, is in `isTypedArrayView`. That name
occurs twice in the file -- its definition at 180 and one call at 484, inside
`Buffer.copyBytesFrom`. `objectToBuffer` calls `ArrayBuffer.isView`,
`hasArrayLikeShape` and `fromArrayLike`; `hasArrayLikeShape` is not refused at
all. So 184 costs `copyBytesFrom` and nothing here.

It had been read off line proximity in one region of the file rather than off the
call graph -- the same failure as ranking causes by grepping their messages. The
artifact being read was not the structure being reasoned about. `blockers/a-refused-branch-blocks-every-caller`
carried the same error in its prose and is corrected.

**What is behind the two, per MainClaude, who owns the compiler and has probed
218.** `UnknownArrayLike` is `{ readonly length: unknown; readonly [index: number]:
unknown }` -- a named member *and* a numeric index signature.
`representation_within` refuses that pair, the type falls through to an ordinary
one-field object layout, and `source[i]` then looks for a field called `i`. The
message names the member; the cause is the representation. On that reading 196 and
218 are one item: an erased value cannot become an `UnknownArrayLike` struct, and
the struct is the wrong shape for what it is. Recorded as their diagnosis, not as
a verified claim of mine.

**What this does not say.** Whether clearing both is *sufficient* for `Buffer.from`
is unknown -- only necessary. A cleared root can reveal another, and `buffer` has
gone 79 to 79 with five cleared and five revealed. The cone above is what is
visible behind those two on this pin, not a promise about what publishes.

## Three pins in one afternoon: roots barely moved, cascades fell a fifth

Twenty-two modules built from scratch on each of three pinned compilers, all
into private directories:

    pin      NTS1001   NTS1003   published names
    13:42     18,880     7,515              86
    15:18     18,880     7,515              98
    16:05     18,748     6,029              98

**The middle pin changed no refusal at all.** Not one root, not one cascade --
the two files are identical in both counts. What it did change is the published
surface, in six modules, and that came from wrapper work rather than lowering.
The axis moved by nothing across it.

**The third pin cleared 132 roots and 1,486 cascades.** Roots fell by 0.7% and
cascades by 20%, which is the shape to expect when the roots cleared are ones
many functions stand behind: `internal/errors.ts` went from 17 distinct sites to
14 and its line count across the 22 builds from 357 to 294, and everything that
called into `inspectValue` came with it.

### Which number to quote

Not the published names. They went 86 to 98 across the afternoon and the axis
went 25 behaviour-dependent to 25.

Not `NTS1001` alone either. It moved 0.7% on the pin that cleared the
`string_decoder` chain from three heads to one.

The cascade count is the one that tracked the work, and it tracked it because
the work was on roots with a lot behind them. That is not a general rule --
a root nothing calls clears one cascade -- which is why the useful form is the
pair, and why `last-mile.mjs` exists to say which roots have anything behind
them at all.

## Which modules are nearest, by the size of the cone they have to clear

Every refusal in a 22-module build, split into the module's own `src` and the
whole cone it compiles:

    module                own roots   cone
    punycode                      0      0
    path                          4     22
    async_hooks                  20     45
    diagnostics_channel          19     46
    timers                       25     50
    string_decoder                0     59
    buffer                       37     59
    querystring                   1     60
    os                            1     62
    url                          39    129
    console                      20   1221
    dgram                        13   1489
    events                       30   1116
    assert                       47   1200
    net                          45   1474
    readline                     71   1312
    util                         74   1174
    zlib                         97   1727
    process                      38   1917
    http                        149   1919
    fs                          207   2037
    stream                      469   1630

**`punycode` is zero and zero**, which is what a module that fully compiles
looks like, and it is the one module whole on both lanes.

**Nine modules have a cone under 65.** The gap after that is to 129 and then to
four figures -- there is no middle.

### The two columns say different things and both matter

`dgram` has **13** refusals of its own and a cone of **1,489**. Nothing is wrong
with `dgram`; it imports `net`, which imports `stream`. `console` is 20 and
1,221 for the same reason.

`stream` is the opposite: **469 of its own**, more than any other module, and a
cone smaller than `fs`'s. It is the thing others are waiting on rather than a
module waiting on others.

So the cone column ranks *how much has to happen*, and the own column ranks
*whose work it is*. A module low in both -- `path` at 4 and 22, `os` at 1 and 62,
`querystring` at 1 and 60 -- is near. A module low in own and high in cone is
somebody else's problem to clear first.

`diagnostics_channel` at 19 and 46 has not been discussed here before and sits
in that near group. `string_decoder` at 0 and 59 is the clearest case of the
pattern: nothing of its own left, and 59 things in front of it.

## Where the compiled axis ended: 29 behaviour-dependent across 15 of 22 modules

Isolated build on the 16:05 pin, three controls on every pass, quiet machine:

    module          pass   behaviour   shape-only   hollow
    path              13          12            1        0
    os                 5           3            2        0
    punycode           3           3            0        0
    async_hooks        2           1            1        0
    fs                 2           1            1        0
    util               2           2            0        0
    net                2           2            0        0
    querystring        1           1            0        0
    readline           1           1            0        0
    stream             1           1            0        0
    buffer             2           1            1        0
    timers             1           1            0        0
    http               1           0            1        0
    process            1           0            1        0
    zlib               1           0            1        0

    38 pass: 29 behaviour-dependent, 9 shape-only, 0 hollow, 15 of 22 modules

Where it started this morning, on the same instrument once it existed:

    26 pass: 17 behaviour-dependent, 4 shape-only, 5 hollow, 7 modules

### Seven of the eight new modules came from this side, not the compiler

`net`, `stream`, `async_hooks`, `readline`, `fs`, `util`, `querystring`,
`timers` and `buffer` each had **zero** compiled passes, or none that
demonstrated anything computed, and working published behaviour that nothing was
asking about. Every upstream test for them needs a socket, a stream, a
filesystem, an async context node creates, or a class that does not cross yet.

`http` and `process` needed a shim fixed before anything could be asked at all.

**Four shims discarded working exports.** `stream` threw away
`getDefaultHighWaterMark`, `process` threw away `env`, `querystring` threw away
`escape`, and `http` threw at definition time on `class X extends undefined` so
every one of its tests failed with one message. All four are the same shape,
which `os/shape.mjs` had already written down: the guard against reaching
through an absent export is right, and its scope was wrong -- none of them
distinguished "cannot build the public object" from "cannot build any of it".

`hidden-exports.mjs` was written for the first of them and found the other three,
one of them on a name that had landed an hour earlier.

### And the compiler moved three times without moving this number

    13:42 pin   25 behaviour-dependent, 11 modules   (with the tests of the time)
    15:18 pin   25 behaviour-dependent, 11 modules
    16:05 pin   25 behaviour-dependent, 13 modules

Published names went 86 to 98 across those three, and `NTS1003` fell by a fifth
on the last one. The behaviour count did not move. Every module added to the
axis today was added by finding what an artifact already did and asking it.

## Two stand-ins compensating for each other, and neither doing what node does

`net`'s attempt-timeout default reads **250** on the compiled lane and **2500**
on the interpreted one. Node reads 2500 to any file that requires `../common`.
None of the three numbers is a fact about the module.

    third_party/node/test/common/index.js:182
      net.setDefaultAutoSelectFamilyAttemptTimeout(
        platformTimeout(net.getDefaultAutoSelectFamilyAttemptTimeout() * 10));

Node's harness **calls the setter**, so the module's state is scaled before any
test body runs.

    tooling/conformance/common.mjs:260
      defaultAutoSelectFamilyAttemptTimeout: 2500,

Ours exposes the number node would have computed, as a constant, and never
touches the module.

    runtime/node/net/bindings.node.mjs:26
      globalThis.nts_net_default_auto_select_family_attempt_timeout = () =>
        net.getDefaultAutoSelectFamilyAttemptTimeout() * 10;

And the binding stand-in multiplies by ten to compensate -- documented there,
and correct given the line above it. The compiled lane has no equivalent
compensation, because its binding is C: `net.c:16` returns `250.0`.

So the interpreted lane is right by a second wrong, and the compiled lane is
wrong plainly.

### How it was found, which is the part worth keeping

A test of mine asserted the value was 250 and **passed compiled, failed
interpreted**. That is the `INVERTED` direction `prize.mjs` had no column for
until this afternoon, and the column was added because of it.

The first reading was that the compiled lane was wrong and the setter was
missing. The setter published two pins later and the test still failed, which is
what sent me to `common.mjs` rather than to the module.

**Neither reading was about the module.** The test now asks the module something
the module owns -- set a value, read it back, check the floor, put it back --
and passes on both lanes.

### The gap is real and is not fixed here

Making `common.mjs` call the setter and dropping the compensating multiply has
to be one change, since either alone moves the interpreted lane to 250 or to
25,000. It touches every module's harness for the benefit of one module's
default, and the tests it would change are the `autoSelectFamily` ones, none of
which pass on either lane yet.

Recorded rather than done, with the two line numbers, so the next person to read
a timeout out of this harness knows which of the three numbers they are holding.

## Every compiled error reaches the host with no `code`

    node   name "RangeError"          code "ERR_OUT_OF_RANGE"   instanceof RangeError
    ours   name "ERR_OUT_OF_RANGE"    code undefined

Sharper, measured on the 17:12 build: **each side has exactly one own key, and
they are different keys with swapped contents.**

    node   Object.keys(e)  ["code"]    code "ERR_OUT_OF_RANGE"   name "RangeError"
    ours   Object.keys(e)  ["name"]    code undefined            name "ERR_OUT_OF_RANGE"

    node   e instanceof RangeError  true
    ours                            false

So it is not that the code is missing and something else is fine. The one own
property that crosses is the wrong one, carrying the right string under the
wrong name, and the prototype identity that would make `instanceof` answer is
gone with the accessor that produced it.

`internal/errors.ts:405` is faithful to node:

    export class ERR_OUT_OF_RANGE extends NodeRangeError {
      override get ["constructor"](): unknown { return RangeError; }
      override readonly code = "ERR_OUT_OF_RANGE";

`code` is a **class field** and the `constructor` override is an **accessor**.
Neither crosses the wrapper, so the code is lost and the class name leaks into
`name`. Both halves of the divergence are one gap:
`blockers/class-fields-do-not-cross`.

### The number, and which gate it is

**792 of node's `parallel` tests assert `code: 'ERR_...'`.** For the modules
here:

    fs      91      stream  49      http    41      buffer  33
    net     27      zlib    19      process 19      dgram   15

That is the wall **behind** the current one for nearly all of them -- an `fs`
test asserting a code fails long before the code, on a function that does not
publish. Saying so explicitly, because the last time this ledger counted a
marker across a suite it read the second gate as the live one and had to be
corrected within the hour.

What the number does support: when the bodies compile, this is what they meet,
and it is one gap rather than 792.

### How it was found, and what nearly hid it

Comparing `getTimerDuration` against node's, twelve cases, with the probe
printing `e.code ?? e.name` on both sides. **Zero differed.** The `??` was doing
the hiding: ours has no `code`, so it fell through to `name`, which happens to
be the code string -- and node's has a `code`, so it printed that. Two different
properties, printed identically, reported as agreement.

It surfaced only when the assertion was written the way a test writes it,
`assert.throws(fn, { code: "ERR_OUT_OF_RANGE" })`, and failed on an artifact the
probe had just called identical.

**A fallback in a comparison is a place where two different things can print the
same.** `e.code ?? e.name` is the same shape as `plain - degenerate` and as
`reachable through any of four paths`: a reduction that loses the distinction it
was built to find.

## `zlib`'s tables differenced against node: one difference, and it is the library

Every key of `constants` and `codes`, compared against node's:

    codes        18 ours, 18 node    nothing missing, nothing extra, nothing differing
    constants   171 ours, 170 node   nothing missing, one differing, one extra

**`ZLIB_VERNUM`: ours 4896, node 4897.** `zlib/src/constants.ts:49` is
`nts_zlib_vernum()` and `zlib/zlib.c:116` returns the linked library's
`ZLIB_VERNUM`. Node bundles its own -- `process.versions.zlib` is
`1.3.2.1-motley-42c2f19`, reporting `0x1321` -- and this profile links the
system's `1.3.0`, reporting `0x1320`. The number is correct on both sides and
about different libraries. **A test asserting a literal `ZLIB_VERNUM` would be
asserting which zlib the host has.**

The extra key was mine, not the module's: the differential read `constants` off
the **raw addon**, where it carries `codes` because `constants.ts` exports both
and the addon publishes the module. `shape.mjs` builds the public `constants`
from an explicit name list that does not include `codes`, and defines `codes`
beside it -- which is node's shape, and which `test-zlib-const.js` asserts by
reading `zlib.codes.Z_OK` and passing.

Third time today that reading the raw `.node` gave a different answer than the
module: `stream`'s discarded `getDefaultHighWaterMark`, `os`'s unfrozen
`signals`, and this. The first was a real defect and the other two were the
layer. **The rule that separates them is which question is being asked** -- "does
the addon compute it" wants the raw artifact, "does a test see it" wants the
module.

## Every value this profile publishes agrees with node

`surface-diff.mjs` walks each module's **shaped** surface against node's, one
level into plain-object tables, comparing values rather than names.

    16 module(s) compared, 1 value differing, 402 absent

The one:

    zlib  constants.ZLIB_VERNUM: ours 4896, node 4897

which is the linked library. Node bundles `1.3.2.1-motley-42c2f19` reporting
`0x1321`; this profile links the system `1.3.0` reporting `0x1320`. Both numbers
are right and they are about different libraries.

**Nothing else disagrees.** Not one constant, not one table entry, not one
scalar, across `os`, `fs`, `buffer`, `zlib`, `http`, `net`, `path`, `process`,
`util`, `stream`, `timers`, `readline`, `querystring` and `async_hooks`.

### Two levels, because one was not enough to check what it claimed

The first version walked one level, so a table inside a table was checked for
**presence and never compared** -- and `os.constants` is four of them:

    constants.signals    ours  33, node  33    0 differing
    constants.errno      ours  79, node  79    0 differing
    constants.priority   ours   6, node   6    0 differing
    constants.dlopen     ours   5, node   5    0 differing

    123 entries, 0 differing

That is most of what `os` publishes, and at one level the instrument reported
`os: 0 differing` without having looked at any of it. The answer did not change
-- but "0 differing" and "0 differing, having compared 123 entries" are
different claims and only the second was earned.

Two is where it stops. `util.inspect.styles` is the deepest plain table in the
surface, and a third level starts walking cyclic namespaces:
`path.posix.win32.posix` closes in two hops.

### The 402 absent are a different question and already counted

A name node has and this profile does not publish is the publish gap --
`prize.mjs` counts it per file, `hidden-exports.mjs` counts what is published
and unreachable, and `blocking-files.mjs` says what refuses. This instrument
deliberately reports absence as a number and nothing more.

Separating the two is the point. **"What is missing" has been measured all day
and is large; "what is wrong" had not been measured at all and is one, and that
one is the host's zlib.**

### Through the shim, and that is not a detail

The same walk against the raw `.node` reports a second difference:
`zlib.constants` carries a `codes` key there, because `constants.ts` exports
both and the addon publishes the module. `shape.mjs` builds the public
`constants` from an explicit list and puts `codes` beside it, which is node's
shape and which `test-zlib-const.js` asserts by reading `zlib.codes.Z_OK`.

Reading the artifact would have reported a defect the module does not have. It
did, for about ten minutes, and this instrument reads the module for that
reason. The rule: **"does the addon compute it" wants the raw `.node`; "does a
test see node's value" wants the module.**

## Error messages differenced: the declaration decides whose message you get

Five error messages compared against node's, on the compiled addons:

    getTimerDuration(-5)     same    The value of "delay" is out of range...
    getTimerDuration("3")    same    The "delay" argument must be of type number...
    getTimerDuration(NaN)    same    The value of "delay" is out of range...
    SlowBuffer(-1)           same    The value of "size" is out of range...
    SlowBuffer("4")          DIFFER  ours "expected a number argument"
                                     node "The \"size\" argument must be of type
                                           number. Received type string ('4')"

One difference, and the rule behind it is exact:

    getTimerDuration(msecs: unknown, name: string)   -> node's message
    SlowBuffer(length: number)                       -> the wrapper's

**A wrong-*type* argument is intercepted by the wrapper; a wrong-*value*
argument reaches the module.** `-1` is a number, so it crosses and
`allocUnsafeSlow`'s own validation answers -- with node's text. `"4"` is not,
so the wrapper answers first, and `expected a number argument` appears once in
the emitted `addon.c` and nowhere in `runtime/node`.

`getTimerDuration` is declared `unknown` and every one of its cases reaches the
module, which is why all three of its rows match.

### The source is not at fault, and that was checked

Node's `SlowBuffer` calls `validateNumber(size, 'size', 0, kMaxLength)`
explicitly; ours does not, and delegates to `Buffer.allocUnsafeSlow`. That looked
like a missing validation until it was measured: in node,
`allocUnsafeSlow` produces **byte-identical errors to `SlowBuffer` for all five
cases**, so node's explicit call is redundant with the one behind it and the
omission is equivalent.

### What it is evidence for

`blockers/unknown-at-the-boundary` records the trade: a parameter declared
`unknown` carries its tag across and lets the module's own validator run, and
"23 exported functions in the profile validate a parameter at run time with a
check their own declaration deletes."

This is that, measured end to end on two live functions in two modules, with the
message text as the witness. Every such function will report the wrapper's
sentence instead of node's until either the declaration widens or the wrapper
learns node's text -- and node's tests assert these strings.

## A conformance fix that regressed three of node's tests

Instance fields cross now, so `fs.Stats` hands its fourteen columns to the host
as own enumerable properties. Asserting that turned up a divergence and then a
worse one.

The test first asserted the key list was **exactly** the fourteen. It passed
compiled and failed interpreted -- `prize.mjs`'s `INVERTED` direction, right
answer for the wrong reason:

    node          14 own keys, growing as its Date getters are first read
    interpreted   18, because `stats.ts` assigns the four Dates in the constructor
    compiled      14, because a `Date` is a reference and cannot cross outward

### The fix, and why it was wrong

`stats.ts`'s own class comment says the Dates are "derived from the number
rather than stored, which is what node does too", and the constructor stores
them. Making them plain getters matches both the comment and node's key list
before any read.

**It broke three of node's tests.** `test-fs-stat-date.mjs` calls

    function validateEnumerability(stats) {
      const keys = Object.keys(stats);
      assert.ok(keys.includes('atime'));
      assert.ok(keys.includes('mtime'));
    }

*after* reading those dates, and node's getter is

    get atime() { return setOwnProperty(this, 'atime', dateFromMs(this.atimeMs)); }

which **materialises the own property on first read**. So node's key list starts
at fourteen and grows, a getter that never materialises never gets there, and
the eager assignment is the closer approximation of what node's suite observes.

Reverted. `fs` interpreted went 346 to 343 and back to 346.

### What decided it

Counting what node's suite observes, before choosing:

    3 files read `Object.keys` of a stat
    7 files read a stat date's value
    0 files compare stat dates by identity

The identity difference is the one this profile cannot close without a
descriptor write in runtime source, and it is the one nothing asserts. The key
list is asserted, and the eager version satisfies it.

**The change would have shipped as a conformance fix.** It matched node's
documented shape, matched the file's own comment, and removed an eager
allocation. Running node's suite after making it is the only thing that said
otherwise.

## The interpreted lane, every module: 1,862 passing and nothing failing

`tooling/conformance/interpreted-lane.sh`, all twenty-two modules -- node's own
tests against the TypeScript running on node:

    22 modules, 2,326 files
    1,862 passed    0 failed    29 skipped    435 not applicable

    http     405 of 451      fs       346 of 395      stream   250 of 269
    net      150 of 181      async_hooks 117 of 155   process   89 of 153

1,859 until 2026-09-10. The three added are the identity contracts: `assert`,
`console` and `timers` each gained a `test/surface-identity-static.js`, and each
fails against the code it replaced.

**A trap worth naming, because a fresh loop walked into it.** Re-derived here with
an ad-hoc `for` loop over every `runtime/node/*/` holding a `test/`, which is 23
directories: `internal` has one, holding a single C file, and node's
`test-internal-*.js` then run against a module that does not exist and report 29
failures. `interpreted-lane.sh` takes an explicit module list for exactly this
reason and says so at its line 18. The lane is 0 failed; the loop was 29.

**Not one module has a failing file.** The implementation passes every
applicable test it runs, and has no outstanding defect this suite can see.

### The evening this section was corrected to 1,857, wrongly

Worth keeping because the mistake is more instructive than the number.

A re-run reported 1,857 and 2 --
`url/test-url-parse-invalid-input.js` failing with "anonymous was called 0
times, expected 1", and `http/test-http-debug.js` failing its stderr match --
over an identical corpus, with every other column the same. It read as a
regression, so:

- three runs on an idle machine failed identically, which ruled out the
  flakiness a spawning test invites and **confirmed the wrong conclusion**;
- a bisect into a worktree pinned at `9feebf97~1` failed there too, and at
  `74a0620e`, the commit that restored the url test on 09-06;
- the conclusion drawn was that the test had never passed;
- and this section was rewritten to 1,857/2 with a paragraph recording the
  original figure as unexplained.

**The cause was `NODE_NO_WARNINGS=1`, exported by the runner's own invocation
to keep the punycode deprecation line out of the log.** Node's tests assert on
deprecation warnings:

    test-url-parse-invalid-input.js   assert.match(stderr, /\[DEP0170\] DeprecationWarning:/)
    test-http-debug.js                the NODE_DEBUG warning in a child's stderr

Unset, both pass, and the lane is 1,859 and 0 again -- re-measured end to end,
every module, every column matching.

Every step of the diagnosis was sound and every step carried the contaminant in
with it. The worktree was pinned; the variable was not in the worktree. **A
control present in both arms is not a control**, and the bisect was a
comparison of two contaminated runs.

`run.mjs` now refuses to start when `NODE_NO_WARNINGS`, `NODE_OPTIONS`,
`NODE_DEBUG`, `NO_COLOR` or `FORCE_COLOR` is set, with `NTS_ALLOW_OUTPUT_ENV=1`
to override. It refuses rather than warns because a warning in a 2,300-line log
is what gets missed, and the whole failure was something invisible in the output
it changed. Filter the log after the run, where the filtering is in the command
and can be read.

### Which makes the 435 the number to argue with

That is where the judgement lives, and it is the only place left for one. Every
entry names a reason; by kind:

    113  language non-goal (typescript.md §13), in three spellings
     34  cross-module integration
     14  unavailable provider
     13  active-environment gap
      7  implementation-detail test
      7  hollow oracle
      6  runtime blocker

Sampled rather than trusted. The `active-environment gap` thirteen all need
`process.send` IPC or cluster handle transfer. The six `runtime blocker` entries
are CLI-flag plumbing (`--no-warnings`, `--insecure-http-parser`,
`--use-env-proxy`, `--max-http-header-size`), `getBuiltinModule` needing a
registry, and `util.aborted`'s fifth case -- which names two specific
infrastructure gaps, weak listener registration through the canonical
`EventTarget` and promise-state inspection needing a runtime helper.

None of them is a defect waiting to be fixed. All of them are infrastructure or
a stated non-goal.

### A divergence measured and deliberately not asserted: export descriptors

**Diagnosis, not a fixture.** Node's own tests never check the property
descriptors on a module's exports, because on node they cannot fail: `os.EOL` is
non-writable by construction and no regression test was ever needed for it. That
makes it exactly the shape of "the assertion the oracle had no reason to write",
and it was worth measuring.

Read from the raw addon exports against node's own:

    os.EOL                 ours wec   node -ec
    os.devNull             ours wec   node -ec
    os.constants           ours wec   node -e-
    buffer.INSPECT_MAX_BYTES  ours wec   node -ec
    buffer.constants       ours wec   node -e-
    zlib.constants         ours wec   node -e-
    zlib.codes             ours wec   node -e-

The wrapper publishes with `napi_set_named_property`, which makes an ordinary
writable, enumerable, configurable property. `os/shape.mjs` and `zlib/shape.mjs`
restore node's shape with `Object.defineProperty`, so **through the shim os and
zlib are 0 and buffer is 2**.

**What it would cost to assert, and why it is not asserted.** The assertion
fails in *both* lanes, because the interpreted lane runs the TypeScript directly
and `export const EOL = …` is writable. Closing it there means
`Object.defineProperty` in module source, and no module source uses it -- this
profile's rules put "descriptor tricks" on the same list as `any` and
`Reflect`, and TypeScript-on-node has to stay at 100%.

So a test was written, run in both lanes, seen to fail in both, and **deleted**.
The divergence is real and the means to close it are ones this profile has
declined. It is recorded here instead.

**What it would catch if it were asserted:** `buffer.INSPECT_MAX_BYTES = 0`
succeeds here, does nothing on node in sloppy mode, and throws on node in strict
mode. A test that reads the value cannot tell those apart.

Two things it establishes in passing, both checked and both clean: every
published function's `.name` equals the key it is published under, across seven
modules; and export identity is stable within a handle -- `os.hostname ===
os.hostname` -- with the differences across two `dlopen` calls being what
`dlopen` does rather than a defect, since node's `require` caches and
`process.dlopen` deliberately does not.

### The counted lane, every building module, with its uncounted control

The goal's completion criteria name this and say `counted-lane.sh` does not
produce it: a counted row means nothing without the uncounted one beside it,
because a module reporting `0 passed, 12 failed` under reference counting looks
like a reference-counting defect until the control shows the same figures.

`counted-vs-uncounted.sh` builds each module twice and prints both. All 22:

    22 module rows, **0 differing between the columns**
    36,395 retain/release sites across the counted builds

    assert       26  0 passed, 12 failed  [1887 rc]    26  0 passed, 12 failed
    async_hooks 155  2 passed, 115 failed [403 rc]    155  2 passed, 115 failed
    buffer       98  2 passed, 54 failed  [822 rc]     98  2 passed, 54 failed
    zlib         74  1 passed, 67 failed  [2561 rc]    74  1 passed, 67 failed

**An identical pair is a result, not a blank.** Thirty-six thousand retain and
release sites are live in these builds and not one of them changes an answer
node's tests can reach. That is what the pairing exists to say, and the counted
column alone cannot say it.

### os's priority test: the failure moved rather than closed

The boundary-message fix (`fe58e916`) closed the wording, and `os` stayed at 5
passed and 4 failed. **A refusal delta is not a measure of a fix**, so here is
what replaced it: `test-os-process-priority.js` went from

    Expected values to be strictly deep-equal   (the message)

to

    Missing expected exception

Traced through every input the test uses -- `null`, `true`, `false`, `'foo'`,
`{}`, `[]`, `/x/` for the type check and `NaN`, `Infinity`, `-Infinity`, `3.14`,
`2**32` for the range -- exactly two disagree:

    getPriority(null)    ours returns, node throws ERR_INVALID_ARG_TYPE
    getPriority(false)   the same

`getPriority(pid?: number)` takes its parameter optionally, and an optional
parameter whose conversion fails is not checked -- the same defect as
`an-optional-parameter-that-did-not-convert`, showing here as a **missing
exception** rather than as a garbage value. One fixture covers both faces.

So os is still four failures from whole and now three of the four are behind two
filed roots, with the fourth behind that fixture.

**And then `parseInt` landed, and os stayed at 5 and 4 again.** What replaced it,
since a refusal delta is not a measure of a fix: `getCIDR` compiles --
`internal/net.ts` has no refusals at all now -- and `networkInterfaces` compiles
with it. The wrapper declines it instead:

    was   networkInterfaces cannot be compiled because it calls `getCIDR`
    now   no wrapper for networkInterfaces: returns Record<string, unknown[]>

A lowering refusal became a boundary decline. That is progress and it is not a
passing test, and the two are worth telling apart: the function exists in the
compiled artifact now and cannot be handed to the host.

`userInfo` is unchanged, still behind `userInfoString` and `Buffer.from`.

### os is four failures from whole, and every one is behind something named

The goal is counted in whole modules and `os` is nearest: **5 passed, 4 failed**
of 9 applicable. Each failure traced:

    networkInterfaces   -> getCIDR (internal/net.ts) -> `Number.parseInt`
                           filed: the-number-parsing-builtins
    userInfo            -> userInfoString -> Buffer.from -> objectToBuffer
                           -> `in` on a bare `object`
                           filed: in-on-an-undeclared-object
    export-surface      the same two exports, absent
    process-priority    the boundary's message replacing the module's
                           filed: a-boundary-message-replacing-the-modules

Two roots and one boundary defect. **Nothing in os is waiting on a reduction
that has not been written**, and two of the three are shared: `Number.parseInt`
is 14 sites across 6 modules, and the `in` root is also the whole of
`string_decoder`.

The last one is the scalar case of a substitution already fixed for rest
elements. The wrapper's argument check rejects before the module's validator
runs:

    compiled   expected a number argument     code ERR_INVALID_ARG_TYPE, TypeError
    node       The "value" argument must be of type number.

The code and the name are right, so it is neither the missing-code defect nor a
lost error type -- only the wording, because `napi_get_value_double` fails and
the module's `typeof` check is never reached.

**And it could not be written as an agreement case.** Reading the message means
catching the throw, an exception does not cross a call frame, so the `try` never
catches and the case reports the exception defect instead. It is a `calls`
fixture, which catches in JavaScript outside the addon. A defect that blocks the
instrument you would use to measure another defect is worth recording as such.

### The standing figures, re-derived 2026-09-09 late

The goal text this lane works from carries numbers and says they are historical
the moment they are read. Re-derived against a pin taken at 21:35 and the
`addons-v26` build:

    stated                              re-derived
    ---------------------------------   ------------------------------------------
    1 of 22 whole -- punycode           holds: punycode, 3 files, 3 passed, 0 failed
    20 of 22 build and load             **22 of 22**, 0 crashed
    fs and process do not build         both build and load
    os is 17 of 23                      **21 of 23**
    querystring is 0 of 7               **2 of 7**
    string_decoder: 0 own refusals,     holds: five lines name its own source and
      two wrapper declines                all five are NTS1003 cascades; the two
                                          declines are `default` and `StringDecoder`
    ~125 of 309 bindings have no C      **3 of 352** -- see the section above
    dgram 21 of 21 missing              **0 of 21 missing**
    net 28 of 30 missing                **0 of 30**
    fs 60 of 133 missing                **0 of 155**
    no wrapper builds a typed array     **two do** -- `buffer` and `querystring`,
      -- zero across 24 addons            outbound only; inbound is still zero,
                                          `napi_get_typedarray_info` appears nowhere
    66 signatures behind that gap       **no decline names a typed array at all**

**The typed-array gap is not visible as a decline any more.** Across 251 saved
emit logs there are **18 distinct decline reasons** and not one names a view, a
typed array, a `Uint8Array` or a byte:

    2036  is exported and no function of that name was compiled
     753  is exported and is not a function this backend can name
     690  is a namespace member that is neither a wrapped function nor a value
     315  is a class whose constructor was not compiled
     118  takes an object
      31  returns an object

Said carefully, because it is a negative: **no export is declined for a typed
array**, and two wrappers build one outbound. Whether signatures are still
blocked by that boundary in some other form is not something this measurement
can answer -- it can only say the reason has stopped being given.

A first attempt counted declines whose *name* contained "Buffer" and found
eight, none of which had a typed-array reason: `Buffer` itself declined as a
value, four namespace members declined for being namespace members, and
`fileURLToPathBuffer` declined as never compiled. **Matching the name of the
thing rather than the reason for the decline is the same error as ranking a
census by message**, one level down.

**What has not moved is the coarse number.** 1 of 22 whole at the start of the
day and 1 of 22 now.

**What string_decoder is waiting on has changed even though its description has
not.** Zero own-source refusals and two declines are still exactly right, and
the cascades behind them now run:

    StringDecoder#constructor -> Buffer.alloc -> Buffer#fill -> Uint8Array#fill
    StringDecoder#write/#text -> bytesOf -> Buffer.from -> objectToBuffer
                              -> `in` on a bare `object`

Both heads are filed -- `in-on-an-undeclared-object` and the missing
`Uint8Array#fill`. So "two wrapper declines left" is a true description of a
module whose distance is two compiler defects rather than two wrapper arms.

### The native half, re-derived: 349 of 352, and the gap is three internal bindings

`native-half.mjs` compiles every `.c` under `runtime/node` and `runtime/c` with
`build.sh`'s include flags and runs `nm --defined-only` over the objects. A
binding is a `declare function` in TypeScript whose implementation is a C symbol
of the same name, and the only thing that knows whether that symbol exists is
the linker.

    352 declared, 3 with no C anywhere, across 18 modules

    fs 155/155   process 55/55   net 30/30   dgram 21/21   zlib 20/20
    os 18/18     timers 8/8      buffer 3/3  path 2/2      stream 2/2
    internal 19/22   <- the entire gap

The three are `nts_next_tick`, `nts_promise_hook_install` and
`nts_promise_hook_uninstall`.

**So "compiling is necessary and not sufficient" no longer picks a module.**
`dgram` will link. `net` will link. `fs` will link. Every module that fails to
reach the axis fails on the lowering alone, and the native half is not a reason
to prefer one over another.

**Two errors in this instrument before it said that**, and both are in its
header because they are the kind that recur.

It walked `runtime/node` alone and reported `nts_checkpoint` as having no C. It
has C, in `runtime/c` -- a binding may be implemented by either tree.

And it filtered the module list on having a `tsconfig.json`, which is the
correct filter for every other instrument here and is wrong for this one:
`runtime/node/internal` has no tsconfig, and `internal` is where all three
missing bindings live. **The first run reported 0 missing and the native half
complete.** It was caught by a memory recording 328 of 331 with those exact
three names -- two measurements of one quantity, and the disagreement was the
finding.

*(Three C files under `test/` do not compile for want of an include path, and
the run names them: every symbol they would define reads as missing. None of the
three is among them.)*

### Two numbers that both describe the compiled axis, and what each counts

**38 pass** is test *files* that pass, across 15 of 22 modules. It is what
`axis-controls.mjs` reports and what this ledger has quoted all day, and it is
the number that moves when one export starts working.

**1 of 22 is whole** -- every applicable test in the module passing, nothing
failing. Re-derived 2026-09-09 against the `addons-v26` build: **punycode**, 3
files, 3 passed, 0 failed. Nothing else is close:

    punycode         3 files    3 passed,   0 failed
    os              13 files    5 passed,   4 failed
    path            23 files   13 passed,   7 failed
    querystring      9 files    1 passed,   7 failed
    string_decoder   6 files    0 passed,   5 failed
    assert          26 files    0 passed,  12 failed
    http           451 files    1 passed, 405 failed

The two are not in tension and neither is the headline on its own. A module
reaching 38 from 37 has one more test answering; a module reaching whole has no
test left that it cannot answer. **The goal is counted in whole modules**, and
this ledger's 38 is the finer-grained view of the same lane.

Worth stating because the coarse number is the one that has not moved. It read
1 of 22 at the start of the day and it reads 1 of 22 now, while the fine number
went from 26 to 38 and the published names from 87 to 98.

*(Measured with a pin of `target/release/nts` taken at 21:35 -- see the note
above on what a pin does and does not establish.)*

### What that means for where the work is

The compiled axis is 29 behaviour-dependent across 15 modules. The interpreted
lane is 1,859 and complete. **The entire remaining distance between them is the
compiler**, and every module added to the axis today was added by finding
behaviour an artifact already had and asking it -- not by fixing an
implementation.

**Re-measured against artifacts this session built** -- 22 modules compiled with
one pinned compiler into a private directory, 22 loading under `RTLD_NOW`, none
crashing -- the figure is the same: 38 pass, 29 behaviour-dependent, 9
shape-only, **0 hollow**, 15 of 22 modules. That is the right answer for a
rebuild with no compiler change in between, and it is now attributable to a tree
this lane owns rather than to whatever the shared directory happened to hold.

**Measured again after the compiler lane closed the erased-coalesce root**, on
a pin taken after it, with all 22 modules rebuilt: 22 built, 22 loading, 0
crashed, and **97 published names against 87 before**. The axis: 38 pass, 29
behaviour-dependent, 9 shape-only, 0 hollow, 15 modules -- **identical module by
module**, not merely in total. `os` alone went from 17 published names to 21 and
its five passes did not become six.

**And measured a third time after four more compiler fixes** -- the empty object
type, the wrapper's `length`, the getter walk, and the literal's contextual
member. 22 built, 0 failed, **98 published names**. The axis: 38 pass, 29
behaviour-dependent, 9 shape-only, 0 hollow, 15 modules. Identical again, module
by module.

Four fixes, one published name, and no test that did not pass before passes now.
That is the fourth measurement of the same shape and it is not a criticism of
the fixes -- two of them closed defects this profile's own suite had found, and
one of those was a segfault. **It is a fact about what the axis measures.** A
test passes when a module publishes what it asks for and answers correctly; the
things fixed today were in front of *other* things, and the queue behind each is
what the ledger's ordered list is for.

Ten more published names and not one more test passing. That is the third time
this lane has measured that shape, and it is the reason the axis and the name
count are kept in separate columns: **a published name is a ceiling on what
could pass, not a count of what does.** The fix is real -- `parseFileMode`
compiles and the `validators.ts` chain moved -- and the tests those names would
satisfy sit behind the regular-expression engine.

**And the lever that added seven of the last eight modules is empty.**
`hidden-exports.mjs` against the same artifacts reports **0 node-own names
published and not delivered** -- six names reach no test at all
(`http.getHTTPParserPoolLimit`, four `readline` key constants, `util.styles`)
and not one of them is a name node has.

Six rather than seven because the instrument was asking the wrong question by a
hair: it traced **names**, and `fs.flagsOf` is delivered under node's own name
for it, as `internals()["internal/fs/utils"].stringToFlags`. A shim renaming a
value to node's name is the shim doing its job, and it was being counted as a
value nobody can reach. Values are traced by identity now, and the change was
controlled in both directions -- `fs.flagsOf` clears, and `util.styles` does
not, because `util/shape.mjs` guards its relocation on `util.inspect` being
present, the compiled addon does not publish `inspect`, and the `delete
util.styles` runs anyway. That value really is published and placed nowhere. So there is no more
behaviour sitting in an artifact waiting to be wired up: `fs` publishes three
names because three are all it compiles, not because the shim withholds the
rest.

That closes the cheap half of the work and says plainly what the expensive half
is. The four roots filed this afternoon -- `.then` on a promise, an iterator as
a declared return type, a getter returning `undefined`, a generic rest
forwarded to its callback -- are the form the remaining distance takes, and
each is a compiler change rather than a wiring one.

### Every root in the census's top 25 is filed, or recorded as unreduced

`refusal-census.mjs` ranks lowering roots by **distinct named things** rather
than by sites, because sites count uses: `stream/src/iter/push.ts` reports
`#pendingEnd` at three lines and `fs` has 104 sites behind four things. Across
22 modules with the post-coalesce compiler: 149 root messages, 872 things, 1,449
sites, and 1,438 further things that refuse only because something they call
was refused.

Eight roots were reduced and filed on 2026-09-09, each from a real site with
controls that say what the defect is *not*:

    an-erased-value-coalesced-with-a-default  `??` with an erased left operand
    then-on-a-promise                         `.then`, `.catch`, `.finally`
    a-function-returning-an-iterator          a declared iterator return type
    a-getter-returning-undefined              a getter, where a method compiles
    a-generic-rest-forwarded-to-its-callback  a rest parameter typed by a type parameter
    in-on-an-undeclared-object                `in` on a bare `object`
    method-syntax-in-an-interface             a method where a property compiles
    an-empty-object-literal                   `{}` with no members
    an-async-generator                        `async function*`

The first was closed by the compiler lane the same afternoon and is a guard now.

**Three of them found the same shape: a diagnostic that reads as a whole feature
being absent, where a specific spelling or surface is.** `await` compiles and
`.then` does not. A method compiles and the identical getter does not. An
interface member compiles as a property and refuses in method syntax. In each
case the representation exists and one spelling reaches it, which is a different
piece of work from building the representation and the message does not say so.

**And two of the top four unfiled roots were not causes.** `a module-scope
variable whose initializer was refused above` -- 27 things across 21 modules,
second by count -- carries an NTS1001 code and is what every module-scope
initializer says when what it initialises was refused. Reduced to
`const marker: object = {}`, which produces the real root at the literal and
that message at the variable, and produces only the first inside a function. The
census classifies on the wording now rather than the code.

`a declaration outside every walk`, 19 things across 16 modules, is probably the
same shape and is deliberately still counted as a root: five attempts to reduce
it failed, and a classifier should not encode a suspicion. The one root that
resisted reduction entirely is `a rest parameter that is not an array` -- 37
things, the largest unfiled -- and the five reductions that missed it are
written into the fixture that names its neighbour, so the next person does not
repeat them.

### A compiled program that runs and is wrong had nowhere to be written down

Every instrument in this directory measures a refusal, a publication or a test
result. None of them measures **a program that compiles, runs, and answers
something node does not** -- and on 2026-09-09 that gap cost a fix.

The compiler lane fixed `options = {}`, the empty object literal under 332 of
this profile's failing test files, measured it, and reverted it. With the fix
in, an object assigned into an erased slot came back as the wrong shape:
`Optional.limit` is optional so its field is erased and the absence is a tag,
the literal `{ limit: 19 }` has the checker type `{ limit: number }` whose field
is a plain `f64`, and `unerase` reads one as the other. A refusal had become a
wrong answer, on exactly the files the fix was worth.

**The four candidates each miss it for a different reason.** `blockers/` asserts
a refusal and this is not one. `differential-ts.mjs` runs the TypeScript on
node, so both sides are node. `differential-addon.mjs` needs a whole module and
its node counterpart. And an `examples/` case is written because it *agrees*
with node, so a disagreeing one is never written at all.

`agreement.mjs` compiles a fixture-sized program to an addon, calls each named
export, imports the same source on node, and compares. Its first case, on the
current compiler with that fix reverted:

    optionalThroughErasedSlot   compiled 4.26722180037931e+115, node 19
    requiredThroughErasedSlot   agrees      -- so it is the optionality
    optionalThroughNullable     agrees      -- so it is the erasure

Eight bytes of a tagged value read as a double. It needs no empty literal: the
defect is not new, it was unwritten.

**Every case takes nothing and answers a scalar, and that is a rule.** The
defect lives in how an object crosses an erased slot, so calling through the
boundary with an object would add a second erasure and a disagreement could then
be either one. The work happens inside the compiled program and a number comes
out.

A case that fails to compile is reported as "did not build" and counted apart
from agreement, because those are opposite findings and this profile has
confused them in both lanes.

**Varying one thing at a time around that point gave six disagreements from six
cases**, and widened the scope:

    optionalNumberPresent      compiled -891087778116.3125          node 19
    optionalNumberAbsent       compiled "not published"             node -2
    optionalStringPresent      compiled CRASHED, signal SIGSEGV     node 3
    twoOptionalPresent         compiled -2.2748072872723787e+265    node 7
    mixedOptionalAndRequired   compiled -2.490026109152083e+86      node 11
    mixedRequiredOnly          compiled 0                           node 7

The last row is the widening one. `interface Mixed { a?: number; b: number }`,
literal `{ b: 7 }`, reading the **required** `b`, answers 0. So it is not "an
optional field reads wrong" -- a struct containing any optional field is laid
out differently from the literal's struct, and every field read through an
erased slot is wrong, required ones included. A string field segfaults, which is
what a pointer-shaped field does when a tag is read as the pointer.

**Two sweeps found nothing, and that is worth as much.** Ten number and string
seams -- Grisu's shortest round-trip, int32 coercion, shift masking, unsigned
shift, remainder sign, UTF-16 length, surrogate halves, NaN, negative zero --
all agree. Seven layout seams -- a derived instance through its base, a field
after an upcast, **two required fields through the same erased slot**, a
narrowing outliving its branch, an array through a structural slot -- all agree.
So the defect is not general to erasure and not general to layout.

`agreement.mjs` calls one export per child, and earned it on its second use: the
first run of that case exited on a signal and lost all six answers when five had
something to say.

**Two further defects came from a sweep that was asking about something else.**
A case file of eight ordering and array-method questions -- does a statement
after an `await` run later, does `indexOf` find `NaN` -- reported DID NOT LINK,
and then, once that was resolved, took the process down.

`xs[xs.length] = v` **aborts**:

    const xs: number[] = [1];  xs[1] = 2;  xs.length
    nts: refused: index 1 is outside [0, 1)   SIGABRT
    node: 2

That is the append, and it is one of its two spellings -- `xs.push(v)` answers
correctly, and a write inside the bounds answers correctly. `xs[3] = 4` aborts
too, where node gives 4. Not a thrown error a program could catch and not a
compile-time refusal: `emit-c` is happy, clang is happy, the addon loads, and
the answer arrives as a signal. The check appears to read the length as the
capacity, and `xs[xs.length] = v` is not out of bounds in JavaScript.

And an async arrow with an expression body emits C that clang rejects --
`v2 = (NtsPromise *)v1` with `v1` a double. The identical `async function`
compiles, and so does the arrow declared and never awaited. Filed in `blockers/`
as `an-async-arrow-with-an-expression-body`.

Neither was on the list of things being looked for, which is the argument for
sweeps over targeted probes: **the sweep's own eight questions gave six
agreements and three refusals, and the two findings were things nobody asked.**

### A try/catch does not catch what a function it calls throws

    throw in the try's own body                caught, answers 5
    throw from a called arrow                  escapes
    throw from a called nested function        escapes
    throw from a called top-level function     escapes

Node answers 5 for all four. The compiled program answers 5 for the first and
lets the other three out of the addon entirely. The first row is the control
that makes it precise: **catching works, and the call is what breaks it.**

This is not an exotic construct. `internal/validators.ts` throws and every
caller catches; node's own tests are largely `assert.throws(() => …)`.

**It also weakens what a compiled pass means, and that is worth stating rather
than leaving implied.** The axis is counted in tests that pass, and a test
passes if nothing threw across a call inside it. "38 pass, 29
behaviour-dependent" is exactly what it says and is a narrower claim than it
reads as: those 29 demonstrate behaviour that did not involve an exception
crossing a call. The figure is not revised, because it is not wrong -- but it
does not cover error paths, and until now nothing said so.

Filed as `agreements/a-throw-across-a-call`.

**Seven further questions scope it exactly.** Correct, all within one frame: the
catch binds the thrown value, a rethrow from a catch reaches the outer catch, a
thrown number arrives as a number, `finally` runs after a caught exception.
Wrong, all crossing a call: `finally` running as an exception passes out of a
frame, an exception through two frames, a catch in the caller of the throwing
frame.

So it is not `try`, not `catch`, not `finally`, not the catch binding, not the
rethrow and not the thrown value's type. **Within one frame the machinery is
complete and right; it does not cross a call.**

One detail that may point at where: `finallyOnTheWayOut` escapes with an
**empty message** where the other two carry theirs. The exception that gets out
of a frame with a `finally` in it is not the one that went in, so something is
constructed or reset on the unwind path rather than simply not caught.

### The mechanism, and a decision that documented its own premise

The compiler lane read the emitted C. **The `try` is deleted:**

    double fromACall(double v0) { double v1; v1 = raiser(v0); return v1; }

No landing pad, no catch block. `grep -c landing` in the lowering is **0**, and
0 in the C backend.

**And the control above is not exception machinery either.** A lexically
enclosing throw is routed at compile time, so `try { throw } catch { return 5 }`
compiles to `return 5.0`. So the clean split this profile measured is not
"catching works and the call breaks it" -- it is that **two different things
look like one feature**, one of them compile-time routing and complete, the
other absent. The empty message on the way out of a `finally` is the same fact:
it leaves through `nts_uncaught` to the *boundary's* landing, a different frame
from the one that should have caught it.

`NtsLanding` already exists -- a stack with `previous`, `thrown` and `detail`,
walked by `nts_uncaught`, which pops the innermost and `longjmp`s. A `try` needs
`setjmp`, a push on entry, a jump to the catch on the non-zero return, and a pop
on the way out.

**The decision not to use it inside the lowering is written down in
`nts_runtime.h`, with its premise**, and the premise is what makes this worth a
section. It says a non-local jump does not run the releases reference counting
inserted between the throw and the frame, that this is bounded by the throw
being exceptional, and -- the clause that matters --

> it is why this is at the boundary rather than inside the lowering: an ordinary
> `try` never comes near it.

The reasoning is sound and the last clause is false of this corpus.
`internal/validators.ts` throws and every caller catches; a throw here is the
**validation** path, not an exceptional one. Correct when written, documented
with its own premise, and falsified by a measurement nobody could make until
`agreement.mjs` existed.

That is why the cost is not the plumbing, which is an afternoon. Under
reference counting every throw through a frame leaks what that frame held, on
ordinary input, and the gate's memory step would be right to fail it. The real
work is an unwind that runs the releases, or an error-return discipline that
never jumps -- a representation decision the size of the erased-slot one.

### An instrument that agreed on every case it did not decline

Before reading the C, the compiler lane wrote an example for this and their
harness reported **"agreed on every case"** -- over 16 of 145 cases, with **17
declined because the program aborted**. The declines were the finding.

That is the shape this whole directory is built against, arriving in the one
place it had not been looked for. `examples/` requires a case to agree with
node, so it cannot express a case that does not; `agreement.mjs` counts a
crash, a refusal and a wrong answer apart and prints all three. The argument for
the suite stopped being an argument at that point.

Found by a sweep of ten questions about statement forms -- labelled break,
labelled continue, argument evaluation order, the left side of an assignment
before the right, a do-while body running once, a for update after the body.
Nine agree exactly.

**That is four sweeps where the sweep's own questions came back clean and the
finding was something nobody asked**: the array append aborting, the async arrow
emitting invalid C, the optional-field struct, and this. It is the argument for
more sweeps rather than more targeted probes.

### The suite as it stands

Twenty-three case files. Against the compiler as of `78d69869`: **155 questions
compared, 12 disagreeing, 29 refused, 0 that did not build.** One hundred and
forty-three of one hundred and fifty-five answered exactly as node answers them.

The twelve are **four defects**, each reduced, each with controls saying what it
is not, and each with its mechanism read out of the source:

    exceptions do not cross a call frame        6 cases, two files
    a lone surrogate counts as three            3 cases
    an indexed write at or past the length      2 cases -- see below

**Two closed on 2026-09-10 and verified here rather than taken.** `in` on a
record lowers to `nts_map_has` (`eee7f428`) and integer-like keys are promoted
(`f9daeab5`); both case files agree 5 of 5 and 3 of 3 against a pin taken after
them. The suite went 12 disagreeing to 11.

`lower_in` was built around the closed world -- a compiled program gains no
classes, so which types can declare a key is answerable at compile time, which
is why a class instance was always right. A `Record` declares no members, the
set came out empty, and the fold turned the expression into a constant. The
compiler lane's rule from it is worth keeping: **when a pass answers by
enumerating a set, check the case where the set is legitimately empty** -- and
the absent case agreeing is what let it live, because half the questions anyone
would ask returned the right answer and the other half returned the same
constant.

**The array entry was corrected twice and the second correction is the one to
read.** This section said the ordinary append `xs[xs.length] = v` had been
fixed, leaving only the sparse write. **It is not fixed on HEAD.**

The pin was a copy of `target/release/nts`, built by whichever session last ran
a build **from its own working tree**, and it carried the compiler lane's
in-progress array work -- unlanded, because their own memory floor was
rejecting it.

Verified rather than taken: the same program answers `nts: refused: index 1 is
outside [0, 1)` on a pin taken at 21:00 and `2` on one taken at 21:35, and the
only two commits in that window are about `super.fill` reaching the runtime and
a literal's contextual member. Neither touches array growth, so the difference
came from something not in the history.

**A pin gives stability, not provenance.** Copying the binary stops it changing
under a measurement; it does not make the measurement about a commit. This lane
may not run `cargo`, so the honest form is to name the pin and when it was
taken.

The compiler lane made the mirror of this mistake the same evening and caught it
themselves, and it is recorded here with attribution because the rule is the
useful part. `nts-bench` reported a case at 626 µs before a change and 265 µs
after -- a 2.3x win from replacing one unsigned comparison with three double
ones, which cannot produce one. Compiled with one driver and one set of flags,
both `program.c` files:

    before   302.50 us/op
    after    286.35 us/op     same answer from both

Five percent, not 230. Their rule: **when a measurement disagrees with the
mechanism, check the measurement first** -- and the tell was visible before the
driver was written.

That is the same shape as this lane's `NODE_NO_WARNINGS` afternoon from the
other direction. There, a result with no mechanism behind it was believed
because it reproduced three times; here, a result with a mechanism that
contradicted it was nearly sent. **Reproducibility is not a mechanism and a
mechanism is not a measurement**, and a number needs both to be worth passing
on.

The sparse half remains what it was: `nts_array_grow_slot` refuses a hole
deliberately, because a dense array cannot hold one, and what is open is only
whether an abort is the right way to refuse.

**Seventeen files are clean**, and they are what make the twelve mean something:

    numeric-formatting-seams       12   radix 16, 16 of a fraction, 2, 36, a
                                        negative, an integer-valued double, 1e20,
                                        1e21, 1e-7, Infinity, NaN, -0
    math-and-arithmetic-seams      11   round(-0.5), trunc, floor/ceil of a
                                        negative, sign(-0), min with NaN, abs of
                                        the largest safe integer, 1/0, 0/0,
                                        right-associative **, pow of a negative
    number-and-string-seams        10   Grisu, int32 coercion, shift masking,
                                        unsigned shift, remainder sign, UTF-16
                                        length, surrogate halves
    array-operation-seams          10   pop, shift, unshift, splice, slice as a
                                        copy, reverse in place and returning the
                                        receiver, indexOf, lastIndexOf, includes
    coercion-and-object-seams       9   typeof null, object identity, template
                                        stringification, a default parameter per
                                        call, a destructuring default
    spread-and-class-member-seams   8   a static method, a private field, a getter,
                                        a setter, a rest parameter, array spread,
                                        destructuring with a rest and a rename
    string-and-number-method-seams  8   padStart, repeat(0), split(""), indexOf(""),
                                        slice clamping, charAt past the end
    text-and-byte-seams             8   codePointAt on a pair, fromCharCode, a null
                                        character in a length, Uint8Array wrapping
    erasure-and-layout-seams        7   a derived instance through its base, two
                                        required fields through an erased slot
    ordering-and-statement-seams    7   labelled break and continue, argument order,
                                        assignment order, do-while, for update
    control-flow-and-method-seams   6   virtual dispatch, finally after a return, a
                                        return inside finally, closure capture
    callback-seams                  6   a callback reading and writing the enclosing
                                        scope, called twice, its return used
    collection-and-json-seams       6   for...of order, Array.isArray, Object.keys
                                        insertion order, sort, replace, join, concat
    async-and-array-seams           4   await ordering, indexOf and NaN
    object-and-prototype-seams      4   method shadowing, an inherited field
    optional-fields-through-erased-slots  6   closed by the compiler lane
    an-optional-field-across-an-erased-slot  3  the same

**The last four sweeps found one defect between them**, and the last three found
none. That is the result rather than the absence of one: the seams this
profile's own source runs on are covered and correct.

### Each remaining defect, with its mechanism read from the source

None of the four is a behaviour report any more.

**`in` on a record** lowers to a literal constant:

    nts_map_set(v1, v4, v5);      <- the key goes in
    v7 = false;                   <- and `in` answers this

Unconditional, with no use of the map after the set. It does not lower to a
lookup that misses; it does not lower to a lookup. And the same operator is
**correct on a class instance**, so it is one path rather than the operator.

**A lone surrogate** is a storage question, not a folding one:

    "\u4e2d".length      v1 = 1.0    one code unit, three UTF-8 bytes
    "\u{1F600}".length   v1 = 2.0    two code units, four bytes
    "\uD800".length      v1 = 3.0    <-

Folded at compile time and right for everything encodable, and **still 3.0**
through a `const s: string` binding -- so the folder and the runtime agree and
the string is stored three units long. A lone surrogate has no UTF-8 encoding;
the length is its storage form's byte count.

**Integer-like key order** is an omission, and its comment is the evidence.
`nts_map_keys_str` walks with `nts_map_next` from 0 and writes each key as it
comes, under a comment reading *"`Object.keys(table)`, as the array of keys in
insertion order."* The comment describes the function accurately. What it does
not say is that JavaScript's order is not insertion order. There is no note
weighing the promotion and setting it aside, so the rule appears never to have
been in view rather than considered and declined.

**The function is correct against the description above it, and the description
is the thing that is short.** That is a different failure from a wrong
implementation, and it is worth naming because so much of this compiler is
documented well enough that its premises can be checked -- which is how the
exception decision was found to have outlived its own.

**Exceptions** are read in the section above: the `try` is deleted, there is no
landing pad, and the in-frame case is compile-time routing rather than catching.

### The refusals the sweeps turned up, by reach

Twenty-eight cases across the suite are refused rather than wrong. Counted the
same way, in `runtime/node`:

    parseInt                 14 sites,  6 modules
    Array#fill                8 sites,  4 modules
    JSON.parse                4 sites,  4 modules
    JSON.stringify            3 sites,  3 modules
    toFixed                   3 sites,  1 module
    String#normalize          2 sites,  2 modules
    parseFloat                1 site,   1 module
    Object.assign             0 sites,  0 modules
    a class declared inside a function   0 sites, 0 modules

**The last two are worth as much as the first.** `Object.assign` and a nested
class declaration are refused, and nothing this profile compiles is written
either way -- so a fixture for them would guard a construct the corpus does not
contain, and the refusals are correct to have. Recorded where the sweeps met
them rather than filed, so the next person sees they have been measured and set
aside instead of measuring them again.

`parseInt` is the one to take: six modules is a wide enough spread to be in
front of something in most of them, and it is closed by writing it. Filed as
`the-number-parsing-builtins`.

Two constructs the sweeps found **working** are worth naming beside these,
because they are the ones a reader would assume are missing: `Array#splice` (15
sites, 6 modules) and `Array#sort` with and without a comparator (2 sites) both
agree with node exactly.

**`in` on a `Record` is always false**, and it is the most confined defect
measured:

    "a" in o   with o = { a: 1 }    compiled 0   node 1   <-
    "b" in o   with o = { a: 1 }    compiled 0   node 0
    Object.hasOwn(o, "a")           compiled 1   node 1
    o["a"]                          compiled 1   node 1
    Object.keys(o).length           compiled 1   node 1

The object is correct -- the key is stored, readable, found by `Object.hasOwn`
and returned by `Object.keys`. Only the operator disagrees.

**The mechanism, read from the emitted C:** it lowers to a literal constant.

    v1 = nts_map_new(v0);
    nts_map_set(v1, v4, v5);      <- the key goes in
    v7 = false;                   <- and `in` answers this
    if (v7) { goto b1; } else { goto b2; }

`v7 = false` is unconditional, with no use of the map after the set. It does not
lower to a lookup that misses; it does not lower to a lookup. Which is why the
absent case agrees -- the same `false`, right by accident.

**And the same operator refuses in a different type position.** `in` on a bare
`object` gives `an in naming X on an object, which a natively represented type
answers for`, filed as `in-on-an-undeclared-object` and the head of
`Buffer.from`. So one operator refuses in one position and silently answers
wrong in another, and **the wrong answer is the one that compiles**. It is the
shape every feature test takes: `"code" in error`, `"then" in value`,
`"length" in options`.

**A lone surrogate is counted in its encoding's bytes, not in code units:**

    "abc"        compiled 3   node 3
    "\u00e9"      compiled 1   node 1
    "\u4e2d"      compiled 1   node 1
    "\u{1F600}"   compiled 2   node 2     <- a surrogate *pair* is right
    "\uD800"      compiled 3   node 1     <-
    "a\uD800b"    compiled 5   node 3     <-

The controls make it precise rather than "strings are measured in bytes": one
unit and two bytes answers 1, one unit and three bytes answers 1, and an astral
character is two units and four bytes and answers 2. The length is in code units
until the string contains something that cannot be encoded, and then it is the
encoding's length.

`string_decoder` holds partial UTF-8 sequences across chunk boundaries, and a
partial sequence is what produces a lone surrogate -- `lastChar`, `lastNeed` and
`lastTotal` are about nothing else. It is one of the seven modules with nothing
on the axis.

Eleven files are clean, one of them wholly -- twelve numeric formatting
questions with no disagreement and no refusal: radix 16, radix 16 of a fraction,
radix 2, radix 36, a negative in a radix conversion, an integer-valued double
without a point, 1e20 in full, 1e21 crossing to exponent form, 1e-7 crossing the
other way, Infinity, NaN, and negative zero without its sign.

The rest: number and string seams 10, coercion and identity 9, spread and class
members 8, string and number methods 8, erasure and layout 7, ordering and
statements 7, control flow and dispatch 6, callbacks 6, collections and JSON 6,
async and arrays 4.

`callback-seams` and `spread-and-class-member-seams` still carry the most
weight. Calls work, closures work, return values come back, static *methods*
dispatch, private fields read, getters and setters run. So the exception defect
is the unwind path and not calls, and `a class used as a value` is static
*fields* and not class members generally.

### In seven of the nine, the diagnostic describes something other than the cause

Tracing all nine of the largest concentrations to a named construct produced one
result that was not on the list of things being looked for:

    the message                                        the cause
    ------------------------------------------------  -----------------------------------
    `duplexKey`, which `HighWaterMarkOptions`          the type declares both keys; the
    does not declare                                   condition is the key being in a variable

    is exported and is not a function this             it is a value and that is fine; one
    backend can name                                   field's initialiser was refused

    `createServer`, a declaration outside              a cascade -- the class it returns
    every walk                                         was refused, so the walk stopped

    returns an object                                  a class whose members are all methods,
                                                       so there is no scalar field to carry

    a module-scope variable whose initializer          a cascade, wearing an NTS1001 code
    was refused above

    `null` or `undefined` where what it stands         a getter, where the identical method
    in for is not a reference                          compiles; a reference refuses too

    a rest parameter of unrepresentable type /         one construct, two messages by context,
    that is not an array                               and a third case with no message at all

Two more were accurate: `decodeURIComponent, a builtin this compiler does not
provide`, and `takes an object`.

**Three of this directory's instruments rank by those strings**, and the ranking
they produce is not the ranking by what is in the way. `refusal-census.mjs` says
so in its own header now, and `next-pass.mjs` exists because it does.

The practical form: **read the enclosing construct, not the message, and reduce
before believing either.** Every one of the seven was placed by a control that
removed one element and watched the refusal move -- not by reading what the
compiler said about itself.

### The ordered list, by test files rather than by diagnostics

Each of the four largest concentrations traced to the constructor or the
declaration that makes it, with the fixture that names it:

    332 files   **Closed 2026-09-09, and the queue behind it is measured.**
                `options = {}` at net/src/main.ts:1778 no longer refuses: the
                compiler lane gives a literal the contextual *member's* type when
                the contextual type is a union, and that parameter is
                `ServerOptions | ((socket) => void)`.

                `net/src/main.ts:1778` now has 0 refusals, and
                `Server#constructor` cascades off **1794** instead --
                `EventEmitter#on`, which waits on
                `function addListener<T extends EventEmitter>(target: T, …): T`,
                the generic function that is not lowered and emits no
                diagnostic. Filed as `a-generic-rest-that-is-used`.

                That was predicted before the fix landed, by patching the literal
                to a populated one as a measurement and reading what appeared:
                0 diagnostics at 1794 before, `EventEmitter#on` after. The real
                fix produced exactly the same wall.

                `http.createServer` still needs `IncomingMessage` used as a
                value at `server.ts:252` as well, filed as `class-as-value`.
                -> http.createServer 241 of 405, net.createServer 91 of 148

     59 files   a computed member read whose key is held in a variable, where
                the interface declares that key: `options[duplexKey]` at
                stream/src/state.ts:64
                a-key-held-in-a-variable
                -> stream Readable 59 of 249, and Writable off the same function

     68 files   method syntax in an interface: `addEventListener` declared on
                `AbortSignalLike` at internal/abort.ts:23, the only root inside
                dgram's Socket constructor
                method-syntax-in-an-interface
                -> dgram.createSocket 68 of 77

     54 files   a function returning a class whose members are all methods: an
                object return carries scalar fields only, and such a class has
                none, so the function is declined rather than flattened
                object-return-carries-scalar-fields-only
                -> async_hooks.createHook 54 of 115

     41 files   a generic function whose rest parameter is read, not lowered and
                emitting no diagnostic at all
                a-generic-rest-that-is-used
                -> timers setTimeout 25, setImmediate 11, setInterval 5

     14 files   the `code` argument to napi_create_type_error, passed NULL
                a-thrown-code-at-the-boundary
                -> fs, where message, name and constructor already match

      6 files   `decodeURIComponent`, unimplemented
                missing-builtin
                -> querystring.parse

     16 files   a constructor taking an object parameter, which the wrapper
                cannot carry: `no wrapper for EventEmitter#constructor: takes an
                object`. Its constructor compiles; the boundary declines it.
                object-parameter-at-the-wrapper
                -> events publishes **nothing at all**, 16 of 32 failing files
                   stop at `EventEmitter is not a constructor`

     75 files   a class instance exported as a value, one of whose field
                initialisers was refused. The wrapper declines it with a
                sentence about what kind of thing it is.
                a-value-export-with-a-refused-field
                -> process publishes **nothing**, 75 of 90 failing files

`process` was recorded as unreduced for an hour and then reduced. Four controls
place it: a named export of an instance publishes, a default export publishes,
one holding an object field publishes, and one holding a field whose initialiser
was refused is declined. `class Process` has `readonly env = env`, imported from
`./env.ts`, and that import's module-scope initialiser is refused. Neither the
export form nor being an instance nor holding an object decides it.

**Half of it is the boundary, not the lowering.** Four of the eight entries are
the wrapper declining something it cannot carry rather than the lowering
refusing to compile something:

    an object parameter          `EventEmitter#constructor: takes an object`
    an object return             `createHook: returns an object`
    the code argument            `napi_create_type_error(env, NULL, …)`
    a name it never saw          `is exported and no function of that name was compiled`

That is 54 + 16 + 14 + 41 test files against the lowering's 332 + 68 + 59, and
it is a different body of work from the representation questions the census
ranks. `blockers/` already held fixtures for three of the four. What was missing
was any measurement of what they cost, which is what `next-pass.mjs` was written
for.

**Every entry above is ordered by test files, and none of them would be near the
top of a ranking by diagnostics.** `an object literal that is not an object` is
13 distinct things across 16 modules and sits eighteenth by that measure; ranked
by test files it is first, by a factor of five. The rankings answer different
questions and this profile is counted in test files.

The caveat that belongs on all of them: a count is what stands in front of those
files, not what they would gain. `class Server` carries eleven roots and only
one is in its constructor.

### 332 test files behind two roots, and one of them is `options = {}`

The two largest concentrations in the tree are `http.createServer` at 241 of
http's 405 failing files and `net.createServer` at 91 of net's 148. Traced to
the constructors that make them:

    http/src/server.ts   class Server spans 126-930 and carries eleven roots.
                         Its constructor spans 179-274 and carries exactly one:
                         252  `IncomingMessage`, a class used as a value
                              this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;

                         Its super(...) goes to net's Server.

    net/src/main.ts      class Server's constructor spans 1771-1797 and carries
                         exactly one root:
                         1778  an object literal that is not an object
                               options = {};

`net.createServer` is behind that empty literal and nothing else in its own
constructor. `http.createServer` is behind the same literal through `super()`,
plus `IncomingMessage` used as a value.

**332 test files behind two roots, one of them a two-character literal** --
`options = {}`, a parameter reassigned to an empty object in a
`typeof options === "function"` branch. Filed as `an-empty-object-literal`,
where the census row that prompted it said 13 things.

The caveat holds and is worth restating because the number is large: **this is
what stands in front of those files, not what they would gain.** Only the
constructor chain is cleared by these two. `class Server` still carries
`Date.now` twice, a `for...of` over a `Set`, two methods with no declaration in
the hierarchy, a rest parameter and a regular expression literal, all outside
the constructor. `new Server()` needs the constructor; the tests need more than
`new Server()`.

The ordering is not in doubt even so. The next largest thing measured is the
generic rest parameter behind `timers.setTimeout` at 41 of 57, and after that
`decodeURIComponent` behind `querystring.parse` at six.

**And a census ranking by diagnostic breadth would have found none of this.**
`an object literal that is not an object` is 13 things across 16 modules and
sits eighteenth by that measure. Ranked by test files it is first. The two
questions are different and the goal counts the second.

### What stands in front of the next pass, module by module

`next-pass.mjs` runs node's suite against each compiled addon and groups the
failing files by the reason they stop at. The largest group per module, ordered
by it:

    http     405 failing, 241 at `http.createServer is not a function`
    net      148 failing,  91 at `net.createServer is not a function`
    process   90 failing,  75 at `underTest._fatalException is not a function`
    dgram     77 failing,  68 at `dgram.createSocket is not a function`
    stream   249 failing,  59
    async_hooks 115 failing, 54
    fs       344 failing,  40
    timers    57 failing,  25 at `setTimeout is not a function`
    buffer    54 failing,  19
    events    32 failing,  16
    diagnostics_channel 33 failing, 15
    url       50 failing,  14
    console   19 failing,  10
    readline  26 failing,   7
    zlib      67 failing,   5
    assert    12 failing,   4
    querystring 7 failing,  3   (7 of 7 name `parse`)
    util      23 failing,   3
    string_decoder 5 failing, 2
    os         4 failing,   1
    path       7 failing,   1
    punycode  no failing file

A count here is what stands in front of those files, not what they would gain:
a test failing at `createServer is not a function` fails there because that is
the first question it asks, and clearing it reveals the second. It sizes a
queue.

**The top four look like one problem at the wrapper and are three.** All of
`http.createServer`, `net.createServer` and `dgram.createSocket` produce `no
wrapper for X: is exported and no function of that name was compiled`, and
behind that identical sentence:

    http    NTS1001 `createServer`, a declaration outside every walk
    net     NTS1003 `createServer@main` cannot be compiled because it calls
            `Server@main#constructor`, which was refused above
    dgram   neither of those

Reduced and filed as `a-factory-of-a-refused-class`: an exported function
returning a class whose own body was refused is reported as *unwalked* rather
than as cascaded. Two controls -- a factory of a class with a refused field is
reported unwalked, a factory of a class that compiles compiles -- so it is the
returned class and nothing about factories. The whole output for the reduction
is the class's real refusal, the unwalked message, and the wrapper's decline;
clearing the first clears all three.

That message is counted as a **root** by `refusal-census.mjs` at 19 things
across 16 modules, and is left that way. One reduction shows the path exists and
does not show that all nineteen are it.

### The largest thing in front of the axis emits no diagnostic at all

Every census in this directory reads diagnostics. A refusal that emits none is
invisible to all of them, and the largest single obstacle on the compiled axis
is one:

    export function schedule<A extends unknown[]>(...args: A): number {
      return args.length;
    }

Not lowered. No NTS1001, no NTS1003, and `grep -c schedule program.c` is **0**.
The only trace anywhere is the wrapper's `no wrapper for schedule: is exported
and no function of that name was compiled` -- true, and silent about the cause.

Four controls, and the second is the condition:

    <A extends unknown[]>(...args: A): number { return args.length; }   silent
    <A extends unknown[]>(...args: A): number { return 1; }             compiles
    (...args: unknown[]): number { return args.length; }                declined, saying `takes unknown[]`
    <T>(value: T): number { return 1; }                                 compiles

**The rest parameter has to be read.** Declared and ignored the function
compiles; `args.length` loses it. And the third row is what makes the silence a
defect rather than a limitation: the same function without the generic is
declined too, and *names* what it cannot carry.

`timers` declares `setTimeout`, `setInterval` and `setImmediate` this way, and
none of the three is compiled. Against the compiled addon, of 57 failing test
files:

    25  setTimeout is not a function
    11  setImmediate is not a function
     5  setInterval is not a function

**41 of 57 behind one construct**, on a module already on the axis. The next
largest concentration anywhere is `querystring.parse` behind
`decodeURIComponent`, which is six.

Filed as `a-generic-rest-that-is-used`, with an absence for an expectation --
`lacks-c schedule` -- because there is no message to name. Its sibling
`a-generic-rest-forwarded-to-its-callback` is the same construct with a callback
attached and *does* produce a message, so whatever closes the construct closes
both and only one will show up as closed.

`refusal-census.mjs` counts the wrapper's declines by reason now, since that is
the only place this class is visible. Across `timers` and `querystring` alone,
35 declined exports, and the largest group is the silent one:

     15  is exported and no function of that name was compiled
      8  is exported and is not a function this backend can name
      6  takes an object
      4  is a namespace member that is neither a wrapped function nor a value

Every other reason names what could not be carried. The largest states the
effect and leaves the cause unsaid, which is why it went uncounted for as long
as it did.

### The seven modules with nothing on the axis are not seven pieces of work

Each traced to its head with `cascade-reach.mjs`, which ranks a primary refusal
by the size of its transitive cone rather than by how often its message
appears:

    module                primaries   head                        cone
    assert                    1,210   coerceToDOMString             39
    console                   1,229   coerceToDOMString             39
    dgram                     1,499   coerceToDOMString             39
    events                    1,124   coerceToDOMString             39
    url                         129   objectToBuffer                 9
    string_decoder               59   objectToBuffer                11
    diagnostics_channel          48   trackPromise                  11

**Four of the seven are one dependency.** `assert`, `console`, `dgram` and
`events` are each headed by `coerceToDOMString`, with `URLParser#parse` and an
`EventTarget` handler behind it -- the URL and EventTarget implementations,
which are web-platform, which this profile does not adopt. Their four-figure
refusal counts are not four modules' worth of compiler work; they are the same
wall counted four times.

**Two more share a head with each other**, `objectToBuffer` in `buffer`, filed
as `in-on-an-undeclared-object`. And `diagnostics_channel`, the nearest of all
at 48 primaries, is headed by two roots that were **already filed**:
`weak-collections-have-no-representation` and `weakref-property`. The second
unblocks three named exports -- `subscribe`, `tracingChannel`, `unsubscribe` --
in a module that publishes none.

So the seven decompose into: one dependency this profile declines, one filed
fixture covering two modules, and two filed fixtures covering the module
closest to the axis. Nothing on that list is waiting on a reduction that has not
been written.

### One instrument error, named

The survey walked every directory under `runtime/node` with a `test/` folder,
which picked up `internal` -- a shared source directory, not a module. It has a
`test/` holding one C file, and the runner matched node's `test-internal-*.js`
against a module that does not exist and reported **29 files, 0 passed, 29
failed**.

Excluded from the totals above. Reported because a row saying `0 passed, 29
failed` in a table whose every other row says `0 failed` is exactly the kind of
thing that gets quoted, and it is an artifact of the loop's directory test
rather than a fact about anything.

## An absence the control lane creates is not an absence in the build

`stale-exclusions.mjs` looks for `not-applicable` entries whose stated reason
has stopped being true -- "skipped because `constants` is absent" is correct
until `constants` publishes, and then it is a test skipped for a reason that no
longer holds.

Run against the current build it reported one:

    STALE  os/test-os-constants-signals.js
           reason cites constants as absent; the addon publishes it

**Measured before believing it.** With the entry removed, that test still passes
under `--sabotage`, `--empty-exports` and `--mutate-addon`. It is as hollow as it
ever was and the exclusion is still right. Put back.

The entry says why in its own words:

> hollow oracle; an absent `constants` value throws the same TypeError that the
> test expects from mutating frozen signals, **so it passes empty-module
> sabotage**

The absence is the one `--sabotage` and `--empty-exports` create on purpose. It
is true whatever the build publishes, and the tool was asking whether the build
publishes it -- the wrong question for that entry.

### The fix, and the false negative it accepts

Entries naming a control lane are skipped and **counted separately** rather than
dropped:

    7 conditional on a real absence, 0 stale
    6 naming an absence the control lane creates

The cost is a reason mentioning sabotage *and* a real absence, which would hide
behind the same words. That is why the six are reported rather than silently
excluded: a reader who sees the count can go and look.

Controlled after the change, since the logic moved: a synthetic entry reading
`skipped because \`hostname\` is absent` against `os`, which publishes
`hostname`, is still flagged `STALE`.

### Where the change is committed

In `fbcc60a8`, under the message "Eighty-three error classes each carried an own
key node does not have", which is not about it. Recorded here because the commit
message will not lead anyone to this reasoning.

**And the cause was not what this section first said it was.** It read "at the
same moment another session committed into the shared index", and that did not
happen -- the commit is mine end to end, and the peer checked and said so.

What happened: the Bash call that was to write a new message and commit was
**refused by the safety classifier, so none of it ran, including the heredoc**.
The retry passed the same path to `git commit -F`, and that path still held a
message written seven hours earlier for `abc07d47`. A duplicate message, one
commit late.

**When a command is refused, every file it was going to write still holds
whatever was there before**, and a retry that reads one of those paths is
reading the past. Left as it is rather than rewritten: a duplicate message is
cheaper than rewriting history three sessions have built on.

## Every function the addon publishes reports `length` 0

Arity compared against node's for every published name node also has:

    56 compared, 53 of ours report `length` 0

    26  ours 0 / node 0     agree, because node's is 0 too
    22  ours 0 / node 1
     4  ours 0 / node 2
     1  ours 0 / node 14
     3  a real length, and all three are shim-built

The three with a real length are `assert.Assert`, `http.get` and `http.request`
-- JavaScript wrappers a `shape.mjs` constructs. **Nothing the addon itself
publishes has a length.**

### The cause is one line, and it is not a bug in it

    napi_create_function(env, "hostname", NAPI_AUTO_LENGTH, nts_napi_hostname, …)

`NAPI_AUTO_LENGTH` there is the **name string's** length -- it tells N-API the
name is NUL-terminated. `napi_create_function` takes no arity at all, and a
function created through it has `length` 0 unless something defines the property
afterwards. So this is not a wrong argument; it is a property nothing sets.

### What it costs, stated as what is measured and what is not

`fn.length` is observable and node's own suite reads it. **How many of its tests
would be affected is not measured here** -- a grep for `.length` across
`test/parallel` matches string and array lengths in the hundreds, and separating
function arity from those needs more than a regular expression. The honest
figure is the one above: 22 published functions report 0 where node reports 1,
4 where node reports 2, and one where node reports 14.

### The first count was the top level only

Those figures are the **top-level** exports. Folding the same check into
`surface-diff.mjs`, which walks two levels, gives

    16 modules compared, 95 function(s) with the wrong arity

because `path.posix.*`, `path.win32.*` and `util.types.*` are all functions one
level in, and the ad-hoc script that produced the first number never looked at
them. 27 and 95 are the same finding at two depths, and the second is the one to
quote.

It is also the second thing today that is invisible to every name-counting
instrument here. `loads.sh` counts the name, `unusable-exports.mjs` calls it,
`surface-diff.mjs` compares its value -- and a function with the wrong `length`
passes all three.

## Which names are one object: 20,217 pairs differenced against node

A seam nothing else in this directory asks about. `surface-diff.mjs` asks whether
the value behind a name is node's; `hidden-exports.mjs` asks whether a name reaches
a test. Neither asks whether two names are backed by **one** object.

It came from `assert`. Node exposes eighteen names on two surfaces, shares `ok`,
`fail` and `ifError` between them, gives `deepEqual` and `equal` two
implementations each, and the shared `ok` is the callable `assert` itself -- one
function under three names. Ours gave the strict surface its own `ok`. Every test
passed: each assertion still did the right thing and only identity differed.

`identity-partition.mjs` generalises it. Own enumerable paths to depth 2,
restricted to values that have identity, every pair compared on both sides, and
only paths present on both -- absence is another instrument's column. Two findings,
both defects: node backs two names with one object and we with two, or the reverse.

**Result, 2026-09-10: 21 modules, 20,217 pairs, 0 divergences.** One module not
compared, printed rather than skipped: `string_decoder` publishes a single path
with identity, and a pair needs two.

It found six wrong names in two modules on its first run.

### `console`: the prototype is aliased and the surface is not

Node really does write

    Console.prototype.dirxml = Console.prototype.log;
    Console.prototype.groupCollapsed = Console.prototype.group;

and this module was written from those two lines. The constructor then walks
`ObjectKeys(Console.prototype)`, binds each method to the instance and redefines
`.name` to the key it was found under, so nothing a test can reach is shared:

                    node                      here, before
    dirxml          name="dirxml"             name="log", and === log
    groupCollapsed  name="groupCollapsed"     name="group", and === group
    profile         name="profile" len 0      name="noopLabel" len 1
    profileEnd      name="profileEnd" len 0   name="noopLabel" len 1
    timeStamp       name="timeStamp" len 0    name="noopLabel" len 1

Only the first half of node's construction was read. The fix needs no binding and
no redefinition: these are arrow class fields and so already per-instance, so each
name gets its own body over a shared private.

**The obvious repair breaks the wiring, so the wiring was measured first.** Writing
`dirxml(...a) { this.log(...a) }` would route through the *current* `log`, and
node's does not. Node's answers, which this now matches:

    dirxml through a replaced .log            0
    group through a replaced .log             1
    groupCollapsed through a replaced .group  0
    groupCollapsed through a replaced .log    1

so `#groupLine` calls `this.log` and `#logLine` does not. `dirxml` also publishes
to the `console.log` diagnostics channel and prints byte-identical output.

### `timers`: a fact about behaviour read as a fact about identity

`export { clearTimeout, clearTimeout as clearInterval }`, with the reasoning
recorded in the source: the HTML standard gives both a single id space, "so that
they are indistinguishable including by identity". The premise is right and node
honours it -- cross-clearing works both ways, and still does here. The conclusion
is not node's: `clearInterval !== clearTimeout`, and its name is its own. Node's
`clearInterval` is a separate function whose body calls `clearTimeout`, citing the
same paragraph.

### Both are controlled

Each fix has a `test/surface-identity-static.js` that fails against the code it
replaced and passes against the fix:

    console  reinstated  19 passed, 1 failed     fixed  20 passed, 0 failed
    timers   reinstated  58 passed, 1 failed     fixed  59 passed, 0 failed

### One correction the instrument earned

Its first run reported `events` and `util` as not compared, naming
`web-platform/src/core/{abort,encoding}.ts`. Those files are present, at
`runtime/web-platform/`; the preamble had been lifted from `run-one.mjs`, which
resolves them relative to the module directory, and rewritten against the repo
root. The instrument reported the failure correctly and the reason recorded for it
was wrong. Both compare clean, and they are 2,638 of the 20,217 pairs.

## The compiled axis re-derived on a 06:13 pin, and what actually blocks it

All 22 modules built from scratch on a pin taken at 06:13 from `target/release/nts`,
whose md5 differs from the 05:18 pin -- a peer rebuilt during the evening, so the
provenance is a working tree and not a commit. `NTS_ADDON_OUT` private throughout.

    22 of 22 build and load
    41 passes across 15 modules
    1 whole module: punycode, 3 of 3

Unmoved. Seven modules are at zero: `assert`, `console`, `dgram`,
`diagnostics_channel`, `events`, `string_decoder`, `url`.

    path  15/20   os 5/9   punycode 3/3   async_hooks 2   buffer 2   fs 2
    net 2   timers 2   util 2   http 1   process 1   querystring 1
    readline 1   stream 1   zlib 1

### Ranking it, and the two instruments that could not

`prize.mjs` per module gives **1,821 files to gain**. Its per-module output stops
at eight failures and prints `… N more`, and the elided total is **1,663 of
1,821** -- so any ranking taken from what it prints covers 8.7% of the population.
It is a sample, and the note in this directory about not extrapolating one is
exactly this case.

Re-derived from the lane itself with `--verbose`, every failing file and its first
reason: **1,824 rows**, three more than the axis's 1,821, which is unexplained and
recorded rather than reconciled away.

Of those, **1,444 name an absent export and 380 do not.** The 380 are behaviour
differences on names that did publish, and they are 21 of 22 modules.

### What the 1,444 are blocked by, by wrapper decline

     765  16 mod  is exported and no function of that name was compiled
     232  10 mod  is a class whose constructor was not compiled
     161   6 mod  is a namespace member that is neither a wrapped function nor a
                  value this backend can call
     101   9 mod  is exported and is not a function this backend can name
      93   8 mod  names an export that no wrapper decline mentions
      65   1 mod  returns an object          (async_hooks.createHook)
      22   1 mod  takes an object            (events.EventEmitter)
       1   1 mod  returns Record<string, unknown[]>   (os.networkInterfaces)
       1   1 mod  returns Map<f64, string[]>

The largest is not a wrapper gap at all: 765 files wait on a function that never
compiled, which is a lowering refusal wearing a wrapper message.

### The exports that cost the most, resolved through the cascade

     274  http: createServer
     124  fs: parseFileMode              via mkdirSync
      96  net: addListener               via createServer
      68  dgram: Socket@dgram_src_main#constructor   via createSocket
      30  diagnostics_channel: channel
      29  http: readGlobalAgentBinding
      12  fs: mkdtempSync
      12  http: request
      11  fs: WriteStream#constructor    via createWriteStream
      11  fs: ReadStream#constructor     via createReadStream

**A wrong ranking was printed first and is worth keeping.** The cascade walk fell
back to matching a callee by the text after `#` when no exact edge existed, which
made every `#constructor` the same node: `dgram.createSocket` and
`fs.createWriteStream` both resolved to `formatInvalidStatusCode`, an HTTP name in
`internal/errors.ts`, and it read as a plausible shared root. Exact edges only give
the table above. The give-away was a name from the wrong module, not the numbers.

### Attribution stops here, and the number that stops it

Resolving those 765 to the compiler construct behind them attributes **298** and
leaves **467 unattributed**. `a declaration outside every walk` is 297 of the 298,
across 4 modules, and is the largest single named construct on the axis.

The 467 are not a mystery about the code, they are a limit of the method: an
NTS1001 names a construct and a location, and only sometimes a function, so a
chain that ends in a function with no backticked name in any diagnostic cannot be
joined by text. Only **48 of 765** have no NTS1001 or NTS1003 mentioning them at
all.

### `a declaration outside every walk` is one message over at least three shapes

38 distinct sites carry it across the 22 builds, and grouping them by what the
source actually says gives three unlike things:

    object-literal method shorthand   fs/src/utf8-stream.ts writeSync, fsync,
                                      close, open, mkdir -- consecutive members of
                                      one object literal; and every web-platform
                                      `pull`, `cancel`, `consume`, which are
                                      underlyingSource methods
    an overload set                   fs.readFileSync, three signatures with the
                                      implementation last
    a plain exported function         http.createServer, http.request

So the largest named construct on the axis is a *text*, not a cause, which is the
trap this directory already records about ranking by message. The 297 files behind
it are almost entirely the third shape -- `createServer` 274 and `request` 12, or
286 of 297 -- and the object-literal sites, which are the most numerous in the
source, cost almost nothing on the axis.

**The location is the end of the preceding declaration, not the declaration named.**

    http/src/server.ts:930:2   ->  930 is the `}` closing `class Server`
                                   `createServer` begins at 932
    os/src/main.ts:395:2       ->  395 is the `}` closing the function above
                                   `userInfoString` begins at 397
    fs/src/main.ts:764:20      ->  764 is the end of the *second* overload
                                   signature of `readFileSync`

Every one of these reads, at its printed location, as a diagnostic about the
declaration before it. That is worth fixing independently of the walk itself: it
sent this analysis to the wrong construct twice before the line numbers were
checked against the source.

### The message was not merely coarse; it was false

MainClaude re-derived `createServer` from the walk itself rather than from the
text, and it is refused with a cause **in the same output**:

    server.ts:930:2   NTS1001 `createServer`, a declaration outside every walk
    server.ts:154:17  NTS1001 a value of type Managed(Set(Managed(Object(…))))
                              where Float { bits: 64 } is wanted

The second is the real one. The `unaccounted` check asks whether any diagnostic's
*span covers* a declaration; `createServer` is at 932 and its refusal is at 154,
seven hundred lines above and inside the class it constructs, so no span covered it
and the check concluded the function had vanished. A refusal's location is the
offending construct and routinely sits outside the declaration that owns it, so a
span test cannot answer that question and the walk can, because it is holding the
error.

So the 274 files stand and their cause is a `Set<Object>` where a `Float` is
wanted, not a walk that never happened. **The ranking above had a false message at
the top of it**, and "a text, not a cause" was an understatement: the text was
wrong, not just coarse. 31 sites still carry the message against the 38 counted
here.

`http.createServer` is the clearest single item: 274 files, more than any other,
and its body is one line.

    export function createServer(options?, listener?): Server {
      return new Server(options, listener);
    }

    http/src/server.ts:930:2  NTS1001 `createServer`, a declaration outside every walk

It was briefly recorded here as having *no* diagnostic, on a grep that looked only
for NTS1003 subjects. It has one, and it is an NTS1001. A census that searches for
one diagnostic shape is blind to the other, which is the same failure as ranking
causes by grepping their messages.

## A cleared refusal that bought nothing, and the blocker it uncovered

Re-derived on a 06:35 pin after `array-of-object-literals-has-no-layout` landed,
against the 06:13 pin of the section above. Both pins are working-tree builds.

**The axis did not move: 41 passes before, 41 after, every module identical, all 22
still building.** The fixture cleared and no test changed lane. Recorded that way
because a refusal delta is not a measure of a fix.

What did change is an exact exchange, identical in every module that pulls in
`buffer`:

    gone       blob.ts:756:6   NTS1003 `resolveObjectURL` … calls `Blob#constructor`
    appeared   blob.ts:756:16  NTS1001 an array of Managed(Object(TypeId(N))) where
                               an array of Erased is wanted

`Blob#constructor` compiles now; `resolveObjectURL` stopped cascading and began
refusing in place. Across the tree cascades fell and roots rose by the same shape
-- `fs` 734 to 726 cascades against 2,062 to 2,071 roots, `http` 884 to 879 against
1,938 to 1,943 -- with wrapper declines unchanged in all 22.

### The blocker it named: `stream`'s three constructors

    stream/src/readable.ts:292:32   an array of Managed(String) where an array of
    stream/src/writable.ts:274:32   Erased is wanted
    stream/src/duplex.ts:83:32

Line 292 is inside `Readable`'s constructor, which opens at 290. The call is
`this._initializeEventShape(readableEventShape)`, where the constant is a `string[]`
literal and the parameter is `readonly EventName[]` with `EventName = string |
symbol`. A union erases; a `string[]` does not; the two hold different widths.

**On the previous pin all three sites were silent.** No diagnostic at any of them,
and `Readable` was declined `is a class whose constructor was not compiled` with
nothing naming why -- the same decline, and the same single pass, on both pins. So
this is not a regression. It is the thing that was already blocking the module
finally saying so at a source line, which is what this ledger keeps recording about
obstacles that emit no diagnostic.

By the ranking above those constructors are **80 failing files for `stream.Readable`,
36 for `Writable`, 13 for `Transform`**.

### The source cannot route around it, and the attempt is the evidence

Annotating all three shape constants `readonly EventName[]` -- which is accurate,
they are event names -- moves the refusal and does not remove it:

    before   readable.ts:292:32  writable.ts:274:32  duplex.ts:83:32   7 sites in stream
    after    readable.ts:79:6    writable.ts:58:6    duplex.ts:53:6    7 sites in stream

Seven to seven, declines 65 to 65, and `no wrapper for Readable` byte-identical.
The literal is built at `Managed(String)` and then refused on assignment, so a
contextual annotation relocates the refusal to the initializer. Reverted.

Narrowing the parameter is not open either: `EventName` is `string | symbol`
because node's event names can be symbols, and `captureRejectionSymbol` is one.

What it needs is for a contextually-typed array literal to be **built at its
contextual element type**. Handed to MainClaude as a diagnosis with that sentence
and the 129 files behind it, to rank against `http.createServer`'s 274.

**A miscount inside this, kept.** The annotation was first read as making `stream`
worse, three sites to seven. It was seven to seven; the "three" was a subset counted
with a narrower grep than the one used for the "seven". Two numbers from two
instruments, compared as though they were one.

## Symbols: a blind spot in three instruments, and seven defects behind it

`identity-partition.mjs`, `name-arity-diff.mjs` and `descriptor-diff.mjs` all walk
with `Object.keys`, which returns own enumerable **string** keys and no symbols at
all. Every symbol-keyed property node publishes was invisible to all three, and
each of them reported a clean surface over a population that excluded them without
saying so. That is this directory's own recurring finding turned on its own tools.

`symbol-surface-diff.mjs` asks the question. Node leans on symbols where behaviour
is decided rather than where data is stored -- `Symbol.toStringTag` decides
`Object.prototype.toString`, `Symbol.asyncIterator` decides whether `for await`
works, `Symbol.for('nodejs.util.promisify.custom')` decides what `util.promisify`
returns -- so a module can compute every value correctly and still be the wrong
thing to a language construct.

A symbol is compared only where two realms can agree on it: a well-known symbol by
identity, and `Symbol.for(x)` through the global registry. A unique unregistered
symbol cannot be compared across two module graphs and is counted and printed
rather than reported as a difference.

### The third ESM-namespace leak, and the fourth

`fs.constants`, `fs.promises.constants` and `stream.promises` were module namespace
objects, reached with `import * as X` and re-published as public tables. A
namespace object is frozen, null-prototyped and tagged `"Module"` by
specification, so nothing on the TypeScript side changes it.

`util.types` was the first of these and was **44 of the 80 descriptor differences**
on its own. The pattern is worth naming because it recurs: *an `import * as`
namespace re-published as a public value*. The shim is the only place it can be
undone.

Node's two do not agree with each other, which is why they were measured
separately rather than fixed with one idiom:

    fs.constants     null prototype, extensible, no tag
    stream.promises  Object.prototype, extensible, no tag

### Two promisify links that produce wrong answers, not missing ones

    timers.setTimeout[custom]     === timers/promises.setTimeout
    timers.setImmediate[custom]   === timers/promises.setImmediate
    fs.exists[custom]             a promise of the boolean
    fs.promises.opendir[custom]   === fs.promises.opendir   (a self-link)

Without the timers links, `promisify` builds its generic wrapper and appends a
node-style callback, while `setTimeout(after, value)` takes the resolve value
first -- so the call **throws** `ERR_INVALID_ARG_TYPE: The "callback" argument must
be of type function. Received type number (5)`.

`fs.exists` is worse, because it is silent. Its callback is `(exists)` and not
`(err, exists)`, so the generic wrapper reads the boolean as an error: a path that
exists **rejects**, and one that does not resolves with `undefined`. Exactly
backwards. Both now answer node's:

    node  exists('/tmp')=true  exists('/nope')=false
    ours  exists('/tmp')=true  exists('/nope')=false

### `${os.arch}` is "x64" with no call written

Fourteen `os` functions carry a `Symbol.toPrimitive` answering what calling them
answers. The split is uniform, which is why the test states it as a rule and
asserts both halves: exactly those fourteen have it, and the six that do not --
`cpus`, `getPriority`, `loadavg`, `networkInterfaces`, `setPriority`, `userInfo` --
are precisely the ones that take an argument or return an object, where a
primitive conversion has nowhere to put either.

### Two module objects that were the wrong thing to `toString`

`console` and `process` each carry `Symbol.toStringTag`. Their descriptors
disagree on two of three fields -- console non-writable and configurable, process
writable and non-configurable -- so neither was inferred from the other.

### `duplex instanceof Writable`, which was false here and is true on node

The largest thing the symbol seam found. Node's `Duplex extends Readable`, not
`Writable`, so an ordinary prototype walk says no, and node adds a
`Symbol.hasInstance` to `Writable`:

    if (FunctionPrototypeSymbolHasInstance(this, instance)) return true;
    if (this !== Writable) return false;
    return instance && instance._writableState instanceof WritableState;

Behavioural, not cosmetic: any code asking whether a stream is writable before
writing to it got the wrong answer for every `Duplex` and every `Transform`.

**The obvious reading of that hook is wrong and it was measured before it was
copied.** It looks like duck-typing and is not -- a plain object carrying
`_writableState: {}` is not an instance on node, and neither is one with `write`,
`end` and `on`. The state has to be a real `WritableState`. Copying only the first
half would have made the case pass while turning `instanceof` into a shape test,
so the test asserts all nine outcomes:

    real Writable=true  Duplex=true  Transform=true  Readable=false
    _writableState:{}=false  write/end/on duck=false  {}=false  null=false  42=false

The predicate needs the class, which surfaced a second gap: node publishes
`Writable.WritableState` and `Readable.ReadableState` as statics --
`Object.keys(stream.Writable)` is `["WritableState", "fromWeb", "toWeb"]` -- and
ours had neither. They are kept off the module object, where node does not have
them either.

The surface instruments did not report that absence and were right not to: they
compare only paths present on both sides, because absence is `surface-diff.mjs`'s
column. It arrived through the symbol seam instead, by way of a hook that needed
the class.

### Left, with reasons -- and two that are absent for a reason

`Buffer[Symbol.species]` is an accessor returning node's internal `FastBuffer`
subclass, which is not a thing to reproduce.

`Symbol.hasInstance` on `console.Console` and `diagnostics_channel.Channel` is
missing here and is **not** a defect, which was established by measuring the
answers rather than by matching the surfaces:

    node console: instance=true  module console=true  {}=false
    ours console: instance=true  module console=true  {}=false
    node dc: unsubscribed=true  subscribed=true
    ours dc: unsubscribed=true  subscribed=true

Node needs both hooks because of how it builds those objects and we do not.
`Console[Symbol.hasInstance]` reads a `kIsConsole` brand, because node's global
console is a plain object with methods bound onto it rather than a `Console`
instance. `Channel[Symbol.hasInstance]` accepts `Channel.prototype` **or**
`ActiveChannel.prototype`, because node swaps a channel's prototype when it gains
a subscriber and `ActiveChannel` does not inherit from `Channel`. Ours are
ordinary instances in both cases, so the default answer is already node's.

Adding either would be installing a metaobject hook that reimplements the
behaviour it replaces. **A missing symbol is a defect only where an answer
differs**, which is the distinction `stream.Writable` failed and these two pass:
there, `duplex instanceof Writable` really was false.

### The lane

**1,870 passed, 0 failed across 22 modules**, from 1,859. The eleven added are
tests for defects these seams found, each controlled against the code it replaced.

One caveat that applies to every lane number in this tree, including this one:
`test-util-inspect-long-running.js` fails about one run in seven, and it passed on
the run that produced 1,869. Every number here is one sample.

## A private name is per class, and this corpus collides once

MainClaude found that the layout matched `#` names across a base and a derived
class and kept one slot. A `#` name is per class in JavaScript -- that is what the
`#` is for -- so `Base` and `Derived` may each declare `#count` and they are two
fields. Measured against node on eleven lines:

    class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
    class Derived extends Base
                  { #count = 100; bumpDerived() { return ++this.#count; } }

    node 2102     compiled 102502     28 of 28 cases disagree

`http.Server` hit it visibly: `net.Server` declares `#connections = 0`, `http.Server
extends NetServer` and declares `#connections = new Set<HTTPDuplex>()`, and an
`Int32` slot meeting a `Set` refuses. That refusal is the top of this ledger's own
ranked list, three layers down: `a declaration outside every walk` was a false
message, `a value of type Set<…> where Float is wanted` was the symptom, and the
private-name collision is the cause.

**The refusal is the lucky case.** Where the two fields have the same
representation there is no refusal and no divergence in any instrument here; the
program computes with one field where it should have two. So the question is not
what refuses but what else stands on this without saying so.

`private-name-shadowing.mjs` answers it:

    497 classes, 208 with a base, 158 resolved in-tree, 50 not resolved,
    619 (derived field, ancestor) pairs checked, 1 collision

The one is `#connections`. The 50 unresolved bases are `Error`, `Set`,
`Uint8Array`, `Iterator`, `TypeError` and their kin -- JavaScript builtins with no
declaration in this tree, which is the right answer for them.

### It answered zero twice before it answered one

Both wrong answers were the instrument, and each would have read as good news:

**Bare class names.** `http/src/server.ts` says `class Server extends NetServer`,
and `NetServer` is `import { Server as NetServer }`. A base is a *local* name, so
matching by the identifier finds nothing. `Server` is also declared in both `net`
and `http`, so a map keyed by bare class name holds one and drops the other.

**Entry files re-export rather than declare.** `fs/src/streams.ts` imports
`Readable` from `stream/src/main.ts`, which does not declare it -- it does
`import { Readable } from "./readable.ts"` and then `export { … Readable … }`,
an export list with **no** `from` clause. Following `export … from` alone changed
nothing at all: 154 resolved before and 154 after, which is what said the pattern
was wrong rather than the idea. With bare export lists handled, chains went 154 to
158 and pairs 527 to 619 -- the whole `stream`, `fs`, `http` and `zlib` hierarchy,
which is precisely where a deep chain could hide one.

A zero from either version was not evidence. The instrument prints what it
resolved and what it could not for that reason.

### Not renamed

`http.Server`'s `#connections` could be renamed -- the two really are different
fields and the shared name is an accident -- and it would clear the refusal today
without touching the compiler. It has not been, for two reasons. It is rewriting
correct source to route around a refusal, which this lane does not do; and the
sweep above says it is the corpus's **only** instance, so renaming it would remove
the single witness to a defect that is otherwise a silent wrong answer.
`blockers/a-private-name-is-per-class` carries the reduction and the design.

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
