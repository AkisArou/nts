# RFC NTS-NODE-001: Rehosting Node.js Core Libraries as Native AOT Libraries

**Status:** Proposed
**Date:** August 27, 2026
**Scope:** Optional Node.js compatibility profile for Native TypeScript
**Runtime requirement:** No Node.js executable, no V8, and no JavaScript engine

---

## 1. Summary

Native TypeScript should provide Node.js core-library compatibility by consuming a **pinned upstream Node.js source checkout** and compiling selected files from Node’s `lib/*.js` and `lib/internal/**/*.js` directories through the Native TypeScript frontend, HIR, MIR, and native backends.

Native TypeScript must not:

- embed Node.js;
- link V8;
- emulate the V8 C++ API;
- execute Node’s library files through a JavaScript engine;
- maintain a permanent source fork of Node’s JavaScript standard library.

Instead, Node.js is treated as an upstream **standard-library source package**:

```text
pinned Node.js checkout
        │
        ├── lib/path.js
        ├── lib/events.js
        ├── lib/fs.js
        ├── lib/stream.js
        └── lib/internal/**
               │
               ▼
       NativeTS Node importer
               │
               ├── attach public TypeScript signatures
               ├── infer internal helper types
               ├── resolve literal require() calls
               ├── resolve primordials
               ├── resolve internalBinding()
               ├── provide Node globals
               ├── apply semantic overlays
               ├── apply minimal external patches
               └── substitute explicit shims when required
                        │
                        ▼
                  NativeTS HIR
                        │
                        ▼
                  optimized MIR
                        │
                ┌───────┴───────┐
                ▼               ▼
                C             LLVM
                │               │
                └───────┬───────┘
                        ▼
                  native objects
                        │
           ┌────────────┼─────────────┐
           ▼            ▼             ▼
         libuv        llhttp         c-ares
           │            │             │
           └────────────┴─────────────┘
                        ▼
                        OS
```

The resulting product is a Native TypeScript application or library containing native implementations of selected Node APIs. It is not a modified Node executable.

---

## 2. Decision

Native TypeScript adopts the following strategy:

> Use Node.js’s JavaScript standard-library sources as pinned, read-only upstream inputs. Compile supported modules into native code and replace Node’s V8-facing runtime contracts with statically resolved Native TypeScript bindings.

The first implementation should focus on modules whose logic is primarily portable JavaScript:

```text
node:path
node:path/posix
node:path/win32
node:events
node:querystring
node:string_decoder
selected node:util and node:assert functionality
```

Modules requiring operating-system access should follow once the source-import architecture is proven:

```text
node:fs
node:fs/promises
node:os
node:timers
node:dns
node:net
node:dgram
node:child_process
node:tty
node:http
```

Broad Node compatibility remains a later project phase and must not block the compiler, native UI, modules, React renderer, Web APIs, shared-library products, or developer tooling.

---

## 3. Motivation

Node’s core API behavior is not implemented entirely in V8 or native C++.

A substantial portion lives in JavaScript under Node’s `lib/` directory. For example:

- `path.js` implements path normalization, resolution, relative-path computation, parsing, and formatting through JavaScript string and array operations.
- `fs.js` implements argument handling, validation, callback orchestration, Buffer behavior, read-file state machines, error conversion, and stream behavior above a narrower `internalBinding('fs')` layer.
- Internal modules implement validators, errors, streams, module behavior, utilities, primordials, and platform policy.

The `hermes-node` experiment demonstrates that this separation is usable in practice. It vendors Node’s actual JavaScript builtin sources and replaces the V8-facing native binding layer with new native bindings over Hermes Node-API. Its design describes the reusable layers as Node’s JavaScript modules, targeted shims, native bindings, and runtime infrastructure.

Native TypeScript can take the same separation further:

```text
hermes-node:
    Node JS → Hermes bytecode → Hermes runtime → native bindings

Native TypeScript:
    Node JS → typed HIR/MIR → C/LLVM → direct native bindings
```

