# RFC: Native TypeScript Architecture v3

**Subtitle:** Compiler, Memory Management, Debugging, Libraries, Modules, Renderers, Products, Hot Reload, and Developer Experience
**Status:** Proposed
**Date:** August 25, 2026
**Working CLI:** `nts`
**Working configuration file:** `nts.config.ts`

---

# 1. Executive Summary

Native TypeScript should become an independent compiler and application platform that compiles ordinary TypeScript and TSX into:

- Native executables.
- Static and shared libraries.
- JVM class files and Android DEX.
- Android applications and AARs.
- iOS and macOS applications and frameworks.
- Windows applications, DLLs, and packages.
- GTK applications and libraries.
- Embeddable React surfaces.
- A cross-platform native UI SDK.
- Chromium-hosted applications that call Blink directly.
- Future Node-compatible and explicit dynamic-JavaScript profiles.

The system should retain the strongest architectural ideas proven by the current ScriptC-based work (locally located at ~/Projects/native-typescript/third_party/scriptc/ and generally ~/Projects/native-typescript/ as initial reference, but do not copy blindly):

```text
TypeScript source
        ↓
TypeScript semantic frontend
        ↓
versioned semantic snapshot
        ↓
Native TypeScript HIR
        ↓
whole-program analysis
        ↓
Native TypeScript MIR
        ↓
C / LLVM / JVM
        ↓
applications, libraries, frameworks, and embedded modules
```

The major decisions added by this RFC are:

1. **Memory management is a first-class build dimension.**
2. **The compiler owns a collector-neutral managed-reference model.**
3. **Reference counting plus cycle collection is the first native shipping provider.**
4. **MMTk is an early experimental provider, not the initial universal default.**
5. **JVM output uses JVM/ART garbage collection directly.**
6. **Blink, UIKit, AppKit, GObject, WinRT, and Android objects remain owned by their native heaps or lifetime systems.**
7. **Cross-heap objects are represented by opaque handles and explicit bridge ownership.**
8. **Source mapping is generalized into a complete debug-provenance graph.**
9. **ECMA-426 source maps are one exported representation, not the native compiler’s canonical debug format.**
10. **Every HIR and MIR operation carries source provenance.**
11. **HMR generations carry their own code, type, GC, and debug metadata.**
12. **Broad Node.js compatibility remains a later phase.**

The architecture should make MMTk possible without making project success depend on MMTk reaching production maturity on every target.

---

# 2. Context

The current research already demonstrates several key architectural seams:

- C and LLVM native compilation.
- A substantial native IR and ABI model.
- Native handles, ownership, callbacks, thread admission, and scheduling.
- JVM lowering and Android runtime integration.
- A shared-TypeScript direction for portable Web and renderer semantics.
- Direct Blink calls from compiled native code without routing through V8 values.
- Native library exports.
- Cross-platform artifact planning.

The `jvm-www` ownership decision correctly places JVM Promise storage, continuation frames, Android Looper integration, OkHttp transports, and actual Android UI objects in Java, while moving portable Web behavior and renderer semantics toward shared TypeScript.

The Chromium research similarly establishes that Chromium is a host environment above an ordinary Linux, macOS, or Windows target. Chromium owns its task runner, process model, Blink/Oilpan objects, and security boundaries; compiled TypeScript should call Blink through typed generated capsules and use typed browser-process capabilities for privileged operations.

This RFC preserves those boundaries while replacing ScriptC as the permanently moving compiler foundation.

---

# 3. MMTk Assessment

## 3.1 What MMTk is

MMTk is a language-runtime-neutral garbage-collection toolkit written primarily in Rust. It provides multiple collection plans, including non-moving mark-sweep, copying collectors, generational collectors, Immix variants, and concurrent research collectors. It is integrated through a VM binding that supplies object layouts, root scanning, mutator control, weak-reference handling, and related runtime behavior.

That architecture is highly relevant to Native TypeScript.

It would let Native TypeScript experiment with:

```text
MarkSweep
Immix
SemiSpace
GenCopy
GenImmix
StickyImmix
ConcurrentImmix
```

without implementing every collector internally.

## 3.2 What MMTk does not provide automatically

MMTk does not make a runtime garbage-collected merely by replacing `malloc`.

A binding must provide at least:

- Mutator discovery.
- Mutator stopping and resumption.
- Object layouts.
- Reference-field scanning.
- Root scanning.
- Stack and register root identification.
- Write barriers.
- Weak-reference semantics.
- Finalization semantics.
- Object copying support for moving collectors.
- Pinning rules.
- Thread-local allocator integration.
- OOM behavior.

The MMTk porting guide describes seven central VM-binding traits, including `Collection`, `ObjectModel`, `ReferenceGlue`, `Scanning`, `Slot`, and `MemorySlice`. It also cautions that porting a runtime to a different collector can be substantial even when the collector library itself has a clean API.

For Native TypeScript, the difficult work is not the Rust dependency. It is designing:

```text
precise root locations
safe points
write barriers
object descriptors
moving-GC-safe FFI
cross-heap handles
weak semantics
HMR generation lifetime
```

Those must exist regardless of which tracing collector is eventually selected.

## 3.3 Current suitability

As of August 25, 2026, MMTk’s official status still describes it as actively developed and not yet ready for production use. Its documented platform tiers guarantee execution only on a narrow subset: Linux x86-64 and i686 are tier 1, x86-64 macOS is tier 2, and Linux/Android ARM64 are tier 3. Windows and Apple ARM64 are not yet in the documented support table.

That is not sufficient for a project whose core product matrix includes:

```text
Android ARM64
iOS ARM64
macOS ARM64
Windows x86-64 / ARM64
Linux x86-64 / ARM64
GTK
Chromium
```

MMTk also currently assumes one MMTk instance per runtime process. Its porting guide says multiple instances are unsupported, while current core source comments describe multi-instance support as incomplete and identify global address-space structures that still complicate it.

That matters directly to:

- Multiple independently embedded Native TypeScript libraries.
- Several isolated React surfaces.
- Bundled-private runtimes.
- Chromium renderer realms.
- Native plugin systems.
- Test processes that create and destroy many runtimes.

MMTk’s VM-facing APIs are also still evolving, with a maintained migration guide describing binding-breaking changes between releases. This does not make it unsuitable, but it means the integration must be pinned and isolated.

## 3.4 Decision

MMTk should be:

```text
a supported experimental native memory provider
```

It should not initially be:

```text
the universal runtime foundation
the JVM collector
the owner of Blink objects
the owner of platform UI objects
the required collector for all shared libraries
```

## 3.5 Initial memory-provider matrix

| Backend / host                   | Initial memory provider    |
| -------------------------------- | -------------------------- |
| Native C/LLVM applications       | RC plus cycle collection   |
| Native static/shared libraries   | RC plus cycle collection   |
| Compiler bring-up and tiny tests | NoGC                       |
| Native Linux experimental lane   | MMTk                       |
| JVM / Android                    | JVM or ART collector       |
| Blink objects                    | Oilpan                     |
| Objective-C / Swift objects      | ARC / native ownership     |
| Android platform objects         | ART                        |
| GObject / GTK objects            | GObject reference counting |
| WinRT / COM objects              | COM / WinRT ownership      |
| QuickJS or Hermes realm          | Engine-owned heap          |

## 3.6 MMTk integration sequence

```text
Step 1: NoGC
    prove allocation, object layout, roots, shutdown

Step 2: MarkSweep
    prove scanning, root completeness, weak handling

Step 3: Immix
    measure throughput and fragmentation

Step 4: SemiSpace or GenCopy
    deliberately move objects to expose illegal raw pointers

Step 5: generational/concurrent plan
    only after barrier and scheduler correctness
```

NoGC is explicitly intended by MMTk as an initial porting plan.

## 3.7 Gates before MMTk can become a default provider

MMTk may become a default only after all of the following pass:

1. Supported and continuously tested Apple ARM64 and Windows builds.
2. Defined support for multiple independent Native TypeScript runtime instances, or an accepted one-runtime-per-process product restriction.
3. Complete root maps for C and LLVM output.
4. Moving-collector stress tests.
5. FFI pin/copy tests.
6. WeakMap, WeakSet, WeakRef, and finalization tests.
7. React renderer lifecycle tests.
8. HMR generation-retention tests.
9. Chromium cross-heap lifecycle tests.
10. Android NDK tests where the native backend is used.
11. Shared-library creation and teardown loops.
12. Memory pressure and OOM tests.
13. Pause-time, throughput, and peak-memory comparison against the RC provider.
14. Crash, sanitizer, and heap-corruption stress suites.
15. Production-quality heap diagnostics.

---

# 4. Goals

## 4.1 Compiler goals

Native TypeScript should:

- Accept ordinary TypeScript and TSX syntax.
- Use real TypeScript semantic information.
- Compile all reachable supported behavior ahead of time.
- Diagnose unsupported reachable behavior precisely.
- Avoid silently introducing a JavaScript engine.
- Support C, LLVM, and JVM from one compiler-owned model.
- Permit build-time specialization of representations and memory operations.
- Produce applications and libraries equally naturally.
- Remain inspectable at every stage.
- Preserve source-level debugging through optimization and packaging.

## 4.2 Runtime goals

The runtime should:

- Support multiple isolated runtime instances.
- Keep ordinary heaps owner-confined.
- Integrate with native platform schedulers.
- Use platform-native object systems where appropriate.
- Allow different native memory providers.
- Expose deterministic resource shutdown.
- Never require garbage collection to release essential native resources correctly.
- Track external/native memory.
- Produce useful heap and allocation diagnostics.

## 4.3 Framework goals

The system should support:

- Natively compiled React.
- A shared TypeScript native UI renderer.
- A direct DOM/Blink renderer.
- A test renderer.
- Native view modules.
- Brownfield embeddable surfaces.
- Multiple surfaces per runtime.
- Multiple isolated runtimes where the selected memory provider permits them.

## 4.4 Developer-experience goals

The development experience should provide:

- One-command launch.
- Persistent incremental compilation.
- React state-preserving refresh.
- Native/JVM hot replacement.
- Last-known-good execution.
- Source-level errors and stack traces.
- Cross-language breakpoints.
- Native, JVM, renderer, and module inspection.
- GC statistics and heap inspection.
- Precise explanation of rebuild and restart decisions.

---

# 5. Non-Goals for Initial Releases

Initial releases should not attempt to:

- Implement the full Node.js API.
- Compile arbitrary npm packages.
- Support unrestricted prototype mutation or reflection.
- Make MMTk mandatory.
- Use one universal collector on every backend.
- Share raw managed pointers across library boundaries.
- Discover cycles automatically across independent platform heaps.
- Make finalizers the primary native-resource cleanup mechanism.
- Preserve hot state across every incompatible object-layout change.
- Guarantee physical-iOS native-code injection.
- Support every MMTk collection plan.
- Expose collector-specific implementation details through public APIs.
- Produce perfect optimized-debug variable inspection in the first release.

---

# 6. Build Composition Model

A build is composed from independent dimensions.

```text
BuildRequest
├── target
├── backend
├── runtimeFamily
├── memoryProvider
├── hostEnvironment
├── profiles[]
├── capabilities[]
├── frameworks[]
├── renderers[]
├── product
├── debugProfile
└── developmentStrategy
```

## 6.1 Target

Defines:

```text
CPU
OS
ABI
pointer width
endianness
object format
minimum platform version
toolchain
```

## 6.2 Backend

```text
C
LLVM
JVM
```

## 6.3 Runtime family

```text
native
jvm
```

## 6.4 Memory provider

```text
native-rc-cycle
native-mmtk
native-nogc
host-jvm
```

## 6.5 Host environment

```text
standalone-libuv
android
ios-uikit
macos-appkit
windows-winui
gtk-glib
chromium-renderer
chromium-browser
embedder-provided
```

## 6.6 API profiles

```text
ecmascript
web-core
web-fetch
websocket
react
native-ui
dom
desktop
node-later
```

## 6.7 Capabilities

```text
scheduler
timers
frame-clock
fetch-transport
websocket-transport
filesystem
network
process
ui-host
image-loader
text-measurement
clipboard
notifications
logging
lifecycle
permissions
```

## 6.8 Product

```text
executable
static-library
shared-library
application
framework
android-library
native-ui-sdk
host-surface-library
chromium-shell
module-package
```

## 6.9 Debug profile

```text
none
line-tables
development
full-private-symbols
release-symbols
```

---

# 7. Compiler Pipeline

```text
TypeScript / TSX
        │
        ▼
TypeScript semantic adapter
        │
        ▼
SemanticSnapshot vN
        │
        ▼
NativeTS HIR
        │
        ├── reachability
        ├── type specialization
        ├── effects
        ├── ownership
        ├── escape analysis
        ├── closure analysis
        ├── async lowering
        └── host/capability validation
        │
        ▼
NativeTS MIR
        │
        ├── managed references
        ├── exact values
        ├── allocations
        ├── root operations
        ├── reference stores
        ├── safepoints
        ├── weak operations
        ├── native handles
        ├── callbacks
        ├── scheduler operations
        └── source origins
        │
        ▼
Memory-provider lowering
        │
   ┌────┼────────────┐
   ▼    ▼            ▼
  RC   MMTk         JVM
        │
        ▼
C / LLVM / JVM backend
```

## 7.1 TypeScript isolation

No TypeScript compiler object may escape the frontend package.

Forbidden outside `compiler/frontend-ts`:

```text
ts.Node
ts.Type
ts.Symbol
ts.Signature
ts.Program
ts.TypeChecker
```

The compiler consumes a versioned, serializable semantic snapshot.

## 7.2 Managed-reference MIR

MIR must not encode reference counting as the meaning of a managed reference.

It should contain abstract operations such as:

```text
managed.alloc
managed.store
managed.load
managed.root.enter
managed.root.leave
managed.safepoint
managed.weak.create
managed.weak.load
managed.identity_hash
managed.pin
managed.unpin
managed.external_bytes.add
managed.external_bytes.remove
```

Provider lowering turns these into:

### RC provider

```text
retain
release
cycle-candidate write barrier
cycle collection
```

### MMTk provider

```text
allocation fast path
write barrier
root slot registration
safepoint poll
collector slow path
```

### JVM provider

```text
ordinary JVM references
ordinary field stores
ART/JVM allocation
```

No virtual call should occur on every field store in optimized builds. The selected provider should specialize fast paths during code generation.

---

# 8. Native Managed Object Model

## 8.1 Object descriptor

Every managed native object should reference an immutable descriptor:

```text
TypeDescriptor
├── stable type identity
├── generation identity
├── object size strategy
├── alignment
├── reference-field map
├── variable-length element strategy
├── debug name
├── source declaration identity
├── identity-hash strategy
├── optional resource-drop record
└── heap-snapshot field metadata
```

The descriptor is collector-neutral.

## 8.2 Object header

A possible internal header:

```text
ObjectHeader
├── TypeDescriptor*
├── provider-reserved word
├── flags
└── optional identity hash / auxiliary data
```

The exact layout may differ by provider. It is not public ABI.

**Amended, after implementing it.** A string and an array do *not* have the same
shape, and trying to give them one was wrong. A string keeps its code units
inline after the header, which is right: it never changes length, so inline
storage costs nothing and buys locality. An array keeps a capacity and a pointer
to its elements, because `push` exists — growing something whose elements are
inline means moving the object, and moving it invalidates every reference anyone
holds. JavaScript promises the opposite: an array grows under every reference to
it at once.

The pointer starts out addressing the block immediately after the array's own
header, so an array nothing grows still reads its elements with the locality
inline storage had. What it costs is one load, and that load is loop-invariant:
clang hoists it out of any loop that does not call something which could grow the
array. Measured on the `arrays` benchmark, the difference was nothing.

The alternative — deciding per array type whether it can grow, and using two
representations — was considered and rejected. It is sound only with a
whole-program analysis, because a `number[]` parameter can receive either kind,
and the coarse version of it makes one `push` anywhere slow down every array in
the program.

## 8.3 Reference-field descriptions

Fixed-layout objects may use pointer bitmaps.

Variable objects may use generated trace routines:

```text
Array<T>
Map<K,V>
Set<T>
closure environments
Promise reaction lists
renderer nodes
```

Trace routines should be generated from MIR layouts rather than handwritten per class.

## 8.4 A closure is an object

*Amended after implementation. The original text listed "closure environments"
among the things needing generated trace routines, which implied a
representation of their own.*

A closure is captured state plus code. So is an object. The implementation
lowers a closure to a class with one method, and every part of this section
applies to it unchanged: it has a descriptor, a header, and a reference-field
description generated from its layout like any other.

```text
class Closure<n>
    base    = the arrow's signature type, which has no fields
    fields  = what the body reads from the scope around it
    methods = { call }
```

Three consequences follow, and the point of the design is that none of them is
new machinery:

- **The signature type is the base.** It has no fields, so base-first layout
  makes a pointer to the closure a pointer to the signature. An upcast is free,
  and a value declared `(x: number) => number` is any closure of that shape.
- **The slot is shared.** Every closure's `call` occupies one dispatch slot. A
  slot per signature would make every table in the program as long as the number
  of signatures in it, for a distinction no call site can observe: a call
  through the slot spells the signature it is making.
- **Capture is by value, and only where that is the same thing.** JavaScript
  captures by reference. For a name nothing assigns to, the two agree; for one
  something writes to, they do not, and the compiler refuses rather than
  choosing. A boxed cell is the eventual answer and is not free.

### Cost, and what it takes to reach it

A closure class is **final** — nothing extends it, and only its own arrow fills
its slot. So a call whose receiver's static type is the class rather than the
signature has one possible body and is emitted as a direct call.

That leaves the case where a closure crosses a function boundary, and there the
receiver is the signature type. A backend cannot recover it: to fold the table
load, a C compiler would have to know the callee does not write the receiver's
descriptor, and it cannot know the callee without folding the load. So the
compiler specializes the *callee* instead — one copy per closure class, which is
what `template <typename F>` does in C++ with the difference that the concrete
type comes from the call site rather than from the author.

Measured against a C++ lambda passed to a template, which monomorphizes and
inlines: parity. See `docs/records/0009-a-closure-is-an-object.md`.

## 8.5 Identity under moving GC

Object identity must not equal the object address.

A moving collector may relocate objects while preserving JavaScript identity.

Identity hashes should use:

- A lazily assigned stable field.
- A side table.
- A collector-assisted address-hash protocol.

MMTk documents address-based hashing as a special runtime concern for moving collectors; Native TypeScript should hide that behind `managed.identity_hash`.

---

# 9. Native Memory Providers

## 9.1 NoGC

Purpose:

- Compiler bring-up.
- Allocation testing.
- Microbenchmarks.
- Small tools with bounded lifetimes.
- MMTk binding bootstrap.

NoGC must never be selected silently for a general application.

## 9.2 RC plus cycle collection

This should be the first native shipping provider.

ScriptC already demonstrates a native runtime using reference-counted values with a cycle collector. That makes its implementation and test corpus a useful bootstrap reference.

Advantages:

- Cross-platform implementation.
- No precise native stack maps required for liveness.
- Non-moving objects.
- Straightforward C ABI.
- Straightforward foreign-function borrowing.
- Independent heap per runtime.
- Easier dynamic-library HMR.
- Deterministic release in acyclic cases.
- Fits an owner-confined heap.

