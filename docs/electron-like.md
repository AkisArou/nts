# Electron-like runtime: exploration and experiment plan

**Status:** Initial RFC; architecture under investigation, not an implementation specification.  
**Reviewed:** 2026-10-05 against the current compiler and runtimes.  
**Name:** `electron-like` is a temporary code name.

The original generated proposal is retained below. This review grounds it in
the repository and proposes experiments that can confirm or reject its
assumptions. Its `MUST`/`SHOULD` language describes proposed goals, not an
implemented contract. The experiment order here supersedes the original
sections 66 and 73. Handle layouts, HIR additions, package formats, and a
stable ABI remain open until there is execution evidence.

E0 and E1 passed at the pinned Chromium revision, with both C and LLVM native
libraries running in sandboxed renderers. The next experiment now creates
real Blink nodes through a small direct bridge and matches the V8 fixtures'
DOM, UTF-16 units, and complete mixed microtask/custom-element/MutationObserver
traces. Both backends pass. The owned shell and Blink target need no tracked
Chromium source changes. The supported E2 subset passes; E3 remains partial
because general event semantics, generated-await cancellation, rejection
maintenance and task/timer posting are unresolved. React is outside the
current work. See [bring-up](../runtime/chromium/experiments/bringup.md) and
[DOM/scheduling evidence](../runtime/chromium/experiments/dom-and-microtasks.md).

## Recommendation

Investigate a Chromium `content/` embedder with NTS application code statically
linked into its sandboxed renderer. Start from `content_shell`, prove a small
native DOM program, then add events, lifecycle, and shared microtask scheduling.
Use the existing C backend as a bring-up oracle and repeat the program through
LLVM. This can progress independently of a complete React or Node runtime.

