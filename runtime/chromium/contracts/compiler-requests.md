# Requests to the compiler lane from the Chromium lane

Opened 2026-10-05. These are boundary costs and gaps the Chromium experiment
exposes in the compiler/runtime. The Chromium lane does not edit `compiler/`
or `runtime/c/`; each item states the observation, the proposed contract, and
how the Chromium lane will accept it. The correctness reductions recorded
earlier remain in [README.md](README.md) (managed-await retention, null resume
drops, lone-surrogate literals, managed/opaque admission, host checkpoint-end
maintenance) and are not repeated here.

Evidence comes from `target/release/nts` (October 3,
`11ceacf8c8eeb73d38d31d5ae197b3fae0ece774dc6075a03a5c439b2940c816`) compiling
`runtime/chromium/tests/dom-witness.ts`; generated output is
under `target/chromium/native-bootstrap/`. Timings so far are from a debug
Chromium and are only diagnostic; optimized-engine numbers will be added.

Ranked by expected effect on a UI written in TypeScript.

## 1. An exact, width-preserving borrowed string parameter

**Delivered** on main as ccfe38f51 (`StringView` in `c:types`, read with
`nts_string_view` from `runtime/c/nts_string_view.h`); both DOM ABIs use it.
Accepted: the exact-units witness passes through `string` in Blink, and the
binding benchmark's `-string` rows assert zero NTS allocations. The proposal
as written follows.

**Observed.** DOM text must cross exactly: embedded U+0000, lone surrogates,
one- and two-byte storage. Neither existing string crossing does:

- A plain `string` parameter lowers to `nts_string_to_cstring` /
  `nts_cstring_release` around every call. ASCII one-byte strings are lent in
  place after a scan; anything else is a fresh UTF-8 `malloc` copy that Blink
  must decode again, a lone surrogate becomes U+FFFD, and U+0000 aborts.
- `Utf16String` lends two-byte strings, but widens one-byte strings into a
  fresh buffer, and U+0000 aborts.

So exact text currently goes through a hand-built `Uint16Array`
(`charCodeAt` loop): 3 NTS allocations per mutation, 13–16 µs at 4096 units
in the debug engine versus ~4.4 µs with a prepared array.

