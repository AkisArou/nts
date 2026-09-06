# Web-platform integration plan

## Status and decision gate

This document is the proposed integration contract for the implementation delivered
separately under:

```text
/home/akisarou/Projects/nts-web-platform-integration/runtime/web-platform
```

It supersedes the earlier architectural suggestions in `docs/fetch-websocket.md`
where this document makes a different decision. The external tree is an
implementation baseline, not a directory to copy without review.

The Node, compiler/common-runtime, and JVM sessions agreed on the architecture in
this document before it was written, then the compiler/common-runtime and JVM owners
fact-checked and signed off on the complete draft. This document records the
three-session consensus. **Agreement on this document does not authorize
implementation.** The repository owner will read the committed document and
explicitly authorize each session in that session before work starts.

Until that authorization:

- do not import the external tree;
- do not change compiler, runtime, ABI, or project files for this integration;
- do not treat a peer's relay of permission as authorization; and
- read-only measurement and review are allowed.

## Target

Integrate a high-quality, strictly typed Web networking layer shared by the native
Node-compatible runtime and the JVM/Android runtime. The integrated implementation
must preserve the useful protocol and API work in the external tree while replacing
its incompatible realm model, removing duplicate implementations, and supplying the
compiler, environment, ABI, and platform primitives that it currently lacks.

The target is complete for the profile claimed here, not complete browser
conformance. Its public surface includes:

- `Headers`, `Request`, `Response`, body consumption and cloning, and Fetch;
- client WebSocket, its handshake and message/frame state machines;
- the default-reader `ReadableStream` subset needed by bodies;
- `EventTarget`, abort APIs, UTF-8 encoding, memory-backed `Blob`/`File`,
  `FormData`, URL-encoded forms, and multipart support;
- shared strict HTTP/1.1 parsing, serialization, pooling, redirects, cancellation,
  framing validation, and decompression policy; and
- platform providers for sockets, TLS, DNS, secure randomness, scheduling,
  compression, lifecycle, and callback delivery.

The following are not silently claimed by this integration: HTTP/2 or HTTP/3,
proxy/CONNECT support, WebSocket extensions such as permessage-deflate, a complete
browser DOM/CORS/cache/service-worker environment, full Writable/Transform/BYOB
Streams, a public WebSocket server, disk-backed Blob storage, or complete Web-IDL
coercion and exotic-object behavior. These remain visible in a conformance ledger.
Any feature excluded only because the compiler does not support it yet is a
dependency, not a permanent profile difference.

## Evidence at the planning baseline

Three labels are used throughout this work:

- **Measured here** means the actual NTS repository, relevant lane, harness,
  machine, and named commit.
- **Measured elsewhere** means useful evidence from a different context, such as
  the external author's host environment or a modified reference program.
- **Argued** means a design or instruction-count prediction that has not been
  measured in the relevant context.

Do not turn an argued result into a performance claim. Do not turn host execution
into evidence that NTS-compiled code runs.

### External implementation evidence

The delivered tree contains 77 files. Its checksum manifest was verified locally
before review. Its recorded results are **measured elsewhere**:

| Check | Recorded result | What it proves |
|---|---:|---|
| Strict TypeScript checks | pass | The shared source can be checked without DOM or Node ambient globals in the author's setup. |
| Node-host tests | 80/80 | The algorithms and Node-host primitive adapter passed the delivered deterministic and live-network tests on Node 22.16.0. |
| Java primitive tests | 11/11 | The delivered Java socket/TLS implementation passed its desktop-JVM tests. |
| Structural TypeScript audit | 31 files, 0 findings | The particular forbidden constructs scanned by that audit were absent. |
| Two unchanged WPT Headers files | 8/9 | Eight assertions passed; dictionary-style `Headers` initialization remained visibly unsupported. |

These runs did not compile TypeScript through NTS, did not run the pinned Node
24.20.0 suite, did not run Android SDK/D8/R8 or a device, and did not run full WPT
or Autobahn. The counts remain useful evidence but are not a definition of done.

### NTS compiler evidence

The JVM owner checked the shared source against repository commit `74b9de9`, with
the incompatible realm/index entry excluded:

| Result | Count |
|---|---:|
| Primary lowering refusals (`NTS1001`) | 179 |
| Cascades (`NTS1003`) | 52 |
| JVM-backend refusals (`NTS4xxx`) | 0 |