Costs:

- Retain/release traffic.
- Write-barrier overhead.
- Cycle-collector pauses.
- More complicated concurrent sharing.
- Potential premature-release bugs if lowering is wrong.
- Potential long-lived cycles if candidate tracking is wrong.

The implementation should initially prioritize correctness and instrumentation over clever optimization.

## 9.3 MMTk

The MMTk provider should live behind a dedicated binding and an exact pinned version.

```text
memory/native/mmtk/
├── binding/
├── object-model/
├── root-scanning/
├── mutators/
├── barriers/
├── weak-processing/
├── finalization/
├── options/
├── stats/
└── conformance/
```

No MMTk type should appear in:

- Public ABI.
- HIR.
- General MIR.
- Platform hosts.
- React renderer.
- Native module API.
- Shared-library API.

## 9.4 Custom precise mark-sweep fallback

A small Native TypeScript-owned non-moving mark-sweep collector may be considered later if:

- RC overhead proves unacceptable.
- MMTk remains unsuitable on required platforms.
- Multiple MMTk instances remain unavailable.

It is not required in the first implementation.

---

# 10. Roots, Safepoints, and Stack Maps

## 10.1 Root categories

The native runtime must identify references held by:

```text
function locals
temporaries
arguments
returns
module globals
runtime globals
thread-local state
exception state
async continuation frames
Promise reactions
callback registrations
native export handles
HMR export slots
renderer surfaces
host task queues
cross-thread gateway messages
```

MMTk defines roots as references held in locals, globals, thread-local variables, and similar runtime-visible slots. Its guidance also notes that compilers insert yieldpoints and generate stack maps at GC-safe points.

## 10.2 Root frames belong to the provider, not to the backend

> **Amended.** This section originally required both native backends to use
> explicit root frames "initially". That contradicts §9.2, which makes reference
> counting the first shipping provider and states that it needs no precise
> native stack maps for liveness.
>
> Root frames exist so a *tracing* collector can find references on the stack.
> Under RC, liveness is the reference count; under NoGC (§9.1) nothing collects
> at all. For both providers that ship first, root frames are pure overhead — a
> push and a pop per managed local per call, on exactly the code this project
> claims is fast.
>
> Rooting is therefore a property of the **memory provider**:
>
> | Provider | Roots |
> | --- | --- |
> | NoGC | none — nothing is collected |
> | RC + cycle collection | none — the count is liveness |
> | MMTk, or any tracing provider | required |
>
> This also keeps MIR provider-neutral, which §7.2 already demands. The design
> below stands as written for the tracing case, and must not be built before
> a tracing provider needs it.

When a tracing provider is in use, both native backends should use explicit
root frames:

```c
struct NtsRootFrame {
  struct NtsRootFrame *previous;
  uint32_t slot_count;
  void **slots;
};
```

Generated code:

1. Creates a frame when entering a function with live managed references.
2. Registers addresses of root slots.
3. Updates slots as values change.
4. Removes the frame on every exit path.

Advantages:

- Works for generated C.
- Works for LLVM.
- Easy to inspect.
- Easy to test.
- Moving collectors can update slots.
- Avoids depending on unstable LLVM GC integration immediately.
- Keeps C and LLVM behavior equivalent.

The compiler should only root values live across safepoints.

## 10.3 Safepoints

Safepoints should occur at:

- Allocation slow paths.
- Calls that may allocate.
- Loop backedges where required.
- Await suspension.
- Host-task entry.
- Callback entry.
- Explicit GC polls.
- Long-running runtime kernels.

No GC may occur during uninterruptible operations such as:

- Partially initialized object headers.
- Barrier slow paths.
- Raw pointer manipulation.
- Native ABI transitions that have not registered their roots.

## 10.4 Later LLVM statepoints

LLVM provides `gc.statepoint` infrastructure for precise relocating collectors, and its documentation describes the mechanism as well proven in shipped managed runtimes. The LLVM language reference still categorizes this family as an experimental GC-intrinsic mechanism, so it should remain behind a pinned LLVM adapter rather than become a public contract.

A later optimized LLVM path may use:

```text
gc.statepoint
gc.relocate
stack maps
derived-pointer tracking
```

The shadow-root path should remain as:

- Reference backend.
- C backend strategy.
- Fallback for unsupported LLVM targets.
- Differential correctness lane.

---

# 11. Write Barriers

The compiler must classify every managed-reference store.

```text
object.field = ref
array[index] = ref
closure.capture = ref
map.entry = ref
Promise.reaction = ref
module.global = ref
```

Provider lowering chooses:

### RC

```text
retain new
store
release old
record cycle candidate if required
```

### Generational MMTk

```text
store
card / object remembered-set barrier
```

### Concurrent MMTk

```text
SATB or provider-selected barrier
```

### JVM

```text
putfield / aastore
```

MMTk recommends that high-performance runtimes implement barrier fast paths on the VM side rather than making a generic library call for every store.

Therefore the provider should export barrier templates or compiler intrinsics, not merely C functions.

---

# 12. Async Lowering and GC

Native `async`/`await` should preferably use heap-allocated continuation frames rather than making stackful fibers the permanent default.

```text
async function
      ↓
generated state machine
      ↓
managed AsyncFrame
├── state
├── live locals
├── awaited Promise
├── parent async site
└── exception state
```

Advantages:

- Precise tracing.
- Straightforward HMR generation ownership.
- Better async stack traces.
- No hidden roots on suspended native stacks.
- Similar conceptual model across native and JVM backends.
- Easier runtime shutdown.

Stackful fibers may remain an optional compatibility or performance mechanism, but only after their stack roots and source-debug behavior are specified.

## 12.1 The microtask checkpoint

Promise resolution ordering is ECMAScript-specified and directly observable: reactions run in FIFO order on the microtask queue, ahead of any macrotask, with a fixed number of ticks per `await`. It therefore belongs to the runtime and cannot be delegated to a platform primitive with different ordering.

In a browser or in Node the queue drains when the JavaScript stack empties. Compiled TypeScript has no such moment: it is *entered from a host task* — a Looper message, a dispatch block, a Chromium `TaskRunner` task, a libuv callback. The draining rule must therefore be stated as a contract rather than inherited.

```text
nts_enter(runtime)      depth++
        ↓
   run TypeScript
        ↓
nts_leave(runtime)      depth--; if depth == 0, drain to fixpoint
```

The checkpoint drains **two** queues, not one, and the order between them is observable:

```text
do {
    while (tick = ticks.shift())     tick.callback(tick.args)
    drain microtasks until empty
} while (ticks is not empty)
```

The second queue is `process.nextTick`'s. It is not a Node convenience: it is the mechanism by which every callback-style API avoids resolving before its caller returns, so `fs`, `net` and `stream` are all built on it. A host or profile that has no such concept never enqueues into it, the inner `while` never runs, and the algorithm degenerates *exactly* to the ECMAScript checkpoint — drain microtasks to fixpoint. One algorithm covers both; there is no branch on profile.

Two consequences of the shape worth stating, because both are asserted by tests:

- A tick enqueued *by a microtask* is run before the checkpoint ends, in a second pass. It is not deferred to the next macrotask.
- The drain invokes the callback **directly**, with its arguments held beside it in the queue entry. A queue that stored a closure and called it would insert a frame between the drain and the callback, which is visible in a stack trace and is checked.

Rules:

- Every host entry into compiled TypeScript is wrapped in enter/leave.
- The drain runs **to fixpoint**. This is what the specification requires, and it means a program can starve the host loop. That is the correct trade — the alternative reorders observable program behavior — and starvation is a program bug rather than a scheduling policy.
- Nesting is by depth, not by a flag. A capability call that re-enters TypeScript synchronously must not drain on the inner return; only the outermost boundary is a checkpoint.
- **Hosts do not see either queue.** The runtime hands the host an opaque task that already carries its own enter/leave, so a host cannot get the checkpoint wrong by omission. A host that forgot to drain would produce a program whose promises resolve late and in the wrong order, which no test of the host itself would catch.
- A task posted by the host contract therefore runs *after* a complete checkpoint. That guarantee is what `setImmediate` needs, and it is specified here rather than left to each host to reproduce. What is **not** specified is the ordering of a zero-delay timer against it: under libuv that depends on which loop phase is running and is genuinely libuv's business.

## 12.2 Where the microtask queue is not ours

One host owns a microtask queue already, and running a second one beside it interleaves two orderings that are each individually correct and jointly wrong. See §26.6.

The contract admits this as a configuration rather than a fork: a host may supply an `enqueue_microtask` operation, and supplying one means the host also owns checkpointing, so the runtime's own queue and its drain at `nts_leave` are both disabled. There is one code path either way.

---

# 13. JVM Memory Model

JVM-generated TypeScript should use the JVM object model.

```text
TS object      → JVM object
TS string      → java.lang.String or exact wrapper where required
TS array       → specialized JVM representation
TS closure     → generated class / runtime closure type
TS Promise     → NativeTS JVM Promise
TS exception   → JVM Throwable hierarchy or wrapper
```

There should not be a second Native TypeScript GC inside ART.

Java, DEX, Android UI objects, OkHttp calls, Promise frames, and renderer nodes should be ordinary JVM references and therefore visible to ART.

MMTk should not be used to replace ART.

JNI should remain limited to coarse native capabilities and should use:

- Local references for call-scoped values.
- Global references for retained values.
- Weak global references where appropriate.
- Explicit release.

---

# 14. Foreign Heaps and Cross-Heap Ownership

Native TypeScript will coexist with multiple memory systems:

| Host    | Foreign ownership system             |
| ------- | ------------------------------------ |
| Android | ART                                  |
| Blink   | Oilpan                               |
| Apple   | ARC and framework-specific ownership |
| GTK     | GObject reference counting           |
| Windows | COM / WinRT reference counting       |
| QuickJS | QuickJS heap                         |
| Hermes  | Hermes GC                            |

## 14.1 Foreign objects are handles

A foreign object must appear in TypeScript as:

```text
ForeignHandle<T>
```

not as a raw managed pointer.

A handle contains or resolves:

```text
runtime identity
realm identity
slot
generation
type identity
thread affinity
lifetime mode
foreign backing reference
```

## 14.2 No automatic cross-heap tracing

The Native TypeScript collector should not attempt to scan:

- Oilpan object fields.
- JVM heap fields.
- Objective-C object graphs.
- GObject object graphs.
- COM graphs.

Similarly, foreign collectors should not scan the Native TypeScript heap.

## 14.3 Cross-heap cycle rule

Arbitrary bidirectional strong edges are forbidden.

Instead, bridge relationships must declare one of:

```text
owned
borrowed
weak
receiver-owned
registration-owned
realm-owned
process-owned
```

Example event registration:

```text
NativeTS registration object
        │ owns
        ▼
foreign listener adapter
        │ contains
        ▼
opaque callback token
```

The foreign listener must not hold an untracked raw strong pointer to a Native TypeScript closure.

Cancellation or realm teardown releases the token and breaks the relationship.

## 14.4 Chromium

For direct Blink:

```text
NativeTS reference
        ↓
NativeHandle<Element>
        ↓
realm registry
        ↓
Oilpan strong edge
        ↓
blink::Element
```

Navigation destroys the realm, invalidates handles, cancels listeners, rejects or cancels pending async operations, releases Oilpan roots on the correct sequence, and then shuts down the Native TypeScript runtime. This matches the lifecycle already defined by the Chromium research.

---

# 15. FFI, Pinning, and Moving GC

## 15.1 No public managed pointers

Public C headers must never expose:

```c
NtsObject *
NtsString *
void *managed_object_body
```

unless the pointer is explicitly call-scoped and pinned.

Public APIs use:

```c
NtsRuntime *
NtsHandle
NtsStringView
NtsByteSpan
NtsOwnedBuffer
```

## 15.2 Handle roots

An exported `NtsHandle` roots a managed object in the owning runtime.

The handle table is itself a GC root.

For moving collectors, collection updates the referenced object slot without changing the external handle value.

## 15.3 Pinning policy

An ABI projection declares:

```text
copy
borrow-nonmoving
pin-call-scoped
external-buffer
```

Pinning cannot be assumed to work with every MMTk plan; MMTk documents that some collection plans cannot perform object pinning.

Default rules:

- Strings crossing arbitrary native calls are copied or projected through stable runtime storage.
- Large byte arrays may use separately allocated stable buffers.
- Raw interior pointers never survive safepoints.
- Moving-provider builds reject unsupported pin requirements before linking.

---

# 16. Weak References and Finalization

## 16.1 Weak features are language semantics

These APIs require an explicit collector-neutral contract:

```text
WeakMap
WeakSet
WeakRef
FinalizationRegistry
foreign weak handles
renderer weak public instances
```

MMTk provides low-level weak and finalizer processing, but leaves concrete language semantics to the VM binding.

## 16.2 Initial support

Recommended initial order:

1. Foreign weak handles.
2. Renderer weak public-instance references.
3. WeakMap and WeakSet.
4. WeakRef.
5. FinalizationRegistry.

Each feature must pass across:

```text
RC-cycle
MMTk non-moving
MMTk moving
JVM
```

## 16.3 Finalization rule

GC finalization is not a correctness mechanism for scarce resources.

Files, sockets, native views, event registrations, database handles, and process resources require:

- Explicit disposal.
- Receiver lifecycle.
- Runtime shutdown registration.
- Host cancellation.
- Optional GC fallback only.

Support should include:

```text
Symbol.dispose
Symbol.asyncDispose
using
await using
```

when the selected TypeScript profile admits them.

Finalizers must not resurrect general managed objects.

---

# 17. Runtime Instances and Shared Libraries

## 17.1 Runtime instance model

Every managed object belongs to one runtime.

```text
RuntimeInstance
├── runtime ID
├── owner executor
├── memory provider
├── heap
├── root registry
├── module registry
├── callback registry
├── active resources
├── debug registry
└── shutdown state
```

## 17.2 No cross-runtime managed references

Two runtime instances communicate through:

```text
transport-safe values
copied strings
copied byte buffers
remote handles
typed asynchronous messages
```

They do not share ordinary managed objects.

## 17.3 Library linkage modes

### Bundled private runtime

Each shared library owns an isolated runtime.

Initial supported provider:

```text
RC-cycle
```

MMTk should be rejected here while multi-instance support remains unavailable.

### Build-time composed runtime

Application, libraries, React, and modules are linked into one product with one runtime.

Supported providers:

```text
RC-cycle
MMTk experimental
```

### Host-provided runtime

Multiple libraries use one embedder-provided runtime.

This requires a versioned public runtime ABI and should arrive later.

## 17.4 Thread attachment

Every native API that enters the heap must have:

```text
owner-thread validation
or
explicit runtime thread attachment
```

A foreign thread cannot access a runtime heap merely because it has a handle.

### Completions are the common case

This is not a rare edge. Every asynchronous transport worth having completes on a thread the runtime does not own:

| Capability          | Completes on                        |
| ------------------- | ----------------------------------- |
| OkHttp              | its own dispatcher threads          |
| URLSession          | a delegate queue                    |
| WinHTTP             | a thread-pool callback              |
| libuv file I/O      | the libuv thread pool               |
| GIO async           | a worker thread                     |

Resolving a Promise is a heap mutation. So **every capability adapter must post its completion to the owner executor before it touches a Promise**, through the one host operation that is safe to call from any thread. An adapter that resolves directly from its completion thread is a data race on the heap, and it is a race that will usually appear to work.

This is a requirement on every capability contract in §6.7, not advice. The runtime should validate it: resolution asserts the owner thread in checked builds.

---

# 18. External Memory, Pressure, and OOM

The GC heap is not the whole process.

External memory includes:

```text
images
network buffers
native strings
SQLite pages
Yoga nodes
Blink backing objects
GPU resources
native views
mapped files
compression buffers
```

The runtime should provide:

```text
external_bytes_add(category, size)
external_bytes_remove(category, size)
```

Memory pressure may trigger:

- GC.
- Cache eviction.
- Image cache release.
- Unused module release.
- Host memory-pressure callbacks.
- A controlled fatal OOM.

Heap exhaustion should not normally be exposed as a catchable JavaScript exception because the runtime may be unable to allocate the exception safely.

Oversized logical requests can still throw a catchable `RangeError` before allocation.

---

# 19. Heap and GC Observability

Developer tools should expose:

```text
heap size
live bytes
external bytes
allocation rate
collection count
pause times
cycle-collector time
remembered-set size
object counts by type
roots
retaining paths
weak entries
pending finalizers
native handles
foreign resources
HMR generations retaining objects
```

The debug type descriptor should contain enough field metadata to support heap snapshots.

Initial snapshot format should be Native TypeScript-owned and convertible to a viewer format later.

---

# 20. Debug Provenance and Source Maps

## 20.1 Source maps are necessary but insufficient

ECMA-426 standardizes source maps for mapping transformed code back to original sources and explicitly targets source debugging and stack-trace deobfuscation. It is appropriate for mapping TypeScript transforms and generated textual output.

It does not by itself describe:

- Native instruction addresses.
- Inlined native frames.
- JVM bytecode offsets.
- DEX rewriting.
- HMR code generations.
- Async continuation parents.
- Generated native capsules.
- GC safepoints.
- Machine-level variables.

Therefore Native TypeScript needs a richer canonical model.

## 20.2 Canonical Debug Provenance Graph

Every compilation should produce a versioned graph:

```text
Original source span
        ↓
transformed source span
        ↓
semantic node
        ↓
HIR operation
        ↓
MIR operation
        ↓
backend operation
        ↓
generated C line / LLVM instruction / JVM bytecode
        ↓
object-file address / class offset
        ↓
linked address / DEX offset
```

Working artifact name:

```text
NTS Debug Map
*.ntsdbg
```

## 20.3 Origin record

Every HIR and MIR operation carries:

```text
Origin
├── source file ID
├── start/end span
├── symbol ID
├── lexical scope ID
├── inline chain
├── async parent site
├── generated reason
├── module ID
└── HMR generation
```

Generated reasons include:

```text
closure lowering
async resume
native adapter
module initialization
React refresh wrapper
GC barrier
safepoint
exception cleanup
ABI projection
```

## 20.4 Source identity

A source file should have:

```text
normalized workspace URI
content digest
logical package identity
original path
display path
```

Absolute machine paths should be remapped for reproducible builds:

```text
/home/akis/project/src/App.tsx
        ↓
nts-workspace:///src/App.tsx
```

---

# 21. Backend Debug Lowering

## 21.1 C backend

The C backend should emit:

- Readable generated source.
- `#line` directives for baseline debugger support.
- Stable generated function names.
- A sidecar `.ntsdbg` unit.
- Optional ECMA-426 source map from generated C to TypeScript.
- Compiler flags that preserve native debug information.

`#line` alone is not enough for:

- Multiple TypeScript operations on one C line.
- Inlining.
- Async logical frames.
- Generated adapter collapsing.
- Optimized variable locations.

## 21.2 LLVM backend

The LLVM backend should emit:

```text
DICompileUnit
DIFile
DISubprogram
DILexicalBlock
DILocation
DILocalVariable
inlinedAt chains
```

