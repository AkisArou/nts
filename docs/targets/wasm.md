# Wasm

TypeScript compiled to WebAssembly: one WasmGC backend, built through
Binaryen, with two profiles: a JS-hosted one for browsers and node, and a
standalone one for JS-free engines and WASI. Both are designed; neither is
built. The direct backend that built the JS-hosted profile is retired, so nts
builds no Wasm today. For anyone working on the Binaryen backend. The open foundations
(weak references, strings, JSON, the engine) are on
[JVM and Wasm](../foundations/jvm-and-wasm.md).

## Profiles

| profile | runs in | strings | boundary | state |
|---|---|---|---|---|
| **JS-hosted** | browsers (the first priority), node and Bun | the host's strings, through the JS String Builtins | generated ES-module glue; DOM and Web API bindings | designed; the retired direct backend built it for node and the browser, without the DOM |
| **standalone** | a qualified WasmGC engine, Wasmtime first | GC-owned UTF-16 arrays | explicit host imports | designed, not built |
| **WASI** | the standalone core with WIT adapters | WIT strings at the boundary | the canonical ABI, linear memory only at the WIT boundary | designed, not built |

One backend means one lowering and one set of contracts, not identical bytes:
the profile is resolved once, when the build is composed, and never discovered
inside an operation. A capability the engine lacks stays visible; nothing
silently falls back to another heap or to JavaScript.

## Today

`nts emit-wasm` and `nts build --target wasm` exit with "the Wasm backend is
being rebuilt on Binaryen; see docs/targets/wasm.md". The retired direct
backend, its tests, its browser runner and its comparison benchmarks (C++ to
WASI, AssemblyScript) are kept at `refs/archive/wasm/direct-backend`, with
their catalogue row in `tooling/lanes/archive.tsv`. The rest of this page is
the design the Binaryen backend is built to.

## A module and its glue