**Proposed.** A parameter type (name is the lane's choice, e.g. `StringView`)
that lends the string's own storage for the call, with no scan, copy or abort:

```c
typedef struct NtsStringView {
  const void *units;   /* uint8_t Latin-1 or uint16_t UTF-16, per `wide` */
  uint32_t length;     /* code units; NUL and lone surrogates are data */
  uint32_t flags;      /* bit 0: wide; bit 1: immortal (a literal) */
} NtsStringView;
```

`immortal` lets a host cache its own converted copy keyed by the string's
address — what V8's string externalization gives page script.

**Accept.** The DOM fixture's exact-units witness passes through it on both
backends, with zero NTS allocations per mutation and no
`nts_string_to_cstring` in the loop.

## 2. A generic foreign reference-counted handle

**Delivered**, in a better shape than proposed, on main as 1bd750e5e and
6c08170ef: `HostClass<Tag, Parent, Retain, Release>` in `c:types`, a family
whose binding names its root/unroot pair and whose host finds handles on the
native stack. A handle the program only passes along -- a foreign `+0`
result, an internal helper's return, a sibling cursor, a node or null merged
at a branch -- is never counted; one it keeps is rooted where it leaves the
stack. The DOM ABI's nodes are now Blink's own pointers, rows has no manual
release, and the roots return to zero when the app is destroyed. The
proposal as written follows.

**Observed.** A Blink node handed to TypeScript is a lease on a root in the
document's traced registry. GObject (`g_object_ref_sink`/`g_object_unref`),
COM and Objective-C each have compiler-managed retain/release, but there is no
generic form, so the experiment needs a manual `nts_dom_release`. Every
temporary node (`tr.firstChild`) must be released by hand, or roots grow
until the document dies.

**Proposed.** A declaration that names the two functions, e.g.

```ts
/** @ntsRetain nts_dom_retain @ntsRelease nts_dom_release */
export type Node = Handle<"NtsDomNode">;  // a uint32_t or pointer in C
```

The compiler retains where a second reference is stored and releases where
the last dies, exactly as for a GObject. Identity (`===`) is value equality
of the handle.

**Accept.** The rows workload drops every manual release and its registry
returns to zero live leases after `clear`.

## 3. Integer-typed results and loop counters stay integer

**Re-measured 2026-10-06, on main after the HostClass work; still open, and
not urgent for this lane.** What the C backend emits today:

- a `for (let i = 0; i < n; ++i)` counter whose bound is a `number`
  parameter is a `double`, and `i % 2` is a libm `fmod` call;
- a `c_int32` result folded with `failed |= ...` is widened to `double`
  (`(double)v32`) and narrowed again by the next `|=`;
- `seed * 16807 % 2147483647` (the rows app's Park-Miller step) is `fmod`,
  correctly: the product exceeds int32 and is exact in a double.

Cost, `-O2` on this machine: `fmod(i, 2)` 3.3 ns against 1.1 ns for an
`int64_t` remainder -- about 2 ns per use, 2% of a 120 ns DOM write. The
case for this is compute-heavy code, not the DOM boundary.

The design that is sound, for whoever takes it:

1. **An "integral" fact before a width.** An induction variable that starts
   at an integer and steps by an integer holds only integers, whatever its
   bound; while it stays below 2^53 the integer and the double agree exactly,
   so `int64_t` represents it with no rounding question.
2. **`%` lowers to an integer remainder when both operands are integral and
   the divisor is non-zero.** C's `%` truncates toward zero as JavaScript's
   does, so the value agrees -- **except the sign of a zero**: `-4 % 2` is
   `-0` in JavaScript and `0` in C. Either the dividend is proved
   non-negative (a counter from 0 is), or the result keeps the dividend's
   sign when it is zero.
3. **`|`, `&`, `^`, `<<`, `>>` already produce int32 values**; a local that
   only ever receives them (an accumulator from `0` folded with `|=`) can stay
   `int32_t` with no conversion at all.

Each of these is a fact the existing `flow`/`globals` representation passes
could carry; none needs a new IR. The original request follows.

**Observed.** In `failed |= host.nts_dom_set_text_atom(...)` the `int32_t`
result is widened to `double`, then `nts_to_int32` and two `nts_to_uint32`
calls rebuild an `int32` for `|`, every iteration
(`program.c`, mode 6 loop). The loop counter `i` is a `double` throughout.

**Proposed.** Range/representation inference: a value proved int32 (a `c_int32`
result, `|` and `|=` on int32 operands, a counter bounded by a number
compared with `<`) stays an int32 in the emitted code.

**Accept.** The mode 6 loop body contains the host call, an `or`, and an
integer increment.

The same inference would remove the hottest symbol in the standalone rows
profile once collection is out of the way: `fmod` (8.3%). Every `%` calls
libm, including `seed % max` in a Park-Miller generator whose operands are
both proved integers below 2^31, where V8 speculates int32 arithmetic.

## 4. A string result built by the callee

**Delivered** on main as f03831fd4: a foreign function may return
`StringView` -- `const NtsStringView *` of the callee's own storage, valid
until it is called again -- and the call copies it once, exactly
(`nts_string_from_view`). `nts_dom_text_content` and `nts_dom_get_attribute`
use it. The proposal as written follows.

**Observed.** Reading DOM text (`textContent`, `getAttribute`) needs a fresh
NTS string with exact units. Today it takes two calls (length, then copy into
a caller-allocated `Uint16Array`) followed by a `String.fromCharCode` loop.

**Proposed.** A foreign result type through which the callee returns an owned
NTS string it builds with `nts_str_raw(length, wide)` plus one `memcpy`, or a
returned `NtsStringView` that the compiler copies once into a fresh string.

**Accept.** A DOM text read produces one NTS allocation and no per-unit loop.

## 5. Runtime: a full cycle collection at every checkpoint

**Observed.** `nts_leave` -> `nts_process_ticks_and_rejections` ->
`nts_collect_at_checkpoint` runs `nts_collect_cycles()` whenever any candidate
exists, at every outermost checkpoint. Any release that does not reach zero
is a candidate -- a borrowed argument retained and released inside a call is
enough -- so each native callback pays a trial-deletion walk over everything
reachable from its candidates: the whole application state. In the
standalone rows workload (`../benchmarks/standalone/check.ts`, C backend, no
Chromium) removing one row of 1,000 costs 16.7 us with this policy and
0.16 us when the host owns checkpoints and collects between interactions
(the deferred collection costs 0.23 us per removal, off the interaction
path). This applies to every NTS program, not only the browser: a server
with a large heap pays it per callback.

**Why the walk is the whole heap.** The runtime comment beside
`NTS_COLLECT_THRESHOLD` measures the checkpoint pass as flat in the live set,
because a candidate found live is not revisited "unless something decrements
it". UI code decrements its large containers on every callback. In the rows
app's remove path the compiler emits, for `app.rows.splice(count, 1)`:

```c
v95 = v0->rows;
nts_retain((NtsHeader *)v95);
v97 = nts_array_splice_ref(v95, v2, v96);
nts_release((NtsHeader *)v95);   /* count stays > 0: the array is a candidate */
```

The retain/release pair around a runtime call on a field load is redundant,
and its release makes the 1,000-element array a candidate whose trial
deletion visits every row and string. Two independent fixes: eliding that
pair in `hir/rc.rs` (no candidate, and less RC traffic everywhere), and a
collection policy that is not run at every checkpoint.

**Interaction.** Deferring collection also defers some acyclic frees: a
release that reaches zero does not free an object the candidate buffer holds.
The Chromium host will collect in Blink idle time with the runtime's
10,000-candidate threshold as the backstop; the memory cost of that delay is
not yet measured.

**Proposed.** A collection policy that is not proportional to the heap per
checkpoint: a candidate-count or allocation budget, and/or a public entry
point a host calls from its own idle time. Hosts that own checkpoints
already need the checkpoint-end maintenance entry point listed in
[README.md](README.md).

**Accept.** Removing one row costs the same with 1,000 and 10,000 rows held.

## 6. Later: interning literals at module initialization

**Superseded** for names: a literal passed as a `StringView` is immortal, and
the adapter makes its `AtomicString` once per document, found after by the
literal's address -- no ids, no module initialization. Dynamic text written
over and over keeps `nts_dom_intern`. The original request follows.

When a literal reaches a parameter declared as an interned name (tag,
attribute, event type, selector), the program could intern it once through a
host hook at module initialization and pass the id afterwards. The experiment
does this explicitly with `nts_dom_intern`. Requested only after items 1–2,
and only if measurements show the explicit form is a burden.

## 7. Defect: `===` between related handle types is invalid C

Found 2026-10-06 by the generated DOM bindings (`target === button`, a `Node`
against an `HTMLElement`). The C backend compares two handles of related
`HostClass`/`Class` types as the raw pointers they are, `v22 = v21 == v5`,
where `v21` is a `struct NtsDomNode *` and `v5` a `struct NtsDomElement *`.
Comparing pointers to distinct struct types is a constraint violation in C
(C11 6.5.9p2); clang accepts it with `-Wcompare-distinct-pointer-types`, and
`-pedantic-errors` or `-Werror` rejects it. The answer at run time is right:
the addresses are the same object's. LLVM compares `ptr`s and is unaffected.

Reduction (with `types/dom-idl.d.ts` and `types/dom-abi.d.ts` beside it,
`nts emit-c --rc`):

```ts
import { document } from "nts:dom";
export function same(): boolean {
  const tr = document().createElement("tr");
  return tr.firstChild === tr; // Node | null against Element
}
```

Control: `tr.firstChild === tr.firstChild` (two `Node`s) emits no warning.

**Proposed.** Compare handles as `void *` (or convert the narrower to the
wider family's struct) in the C backend, as LLVM already does.

**Accept.** The reduction's `program.c` compiles with `-pedantic-errors`.

## 8. A `HostClass` handle through an interface method

Found 2026-10-06 writing the differential vectors. A host handle may not be
the parameter or the result of a method called through an interface or an
object type -- the shape every component interface in an application has
(`render(parent: Element)`, `create(): Node`):

```ts
interface Host { empty(node: Node): boolean; }   // or { make(): Node; }
const host: Host = { empty: (node: Node) => node.firstChild === null };
host.empty(tr);
// NTS1001 an opaque C pointer converted to a different representation is
//         not supported by this lowering yet
// result form: NTS2008 a value of type NativePointer(Opaque(Handle { tag:
//         "NtsDomNode", ... family: Host(..) })) cannot be read back yet
```

Controls that compile: the same arrow as a local closure called directly,
and the same function at module level (direct calls with an upcast,
`Element` into `Node`, included). So the gap is erasure: a method call
through an object passes erased values, and `HostClass` has no erasure tag
(`tags.rs` `handle_tag(Host) = None`, left out deliberately when the family
was introduced, until a program needed it).

**Proposed.** Give the host family an erasure tag, as the GObject and
Objective-C families have one: erased, the handle is the pointer with its
family's tag; read back, it is checked and borrowed (stack-rooted, as any
host result); kept, it is retained through the family's pair.

**Accept.** Arms `{ empty(node: Node): boolean }` and `{ make(): Node }`
compile on both backends, with no retain for a handle that stays on the
stack, and `leak=0` under RC.

## 9. Defect: a narrowed accessor read loses its null check

Found 2026-10-06 in the browser, as a SEGV in `nts_concat` inside the
differential vectors. TypeScript narrows a property after an assignment:
after `div.nodeValue = "x"`, `div.nodeValue` is `string`. The compiler trusts
the narrowed type for the read, which here goes through a native accessor
(`@ntsGet` over a `StringView | null` getter), and drops the null check. But
a getter need not return what was set -- an element's `nodeValue` is null
whatever is assigned -- so the NULL result reaches `nts_concat`. JavaScript
gives `"null"`; the compiled program dereferences NULL.

```ts
const div = document().createElement("div");
div.nodeValue = "x";
return ("" + div.nodeValue).length;
// v42 = nts_string_from_view(v41); v43 = nts_concat(v39, v42);  -- no check
```

Control, one difference: the same read through a local typed `string |
null` emits the `(NtsString *)0` comparison and the `"null"` text.

**Proposed.** A read through an accessor -- a native `@ntsGet`, and arguably a
TypeScript `get` -- is typed by the accessor's declared result, not by the
assignment narrowing, wherever the representation depends on nullability.

**Accept.** The reduction checks the getter's result for NULL.

## 10. Module-level state per environment

**Requested 2026-10-06. Blocks: apps with module-level state.**

The renderer hosts one program per document, each in a fresh environment
(`nts_environment_create`), and reload or navigation destroys that
environment once nothing of the program remains. Module-level state is
compiled to process-wide C statics, set once by `module__init`. So it is
shared by every document's environment, and nothing releases what it holds
when one ends. A natural app -- `let state = createState();` at module
scope, read by `main` -- would carry the first document's objects into the
second, and fail the host's end-of-document check.

`tooling/chromium/app.ts` therefore refuses a program whose `program.h`
declares `module__init`, naming this request. What would lift it, either of:

- module state scoped to the current environment, initialised in each;
- a `module__fini` the host calls before destroying an environment,
  releasing what module state holds, and a re-run of `module__init` for the
  next.

## 11. Console and uncaught errors reach the host

**Requested 2026-10-07. Blocks: errors and console output in DevTools, and
a page that survives a throwing listener.**

Today, measured on the a2 compiler:

- A throw nothing catches inside a listener, or inside an export such as an
  app's `main`, compiles to a direct `nts_uncaught(value, detail)` call
  (emit-c of `body.addEventListener("click", () => { document().querySelector("["); })`
  and of `export function main(d) { d.querySelector("["); }`). Inside a
  callback, `nts_uncaught` prints to stderr and calls `exit(1)`, so the
  renderer dies with Chromium's crash page. The raise path, which returns to
  the host, is not taken by either.
- `console.*` lowers to `nts_console_write(line, to_stderr)`, which writes to
  the process's stdout or stderr. It carries one bit, not the level, and
  nothing reaches DevTools.
- `NtsHost` has no hook for either.

What would let the renderer host report through Blink: DevTools'
console, the window's `error` event, and "Uncaught ..." in the inspector.
Each hook is optional, and NULL keeps today's behaviour.

```c
typedef enum NtsConsoleLevel {
  NTS_CONSOLE_LOG, NTS_CONSOLE_INFO, NTS_CONSOLE_DEBUG,
  NTS_CONSOLE_WARN, NTS_CONSOLE_ERROR,
} NtsConsoleLevel;

/* In NtsHost: */
/* Each console line, instead of stdout/stderr. */
void (*console_write)(void *state, const NtsString *line, NtsConsoleLevel level);
/* A throw that reached a callback boundary with nothing to catch it:
   `thrown` and the message it carried (or null). The host reports it, and
   the callback is abandoned rather than the process: the runtime unwinds to
   the innermost host entry, as a landing the host pushed after
   nts_callback_enter would. */
void (*report_uncaught)(void *state, NtsValue thrown, const NtsString *detail);
```

and in the compiler, `console.warn`/`error`/`info`/`debug`/`log` passing
their level. If unwinding to the host entry is too large a change, a
report-then-exit `report_uncaught` is still worth having: the error reaches
DevTools before the renderer goes.

The lane's side, once these exist:

- `console_write` becomes `ExecutionContext::AddConsoleMessage(kConsoleApi,
  level, text)`;
- `report_uncaught` dispatches an `ErrorEvent` through
  `ExecutionContext::DispatchErrorEvent(..., kDoNotSanitize)`, which page
  script's window `error` listeners see, and DevTools prints as uncaught.
- Neither needs a ScriptState.


## 12. A foreign function answers a promise

**Delivered 2026-10-07** (main 1bcac3153, with nts_promise_reject_error,
4971bf1fc, and nts_host_checkpoint_end, b62243224): a `Promise<T>` result
crosses as an owned `NtsPromise *`; a host rejects with the program's Error;
a host that owns checkpointing ends each one, so rejections are reported and
released. Bound in the adapter as nts_dom::Answer (dom_bridge.cc). The
request as written:

**Requested 2026-10-07. Blocks: Blink's promise-returning members, 20 in
`tooling/chromium/bindgen/report.json` (`requestFullscreen()`, `play()`,
`Animation.finished`, `scrollIntoView`'s `Promise<ScrollResult>`, ...).
Fixture: `blockers/a-foreign-function-returning-a-promise`.**

Today a declared `Promise<T>` result of a foreign function is refused:
"foreign function `x`'s return ... a type with no native ABI". The runtime
already has the host's half: `nts_promise_new`, `nts_promise_fulfill_*`,
`nts_promise_reject` (`runtime/c/nts_runtime.h`).

What would let the adapter bind them: a `Promise<T>` result crosses as an
`NtsPromise *` the function returns owned (one reference, the program's).
The host keeps its own reference and settles it later, from its event loop
and inside the program's environment, with the fulfil call for `T`'s
representation (`_void`, `_number`, `_reference` for a handle or string),
or rejects it. `await` and `.then` in the program need nothing more than a
promise the runtime made. In Blink the adapter would subscribe to the
member's ScriptPromise and settle the program's promise from the reaction,
under the same ProgramScope as a listener.

## 13. A class extending a host class (custom elements)

**Requested 2026-10-08. Blocks: custom elements -- `customElements.define`
and the 39 [HTMLConstructor] members -- the way an app is built from web
components. Fixture: `blockers/a-class-extending-a-host-class`.**

Today `class Counter extends HTMLElement { count = 0; }` is refused: "a base
`HTMLElement` of unrepresentable type (an opaque C pointer to
NtsDomHTMLElement)". A class extends only classes the program defines.

What would let the adapter define custom elements natively: an instance of a
class whose base is a host class is a program object holding its host
handle (the element), made when the host calls the class's constructor with
that handle -- Blink creates the element and upgrades it, as it does for a
JS-defined element -- and every member the base declares is reached through
the handle (`this.textContent` is `nts_dom_Node_get_textContent(this.element)`).
`this` handed to a host function is the handle. The lifecycle callbacks a
class declares (`connectedCallback`, `disconnectedCallback`,
`attributeChangedCallback`, `adoptedCallback`) are methods the host calls.

The adapter's half (the lane's, once this exists): a native
`blink::CustomElementDefinition` per `customElements.define(name, Class)`,
whose construction and reactions call the program's constructor and
callbacks through the invoker, under a ProgramScope, as listeners are
called today; `customElements` bound on Window.

## 14. A foreign function returning a Closure

**Delivered 2026-10-08** (main 8ae1b0305): a foreign result `Closure<F>` or
`Closure<F> | null` is the program's closure object the host was lent,
returned retained (`NtsHeader *`, NULL for null); it is callable and `===`
the closure set. Bound in the adapter as NtsDomContext::HandlerClosure,
retained through the host's nts_blink_dom_set_retain: 347 `on*` getters,
typed by the void arm (a boolean arm's closure read back and called has its
result ignored, which the closure ABI allows). lib.dom's own read of them
waits on `blockers/lib-dom-event-handler-read-back`. The request as written:

**Requested 2026-10-08. Blocks: every event handler attribute's getter
(`onclick`, `onload`, ... -- 406 members, 169 names; their setters bind),
workarounds ledger row 11. Fixture:
`blockers/a-foreign-function-returning-a-closure`.**

A `Closure<F>` goes to C as a parameter (the host retains it) but a foreign
function's return of type `Closure<F>` (or `Closure<F> | null`) is refused:
"a type with no native ABI". The host hands back a closure the program made
and lent -- Blink keeps the attribute's listener, the adapter returns the
NtsClosure it holds -- retained for the caller, as handles are returned
today. What the lane needs: `Closure<F>` and `Closure<F> | null` as foreign
results (NULL is null), owned by the caller, callable and comparable by
identity (`button.onclick === handler`).

## 15. A reported error thrown as a named error

**Requested 2026-10-08. Low priority. Blocks: lib.dom fidelity of
`catch (e) { e.name }` / `e instanceof TypeError` around DOM calls; ledger
row 27.**

A failure a host reports through `@ntsThrows` is thrown as a plain `Error`
whose message the converter makes, so the DOM's `TypeError` and its
`DOMException`s (`NotFoundError`, `HierarchyRequestError`) all reach a
lib.dom program as `Error` with `name === "Error"` and the name folded into
the message. What would match page script: the converter naming the class
(or at least the `name`) of what is thrown -- `TypeError`, `RangeError`, or
an `Error` whose `name` is the DOMException's -- so `e.name` and
`e instanceof TypeError` read as they do in page script.
