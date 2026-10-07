# The native renderer: architecture

The current design of the electron-like lane's renderer side: compiled
TypeScript driving Blink directly, in Chromium's renderer process, with V8 left
as it is for any page script. Each decision below says what it is, why it is
that, and what it was measured or read against. Chromium file references are at
the pinned checkout (`third_party/chromium/src`, Chromium 154);
`costs.md` keeps the measurement log this summarizes, and
`docs/electron-like.md` was the starting research, not a specification.

The bar is the user's: the best performance the platform allows, clean code,
no hacks. Concretely that has meant: never weaken V8 or Blink to make a number
look better, put every cost on the table against a control, and fix what is
missing in the compiler or runtime as a general feature rather than around it
in the lane.

## 1. Where the program runs

The compiled program (C or LLVM backend, reference-counting provider) is linked
into the renderer and runs on the renderer's main thread, inside Blink's event
loop. There is no second loop: no libuv, no separate thread, no IPC per DOM
call. Browser-side services stay behind Chromium's ordinary Mojo IPC. Three
heaps coexist and none collects the others: the program's (RC with trial-
deletion cycle collection), Oilpan's (Blink's nodes), and V8's (page script and
wrappers, when there is any).

**Who hosts the program.** `host/host.c` is the one host. Each document's
program gets a fresh NTS environment; every native callback enters it
through one invoker; Blink owns its microtasks and idle time; and the
environment ends only once nothing of the program remains. Two clients sit on
the host:
- An **app** (`host/app.c`, the `nts_app` shell). The app's `main(document)`
  runs at DOMContentLoaded of each main-frame document that opts in with
  `<meta name="nts-app">`. Its `unload()` runs when that document ends, and
  ending gives back every closure Blink held.
- The **test probe** (`embedder/probe.c`, `nts_shell`), whose fixtures each
  start by element id.
An app links only its own program, in its own executable. Built and run by
`tooling/chromium/app.ts`. Module-level state is process-wide in a compiled
program, so it would outlive the document: the app build refuses it until
the compiler scopes it to an environment (compiler request 10).

Workers, if they come, are another instance of the same arrangement on the
worker's thread; nothing here assumes a single thread except the node root set
(section 3), which is per thread by construction.

## 2. Entry: one per native callback

Every native callback -- an event, a task, a microtask, an idle period -- is
one *entry* (`nts_blink_dom_entry`, a listener's dispatch, a queued job;
`nts_dom::ProgramScope`): it enters the main world's V8 context, with its
handle scope (`ScriptState::Scope`), and holds a
`v8::MicrotasksScope(kRunMicrotasks)` on the document agent's own queue (the agent's `EventLoop::microtask_queue()`, not the
isolate's default: `core/execution_context/window_agent.cc:15-26`), and
nothing per operation. It also makes its context the thread's *entered* one
(`nts_dom::entered`, restored on return), which is how a DOM call finds the
document and caches it needs: no call carries a context, so a method's
receiver is its first argument, and a call outside an entry -- an embedder
error, since program code runs only inside one -- stops the renderer.
Operations enter no V8 context of their own and create no `TryCatch`: a DOM
exception is recorded with `DummyExceptionStateForTesting` (section 7). The
entry's context is there because Blink code a DOM call reaches may ask for
the current world, as it may when page script's bindings call it:
`Text::splitText` looks up wrappers, and with no context entered a debug
build stops on `ScriptState::From`'s DCHECK (a release build read an empty
context). The document's main-world ScriptState is looked up once.

