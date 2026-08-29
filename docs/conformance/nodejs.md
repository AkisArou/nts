# Node API conformance

What is implemented, what node's own tests say about it, and what stops it
compiling.

Companion to [`typescript.md`](typescript.md), which tracks the language and the
runtime under it. This file is the `node:*` surface built on top.

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

## Modules

Counts are `passed / applicable`. Two kinds of file are outside that.

A test that spawns a real `node` child asserts on node's binary, which our
module is not in; there is no way to install ourselves into a process we did
not start. Each of those is listed with a reason in the module's
`not-applicable` file rather than inferred by a rule, so the number can be
audited.

A test that *skips* is one that asked for something we do not have — an
internal module, a helper, a platform feature — and said so. The runner prints
the reason for every skip, so they can be read rather than assumed. Neither is
counted as a pass or a failure, which is what `sweep.mjs` reports and what the
rows below are.

**661 of node's own 1,341 applicable test files pass** across nineteen modules,
of which 20 are hollow.

`http`'s row was 44 in the previous revision, taken at `8d024b2` before the
`unref` fix in `96b1553` and labelled as a floor because its suite had not
completed since. It has now: **89**, at `96b1553`. Fixing a no-op `unref`
doubled it, which is what the label was there to allow for -- and the reason
for labelling rather than guessing is that the guess would have been "somewhat
better", not "twice".

An earlier revision said 554 here, arrived at by adding each module's gain to
the previous total as it landed; it had drifted by five. The totals are summed
from the rows now. The rule this document already states about the per-module
numbers — a hand-copied number is a claim nobody can check — applies to the
headline as much as to the table.

> **The `compiles` column means something again.** For most of this document's
> life it did not. The frontend decomposed types under a fixed budget, and
> thirteen of sixteen modules exhausted it — after which the type graph is
> partial and the refusals name constructs that may be consequences of the
> truncation rather than causes. Worse, the numbers moved by *permutation*
> rather than by an offset: a bisect over two unrelated edits to one module
> gave 12, 21, 27 and 7 lowered functions from the four combinations, and none
> of the four was the answer.
>
> That is fixed. No module truncates now, and the numbers below are the first
> ones that were ever measurements — 946 functions across twenty modules.
> Four modules, `fs`, `net`, `stream` and `zlib`, carry two types each that the
> checker could not answer for, reported as `NTS0003`; two rather than
> thousands.
>
> **The ceiling has not gone away.** The budget is still 4,096 types and `zlib`
> was at 3,190 before `net` was written. What changed is that the mechanism
> which made truncation *arbitrary* is gone and that the condition now
> announces itself. So the absence of `NTS0002` below means the check ran and
> found nothing, not that this cannot come back — and a module that starts
> emitting it again invalidates its own row, not the whole table.
>
> The lesson worth keeping is not about budgets. A number that is quietly
> arbitrary and never contradicts itself is the hardest kind to catch: it took
> a decrease nobody expected, a bisect run because the *shape* looked wrong
> rather than because anything had failed, and someone checking a claim they
> were inclined to believe.

| module | node's tests | hollow | compiles | note |
| --- | :---: | :---: | :---: | --- |
| `console` | **22 / 22** | 2 | 49 / 264 | complete |
| `os` | **4 / 4** | 1 | 56 / 88 | complete |
| `punycode` | **1 / 1** | 0 | 7 / 9 | complete |
| `querystring` | **4 / 4** | 0 | 48 / 183 | complete |
| `timers` | 52 / 54 | 2 | 46 / 156 | complete but for `async_hooks` and the `domain` integration built on it |
| `path` | **15 / 16** | 0 | 40 / 122 | complete but for `matchesGlob`; the skip is Windows-only |
| `events` | **28 / 33** | 1 | 42 / 131 | complete but for domains, `EventTarget` and the promise forms |
| `process` | 43 / 63 | 2 | 77 / 219 | complete but for `process.binding`, `stdin` and workers |
| `url` | 26 / 36 | 1 | 75 / 367 | complete; exact on the Web Platform Tests corpus |
| `string_decoder` | **2 / 3** | 0 | 49 / 184 | complete; the failure is the class-vs-function difference |
| `buffer` | 33 / 60 | 1 | 47 / 172 | the read/write surface is complete and validated |
| `diagnostics_channel` | 23 / 45 | 0 | 39 / 123 | complete; the failures need node's own publishers |
| `assert` | 9 / 19 | 0 | 44 / 220 | complete, including `CallTracker` and node's Myers diff |
| `util` | 7 / 19 | 1 | 48 / 186 | `inspect`, `format`, `types`, the comparisons and the helpers |
| `fs` | 72 / 214 | 2 | 98 / 603 | sync, callback and promise surfaces, the file streams and the watchers |
| `zlib` | 30 / 64 | 0 | 58 / 532 | the streams, the one-shots, brotli and zstd |
| `http` | 89 / 350 | 5 | 70 / 585 | a complete HTTP/1.1 implementation, parser included; no HTTPS or HTTP/2 |
| `net` | 50 / 139 | 0 | 67 / 528 | `Socket` and `Server`; `BlockList` and auto-select-family absent |
| `stream` | 151 / 195 | 2 | 58 / 498 | the core is complete; `web`, `iter` and `consumers` are absent |

The first two columns are what

```sh
node tooling/conformance/sweep.mjs
```

prints — every module, both modes, about three minutes. They are copied here
rather than generated into the file, so the sweep is the check on this table
and not the other way round. It has already earned that: the `url` row read
`26 / 38` when it was written by hand and the applicable count is 36.

**`hollow` is how many of those passes survive the module being removed.**