No engine is required in the Native TypeScript model.

---

## 4. Why Native TypeScript Cannot Be Plugged into Stock Node

Stock Node.js does not expose a stable JavaScript-engine replacement interface.

Its builtin loader directly depends on V8 concepts such as:

```text
v8::Isolate
v8::Context
v8::Value
v8::Function
v8::Module
v8::ScriptCompiler
V8 handle scopes
V8 exception handling
V8 code caches
```

The current builtin loader uses V8’s `ScriptCompiler` to compile builtin JavaScript as functions or modules and returns V8 function/module objects to the rest of Node’s runtime.

Replacing that compiler call is not enough. The surrounding Node runtime still expects V8-managed values, functions, contexts, garbage-collected handles, and callbacks.

Therefore this architecture is rejected:

```text
stock Node
    │
    └── replace V8 with NativeTS compiler
```

The chosen architecture is:

```text
Node source files
    │
    ▼
NativeTS compiler and runtime
```

Node is an upstream source provider, not the runtime host.

---

## 5. Goals

This RFC aims to:

1. Reuse Node’s mature public API behavior and edge-case handling.
2. Avoid V8 and any other runtime JavaScript engine.
3. Avoid permanently forking Node’s `lib/*.js` implementation.
4. Preserve exact upstream source provenance.
5. Compile Node source through the same HIR and MIR as application TypeScript.
6. Permit whole-program reachability, specialization, inlining, and dead-code elimination.
7. Resolve Node internal modules and bindings statically.
8. Link only the Node functionality reached by an application.
9. Support both C and LLVM native backends.
10. Use Node’s own tests as a principal behavioral oracle.
11. Permit selected Node modules to be built as independent native libraries.
12. Make Node support an optional compatibility profile rather than a compiler prerequisite.

---

## 6. Non-Goals

The initial implementation will not:

- support every Node builtin;
- support arbitrary npm packages;
- implement `node:vm`;
- implement `node:v8`;
- support runtime source compilation;
- support arbitrary CommonJS loader hooks;
- support arbitrary ESM loader hooks;
- support monkey-patching of Node internals;
- support all Node native addons;
- guarantee `.node` addon compatibility;
- implement a general Node-API runtime initially;
- preserve every dynamic JavaScript behavior used by Node internals;
- load Node library sources at application startup;
- ship Node’s complete module loader in every binary;
- promise exact process-level compatibility before differential tests prove it.

---

## 7. Source Ownership and Pinning

Node source must be consumed through a pinned, immutable input.

Recommended structure:

```text
third_party/
└── node/
    ├── node-src/                   # read-only checkout or extracted archive
    ├── node.lock.json
    ├── LICENSE
    └── THIRD_PARTY_NOTICES.md
```

Example lock file:

```json
{
  "nodeVersion": "24.13.0",
  "nodeCommit": "def0bdf8abee441cfcbf793a8dc24a6f3b899573",
  "typesNodeVersion": "24.x",
  "typesNodeCommit": "<pinned-commit>",
  "sourceDigest": "<digest>",
  "semanticsVersion": 1,
  "patchSeriesDigest": "<digest>"
}
```

The upstream checkout must never be modified in place.

Native TypeScript customizations live outside it:

```text
libraries/
└── node/
    ├── semantics/
    ├── patches/
    ├── shims/
    ├── bindings/
    └── tests/
```

This is upstream consumption rather than a permanent source fork.

---

## 8. Proposed Repository Structure