That is what `V8ScriptRunner::CallFunction` supplies a JavaScript callback, and
for the same reason: nested script (a custom element's reaction, say) cannot
run a microtask checkpoint in the middle of the program's callback, and the
outermost entry checkpoints when it returns (`v8/src/api/api.cc:11277-11291`;
`microtask-queue.cc:167-171`). Measured: an entry costs ~32 ns, and an
operation inside one ~9 ns more than Blink's own call.

`[CEReactions]` scopes are per operation, exactly where the IDL says
(`core/dom/node.idl`, `element.idl`, `child_node.idl`): `textContent`'s setter,
`cloneNode`, `appendChild`, `insertBefore`, `removeChild`, `remove()`,
`setAttribute`; not `createElement`, `createTextNode`, `querySelector`. A
reaction scope's destructor runs reactions synchronously -- arbitrary script
(`ce_reactions_scope.cc:30-38`) -- so after such an operation the program's
assumptions about the tree may be stale, though every node it holds is still
valid (section 3). Open: whether to adopt `V8RunMicrotasksScope`'s behaviour of
not running microtasks while the event loop is paused (BFCache;
`v8_microtasks_scope.cc:23-28`), which matters once pages are frozen.

## 3. Nodes: frame-bounded, rooted only when kept

**A node is its own address.** The DOM ABI passes `blink::Node *` -- typed in
TypeScript as `HostClass` handles: `Node`, `Element`, `Text`, `Document` -- and
identity is pointer equality.

**A node the program only passes along costs nothing.** Oilpan scans the
native stack conservatively at every collection that can run while a native
callback is on it: V8's embedder stack state defaults to
`kMayContainHeapPointers` (`v8/src/heap/heap.h:2316`); the atomic pause scans
from the current stack pointer, registers pushed, up to the renderer's stack
start (`cppgc-internal/marker.cc:506-511`, `content/renderer/renderer_main.cc:
208`); the only precise (`kNoHeapPointers`) collections are non-nestable tasks
(`gin/v8_foreground_task_runner.cc:63`), which by the task runner's own
guarantee cannot run inside ours. Full pointers are found under pointer
compression (`cppgc-internal/visitor.cc:31-36`), and nodes are never moved
(`platform/heap/custom_spaces.h:22-34`; compaction is refused while the stack
may hold pointers, `compactor.cc:462-468`). Blink's own rule is the same:
on-stack references *must* be raw pointers (`BlinkGCAPIReference.md:274`).

**A node the program keeps is rooted.** Where a handle leaves the stack -- a
field, an array, a closure's capture, a module global, an `await` (a suspended
frame is heap memory no stack scan reaches), a return to C -- the compiler
calls the binding's `nts_dom_retain`, and `nts_dom_release` where that
reference dies. The roots are one `HeapHashCountedSet<Member<Node>>` per
thread, held by one `Persistent`: a hash only where the program keeps a node.
The program never calls either; the generic compiler feature is `HostClass`
(compiler commits 1bd750e5e and the stack-return follow-up): a binding-
declared family whose `+0` results are borrowed while on the stack. Nothing in
the compiler knows Blink.

What this replaced: a per-document lease table -- a slot, a generation, an
identity map, and a manual release in the program for every node returned --
about 26 ns per node and an error-prone API. What it costs now: nothing a
C++ caller of Blink does not pay. `document.createElement` in a compiled loop
is 54.0 ns against Blink's own C++ 54.6 and V8's 100 (0.54x V8; ScriptC
measured 0.635x), a detached counter tree 199 ns against 241 and 285. In the
rows app, `buildTemplate` and the DOM witness program take no root at all,
and a created row takes exactly the two it stores.

Verified two ways. The DOM witness detaches a node, forces a full
conservative collection while only the native stack refers to it, and reads
it back. The control arm -- the same collection made precise -- collects it,
and the next read crashes. So the stack scan is what keeps it, and the
witness can tell.

Rules that make it hold:

- The compiler refuses `HostClass` without the reference-counting provider: a
  never-free program cannot root what it keeps.
- A `HostClass` handle cannot be erased (`any`) or settle a `Promise` yet;
  both are refused by name, not miscompiled.
- A release with no root to give back stops the renderer (`CHECK`): that would
  be a counting error in the compiler.
- Retained roots end with the program's state: destroying an app releases
  them; destroying the environment at navigation releases the rest.

## 4. Strings