```sh
node tooling/conformance/run.mjs --module buffer --sabotage
```

hands every test an empty object instead of our module. Whatever still passes
was never measuring us — it reached node's own implementation through a global,
or asserted something true of any module at all. Thirteen of the 170 are
hollow, and each is a specific reason rather than a rounding error: two files
whose whole content is `globalThis.console = globalThis.console`, one that
compares `globalThis.URL`'s property descriptor against itself, one that
asserts `os.constants.signals` is immutable and is satisfied by *anything*
that throws a `TypeError`, and so on.

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

15 of node's 17 `test-path*` files pass. `test-path-glob.js` fails on
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

28 of 33 applicable files pass. What is left:

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
`escape`, `unescape`, and the `decode`/`encode` aliases. 3 of 4 test files pass.

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

33 of 60 applicable files pass. Two are not applicable: they need
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
`lib/internal/console/global.js`. **All 22 of node's test files pass.**

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

23 of 45 applicable files pass. The remaining 22 are one cause: they assert
that *node's own* `http`, `net`, `udp`, `worker_threads`, `child_process` or
module loader publish to a well-known channel. Those subsystems publish into
node's registry, not ours, and no substitution can bridge that — the tests pass
when the subsystem is ours, and not before. They are left failing rather than
marked not-applicable, because they are applicable; they are just blocked. 22
more skip on `--expose-gc` or on node internals.

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
comparisons, `inherits`, `deprecate`, `debuglog`, `promisify`, `callbackify`,
`styleText`, `parseEnv`, `stripVTControlCharacters`, `toUSVString`, and the
`getSystemError*` family.

7 of 18 applicable files pass, which understates it: `util`'s tests compare
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
  What is left is line-breaking of deeply nested values, not content.

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

9 of 19 files pass. `assert`'s tests check the *message text* of every
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
`setInterval` and the WICG `scheduler`. 52 of 54 applicable files pass, 2 of
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

What is absent is `async_hooks`. Node emits an init/before/after/destroy
quartet around every timer and threads an async context frame through it, and
`domain` is built on that. The two remaining failures are both domain tests:
`process.domain` is not restored across a timer callback because nothing here
emits the events `domain` listens for. That is an absent module rather than an
incomplete one — the timer semantics are whole without it — and those two will
pass when `async_hooks` exists, not before.

Eight files skip. Three want `NodeEventTarget` to count listeners on a
non-`AbortSignal` event target, which is `events`' to provide; three want
`internal/test/binding`; two want child-process helpers.

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

43 of 63 applicable files pass, 2 of them hollow; 7 skip and 24 are not
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
operating system. 89 of 350 applicable files pass, 5 of them hollow.

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

Absent: HTTPS, HTTP/2, `http.OutgoingMessage`'s legacy `_headers` accessors,
and the informational-response paths beyond `100-continue`.

## `net`

`Socket` as a `Duplex`, `Server`, the address predicates, and a seam of one
handle per connection and per listener. 50 of 139 applicable files pass, none hollow.

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

Absent: `BlockList`, `SocketAddress`, the auto-select-family connection
strategy, and the IPC/child-process paths.

## `zlib`

Compression is a C library — zlib, brotli, zstd — and this module is everything
around it: the option validation, the flush semantics, the stream integration,
the error codes and the one-shot forms. The same division as `node:fs`, where
the system call is the kernel's. 30 of 64 applicable files pass, none hollow.

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
`createReadStream`/`createWriteStream`. 54 of 214 applicable files pass, up
from 11.

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
`lib/internal/streams/*` — and the one everything else is built on. 150 of 195
applicable files pass, 2 of them hollow; 49 skip.

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

Absent by decision, not oversight:

- **`stream/iter`**, which is 7,209 lines across twelve files -- as large as
  the whole of the rest of this module -- is gated behind
  `--experimental-stream-iter`, and accounts for 40 of the 49 skips. Writing it
  while `fs` sits at 11 of 212 would be the wrong allocation.
- **`stream/web`**, the WHATWG streams. A different API family that needs
  implementing before it can be adapted to; `Readable.toWeb` and `fromWeb` are
  four of the failures.
- **`stream/consumers`**, which is small and depends on `Blob`.

## `fs`

The synchronous surface, from node v24.20.0 `lib/fs.js`: `statSync`,
`lstatSync`, `fstatSync`, `existsSync`, `accessSync`, `readFileSync`,
`writeFileSync`, `appendFileSync`, `openSync`, `closeSync`, `readdirSync`,
`mkdirSync` (including `recursive`), `rmdirSync`, `rmSync`, `mkdtempSync`,
`unlinkSync`, `renameSync`, `copyFileSync`, `linkSync`, `symlinkSync`,
`readlinkSync`, `realpathSync`, `chmodSync`, `chownSync`, `truncateSync`,
`utimesSync`, plus `Stats`, `Dirent` and `constants`.

11 of 260 test files pass, and the shortfall is three absent subsystems rather
than a long tail of small bugs:

| cause | files |
| --- | ---: |
| the callback forms — `fs.open`, `fs.readFile`, `fs.stat`, … | ~40 |
| streams — `createReadStream`, `createWriteStream` | 26 |
| `fs.promises` | 16 |
| `fs.watch`, `fs.watchFile` | 15 |
| `Buffer` | 7 |

The callback and promise forms are not omitted because they are hard to write.
They need an event loop and a pool to run the work on, and a `readFile(path, cb)`
that calls `cb` before returning is not the function node documents. That is a
runtime decision — see *the runtime* in [`typescript.md`](typescript.md) — and
`node:fs` is downstream of it.

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

## What stops all of it compiling

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

## What stops `path` compiling

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