There is no Wasm target or product in `nts.config.ts` (register
[S-1](../open-questions.md#6-bindings-products-toolchains-dependencies)). A
module is written with its glue, as the retired backend wrote it:

| file | what it is |
|---|---|
| `program.wasm` | the module |
| `program.mjs` | the program's ES module: exactly its exports, `default` included. Importing it instantiates the module and runs module evaluation once, as importing the TypeScript does in node |
| `program.instance.mjs` | `instantiate()`, which makes a fresh instance, and `WasmInputDecline`, the error every refused input throws |
| `program.wasm.json` | a tooling sidecar: the exports at their logical types, the imports, the routes. Nothing reads it at run time |
| `program.origins.json` | each instruction's source origin, for debugging |

```js
import { area } from "./out/program.mjs";
console.log(area(3, 4));
```

The browser glue compiles with `compileStreaming(fetch(...))`, node's from the
file; everything else is shared.

## What the engine must provide

- WasmGC, typed function references, exception handling with
  `WebAssembly.JSTag` (in a module that throws), and the JS String Builtins
  (`wasm:js-string`) with imported string constants. The module is validated
  with tail calls and SIMD admitted, and declares the features it uses.
- The capability check is the compile itself. An engine that ignores the
  builtin options, or lacks `JSTag` where it is needed, gets
  `WasmEngineMissing` (NTS5001) naming what is missing, before any compiled
  code runs. The glue never substitutes JavaScript for a builtin.
- Which engines are supported, and which WASI version, is register
  [I-9](../open-questions.md#5-interop-and-hosts).

## The export boundary

Each export gets one straight-line wrapper with only the checks its declared
type needs: `typeof`, integer range, and the numeric facts the compiled code
assumes. A missing argument is refused, since no boundary type holds
`undefined`; an extra one is ignored, as JavaScript ignores it. Checking is
always on. Every primitive a wrapper calls is captured when the glue loads, so
redefining a global later redirects nothing. A module global that functions
other than the initializer assign stays a live binding.

| TypeScript | crosses as |
|---|---|
| `number`, a proved integer | a JS number, range-checked on the way in |
| `boolean` | a JS boolean |
| `string` | the JS string itself, with no copy |
| `string \| null`, `string \| undefined` (a result) | the string, or that absence |
| `Promise<T>` (a result) | a JS promise, settled as the program's is |
| `unknown`, `any` | a JS primitive: a number, string, boolean, `undefined` or `null` |
| an object, array, function, symbol or `bigint` | refused by name |

How objects cross is decided, for the Wasm glue and the Node addon alike
([record 0356](../records/0356-objects-cross-an-exported-boundary-by-proof-copied-where-invisible-live-otherwise.md)):
copied in where a copy cannot be noticed, a live reference otherwise, one
cached wrapper per object nts made, the caller's own bytes for a typed array,
and a held reference for a function, never a silent copy. None of it is built
for Wasm. Values the program imports are proposal W5.

## Inside the module

As the retired backend built it, and as the Binaryen backend is designed:

- **Objects, arrays and closures** are WasmGC structs and arrays, in one
  recursive type group; there is no linear memory. Every function, import,
  global and helper exists only if the program asks for it, so a scalar
  program has none.
- **Numbers** are `i32`, `i64` and `f64` where proved. An erased value
  (`unknown`, a mixed union) is an `anyref`, with small integers as `i31`
  (W4). A BigInt is exact to 128 bits and stops by name past them.
- **Strings** are the host's, held as `externref` and read through
  `wasm:js-string`. String literals are imported constants; one holding a lone
  surrogate crosses as UTF-16 code units, so text is exact.
- **Map and Set** are WasmGC tables, hashed with 32-bit FNV-1a, unseeded
  ([hashing](../foundations/hashing.md)).
- **Builtins** are helpers generated inside the module, plus host imports for
  what the host already has exactly, such as `Math`'s functions and number
  formatting. Intl and RegExp from the host are decided, not built, and both
  are refused.
- **Memory** is the engine's collector (the `HostGc` provider); asking for
  counting (`--rc`) is declined (NTS2001). A cycle running through JavaScript
  objects and the program's is the engine's to collect, which is the main
  reason the backend is WasmGC. Weak references are refused (W1 is the
  proposal).
- **Async:** promises run on the module's own queue, drained at each export;
  timers are the host's `setTimeout` and `setInterval`
  ([async](../language/async.md#the-event-loop-on-each-target)).
- **Exceptions:** an uncaught throw leaves the module as the thrown JavaScript
  value, through `WebAssembly.JSTag`; a compiled object leaves as a named
  refusal carrying its class's name and message. A whole program ends as a C program does: status 0 when every job and timer
  has run, or 1 after `nts: uncaught <Class>: <message>`.

## Emission

- **Decided:** the compiler lowers prepared HIR straight to Binaryen IR, and
  Binaryen optimizes the module and writes it. Binaryen is pinned and kept
  behind a small adapter; the pin must construct `try_table` and `throw_ref`
  through its C API (W7) (register
  [D-2](../open-questions.md#6-bindings-products-toolchains-dependencies)).
- **Retired:** the direct encoder, which lowered to a thin symbolic IR, encoded
  it with `wasm-encoder` and validated it with `wasmparser`.
- **Not chosen:** Emscripten, or LLVM to linear memory, as the foundation. LLVM
  stays a candidate only for narrow numeric and bulk kernels that pass simple
  values or spans and cross no managed ownership.

## Running in the browser

The first product milestone is browser applications with DOM and JS
integration. The retired backend's headless-Chromium runner and its browser
test mode are in the archive for the Binaryen backend to start from; the DOM
was never bound (registers
[G17](../open-questions.md#2-builtins-and-globals),
[I-8](../open-questions.md#5-interop-and-hosts)).

## Standalone and WASI

Designed, not built: no JavaScript; WasmGC objects on Wasmtime first,
qualified by reclamation tests (cycles included) before any program is
promised to run (W6); strings as GC-owned UTF-16 arrays; nts's own builtins,
with the Unicode tables in data segments and no Intl (D6); linear memory only
at the WIT boundary, where strings are Unicode text and a lone surrogate
becomes U+FFFD (W6). The Component Model's experimental GC extension is not
relied on.

## Open questions

- Proposals W1, W2 and W5 to W8, and X1 for holes in arrays of numbers (which
  Wasm refuses): [JVM and Wasm](../foundations/jvm-and-wasm.md#proposed-decisions).
- Wasm as a product, and Binaryen inside the compiler:
  [S-1, D-2](../open-questions.md#6-bindings-products-toolchains-dependencies).
- Engines and the WASI version, and one DOM source with Chromium:
  [I-9, I-8](../open-questions.md#5-interop-and-hosts).
- Two microtask queues on a JS host:
  [C-5](../open-questions.md#4-concurrency-and-async).
- Weak references off native: [M-5](../open-questions.md#3-memory).

## Decisions

- One WasmGC backend, browser-first with DOM and JS integration as the first
  milestone, with JS-hosted and standalone profiles. The compiler hands its
  code to Binaryen, which optimizes it; linear memory is only for buffers and
  kernels; no compatibility with the current emitter is owed
  ([log](../records/notebooks/decisions-log.md#wasm-10-24-10-25)).
- `stringref` is rejected (W3), and erased values keep `i31` for small
  integers (W4) ([log](../records/notebooks/decisions-log.md#team-and-process)).
- On a JS host, the host's builtins are taken, starting with Intl and RegExp
  (decision 3,
  [log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- No Intl on standalone Wasm for now (D6,
  [log](../records/notebooks/decisions-log.md#unicode-10-27)).
- test262 runs on every backend, Wasm included once the Binaryen backend
  exists ([log](../records/notebooks/decisions-log.md#wasm-10-24-10-25)).
- The direct backend is retired: removed from the tree, the workspace and the
  gate, and archived, rather than kept unbuilt
  ([log](../records/notebooks/decisions-log.md#wasm-10-24-10-25)).
- Native comes first; Wasm is designed after it
  ([log](../records/notebooks/decisions-log.md#priorities-and-order)).