Including `realm.ts` did not produce valid HIR: `RealmRequest -> Request` and
`RealmResponse -> Response` violated base-first layout and produced `BrokenBase`.
The 179 messages are not 179 independent features. They include clusters belonging
to the iteration protocol, regular expressions, Promise executor closures, a small
number of representation arms, and several missing declaration walks. Rebaseline
these results at the implementation-start commit rather than assuming the counts are
frozen.

### Current typed-array performance baseline

The JVM owner measured these rows under the repository benchmark lock at `74b9de9`:

| Case | NTS JVM | Java | JVM/Java |
|---|---:|---:|---:|
| arrays | 1.42 us | 1.38 us | 1.02x |
| bytes | 752.71 us | 688.08 us | 1.09x |
| elementwise | 61.05 us | 58.46 us | 1.04x |
| node-utf8 | 39.09 us | 7.43 us | 5.26x |

The `bytes` row published at 1.01x in the last full run and measured 1.09x in this
filtered run, with the same binary and machine. That difference is inside the
documented resolution band (roughly eight percent), so there is **no direction
claim**. Any before/after typed-array conclusion must move beyond the resolution of
the relevant row and be repeated in the same context.

The protected current surface includes all eight ordinary numeric typed-array
widths in `examples/typed-arrays`, typed-array subclass examples, and the `bytes`
and `node-utf8` benchmarks. `DataView` and `ArrayBuffer` have no passing example
coverage yet even though `runtime/node` uses them extensively.

## Architecture

```text
Canonical typed Web APIs and semantics                 runtime/web-platform
        |
Shared Fetch, HTTP/1.1 and WebSocket protocols         runtime/web-platform
        |
Typed sockets/TLS/random/scheduler/compression ports   runtime/web-platform
        |
        +-- native Node-compatible provider            runtime/node + runtime/c
        +-- JVM/Android provider                        runtime/jvm + Android Java
        +-- Node-host and in-memory test providers      test/tooling only
```

The shared TypeScript layer owns observable algorithms and state machines. Platform
providers own operations that genuinely cross into an operating system, trust
store, event loop, compression engine, or cryptographic primitive. Performance is
obtained through static lowering and narrow native primitives, not by moving typed
protocol algorithms wholesale into C or Java.

The shared implementation retains raw HTTP/1.1 over `ByteConnection` on both native
and JVM providers. A platform HTTP client is not the default transport: automatic
redirects, decompression, HTTP/2 negotiation, header rewriting, connection policy,
and Android-version-dependent behavior would make Node-oracle comparison unreliable.
A platform client may be considered later behind an explicit flag only after a
differential corpus proves its observable agreement.

The Node-host adapter may use `node:net`, `node:tls`, `node:crypto`, timers, and zlib
as test primitives. It must not delegate production Fetch/WebSocket semantics to
host `fetch`, host `WebSocket`, Undici, `node:http`, or `node:https`. The native
Node-compatible provider is separate and must use the NTS environment and native
ABI; passing Node-host tests does not implement that provider.

## Canonical ownership and deduplication

There will be one canonical implementation of each Web value. `runtime/node` imports
and reexports the canonical value exactly. It must not preserve compatibility by
wrapping, copying, subclassing, rebinding, or manufacturing a second constructor.

| Surface | Final ownership and action |
|---|---|
| `URL` and live `URLSearchParams` | Promote/refactor the existing typed `runtime/node/url` implementation into shared ownership. Remove the external reverse adapter and its simplified divergent parser. Node reexports the shared constructors. |
| `Blob` and `File` | Start from the richer existing Node implementation, promote its platform-independent storage and semantics into shared ownership, and reconcile external multipart/body needs there. Node object-URL registration remains Node-specific. |
| `TextEncoder` and `TextDecoder` | Strengthen the external typed UTF-8 implementation as the shared canonical implementation. Node `util` reexports the same values. Encoding streams are separate unfinished work. |
| `Event`, `EventTarget`, `MessageEvent`, `CloseEvent`, abort APIs | Use the external typed implementation as a starting point and reconcile it with existing Node listener/error behavior. Node modules reexport the same constructors where Node does. Fix strong-parent retention for long-lived `AbortSignal.any` use; do not hide it behind a host weak-reference fallback. |
| `ReadableStream` | Shared Web stream, distinct from Node classic streams. Complete the body-required default-reader contract first and extend it as conformance requires. Node adapters bridge explicitly rather than confusing the two stream models. |
| `Headers`, `Request`, `Response`, `FormData`, Fetch, WebSocket | New shared canonical implementations based on the external tree, refactored to project conventions and tested against applicable standards/Node behavior. |
| HTTP/1.1 transport and pool | Keep the strict shared Fetch transport initially. Do not merge it into Node's public `http` module merely because both speak HTTP; deduplicate only codec or validation pieces proven to have identical policy. |

