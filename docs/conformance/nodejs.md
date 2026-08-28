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

`check.sh` without `--ts` builds a Node-API addon and runs node's tests against
the compiled artifact. That is the gate. `--ts` is the interim gate for a module
that does not compile yet, and the two together tell a compiler bug from an
implementation bug: fails compiled, passes on node, is a compiler bug.

A third command, and the one to run before believing any of the numbers below:

```sh
node tooling/conformance/run.mjs --module <name> --sabotage
```

It hands every test an empty object instead of our module. Whatever still
passes was never measuring us. See *hollow* in the table.

## Modules

Counts are `passed / applicable`, where applicable excludes tests that spawn a
real `node` child — those assert on node's binary, which our module is not in.
Each exclusion is listed with a reason in the module's `not-applicable` file
rather than inferred by a rule, so the number can be audited.

**167 of node's own test files pass** across thirteen modules, of which 9 are hollow. The per-module
counts below are `passed / applicable`; `compiles` is `functions lowered /
constructs refused`, from `nts hir`.

| module | node's tests | hollow | compiles | note |
| --- | :---: | :---: | :---: | --- |
| `console` | **22 / 22** | 2 | 8 / 255 | complete |
| `punycode` | **1 / 1** | 0 | 5 / 10 | complete |
| `querystring` | **4 / 4** | 0 | 6 / 165 | complete |
| `os` | **4 / 4** | 1 | 19 / 91 | complete |
| `path` | **15 / 16** | 0 | 3 / 124 | complete but for `matchesGlob`; the skip is Windows-only |
| `events` | **28 / 33** | 1 | 2 / 126 | complete but for domains, `EventTarget` and the promise forms |
| `url` | 26 / 36 | 1 | 28 / 317 | complete; exact on the Web Platform Tests corpus |
| `diagnostics_channel` | 23 / 45 | 0 | 2 / 123 | complete; the failures need node's own publishers |
| `buffer` | 15 / 60 | 1 | 5 / 154 | the surface is there; the argument validation largely is not |
| `assert` | 9 / 19 | 0 | 3 / 209 | complete, including `CallTracker` and node's Myers diff |
| `fs` | 11 / 212 | 2 | 28 / 191 | the sync surface; async, streams and watchers are absent |
| `util` | 7 / 18 | 1 | 7 / 180 | `inspect`, `format`, `types`, the comparisons and the helpers |
| `string_decoder` | **2 / 3** | 0 | 3 / 170 | complete; the failure is the class-vs-function difference |
| `stream` | — | — | — | not started |
| `process` | — | — | — | not started |
| `timers` | — | — | — | not started |

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

15 of 60 applicable files pass. Two are not applicable: they need
`--allow-natives-syntax` to drive V8's optimiser, which is a question about V8
rather than about `node:buffer`.

**This number was 51 and the 51 was not real.** `Buffer` is a global as well as
an export, and node's tests write `Buffer.concat(...)` unqualified far more
often than they write the export -- so for as long as we did not install ours
as the global, they were grading node's `Buffer` against itself. Running the
suite with our module replaced by an empty object left **46 of the 51 still
passing**, which is what a number that cannot go red looks like.

Ours is installed as the global now and the suite measures it. The 45 failures
are real and are mostly one thing: argument validation. Node throws
`ERR_INVALID_ARG_TYPE` from almost every method for almost every wrong
argument, and a module reached from JavaScript has to, because JavaScript has
no types to have stopped the caller. After that come the missing
`readBigInt64*`/`writeBigInt64*` family and a handful of `ERR_OUT_OF_RANGE`
bounds.

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

Every module together, ranked — a work queue ordered by how much of the Node
surface each item unblocks, rather than by how often it appears in a corpus of
test files. The counts below were taken across eight modules and have not been
retaken since `console`, `diagnostics_channel` and the `assert` rewrite landed;
the ranking has not changed, but the absolute numbers are now low.

Since they were taken, one item has moved to the top of the list and is not in
the table. **`class X extends Error`** now underlies every module in the
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

Why `unknown` is unavoidable here rather than a style choice: every one of those
296 is a validator or an error field. `validateString(value: unknown, name:
string)` exists because a module reached through the Node-API wrapper is called
from JavaScript, which has no types — `readFileSync(42)` has to throw node's
error rather than open a file named `42`.

## What stops `path` compiling

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
compiled it is an extern linked against `runtime/node/c`; on node the
declaration erases and the call becomes a global lookup, which the module's
`bindings.node.mjs` supplies. The same source runs both ways, and `nts check`
is what compares them.

**libuv, not reimplementation.** The C calls the same library node calls, so
node's semantics are inherited rather than reimplemented and then tested for.