```text
native-typescript/
│
├── third_party/
│   └── node/
│       ├── node-src/
│       ├── node.lock.json
│       ├── LICENSE
│       └── notices/
│
├── libraries/
│   └── node/
│       ├── importer/
│       │   ├── source-loader/
│       │   ├── declaration-binder/
│       │   ├── js-typing/
│       │   ├── cjs-static-linker/
│       │   ├── export-analysis/
│       │   ├── globals/
│       │   └── diagnostics/
│       │
│       ├── source-manifest/
│       │   ├── public-modules.toml
│       │   ├── internal-modules.toml
│       │   ├── aliases.toml
│       │   └── unsupported.toml
│       │
│       ├── semantics/
│       │   ├── primordials/
│       │   ├── globals/
│       │   ├── builtins/
│       │   ├── commonjs/
│       │   ├── scheduler/
│       │   ├── errors/
│       │   └── internal-bindings/
│       │
│       ├── patches/
│       │   ├── series
│       │   └── modules/
│       │
│       ├── shims/
│       │   ├── internal/
│       │   └── public/
│       │
│       ├── bindings/
│       │   ├── contracts/
│       │   │   ├── fs/
│       │   │   ├── buffer/
│       │   │   ├── os/
│       │   │   ├── timers/
│       │   │   ├── tcp/
│       │   │   ├── udp/
│       │   │   ├── pipe/
│       │   │   ├── dns/
│       │   │   ├── process/
│       │   │   ├── tty/
│       │   │   └── http-parser/
│       │   │
│       │   ├── native/
│       │   │   ├── rust/
│       │   │   ├── c/
│       │   │   └── cpp/
│       │   │
│       │   └── testkit/
│       │
│       ├── runtime/
│       │   ├── process/
│       │   ├── buffer/
│       │   ├── node-errors/
│       │   ├── next-tick/
│       │   ├── callback-scope/
│       │   ├── active-resources/
│       │   └── shutdown/
│       │
│       ├── generated/
│       │   ├── module-index/
│       │   ├── binding-ids/
│       │   ├── signatures/
│       │   └── provenance/
│       │
│       ├── cache/
│       │   ├── semantic-snapshots/
│       │   ├── hir/
│       │   └── mir/
│       │
│       └── tests/
│           ├── import/
│           ├── compile/
│           ├── upstream/
│           ├── differential/
│           ├── bindings/
│           ├── scheduling/
│           └── performance/
│
└── profiles/
    └── node/
        ├── profile.ts
        ├── supported-modules.json
        ├── declarations/
        ├── capabilities/
        └── diagnostics/
```

---

## 9. Node Source Import Pipeline

The importer turns Node’s JavaScript sources into typed Native TypeScript compilation units.

```text
Node module source
        │
        ▼
parse as JavaScript
        │
        ▼
resolve public and internal module identity
        │
        ▼
attach external declarations
        │
        ▼
infer internal helper signatures
        │
        ▼
apply semantic overlays
        │
        ▼
resolve static CommonJS graph
        │
        ▼
resolve primordials
        │
        ▼
resolve internalBinding()
        │
        ▼
apply shims and virtual patches
        │
        ▼
typed semantic snapshot
        │
        ▼
HIR / MIR
```

The result should be cached before target-specific lowering.

---

## 10. Attaching TypeScript Signatures to JavaScript Bodies

Node’s implementation sources are JavaScript, while the public API contract is described by `@types/node`.

The importer must support **implementation typing**:

```text
public declaration signature
          +
JavaScript implementation body
          ↓
typed implementation function
```

### Example: `node:path`

The public declaration defines:

```ts
interface PlatformPath {
  relative(from: string, to: string): string;
}
```

Node’s implementation defines:

```js
const posix = {
  relative(from, to) {
    // Node implementation
  },
};
```

The importer binds the exported `posix` object to the `PlatformPath` interface and gives the implementation body the effective signature:

```ts
function relative(from: string, to: string): string;
```

That type information then propagates into the function body.

### Sources of type information

In priority order:

1. Pinned public declarations from `@types/node`.
2. Explicit Native TypeScript semantic overlays.
3. Node’s JSDoc.
4. Local control-flow and call-site inference.
5. Compiler-generated internal signatures.
6. Diagnostics when no safe answer can be established.

`@types/node` is the public contract, not the sole behavioral authority. Node’s implementation and tests remain the behavioral authority.

### Internal modules

Most `internal/*` modules do not have public declarations.