LLVM can lower this metadata to DWARF for ELF and Mach-O targets and CodeView for Microsoft debugging environments.

Native output:

| Platform    | Native debug artifact                           |
| ----------- | ----------------------------------------------- |
| Linux       | DWARF, optionally separate debug file           |
| macOS / iOS | DWARF plus dSYM                                 |
| Windows     | CodeView plus PDB                               |
| Android NDK | ELF/DWARF native symbol package                 |
| Chromium    | Chromium-compatible native symbols plus NTS map |

## 21.3 JVM backend

Generated class files should include:

```text
SourceFile
LineNumberTable
LocalVariableTable
LocalVariableTypeTable where useful
SourceDebugExtension
```

The current JVM specification defines `SourceDebugExtension` and line/local-variable table attributes for class files.

`SourceDebugExtension` should carry an SMAP-like mapping with a `NativeTS` stratum:

```text
generated class/method line
        ↓
TypeScript file and line
```

## 21.4 Android DEX and R8

The debug pipeline must survive:

```text
class
  ↓ D8
DEX
  ↓ R8
optimized/obfuscated DEX
```

Release artifacts must retain the R8 mapping file and compose it with the Native TypeScript map. Android’s retrace tooling consumes this mapping to reconstruct stack traces.

Symbolication order:

```text
obfuscated DEX frame
        ↓ R8 retrace
generated JVM frame
        ↓ NTS Debug Map
TypeScript frame
```

## 21.5 Apple

Build artifacts must retain:

```text
binary UUID
dSYM
NTS Debug Map
source manifest
```

Apple crash symbolication uses the corresponding dSYM to map addresses back to identifiable symbols.

## 21.6 Windows

Build artifacts must retain:

```text
PE build identity
PDB
NTS Debug Map
source manifest
```

## 21.7 Android native output

Android native products should include or upload the appropriate native debug-symbol artifact so native crash stacks can be symbolicated.

---

# 22. Async Stack Traces

Physical native stacks stop at an `await`.

The runtime should maintain a logical async parent:

```text
AsyncFrame
├── source await site
├── parent async frame
├── Promise creation site
├── module generation
└── optional task origin
```

An exception report combines:

```text
physical stack
        +
logical async chain
        +
host task origin
```

Example:

```text
at loadProfile (src/profile.ts:42)
awaited at initializeApp (src/app.ts:18)
scheduled by Android lifecycle onCreate
entered through MainActivity.onCreate
```

This should work across native and JVM backends.

---

# 23. HMR Debug and GC Metadata

Every hot-reload generation registers:

```text
code ranges
export slots
type descriptors
trace descriptors
static roots
source maps
native symbols
async-site metadata
React refresh signatures
```

Old generations cannot be unloaded while referenced by:

```text
active stack frames
closures
async frames
callbacks
managed objects with generation-specific descriptors
native event listeners
foreign adapters
```

Initial behavior:

```text
keep old generations loaded for the dev session
```

This may increase development memory usage, but it avoids use-after-unload errors.

The devtools should show which objects or resources keep an old generation alive.

Breakpoints should be keyed by:

```text
SourceId + source span
```

rather than by old native addresses, allowing automatic rebinding after refresh.

---

# 24. Crash Reporting and Symbolication

The project should own a cross-platform crash artifact contract.

```text
CrashBundle
├── product build ID
├── process identity
├── runtime identity
├── module generation table
├── native minidump or platform crash
├── JVM stack
├── NTS Debug Map IDs
├── async stack metadata
├── GC state summary
├── active resource summary
└── recent HMR history
```

Crashpad is a suitable optional crash-capture implementation for Chromium-like and native desktop products, but the Native TypeScript symbolication metadata remains independent.

CLI:

```text
nts symbolicate crash.nts-crash
nts symbols upload <build>
nts symbols verify <build>
```

Release symbols should be separable from the shipped binary.

---

# 25. Debug Information Privacy

Configuration modes:

```text
none
line-tables
private-full
embedded-full
```

Release defaults should:

- Exclude source contents.
- Normalize source paths.
- Keep symbols in a private artifact.
- Preserve build IDs.
- Permit server-side symbolication.
- Avoid exposing developer home directories.
- Allow users to upload symbols to their own crash service.

---

# 26. Runtime, Hosts, and Capabilities

The runtime owns language behavior.

The host owns execution environment behavior.

```text
Runtime:
    values
    closures
    exceptions
    promises
    modules
    managed memory
    callbacks
    resources
    shutdown

Host:
    owner executor
    lifecycle
    task wakeup
    UI thread
    networking transport
    native objects
    platform permissions
```

## 26.1 Standalone native host

```text
NativeTS host contracts
        ↓
Rust standalone host
        ↓
isolated libuv adapter
        ↓
libuv
```

libuv remains the default standalone eventing and OS abstraction, not the universal platform loop.

It is also not the default for a *library*. An executable may own the process loop; `native-static-library`, `native-shared-library` and `host-surface-library` (§27) may not, and linking libuv into an embedder's program brings a thread pool and signal handling nobody asked for. Library products default to the `embedder-provided` host of §6.5, whose surface is deliberately narrow:

```text
drain microtasks
run expired timers
pending work?
wake me  (the embedder's own signal, called from any thread)
```

The embedder calls these from its own loop. The runtime never owns one.

## 26.2 Android

```text
JVM runtime
Android Looper / Handler
Choreographer
OkHttp
Android Views
ART GC
```

## 26.3 Apple

```text
native runtime
Dispatch / RunLoop
DisplayLink
URLSession
UIKit / AppKit
ARC handles
```

## 26.4 Windows

```text
native runtime
DispatcherQueue
WinHTTP or selected transport
WinUI
COM / WinRT handles
```

## 26.5 GTK

```text
native runtime
GLib main context
GTK
GObject handles
```

## 26.6 Chromium

```text
renderer:
    compiled TypeScript
    NativeTS native runtime
    selected native memory provider
    Chromium TaskRunner
    Blink microtask queue          <- not ours
    direct Blink capsules
    Oilpan-backed handles

browser:
    compiled TypeScript services
    desktop modules
    privileged capabilities
    generated Mojo transport
```

### The renderer is the exception to §12

A Blink renderer already runs V8's microtask queue under the HTML specification's event loop, with checkpoints at defined points. Compiled TypeScript in that renderer talks to Blink through capsules, and those capsules return promises.

Running our own microtask queue beside Blink's would give two independently-ordered queues over one logical event loop. Each is internally correct; interleaved they are not, and the resulting order is not the order the same source has in a browser today. The failure is invisible in any test that does not mix a Blink promise with a compiled-TypeScript promise — which is to say, invisible until it is in front of a user.

So in the renderer the runtime **adopts Blink's microtask queue** and does not checkpoint at `nts_leave`: it supplies `enqueue_microtask` per §12.2 and Blink's checkpoints drain it. A promise crossing a Blink capsule boundary is adopted rather than wrapped, so there is one queue and one ordering.

The browser process has no such constraint and uses the ordinary runtime queue.

This decision is the reason §12.2 exists. It is a configuration of one contract, not a second implementation.

---

# 27. Products and Shared Libraries

Applications and libraries are peer products.

```text
products/
├── native-executable
├── native-static-library
├── native-shared-library
├── host-surface-library
├── android-application
├── android-library
├── apple-application
├── apple-framework
├── windows-application
├── windows-library
├── gtk-application
├── gtk-library
├── chromium-shell
└── native-ui-sdk
```

## 27.1 Native library ABI

A shared library should expose:

```c
const NtsLibraryDescriptor *nts_library_descriptor(void);

NtsStatus nts_runtime_create(
    const NtsRuntimeOptions *,
    const NtsHostServices *,
    NtsRuntimeHandle *
);

NtsStatus nts_runtime_shutdown(NtsRuntimeHandle);
```

Generated public functions accept a runtime or library instance explicitly unless the product is build-time composed.

## 27.2 Managed results

Managed objects do not cross the public ABI directly.

Use:

```text
opaque handles
copied records
owned buffers
borrowed call-scoped spans
generated typed facades
```

## 27.3 Memory-provider restrictions in product manifests

Example:

```text
product: shared-library
runtimeLinkage: bundled-private
allowedMemoryProviders:
    - native-rc-cycle
```

An MMTk configuration requiring a process-global heap should fail at build planning rather than produce an unsafe library.

---

# 28. Portable Libraries

Portable TypeScript should own behavior that is not inherently platform-specific.

```text
libraries/
├── ecmascript
├── web
└── node-later
```

Initial Web areas:

```text
events
abort
encoding
base64
console
URL
streams
Blob/File/FormData
Headers/Request/Response
Fetch semantics
WebSocket semantics
timing
geometry
```

Platform hosts implement only the transport or native primitive.

Example:

```text
shared TypeScript Fetch
        ↓
FetchTransport
        ├── OkHttp
        ├── URLSession
        ├── Windows transport
        ├── native transport
        └── Blink
```

---

# 29. Node Compatibility Is Deliberately Later

The initial project should not build around `node:*`.

Reasons:

- Very large API surface.
- CommonJS behavior.
- Package resolution details.
- Buffer and stream semantics.
- Native addon expectations.
- Event-loop ordering.
- `process`, workers, VM, inspector, and V8-specific APIs.
- Extensive compatibility testing.

The first products should instead expose focused APIs:

```text
@nts/application
@nts/filesystem
@nts/network
@nts/secure-store
@nts/clipboard
@nts/settings
```

A later Node profile may reuse:

- Pinned Deno-derived TypeScript behavior.
- Node tests.
- Existing native host capabilities.
- Oxc resolution where suitable.
- An explicit dynamic realm for fundamentally dynamic modules.

The Node profile must not become a dependency of React, native UI, modules, or the compiler.

---