Identity tests must cover every surface exposed both globally and from a Node module,
including at least `Blob`, `URLSearchParams`, `TextEncoder`, `TextDecoder`,
`WebSocket`, `CloseEvent`, and `MessageEvent` where the pinned Node version exposes
them.

## No runtime realms and no compiled `globalThis`

Delete/refactor the external `realm.ts` before the imported tree becomes a root
project or NTS entry point. Per-call `RealmRequest`, `RealmResponse`, and sibling
constructor families conflict with base-first layout, create the wrong identity,
and attempt a realm/prototype model that is a permanent Section 13 non-goal.

The replacement is:

- top-level canonical classes and functions;
- a `WebPlatformRuntime` instance containing transports, policy, scheduler,
  connection pools, open sessions, and `close()` state; and
- explicit clients/runtime instances in tests when isolation is needed.

There is one semantic top-level constructor family per compiled process today.
Provider wrappers may be environment-local because values such as `napi_value`
cannot cross environments, but a global and module reexport in the same environment
must be the exact same value.

Bootstrap is provider code outside compiled TypeScript. A Node N-API/native bootstrap
creates environment-local wrappers and installs the statically known Web globals;
other providers expose the same canonical symbols through their bootstrap. Shared
compiled TypeScript imports and reexports them directly. It does not read, enumerate,
index, or assign a mutable global object. `globalThis` as a value remains a Section
13 non-goal; this integration does not introduce a property map or metaobject
protocol.

`bindings.node.mjs` or equivalent host glue may load the generated addon, expose
writable CommonJS properties, and perform provider bootstrap. It is glue, not the
implementation of Fetch, WebSocket, HTTP, or Web classes, and it must not become a
host-delegation escape hatch. This boundary already matches the repository: 327 of
360 `globalThis` assignments are in host `.mjs` files, while zero are in compiled
TypeScript.

## Environment and event-loop contract

The present C runtime and JVM loop both hold semantic state in process-wide/static
storage. The C runtime has file-scope host, queue, depth, allocator, and collector
state; a second `nts_host_install` silently overwrites the first. The JVM loop has
static queues/depth/time and no cross-thread completion entry. These are two symptoms
of the same missing common-runtime environment seam.

The common environment contract is:

1. An environment owns its host capabilities, task/microtask queues, recursion
   depth, external-work liveness, close state, and Web-platform runtime. Allocation
   and collector roots are environment-owned where the provider has them. `NoGc`
   has no NTS collector roots on either lane: the JVM relies on the platform
   collector, while the C `NoGc` provider is a bump allocator that never frees and
   must not be selected silently for a general application. Its allocator state is
   still environment-owned.
2. Exactly one owner lane mutates ordinary environment state. Foreign I/O threads
   may only publish reserved completions and hold provider-owned environment
   lifetime; they never invoke TypeScript directly.
3. Host entry, exported-function entry, and callback delivery use a scoped
   enter/leave operation for the current environment. Delivery performs the
   owner-lane microtask checkpoint required by the language semantics.
4. External liveness is acquired before work is launched and released exactly once
   when that work is delivered, cancelled, or dropped during close. Close rejects
   new work and safely handles late completions.
5. A standalone provider may construct one default environment, but ABI and
   semantic data are not process-global. The mechanism by which generated/runtime
   code finds or captures its environment is provider-owned and measured; the
   contract does not prescribe TLS, `ThreadLocal`, threaded parameters, or frame
   fields. Scoped state must be restored/cleared on leave and close so an owner
   thread cannot retain a closed Android environment.
6. An environment chooses a time mode at construction. Deterministic oracle tests
   use virtual time. Real external-I/O liveness tests use a monotonic clock. Every
   test states its mode; network activity never silently advances virtual time.
7. Immutable process-wide tables are permitted; mutable diagnostic counters are
   per-environment. A process-wide diagnostic query sums environments at a defined
   safe point, preserving the memory harness and differential leak detector without
   adding an atomic/locked instruction to every allocation, retain, or release. No
   counter or object reference count becomes atomic: exactly one owner lane touches
   an environment's heap, and managed references never cross environments. A
   concurrent diagnostic snapshot must coordinate with owner lanes rather than race
   their plain counters. Diagnostics never affect program semantics, ownership,
   scheduling, capabilities, lifecycle, or close. The existing 61 memory cases,
   eight C runtime tests (of 13 test files), and differential leak check keep their
   process-wide observation contract through aggregation on read.