Their types should come from:

- JSDoc;
- inference;
- known primordial signatures;
- typed internal-binding contracts;
- explicit overlay files for difficult cases.

Native TypeScript must not require editing upstream JavaScript merely to add types.

---

## 11. Static CommonJS Linking

Node’s core modules use CommonJS, but Native TypeScript does not need Node’s runtime CommonJS loader for builtin modules.

The importer should support a constrained static CommonJS model.

### Supported initially

```js
require("literal-module-id");
module.exports = value;
exports.name = value;
module.exports.name = value;
```

Literal `require()` calls become static dependency edges.

```text
lib/fs.js
    ├── internal/fs/utils
    ├── internal/errors
    ├── internal/validators
    ├── buffer
    └── path
```

### Circular dependencies

Circular builtin dependencies require explicit module initialization states:

```text
uninitialized
initializing
initialized
failed
```

The importer may preserve live export cells when Node semantics require them.

### Lazy requires

Patterns such as:

```js
let module;

function getModule() {
  module ??= require("internal/foo");
  return module;
}
```

may lower to:

- a statically known lazy initialization cell;
- direct eager initialization when proven equivalent;
- direct inlining when reachability permits it.

### Unsupported dynamic loading

The following are rejected unless analysis proves a finite set:

```js
require(name);
require(prefix + suffix);
module.constructor._load(...);
runtime-generated source;
```

A semantic overlay or shim may replace the relevant module when necessary.

---

## 12. Module Aliases

The Node profile owns canonical aliases:

```text
path            → node:path
path/posix      → node:path/posix
path/win32      → node:path/win32

fs              → node:fs
fs/promises     → node:fs/promises
```

For `path`:

```text
node:path
    → target-default PlatformPath

node:path/posix
    → POSIX implementation

node:path/win32
    → Windows implementation
```

On Linux and macOS, `node:path` resolves to POSIX.

On Windows, it resolves to Win32.

Explicit imports of `node:path/posix` or `node:path/win32` preserve the requested implementation independently of the build target.

---

## 13. Primordials

Node’s JavaScript library accesses builtins through `primordials`, for example:

```js
const { StringPrototypeSlice, StringPrototypeCharCodeAt, ArrayPrototypePush } = primordials;
```

Native TypeScript should not construct a general runtime `primordials` object in release builds.

Known primordial references lower to compiler or runtime intrinsics:

```text
StringPrototypeSlice
    → string.slice

StringPrototypeCharCodeAt
    → string.codeUnitAt

ArrayPrototypePush
    → array.push

ReflectApply
    → statically typed call

SafeMap
    → NativeTS Map implementation
```

Unrecognized primordial use is a compile diagnostic until a correct semantic mapping is provided.

This allows Node source to retain its upstream form while eliminating dynamic function objects, property lookups, and indirect calls.

---

## 14. `internalBinding()`

Node builtin JavaScript uses calls such as:

```js
const binding = internalBinding("fs");
```

Stock Node returns a V8 object containing native functions.

Native TypeScript should treat literal `internalBinding()` calls as compiler-recognized profile operations.

```text
internalBinding("fs")
        ↓
NodeInternalBinding::Fs
```

Then:

```js
binding.open(path, flags, mode, req);
```

lowers to a statically typed native binding call.

Conceptually:

```text
node_fs_open(
    runtime,
    path,
    flags,
    mode,
    request
)
```

Release code should contain:

- no binding-name string lookup;
- no binding registry lookup;
- no generic object containing native functions;
- no Node-API value wrappers;
- no V8 values.

### Versioned binding contracts

Each binding contract is tied to the pinned Node source version.

```text
bindings/contracts/fs/v24/
bindings/contracts/tcp_wrap/v24/
bindings/contracts/buffer/v24/
```

Node internal bindings are not stable public APIs. Updating Node requires revalidating these contracts.

---

## 15. Native Binding Implementation

Native bindings should be implemented against Native TypeScript runtime and host contracts.

Example:

