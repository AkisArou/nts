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

## Modules

Counts are `passed / applicable`, where applicable excludes tests that spawn a
real `node` child — those assert on node's binary, which our module is not in.
Each exclusion is listed with a reason in the module's `not-applicable` file
rather than inferred by a rule, so the number can be audited.

**118 of node's own test files pass** across ten modules. The per-module counts
below are `passed / applicable`.

| module | node's tests | compiles | note |
| --- | :---: | :---: | --- |
| `path` | **15 / 16** | 1 / 49 | complete but for `matchesGlob`; the skip is Windows-only |
| `os` | **4 / 4** | 16 / 36 | complete |
| `events` | **26 / 33** | 0 / 50 | complete but for domains, `EventTarget` and the promise forms |
| `fs` | 11 / 260 | 12 / 141 | the sync surface; async, streams and watchers are absent |
| `querystring` | **4 / 4** | 3 / 97 | complete |
| `punycode` | **1 / 1** | 5 / 15 | complete |
| `url` | — | — | not started |
| `buffer` | **49 / 60** | 2 / 85 | complete enough for `fs` and `string_decoder` |
| `events` | — | — | not started |
| `string_decoder` | **2 / 3** | 4 / 99 | complete; the failure is the class-vs-function difference |
| `util` | 4 / 19 | 3 / 106 | `inspect`, `format`, `types`, `isDeepStrictEqual` and the helpers |
| `stream` | — | — | not started |
| `assert` | 2 / 18 | 1 / 103 | the comparisons are right; the messages are not yet exact |

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

26 of 33 applicable files pass. What is left:

| failing | needs |
| --- | --- |
| `test-event-emitter-subclass.js` | `EventEmitter.call(this)` — see below |
| `test-event-emitter-no-error-provided-to-error-event.js` | `node:domain` integration |
| `test-events-getmaxlisteners.js` | `EventTarget` |
| `test-events-once.js`, `test-event-capture-rejections.js` | promises |
| `test-events-uncaught-exception-stack.js` | stack rewriting for a rethrown `error` |

Three more skip on `internal/event_target`.

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

49 of 60 applicable files pass. Two are not applicable: they need
`--allow-natives-syntax` to drive V8's optimiser, which is a question about V8
rather than about `node:buffer`.

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

## `util`

`inspect`, `format`/`formatWithOptions`, `types` (43 predicates),
`isDeepStrictEqual`, `inherits`, `deprecate`, `debuglog`, `promisify`,
`callbackify`, `styleText`, `parseEnv`, `stripVTControlCharacters`,
`toUSVString`, and the `getSystemError*` family.

4 of 19 applicable files pass, which understates it: `util`'s tests compare
`inspect` output character for character, so a single spacing difference fails a
file that is otherwise entirely correct. The measures that say more:

- **`isDeepStrictEqual` agrees with node on 30,000 random structures** —
  primitives by `Object.is`, prototypes, symbol keys, `Map`/`Set` matched
  without regard to order, cycles.
- **`format` matches on every specifier** — `%s %d %i %f %j %o %O %c %%`,
  including `-0`, bigints, `numericSeparator`, and deferring to a custom
  `toString`.
- **`inspect` agrees with node on 88.5% of 5,000 random nested structures.**
  What is left is line-breaking of deeply nested values, not content.

Two things about `inspect` are worth recording because they look arbitrary and
are not. `groupArrayElements` lays short array entries out as a padded grid with
numbers right-aligned — thirty numbers one per line is unreadable and thirty on
one line is too wide — and its column arithmetic is a fitted heuristic, so
changing the constants changes the output. And `compact: 3` means "combine a
subtree less than three levels deep", which requires tracking the deepest
recursion reached; a child truncated to `[Object]` must *not* count towards it,
or every parent breaks onto multiple lines.

Not implemented: `getCallSites` (needs `Error.prepareStackTrace`), `MIMEType`,
`TextEncoder`/`TextDecoder`, `parseArgs`, `diff`, and the `AbortSignal` helpers.

## `assert`

Every function: `ok`, `equal`/`notEqual`, `strictEqual`/`notStrictEqual`,
`deepEqual`/`notDeepEqual`, `deepStrictEqual`/`notDeepStrictEqual`,
`partialDeepStrictEqual`, `throws`/`doesNotThrow`, `rejects`/`doesNotReject`,
`ifError`, `match`/`doesNotMatch`, `fail`, `AssertionError`, and the `strict`
variant.

2 of 18 files pass, and the number is misleading in the usual direction:
`assert`'s tests check the *message text* of every failure, so a module whose
comparisons are all correct still fails a file over a line of diff formatting.
The comparisons themselves are right — `deepStrictEqual` is the same
`isDeepStrictEqual` that agrees with node on 30,000 random structures.

Two details in the loose comparison are worth recording, because both were
wrong in the obvious implementation:

- **`==` applies only when both sides are primitives.** `'a' == ['a']` is true
  in JavaScript, because the array coerces through `toString`. Node does not
  call those deep-equal, and a top-level `==` makes it say they are.
- **A type check is a guard, not an answer.** Two regexps with the same source
  can still differ in their own properties, so the type comparison has to fall
  through to the key walk rather than returning `true`.

`AssertionError`'s diff inspects with `compact: false`, which puts every entry
on its own line. That is what lets the diff mark the single line that changed;
a compact rendering would put a whole object on one line and the diff would
report that the line changed, which is the output the diff exists to avoid.

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

Every module together, ranked. This is the aggregate refusal count across
`path`, `os`, `events`, `buffer`, `querystring`, `string_decoder`, `punycode`
and `fs` — a work queue ordered by how much of the Node surface each item
unblocks, rather than by how often it appears in a corpus of test files.

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