The environment seam therefore enforces an existing performance premise rather
than adding a new one: `nts_retain` and the diagnostic hot paths already use plain,
non-atomic increments on the RFC 17.1 assumption that one runtime owns its heap. The
environment and owner-lane invariants make that assumption mechanically true.

This extends an existing `NtsTask` ownership rule rather than inventing an unrelated
one. A queued task owns its managed state/closure reference, and every host must
eventually run or drop it. A one-shot task consumes that ownership when it runs; a
repeating task holds it across invocations and returns it only when dropped. Releasing
a repeating callback after each invocation can free it underneath the still-active
handle while leaving aggregate traces apparently balanced, so this rule is part of
correctness rather than an implementation detail. The current JVM timer already
follows it: its timer object retains the callback for the handle lifetime and removes
the timer/callback references on terminal retirement. Tests protect that behavior
from a future per-invocation-release "optimization."

### Completion reservations

A bounded completion inbox is a correctness requirement, not merely a memory
optimization:

1. Reserve completion storage/credit before launching one-shot work or arming a
   repeating source. Allocation is permitted while reserving. If credit is not
   available, reject, delay, or apply platform backpressure before OS work exists.
2. Posting a completion against a valid reservation is nonblocking and cannot fail,
   drop, allocate, or create unbounded hidden storage. This specifies *when* storage
   is acquired without prescribing an array, ring, or linked data structure.
3. One-shot work reserves one completion credit, acquires one liveness unit, and
   owns the callback reference required to deliver it. Delivery, cancellation, or
   close-time drop returns all three obligations exactly once. Running the one-shot
   callback consumes its callback ownership under the existing `NtsTask` rule.
4. Every repeating API specifies an observable backlog rule matching Node/the
   relevant standard. Intervals coalesce missed deadlines and rearm rather than
   replaying every missed tick. A non-coalescible event stream uses an explicitly
   bounded credit window and platform backpressure; queue policy is never selected
   merely for implementation convenience. A repeating handle holds one liveness
   unit and its callback reference for its lifetime, not one per notification; only
   terminal close/cancel/drop returns them.
5. Close stops new reservations, retires repeating sources, drains or explicitly
   drops already-reserved completions, and returns every completion credit,
   liveness unit, and callback reference. A zero liveness count alone is not proof
   that callback ownership or reserved storage was returned.
6. Saturation tests must prove normal progress. A sabotage test deliberately breaks
   the credit/release invariant and must fail or time out. This depends on preserving
   the differential harness's distinct `TimedOut` verdict; a timeout must never be
   reclassified as a clean refusal/decline. A separate memory/lifetime sabotage
   releases a repeating callback per event instead of at terminal drop and must be
   caught by an observation at the lifetime boundary rather than relying on a crash
   or AddressSanitizer. The `TimedOut` verdict is a contract owned by the JVM/
   differential lane and may not be reclassified without first replacing every
   sabotage assertion that depends on it with an equally visible failure signal.

Reference-count arithmetic is not a cross-provider proof of retirement. A provider
that does not emit reference counting—the JVM lane and the C lane under `NoGc`—has
no retain/release evidence to inspect. JVM callback ownership and completion-storage
retirement are verified through reachability: retain a weak reference in the test,
close the source and environment, force/await collection under a bounded test
protocol, and assert that it clears. C `NoGc` never frees its bump allocation and
therefore cannot prove deallocation or balanced ownership; it verifies functional
source/task retirement, while the corresponding ownership proof runs under the C/
LLVM reference-counting provider. An empty provider-specific diagnostic-counter set
never means there is no ownership invariant to verify.

## Typed arrays, `ArrayBuffer`, and `DataView`

The current lowering explicitly models a typed array as an owning fixed-width array,
not as a view. On the JVM, `Uint8Array` is currently an `int[]`, with four times the
storage expected at a byte ABI and no shared `buffer`/`byteOffset` model. `subarray`,
`slice`, and `set` are refused in the external source. This is a compiler/runtime
representation gap; source-level offset arithmetic or forced copies are not an
acceptable integration workaround.

The new semantic contract is:

- ordinary `Array<T>` keeps its existing inline, 16-byte-aligned representation;
- typed arrays use a distinct view representation;
- all views of an `ArrayBuffer` observe one shared backing and alias exactly;
- `byteOffset`, `byteLength`, `buffer`, `subarray`, overlapping `set`, and isolating
  `slice` have their specified observable behavior;
- the backing lifetime is provider-owned: C/LLVM may use native ownership while JVM
  uses ordinary collector references and never introduces a second NTS GC;
- all typed widths currently used by the repository remain correct;
- a user class extending a typed array remains one object and may add fields/methods
  while preserving base-first layout; and
- `DataView` has endian-aware typed access over the same backing.

The contract deliberately does not prescribe `byte[]`, `ByteBuffer`, a native C
layout, or compiler-synthesized wide loads. Each provider chooses and measures its
mechanism. On the JVM, direct byte storage, synthesized wide access, and selected
helpers are candidates, not decisions. Instruction counting such as “eight byte
loads for a `Float64Array` element” is **argued**, not a benchmark.

Before choosing and landing a representation, record the distinct current floors at
`74b9de9`: LLVM 113, LLVM-RC 113, and JVM 112 in the backend gate; 41
`bench-agree` cases; and 61 memory cases. The separate examples step has no numeric
floor: every comparable example must agree, so its requirement automatically scales
with the corpus. There are 124 example directories at this baseline, which is not
itself a lane floor. A direct planning-time JVM run found 112 of 113 comparable
examples agreeing; `async-finally` is the sole miss and needs the known
`nts_promise_reject_value` JVM runtime helper plus its fixed-external entry, not a new
design. Also record all typed-array examples across four lanes, `bytes`,
`elementwise`, `node-utf8`, and applicable `runtime/node` uses. After the change:

- all existing floors remain green;
- add `ArrayBuffer` and `DataView` examples;
- test all 256 byte patterns, signed and unsigned loads, every supported width,
  nested offsets, cross-view mutation, slice isolation, overlapping `set`, and ABI
  transfer/borrow lifetimes; and
- add sabotage proving that breaking aliasing makes the suite red.

Take before/after performance measurements under the exclusive lock only after the
candidate is stable. No provider mechanism is selected from an unmeasured prediction.

## Compiler and common-runtime prerequisites

These dependencies are in scope. Shared source is written in its intended final
form; it is not distorted to avoid a temporary compiler limitation.

1. **Environment seam.** Replace process-global semantic runtime state with the
   environment contract above across C/LLVM and JVM entry/callback paths. Move
   diagnostic counters into environments and preserve the process-wide harness view
   by aggregation on read at a safe point.
2. **Typed-array views.** Add the common HIR/runtime model and provider lowerings
   described above without changing ordinary arrays.
3. **Typed callback trampolines.** Generate one trampoline per callback signature.
   The trampoline is the call itself; an `NtsTask` is only cross-thread transport.
   The compiler owns the closure slot and environment entry, so neither is guessed
   or smuggled through an undeclared ABI argument.
4. **General class values.** Extend the existing immortal constructor-token model
   beyond the currently provided error classes so canonical Web classes can be used
   and reexported with exact identity.
5. **Iteration protocol.** Complete the planned synchronous/async iteration,
   generator, and stream-related lowering needed by the final source. Roughly thirty
   current refusal messages are different symptoms of this dependency. Ordinary
   iteration is not a Section 13 exclusion.
6. **Regular expressions.** Complete the existing AOT-compiled-regexp project using
   the vendored matcher design. At `74b9de9`, `runtime/node` alone contains 17
   distinct sites and 86 occurrences, and the external source adds seven. Replacing
   patterns with bespoke parsers only to make this package lower is not acceptable.
7. **Promise executor closures.** Permit the real captured resolver/executor shape;
   do not substitute a special Web-only promise API.
8. **Remaining lowering arms.** Close the measured nullable/absence representation,
   conditional, array-literal, declaration-walk, and method-shape gaps and record
   exact diagnostics as they move.

`globalThis` is intentionally absent from this list. Provider bootstrap supplies
statically known globals outside compiled TypeScript, preserving the existing
Section 13 boundary.

## Native Node-compatible provider and N-API

The native provider implements the shared ports through the existing NTS host and
libuv/native facilities. It does not run a Worker, create a hidden event loop, call
back on an I/O thread, or delegate to a host JavaScript implementation.

Required native primitives include:

