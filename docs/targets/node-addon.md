# Node addon

A TypeScript module compiled into a Node-API addon: a `.node` file that node
loads with `require` and calls like any module. The native half is the C
backend's output, and a generated layer publishes the entry module's exports
through Node-API. For anyone shipping an addon, and for reading how node's own
tests run against compiled modules ([node conformance](../conformance/node.md)).

## Building

```ts
// nts.config.ts
import { defineConfig, library } from "@nts/config";

export default defineConfig({
  products: { addon: library.node({ entry: "./src/main.ts" }) },
});
```

```js
const { area, Counter } = require("./.nts/build/addon/node-api-8-x86_64/addon.node");
```

- **The target is the Node-API version** (`target.node({ apiVersion })`, id
  `node-api-8` by default), because that version decides which functions
  exist; one binary then loads in every node that supports it.
  `library.node({ platforms })` builds one per machine. The backend is always
  C. `nts emit-c --napi` writes the same addon source by hand.
- **`node_api.h` is a build dependency:** the `node-api-headers` package in
  the project, or `NTS_NAPI_INCLUDE` naming its directory. Nothing else of
  node is linked: a `.node` resolves the `napi_*` functions from the process
  that loads it.
- **Linux only.** An addon for macOS or Windows is refused by name: its link
  would need `-undefined dynamic_lookup` or node's import library, and the
  check below reads ELF.
- **An addon that cannot load is not an artifact.** After linking, any
  undefined symbol other than node's `napi_*` refuses the build.

## What it publishes

`NAPI_MODULE_INIT` hands the runtime node's environment, runs module
evaluation, and publishes what the entry module exports:

- **functions**, whose `length` is node's (the parameters before the first
  default or rest);
- **classes:** `new Counter(...)` in JavaScript makes the native instance and
  attaches it to its JavaScript wrapper with `napi_wrap`, with its methods and
  fields. The wrapper owns one count, released by its finalizer when V8
  collects it. An instance crosses only as the receiver of its own methods; a
  function taking or returning one is not published;
- **namespaces** of functions (`export const ucs2 = { decode, encode }`), with
  the members that crossed, and **values** (`export const sep = "/"`).

An export that cannot cross is left out, and the build names it with its
reason; a namespace missing a member names each one.

## What crosses

Each argument is checked against its declared type at the entry. A value
that is not what the signature declares throws a `TypeError` with node's own
`ERR_INVALID_ARG_TYPE` code and message, and is never coerced.

| TypeScript | from JavaScript | to JavaScript |
|---|---|---|
| `number`, an integer kind | a number, checked to be an integer or a `float32` where the kind says | a number |
| `bigint` | a BigInt, exact within signed 128 bits | a BigInt |
| `boolean` | a boolean | a boolean |
| `string` | copied | copied |
| `number[]`, `string[]` | copied into a new array | copied |
| an array of booleans or plain records | refused | copied |
| a plain record (no methods, no class) | refused | a JavaScript object of its fields, nested records included |
| `Record<string, V>` | refused | a plain object, in insertion order |
| a typed array | refused | copied; a `Uint8Array` arrives as a node `Buffer` |
| `unknown` | a primitive, with its tag | a primitive |
| a function, `Promise`, `Map`, `Set`, `Date`, symbol, `ArrayBuffer`, `DataView` | refused | refused |

How objects, typed arrays and functions are to cross inward is decided by
[record 0356](../records/0356-objects-cross-an-exported-boundary-by-proof-copied-where-invisible-live-otherwise.md),
for this boundary and the Wasm glue alike: copied in where the compiler proves
a copy cannot be noticed, a live reference to the caller's object otherwise,
one cached wrapper per object nts made, the caller's own bytes for a typed
array, and a held reference for a function; never a silent copy. Of these, the
wrapper for an instance JavaScript constructs is built; the rest is not.

## Errors

A throw out of an exported function or constructor arrives in node as a
JavaScript exception: a thrown primitive as itself, an error as an instance of
node's own class (`napi_create_type_error`, `napi_create_range_error`), so
`instanceof` and the prototype chain hold, with its message and properties such
as `code` ([errors](../language/errors.md#callbacks-a-host-invokes)).

## The event loop

An addon runs on node's main thread and adds no loop: an exported call runs
to completion and returns, and node's own loop is the only one. nts installs
no host of its own there (`NtsHost`). The `node:*` modules compiled as addons
for conformance schedule their I/O and timers on node's libuv loop
([async](../language/async.md#the-event-loop-on-each-target)); the global
`setTimeout`, which needs a host, stops the program by name (`nts_post_delayed
before a host was installed`). A promise does
not cross the boundary: an `async` export is left out of the addon and named
at build time (register [I-4](../open-questions.md#5-interop-and-hosts)). With no host installed, the
owner-thread test answers true, so a call from a worker thread is not detected
(register [C-3](../open-questions.md#4-concurrency-and-async)).

## Memory

The addon's own heap counts references with its cycle collector, as every
native program does. Nothing on the native side holds a JavaScript value, so
no cycle can run through both heaps; once record 0356's live references exist,
one can, and a holder family for N-API is the answer (register
[I-6](../open-questions.md#5-interop-and-hosts)).

## One instance per process

An addon's module globals, and the environment `NAPI_MODULE_INIT` hands the
runtime, are process-wide statics. A second instance in the same process, such
as the addon loaded again in a worker thread, would share them. One instance
per process, refused clearly otherwise, is the recommendation, with the
instance becoming a parameter when workers arrive (register
[I-7](../open-questions.md#5-interop-and-hosts)).

## Open questions

- Promises across the boundary, as a deferred and a threadsafe function:
  [I-4](../open-questions.md#5-interop-and-hosts).
- One instance per process: [I-7](../open-questions.md#5-interop-and-hosts).
- Cycles through host objects once JavaScript values are held:
  [I-6](../open-questions.md#5-interop-and-hosts).
- node's builtins or nts's own inside an addon:
  [G11](../open-questions.md#2-builtins-and-globals).
- Shipping prebuilt addons to npm:
  [S-3](../open-questions.md#6-bindings-products-toolchains-dependencies).

## Decisions

- Objects cross an exported boundary by proof: copied where invisible, live
  otherwise, a cached wrapper, borrowed typed-array bytes, never a silent copy
  ([record 0356](../records/0356-objects-cross-an-exported-boundary-by-proof-copied-where-invisible-live-otherwise.md)).
- An exception escaping a callback a host invokes crosses into node as a
  JavaScript exception, and node's own rules apply
  ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
