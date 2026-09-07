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

**1,789 applicable test files pass** across twenty-two modules,
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
warns about elsewhere, so the two numbers belong next to each other: **1,789
measured, 420 excluded, 0 hollow.**

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

## The compiled artifact, which is the gate and is entirely red

**Latest measurement: still 0 of 22, and for the first time that number is one
feature from moving.** `punycode` lowers completely — 21 functions, nothing
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
Object types whose members are functions or optional lower their field type to
`void`. With clang's error limit at 20 per module, 228 is a floor and not a
count.

Three modules — `async_hooks`, `diagnostics_channel`, `timers` — have one clang
error each (two for `timers`), and it is the same one: a closure pointer passed
where `nts_enqueue_microtask(NtsTask task)` declares a three-field struct.

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

`punycode/test/error-identity-static.js` is the first. It was proved by mutation
rather than assumed: replacing `throw new RangeError(m)` with a plain `Error`
carrying `name = "RangeError"` leaves `test-punycode.js` **passing** and fails
the new file with *"decode(" ") threw RangeError that is not a RangeError"*.
Upstream cannot see the defect; this can.

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
module whose passes are all degenerate reports `all-passes-degenerate` rather
than a number — which is what `path` reports today, `2 / 17, 2 degenerate`.

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