- TCP and DNS with partial reads/writes, EOF, cancellation, and bounded work;
- TLS with SNI, certificate-chain and hostname verification, minimum-policy handling,
  native trust configuration, ALPN restricted appropriately for HTTP/1.1, and clean
  shutdown;
- secure randomness suitable for WebSocket masks and multipart boundaries;
- monotonic scheduling integrated with the active environment;
- gzip, zlib-wrapped deflate, and Brotli where the native decoder supports them; and
- explicit byte ownership: reads transfer stable owned bytes, writes borrow/pin a
  view until terminal completion, and every offset is accounted for exactly once.

Before changing callback codegen, the Node owner produces a checked, deduplicated
inventory of the native declarations (currently about 128) grouped by exact callback
signature and lifetime. The ABI then follows these rules:

- one-shot callback handles own their closure until terminal delivery or cancel,
  then release exactly once;
- repeating callback handles retain until handle close/cancel;
- invocation borrows the closure;
- drop/cancel is idempotent; and
- every trampoline captures/enters the correct environment and performs the required
  owner-lane checkpoint.

No generated constant guessed from object layout, invisible extra argument, generic
`void()` callback cast, or handwritten signature switch is accepted as the long-term
ABI.

## JVM and Android provider

There is no general Java binding facility today. TypeScript cannot name arbitrary
Java methods, and this project will not invent a broad `nts bind` feature merely to
connect networking. The agreed boundary is a small typed runtime-owned intrinsic
table (`nts_jvm_web_*` conceptually) whose TypeScript declarations state the real
ABI. This is the same fixed-external mechanism used by other runtime primitives,
not an inverted-control workaround.

The JVM owner supplies:

- fixed typed intrinsic descriptors for environment, object, callback, and byte-view
  arguments after their common types exist;
- stable `nts.rt` callback interfaces that matching generated closure classes
  implement, so Java-to-TypeScript calls do not name generated hash classes;
- an environment-instance loop, thread-safe wakeup/inbox, liveness and completion
  reservations, virtual/monotonic time modes, and owner-lane callback delivery;
- raw `Socket`/`SSLSocket` primitives behind `ByteConnection`, not a platform HTTP
  client with hidden policy;
- certificate validation, explicit HTTPS endpoint identification, SNI, Android
  cleartext-policy checks, secure randomness, deadlines, cancellation, and bounded
  executors; and
- provider byte-view transfer/borrow behavior matching the shared ownership ABI.

Java source is owned by the JVM lane from its first repository commit, even where it
lives below `runtime/web-platform/android`. It lands with the existing platform
ratchets: reproducible artifact, Java 8/class-file version 52, zero `invokedynamic`,
Android API 26 compatibility, and warnings/errors enforced. It must later pass SDK,
D8/R8, emulator/device, lifecycle, trust-policy, and network-transition tests.

Plain `Inflater` does not decode the gzip wrapper. Android/JVM gzip support therefore
requires a streaming gzip header/trailer state machine around raw inflation, including
CRC32 and ISIZE validation, or another reviewed streaming primitive with equivalent
behavior. Zlib-wrapped deflate is separate. Do not advertise `gzip`, `deflate`, or
`br` until that coding is actually decoded; request `identity` in the meantime.

Java callbacks are always asynchronous relative to the initiating call and always
delivered on the owning NTS lane. Shutdown first stops new work, then cancels and
settles platform operations, drains/drops their reserved completions, closes pools
and sessions, and only then releases the completion executor/environment. Late
success after abort is closed and discarded without entering a dead environment.

## Source import and project configuration

The import is a refactor, not an archive extraction:

- preserve and review `LICENSE`, `NOTICE`, source provenance, WPT license/hashes,
  and useful validation records;
- remove/quarantine `realm.ts` in the same first root-visible change;
- remove the reverse URL adapter as canonical URL ownership moves shared;
- adapt names, imports, formatting, strict types, and tests to repository conventions;
- retain useful host tests but clearly label their provider; and
- do not check in nested dependency installations or generated build output.

All TypeScript projects target ESNext and extend the root `tsconfig.base.json`. Add
one buildable `runtime/web-platform` aggregate to the root solution. Shared code is
checked without DOM or Node ambient globals. Host-only code uses explicit Node
imports/types. Add provider-specific NTS entry projects only when the emit tooling
needs a real compilation boundary; do not create another local base config or repeat
base settings. In a project whose sources are under `src`, do not override the
base's `${configDir}/src/**/*` include merely to spell `src` again.