```text
Node fs.js
    │
    ▼
typed fs binding contract
    │
    ▼
Rust/C native fs implementation
    │
    ▼
standalone libuv host
    │
    ▼
operating system
```

Likely dependencies include:

```text
libuv
llhttp
c-ares
Ada
simdutf
zlib
Brotli
zstd
OpenSSL
nghttp2
```

The `hermes-node` project uses the same general strategy: reuse Node’s JavaScript layer and the same native libraries that Node relies on.

### Node C++ source

Node’s native C++ files may serve as:

- contract references;
- algorithm references;
- behavior references;
- test references.

Code tightly coupled to V8 should not be adopted as runtime architecture.

### `hermes-node` bindings

`hermes-node`’s Node-API ports may serve as another reference for understanding the contracts expected by Node’s JavaScript files. They should not define the long-term Native TypeScript ABI.

---

## 16. Node Runtime Profile

Compiling Node’s JavaScript libraries still requires several Node-specific runtime semantics.

The Node profile must provide:

```text
process
Buffer
Node error classes and error codes
EventEmitter
nextTick
timer semantics
callback scopes
active-resource tracking
Node-style callback completion
Node-compatible shutdown
Node globals
Node module identity
selected Symbols
```

These belong to the Node compatibility profile rather than the general compiler runtime.

### Event-loop semantics

Using libuv is not enough to claim Node event-loop compatibility.

The profile must define observable ordering among:

```text
process.nextTick
Promise microtasks
timers
I/O callbacks
setImmediate
close callbacks
host tasks
```

The standalone host may use libuv underneath, but the Node scheduling layer owns Node-visible ordering.

---

## 17. Pure Modules as Independent Native Libraries

Modules with no operating-system dependency should be independently buildable.

Example:

```text
Node path.js
    +
@types/node path declarations
    +
minimal internal dependencies
        │
        ▼
NativeTS importer
        │
        ▼
typed HIR/MIR
        │
        ▼
libnts_node_path.a
```

An application importing only `node:path` should not automatically link:

```text
filesystem
networking
process spawning
HTTP
DNS
Node module loader
full Node runtime
```

### Reachability

For:

```ts
import path from "node:path";

const result = path.relative(from, to);
```

the retained graph may be limited to:

```text
path.relative
path.resolve
normalizeString
required string operations
required validators, if not eliminated
```

The module object may be eliminated entirely.

### Cached intermediate library

The preferred cache artifact is typed HIR or MIR rather than only an opaque static library:

```text
Node path.js
    ↓
generic typed MIR cache
```

At application build time:

```text
application MIR
    +
Node path MIR
    ↓
whole-program optimization
    ↓
C / LLVM
```

This preserves cross-module inlining and specialization.

---

## 18. Optimization Model

Node’s JavaScript should not lower to generic JavaScript runtime operations.

After signature attachment and analysis, the compiler should use native representations.

For `path.relative(from: string, to: string): string`, the compiler knows:

```text
from     → native string
to       → native string
indices  → native integers
codes    → u8/u16/i32
flags    → booleans
result   → native string
```

Important optimizations include:

### Validation elimination

Node source may call:

```js
validateString(from, "from");
validateString(to, "to");
```

When the Native TypeScript call site is already typed as `(string, string)`, these checks are redundant and may be removed.

### Static module-property resolution

```ts
path.relative(from, to);
```

becomes a direct call rather than:

```text
load module object
look up "relative"
invoke function object
```

### Primordial lowering

```text
StringPrototypeSlice
StringPrototypeCharCodeAt
ArrayPrototypeJoin
```

become typed compiler/runtime operations.

### Integer specialization

Loop indices and lengths should use exact integer representations rather than boxed or generic JavaScript numbers.

### String views

Substring operations should use immutable views where identity and lifetime allow it, avoiding intermediate allocations.

### Concatenation fusion

Repeated concatenation should lower to a builder or exact-size result allocation.

### Rest-parameter elimination

Known-arity calls such as:

