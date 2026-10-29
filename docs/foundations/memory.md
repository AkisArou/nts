# Memory management (native)

**Status:** decided (M1–M5 below); the new analysis is not built yet. This
page covers C and LLVM; the JVM uses its host's garbage collector, as
Wasm's design does.

How nts decides where every object lives and when its memory comes back, so
that compiled TypeScript allocates less, frees faster and stays smaller than
node and Bun.

Terms used below:

| term | meaning |
|---|---|
| **RC** (reference counting) | each heap object counts the references to it, and is freed when the count reaches zero |
| **retain / release** | add one to / take one from a count |
| **borrow** | use a reference without a count of its own, because something else provably keeps the object alive |
| **move** | hand a reference on without touching the count; the giver stops using it |
| **frame placement** | an object lives in its function's stack frame because nothing outlives the call |
| **region** | memory that many objects are allocated into by bumping a pointer and that is freed all at once (a *reset*) |
| **cohort** | the objects that die together at one reset |
| **reuse** | building a new value in the memory of a dying one, when a run-time check shows nothing else refers to it (Perceus) |
| **cycle collector** | the backstop that frees groups of objects that refer to each other and so never reach a count of zero |

## Where nts stands

**Built, and working well:**

- **Ownership, one answer per value** ([record 0024](../records/0024-one-ownership-answer-per-value.md)):
  borrowing inferred across the whole program, moves, consuming parameters.
  Counting is at its floor: all of `tests/memory`'s cases sit at their argued
  minimum of count operations and allocations.
- **Objects that never leave a function live in its frame**
  ([record 0006](../records/0006-objects-and-their-lifetimes.md)); objects whose
  every use is a field read or write become plain values.
- **Strings grow in place** when nothing else refers to them
  ([record 0029](../records/0029-a-string-that-grows.md)), and a string only
  appended is written straight into its destination.