Use the repository's pinned TypeScript 7.0.2 and `@types/node` 24.13.3 through the
root pnpm catalog, not the external package's TypeScript 5.8.3 / Node 25.1 setup.
The shared implementation must use its own typed interfaces for Web data, and Node
provider files may import official Node types explicitly. Do not copy Node interfaces
by hand when an exact imported type is appropriate, and do not add all Node ambient
globals to shared code merely to obtain one type.

The final TypeScript pass rejects `any`, `as never`, unchecked boundary assertions,
`Proxy`, `Reflect`, descriptor/prototype manipulation, dynamic receiver tricks, and
wrapper functions that exist only to compensate for missing compiler support.
Narrow boundary validation and checked discriminated unions replace casts. Planned
language features are used in final form and their exact compiler blocker is recorded.

## Ownership and implementation sequence

All sessions share one checkout and Git index. Commits use narrow explicit paths and
owners announce any overlap before editing it.

| Lane | Primary ownership for this integration |
|---|---|
| Node | `runtime/web-platform` shared TypeScript, host provider, and typed native-provider/N-API surface except JVM-owned Java; `runtime/node`; `tooling/conformance`; the relevant root TypeScript solution edits; shared API/Node/WPT tests. |
| Main/compiler | HIR/frontend; C and LLVM runtime/codegen and native primitives; common environment seam; typed-array common model; typed callback trampoline; language prerequisites; compiler gate and records. |
| JVM | JVM backend/emitter/runtime; Android Java from its first import; fixed networking intrinsics and stable callback interfaces; JVM/Android tests and deterministic benchmarks. |

After explicit authorization, sequence the work as follows:

1. **Freeze/recheck baselines.** Verify the external manifest, re-run its host tests
   without changing claims, remeasure the NTS refusal groups at the actual start
   commit, and record existing floors. No design is changed to make a number prettier.
2. **Land the root-visible shared shape.** Node imports/adapts the shared TypeScript,
   removes realms before root reference, establishes `WebPlatformRuntime`, preserves
   provenance, and begins canonical URL/Blob/event/encoding reconciliation. JVM owns
   any Android Java path from the first commit rather than accepting an intermediate
   unratcheted Java dump.
3. **Build common foundations.** Main implements the environment and typed-array
   contracts and typed callback trampolines. JVM implements matching provider
   representations/loop changes in coordinated commits. Existing floors and sabotage
   tests accompany each representation change.
4. **Close language dependencies.** Main implements iteration, regexp, Promise
   executor, general class values, and remaining measured lowering arms. Node keeps
   the source in final form and reports exact diagnostics; it does not add temporary
   substitute APIs.
5. **Implement providers in parallel.** Node lands the typed native-provider surface,
   `runtime/node` integration, and N-API bootstrap; Main lands the corresponding
   `runtime/c` socket/TLS/random/timer/compression primitives and ABI. JVM lands fixed
   intrinsics, raw Java I/O, compression, Android lifecycle, and callback delivery.
   Both platform providers consume the same typed shared ports and environment
   contract.
6. **Reconcile public Node modules and globals.** Promote duplicate implementations,
   make module exports and globals identical within an environment, and remove old
   copies only after applicable tests prove the canonical replacement.
7. **Conformance, sabotage, security, and performance.** Run the compiled lanes,
   expand upstream suites, fuzz protocol boundaries, exercise shutdown/races/trust,
   and only then take the batched exclusive performance measurements.

If a dependency blocks one lane, that lane records the exact blocker and continues
with independent review/tests rather than introducing an architectural workaround.

## Validation contract

### Shared deterministic tests

- In-memory/fake `ByteConnection`, deterministic randomness, and virtual time.
- Header/body/redirect/abort/error/event-order semantics.
- Incremental HTTP parsing across every boundary, conflicting framing, truncation,
  limits, pooling, cancellation, and partial I/O.
- WebSocket handshake, masks, fragmentation, control-frame interleaving, UTF-8,
  payload/fragment limits, buffered amount, close races, and failure close.
- Body clone/tee ownership, slow consumers, configured backlog limits, and
  materialization limits.
- Differential comparison to pinned Node for all applicable observable behavior.

### Native and Node validation

- The repository's pinned Node 24.20.0 applicable suites through the real
  conformance harness, including `--ts` and compiled N-API paths.
