# Node's tests

How nts's `node:*` modules, in `runtime/node/`, are held to node's own test
suite: what runs, how a file and a module are counted, where the results are,
and which modules exist. For anyone working on a module or reading its
numbers. How a module is written is
[`runtime/node/README.md`](../../runtime/node/README.md), and the instruments
are listed in [`tooling/conformance/README.md`](../../tooling/conformance/README.md).

## Scope

- `node:*` is for native targets only, for now, and never for a Chromium
  renderer. The JVM refuses it.
- No target provides it to a program yet. Each module compiles on its own, as
  the Node addon its tests load; a program's own `import "node:…"` does not
  resolve to `runtime/node`.
- The modules implemented are [listed below](#the-modules). Node's other public
  modules are not attempted.
- What a module cannot express in the language is a
  [boundary](../language/boundaries.md). A test whose point is a boundary is
  listed not applicable, citing it.

## What runs

Node's own tests, at the node version `.tool-versions` pins. Bootstrap checks
out `third_party/node` at that tag, with node's `lib`, `test`, `src` and
libuv's headers. The same version is the node binary that runs the tests and
the headers the addons build against, so the three never disagree.

A module's tests are:

- `test/parallel/test-<module>.js` and `test-<module>-*.js`, or the files
  matching the module's `test-pattern`;
- the files its `extra-tests` lists, and the suite directories or exact files
  its `test-suites` lists;
- focused tests in its own `test/`, reported as `local/<name>`. Each cites the
  upstream test or library source it preserves. They cover the supported half
  of a mixed file, an operation that needs an outside observer, or a public
  operation no upstream test calls; they never stand in for an upstream
  failure.

Each file runs in its own process, from node's checkout, as node runs
`test/parallel`. The test is not patched: its `require` of the module, as `x`
or as `node:x`, is handed nts's module instead. Its `// Flags:` line is
honoured for the flags the runner can give, and a child process it starts is
routed back through the runner when the child runs the same suite or a declared
fixture. The body starts from a fresh macrotask, as a CommonJS test's does,
and the file is judged once the event loop is empty, as node judges its
`mustCall` checks. A run refuses `NODE_NO_WARNINGS` and `NODE_DEBUG` in its
environment, because tests assert on what they suppress.

### Two lanes

| lane | subject | command |
|---|---|---|
| interpreted | the module's TypeScript, run on node, with its `bindings.node.mjs` standing in for its C | `tooling/conformance/check.sh <module> --ts` |
| compiled | the Node addon nts builds: the TypeScript compiled and the C linked | `tooling/conformance/check.sh <module>` |

The compiled lane tests what ships. The interpreted lane tests the
implementation, and it is the only lane for a module that does not compile
yet. A file that passes interpreted and fails compiled is a compiler defect. A
file that passes compiled and fails interpreted passes for a reason other than
the one it states.

## How a file and a module are counted

| verdict | meaning |
|---|---|
| pass | the file ran to the end with every expectation met |
| fail | an assertion, an uncaught exception, a crash, a timeout, or the file exiting early |
| skip | the test skipped itself, or it needs a pseudo-terminal and `script(1)` is missing |
| n/a | listed in the module's `not-applicable` file, with a reason |

A module **passes a lane** when no file fails: the runner exits 0 only then.

`not-applicable` describes the test, never an unfinished implementation. Each
reason begins with its kind: `language non-goal`, which rests on a
[boundary](../language/boundaries.md); `cross-module integration`, for
instrumentation owned by a module outside the profile; or
`host-binary subprocess`, for a child that cannot be routed or a test of
node's executable itself. A temporary gap may be listed only by naming its
exact compiler or runtime blocker, and it stays required work. A file that
mixes an excluded assertion with supported behaviour names the test that keeps
the supported part covered.

**A pass must measure the module,** and these controls ask whether it does:

- `--sabotage` hands every test an empty module. Whatever still passes never
  measured nts.
- `--empty-exports` runs the module's shim over an addon that published
  nothing.
- `--mutate-addon` and `--mutate-silent` keep the addon's names and destroy
  what they do.
- On the compiled lane, a module whose addon publishes nothing runs no tests:
  every file is n/a, since a pass would assert nothing.
- The compiled count keeps only **real passes**: a pass that survives emptying
  the module's exports is not counted.

## Where the results are

- Every run prints each file's verdict and a total,
  `N file(s): P passed, F failed, S skipped, A not applicable`; `--json`
  prints the same for a tool.
- `tooling/conformance/interpreted-lane.sh` runs every module on the
  interpreted lane, one line each, and counts the modules with a failing file.
- `tooling/conformance/compiled-axis.sh` builds every module with one compiler
  and prints each module's real compiled passes.
- [`tooling/conformance/compiled-axis.floor`](../../tooling/conformance/compiled-axis.floor)
  holds each module's real compiled passes, written by
  `compiled-axis-floor.mjs --record`. `compiled-axis-floor.mjs` fails when a
  module falls below its row or will not load, and a change to `runtime/node`
  owes that run, by hand.

No tool writes node's results to `results/` yet.

The gate runs none of node's tests yet; they gate once the node lane resumes
([Decisions](#decisions)). The full run's
`addons` step builds every module as an addon, refusing one that used to build
and stopped, and loads each with every symbol bound. Its `divergence` step
audits the `not-applicable` lists and runs differential fuzzers that compare
the modules with node.
How much of each module lowers is the full run's `profile` and `definitions`
steps, a measure of reach, not of conformance.

## The modules

Each is `runtime/node/<module>`: TypeScript transcribed from node's `lib/`, and
a native half in C over libuv, or over the library node itself uses there.

| module | native half | scope note |
|---|---|---|
| `assert` | none | assertions and their deep-equality rules |
| `async_hooks` | none | hooks, `AsyncLocalStorage`, `AsyncResource` |
| `buffer` | none | `Buffer` as a `Uint8Array` subclass, its encodings; `Blob` and `File` are its own today, though web-platform's are canonical |
| `child_process` | libuv | `spawn`, `exec` and `fork` with IPC, and their synchronous forms |
| `cluster` | none | the primary and worker roles |
| `console` | none | `Console` and the global console |
| `crypto` | OpenSSL 3 | hashes, MACs, ciphers, key derivation, keys, signatures, X.509, Web Crypto |
| `dgram` | libuv | UDP sockets |
| `diagnostics_channel` | none | named publish-and-subscribe channels |
| `dns` | libuv, c-ares | `lookup` through the system; `Resolver` and the `resolve*` family through c-ares |
| `events` | none | `EventEmitter` and its helpers |
| `fs` | libuv | the synchronous, callback and promise forms, streams, `Stats`, `Dirent` |
| `http` | none | HTTP/1.1 client and server over `net`; its parser is TypeScript, where node's is llhttp |
| `net` | libuv | sockets, servers, `BlockList` |
| `os` | libuv | system information |
| `path` | none | POSIX and Windows paths, glob matching |
| `perf_hooks` | libuv | the performance timeline, observers, `timerify`, histograms |
| `process` | C | the `process` object: environment, control, resources, standard input, warnings |
| `punycode` | none | the deprecated module, over the codec `url` uses |
| `querystring` | none | parsing and formatting query strings |
| `readline` | none | the line interface, history, keypresses, the promise form |
| `stream` | none | the stream classes and their utilities |
| `string_decoder` | none | `StringDecoder` |
| `timers` | libuv | timeouts and immediates on one host timer, and the promise forms |
| `tty` | libuv | `isatty` only |
| `url` | none | the WHATWG `URL` and the legacy `url.parse`; `URLSearchParams` is its own today, though web-platform's is canonical |
| `util` | none | `inspect`, `format`, `types`, `parseArgs`, deep equality, MIME types |
| `zlib` | zlib, Brotli, Zstandard | compression streams and one-shot calls |

Not attempted: the TLS family (`tls`, `https`, `http2`, `quic`); the engine's
own modules (`vm`, `repl`, `inspector`, `v8`, `trace_events`);
`worker_threads`; `module`; `test`; `sqlite`; `sea`; `wasi`; and the
deprecated `domain`, `constants` and `sys`.

## Decisions

- `node:*` APIs are native-only for now, and never in a Chromium renderer
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- The canonical `URLSearchParams`, `Blob` and `File` are web-platform's, and
  `runtime/node` re-exports them
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- Workers are isolated heaps with non-atomic counts, permanently, which is the
  ground `worker_threads` is to be built on
  ([log](../records/notebooks/decisions-log.md#memory-management-10-27)).
- Node's tests run as node wrote them; a gap is reported, never edited away
  ([`CLAUDE.md`](../../CLAUDE.md)).
- The node pin moves with node's LTS releases, and the Unicode pin with it
  (D2); node's own tests gate once the node lane resumes (Q-5; 10-28,
  [log](../records/notebooks/decisions-log.md#performance-and-process-10-28)).
- All 28 modules are owed to native programs, through a `node:` resolver, with
  `process` and `Buffer` as globals in the native profile (G10; 10-28,
  [log](../records/notebooks/decisions-log.md#builtins-and-globals-10-28)).