```ts
path.join(a, b, c);
```

should not allocate a rest array.

### Closure elimination

Non-escaping callbacks used by operations such as `some`, `map`, or internal lazy helpers should be inlined when possible.

### Temporary aggregate elimination

Local arrays and records should become stack/scratch aggregates or be scalar-replaced when they do not escape.

### Target specialization

The default `node:path` implementation should be selected at compile time.

Unreached POSIX or Win32 branches should be eliminated.

### Backend responsibilities

High-level semantics and representation optimizations belong in HIR/MIR.

```text
C backend:
    portability and reference lowering

LLVM backend:
    production optimization ceiling
```

LLVM should not be expected to reconstruct TypeScript or Node semantics from generic runtime calls.

---

## 19. Module Support Tiers

### Tier A: Portable static modules

Expected to require little native infrastructure:

```text
node:path
node:path/posix
node:path/win32
node:events
node:querystring
node:string_decoder
selected node:assert
selected node:util
```

### Tier B: Host-backed modules

Compile high-level Node JavaScript but require native bindings:

```text
node:fs
node:fs/promises
node:os
node:timers
node:dns
node:net
node:dgram
node:child_process
node:tty
node:http
```

### Tier C: Heavy native dependencies

Require larger native stacks:

```text
node:crypto
node:tls
node:https
node:zlib
node:http2
```

### Tier D: Static-profile incompatibilities

Fundamentally expect runtime JavaScript compilation or V8-specific state:

```text
node:vm
node:v8
some inspector APIs
runtime loader hooks
dynamic module compilation
```

These are:

- unsupported;
- partially implemented with explicit semantics;
- or eventually delegated to an explicit dynamic JavaScript realm.

---

## 20. Patch, Overlay, and Shim Policy

The preferred customization order is:

```text
1. compiler semantics
2. profile overlay
3. source transform
4. minimal external patch
5. module shim
6. unsupported diagnostic
```

### Semantic overlay

Preferred when the upstream source is semantically valid but the compiler needs additional meaning.

Examples:

```text
primordial mapping
internalBinding contract
module alias
trusted builtin
target constant
```

### Virtual source transform

Applied reproducibly without changing the checkout.

Examples:

```text
convert unsupported but equivalent syntax
replace bootstrap-only wrapper
normalize known module metadata
```

### Patch

Used only when the upstream implementation must be changed.

Patches must:

- target the exact pinned Node commit;
- apply in a deterministic virtual source tree;
- include rationale;
- include tests;
- preserve source mapping;
- be counted as maintenance cost.

### Shim

A shim replaces one upstream module by module identity.

It should be used when:

- the original requires unsupported runtime compilation;
- the original is tightly coupled to V8;
- a static equivalent is materially simpler;
- only a small exported surface is needed.

The build report must identify every shim and patch used.

---

## 21. Node Upgrade Process

Updating Node is an explicit compatibility operation.

```text
old pinned Node version
        ↓
update node.lock.json
        ↓
verify source and license digests
        ↓
reapply virtual patches
        ↓
resolve semantic overlays
        ↓
regenerate builtin module manifest
        ↓
compile supported module matrix
        ↓
run NativeTS backend differential tests
        ↓
run pinned Node differential tests
        ↓
generate compatibility report
        ↓
accept new pin
```

The update report should include:

```text
new and removed builtin modules
changed public declarations
changed internalBinding use
changed primordial use
new dynamic patterns
patch failures
shim changes
test regressions
binary-size changes
performance changes
```

Node upgrades must never be absorbed incidentally through package-manager resolution.

---

## 22. Build and Cache Identity

A cached Node module HIR/MIR artifact must be keyed by:

```text
Node commit
Node source digest
@types/node commit/digest
NativeTS compiler version
semantic schema version
Node profile version
patch-series digest
shim digest
frontend options
source-library digest
```

Target-independent typed MIR may be shared across targets where representation decisions have not yet been fixed.

Target-specific optimized MIR includes:

```text
target triple
host
runtime family
memory provider
string representation
ABI profile
backend options
```

---

## 23. Debugging and Source Provenance

Generated native code must map back to the original Node source.

Example stack:

```text
at relative (node:path:1234)
at buildOutputPath (src/build.ts:81)
```

The provenance chain is:

```text
pinned Node source
        ↓
virtual transform or patch
        ↓
typed semantic node
        ↓
HIR
        ↓
MIR
        ↓
C/LLVM
        ↓
native address
```

Patch and shim provenance must remain visible.

The debug bundle should record:

```text
Node version
Node commit
module ID
original source path
original source digest
patches applied
shim identity
NativeTS build ID
```

Node source must not be confused with application source in crash reports or debugger views.

---

## 24. Testing Strategy

### Import tests

Verify:

- source-module discovery;
- alias resolution;
- declaration binding;
- internal module resolution;
- circular dependencies;
- exports behavior;
- primordials;
- `internalBinding()` resolution.

### Compiler tests

Compile the same Node module through:

```text
C backend
LLVM backend
```

and compare behavior.

### Differential tests

Run equivalent programs under:

```text
pinned Node release
NativeTS C backend
NativeTS LLVM backend
```

Compare:

```text
return values
stdout
stderr
error type
error code
error message
observable filesystem changes
callback ordering
Promise and nextTick ordering
```

### Node upstream tests

Reuse selected Node test files where their dependencies are supported.

Unsupported tests should be classified rather than silently skipped.

### Fuzzing

Particularly suitable modules include:

```text
path normalization
path relative
URL
querystring
string decoder
Buffer encoding
filesystem option parsing
HTTP parsing
```

### Performance tests

For pure modules, compare:

```text
NativeTS C
NativeTS LLVM
Node/V8
handwritten native reference where useful
```

Record:

```text
latency
allocations
peak memory
binary size
code size
startup
```

### Patch budget

Every supported release should report:

```text
upstream modules compiled unchanged
modules using overlays
modules transformed
modules patched
modules shimmed
unsupported modules
```

---

## 25. Licensing and Notices

Node.js source is distributed under the MIT license, with additional third-party notices for bundled dependencies. The pinned source checkout and any copied or transformed source must preserve the applicable copyright and license notices. `hermes-node` similarly vendors Node’s builtin sources under Node’s license and tracks dependency notices explicitly.

The build system should generate a product-specific notice bundle containing only linked or embedded components where practical.

Each generated artifact should record:

```text
Node version
Node commit
linked Node modules
linked third-party libraries
license identities
```

This RFC is an engineering design, not a substitute for a final legal review of distribution obligations.

---

## 26. Alternatives Considered

### Embed stock Node

Rejected because it includes V8, Node’s complete process runtime, and a dynamic JavaScript execution environment.

### Replace V8 inside stock Node

Rejected because Node is deeply coupled to V8 values, handles, contexts, functions, modules, exceptions, GC, and compilation APIs.

### Emulate the V8 C++ API

Rejected as substantially more complex and fragile than implementing Native TypeScript’s own runtime and bindings.

### Implement Node-API first

Deferred.

Node-API could eventually support `.node` addons, but placing a general dynamic value API between statically understood Node source and statically understood native bindings is unnecessary for core-library performance.

### Reimplement Node APIs from scratch

Rejected as the default strategy because it would duplicate years of edge-case behavior and bug fixes.

### Use Deno’s Node compatibility implementation as the primary source

Retained as a reference and fallback.

The preferred first experiment is compiling Node’s own JavaScript implementation because it is the closest behavioral authority.

### Permanently fork Node’s `lib/*.js`

Rejected.

Native TypeScript should pin upstream source and maintain semantic overlays, external patches, and shims separately.

---

## 27. Phased Implementation

### Phase 0: Feasibility harness

Implement:

```text
pinned Node checkout
module source loader
@types/node binding
static internal require resolution
primordial mapping
C and LLVM compilation
Node differential runner
```