- Real TCP/TLS/WSS peers, partial progress, IPv4/IPv6, DNS/cancel races, trust and
  hostname failures, idle reuse, shutdown, and late completions.
- Tests that replace host `fetch`, `WebSocket`, `node:http`, and `node:https` with
  failing sentinels where those APIs must not be delegated.
- Constructor identity between globals and Node module exports.
- Callback/storage ownership is proved in the C/LLVM reference-counting lane;
  `NoGc` separately proves logical task/source retirement and is never treated as
  evidence of deallocation merely because its retain/release counters stay zero.
- Emit/HIR verification and the main gate without emitter panics.

### JVM and Android validation

- Actual TypeScript compiled to JVM invoking the fixed intrinsic ABI; host Java tests
  alone are insufficient.
- Wrong-environment/cross-thread sabotage, completion saturation, close liveness,
  virtual-vs-monotonic time, cancellation, and retained callback/byte ownership.
- Collector reachability coverage proving callbacks and completion storage become
  unreachable after terminal close, using weak references because this provider
  emits no reference counting.
- TLS SNI/hostname/trust sabotage, gzip CRC/trailer corruption, and unsupported
  encoding behavior.
- Java artifact reproducibility and platform ratchets, then release D8/R8 and API-26
  emulator/device coverage for lifecycle, Wi-Fi/cellular transitions, cleartext
  policy, private/debug CAs, background restrictions, slow peers, and DNS races.

### Upstream and robustness validation

- Run complete applicable WPT files with the real testharness/server; do not turn
  the delivered 8/9 subset into a pass by rewriting the dictionary case.
- Classify permanent Section 13 exclusions precisely (for example arbitrary dynamic
  dictionary property enumeration) and keep planned compiler features in the active
  suite.
- Add Autobahn client coverage for WebSocket and fuzz/incremental differential
  coverage for HTTP and frame codecs before production claims.
- Preserve visible failures and verify every sabotage test's precondition so a stale
  or skipped binary cannot make the sabotage appear green.

## Performance contract

Correctness and ownership come first, but the architecture must remain measurable.
Use deterministic pure workloads for comparable rows: HTTP parser, header
serialization, WebSocket frame codec, UTF-8, typed-array copy/view operations, and
body/clone ownership. Treat real-server throughput as a liveness/system measurement,
not a language microbenchmark.

Take final measurements once, batched under the repository's exclusive benchmark
lock with other sessions off the CPU. Report context, commit, distribution/resolution,
throughput/latency, CPU, peak and retained bytes, and open worker/socket counts. A
documentation performance claim requires a measured-here row; host-test durations
and instruction counts are not performance evidence.

## Definition of done

The integration is done only when all of the following are true:

- the shared source is canonical, strictly typed, root-solution checked, and free of
  realm/prototype/property-map/compiler-gap workarounds;
- every reachable shared integration entry produces valid HIR and the required
  native and JVM artifacts without primary refusals belonging to this plan;
- the final refusal inventory is measured again over the same input, compared
  explicitly with the planning baseline of 179 primary and 52 cascading refusals,
  regrouped by underlying feature rather than diagnostic message, and every
  remaining refusal is named with its owner and reason;
- native N-API and JVM/Android paths execute the shared Fetch/WebSocket protocols
  through their real typed primitives and owning environments;
- typed-array aliases, callback lifetimes, completion credits, close behavior, time
  modes, byte ownership, and wrong-environment hazards have positive and sabotage
  coverage;
- Node module/global constructor identity is exact within each environment;
- the applicable pinned Node, WPT, Autobahn, repository gate, memory, differential,
  platform, and security suites are green, with genuine Section 13 exclusions still
  explicit rather than counted as passes;
- the protected numeric floors are at least LLVM 113/113, LLVM-RC 113/113, JVM
  112/112, `bench-agree` 41/41, and memory 61/61; floors may rise but may not be
  lowered to satisfy this plan;
- the non-numeric examples gate continues to require every comparable example in
  the current corpus to agree; a fixed historical count cannot substitute for that
  scaling requirement;
- Android release artifacts pass the agreed API/reproducibility/D8/R8/device gates;
- comparative performance has been measured in context and any regression is either
  fixed or explicitly reviewed with evidence; and
- conformance, security, ownership, performance, provenance, and unfinished-surface
  documentation describe what was actually executed rather than repeating the
  external host-suite counts.

The three planning sessions and the repository owner review this definition before
implementation begins. Any later architectural deviation is written down and agreed
before a lane builds on it.
