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

| module | node's tests | compiles | note |
| --- | :---: | :---: | --- |
| `path` | **15 / 16** | 1 / 39 | complete but for `matchesGlob`; the skip is Windows-only |
| `os` | **4 / 4** | 16 / 31 | complete |
| `events` | **26 / 33** | 0 / 47 | complete but for domains, `EventTarget` and the promise forms |
| `fs` | 9 / 260 | 39 / 68 | the sync surface; async, streams and `Buffer` are absent |
| `querystring` | — | — | not started |
| `url` | — | — | not started |
| `buffer` | — | — | not started |
| `events` | — | — | not started |
| `stream` | — | — | not started |
| `assert` | — | — | not started |

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

`readFileSync` without an encoding returns a `Buffer` in node. There is no
`node:buffer`, so that call is refused with the reason rather than answered
with a string, which would differ from node silently. The encoded form is
complete.

Errors are libuv's, built from `uv_err_name` and `uv_strerror` through the
binding, so `err.code`, `err.errno`, `err.syscall` and `err.path` carry what
node's carry and the message reads the same:

```
ENOENT: no such file or directory, stat '/nope/x'
```

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