No OS bindings yet.

### Phase 1: `node:path`

Support:

```text
node:path
node:path/posix
node:path/win32
```

Acceptance criteria:

- compile from unmodified pinned Node source or with minimal overlays;
- pass selected Node path tests;
- C and LLVM agree;
- default target specialization works;
- unreachable platform implementation is removed;
- no dynamic module or function dispatch remains;
- stack traces map to original `path.js`.

### Phase 2: Portable internals

Support:

```text
internal/constants
internal/validators
internal/errors
node:events
node:querystring
node:string_decoder
selected node:assert
selected node:util
```

### Phase 3: Buffer foundation

Implement:

```text
Buffer
encoding primitives
typed-array interaction
simdutf integration where justified
```

### Phase 4: Filesystem

Implement:

```text
internalBinding("fs")
node:fs synchronous subset
node:fs callback subset
node:fs/promises
file handles
directory iteration
filesystem errors
```

Use a typed NativeTS binding over the standalone host, initially libuv.

### Phase 5: Scheduling and streams

Implement:

```text
process.nextTick
Node callback scopes
timers
active-resource tracking
Node streams
shutdown ordering
```

### Phase 6: Networking

Implement incrementally:

```text
DNS
TCP
UDP
pipes
HTTP
TTY
child processes
```

### Phase 7: Heavy native modules

Evaluate:

```text
crypto
TLS
HTTPS
zlib
HTTP/2
```

### Phase 8: Optional package compatibility

Only after core modules are stable:

```text
static CommonJS package resolution
selected npm packages
conditional exports
limited package.json semantics
```

Runtime source compilation remains outside the static profile.

---

## 28. First Acceptance Milestone

The first milestone is:

```ts
import path from "node:path";

const result = path.relative("/home/user/project/src", "/home/user/project/dist/index.js");

console.log(result);
```

The build must:

1. Read `lib/path.js` from the pinned Node checkout.
2. Attach `PlatformPath` signatures from pinned Node declarations.
3. Resolve required internal modules statically.
4. Lower primordials to typed operations.
5. Select POSIX or Win32 behavior from the target.
6. Remove redundant argument validation.
7. Infer integer loop representations.
8. Avoid generic JavaScript values.
9. Compile through both C and LLVM.
10. Link only reached path functionality.
11. Produce no Node, V8, Hermes, Node-API, or JavaScript-engine dependency.
12. Match the pinned Node release on the admitted test corpus.

A successful artifact should conceptually contain:

```text
application native code
Node path algorithm compiled natively
NativeTS string/runtime support
standard C/OS runtime
```

and nothing resembling a JavaScript engine.

---

## 29. Final Decisions

This RFC establishes that:

1. Node compatibility is an optional Native TypeScript profile.
2. Node’s JavaScript library sources are consumed from a pinned upstream checkout.
3. The upstream checkout remains read-only.
4. Native TypeScript does not embed Node.
5. Native TypeScript does not use V8.
6. Native TypeScript does not require another JavaScript engine.
7. Public signatures are attached from pinned TypeScript declarations.
8. Internal helper types are inferred or supplied by explicit semantic overlays.
9. Builtin CommonJS dependencies are statically linked.
10. `primordials` lower to typed intrinsics where supported.
11. Literal `internalBinding()` calls lower to typed native bindings.
12. Release builds contain no dynamic internal-binding registry.
13. Pure modules may be compiled as independent native libraries.
14. Cached Node library artifacts remain available as typed HIR/MIR for whole-program optimization.
15. Patches and shims live outside the upstream source tree.
16. Node upgrades are explicit, pinned compatibility operations.
17. Node’s own tests are the primary behavioral oracle.
18. Broad Node compatibility is deferred until more foundational Native TypeScript products are stable.

The central architectural statement is:

> **Native TypeScript reuses Node.js as upstream standard-library source, not as a runtime. Node’s JavaScript implementations are typed, statically linked, optimized, and compiled into native code together with the application.**