**In.** Text and names cross as `StringView`: the program's own units at their
own width (Latin-1 or UTF-16), exact -- NUL and lone surrogates included -- and
Blink copies them once into a string of the same width. A literal
(`NTS_STRING_VIEW_IMMORTAL`) is copied once per document and shared after,
found by its address; a literal used as a name (a tag, an attribute, a
selector) becomes its `AtomicString` once. So a program writes
`create_element(c, "div")` and `set_attribute(c, el, "class", "danger")` with
no ids to keep.

**Out.** Blink's text comes back as `const NtsStringView *` of Blink's own
string, valid until the next call, which the compiler copies once into a string
the program owns (`StringView` results, compiler commit f03831fd4).

**Repeated dynamic text** that is not a literal can be interned for an id and
written as a reference to the shared `StringImpl` (`nts_dom_intern`,
`nts_dom_set_text_interned`) -- what V8's externalized strings give page
script.

## 5. Events and cross-heap cycles

**Built: listeners with explicit lifetime.** `target.listen(type, (event) =>
...)` on any `EventTarget` (`nts_dom_listen`) registers a native listener (an
`NtsListener : NativeEventListener` the target holds) and answers a
`Listener` whose `remove()` removes it; the closure is called with the event,
as page script's is, and crosses as C's `(callback, context, destroy)` triple
(`Closure<F>` in `c:types`). A dispatch opens its own entry and calls
the program through the host's *invoker* (`nts_blink_dom_set_invoker`), which
enters the program's environment -- the adapter knows no NTS environment.
Removing it gives the closure back; the context gives
back every closure still held when the document goes, before the program's
environment is destroyed. A listener handle the program keeps is rooted like
a node (`nts_dom_listener_retain` / `_release`). Measured: an event round trip
-- `click()` dispatching to a compiled closure -- costs 536 ns against Blink
C++'s own native listener at 557 and page script's 795 (0.67x V8; ScriptC
measured 1.07x for the same reused-listener shape).