# 30. React and Renderers

## 30.1 React compatibility boundary

```text
frameworks/react/
├── vendor
├── compiler-profile
├── static-compatibility
├── transforms
├── reconciler-adapter
├── refresh
├── feature-flags
└── conformance
```

Only this area may depend on pinned React internals.

## 30.2 Shared native UI renderer

Written in TypeScript, it owns:

```text
renderer tree
stable node identity
generation checks
commit batches
portable events
public refs
layout snapshots
surface lifecycle
React HostConfig
refresh boundaries
```

## 30.3 Platform UI hosts

Own:

```text
create native view
update native view
insert/remove/reorder
measure
focus/blur
scroll
accessibility
native event ingress
destroy
```

## 30.4 Renderers

```text
renderers/
├── react-native-ui
├── react-dom
├── react-test
└── react-terminal-later
```

### React native UI

```text
React
  ↓
reconciler
  ↓
shared TypeScript native renderer
  ↓
Android / UIKit / AppKit / WinUI / GTK
```

### React DOM

```text
React
  ↓
compiled DOM renderer
  ↓
generated direct Blink calls
```

### Test renderer

A deterministic in-memory renderer is mandatory for:

- React refresh tests.
- Renderer conformance.
- Module view tests.
- Commit diff testing.
- GC lifecycle testing.

---

# 31. Native TypeScript Module System

The module system should provide an Expo-like authoring experience while using:

- Build-time schemas.
- Generated direct calls.
- No JSI requirement.
- No runtime reflection requirement.
- Whole-program reachability.
- Generated IPC where required.
- Shared TypeScript facades.
- Platform-specific implementations.

## 31.1 Module schema

```ts
export default defineModule({
  name: "Clipboard",
  version: 1,

  methods: {
    getString: asyncMethod({
      parameters: [],
      result: t.string,
    }),

    setString: asyncMethod({
      parameters: [{ name: "value", type: t.string }],
      result: t.void,
    }),
  },

  events: {
    changed: event({
      contentType: t.string,
    }),
  },

  capabilities: ["clipboard"],

  availability: {
    android: true,
    ios: true,
    macos: true,
    windows: true,
    gtk: true,
    chromiumRenderer: "proxy",
  },
});
```

## 31.2 Generated outputs

```text
TypeScript facade
Rust trait
C ABI
Java interface
Kotlin convenience API
Swift protocol
Objective-C interoperability header
C++ interface
WinRT facade
GTK declarations
Mojo proxy
test mock
documentation
```

## 31.3 Desktop modules

```text
modules/desktop/
├── app
├── window
├── menu
├── tray
├── dialog
├── shell
├── global-shortcut
├── screen
├── power-monitor
├── protocol
└── updater
```

Common services such as clipboard, notifications, and filesystem should be reused by native desktop and Chromium products.

---

# 32. Development and Hot Reload

## 32.1 Development mode

Development mode is a product composed of:

```text
persistent TypeScript frontend
Rust compiler daemon
module graph
semantic diff
artifact cache
target build session
development agent
update protocol
React Refresh
debug registry
GC generation registry
overlay
devtools
```

## 32.2 Update classes

```text
refresh-compatible
module-replaceable
React-remount
runtime-realm-restart
renderer-process-restart
native-host-rebuild
```

## 32.3 Native patch loading

Desktop native targets may load:

```text
.so
.dylib
.dll
```

as new module generations.

Stable export slots redirect calls to the current generation.

## 32.4 Android JVM patching

```text
changed TS
    ↓
JVM classes
    ↓
incremental D8
    ↓
DEX payload
    ↓
generation class loader
```

Objects from old generations remain valid until the old class loader and all its objects become unreachable.

## 32.5 GC interaction

A patch must register:

```text
type descriptors
trace descriptors
static roots
code ranges
source maps
module exports
```

A patch cannot unload while the GC can still discover an object whose descriptor or method table resides in that patch.

## 32.6 Last-known-good execution

A compile error must leave the current generation running and display an overlay.

## 32.7 Apple development

Baseline promise:

```text
macOS:
    native patch loading

iOS simulator:
    native patch loading where supported

physical iOS:
    incremental rebuild, reinstall, relaunch, state restore

release:
    no development loader
```

## 32.8 Chromium development

Prefer:

1. Renderer module patch.
2. Native TypeScript realm restart.
3. Renderer-process restart.
4. Full browser-product restart.

Browser-process window and application state should survive a renderer restart when safe.

---

# 33. Tooling and Oxc

Oxc currently provides Rust-based TypeScript/JavaScript parsing, transformation, React Refresh instrumentation, and module resolution components.

Good uses:

```text
fast import/export scanning
speculative dev module graph
config loading
React Refresh instrumentation experiments
module-manifest parsing
asset dependency scanning
package resolution candidate
fast linting and formatting
```

`oxc_resolver` supports TypeScript path and project-reference behavior useful for a fast build graph, although TypeScript remains the semantic authority.

Oxc should not own:

```text
TypeScript type semantics
overload resolution
narrowing
HIR
MIR
ownership analysis
memory lowering
canonical module graph
```

The rule is:

> Oxc accelerates source-oriented tooling. TypeScript supplies semantic authority. Native TypeScript owns compilation semantics.

---

# 34. Configuration Example

```ts
import {
  defineConfig,
  app,
  library,
  target,
  host,
  profile,
  memory,
  debug,
  react,
  modules,
} from "@native-typescript/config";

export default defineConfig({
  workspace: {
    root: ".",
    tsconfig: "./tsconfig.json",
  },

  defaults: {
    debug: debug.development({
      sourceMaps: "full",
      asyncStacks: true,
      localVariables: true,
      pathRemap: {
        [process.cwd()]: "nts-workspace:///",
      },
    }),
  },

  products: {
    android: app({
      entry: "./src/mobile.tsx",
      id: "dev.akis.example",

      target: target.android({
        backend: "jvm",
        minSdk: 26,
      }),

      runtime: {
        family: "jvm",
        memory: memory.hostGC(),
      },

      host: host.android({
        scheduler: "looper",
        frameClock: "choreographer",
        fetch: "okhttp",
        websocket: "okhttp",
        ui: "android-views",
      }),

      profiles: [profile.ecmascript(), profile.web(), react.native()],

      modules: [modules.application(), modules.clipboard(), modules.haptics()],
    }),

    ios: app({
      entry: "./src/mobile.tsx",
      id: "dev.akis.example",

      target: target.ios({
        backend: "llvm",
        minimumVersion: "17.0",
      }),

      runtime: {
        family: "native",
        memory: memory.rcCycle({
          cycleCollection: "incremental",
        }),
      },

      host: host.ios({
        scheduler: "dispatch-main",
        frameClock: "display-link",
        fetch: "url-session",
        websocket: "url-session",
        ui: "uikit",
      }),

      profiles: [profile.ecmascript(), profile.web(), react.native()],
    }),

    linuxMmtkExperiment: app({
      entry: "./src/mobile.tsx",

      target: target.linux({
        backend: "llvm",
      }),

      runtime: {
        family: "native",
        memory: memory.mmtk({
          experimental: true,
          plan: "MarkSweep",
          minHeap: "32MiB",
          maxHeap: "512MiB",
        }),
      },

      host: host.gtk({
        ui: "gtk4",
      }),
    }),

    coreLibrary: library({
      entry: "./src/library.ts",
      kind: "shared",
      runtimeLinkage: "bundled-private",

      runtime: {
        memory: memory.rcCycle(),
      },

      exports: ["createClient", "processMessage", "destroyClient"],
    }),
  },

  dev: {
    hmr: {
      mode: "auto",
      preserveReactState: true,
      keepLastGoodGeneration: true,

      fallback: ["component-remount", "realm-restart", "process-restart", "native-rebuild"],
    },

    debug: {
      heapInspector: true,
      allocationSampling: true,
      gcTimeline: true,
      sourceBreakpoints: true,
    },

    overlay: true,
    devtools: true,
  },

  build: {
    cache: {
      local: true,
      directory: ".nts/cache",
    },

    symbols: {
      release: "separate",
      sourcesContent: false,
    },

    provenance: true,
    stripDevelopmentRuntime: true,
  },
});
```

---

# 35. Updated Repository Structure