For the direct Blink path, use a source build of Chromium. Vendor a pinned
source submodule under `third_party/chromium/src`, with its `DEPS` managed by
`depot_tools`/`gclient`, NTS-owned integration sources, and a small reproducible
patch set only where existing seams are insufficient. Copying `content/`
alone is insufficient: it depends on Blink, V8, networking, graphics, Mojo,
the Chromium build system, and dependencies resolved through `DEPS`.
Chromium documents `content_shell` as its basic content embedder and separates
the Web platform from Chrome product features. [Content module](https://chromium.googlesource.com/chromium/src/+/main/content/README.md).

CEF remains a possible comparison if the objective becomes a conventional
browser shell with native business logic. Its abstraction does not establish
the proposed direct, comprehensive Blink binding surface. A JS bridge can be a
useful baseline, but results through that bridge would not prove the direct
native-to-Blink hypothesis.

## What the repository already has

The code and current lane documents, rather than `docs/RFC.md`, are the basis
of this assessment. Some crate comments describe future architecture; the
call paths are more authoritative.

| Area | Observed starting point | Consequence for this RFC |
| --- | --- | --- |
| Frontend and IR | [`frontend-ts`](../compiler/frontend-ts/src/lib.rs) obtains checked facts from tsgo; [`emit_llvm`](../tooling/cli/src/main.rs) calls `hir::prepare_with` and emits that program | The current path is checked source → semantic snapshot → typed SSA HIR and shared passes → backend. A separate MIR and `web.*`/`HostRef` instruction family are proposals, not prerequisites. |
| Backends | [`C`](../compiler/codegen/c/src/lib.rs), [`LLVM`](../compiler/codegen/llvm/src/lib.rs), and [`JVM`](../compiler/codegen/jvm/src/lib.rs) consume the shared program | Chromium desktop bring-up uses the native lanes. JVM remains a compiler target; a JVM browser host would be a separate JNI/WebView integration project. |
| Native interop | [`hir/native.rs`](../compiler/core/src/hir/native.rs) carries authored ABI and retention facts; [`native_callback.rs`](../compiler/core/src/hir/native_callback.rs) checks callback constraints | Start with existing foreign calls and callbacks. Reduce missing constructs for the compiler lane instead of introducing a new host IR immediately. |
| C embedding | [`ts-from-c`](../examples/interop/ts-from-c/README.md) exports a generated header and static library | A compiled library can be called from a renderer-owned C shim; it need not start its own executable or event loop. |
| Scheduling | [`NtsHost`](../runtime/c/nts_runtime.h) includes `enqueue_microtask`; [`nts_enqueue_microtask`, `nts_leave`, and `nts_checkpoint`](../runtime/c/nts_runtime.c) already delegate queue ownership when it is installed | The Blink seam exists, but no Chromium implementation was found. Queue selection, callback entry, teardown, rejection reporting, and collector maintenance still need a real host. |
| Module instances | [`C global emission`](../compiler/codegen/c/src/emit.rs) and [`LLVM global emission`](../compiler/codegen/llvm/src/lib.rs) emit module variables as static/global storage | An NTS environment isolates runtime state, not compiled module globals. Multiple documents using one linked image need a separate module-instance/reset contract. |
| Memory | [`hir/rc.rs`](../compiler/core/src/hir/rc.rs) and the C runtime implement reference counting and cycle collection; plain `Opaque` C pointers have manual lifetimes | The original proposal's unspecified native tracing GC is not the current memory model. Oilpan roots and cycles crossing DOM/listener/native closures need explicit investigation. |
| React | [`runtime/react`](../runtime/react/README.md) owns a React-compatible runtime, with typed JSX lowering, scheduler and host seams; [`upstream-compile`](../runtime/react/upstream-compile/README.md) records the retired upstream-compilation route | “Compile upstream React and ReactDOM unchanged” conflicts with the current lane direction. Reuse the existing runtime for an experimental DOM host; upstream ReactDOM behavior remains a separate compatibility obligation. |
| Web and Node APIs | [`web-platform`](../runtime/web-platform/README.md) owns shared server/mobile Web algorithms; [`node`](../runtime/node/README.md) owns Node-compatible modules over native capabilities | In a Chromium renderer, Blink should supply browser DOM/network/storage semantics. Do not silently substitute server/mobile Fetch, EventTarget, or storage implementations. A full native Node main process is a later integration milestone. |

The existing C embedding example was run successfully during this review:
`examples/interop/ts-from-c/build.sh /tmp/nts-electron-rfc-review/c-embedding`.
Its scalar, string, object, generator, and promise observations matched the
example's documented output. This used the available `target/release/nts`
binary dated October 3; it is evidence for that embedding path, not a fresh
compiler build or a Chromium acceptance result.

## Assumptions to resolve

**Native execution is not a complete JavaScript realm.** NTS uses static
representations; [`TypeScript conformance §13`](conformance/typescript.md#13-what-this-compiler-is-not)
explicitly excludes several dynamic object-model operations. The prototype
epochs, arbitrary DOM expandos, `Proxy`, and transparent `JSRef` property calls
below would require substantial new language/runtime behavior. A practical
first profile is typed AOT application code with a declared browser API subset,
plus explicit V8 interop. Preserve the long-term compatibility questions,
but do not promise that every npm/browser program compiles in that profile.

**Direct calls must implement binding semantics.** Blink's public embedder API
is not a complete WebIDL API: for example, `WebNode::QuerySelector` returns
null when the JS API would throw. Forwarding it cannot distinguish an invalid
selector from a missing match. Chromium also requires code outside Blink to
use its public API. Therefore a faithful direct bridge will likely need a
small, version-specific implementation compiled within Blink's layering and
exposed through a narrow public entry point. This is an inference from the
current [WebNode header](https://github.com/chromium/chromium/blob/main/third_party/blink/public/web/web_node.h)
and [Blink layering rules](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/README.md),
to be tested at the chosen Chromium pin.

The bridge must reproduce conversion, overload, nullable result, exception,
custom-element reaction, and execution-context behavior from the existing
bindings for each operation it implements. Some operations need `ScriptState`
or V8-backed state even when their caller is native. “V8 does not execute the
packaged application” is a useful target; “Blink never enters V8” is not.

**Isolation follows processes and origins.** Separate native and V8 globals
do not create a security boundary against arbitrary native execution in the
same renderer. Remote scripts loaded into the application document also share
its origin and can mutate its DOM or trigger native listeners. Browser-side
services must validate and scope authority to the calling document; an
untrusted remote UI should use a separate origin/frame with ordinary Chromium
isolation. A renderer-local handle check is a correctness measure, not a
defense against a fully compromised renderer. [Mojo security guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/mojo.md).

**Lifetime and scheduling are early acceptance gates.** A retained native DOM
reference needs an Oilpan root. A DOM event listener retaining an NTS closure
which captures that reference can form a cross-runtime cycle. Existing native
foreign-holder support is useful precedent, but Oilpan does not have GObject's
reference counts. Explicit listener removal and document disposal can bound
the first experiment; that does not solve general cross-heap collection or
WeakRef/FinalizationRegistry semantics.

Likewise, install `NtsHost.enqueue_microtask` into the document agent's actual
queue rather than enqueueing on an arbitrary isolate-wide queue. Blink exposes
`EventLoop::EnqueueMicrotask` and end-of-checkpoint facilities, giving us a
concrete integration candidate. The correct queue and scopes must be checked
at the pin and tested against V8 promises and observers.
[Blink EventLoop](https://chromium.googlesource.com/chromium/src/+/master/third_party/blink/renderer/platform/scheduler/public/event_loop.h).

**A stable ABI is a later hypothesis.** The first experiment can rebuild its
application and bridge together with Chromium. Keep Blink pointers and C++
types private from the start, but defer import-table negotiation and long-term
binary compatibility. Neither an arbitrary 64-bit token passed as a TS
`number` nor a raw `Opaque` pointer automatically supplies safe managed DOM
identity: the former needs exact representation, and the latter receives no
automatic retain/release.

## Experiment sequence

These are proposed experiments with decision gates, not committed delivery
dates or final API definitions. The current scope is the DOM counter, native
events, document lifetime and scheduling. React remains deferred.

### E0: reproducible Chromium baseline

Choose a supported Linux x86-64 build host and an exact Chromium source
revision, preferably from a maintained stable release. Record the resolved
dependency revisions, toolchain, GN arguments, and build/launch commands.
Build and run unmodified `content_shell` before applying any NTS changes.
Start with a component debug build for iteration; size/performance measurements
later require a separate optimized distribution build.

The opt-in checkout and baseline build now have a repository-owned wrapper:

```sh
node tooling/chromium/chromium.ts bootstrap
node tooling/chromium/chromium.ts sync --jobs 8
node tooling/chromium/chromium.ts hooks
node tooling/chromium/chromium.ts gen
node tooling/chromium/chromium.ts build --jobs 8
node tooling/chromium/smoke.ts
```

Check the flags and target at the selected revision. Chromium's official
[Linux build guide](https://chromium.googlesource.com/chromium/src/+show/main/docs/linux/build_instructions.md)
requires at least 100 GB of free disk and recommends more than 16 GB of RAM.
After the user reclaimed disk space, checkout, build, and sandboxed baseline
execution completed on the initial 32 GiB host.
The source and tool pins, build profile, and commands are documented in
[`third_party/chromium`](../third_party/chromium/README.md). The
[validation record](../runtime/chromium/experiments/bringup.md) captures
the observed gate results and their limits.

**Gate:** a real window loads fixture HTML/CSS/JS, browser and renderer run
as separate processes, and the renderer sandbox is verified active. Record
the verification method. A launch requiring `--no-sandbox` does not pass.
Record an unmodified startup/memory baseline and the complete launch resource
set, rather than just the executable's size.

### E1: statically linked native renderer program

Add a tiny NTS library exporting an initialization function and a scalar
calculation. Link it into a renderer test target, invoke it from a
`ContentRendererClient`/`RenderFrameObserver` integration, and log the result.
The prepared experiment derives an owned shell through `ShellMainDelegate`'s
client factories and GN's `root_extra_deps`; this seam requires no tracked
Chromium source changes at the pin. Its optional script-free input counter
uses public Blink APIs and explicit document state. That bounded witness does
not establish the full DOM or scheduling gates below.
Compile NTS runtime/generated C as C, with Chromium's toolchain. Put a narrow
C-compatible shim between those headers and Chromium C++; do not assume
`nts_runtime.h` or generated `program.h` is directly C++-compatible.

Follow the library export/header pattern already exercised by `ts-from-c`.
Then emit LLVM for the same fixture and compile its object with the compatible
toolchain. Check diagnostics and the required export symbols as well as the
exit status: diagnostic `emit-llvm` can print refusals and still return zero.
Run managed application code with reclamation enabled.

Use one NTS environment per participating document initially, enter it on
every callback, and bootstrap only the selected fixture's committed document.
Keep fixture state in explicitly owned per-document objects and avoid mutable
module globals. The existing library image is not instantiated afresh by
creating another environment. General module initialization/reset, global
roots, and multiple app documents sharing a renderer need a reduced witness
and an agreed contract with the compiler/runtime lane.
Choose the attachment hook with document/context readiness and teardown in
mind; merely observing creation of a renderer process is insufficient. Start
with a C++ browser shell, without the entire Node profile or a native module
loader.

**Gate:** both C- and LLVM-produced libraries actually execute in the sandboxed
renderer. Reload and navigation create/dispose environments correctly. A
controlled renderer crash leaves the browser process alive. App code needs
no separate UI event loop or runtime-loaded machine code.

### E2: small direct DOM bridge

Hand-write the bridge for a tiny counter, starting with document/body access,
querying, element/text creation, insertion/removal, text, and attributes.
Use opaque bridge-owned identities and a canonical node mapping; the app
must not depend on Blink C++ classes. Explicit lifetime ownership is acceptable
for the bounded prototype if it is recorded and teardown is exercised.
An initial explicit experimental TS host API is acceptable for isolating the
ABI question; ordinary `document.querySelector` syntax is a subsequent facade
and binding test, not proof supplied by a `.d.ts` declaration alone.

Read the corresponding Blink IDL and generated V8 bindings for every operation.
The IDL is input to semantic review now, before it becomes generator input.
For operations requiring internals, keep the implementation in a Blink-owned
build target behind the bridge entry point, rather than adding internal
includes throughout the content embedder.

Copy strings initially through an explicitly sized Latin-1/UTF-16 boundary,
preserving lone surrogates and embedded NULs. Defer shared storage. Return
errors through a defined C boundary; translate them to NTS failures after
returning from Blink. Never unwind an NTS `longjmp` or C++ exception through
the other runtime's frames. Add a throwing-call witness before claiming
ordinary DOM exception compatibility.

**Gate:** native code creates and changes real Blink nodes; DevTools/test
inspection sees them. Repeated queries preserve identity, missing matches
return null, invalid selectors report `SyntaxError`, invalid tree edits report
their DOM errors, and strings round-trip exactly. The direct path does not
evaluate JS strings to perform those mutations. An equivalent V8 fixture
produces the same observable trace.

**Observed:** C and LLVM pass this bounded operation set through the owned
Blink target. Canonical identities, missing/error distinctions, tree errors,
detached-node GC, exact UTF-16 data and a native raise/catch after Blink return
are exercised. The source API is explicitly experimental; it does not supply
ordinary `document` syntax or full DOMException/WebIDL compatibility.
The available compiler's source-literal defect is isolated by constructing
surrogate units at runtime and checking actual Blink units against V8.

### E3: events, lifetime, and microtasks

Add a native event listener and increment the counter from an actual input
event. Preserve callback identity, capture, cancellation, and synchronous
reentry. Implement the Chromium `NtsHost`: task/timer posting, owner-thread
entry, cancellation, and document-agent microtasks. Keep synchronous pumping
unavailable in the UI host if it would enter a nested event loop.

Exercise native and V8 jobs in both enqueue orders, nested jobs, DOM events,
MutationObserver delivery, and a V8 custom element reacting to a native
mutation. Installing the host microtask hook bypasses NTS's normal drain;
audit end-of-checkpoint cycle collection and unhandled rejection reporting
as well. Host tasks own their retained state and must run or drop it on
cancellation. Pending completions must never touch a disposed environment.

**Gate:** listener removal works, retained detached nodes survive Blink GC,
roots and callbacks are released on disposal, and repeated reload does not
grow live native/bridge state. Old document callbacks cannot act on a new
document. Event errors are reported without unwinding across Blink frames.
The mixed scheduling trace agrees with the equivalent all-V8 program.

**Observed:** Both backends match the complete V8 trace for ten events across
both listener orders and actual input/script dispatch. Each event has two
compiled scalar awaits, V8 nested jobs, custom-element reactions and observer
delivery. Checkpoint collection leaves one owned counter; four disposals drop
a managed host task and destroy an empty environment. This is a subset of E3.
Generated resume tasks have null drop callbacks, and the available compiler
does not retain the tested managed async parameter. Pending-await cancellation
and host rejection maintenance remain [reduced blockers](../runtime/chromium/experiments/contracts/README.md).

### E4: source facade, limited V8 interop, and packaged origin

Expose the proven subset through normal typed DOM syntax. Treat DOM types
as host-backed values, not ordinary NTS records just because tsgo knows
`lib.dom.d.ts`. Add an explicit same-node round trip to V8 and back plus a
small typed function call; defer transparent arbitrary JS object behavior
and network module loading.

Replace fixture bootstrap with a browser-served packaged origin. Define
resource loading, origin identity, redirects, CSP, storage partition, and
navigation rules; registering a URL scheme alone does not settle them.
Native entry attachment follows browser-authorized package/document identity.
Add one narrow handwritten Mojo service, with document-scoped lifetime and
browser-side validation, before generating IPC from application types.

**Gate:** the same DOM node retains identity through explicit V8 interop.
Remote navigation and remote frames receive no automatic native entry or
desktop service. Pending service replies are revoked on document teardown.
Browser authority does not depend on a renderer-supplied origin string.
Two participating documents in one renderer must also demonstrate independent
application module state and roots before that configuration is supported.

### E5: native React on the proven DOM host

Build a small Blink DOM host for the existing NTS React runtime and its
scheduler seam. It is an experiment under this runtime's ownership, with
upstream React/ReactDOM as the observable-behavior oracle. Demonstrate a
counter, keyed reorder, refs matching direct queries, and a controlled input.
Record the exact supported HTML/prop/event surface. A mounted counter proves
neither ReactDOM compatibility nor hydration, portals, selection, resources,
or browser event semantics.
Audit the runtime and scheduler's own module globals as part of environment
ownership. Initially limit the React experiment to one active application
document per renderer, restarting that renderer for a fresh module instance
if reset is not yet supported; record the limitation explicitly.

Decide from the evidence whether to implement a ReactDOM-compatible facade
over this host, adapt selected upstream DOM logic, or reopen upstream ReactDOM
compilation as a separate compiler research effort. This is an architectural
choice to reconcile with the React lane, not a prerequisite for E1–E4.

**Gate:** the advertised React scenarios run compiled native, have the same
observable trace as upstream, and manipulate the same DOM as direct access.
Keep compiler refusals visible and send minimal reproducers to their owning
lane. No DOM effect tape is needed for acceptance.

## Ownership and follow-on work

The isolated lane owns `runtime/chromium/` for integration sources, C shims,
and fixtures, and `tooling/chromium/` for directly executable TypeScript build
and launch tools. `third_party/chromium/src` is a pinned source submodule;
its additional dependencies and build outputs remain untracked. Reuse the
repository's [tracked-patch practice](../third_party/patches/README.md) if an
experiment needs upstream edits, adapted for the gclient checkout, and check
that every such patch reapplies at the pin. Prefer owned targets and existing
embedder extension points when they provide the required semantics.

Compiler, common runtime, React, Node, and JVM changes belong to their existing
lanes. This lane should supply reduced blockers and a requested contract
rather than editing those components while MainCodex and other sessions are
changing them. Record compiler and Chromium revisions with every experiment;
an experiment passing against a scratch stand-in is still blocked against
the shipping compiler.

After E2/E3 establish binding semantics, try generating a small subset from
Blink's resolved IDL metadata, including inheritance, mixins and extended
attributes. Grow an allowlist with direct/adapted/V8-assisted categories and
per-operation differential tests. Extend HIR with host-effect metadata only
when a concrete optimization or diagnostic requires it; default to immediate,
conservative foreign calls until reentrancy and observation are understood.
Integrate the Node main profile afterward, through a Chromium loop adapter
or a separate AppHost with its own loop and IPC. Neither option warrants
running an independent libuv UI loop in the renderer.

The capability-linker appendix is a separate research track. First measure
an optimized content embedder and inspect GN/link dependencies for one large
candidate such as WebRTC. Hiding a V8 property or disabling a runtime feature
does not establish that implementation code was removed. Static NTS usage
also does not bound downloaded scripts, frames, workers, dynamically created
markup, or shared browser services. A reduced engine must conservatively
include those requirements or explicitly restrict that content profile.
Feature DLL packs and per-world Web API availability are not established
Chromium facilities; validate one vertical removal and its compatibility/size
effect before designing either distribution system.

Measure native→Blink and V8→Blink for the same work, separating computation,
binding overhead, layout/paint, startup, and the complete runtime footprint.
Maintain Chromium security updates and test patch rebases from the first fork;
successful embedding does not eliminate that recurring maintenance cost.
E0 and E1 now pass, along with the bounded native input-counter witness.
The next work is faithful DOM operations and document-agent scheduling.
The native fixture uses Linux as its platform/ABI; a Chromium app/product
configuration can follow once the host integration is proven. The speculative architecture below remains
available for discussion as those experiments produce evidence.

---

## Original generated proposal

The remainder preserves the initial architecture and capability-linker ideas.
Read it with the corrections and unresolved choices above.

# RFC-0001: Native Web Runtime — AOT TypeScript/React on Chromium

**Status:** Generated exploratory draft; see the repository review above.  
**Version:** 0.1  
**Target:** Chromium `content/` embedder  
**Primary execution model:** TypeScript/JavaScript → HIR → LLVM → native machine code  
**Web compatibility engine:** V8  
**Web platform implementation:** Blink / Chromium  
**Main-process runtime:** Native Node.js-compatible runtime

---

# 1. Abstract

This RFC proposes a desktop application runtime that preserves the standard Web development model—HTML, CSS, DOM APIs, TypeScript/JavaScript, React, ReactDOM, browser Web APIs, npm packages—while executing packaged application JavaScript and TypeScript as ahead-of-time compiled native machine code.

The runtime is built as a Chromium `content/` embedder rather than as a CEF application.

Chromium remains responsible for:

- HTML parsing
- DOM
- CSS
- layout
- painting
- compositing
- GPU integration
- networking
- IndexedDB
- Service Workers
- WebSockets
- WebCrypto
- media
- accessibility
- browser security
- Site Isolation
- sandboxing
- Web APIs

Application code is compiled:

```text
TypeScript / JavaScript / React
               │
               ▼
              HIR
               │
          optimization
               │
               ▼
             LLVM
               │
               ▼
        native machine code
```

Packaged renderer code communicates directly with Blink through a generated **Native Web ABI** derived from Blink WebIDL.

Normal application DOM code such as:

```ts
const button = document.querySelector("#save");

button!.textContent = "Save";
button!.classList.add("active");
```

therefore executes approximately as:

```text
native application
       │
       ▼
Native Web ABI
       │
       ▼
Blink
```

rather than:

```text
application
    ↓
V8
    ↓
V8/WebIDL bindings
    ↓
Blink
```

V8 remains present, but its role changes. It becomes the execution engine for **dynamic and network-derived JavaScript**, rather than the primary application runtime.

The architecture defines three principal execution realms:

```text
┌──────────────────────────────────────┐
│ Main Realm                           │
│ Native Node-compatible application  │
│ OS capabilities                     │
└───────────────────┬──────────────────┘
                    │
                 Mojo IPC
                    │
┌───────────────────▼──────────────────┐
│ Sandboxed Chromium Renderer         │
│                                      │
│  ┌──────────────┐  ┌──────────────┐ │
│  │ Native Realm │  │ Web Realm    │ │
│  │ AOT app code │  │ V8           │ │
│  │ React        │  │ remote JS    │ │
│  │ ReactDOM     │  │ dynamic JS   │ │
│  └──────┬───────┘  └──────┬───────┘ │
│         │                 │          │
│         └────────┬────────┘          │
│                  ▼                   │
│                 Blink                │
└──────────────────────────────────────┘
```

The Native Realm and Web Realm share the same underlying Blink DOM while retaining distinct language globals, prototypes, expandos and trust levels.

---

# 2. Motivation

Existing desktop Web runtimes generally choose between two models.

Electron uses Chromium as the renderer and V8/Node.js as the application runtime.

Traditional native applications compile application logic to machine code but do not have direct access to the full Web platform.

This runtime proposes a third model:

> Use Chromium as the Web platform, but use native code as the primary application execution format.

The goal is not merely to make JavaScript faster.

The compiler should have explicit semantic knowledge of:

- DOM operations
- Web API operations
- async operations
- layout reads
- DOM writes
- React commit phases
- inter-process calls
- native capabilities
- dynamic JavaScript boundaries

This allows the compiler and runtime to optimize Web applications in ways unavailable to a conventional JavaScript engine.

---

# 3. Goals

The runtime MUST support standard application source code such as:

```ts
document.querySelector("#foo");
```

and:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";

createRoot(document.body).render(<App />);
```

without requiring a custom UI framework.

Primary goals are:

1. Compile packaged TypeScript and JavaScript application code to native machine code.
2. Compile React and ReactDOM to native code.
3. Preserve compatibility with ordinary DOM APIs.
4. Retain Chromium's mature Web platform.
5. Avoid V8 for normal packaged application execution.
6. Permit arbitrary dynamic JavaScript through V8.
7. Preserve Chromium's renderer sandbox.
8. Prevent network-derived code from obtaining desktop/Node privileges.
9. Provide efficient Native Realm ↔ V8 interoperability.
10. Preserve DOM object identity across Native and V8 realms.
11. Maintain a stable application ABI across Chromium upgrades where practical.
12. Permit compiler-level optimization of Web platform effects.
13. Retain DevTools, networking, storage, accessibility and other Chromium infrastructure.
14. Support the existing npm/Web ecosystem wherever semantically possible.

---

# 4. Non-goals

The runtime does NOT attempt to:

- replace Chromium's rendering engine;
- implement its own CSS engine;
- implement a custom DOM;
- introduce a proprietary React replacement;
- expose raw Blink C++ classes to application binaries;
- compile arbitrary downloaded JavaScript directly to trusted native code;
- merge renderer and OS-capable application privileges;
- remove V8 entirely;
- redefine the Web platform;
- make DOM mutation batching observably atomic;
- guarantee that every possible JavaScript program can be AOT-compiled without fallback.

---

# 5. Chromium foundation

The runtime SHOULD be implemented as a Chromium `content/` embedder.

Chromium describes `content` as the core code required to render pages using a multi-process sandboxed browser, including the Web platform and GPU acceleration, while excluding Chrome-specific product features. `//content/public` is explicitly the API exposed to content embedders. [Content module](https://chromium.googlesource.com/chromium/src/+/main/content/README.md).

The runtime will implement equivalents of:

```cpp
ContentClient
ContentBrowserClient
ContentRendererClient
ContentUtilityClient
BrowserMainParts
BrowserContext
```

and selectively integrate additional Chromium components where required.

The preferred repository architecture is approximately:

```text
chromium/
├── base/
├── content/
├── components/
├── services/
├── third_party/blink/
│
└── native_runtime/
    ├── app/
    ├── browser/
    ├── renderer/
    ├── webabi/
    ├── webidl/
    ├── interop/
    ├── ipc/
    └── runtime/
```

Changes to Blink and `content/` SHOULD be kept minimal.

Most custom functionality SHOULD live in runtime-owned directories.

---

# 6. Process architecture

The application consists of at least two security domains.

## 6.1 Main Realm

The main/browser process hosts the native Node.js-compatible runtime.

It has access to capabilities such as:

```text
filesystem
process spawning
native sockets
native modules
application windows
menus
dialogs
tray
notifications
application lifecycle
OS integration
```

Application entry:

```ts
// main.ts

import fs from "node:fs";
import { Window } from "runtime:app";

const window = new Window({
  entry: "app://bundle/index.html",
});
```

is compiled:

```text
main.ts
  ↓
HIR
  ↓
LLVM
  ↓
native Main Realm
```

For the initial implementation, the Main Realm MAY run inside Chromium's browser process.

A future hardened architecture MAY move application logic into a separate privileged AppHost process.

## 6.2 Renderer process

Every application window receives a Chromium renderer process according to normal Chromium process/site isolation policy.

The renderer remains sandboxed.

It contains:

```text
Blink
Native Realm
V8 Web Realm
```

The renderer MUST NOT expose unrestricted Node.js capabilities.

This remains true even though Native Realm code itself is machine code.

Chromium's threat model explicitly assumes that a compromised renderer can execute arbitrary native code and relies on sandboxing, Site Isolation and IPC validation to limit the resulting authority. [Chromium Mojo security guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/mojo.md).

Therefore:

> Native machine code in the renderer is not equivalent to privileged application code.

It is sandboxed application code.

---

# 7. Application origin

Packaged renderer content SHOULD use a dedicated trusted origin such as:

```text
app://application-id/
```

rather than `file://`.

For example:

```text
app://com.example.editor/index.html
app://com.example.editor/assets/main.css
```

Only packaged resources verified as belonging to the application may be served by this origin.

A Native Realm is attached only to application-controlled origins declared in the package manifest.

Navigating a frame to an ordinary HTTP(S) origin MUST NOT automatically attach the Native Realm.

Remote frames remain conventional Web/V8 execution environments.

---

# 8. Three execution realms

## 8.1 Main Realm

Authority:

```text
high
```

Execution:

```text
native
```

Purpose:

```text
Node-compatible APIs
desktop integration
application lifecycle
privileged services
```

## 8.2 Native Renderer Realm

Authority:

```text
Chromium renderer sandbox
+
Web-origin permissions
```

Execution:

```text
AOT native machine code
```

Purpose:

```text
packaged application UI
React
ReactDOM
application business logic
DOM access
Web APIs
```

## 8.3 Web Realm

Authority:

```text
ordinary Chromium web-origin authority
```

Execution:

```text
V8
```

Purpose:

```text
downloaded JavaScript
remote third-party SDKs
embedded websites
dynamic script elements
network ESM
eval-like compatibility
web content
```

The Native and Web realms MUST NOT implicitly share language-level globals or prototype objects.

They DO share the underlying Blink DOM.

---

# 9. Code provenance policy

The execution engine is chosen primarily by **code provenance**.

Default policy:

```text
packaged application source
        ↓
Native Realm

signed packaged application module
        ↓
Native Realm

HTTP/HTTPS JavaScript
        ↓
V8 Web Realm

runtime-created <script>
        ↓
V8 Web Realm

unknown network ESM
        ↓
V8 Web Realm

downloaded Wasm
        ↓
Chromium WebAssembly runtime

untrusted native plugin
        ↓
separate utility/plugin process
```

Network-derived bytes MUST NOT become executable native code in the renderer by default.

This is a core security invariant.

---

# 10. Compiler architecture

The compiler SHOULD preserve Web-platform semantics beyond the initial frontend.

Recommended structure:

```text
                    ┌────────→ LLVM native
                    │
TS/JS → HIR → MIR ──┤
                    │
                    └────────→ optional Wasm backend
```

HIR SHOULD contain first-class operations representing host effects.

Example:

```text
web.global
web.get
web.set
web.call
web.construct
web.subscribe
web.layout_read
web.flush

js.get
js.set
js.call
js.construct
js.import

ipc.call

storage.read
storage.write

network.request
```

Example source:

```ts
const button = document.querySelector("#save");
button!.textContent = "Save";
```

may lower to:

```text
%document : HostRef<Document>
    = web.global Document

%button : HostRef<Element?>
    = web.call Document.querySelector(
          %document,
          "#save"
      )

web.set Node.textContent(
    %button,
    "Save"
)
```

Only the Chromium-native backend lowers these operations to the Native Web ABI.

This preserves the possibility of targeting other environments later.

---

# 11. Native Web ABI

Application code MUST NOT directly depend on:

```cpp
blink::Document*
blink::Element*
blink::Node*
blink::ExceptionState
WTF::String
```

Instead, the runtime defines a stable Native Web ABI.

Conceptually:

```text
Application native code
        │
        │ stable ABI
        ▼
Native Web Bridge
        │
        │ Chromium-version-specific
        ▼
Blink C++
```

The ABI MUST use opaque application-facing types.

For example:

```cpp
typedef uint64_t WebRef;
typedef uint64_t WebStringRef;
typedef uint64_t WebExceptionRef;
```

The application should not statically link against Blink symbols.

Instead, renderer startup binds an application import table to runtime-provided functions.

Conceptually:

```cpp
struct NativeWebImportsV1 {
    uint32_t abi_version;
    uint32_t struct_size;

    QuerySelectorFn query_selector;
    AppendChildFn append_child;
    SetTextContentFn set_text_content;
    // ...
};
```

A more scalable implementation MAY bind only functions actually referenced by the compiled application.

---

# 12. WebIDL-generated bindings

Blink already uses WebIDL descriptions to generate V8-facing C++ bindings. [Blink bindings](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/bindings/README.md).

The runtime SHOULD add a second binding backend:

```text
                    Blink WebIDL
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
      V8 binding generator      Native binding generator
            │                         │
            ▼                         ▼
           V8                       Native ABI
            │                         │
            └───────────┬─────────────┘
                        ▼
                       Blink
```

For:

```webidl
Element? querySelector(DOMString selectors);
```

the native generator might produce conceptually:

```cpp
WebCallResult<WebRef<Element>>
Document_querySelector(
    WebRef<Document> document,
    NativeStringView selector);
```

The generator must understand:

```text
inheritance
nullable types
optional parameters
overloads
unions
dictionaries
sequences
callbacks
Promise<T>
DOMString
USVString
exceptions
WebIDL extended attributes
```

Not all Blink WebIDL APIs can necessarily bypass existing V8-specific machinery immediately.

Therefore bindings are classified into:

### Tier 1 — Native direct

Simple WebIDL call can directly invoke Blink implementation.

### Tier 2 — Native adapter

Requires a runtime adapter for promises, callback state, dictionaries, ScriptState-like context or specialized conversions.

### Tier 3 — Compatibility path

Temporarily invokes existing Blink/V8 binding infrastructure internally.

Tier 3 still allows application code to remain native.

The long-term objective is to move frequently used APIs toward Tier 1 or Tier 2.

---

# 13. WebRef

DOM and Web-platform objects are represented in native code using:

```text
WebRef<T>
```

Example HIR:

```text
HostRef<Document>
HostRef<Element>
HostRef<HTMLButtonElement>
HostRef<Response>
HostRef<Event>
```

The runtime representation MUST NOT expose raw Blink pointers.

An implementation may use a 64-bit handle:

```text
┌────────────┬────────────┬────────────────┐
│ generation │ type class │ slot           │
└────────────┴────────────┴────────────────┘
```

or an opaque stable bridge cell.

The WebRef system provides:

- canonical identity;
- stale-reference detection;
- receiver type validation;
- Blink lifetime integration;
- ABI isolation;
- debug metadata.

The following must hold:

```ts
const a = document.querySelector("#x");
const b = document.querySelector("#x");

a === b;
```

when both refer to the same DOM object.

React refs and direct DOM queries MUST resolve to the same WebRef identity.

---

# 14. Lifetime and Blink GC

> Repository correction: NTS currently uses reference counting and cycle
> collection. The native tracing GC and cross-runtime weak-reference support
> described here are possibilities to investigate, not existing facilities.
> E3 above tests a bounded lifetime model first.

Blink objects use Blink's garbage-collected object model.

Native Realm references must therefore participate in Blink object lifetime.

A strong `WebRef<T>` SHOULD retain the corresponding Blink object through an appropriate bridge root while a reachable native reference exists.

When the Native Realm's own garbage collector determines that the final strong WebRef has become unreachable, the corresponding Blink root can be released.

Weak references require separate weak handles.

The bridge MUST support:

```text
WeakRef
FinalizationRegistry
DOM weak references
native GC
Blink GC
```

without leaking permanent roots.

---

# 15. Native language object state on WebRef objects

A DOM object is both:

1. a WebIDL object; and
2. a JavaScript/TypeScript language object.

Code such as:

```ts
const el = document.createElement("div");

(el as any).myPrivateValue = 123;
```

must continue to work.

WebIDL-defined properties are routed to Blink:

```ts
el.id = "foo";
```

while non-WebIDL properties are stored in the Native Realm's language-level expando table:

```text
NativeExpandoTable[
    WebRef<Element>
]["myPrivateValue"] = 123
```

ReactDOM's internal per-node bookkeeping can therefore continue to function.

---

# 16. Prototype semantics and intrinsic optimization

> Open research direction: mutable language prototypes and intrinsic epochs
> are outside the current NTS execution profile. They are not required by the
> proposed typed DOM bring-up and would need a separate representation decision.

The Native Realm maintains its own language prototypes for Web objects.

For example:

```text
Document.prototype
Element.prototype
Node.prototype
```

are Native Realm language objects.

Calls to untouched standard WebIDL methods MAY be compiled to direct Native Web ABI calls.

Example:

```ts
document.querySelector("#x");
```

may become:

```text
guard intrinsic epoch
       │
       ├── standard
       │      ↓
       │ direct WebIDL call
       │
       └── patched
              ↓
          generic native dispatch
```

If code executes:

```ts
Document.prototype.querySelector = function () {
  return null;
};
```

the relevant intrinsic epoch is invalidated.

Subsequent operations MUST preserve language semantics.

A production mode MAY permit developers to freeze standard Web intrinsics for stronger optimization.

This mode must be opt-in.

---

# 17. DOM object identity across Native and V8

Native and V8 worlds share the same underlying Blink object.

Conceptually:

```text
                    blink::Element
                    /            \
                   /              \
          WebRef<Element>       V8 wrapper
           Native Realm         Web Realm
```

Blink already contains machinery for wrapping C++ platform objects into V8 objects and maintaining wrappers across multiple worlds. [Blink platform bindings](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/bindings/README.md).

Native → V8:

```text
WebRef<Element>
      ↓
Blink object
      ↓
V8 DOM wrapper
      ↓
JS
```

V8 → Native:

```text
V8 DOM wrapper
      ↓
Blink object
      ↓
canonical WebRef<Element>
```

Object identity MUST remain stable within each realm.

---

# 18. JSRef

Arbitrary V8 values that cannot or should not be converted into native values are represented as:

```text
JSRef<T>
```

Examples include:

```text
Proxy
unknown object
third-party class
V8 function
complex symbol-bearing object
remote module namespace
```

Implementation may use a persistent V8 handle plus metadata describing:

```text
isolate
context/world
generation
type information
```

Native code can interact with the value through operations such as:

```text
js.get
js.set
js.call
js.construct
js.await
```

These operations cross into V8 explicitly.

---

# 19. Native ↔ V8 value conversion

The bridge SHOULD optimize common values.

Direct conversion:

```text
undefined
null
boolean
number
string
bigint
```

DOM values:

```text
WebRef<T> ↔ Blink object ↔ V8 DOM wrapper
```

Opaque values:

```text
V8 Object → JSRef<Object>
V8 Function → JSRef<Function>
```

Buffers SHOULD use shared backing storage where ownership rules permit:

```text
ArrayBuffer
TypedArray
DataView
```

Functions may cross through callable wrappers:

```text
NativeFunctionRef ↔ V8 Function
```

Promises cross as:

```text
NativePromise<T> ↔ V8 Promise
```

Exceptions MUST preserve failure semantics across the boundary.

---

# 20. Dynamic JavaScript policy

Dynamic JavaScript remains supported.

Examples:

```html
<script src="https://cdn.example.com/sdk.js"></script>
```

```ts
const sdk = await import("https://cdn.example.com/sdk.js");
```

These execute in the V8 Web Realm.

They are NOT compiled to native machine code.

Standard DOM script loading therefore remains compatible with the Web platform.

---

# 21. Dynamic import

Packaged static imports:

```ts
import foo from "./foo";
```

are compiled into the native application image.

A dynamic import whose target is statically known to be packaged may also be native.

Network or runtime-unknown imports are handled by the Web Realm.

Example:

```ts
const module = await import(remoteUrl);

module.execute();
```

may internally become:

```text
Native Realm
      │
      │ dynamic import
      ▼
Chromium module loader
      │
      ▼
V8 compilation
      │
      ▼
JSRef<ModuleNamespace>
```

Property access and invocation then use JS bridge operations.

---

# 22. `eval` and dynamically generated code

Direct lexical `eval()` is difficult to support in an AOT realm while retaining exact JavaScript lexical-environment semantics.

Initial versions SHOULD either:

1. reject direct lexical eval in Native Realm;
2. place affected functions on a compatibility execution path; or
3. explicitly execute dynamic code in the V8 Web Realm.

`new Function()` and comparable dynamic code SHOULD execute in V8.

Network-derived code MUST never silently become Native Realm code.

---

# 23. Native Realm / Web Realm isolation

By default, language globals and prototypes are isolated.

This means remote JS executing:

```js
Document.prototype.querySelector = ...
window.someVariable = ...
```

does not mutate Native Realm intrinsic objects.

Both realms still see the same underlying DOM.

Explicit APIs may expose values between worlds:

```ts
web.expose("nativeApi", value);
```

or an equivalent generated bridge.

A future compatibility mode MAY support greater global sharing, but it is expected to reduce optimization and security guarantees.

---

# 24. React architecture

> Repository correction: the current React lane builds an NTS-owned runtime
> compatible with React's public behavior. Upstream compilation is retained
> as a stress corpus and oracle. Compiling upstream ReactDOM unchanged is
> an alternative research route; E5 above proposes a host experiment using
> the existing runtime and explicitly records the DOM compatibility gap.

The runtime does NOT introduce a custom UI framework.

Existing:

```text
react
react-reconciler
react-dom
```

remain the programming model.

The initial implementation SHOULD compile the actual React and ReactDOM packages through the compiler.

Conceptually:

```text
React source
   ↓
compiler
   ↓
native React

ReactDOM source
   ↓
compiler
   ↓
native ReactDOM
   ↓
Web Host IR
   ↓
Native Web ABI
   ↓
Blink
```

This preserves ReactDOM's substantial existing browser behavior, including:

```text
controlled inputs
focus handling
selection
SVG
namespaces
hydration
portals
styles
custom elements
event delegation
forms
resource loading
```

rather than reimplementing this behavior immediately.

---

# 25. React reconciler integration

React's reconciler is explicitly designed around host operations such as creating instances and appending children. React documents mutation-mode renderers as appropriate for DOM-like targets and exposes commit hooks such as `prepareForCommit()` and `resetAfterCommit()`. [React reconciler](https://github.com/facebook/react/blob/main/packages/react-reconciler/README.md).

This creates a natural future optimization boundary:

```text
React render/reconcile
        │
        ▼
prepareForCommit()
        │
        ▼
ordered DOM effect collection
        │
        ▼
React host mutations
        │
        ▼
resetAfterCommit()
```

The first implementation SHOULD compile ReactDOM unchanged where possible.

A later optimized ReactDOM backend MAY replace selected host operations with compiler/runtime intrinsics.

The public application API remains:

```ts
import { createRoot } from "react-dom/client";
```

No custom renderer API should be visible to application developers.

---

# 26. Ordered DOM effect tape

The compiler/runtime MAY implement an **ordered DOM effect tape**.

This is not a transactional DOM and does not alter Web semantics.

Example operations:

```text
SET_TEXT        node, string
SET_ATTRIBUTE   node, name, value
APPEND_CHILD    parent, child
REMOVE_CHILD    parent, child
SET_CLASS       node, string
```

A sequence of writes may be encoded into contiguous memory:

```text
┌──────────────────────────────────┐
│ SET_CLASS       #42   #string17  │
│ SET_TEXT        #43   #string31  │
│ APPEND_CHILD    #10   #42        │
└──────────────────────────────────┘
```

and submitted through a single native bridge entry point.

The executor MUST preserve operation ordering and ordinary Web platform side effects.

The tape is an optimization mechanism, not an atomic visibility mechanism.

---

# 27. Effect barriers

Deferred DOM effects MUST be flushed before an operation that can observe them.

Example:

```ts
el.className = "wide";

const width = el.offsetWidth;
```

HIR:

```text
web.write Element.className

web.flush

web.layout_read HTMLElement.offsetWidth
```

Potential barriers include:

```text
DOM reads
layout/style reads
querySelector-like observable calls
event dispatch
native → V8 calls
synchronous user callbacks
custom-element reactions where required
await/task transitions
operations requiring immediate exceptions
```

Compiler analysis must remain conservative.

If safety cannot be proven, execute the operation immediately.

---

# 28. Custom elements and synchronous Web semantics

Native direct WebIDL calls MUST preserve standard Blink behavior.

If:

```text
createElement
setAttribute
appendChild
```

causes Blink to execute custom-element logic or invoke JavaScript according to Web specifications, the Web Realm may run synchronously.

The optimization system must never assume that a native DOM call is V8-free merely because its caller is native.

Correctness takes precedence over batching.

---

# 29. React events

React's existing delegated event architecture SHOULD be preserved.

Native event subscription may be represented as:

```text
Blink EventTarget
      ↓
NativeEventListener bridge
      ↓
native React event dispatcher
      ↓
Fiber
      ↓
application callback
```

Native function identity must be preserved so that:

```ts
addEventListener("click", fn);
removeEventListener("click", fn);
```

works correctly.

For high-frequency events such as:

```text
pointermove
mousemove
wheel
scroll
```

the runtime MAY use optimized event structures or ring buffers internally, provided observable event semantics are preserved.

---

# 30. Main ↔ renderer IPC

Renderer access to privileged functionality MUST occur through explicit IPC.

Mojo is the preferred implementation.

Chromium's Mojo layer provides typed message pipes, data pipes and shared buffers and supports generated versioned message structures. [Mojo documentation](https://chromium.googlesource.com/chromium/src/+/main/mojo/README.md).

Rather than Electron-style string channels:

```ts
ipcRenderer.invoke("read-file", path);
```

the runtime SHOULD expose typed application services.

Example:

```ts
import { readProject } from "main:project";

const data = await readProject(path);
```

The compiler may generate:

```text
renderer stub
    ↓
Mojo interface
    ↓
main receiver
    ↓
native main function
```

HIR represents this as:

```text
ipc.call Project.readProject
```

---

# 31. Capability model

IPC services SHOULD be capability-based.

A renderer should receive only the service endpoints it is permitted to use.

Example manifest:

```toml
[renderer]
entry = "renderer.tsx"
origin = "app://com.example.editor"
sandbox = true

[capabilities]
network = true
indexeddb = true

[main-services]
project_files = true
system_dialogs = true
```

Filesystem access should not appear as an ambient renderer global.

Instead, access is explicitly delegated from the Main Realm.

---

# 32. Unified event loop

The Native Realm must integrate with Chromium's HTML event loop.

DOM code runs on the renderer main thread unless the relevant Web API explicitly permits another thread.

Native application callbacks therefore participate in:

```text
tasks
microtasks
timers
requestAnimationFrame
events
Promise reactions
MutationObserver delivery
network completion
```

A Native Realm must not invent an independent UI event loop.

---

# 33. Microtask ordering

Native Promises and V8 Promises may coexist in a single renderer agent.

The runtime MUST preserve a coherent microtask ordering model.

One possible implementation is to enqueue native Promise jobs into Chromium/V8's existing microtask scheduling infrastructure as host callbacks.

Thus:

```text
Native Promise job
V8 Promise job
Native Promise job
```

can maintain a single observable scheduling order.

When no Web Realm is active, an optimized native-only microtask queue MAY be used if its behavior remains observably equivalent.

This area requires dedicated conformance testing.

---

# 34. Web API promises

Web APIs returning `Promise<T>` require native Promise integration.

The native WebIDL generator must map:

```webidl
Promise<Response>
```

to the Native Realm's Promise representation.

For Blink implementations currently tightly coupled to V8 `ScriptPromise`/`ScriptState`, a Tier 2 or Tier 3 adapter may be required.

This is expected to be one of the largest engineering areas in broad WebIDL support.

---

# 35. Main Realm security

The Main Realm is privileged.

Remote code MUST NOT execute in it by default.

The same provenance rule applied to the renderer SHOULD apply here:

```text
packaged trusted code → native Main Realm
remote code           → isolated Web/V8 environment
```

No remote `<script>` or downloaded application module should obtain Node-compatible privileges merely because it was loaded by the application.

Electron's current security model similarly recommends separating remote content from Node privileges and retaining sandbox/context isolation. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

---

# 36. Renderer sandbox

The renderer MUST remain Chromium-sandboxed.

The runtime must not disable sandboxing merely because renderer code is AOT-native.

Native renderer code should be treated similarly to Chromium's compromised-renderer threat model:

```text
assume arbitrary native execution
while preserving browser-process authority boundaries
```

Privileged operations remain browser/main side.

Origin checks remain browser side.

Storage isolation remains browser side.

Permissions remain browser side.

---

# 37. Native image packaging

Native Realm machine code MUST originate from the packaged application.

Version 1 MAY statically link application renderer code into an app-specific renderer binary.

This is the simplest security and loader model.

A later version MAY support a packaged native module format such as:

```text
renderer.nmod
```

The module must be:

- part of the signed application;
- integrity checked;
- architecture matched;
- ABI checked;
- mapped according to platform code-signing rules;
- loaded during trusted renderer bootstrap.

Network data MUST NOT be accepted by the native image loader.

---

# 38. Native module ABI

A native renderer module SHOULD expose a minimal entrypoint such as:

```cpp
extern "C"
int NativeRendererInit(
    const NativeHostApi* host,
    NativeModuleExports* exports);
```

The host API contains versioned interfaces rather than direct Chromium symbols.

The runtime MAY negotiate:

```text
Native Runtime ABI version
Native Web ABI version
Compiler ABI version
React integration version
```

at startup.

Unsupported ABI versions fail before application execution.

---

# 39. Chromium upgrade isolation

A central goal is:

```text
Blink version N
      │
Native Web ABI v1
      │
application
```

and later:

```text
Blink version N+10
      │
Native Web ABI v1
      │
same application
```

where feasible.

The Chromium-specific Web bridge is rebuilt for every Chromium update.

Application binaries SHOULD NOT need recompilation when the public Native Web ABI remains compatible.

ABI compatibility should be tested automatically against previous runtime versions.

---

# 40. Stable Web API identifiers

Rather than link application code to thousands of exported symbol names, the compiler MAY emit an import descriptor table.

Example:

```text
Document.querySelector(DOMString)->Element?
Node.appendChild(Node)->Node
Node.textContent.set(DOMString?)
```

Each operation receives a stable schema identifier.

At renderer startup:

```text
application Web imports
        ↓
runtime resolver
        ↓
function pointers / inline stubs
```

Only referenced WebIDL operations need to be bound.

This minimizes startup and ABI surface.

---

# 41. Exceptions

Native WebIDL calls must preserve DOM exception semantics.

Example:

```ts
document.querySelector("[");
```

must produce the correct DOM exception rather than a native crash.

Generated bindings can classify operations into:

```text
non-throwing fast call
throwing call
```

A throwing ABI may return a compact result such as:

```text
(value, exception)
```

or use another platform-neutral mechanism.

C++ exceptions MUST NOT escape across an unstable binary boundary.

---

# 42. Strings

String conversion is critical to performance.

Application strings SHOULD NOT be unnecessarily round-tripped through:

```text
UTF-8 linear buffer
     ↓
decode
     ↓
Blink string
```

The runtime should support an efficient native string ABI capable of interoperating with Blink strings.

The public ABI must nevertheless avoid exposing `WTF::String` directly.

Possible implementations include:

```text
immutable shared backing store
reference-counted UTF-16
dual UTF-8/UTF-16 representation
interned string handles
```

String constants used frequently by DOM calls may be interned during module initialization.

---

# 43. Buffers

`ArrayBuffer` and typed arrays SHOULD cross realm boundaries without copying when ownership semantics permit.

The runtime should strive for:

```text
Native ArrayBuffer
       │
shared backing store
       │
Blink/V8 ArrayBuffer
```

rather than serialization.

The ABI must preserve detachment and transfer semantics.

---

# 44. React refs

React refs return ordinary WebRef-backed DOM objects.

This must work:

```tsx
const ref = useRef<HTMLDivElement>(null);

useEffect(() => {
  const queried = document.querySelector("#editor");

  console.log(queried === ref.current);
}, []);

return <div id="editor" ref={ref} />;
```

No React-specific fake DOM representation exists.

ReactDOM manipulates the real Blink DOM.

---

# 45. Direct DOM interop with React

Developers remain free to combine React and direct DOM access.

Example:

```tsx
function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current!.classList.add("mounted");

    document.querySelector("#other")!.setAttribute("data-ready", "1");
  }, []);

  return <div ref={ref} />;
}
```

Both paths use the same WebRef object model.

---

# 46. Dynamic JS interoperability example

Native application:

```ts
const sdk = await import("https://cdn.example.com/sdk.js");

const element = document.querySelector("#mount");

sdk.mount(element);
```

Execution:

```text
native import
    ↓
V8 loads SDK
    ↓
JSRef<Module>
    ↓
native js.call
    ↓
WebRef<Element>
    ↓
Blink object
    ↓
existing V8 DOM wrapper
    ↓
SDK mount()
```

No DOM serialization occurs.

---

# 47. Web → native exported functions

Native functions may be explicitly exported to the Web Realm.

Conceptually:

```ts
@webExport
export function formatDocument(
    value: string
): string {
    // ...
}
```

generates a V8-callable wrapper.

Remote code receives only specifically exported functionality.

No ambient access to Native Realm objects is implied.

---

# 48. Remote iframe behavior

Remote content SHOULD generally run using ordinary Chromium Site Isolation.

For example:

```html
<iframe src="https://accounts.example.com"></iframe>
```

may reside in a separate renderer process.

That renderer contains:

```text
Blink
V8
```

but no application Native Realm.

Communication occurs through ordinary Web mechanisms such as:

```text
postMessage
MessagePort
Web APIs
```

This dramatically reduces exposure of application native code to remote frames.

---

# 49. Workers

Initial behavior:

### Packaged application worker

May initially execute in V8 for compatibility.

A future Native Worker Realm MAY AOT-compile packaged worker modules.

### Network Worker

Runs in V8.

### Service Worker

Runs in the ordinary Chromium/V8 implementation initially.

### Native CPU worker

Application code may explicitly use a runtime worker/utility facility with typed IPC or shared memory.

Worker support should not delay the initial renderer architecture.

---

# 50. DevTools

Chromium DevTools SHOULD remain available for:

```text
DOM
CSS
network
storage
IndexedDB
performance
accessibility
V8 Web Realm
```

The runtime should extend developer tooling for Native Realm code.

Required features:

```text
TS source-level stack traces
DWARF/PDB/native symbols
native heap profiling
Native ↔ Web transitions
Native ↔ V8 transitions
React component mapping
console integration
WebRef inspection
JSRef inspection
IPC tracing
DOM tape tracing
```

`console.log()` from Native Realm should appear in DevTools.

---

# 51. React DevTools

React DevTools support requires separate investigation because existing tooling assumes JavaScript runtime hooks.

Potential approaches:

1. expose the required React instrumentation hook through the V8 Web Realm;
2. implement the React DevTools protocol directly;
3. provide a runtime-specific native React inspection backend.

This is not a blocker for initial execution correctness.

---

# 52. Performance model

The project should avoid assuming that native execution is automatically faster.

Performance must be measured separately for:

```text
pure computation
React reconciliation
DOM calls
layout-heavy workloads
startup
memory
network workloads
V8 bridge calls
IPC
```

Particular focus should be placed on cheap high-frequency Web operations where binding overhead can matter.

Examples:

```text
textContent
hidden
checked
value
className
attributes
event dispatch
Canvas calls
small DOM tree updates
```

Expensive calls such as complex `querySelector()` operations may be dominated by Blink's own work.

---

# 53. DOM tape performance strategy

The ordered effect tape should be introduced only after a correct direct-call implementation exists.

Benchmarks should compare:

```text
JavaScript/V8 → Blink

Native → direct Web ABI → Blink

Native → DOM effect tape → Blink
```

The tape remains only if it produces measurable benefits.

Potential benefits include:

```text
fewer ABI dispatches
compact operand representation
pre-resolved strings
bulk handle validation
better cache locality
compiler-level effect grouping
```

It must never sacrifice observable Web semantics.

---

# 54. React performance strategy

Benchmark separately:

```text
V8 React + ReactDOM
native React + compiled ReactDOM
native React + direct Web ABI
native React + optimized host intrinsics
native React + DOM effect tape
```

This reveals which layer provides the actual improvement.

React reconciliation and DOM mutation should be measured independently.

---

# 55. Security invariants

The following are hard requirements:

**S1.** Network-derived JavaScript does not execute as native renderer code.

**S2.** Renderer code does not receive unrestricted Node/OS privileges.

**S3.** The renderer sandbox remains enabled.

**S4.** Remote origins do not automatically receive the Native Realm.

**S5.** The bridge validates WebRef type, lifetime, and document ownership.
These checks support correct execution; privileged-process checks must still
assume a renderer capable of arbitrary native execution.

**S6.** IPC is capability-scoped and validated in privileged processes.

**S7.** Native binaries loaded into renderer processes are packaged and verified.

**S8.** V8 interoperability does not implicitly grant Main Realm capabilities.

**S9.** Browser-side origin checks remain authoritative.

**S10.** Site Isolation remains compatible with the runtime.

These principles align with Chromium's design assumption that renderers can become fully compromised and therefore privileged security checks must exist outside the renderer. [Chromium Mojo security guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/mojo.md).

---

# 56. Crash containment

A crash in native renderer application code should terminate only the affected renderer.

The browser/main process should retain enough state to display:

```text
renderer crashed
reload application
restore session
send crash report
```

Native renderer crashes MUST NOT crash the main/browser process.

This is another reason not to run the UI and Node-compatible Main Realm in a single process.

---

# 57. Compiler trust

The runtime cannot rely solely on the compiler to enforce security.

Even though normal application binaries are produced by a trusted compiler, the renderer sandbox and IPC checks must assume the renderer contains arbitrary native instructions.

The compiler may provide:

```text
type safety
WebRef safety
capability annotations
effect analysis
```

but these are optimization and correctness tools, not the sole security boundary.

---

# 58. Main process architecture

Version 1:

```text
Chromium browser process
        +
native Node-compatible Main Realm
```

This simplifies:

```text
Window creation
application lifecycle
permissions
menus
IPC routing
protocol registration
session control
```

Future hardening MAY introduce:

```text
Chromium browser process
         │
         │ capability IPC
         ▼
AppHost process
         │
Native Node-compatible runtime
```

without changing renderer application semantics.

---

# 59. Why not a single application process?

Combining:

```text
Node-compatible OS authority
+
Blink
+
remote web content
+
native renderer application
```

into one process would collapse one of Chromium's most important security boundaries.

A memory corruption or arbitrary-code execution vulnerability in renderer content would gain application-level OS authority.

Therefore the single-process model is rejected as the default architecture.

---

# 60. Why retain V8?

Removing V8 would require replacing or forbidding significant parts of the existing Web ecosystem:

```text
third-party widgets
dynamic script tags
remote SDKs
remote pages
OAuth flows
payment UI
user scripts
code playgrounds
dynamic import
Custom Elements implemented in remote JS
third-party libraries loaded at runtime
```

V8 is therefore retained as a compatibility engine.

Its role changes from:

> primary application runtime

to:

> dynamic Web execution runtime.

---

# 61. Why Chromium `content/` instead of CEF?

CEF optimizes for insulating applications from Chromium internals.

This runtime intentionally needs deep renderer integration:

```text
custom Native Realm
Blink/WebIDL bridge
renderer bootstrap changes
V8 interop
native event dispatch
custom application origin
typed IPC
```

Using CEF would eventually require bypassing a significant portion of the abstraction it provides.

Chromium `content/` is explicitly the embedder layer and is therefore the cleaner long-term foundation. [Content module](https://chromium.googlesource.com/chromium/src/+/main/content/README.md).

CEF may still be useful for early prototypes, but is not the target architecture.

---

# 62. Why not expose Blink pointers?

Directly compiling against:

```cpp
blink::Document*
```

would offer a quick prototype.

It is rejected as the stable application ABI because:

```text
Blink internals change frequently
lifetime rules leak into applications
GC implementation leaks into applications
binary compatibility becomes impossible
type safety becomes fragile
security validation becomes difficult
alternative engine backends become impossible
```

Opaque WebRef values solve these problems.

---

# 63. Why not remove the process boundary because renderer code is trusted?

The application developer may trust their own code.

The runtime must also account for:

```text
remote iframe exploits
V8 vulnerabilities
Blink vulnerabilities
media parser vulnerabilities
compromised third-party Web content
memory corruption
```

The sandbox protects against much more than malicious application source.

Therefore native application code remains renderer-sandboxed.

---

# 64. Why not compile downloaded JS to native?

Doing so would transform:

```text
remote server controls JavaScript
```

into:

```text
remote server controls native instructions
```

and require a secure dynamic native-code compiler/validator inside the renderer.

V8 and Wasm already provide mature execution sandboxes for dynamic code.

Dynamic Web code therefore remains V8/Wasm.

---

# 65. Why no custom UI framework?

The project should maximize compatibility with the existing ecosystem.

Developers already know:

```text
DOM
React
ReactDOM
CSS
browser events
Web APIs
```

The runtime's differentiation should live below these abstractions.

A custom UI framework would unnecessarily reduce ecosystem compatibility and obscure the architectural innovation.

---

# 66. Implementation phases

> Historical proposal. Use experiments E0–E5 above as the initial work order.
> The full Main Realm, upstream ReactDOM compilation, and a native module
> loader are not prerequisites for proving the renderer bridge.

## Phase 0 — Chromium embedder

Build:

```text
content/ embedder
app:// protocol
Main Realm
renderer lifecycle
Chromium window
DevTools
```

No native renderer application yet.

## Phase 1 — Native renderer bootstrap

Load packaged native application code into the sandboxed renderer.

Implement:

```text
Native module ABI
entrypoint
event-loop integration
native logging
crash handling
```

## Phase 2 — Minimal WebRef bridge

Implement approximately 20–30 DOM operations:

```text
Document
Node
Element
HTMLElement
EventTarget
Text
```

Including:

```text
querySelector
createElement
createTextNode
appendChild
insertBefore
removeChild
textContent
setAttribute
getAttribute
className
style basics
addEventListener
removeEventListener
```

## Phase 3 — Compile ReactDOM

Compile:

```text
react
react-reconciler
react-dom
```

through the native compiler.

Goal:

```tsx
createRoot(document.body).render(<App />);
```

renders a real React application through Blink without V8 executing React.

## Phase 4 — WebIDL generator

Build the WebIDL-to-Native-ABI generator.

Expand DOM coverage systematically.

## Phase 5 — Native ↔ V8 interop

Implement:

```text
JSRef
WebRef ↔ V8 DOM wrapper
primitive conversion
native function wrappers
V8 function calls
network dynamic import
Promise bridge
exception bridge
```

## Phase 6 — Main IPC capabilities

Generate typed Mojo services from compiler/runtime declarations.

Replace stringly IPC.

## Phase 7 — Broad Web API support

Add:

```text
fetch
WebSocket
IndexedDB
Canvas
WebCrypto
storage
streams
URL APIs
media-facing APIs
```

with Tier 1/2/3 WebIDL support.

## Phase 8 — Effect optimizer

Introduce:

```text
web.read
web.write
web.layout_read
web.flush
```

analysis.

## Phase 9 — React commit tape

Prototype ordered DOM effect tape around React commits.

Keep only if benchmarks demonstrate meaningful gains.

## Phase 10 — ABI stabilization

Define:

```text
Native Runtime ABI v1
Native Web ABI v1
package format
compatibility rules
runtime upgrade rules
```

---

# 67. Prototype milestone

The first compelling demonstration should be deliberately small.

Application:

```tsx
function App() {
  const [count, setCount] = React.useState(0);

  return (
    <main>
      <h1>Native React</h1>

      <button onClick={() => setCount((v) => v + 1)}>Count: {count}</button>
    </main>
  );
}
```

Success criteria:

```text
React compiled native
ReactDOM compiled native
Fiber compiled native
event handler native
DOM actual Blink DOM
CSS actual Blink CSS
layout actual Blink layout
paint actual Chromium paint
V8 not executing React application code
DevTools sees resulting DOM
renderer sandbox remains active
```

Then demonstrate:

```ts
const remote = await import("https://example.com/sdk.js");

remote.use(document.querySelector("button"));
```

Success means the same Blink DOM node crosses into V8 without serialization.

Together these two demos prove the central architecture.

---

# 68. Benchmark suite

Required benchmarks:

### Runtime

```text
cold startup
warm startup
resident memory
binary size
renderer creation
```

### Language execution

```text
native compiled TS
V8 optimized JS
Wasm
```

### DOM

```text
textContent
attributes
properties
node insertion
node deletion
querySelector
event dispatch
style updates
layout reads
```

### React

```text
initial mount
small update
large list update
controlled input
hydration
event handling
concurrent rendering
```

### Bridge

```text
Native → Blink
Native → V8
V8 → Native
WebRef conversion
JSRef call
Promise bridge
```

### IPC

```text
small request
large buffer
stream
high-frequency messages
```

Performance claims should be based on these measurements rather than assumptions.

---

# 69. Correctness testing

The runtime should reuse existing test suites wherever possible.

Targets include:

```text
Web Platform Tests
React test suite
Node compatibility suite
Test262 where applicable
Chromium Web tests
application integration tests
```

Native Realm Web APIs should match normal browser behavior unless a divergence is explicitly documented.

Differential testing can execute the same program in:

```text
normal V8 Web Realm
Native Realm
```

and compare observable behavior.

---

# 70. Open questions

The following require prototypes before stabilization:

1. Exact WebRef representation.
2. Best integration with Blink/Oilpan GC.
3. Native Promise ↔ Chromium microtask integration.
4. How much WebIDL can be automatically generated.
5. APIs requiring V8 `ScriptState`.
6. Cross-realm exception representation.
7. Native object wrappers exposed to V8.
8. Native Realm prototype compatibility level.
9. Direct lexical `eval`.
10. Packaged native module loading under each OS sandbox/code-signing model.
11. Native worker architecture.
12. Service Worker compilation policy.
13. React DevTools support.
14. Custom Elements interaction during effect-tape execution.
15. ABI compatibility across Chromium releases.
16. Whether the Main Realm ultimately belongs inside or outside the Chromium browser process.

---

# 71. Core architectural invariants

The project should preserve the following even if implementation details change:

```text
1. Standard DOM source API.
2. Standard React/ReactDOM source API.
3. Packaged application code may execute native.
4. Network code executes in a managed Web runtime.
5. Native renderer code remains sandboxed.
6. Main/OS capabilities stay outside the renderer.
7. Native and V8 worlds share Blink DOM identity.
8. Blink C++ ABI is never the application ABI.
9. WebIDL is the source of truth for native host bindings.
10. Dynamic V8 interop is explicit and capability-safe.
11. Compiler IR retains Web-platform semantics.
12. Optimizations never change observable Web behavior.
```

---

# 72. Proposed architecture

The resulting system is:

```text
                         APPLICATION

         ┌─────────────────────────────────┐
         │ main.ts                         │
         │ Node-compatible application     │
         └──────────────┬──────────────────┘
                        │
                TS/JS → HIR → LLVM
                        │
                        ▼
                 Native Main Realm
                        │
                    typed Mojo
                        │
                        ▼

┌─────────────────────────────────────────────────────────┐
│                SANDBOXED RENDERER                       │
│                                                         │
│   Packaged TS / React                Dynamic Web JS      │
│          │                                 │             │
│          ▼                                 ▼             │
│   TS/JS → HIR → LLVM                      V8             │
│          │                                 │             │
│          ▼                                 │             │
│     Native Realm                           │             │
│          │                                 │             │
│     Web Host IR                            │             │
│          │                                 │             │
│    Native Web ABI                          │             │
│          │                                 │             │
│          └──────────────┬──────────────────┘             │
│                         ▼                                │
│                       Blink                              │
│                         │                                │
│         ┌───────────────┼─────────────────┐              │
│         ▼               ▼                 ▼              │
│        DOM             CSS             Web APIs          │
│         │               │                 │              │
│         └───────────────┼─────────────────┘              │
│                         ▼                                │
│                  Layout / Paint                         │
│                         │                                │
│                         ▼                                │
│                        GPU                               │
└─────────────────────────────────────────────────────────┘
```

The runtime is therefore not:

> Electron with a faster JavaScript engine.

It is:

> **A native application runtime whose compiler has first-class semantic knowledge of the Web platform, using Chromium as its sandboxed document/rendering/IO substrate and V8 as a compatibility engine for dynamic Web code.**

That distinction should guide the design.

---

# 73. Recommendation

Implementation should begin with the smallest path capable of proving the concept:

```text
Chromium content embedder
        +
sandboxed native renderer module
        +
WebRef
        +
~30 direct DOM operations
        +
native React/ReactDOM
```

Do not initially build:

```text
full WebIDL support
DOM command tapes
native workers
full JSRef proxy semantics
custom React host implementation
ABI compatibility across years of Chromium
```

Those become meaningful only after the core experiment works.

The decisive prototype is:

```text
standard React application
        ↓
native React + native ReactDOM
        ↓
direct generated DOM bridge
        ↓
real Blink DOM
```

running alongside:

```text
remote JavaScript
        ↓
V8
        ↓
same Blink DOM
```

inside a normal Chromium-sandboxed renderer.

If those examples work, they establish the narrow execution path. General
cross-runtime lifetime, scheduling, browser compatibility, and distribution
still require their own evidence.

The next useful artifact is an experiment report recording the source pins,
patches, executed scenarios, failures, and measurements. A detailed
implementation specification should follow the experiments that justify its
representation and integration choices.

Extra
------

Question:
One more thing. For example, if a developer does not use indexeddb or webrtc or some other module, how could we strip chromium and not include it in the resulting app? think it nicely!!

Answer:
Yes. I think this can become another major architectural differentiator of your runtime.

I would **not** think of Chromium as one binary that you shrink afterward. I would introduce a **Web Capability Linker** that sits between your application compiler and the Chromium build.

The application effectively tells the browser engine:

> “This is the exact subset of the Web platform this application can ever reach.”

Then you build/package only the transitive closure of that subset.

## 1. Make Web APIs linkable capabilities

Today:

```text
Application
    ↓
Chromium
    ↓
EVERYTHING
```

I'd make your build look like:

```text
TS / React / HTML / CSS
          │
          ▼
         HIR
          │
          ▼
┌─────────────────────────┐
│ Web Capability Linker   │
│                         │
│ discovers reachable:    │
│                         │
│ DOM            ✓        │
│ CSS            ✓        │
│ fetch          ✓        │
│ IndexedDB      ✗        │
│ WebRTC         ✗        │
│ WebGPU         ✗        │
│ WebGL          ✗        │
│ ServiceWorker  ✗        │
│ Printing       ✗        │
│ media          ✗        │
└────────────┬────────────┘
             │
             ▼
      capability closure
             │
     ┌───────┴────────┐
     ▼                ▼
 native app        Chromium
 linking           feature linking
```

I might literally call this thing **WPL — Web Platform Linker**.

---

# 2. Your compiler is uniquely positioned to do this

Normal Chromium cannot know whether a website will execute:

```js
indexedDB.open(...)
```

tomorrow.

Your compiler frequently can.

Given:

```tsx
function App() {
    return (
        <button onClick={save}>
            Save
        </button>
    );
}

async function save() {
    await fetch("/api/save", ...);
}
```

your HIR might eventually contain:

```text
Web capabilities referenced:

DOM.Document
DOM.Element
DOM.EventTarget
DOM.Node
Fetch
URL
Promise
```

but not:

```text
IndexedDB
RTCPeerConnection
MediaStream
WebGPU
WebGL
ServiceWorker
```

So compilation emits something like:

```json
{
  "webProfile": {
    "dom": true,
    "fetch": true,
    "indexeddb": false,
    "webrtc": false,
    "webgpu": false,
    "serviceWorker": false,
    "media": false
  }
}
```

That's not merely a permissions manifest.

It's **linker input**.

---

# 3. Then strip a feature vertically

This is important.

If IndexedDB isn't used, don't merely remove:

```js
window.indexedDB;
```

You want to remove the **entire vertical slice**.

Today Chromium's IndexedDB implementation spans the Blink-facing frontend and browser-side backing-store implementation; Chromium explicitly documents those as separate sides of the implementation. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2Bshow/refs/heads/main/third_party/blink/renderer/modules/indexeddb/docs/idb_data_path.md?utm_source=chatgpt.com)

So:

```text
                    IndexedDB capability
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
 WebIDL / bindings    renderer frontend    browser backend
       │                   │                    │
 IDBFactory           Blink IndexedDB      persistence code
 IDBDatabase          implementation       Mojo endpoints
 IDBRequest                                backing store
 ...
```

If `indexeddb = false`, the WPL removes all of those where they aren't needed by something else.

Blink already gives you a useful seam: IndexedDB has its own `blink_modules_sources("indexeddb")` GN target containing its implementation sources. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2B/refs/heads/main/third_party/blink/renderer/modules/indexeddb/BUILD.gn?utm_source=chatgpt.com)

So your modified build could turn:

```gn
blink_modules_sources("indexeddb") {
   ...
}
```

into effectively:

```gn
if (native_web_profile.enable_indexeddb) {
    blink_modules_sources("indexeddb") {
        ...
    }
}
```

And your WebIDL generator excludes the IDB interfaces entirely.

Then:

```js
"indexedDB" in window;
```

is simply:

```text
false
```

because that Web API genuinely doesn't exist in this particular runtime.

---

# 4. WebRTC is an even better example

If the app doesn't use:

```ts
new RTCPeerConnection()
navigator.mediaDevices.getUserMedia(...)
```

then remove:

```text
RTCPeerConnection WebIDL
Blink peerconnection
MediaStream capture portions
WebRTC IPC
third_party/webrtc
associated codecs where otherwise unused
device-enumeration pieces where otherwise unused
...
```

Blink already has a separate `peerconnection` module target, and Chromium's media build infrastructure has explicit WebRTC-related build flags. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2B/dfc50ade1c2594642e81125e05d8ec00e8cd8b36/third_party/blink/renderer/modules/peerconnection/BUILD.gn?utm_source=chatgpt.com)

That's exactly the kind of subsystem where the size win could be meaningful.

---

# 5. Chromium already has some useful modularity — just not enough

This is where your fork would need structural work.

Blink conceptually separates:

```text
core/
modules/
platform/
```

and Chromium explicitly says the `core` vs `modules` distinction exists partly for implementation modularity. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2B/68.0.3419.0/third_party/blink/renderer/?utm_source=chatgpt.com)

There are already individual source groups such as:

```text
modules/indexeddb
modules/peerconnection
modules/webgpu
modules/websockets
...
```

But the normal Blink production target broadly depends on the complete `renderer/modules` component. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2B/HEAD/third_party/blink/public/BUILD.gn?utm_source=chatgpt.com)

So today it's more like:

```text
blink
 ├── core
 ├── platform
 └── ALL modules
```

You want to transform it into:

```text
blink
 ├── core
 ├── platform
 └── selected modules
       ├── fetch
       ├── webstorage
       └── ...
```

That refactoring is very compatible with your overall direction.

---

# 6. I would generate a **capability graph**

Don't maintain ad-hoc flags:

```text
ENABLE_INDEXEDDB
ENABLE_WEBRTC
ENABLE_WEBGPU
...
```

everywhere.

Define a database:

```text
web.fetch
 ├── network
 ├── streams
 ├── headers
 ├── blob
 └── url

web.indexeddb
 ├── storage
 ├── blob
 ├── structured-clone
 └── idb-backend

web.webrtc
 ├── mediastream
 ├── peerconnection
 ├── audio
 ├── video
 ├── network-rtc
 └── third_party/webrtc

web.webgpu
 ├── gpu-process
 ├── dawn
 └── blink-webgpu
```

Then your compiler produces roots:

```text
Roots:

web.dom
web.css
web.fetch
web.websocket
web.localstorage
```

WPL calculates:

```text
closure(roots)
```

just like a normal linker resolves symbols.

So you literally have:

```text
normal linker:

foo()
 ↓
bar()
 ↓
libmath


Web Platform Linker:

fetch()
 ↓
Fetch
 ↓
Streams
 ↓
NetworkService
```

That's why I think **linker** is the correct abstraction.

---

# 7. And WebIDL becomes analogous to header symbols

Your compiler already knows:

```ts
document.querySelector(...)
```

corresponds to:

```text
web.dom.ParentNode.querySelector
```

while:

```ts
navigator.mediaDevices.getUserMedia(...)
```

introduces:

```text
web.mediacapture
```

and:

```ts
indexedDB.open(...)
```

introduces:

```text
web.indexeddb
```

So your WebIDL database gets annotated:

```text
[Capability=web.indexeddb]
interface IDBDatabase { ... }

[Capability=web.webrtc]
interface RTCPeerConnection { ... }

[Capability=web.gpu]
interface GPU { ... }
```

Then the same database drives **both**:

```text
Native Web ABI generation
+
Chromium feature linking
```

That is beautifully self-consistent.

---

# 8. Your app's HIR provides automatic discovery

Say some npm library has:

```ts
if ("indexedDB" in globalThis) {
   ...
}
```

If tree shaking proves that code unreachable:

```text
doesn't contribute capability
```

If reachable:

```text
web.indexeddb
```

gets added to the graph.

For direct APIs this is easy.

Your HIR can track things like:

```text
WebCapability(DOM)
WebCapability(Fetch)
WebCapability(WebSocket)
WebCapability(IndexedDB)
WebCapability(WebRTC)
```

The capability set becomes part of compilation output.

---

# 9. But you need an escape hatch for dynamic access

This code is impossible to analyze fully:

```ts
const api = globalThis[userInput];
```

Likewise:

```ts
eval(code);
```

or downloaded V8 JavaScript.

So I would distinguish:

### Static application mode

```toml
[web]
dynamic_js = false
profile = "inferred"
```

Then the compiler can be aggressive.

Using something unavailable becomes a compile error or feature absence.

### Controlled dynamic mode

```toml
[web]
dynamic_js = true

dynamic_capabilities = [
    "dom",
    "fetch",
    "websocket"
]
```

Downloaded JS runs in V8, but it sees only those Web platform features.

### Full Web compatibility mode

```toml
[web]
profile = "full"
```

Then you ship essentially the full browser platform.

This is necessary for:

```text
arbitrary websites
unknown remote SDKs
general browser views
```

because there's no way to know what APIs tomorrow's downloaded JavaScript will request.

---

# 10. This actually gives you a nice security property too

Consider an application that declares:

```toml
[web]
webrtc = false
camera = false
microphone = false
webusb = false
webbluetooth = false
```

A compromised V8 script can't merely find a browser bug in those APIs.

**The implementation isn't in the binary.**

That's much stronger than:

```text
API exists
+
permission denied
```

You reduce attack surface alongside binary size.

For a desktop runtime, that's potentially a very appealing property.

---

# 11. I would classify Chromium features into three groups

Don't try to make _everything_ optional immediately.

### Tier A — Core

Always include:

```text
HTML
DOM
events
CSS parser
style engine
layout
painting
basic forms
URL
encoding
scheduler
core networking infrastructure
sandbox
GPU compositor
```

Trying to remove individual CSS properties or DOM methods will give you huge engineering complexity for tiny wins.

Don't do:

```text
this app doesn't use display:grid
→ remove Grid
```

at least not initially.

That's way too granular.

### Tier B — Good stripping candidates

These are where I'd spend effort:

```text
IndexedDB
Service Workers
WebRTC
media capture
WebGPU
WebGL
WebAudio
media playback/codecs
WebBluetooth
WebUSB
WebSerial
WebMIDI
speech
printing
PDF
spellcheck
notifications
payment APIs
screen capture
device APIs
```

They're relatively discrete and some pull in large dependencies.

### Tier C — Later / questionable

Things like:

```text
SVG
Canvas
workers
accessibility
complex CSS modules
```

They're deeply interconnected or commonly assumed.

Strip them only after you have measurements proving it's worthwhile.

---

# 12. But I would go further: **feature packs**

Doing a custom Chromium compile for every individual app is expensive.

Instead, refactor your Chromium fork into something like:

```text
runtime-core
│
├── DOM
├── HTML
├── CSS
├── layout
├── paint
├── network
└── sandbox


optional packs:

web-storage
web-indexeddb
web-workers
web-serviceworker
web-webrtc
web-media
web-webgl
web-webgpu
web-devtools
web-printing
web-pdf
web-device
```

Then an application:

```text
Notes App
```

might ship:

```text
runtime-core
web-indexeddb
```

A conferencing app:

```text
runtime-core
web-indexeddb
web-media
web-webrtc
```

A 3D editor:

```text
runtime-core
web-indexeddb
web-webgpu
```

This is where it becomes much more practical operationally.

---

# 13. I would make packs **signed native engine components**

Something like:

```text
engine/
├── runtime-core.dll
├── web-storage.dll
├── web-indexeddb.dll
├── web-webrtc.dll
├── web-webgpu.dll
└── ...
```

or platform equivalents.

At build/package time:

```text
myruntime build
```

computes:

```text
application capabilities
       ↓
required engine packs
       ↓
copy/link only those
```

The app manifest might say:

```json
{
  "runtime": {
    "abi": 12,
    "packs": ["core", "indexeddb"]
  }
}
```

Renderer initialization loads exactly those trusted engine components.

### Important

I would **not** make these downloadable arbitrary plugins from webpages.

They are:

```text
runtime-signed
version-matched
trusted engine components
```

not Web extensions.

---

# 14. However: packs and static linking can coexist

You can offer two distribution modes.

### Development / fast build

```text
runtime-core.so
web-indexeddb.so
web-media.so
...
app.so
```

No huge final Chromium link for every developer build.

### Release / maximum compactness

Feed the exact profile into GN:

```text
core
indexeddb
fetch
```

then build one application-specific renderer with:

```text
ThinLTO
dead code elimination
identical-code folding
resource pruning
```

giving:

```text
app-specific engine
```

That would produce the smallest possible self-contained distribution.

So:

```text
development:
    composable feature packs

release:
    whole-program Web Platform link
```

I really like this model.

---

# 15. Generated GN input

Your compiler could output:

```text
out/app.webprofile
```

containing:

```text
dom=true
fetch=true
websocket=true
localstorage=true

indexeddb=false
webrtc=false
webgpu=false
webgl=false
serviceworker=false
printing=false
pdf=false
media=false
```

Then generate GN:

```gn
native_enable_indexeddb = false
native_enable_webrtc = false
native_enable_webgpu = false
...
```

Chromium already uses generated buildflag headers and localized feature/build flags rather than wanting every feature to become one giant global configuration file. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2B/master/build/config/features.gni?utm_source=chatgpt.com)

Your fork can extend that pattern systematically.

---

# 16. But source selection is only one piece

To really strip IndexedDB, for example, WPL should control:

```text
1. Blink WebIDL files
2. generated V8 bindings
3. generated Native Web bindings
4. Blink implementation sources
5. Mojo interfaces
6. browser-side implementation
7. storage dependencies used only by IDB
8. resources
9. tests in release builds
```

So removal looks like:

```text
           Web capability graph
                   │
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
  WebIDL       renderer        browser
 generation      GN              GN
     │             │             │
     └─────────────┼─────────────┘
                   ▼
                  link
```

If you only disable the JavaScript property, you haven't accomplished much.

---

# 17. Let the linker compute dependency closure

For example:

```text
app uses IndexedDB
```

could expand into something conceptually like:

```text
indexeddb
 ├── structured-clone
 ├── blob
 ├── storage-backend
 ├── origin-storage
 ├── mojo-idb
 └── ...
```

But suppose:

```text
fetch()
```

already requires `Blob`.

Then:

```text
Blob
```

remains.

This is exactly standard linker behavior:

```text
remove a subsystem
unless some other retained subsystem still needs it
```

Do **not** encode:

```text
if !indexeddb:
    remove LevelDB
```

because something else may eventually depend on it.

Encode:

```text
indexeddb -> X
featureY  -> X
```

and let graph reachability decide whether `X` survives.

---

# 18. It can apply to Chromium processes too

Suppose the app has:

```text
no media
no WebRTC
no WebGPU
```

Maybe it still requires Chromium's GPU process for compositing, so:

```text
GPU process stays
```

but large media/GPU API machinery doesn't.

Similarly:

```text
no Service Workers
```

could remove service-worker-specific browser machinery while ordinary networking remains.

Think vertically rather than:

```text
"remove process X"
```

because Chromium services are shared.

---

# 19. Your Native Web ABI gets smaller too

This is a pleasant side effect.

Instead of every renderer exporting thousands of Web API calls:

```text
NativeWebABI = ALL WEBIDL
```

your application gets:

```text
NativeWebABI {
    Document.querySelector
    Document.createElement
    Node.appendChild
    Element.setAttribute
    fetch
    ...
}
```

Only operations actually referenced by compiled code need entries.

That's effectively **symbol-level linking of the Web platform ABI**.

You might even have:

```text
Web API ID #182
Web API ID #397
Web API ID #814
```

resolved at startup, instead of a giant static function table.

---

# 20. React makes this particularly effective

Your compiler can analyze actual compiled ReactDOM.

Suppose ReactDOM contains compatibility paths for:

```text
SVG
MathML
certain form types
certain browser quirks
```

but the application never reaches those code paths.

Normal tree shaking may eliminate parts of ReactDOM itself.

Then WPL sees only remaining Web Host operations.

So:

```text
application
 ↓
React
 ↓
ReactDOM
 ↓
HIR optimization
 ↓
reachable Web API set
```

is computed **after application specialization**, rather than just looking at the original ReactDOM source.

This is significantly more powerful.

---

# 21. HTML and CSS also contribute capabilities

Don't analyze only TS.

For example:

```html
<video src="..."></video>
```

introduces:

```text
web.media
```

while:

```html
<canvas></canvas>
```

may introduce Canvas 2D.

And potentially CSS such as:

```css
background: paint(foo);
```

could introduce relevant subsystems.

So your frontend pipeline becomes:

```text
TS / JS
   │
HTML
   │
CSS
   │
manifest
   │
   └──────────────┐
                  ▼
          Capability Linker
```

For runtime-generated strings such as:

```ts
document.createElement(tagFromNetwork);
```

you fall back to the app's explicit declared capabilities.

Static inference provides the minimum; the manifest may widen it.

---

# 22. Use **minimum inferred + explicit maximum**

I would make this developer experience:

```toml
[web]
profile = "inferred"

allow = [
    "indexeddb"
]

deny = [
    "webrtc",
    "camera",
    "microphone",
    "webusb"
]
```

Compiler says:

```text
Inferred:
  dom
  css
  fetch

Explicit:
  indexeddb

Final:
  dom
  css
  fetch
  indexeddb
```

If application code then tries:

```ts
new RTCPeerConnection();
```

build fails:

```text
error: Web capability `webrtc`
is disabled by the application profile.

Referenced from:
  src/call.ts:42
```

That's a **much nicer developer experience than silently shipping all of Chromium**.

---

# 23. Dynamic V8 JavaScript needs its own profile

This follows directly from our previous architecture.

You might have:

```toml
[native-web]
profile = "inferred"

[v8-web]
capabilities = [
    "dom",
    "fetch"
]
```

So your packaged Native Realm can use IndexedDB:

```text
Native Realm:
    DOM
    fetch
    IndexedDB
```

while remote V8 code sees:

```text
Web Realm:
    DOM
    fetch
```

but:

```js
indexedDB;
```

is absent.

Same Blink renderer, **different exposed capability surfaces**.

That is very powerful.

---

# 24. There's an even more radical distribution model

I would consider eventually having a **shared runtime installation**, similar conceptually to WebView2:

```text
NativeWeb Runtime 12
├── core
├── storage pack
├── media pack
├── rtc pack
└── GPU pack
```

Then individual applications ship only:

```text
MyApp/
├── main.native
├── renderer.native
├── assets/
└── manifest
```

Maybe tens of applications share one engine installation.

Then:

```text
"Electron app is 150 MB"
```

stops being structurally necessary.

Your installer could say:

```text
Requires NativeWeb Runtime >= 12.4
Capabilities:
   core
   storage
```

and install missing packs once.

You could support both:

```text
portable/self-contained build
```

and:

```text
shared-runtime build
```

This is something Electron cannot easily offer because every Electron application traditionally carries its chosen Electron/Chromium runtime.

---

# 25. What I wouldn't strip initially

I'd resist the temptation to make this:

```text
CSS flexbox used?
CSS grid used?
:has() used?
SVG circle used?
<input type=date> used?
```

and produce a bizarre hyper-specialized browser.

You'll spend enormous engineering effort and inevitably hit dynamic content.

I'd target **coarse, expensive vertical features** first.

My initial capability groups would probably be:

| Pack            | Examples                       |
| --------------- | ------------------------------ |
| `core`          | HTML, DOM, CSS, layout, events |
| `network`       | fetch, XHR, URL, streams       |
| `storage-basic` | localStorage/sessionStorage    |
| `indexeddb`     | IndexedDB                      |
| `workers`       | Worker/SharedWorker            |
| `serviceworker` | SW + related machinery         |
| `canvas`        | Canvas2D                       |
| `webgl`         | WebGL                          |
| `webgpu`        | WebGPU/Dawn                    |
| `media`         | audio/video/MSE                |
| `webaudio`      | WebAudio                       |
| `webrtc`        | RTC + capture                  |
| `devices`       | USB/Bluetooth/Serial/MIDI      |
| `print-pdf`     | printing/PDF                   |
| `devtools`      | DevTools resources/backend     |

Then profile actual binary size.

Split only where measurement justifies it.

---

# 26. One warning: Chromium isn't ready-made for this

You should expect real refactoring.

For example, current Blink's high-level build still depends on its whole `renderer/modules` target, even though internal APIs such as IndexedDB and PeerConnection already have their own source groups. [Chromium Go Source](https://chromium.googlesource.com/chromium/src/%2B/master/third_party/blink/renderer/modules/BUILD.gn?utm_source=chatgpt.com)

So this won't be:

```text
flip 20 GN switches
→ tiny Chromium
```

It will be a project:

> **Turn Chromium's conceptual module boundaries into actual link boundaries.**

But that's a reasonably scoped Chromium fork objective compared with implementing a browser engine.

And you don't need to do it all at once.

---

# 27. I would add this to the RFC as a first-class subsystem

I'd modify our architecture to:

```text
                         Application

 TS / JS / React      HTML/CSS       Manifest
        │                │              │
        └────────────────┼──────────────┘
                         ▼
                    Compiler HIR
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
     Native code             Web Capability IR
                                      │
                                      ▼
                            Web Platform Linker
                                      │
                    ┌─────────────────┼─────────────┐
                    ▼                 ▼             ▼
              Native Web ABI      Blink profile   browser profile
                    │                 │             │
                    └─────────────────┼─────────────┘
                                      ▼
                                 final runtime
```

So your toolchain has **two linkers**:

```text
LLVM linker
    → "Which native program symbols survive?"

Web Platform Linker
    → "Which browser capabilities survive?"
```

That symmetry is extremely nice.

---

## And there is a bigger idea hiding here

You're no longer really embedding Chromium as a browser.

You're treating the **Web platform itself as a linkable standard library**.

That means:

```text
React application uses DOM + fetch
```

doesn't imply:

```text
ship a general-purpose browser containing
video conferencing, MIDI, Bluetooth,
WebGPU, databases, printing, PDF, etc.
```

any more than:

```cpp
#include <vector>
```

should imply linking every library installed on the machine.

For your runtime I'd make this one of the core design principles:

> **Web APIs are capabilities and linkable dependencies, not an indivisible browser payload.**

Combined with native TS/React execution and the Native/V8 realm split we already designed, that makes the project much more than “a lighter Electron.” It becomes a **specializing Web runtime**: the compiler specializes not only the application, but the browser engine beneath it.