**A closure goes back only once its own run returns.** The compiled bridge
calls a closure without a reference of its own, so whatever detaches a
listener, handler or timer from inside that listener's own run (`el.onclick =
null` in the handler, `listener.remove()`, `clearInterval` in the interval)
must not release the closure then: it may be the only reference to what the
run still reads. Measured before the rule: a self-clearing handler's closure
was at count 1 when released mid-run. Each of `NtsListener` and `NtsTimer`
counts its runs; a detach during one is recorded, and the closure goes back
when the outermost run returns. `tests/timer-vectors.ts` exercises both, from
a later entry, so nothing else holds the closure.

**Observers.** `newMutationObserver`, `newResizeObserver` and
`newIntersectionObserver` are Blink's own observers over native delegates
(`MutationObserver::Delegate`, `ResizeObserver::Delegate`,
`IntersectionObserverDelegate`) where page script's have V8's. They deliver
when page script's do: at the microtask checkpoint, in the rendering steps
after layout, and by a posted task. Each delegate's closure lives in one
`NtsHeldClosure`. It calls the closure as an entry with the entries (a
`TSequence`) and the observer, gives the closure back once and never during
its own run, and gives it back when the document ends, which is as long as
page script's observer can be reached. Options come as dictionaries
(`observe(target, {childList: true})`). The intersection observer takes the
defaults (viewport, no margin, threshold 0) until string and union
dictionary members bind (workarounds ledger, 18).

**Designed: collecting what nobody removes.** The rest of this section is the
design for listeners a program drops without removing.

The listener follows the pattern of `modules/xr/
xr_canvas_input_provider.cc:21-52`; the target holds it
(`RegisteredEventListener::callback_` is a traced `Member`). The cycle to
design for: node → listener → NTS closure → a root on the node.
Neither collector sees the whole ring. The runtime already has the protocol
for exactly this shape -- `NtsHolders` (`nts_runtime.h:315-360`), built for
GObject signal handlers: a family whose objects hold closures registers how to
enumerate the closures an object holds and how to sever them, and trial
deletion walks through the foreign object. The Blink family becomes
`holds_closures`, and its holders enumerate a node's native listeners.

One difference from GObject decides how far that carries: a GObject's count
includes its container's reference, so an attached widget is never garbage,
while an attached DOM node is kept by Oilpan's tree and has no count to show
it. The holders' count for a node therefore has to include "reachable from
Blink's roots", which only Oilpan knows -- so the collection is a joint one:
Oilpan marks first, and a listener whose target Oilpan found unreachable is
the candidate the NTS collector may sever. Until then, explicit removal is the
contract, and navigation releases everything. The alternative -- tracing NTS
closures from Oilpan -- would make the program's heap a cppgc embedder heap,
a far larger change for the same answer.

## 6. Scheduling

- Timers: `setTimeout`/`setInterval` (`nts_dom_set_timeout`, `NtsTimer` on
  Blink's `TimerBase`) follow HTML's timer steps as `DOMTimer` does: WebIDL
  `long` timeout (ToInt32, negative is 0), the 4 ms clamp past nesting level
  5, intervals at least 1 ms, the same timer task queues. `DOMTimer`'s
  coordinator is private to it, so the program's timers are their own id
  space and nest among themselves, as its event handlers are their own world.
  `clearTimeout` and `clearInterval` clear either kind; the document's end
  gives every waiting closure back. Differential vectors: delay order, 0 /
  negative / NaN, clear before due, an interval clearing itself, ten levels
  of nesting -- identical to page script's on C and LLVM.
- Microtasks: native jobs join the agent's queue (`EventLoop::EnqueueMicrotask`),
  so promise jobs, Blink's internal microtasks and the program's drain together
  at the outermost entry's checkpoint.
- Cycle collection runs in idle periods (`ThreadScheduler::PostIdleTask`),
  never at every checkpoint: a checkpoint collection walks everything the
  candidates reach, which for a rows app is the whole table.
- **GC pacing.** V8 paces incremental marking by JavaScript-heap allocation;
  the compiled program allocates in its own heap, which V8 does not see. In one
  long task a marking cycle the program's DOM work started advances only by
  Oilpan's small allocation steps (459 per cycle against page script's 22), so
  layout ran with marking barriers on: 1.30x V8 on `create1k+layout`, 1.00x
  with incremental marking off in both. The architecture answer is the one
  real applications already follow -- an interaction is its own task, and a
  frame renders between them -- with which the engines run the same number of
  cycles and layout is at parity. The residue (smaller steps) is an embedder
  question for Blink/V8, not something the program should work around.

## 7. Errors

A member Blink marks as raising (`[RaisesException]`, which bind_gen reads as
`may_throw_exception`) takes a last `NtsDomException **` -- the compiler's
`@ntsThrows` slot, GLib's `GError **` convention -- and no other member pays
for one. Blink records the exception's code and message without V8; the
adapter reports it through the slot, and the program throws an `Error` whose
message is "Name: message": the DOMException's name, or the ECMAScript
error's (`TypeError`), then Blink's own text -- page script's, without the
binding's "Failed to execute 'x' on 'Y'" prefix. So `try`/`catch` in the
program is page script's, and a status code is never read by hand. Open: the
thrown value is an `Error`, not a `DOMException` with `name` and `code`.

## 8. Bindings, generated from Blink's IDL

`tooling/chromium/bindgen/generate.py` reads the resolved IDL database
Blink's build writes (`web_idl_database.pickle`) with Blink's `web_idl`, and
asks Blink's binding generator (`bind_gen._make_blink_api_call`) for each
member's C++ call. So `[Reflect]`, `[ImplementedAs]`, partial interfaces and
mixins, `[CallWith]`, which members take an `ExceptionState`, `[CEReactions]`
(setters and operations only, as bind_gen opens it) and which arities exist
are decided by the code that decides them for page script, not re-derived.
An optional argument with a default is passed it, one without truncates the
call (`num_of_args`), exactly as V8's binding does.

It emits three files for an allowlist of interfaces
(`bindgen/allowlist.json`: 67 today -- EventTarget and the node and element
classes, the events, the window and its services, URL, the observers, and
the 2D canvas):

- `dom/abi/dom_idl.h`, one C function per member and arity;
- `adapter/dom_idl.cc`, each one's body: Blink's call, inside Blink's namespace;
- `types/dom-idl.d.ts`, module `nts:dom` as a program writes it.

The surface is GTK's (`nts bind-gir`), which is GJS's: an interface is a
`HostClass` handle intersected with its methods by IDL inheritance, an
operation is a method with `@ntsSymbol`, an attribute a property read and
written through two methods (`@ntsGet`/`@ntsSet`). A program writes
`el.setAttribute("class", c)`, `tr.firstChild`, `text.nodeValue = label`,
`d.createElement("tr")` -- page script's code, with `asElement(node)` where
page script would just use the node. Text is a `StringView` both ways,
numbers are `CNumber`s (plain numbers converted at the call), a union with
one string member takes the string, and `asX` narrows with Blink's
`DynamicTo`. A variadic string tail (`classList.add(...tokens)`) binds at one to three
arguments. An IDL enum is its literal union, matched against Blink's
enum class before the call. A member whose types do not map yet (`any`,
callbacks other than closures, unbound interfaces, `[RuntimeEnabled]`) is
skipped and listed in `bindgen/report.json`, never guessed: 4719 functions
bound, 1641 members listed.

Blink's modules component is linked for what the allowlist names under
`"modules"`: whole interfaces (CanvasRenderingContext2D, CanvasGradient,
Path2D, Storage), or one member a modules partial adds to a core interface
(`Window.localStorage`); a modules member of anything else stays skipped.
Most modules classes are not exported from the component, so both build
profiles are static. What their IDL cannot
say is hand-written in `adapter/dom_canvas.cc`: `getContext("2d")`, and the
color and gradient arms of `fillStyle`/`strokeStyle`, which Blink types
`any`.

Any object the IDL hands out is a handle, not only a node: an event, a token
list, a style declaration is a `ScriptWrappable` Oilpan owns and finds on the
stack exactly as it finds a node (section 3). A handle is the object's
address *as a ScriptWrappable*, and every conversion goes through that base,
so no base-class offset is assumed; one counted root set holds whatever the
program keeps. Each hierarchy's root (EventTarget, Event, DOMTokenList, ...)
carries the one retain/release pair, and `asX` narrows from the class
Blink's `DowncastTraits` know -- emitted only for the node and event
hierarchies, since there is no RTTI to check any other.

The hand-written rest (`dom_abi.h`, `types/dom-abi.d.ts`) is what the IDL does
not say: roots, the document, exception messages, listening with a compiled
closure. Generation changed no cost: the rows workload allocates exactly what
it did, and keeps exactly two roots per row.

Correctness is differential (`tests/idl-vectors.ts`): one source, run compiled
through these bindings and, types stripped, as page script through V8's on
the oracle page; both transcripts -- values, node shapes, each exception's
name and message -- land in the DOM the smoke compares.

## 9. No Web Host IR

Everything the renderer needed from the compiler was general native interop:
a binding-declared counted family with stack-borrowed results (`HostClass`),
string views in and out. A dedicated `web.*` instruction family would
duplicate the native-call lowering the backends already do. Web-specific
facts that would let an optimizer do more -- "this call cannot run script",
"this reads layout", "this result is frame-bounded" -- belong first as
metadata on the foreign declaration. A Web Host IR earns its place only when
several such optimizations need the same cross-call analysis: coalescing
writes before a layout read, batching a framework's commit into one entry,
hoisting interning to module initialization.

## 10. Measuring

- One posted task per sample and a rendered frame between an interaction's
  setup and its measurement, in every lane; a single long task measures GC
  pacing, not the engine.
- Both engines must build the same DOM: whole-subtree markup and node counts
  are compared, not only what the workload reads back.
- Every comparison has a control: Blink C++ with no binding at all, prepared
  buffers for strings, and the unmodified page script on normal V8.
- `benchmark.ts --trace` records a Chromium trace per launch;
  `--diagnostic-js-flags` tests a mechanism and is recorded as a diagnosis,
  never a result.

## 11. Later

V8 interop (a program calling into page script and back), packaged origins
and the app shell, BFCache freezing, workers, LTO across the program and
Blink, and generated bindings.