```text
native-typescript/
│
├── compiler/
│   ├── frontend-ts/
│   │   ├── program/
│   │   ├── checker/
│   │   ├── module-resolution/
│   │   ├── semantic-snapshot/
│   │   └── diagnostics/
│   │
│   ├── semantic-schema/
│   │   ├── schema/
│   │   ├── generated-ts/
│   │   ├── generated-rust/
│   │   └── compatibility/
│   │
│   ├── core/
│   │   ├── hir/
│   │   ├── mir/
│   │   ├── reachability/
│   │   ├── specialization/
│   │   ├── effects/
│   │   ├── ownership/
│   │   ├── escape-analysis/
│   │   ├── closures/
│   │   ├── async-lowering/
│   │   ├── module-lowering/
│   │   ├── native-lowering/
│   │   └── validation/
│   │
│   ├── memory-lowering/
│   │   ├── managed-refs/
│   │   ├── allocation/
│   │   ├── roots/
│   │   ├── liveness/
│   │   ├── safepoints/
│   │   ├── barriers/
│   │   ├── weak-refs/
│   │   ├── pinning/
│   │   ├── identity/
│   │   └── trace-descriptors/
│   │
│   ├── debug-lowering/
│   │   ├── origins/
│   │   ├── lexical-scopes/
│   │   ├── inline-chains/
│   │   ├── async-sites/
│   │   ├── variable-locations/
│   │   └── generated-frames/
│   │
│   ├── codegen/
│   │   ├── c/
│   │   ├── llvm/
│   │   └── jvm/
│   │
│   ├── jvm-emitter/
│   ├── dev-lowering/
│   └── conformance/
│
├── memory/
│   ├── contract/
│   │   ├── provider/
│   │   ├── object-model/
│   │   ├── roots/
│   │   ├── barriers/
│   │   ├── weak/
│   │   ├── finalization/
│   │   ├── pinning/
│   │   ├── external-memory/
│   │   ├── pressure/
│   │   └── statistics/
│   │
│   ├── descriptors/
│   │   ├── types/
│   │   ├── tracing/
│   │   ├── snapshots/
│   │   └── generations/
│   │
│   ├── native/
│   │   ├── no-gc/
│   │   ├── rc-cycle/
│   │   │   ├── allocator/
│   │   │   ├── retain-release/
│   │   │   ├── cycle-detector/
│   │   │   ├── collector/
│   │   │   ├── weak/
│   │   │   └── instrumentation/
│   │   │
│   │   ├── mmtk/
│   │   │   ├── binding/
│   │   │   ├── object-model/
│   │   │   ├── mutators/
│   │   │   ├── root-scanning/
│   │   │   ├── barriers/
│   │   │   ├── weak-processing/
│   │   │   ├── finalization/
│   │   │   ├── options/
│   │   │   ├── statistics/
│   │   │   └── conformance/
│   │   │
│   │   └── testkit/
│   │
│   ├── jvm/
│   │   ├── host-gc/
│   │   ├── weak/
│   │   ├── external-memory/
│   │   └── diagnostics/
│   │
│   ├── foreign-heaps/
│   │   ├── jvm/
│   │   ├── oilpan/
│   │   ├── objc-arc/
│   │   ├── gobject/
│   │   ├── winrt/
│   │   └── js-engines/
│   │
│   └── conformance/
│
├── debug/
│   ├── provenance/
│   │   ├── schema/
│   │   ├── graph/
│   │   ├── composition/
│   │   └── path-remapping/
│   │
│   ├── nts-debug-map/
│   │   ├── writer/
│   │   ├── reader/
│   │   ├── index/
│   │   └── verifier/
│   │
│   ├── source-map-ecma426/
│   ├── native/
│   │   ├── dwarf/
│   │   ├── codeview/
│   │   ├── pdb/
│   │   ├── dsym/
│   │   └── build-id/
│   │
│   ├── jvm/
│   │   ├── line-tables/
│   │   ├── local-variables/
│   │   ├── smap/
│   │   ├── dex/
│   │   └── r8/
│   │
│   ├── async-stacks/
│   ├── hmr-generations/
│   ├── debugger/
│   │   ├── adapter/
│   │   ├── breakpoints/
│   │   ├── stepping/
│   │   └── frame-filtering/
│   │
│   ├── symbolication/
│   ├── crash/
│   │   ├── schema/
│   │   ├── capture/
│   │   ├── crashpad/
│   │   └── uploader/
│   │
│   └── testkit/
│
├── abi/
│   ├── runtime/
│   ├── embedding/
│   ├── libraries/
│   ├── modules/
│   ├── capabilities/
│   ├── renderers/
│   ├── callbacks/
│   ├── handles/
│   ├── errors/
│   ├── memory/
│   ├── ipc/
│   └── generated/
│       ├── c/
│       ├── rust/
│       ├── java/
│       ├── kotlin/
│       ├── swift/
│       └── cpp/
│
├── build/
│   ├── model/
│   │   ├── target/
│   │   ├── backend/
│   │   ├── runtime/
│   │   ├── memory/
│   │   ├── host/
│   │   ├── profile/
│   │   ├── capability/
│   │   ├── framework/
│   │   ├── renderer/
│   │   ├── product/
│   │   └── debug/
│   │
│   ├── graph/
│   ├── cache/
│   │   ├── cas/
│   │   ├── action-cache/
│   │   └── remote/
│   ├── executor/
│   ├── resolver/
│   ├── linker/
│   ├── packager/
│   ├── assets/
│   ├── symbols/
│   ├── toolchains/
│   └── provenance/
│
├── runtime/
│   ├── native/
│   │   ├── core/
│   │   ├── values/
│   │   ├── strings/
│   │   ├── arrays/
│   │   ├── objects/
│   │   ├── closures/
│   │   ├── exceptions/
│   │   ├── promises/
│   │   ├── async-frames/
│   │   ├── microtasks/
│   │   ├── modules/
│   │   ├── handles/
│   │   ├── callbacks/
│   │   ├── resources/
│   │   ├── thread-attachment/
│   │   ├── shutdown/
│   │   └── c-api/
│   │
│   ├── jvm/
│   │   ├── core/
│   │   ├── values/
│   │   ├── promises/
│   │   ├── async-frames/
│   │   ├── microtasks/
│   │   ├── modules/
│   │   ├── resources/
│   │   ├── shutdown/
│   │   └── host-api/
│   │
│   └── conformance/
│
├── libraries/
│   ├── ecmascript/
│   ├── web/
│   │   ├── events/
│   │   ├── abort/
│   │   ├── encoding/
│   │   ├── base64/
│   │   ├── console/
│   │   ├── url/
│   │   ├── streams/
│   │   ├── blobs/
│   │   ├── forms/
│   │   ├── fetch/
│   │   ├── websocket/
│   │   ├── timing/
│   │   └── geometry/
│   │
│   └── node/
│       ├── modules/
│       ├── internal-contract/
│       ├── vendor/
│       └── conformance/
│
├── capabilities/
│   ├── contracts/
│   │   ├── scheduler/
│   │   ├── timers/
│   │   ├── frame-clock/
│   │   ├── fetch-transport/
│   │   ├── websocket-transport/
│   │   ├── filesystem/
│   │   ├── network/
│   │   ├── process/
│   │   ├── ui-host/
│   │   ├── image-loader/
│   │   ├── text-measurement/
│   │   ├── clipboard/
│   │   ├── notifications/
│   │   ├── logging/
│   │   ├── lifecycle/
│   │   ├── memory-pressure/
│   │   └── permissions/
│   │
│   ├── schema/
│   ├── codegen/
│   └── testkit/
│
├── hosts/
│   ├── standalone-libuv/
│   ├── android/
│   ├── apple/
│   │   ├── common/
│   │   ├── ios/
│   │   └── macos/
│   ├── windows/
│   ├── gtk/
│   └── chromium/
│       ├── common/
│       ├── renderer/
│       ├── browser/
│       ├── scheduler-task-runner/
│       ├── blink/
│       ├── oilpan-handles/
│       ├── fetch-blink/
│       ├── websocket-blink/
│       ├── mojo/
│       └── lifecycle/
│
├── frameworks/
│   ├── react/
│   └── native-ui/
│       ├── renderer-core/
│       ├── component-model/
│       ├── tree/
│       ├── identity/
│       ├── commit/
│       ├── events/
│       ├── public-instances/
│       ├── styles/
│       ├── layout/
│       ├── surfaces/
│       ├── embedding-api/
│       └── testkit/
│
├── renderers/
│   ├── react-native-ui/
│   ├── react-dom/
│   ├── react-test/
│   └── react-terminal/
│
├── modules/
│   ├── core/
│   ├── sdk/
│   ├── desktop/
│   └── templates/
│
├── layout/
├── bindings/
├── targets/
├── products/
│
├── dev/
│   ├── server/
│   ├── compiler-daemon/
│   ├── module-graph/
│   ├── semantic-diff/
│   ├── update-classifier/
│   ├── protocol/
│   ├── transport/
│   ├── agent-core/
│   ├── agents/
│   ├── hmr-runtime/
│   ├── overlay/
│   ├── inspector/
│   ├── heap-inspector/
│   ├── gc-timeline/
│   ├── devtools/
│   └── testkit/
│
├── tooling/
│   ├── cli/
│   ├── config/
│   ├── create/
│   ├── doctor/
│   ├── inspect/
│   ├── symbolicate/
│   ├── lsp/
│   ├── debug-adapter/
│   ├── vscode/
│   ├── intellij/
│   ├── gradle-plugin/
│   ├── xcode/
│   ├── swift-package/
│   ├── cmake/
│   ├── msbuild/
│   ├── nuget/
│   ├── gn/
│   └── vite-adapter/
│
├── third_party/
│   ├── scriptc-snapshot/
│   ├── mmtk/
│   ├── libuv/
│   ├── react/
│   ├── yoga/
│   └── deno-node/
│
├── examples/
├── tests/
│   ├── language/
│   ├── compiler/
│   ├── memory/
│   │   ├── roots/
│   │   ├── barriers/
│   │   ├── moving/
│   │   ├── weak/
│   │   ├── finalization/
│   │   ├── cross-heap/
│   │   ├── multi-runtime/
│   │   ├── pressure/
│   │   └── stress/
│   │
│   ├── debug/
│   │   ├── source-maps/
│   │   ├── dwarf/
│   │   ├── pdb/
│   │   ├── jvm/
│   │   ├── r8/
│   │   ├── async/
│   │   └── hmr/
│   │
│   ├── runtime/
│   ├── libraries/
│   ├── capabilities/
│   ├── modules/
│   ├── frameworks/
│   ├── renderers/
│   ├── hosts/
│   ├── products/
│   ├── hmr/
│   ├── differential/
│   ├── lifecycle/
│   ├── abi/
│   └── performance/
│
└── docs/
    ├── architecture/
    ├── rfcs/
    ├── decisions/
    ├── memory/
    ├── debugging/
    ├── compatibility/
    ├── modules/
    ├── renderers/
    ├── development/
    └── migration/
```

---

# 36. Testing Strategy

## 36.1 Memory-provider differential testing

Run the same program under:

```text
RC-cycle
MMTk MarkSweep
MMTk SemiSpace
JVM
reference JavaScript engine
```