- **An inline retain/release fast path,** and a cycle collector (Bacon and
  Rajan's trial deletion) that skips every type proved unable to form a cycle.
- **Call regions:** a call whose allocations all stay inside its result runs
  in a region that is reset when the result dies.

**Where the cost is now:**

- **Freeing a dead structure one object at a time.** json-parse spends about
  28% of its cycles tearing down the previous document. A region per parse
  measured −50% wall time: from 1.58x to 0.78x node, and from 1.35x to 0.67x Bun.
- **Count traffic in sorts:** a sort that moves elements without counting them
  measured −11.7% on `map-entries-top-k`.
- **Fat objects:** 40 bytes of header and allocator bookkeeping before an
  object's first field.

**What the experiments taught:**

| experiment | result | lesson |
|---|---|---|
| never freeing containers | slower on every row (join +74%, memory 18 → 328 MiB) | freeing at once and reusing the block immediately keeps hot data in the cache; RC is the right base |
| a region for everything in a call | parse −50%, but append +7–9% | regions pay for objects that die together, and lose for short-lived temporaries: placement must be **per allocation site** |
| growing strings with `realloc` | memory up to 816 MiB; join +65% | the allocator's per-size free lists never give memory back to other sizes; the allocator, not reuse, was the problem |
| a region API that no call uses | +0.8% instructions on join | a mechanism no site selects must cost nothing: decide it at build time |

**The structural problem:** four passes (`escape.rs`, `own.rs`, `regions.rs`
and the unlanded R4(b) analysis) each answer "who can reach this object, and
until when" with their own model. R4(b) works on code after counts are
inserted and reconstructs ownership from them; after 5,800 lines, all 372
allocation sites in json-parse are still undecided.

**The defects behind these rules** (each found on `main`, now fixed and held
by its fixture):

| defect | effect |
|---|---|
| a region clone is compiled without counting, but the array and map helpers it may call keep their counting contracts: a push stores without a retain, a truncation releases | memory corruption: a `build(s)` that pushes the caller's string and then sets `a.length = 0` double-frees it |
| `escape.rs` and `regions.rs` start optimistic and stop after a round cap (32, 256) without checking that they converged | an object passed down a call chain longer than the cap and stored in a global is put in the caller's frame: a dangling stack pointer |
| an allocation inside a loop may share one frame slot when its container is also allocated in a loop, though their instances overlap | a wrong answer: an inner loop's objects stored into an outer loop's array all become the last one |

These shape the rules below: no analysis publishes an unfinished answer, a
frame slot needs a proof that instances never overlap, and every runtime
helper a region calls has an ownership contract for references from outside
it.

## Against the state of the art

| system | strengths | what it relies on that TypeScript lacks |
|---|---|---|
| **Koka (Perceus)** | counts placed exactly; in-place reuse of dying values; rbtree within 10% of C++ | immutable data; no cycle collector at all |
| **Lean 4** | borrowed parameters; reset/reuse | purity; no cycles |
| **Nim ARC/ORC** | moves, borrowing, a Bacon–Rajan cycle collector that skips acyclic types: **nts's closest relative**, reached independently | it must assume every non-final class can form cycles, and offers an unchecked "acyclic" annotation |
| **Swift** | ownership SSA, copy-on-write, stack promotion | atomic counts everywhere; no cycle collection |
| **Lobster** | single owner chosen at the first store; ~95% of counts removed | single-threaded; cycles only reported |
| **High-performance RC runtimes** (RC Immix, LXR) | deferred and coalesced counting | stack maps and write barriers, which a C backend cannot provide cheaply |
| **MLKit and later region inference** (Tofte–Talpin; Aiken, Fähndrich and Levien) | regions inferred by the compiler, with multiplicity and allocation/reset placement | ML's types and effects; the MLKit team found regions without a collector fragile under program change |
| **Elsman, PLDI 2023** ("Garbage-Collection Safety for Region-Based Type-Polymorphic Programs") | shows a real unsoundness: a collector following a pointer into a reclaimed region that the program itself never reads again | — it applies to nts directly: the cycle collector walks references |
| **Oxidizing OCaml** (ICFP 2024) | locality, uniqueness and affinity inferred as separate properties | a modal type system |
| **Iso** (PLDI 2025) | request-private collection by tracking visibility at run time | a tracing collector; a possible hybrid if static cohorts stall |

How nts compares:

- **Allocation: ahead.** None of them chooses frame, region or heap per
  allocation site from a whole-program analysis.
- **Counting: about level.**
- **Reuse: behind.** Perceus reuses any dying value of the right size; nts
  reuses only strings.
- **nts can never be as simple:** TypeScript objects are mutable, shared and
  can form cycles, so some uniqueness checks stay at run time and a cycle
  collector stays as a backstop. The realistic floor is what C++ pays with
  `shared_ptr`: counts only on references that are genuinely shared and
  long-lived. How far static analysis shrinks both is in
  [How small the dynamic part can get](#how-small-the-dynamic-part-can-get).
- **Influences:** record 0024 names Perceus's reuse as the next step; the code
  cites Swift's ownership model, Lobster and Bacon–Rajan. Lean, Nim, Koka and
  Roc were not used.

## The design

**Keep reference counting as the base. Give every allocation site one home,
chosen by one whole-program analysis run before counts are inserted. Then
reuse dying values in place, and let the cycle collector see only what none of
that could prove.**

### Principles

1. **One answer per allocation,** as record 0024 gave one answer per value.
   Passes read it; none re-derives it.
2. **Proved, never declared.** A fact not proved falls back to the counted
   heap, which is always correct. No user-visible memory annotations.
3. **Decide statically; check cheaply at run time where aliasing hides the
   answer:** in-place writes stay behind a "count is one" test, as in Koka,
   Lean and Swift.
4. **Per site, not per type:** one type has short-lived and long-lived
   instances.
5. **A mechanism no site selects costs nothing.**
6. **The cycle collector is the backstop,** seeing only what can form cycles.
7. **Frame-limited:** a transformation may keep extra memory alive only up to
   a bound per active call (Lorenzen and Leijen's frame-limited criterion);
   reuse, borrows and anchors included.
8. **Fail closed:** an analysis that runs out of rounds or budget answers
   "heap" (with a named reason) for everything it did not finish. It never
   publishes an unfinished optimistic answer.

### The ladder of homes

| home | lifetime | cost per object | status |
|---|---|---|---|
| registers | no object at all | none | built |
| stack frame | dies before its function returns | a store or two | built for objects and bounded strings |
| cohort region | survives exactly until a chosen reset in a caller | a pointer bump; nothing at death | built per call; per site is the next step |
| counted heap | everything else | an allocation, counts, a free at zero | built |
| immortal | the whole run (literals, constant data) | nothing | built |

Inside the counted heap, in order: counts removed by borrowing and moves
(built); reuse of a dying unique value (strings built, arrays and objects
next); cycle collection only for what can form cycles.

### The one memory analysis

One whole-program analysis over allocation sites, run before counting, at the
level `escape.rs` and `regions.rs` already work on. It generalizes escape
analysis from "does this outlive its frame?" to "which scope does this outlive?",
as Go's and HotSpot's escape analyses do. It produces, once:

- which values denote the same object;
- which sites, parameters or globals each object field, array element and
  closure capture may hold;
- per function: which parameters escape, are stored, returned or captured, and
  which fields it writes;
- for each allocation, what its fields, elements and map values can hold at
  run time: the possible kinds of value, and number facts. These are joined
  over every write through every alias, and become unknown at any writer the
  program cannot see. Releases, number specialization and bounds read this
  one summary, never a declared element or value type;
- **the home of each site**, per calling context.

**How it is formulated** (the review of 2026-10-27 showed that naming the
outputs is not enough):

| part | treatment |
|---|---|
| aliases | inclusion-based may-point-to (directional); unification only as the fallback when a budget runs out |
| locals | flow-sensitive, over SSA |
| object fields | field-sensitive edges; a strong update only for an object proved to be a single instance |
| arrays and maps | one summary element at first, refined only where a row needs it |
| dynamic instances | a site's most recent instance tracked apart from its summary; repetition domains and multiplicity, so that "allocated in a loop" says how many instances can be live at once |
| calls | parametric summaries: returned aliases, stores, captures, callbacks, exceptions, suspension, reentrancy |
| context | bounded and selective; one shared summary per recursive component, solved bottom-up over the call graph's strongly connected components |
| roots and continuations | closure environments, generator and async frames, promise reactions, module slots, erased payloads, raised values, and the runtime's own roots (cycle candidates, weak structures) are graph nodes with their real lifetimes |
| placement | derived from reachability, lifetime, multiplicity and the runtime contracts together; **one site can have short-lived instances and one survivor** (a loop that keeps its last match), and such a site stays on the heap unless a proof splits its instances |
| budgets | every budget fails closed to the heap, with the reason in the report |

It runs after the transformations that create closures and coroutine frames,
and a later rewrite that changes them invalidates its facts.

It lands without a flag day: computed but unused first, then compared with
today's placement on every program, then read by frame placement, then by
regions, then the duplicated logic is deleted. **The comparison is a
migration check, not the definition of right:** today's placement has the
defects above, so each difference is explained, and the new answer must stand
on its own proof. The first slice is narrow: a parser-shaped workload and an
ordinary tree or list builder, end to end, before generalizing.

**R4(b) is redirected into it:** its result types, report, budgets, fixtures and
reset audits are kept; its analysis of already-counted code is not.

### What it unlocks

- **Regions per site:** inside a cohort, only the sites whose objects survive
  to the reset use the region; short-lived temporaries stay on the heap, where
  their memory is reused at once (the append lesson, decided statically). The
  held arena API lands with its first caller here.
- **Count leftovers:** a release specialized by the object's known type; a sort
  that moves references; a map key counted once; and anchors released at their
  last borrow instead of at function exit (today a list built, walked and then
  idle stays alive to the end of the function).
- **Reuse for arrays and objects:** `xs = xs.toSorted(c)`, `xs = xs.map(f)`,
  `xs = [...xs, v]` and `state = { ...state, k: v }` can reuse the old value's
  storage. TypeScript's immutable-update style gets C-like cost. Being the only
  counted reference is **not** enough to overwrite the source while the
  operation runs:
  - `map`'s callback receives the original array and can read it
    (`xs.map((x, i, o) => o[0])`);
  - a comparator or callback can read `xs` through a closure;
  - getters run during an object spread;
  - a throw part-way must leave `xs` holding its old value
    (`try { xs = xs.map(...throws...) } catch {}`).

  So there are two mechanisms. **Overwriting in place** applies only where no
  callback, getter or iterator can observe the source and no throw can expose
  a half-updated value. **Recycling the storage** of a value proved dead after
  the operation into the next allocation of its size class is Perceus's reuse
  token, and is always safe. Start with the proved subset.
- **A page-based allocator** (try vendored mimalloc first, as Koka, Lean and
  CPython ship): one size per page, empty pages shared by all sizes, which
  removes the cause of the `realloc` failures; then a 16-byte header instead of
  40 bytes of overhead. What the 2026-10-27 research changed in the
  experiment:
  - **Hot reuse is not guaranteed.** mimalloc keeps a page's freshly freed
    blocks on a separate list until allocation runs out, so the block just
    freed is not necessarily the next one returned. nts's measured advantage is
    exactly that immediate reuse, so the experiment measures reuse distance,
    not only time.
  - **Size:** in a standalone probe (GCC 13, `-O2 -flto`, gc-sections,
    stripped; measured by the reviewer), a program grew from 14 KB with libc to
    119 KB with mimalloc v2 and 127–152 KB with v3; rpmalloc was 35 KB. nts's
    hello world is about 16 KB, so allocator size is a decision criterion, and
    rpmalloc joins as a comparator. The size is measured on nts's own programs.
  - **Isolate the allocator:** keep today's header, prefix and accounting.
    Route every storage family through the adapter (objects, array buffers,
    side allocations), and remove nts's own free lists for what is
    substituted, or frees never reach the allocator. Use the explicit
    per-thread heap API, not a malloc override. Regions keep their bump
    allocation and take their chunks from the allocator.
  - **The header comes later and separately.** The prefix holds a free link
    (fine in dead storage) and the cycle collector's candidate index (live
    metadata). Moving the index into the count word clashes with destruction,
    which writes the dying-list pointer into that word before unbuffering
    (`nts_destroy`).
  - **Today's state, corrected:** blocks above the pooled sizes already go
    back to libc's `free`; only pooled sizes are kept.
- **Weak references:** `WeakRef`, `WeakMap`, `WeakSet` and
  `FinalizationRegistry`, as decided, including the cycles that run through a
  `WeakMap` (ephemerons). Their rules constrain everything before them, so
  they are in the contract from stage 0:
  - a target made or read through `WeakRef` stays alive until the current job
    ends (the specification's kept list);
  - cleanup callbacks run as jobs, never inside a release or a collection;
  - a registry's held values are strong;
  - a value's reference back to its own `WeakMap` key does not keep the entry
    alive;
  - an object that can be weakly observed is always on the heap, never in a
    frame or region, and its storage is never reused while a weak reference
    can still name it;
  - the object header and the allocator leave room for a weak flag and a side
    table.

### Resetting a region is safe only if nothing can still walk into it

Elsman (PLDI 2023) found the failure that region schemes over a collector hit:
the program never reads a pointer again, but the collector follows it into
reclaimed memory. nts's cycle collector walks references, so a reset proof must
cover the runtime too: no cycle candidate, collector work list, weak structure
or traced field can reach reclaimed storage, or those edges are cleared first.
Source-level last use alone is not a proof. A use after reset is caught at
run time today: under ASan regions keep no blocks and free lists stop
recycling, and under `NTS_POISON` a reset fills its blocks with a pattern and
checks membership. Checking at reset that no cycle candidate or collector work
list points into the region is the next instrument
([plan](../plan.md#from-the-bun-and-scriptc-studies)).

### A region needs two proofs

A site goes into a region only with two proofs, and without either it stays on
the counted heap:

- **Lifetime:** no reference to an object outlives its region. This is what the
  analysis above proves.
- **Retention:** the region adds only bounded dead memory compared with the
  counted heap. The count covers object bodies, the backing stores of arrays
  and strings, regions kept alive past their reset, and heap objects held
  through the fields of dead region objects, since a small region can hold the
  only reference to a large heap graph. A size cap per region does not bound
  it. In a loop that leaves one survivor per iteration, a dead temporary in each
  iteration's region that still points at the previous survivor keeps every
  earlier region alive, while the program's live data stays small.

A site's home is fixed at compile time. A run-time quota that sent a region
site to the heap when full would need both homes' counting code at every use,
so nts has none: a site whose retention is not proved bounded stays on the
heap.

Speed and space are separate acceptance criteria. Each stage 3 row is
measured at three input sizes and iteration counts. Its retained bytes (region
bytes, regions kept alive, heap bytes held through region fields) must not
grow faster than the counted heap's live bytes. A speedup at one size proves
nothing about space.

### How small the dynamic part can get

Static analysis cannot remove the run-time checks and the cycle collector for
every program: whether two references can denote the same object is
undecidable in general, so any analysis must answer "maybe" somewhere, and
"maybe" needs a run-time answer. Languages that avoid both do it by
restricting the language (Rust's ownership types, Koka's and Lean's immutable
data), which TypeScript does not allow. What the compiler can do is make both
rare and cheap:

- **Uniqueness:** a value the program has not yet stored, captured or passed to
  unknown code is unique by construction; the memory analysis reports it, and
  its in-place updates skip the test. The test remains only where a value came
  from a container or a caller, and there it is one comparison (Koka measured
  about 1%).
- **Cycles:** the collector only ever sees heap objects of a type that can form
  a cycle, after a decrement that left them alive.
  - Whole-program type analysis already removes most types (nts sees every
    class, so it needs none of Nim's "any subclass may close a cycle").
  - Stage 8 proves trees from how they are built. Being unpublished is not
    enough: `x.next = x`, or two fresh objects linked both ways, closes a
    cycle before either escapes. The proof is an order: every reference
    stored into a field points to an object created strictly earlier, with no
    field rewritten afterwards, covering self-edges, aliases, erased stores and
    calls made during construction.
  - A cyclic structure in a cohort region needs no collector at all: the reset
    frees it whole.

  What remains is a program that genuinely builds cycles on the long-lived heap
  (doubly linked lists, parent pointers, graphs), and there the collector is
  the right tool.

### Threads

One heap per thread, with plain (non-atomic) counts permanently. JavaScript
workers share no objects, only `SharedArrayBuffer` bytes, so no program can
tell. Atomic counts cost 5–59% in Koka and 1.13–2.31x in Lean.

Later, sending can avoid the structured clone where the compiler proves it
safe:

- **A move:** the sender never touches the sent graph again, so the whole graph
  changes owner in one step, as Nim's `Isolated[T]`, Pony's `iso` and Verona's
  regions do.
- **Frozen sharing:** the graph is never written after it is sent, so both
  sides read one copy. It cannot carry per-object counts then; it is shared as
  one unit with one count, or as immortal data.

Both wait for workers (stage 9).

### Cycles through foreign objects

Every native host nts binds counts references too: Objective-C and Core
Foundation (retain/release), GObject (`g_object_ref`/`unref`), COM and WinRT
(`AddRef`/`Release`). nts holds a host object through a wrapper that owns one
host reference. The collector cannot see references the host holds, so a
cycle through a host object, such as a closure capturing the object that holds
it, is invisible to it unless the host's side is made visible.

The mechanism exists: `NtsHolders` in `runtime/c/nts_runtime.h`. A family
makes each host object that holds nts closures a node of the trace, counted by
the host's own count, and severs a garbage node by making the host let go of
its closures.

| host | today | tested |
|---|---|---|
| GTK (GObject) | **collected.** The one family registered: a GObject's signal handlers are its held closures, its `ref_count` is read at checkpoints, and a garbage cycle is severed by disconnecting the handlers. | `tests/interop/gtk-cycles`: no cycle, a cycle through itself, the same inside a window that is then destroyed |
| Windows (WinRT, COM) | **leaks until the program unsubscribes.** An event handler that captures its source keeps both alive. The async bindings avoid it by handing the handler the object instead of capturing it. | `tests/interop/windows-winrt` pins the leak: one delegate alive without `remove_Closed`, none with it |
| Apple (Objective-C, CF) | **not collected.** Classes nts defines keep their state in an ivar released at `dealloc`, blocks capture nts closures, and no family is registered. AppKit's delegates and targets are weak by convention, which avoids the commonest cycles; a stored block or handler that captures its owner leaks. | no cycle test |

The two missing families differ in what the host lets nts count:
- **WinRT delegates** are COM objects nts implements, so their
  `AddRef`/`Release` are nts's own and the count is exact. That gives a family
  like GObject's, severed by dropping the delegate's closure.
- **Objective-C** retain counts are not observable in general (side tables,
  tagged pointers). The classes nts creates can count their own retains by
  implementing `retain` and `release`, at a cost to measure; blocks have no
  public count. Until a design settles blocks, their cycles need weak
  references or explicit invalidation.

### Our own JSON parser needs one change

`runtime/web-platform/src/json/parse.ts` starts every open container with
*shared* empty arrays it never pushes to, guarded by `isArray`. No analysis
that does not follow that flag can tell those pushes from pushes into a global.
The fix is in our own code: `null` instead of the shared arrays, which saves
the same allocation. nts and node run the same changed source, so the
comparison stays fair; the analysis's report names such stores by site, so a
user's code written the same way can be fixed the same way. It is not the whole
story: the parser also reuses frames across containers and shares key
templates between results, and the analysis must still tell those lifetimes
apart.

### Measuring the cycle collector

M6 keeps trial deletion and measures it first. The counters, per collection:
candidates and their age; nodes, edges and bytes visited; bytes reclaimed;
repeat visits to graphs that stay live; and time split between traversal,
destruction and freeing. A program's end-to-end latency is reported apart
from the collector's pauses. Four workloads cover what a candidate count
misrepresents: a large live cyclic graph under frequent decrements, a large
cycle that has just become unreachable, a dense graph, and a small cycle
holding a large acyclic payload.

Collecting incrementally needs a progress policy, and a protocol for the
program's mutations between slices. Stopping after a fixed amount of work
turns collection debt into retained memory. CPython 3.14.0 to 3.14.4 shipped an
incremental collector that shortened pauses and raised peak memory in
production, and 3.14.5 reverted it
([release](https://www.python.org/downloads/release/python-3145/)).

## Build order

Each stage is measured on CPU 4 under `with-lock`, paired, on C and LLVM, with
node and Bun in the same sitting.

| stage | work | rows it must move |
|---|---|---|
| 0 | the three defects above (*fixed*); the runtime contract as a record (ownership of every edge kind: region to region, region to heap, heap to region; helpers that may return an argument; weak observation; collector-safe resets); a memory census (sites by home and reason, counts by site, allocation volume, peak live bytes, bytes held until reset, allocator-reserved bytes); land the six Are We Fast Yet ports; new rows (`tree-teardown`, `sort-objects`, `release-acyclic`, `immutable-update`, `array-copying-methods`, `cyclic-churn`); startup time, executable size and peak RSS rows against node and Bun; a macOS cycle test like `gtk-cycles`, recording today's behaviour (it runs when a Mac is available again; there is none now) | none: instruments and fixes |
| 1 | release specialized by type; count-free sort; erased-value releases; one count per map key; anchors held only to the last borrow | `sort-objects` below node and Bun (the merge loop's counting is its cost); `release-acyclic` and `cyclic-churn` lose their generic-walker share; `map-entries-top-k` about −5% more; `awfy-towers` below Bun |
| 2 | the one memory analysis, facts only, as formulated above; its first slice end to end (a parser-shaped workload and a tree or list builder) | none may move; each difference from today's placement explained |
| 3 | per-site regions; the arena API lands; the JSON parser's `null` placeholders | json-parse below 1.0x node and about 0.75x Bun; `release-acyclic` below node and Bun; `json-build-append` must not regress |
| 4 | borrowed region inputs | `record-word-counts` and `json-stringify-doc` a few percent |
| 5 | reuse for arrays and objects | `immutable-update`, `array-copying-methods` below node and Bun; stop if they don't move |
| 6 | page allocator: mimalloc v3 (v2 as control) and rpmalloc against today's, with today's object layout; then the 16-byte header, measured separately; in-place growth for large buffers | `json-build-append` below Bun; memory of every allocating row; reuse distance; executable size; RSS retained by long-running programs |
| 7 | weak references, on the contract fixed in stage 0; holder families for WinRT delegates and for the Objective-C classes nts defines (blocks: design open); Chromium's joint collection; an N-API family once record 0356's live references exist | test262's `WeakRef`, `WeakMap`, `WeakSet`, `FinalizationRegistry`; `windows-winrt` keeps no delegate without `remove_Closed`; the macOS cycle test collects |
| 8 | proving types acyclic from how they are built, only if a row needs it | cycle-candidate traffic |
| 9 | workers as isolated heaps, behind the web `Worker` API; `SharedArrayBuffer` and `Atomics` on C11 atomics | a message row against node's `worker_threads` |

Stages 1 and 2 run side by side; 3 needs 2; 4 needs 3; 5 and 6 are
independent; 7 needs the stage 0 contract.

**`release-acyclic` is held to stage 3, not stage 1.** Once release is
specialized by type, finding a dying object's fields costs almost nothing.
What remains is freeing each object on its own: loading its header and
descriptor, then returning it to its pool. No change to the release loop can
remove that per-object work; a tree that dies at once, kept in one region and
freed at once, can.

**The riskiest stage is 3, general per-site cohorts:** the most work for the
least certain payoff. Next is 5, because callbacks and observable sources
narrow what may be overwritten. Stage 3 succeeds when its rows move; when a
cohort would hold too much memory, the heap is a successful answer, not a
failure.

## Decisions

The user's, as written ([log](../records/notebooks/decisions-log.md#memory-management-10-27)). Earlier ones still
hold ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)): `NoGc` is for testing only,
and shipped native programs count references; region clones are fine where a
benchmark row pays for them, with a code-size check; acyclic types are proved,
never declared.

| # | decision | why |
|---|---|---|
| M1 | **Redirect R4(b)** into the one pre-counting analysis, keeping its types, report, budgets and fixtures, and change our JSON parser's shared placeholder arrays to `null` | Placement must be decided before counting, from one model of aliasing. It matches the user's 2026-10-23 rule that json-parse is fixed at the general cause, not by the JSON builtin. |
| M2 | **Workers are isolated heaps with non-atomic counts, permanently** | Node and browsers behave the same, so no program can tell. Sending without a copy, by a proved move or frozen sharing, is a later refinement. |
| M3 | **Weak references follow the specification exactly,** with finalization that can run earlier than in node | The alternative is a `WeakMap` that leaks whenever a value refers to its key. The specification allows the earlier timing. |
| M4 | **Vendor mimalloc for the native heap if it wins the rows,** otherwise our own page allocator | Tried first in stage 6. Koka, Lean and CPython ship it. |
| M5 | **No memory annotations in the language:** no user-visible arena, unique or acyclic markers | It extends decision 12. Go's explicit arenas stalled because they "do not compose well". |
| M6 | **The cycle collector stays trial deletion for now.** Its next step is measurement only (per-phase counters, pause and retained-memory distributions, batch-size and candidate-filter controls); an exact tracing backstop waits until stages 2 and 3 have moved the allocation side | Even removing all collector work would leave the cycle-heavy row well behind node, because allocation and the program's own work remain. An exact tracing backstop needs precise roots for C and LLVM frames and a heap registry, the largest architecture change on offer. |

From the open-questions audit (10-28,
[log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)):

- **The bound on what a region or reuse may keep alive** (principle 7) is set
  from the memory census's numbers (M-1).
- **Where the cycle collector's candidate index goes in the 16-byte header**
  is decided in stage 6, by measurement (M-2).
- **M5 covers the language, not binding declarations:** the ownership
  vocabulary ResourceFlow checks in a C binding
  ([native](../targets/native.md#ownership-of-c-pointers)) is not a memory
  annotation in the language (I-5).
- **Startup time, executable size and peak RSS are rows,** against node and
  Bun, built as stage 0 instruments (P-2,
  [log](../records/notebooks/decisions-log.md#performance-and-process-10-28)).
- **Analysis budgets scale with program size,** and every exhausted budget is
  reported by name, as principle 8 fails closed (P-7,
  [log](../records/notebooks/decisions-log.md#performance-and-process-10-28)).

## Evidence

The study behind this page, with its measurements, the comparison with 15
systems and about 70 sources, is [in the records](../records/notebooks/studies/memory.md).