Compare:

- Observable output.
- Exceptions.
- Weak behavior.
- Finalization constraints.
- Shutdown.
- Leaks.
- Object identity.
- Callback lifetime.

## 36.2 Moving-GC verifier

A moving collector should be used as a correctness tool even before it becomes a shipping default.

Stress configuration:

```text
tiny heap
collection on frequent allocation
aggressive movement
address randomization
root poisoning
old-address poisoning
```

This catches:

- Raw managed pointers in C structs.
- Missing roots.
- Missing slot updates.
- Incorrect identity hashing.
- Unsafe FFI borrowing.
- HMR descriptors that were unloaded too early.

## 36.3 Barrier testing

Every reference-store family should have:

- Unit tests.
- Generated MIR tests.
- RC audit.
- Generational remembered-set tests.
- Concurrent barrier tests if supported.

## 36.4 Shared-library tests

Repeatedly:

```text
load library
create runtime
execute
destroy runtime
unload library
```

Test multiple libraries and runtime instances in one process.

## 36.5 Cross-heap tests

```text
TS ↔ Android event listener
TS ↔ Blink event listener
TS ↔ UIKit callback
TS ↔ GObject signal
TS ↔ WinRT event
```

Prove cancellation, invalidation, and no permanent cycles.

## 36.6 Debug tests

Golden tests should verify:

- TypeScript breakpoints.
- Inlined frames.
- Async stacks.
- Generated adapter filtering.
- HMR breakpoint rebinding.
- C `#line`.
- LLVM DWARF.
- Windows PDB.
- JVM line tables and SMAP.
- R8 retrace composition.
- dSYM symbolication.
- Release path privacy.

## 36.7 Sanitizers and stress

Use where supported:

```text
ASan
UBSan
TSan
Rust Miri for isolated components
MMTk sanity modes
reference-count audits
heap verification
GC stress
fault injection
OOM injection
```

---

# 37. Phased Plan

## Phase 0: Freeze and define contracts

- Freeze the current ScriptC fork.
- Stop routine upstream rebasing.
- Extract tests and semantic behavior.
- Define semantic snapshot.
- Define HIR and MIR.
- Define managed-reference MIR.
- Define debug provenance.
- Define runtime, ABI, and product models.

## Phase 1: Native compiler foundation

- Rust compiler core.
- C and LLVM backends.
- NoGC provider.
- RC-cycle provider.
- Shadow root frames.
- Type descriptors.
- `.ntsdbg` format.
- Executable, static-library, and shared-library products.
- Source-level native stack traces.

## Phase 1 parallel experiment: MMTk falsifier

- Linux x86-64 only.
- NoGC integration.
- MarkSweep.
- Root and barrier stress.
- SemiSpace movement test.
- No product dependency on success.

## Phase 2: JVM and Android

- JVM lowering.
- Java runtime.
- Android Looper host.
- ART object model.
- JVM line tables and SMAP.
- Android DEX mapping.
- AAR product.
- Cross-backend conformance.

## Phase 3: Portable Web foundation

- Events.
- Abort.
- Encoding.
- URL.
- Streams.
- Bodies.
- Fetch semantics.
- WebSocket semantics.
- Android and standalone transports.

## Phase 4: Module system

- Module schema.
- Methods and events.
- Async methods.
- Native views.
- Autolinking.
- Project contributions.
- Code generation.
- Initial application, settings, clipboard, haptics, and secure-store modules.

## Phase 5: React and Android native UI

- Pinned React.
- Shared TypeScript renderer.
- React HostConfig.
- Android UI host.
- Embeddable React surfaces.
- GC and lifecycle stress.
- Heap inspector for renderer trees.

## Phase 6: Development system

- Persistent daemon.
- Semantic diff.
- Native patch libraries.
- Android DEX patching.
- React Refresh.
- Last-known-good execution.
- Source breakpoint rebinding.
- GC generation tracking.
- Unified overlay and devtools.

## Phase 7: Apple, Windows, and GTK

- Platform hosts.
- Framework and library products.
- PDB and dSYM pipelines.
- Platform module implementations.
- Simulator/desktop HMR.
- Physical-device rebuild-and-restore.

## Phase 8: MMTk qualification

- Apple ARM64 evaluation.
- Windows evaluation.
- Multiple-runtime decision.
- Immix and moving plans.
- Weak/finalization compatibility.
- Performance qualification.
- Decision on whether any targets adopt it by default.

## Phase 9: Desktop modules and Chromium

- Desktop service modules.
- Chromium browser-process implementations.
- Generated Mojo proxies.
- Direct Blink renderer.
- Oilpan bridge.
- React DOM renderer.
- Renderer crash and symbolication.
- Chromium HMR/restart flow.

## Phase 10: Optional Node compatibility

- Explicit compatibility version.
- Pinned Deno-derived implementations.
- Node test subsets.
- CommonJS and resolution.
- Modules added incrementally.
- Dynamic realm for VM-dependent behavior.

---

# 38. Risks and Open Questions

## 38.1 RC performance

Reference counting may become expensive in renderer-heavy workloads.

Mitigation:

- Ownership and escape analysis.
- Elided retains/releases.
- Borrowed references.
- Batch operations.
- Deferred release.
- MMTk performance lane.

## 38.2 MMTk maturity

MMTk may remain unsuitable on some product targets.

Mitigation:

- Provider abstraction.
- RC shipping path.
- Exact version pinning.
- No public MMTk types.
- Early integration as a falsifier.

## 38.3 Multiple heaps

MMTk’s current multi-instance limitations conflict with bundled-private shared libraries.

Mitigation:

- Restrict provider/product combinations.
- RC for private runtimes.
- One composed runtime for MMTk.
- Revisit when upstream support changes.

## 38.4 Cross-heap cycles

Separate GCs cannot automatically collect arbitrary cycles spanning both heaps.

Mitigation:

- Explicit bridge ownership.
- Callback tokens.
- Weak foreign edges.
- Registration resources.
- Deterministic teardown.

## 38.5 Optimized debugging

Aggressive specialization and inlining can make local variables unavailable.

Mitigation:

- Distinct debug profile.
- Preserve lexical scopes and origins.
- Honest “optimized out” reporting.
- Full line and frame fidelity before perfect variable fidelity.

## 38.6 HMR memory growth

Keeping old code generations loaded consumes memory.

Mitigation:

- Show generation-retention reasons.
- Allow manual realm restart.
- Periodically recommend restart.
- Add safe unloading only after correctness.

## 38.7 Async source fidelity

State-machine lowering can make physical stacks misleading.

Mitigation:

- Logical async parent chains.
- Source-site metadata.
- Unified exception formatting.

## 38.8 Memory-pressure behavior

Platform hosts report pressure differently.

Mitigation:

- One memory-pressure capability.
- Provider-independent external-byte accounting.
- Host-specific policies.

---

# 39. Final Decisions

This RFC adopts the following durable decisions:

1. Memory management is a build-composed provider.
2. Managed references remain abstract until provider lowering.
3. RC plus cycle collection is the first native shipping provider.
4. MMTk is integrated early as an experimental provider.
5. MMTk is not the initial universal production default.
6. MMTk is not used for JVM/ART-managed objects.
7. MMTk is not used to own Blink/Oilpan objects.
8. MMTk builds are initially restricted to compatible product and platform combinations.
9. Native C and LLVM backends initially use explicit shadow root frames.
10. LLVM statepoints may be introduced later behind a pinned adapter.
11. Moving-GC tests are mandatory even if the shipping collector is initially non-moving.
12. Public ABIs never expose raw managed pointers.
13. Independent runtimes do not share ordinary managed references.
14. Foreign platform objects use generation-checked handles.
15. Arbitrary bidirectional cross-heap ownership is forbidden.
16. Native resources require explicit lifecycle management.
17. Weak and finalization APIs are implemented only through a shared collector-neutral contract.
18. External memory and platform pressure are first-class runtime inputs.
19. Source maps are part of a larger debug-provenance system.
20. Every HIR and MIR operation carries source provenance.
21. Native output emits DWARF or CodeView/PDB as appropriate.
22. JVM output emits source, line, local-variable, and SMAP metadata.
23. Android release symbolication composes R8 and Native TypeScript mappings.
24. HMR generations retain matching code, GC descriptors, and debug maps.
25. Crash artifacts carry product build IDs and Native TypeScript debug-map identities.
26. Broad Node.js compatibility remains a later product phase.

# 40. Recommended First Vertical Slice

The first complete vertical slice should be:

```text
TypeScript semantic snapshot
        ↓
Rust HIR/MIR
        ↓
managed-reference MIR
        ↓
RC-cycle native provider
        ↓
C and LLVM
        ↓
native shared library
        ↓
shadow roots and debug provenance
        ↓
DWARF/PDB/dSYM-ready output
        ↓
desktop hot replacement
```

Run beside it from the beginning:

```text
same HIR/MIR
        ↓
MMTk NoGC
        ↓
MMTk MarkSweep
        ↓
MMTk SemiSpace stress
```

Then the JVM slice:

```text
same TypeScript semantics
        ↓
JVM lowering
        ↓
ART-managed objects
        ↓
Android Looper
        ↓
shared TypeScript Web APIs
        ↓
shared React renderer
        ↓
Android View host
        ↓
DEX hot replacement
        ↓
JVM/SMAP/R8 source mapping
```

These lanes together prove the essential promise:

> One TypeScript semantic architecture, multiple managed-memory implementations, multiple native execution models, real applications and shared libraries, platform-native host behavior, source-level debugging, and a Vite-quality development loop—without making Node.js, a JavaScript engine, or one experimental collector the foundation of the project.

references: https://github.com/AkisArou/jvm-www
