# Memory management (native)

**Status:** designed 2026-10-27, waiting for the user's decisions (below). This
page covers C and LLVM. The JVM and Wasm use their host's garbage collector.

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

## Against the state of the art

| system | strengths | what it relies on that TypeScript lacks |
|---|---|---|
| **Koka (Perceus)** | counts placed exactly; in-place reuse of dying values; rbtree within 10% of C++ | immutable data; no cycle collector at all |
| **Lean 4** | borrowed parameters; reset/reuse | purity; no cycles |
| **Nim ARC/ORC** | moves, borrowing, a Bacon–Rajan cycle collector that skips acyclic types: **nts's closest relative**, reached independently | it must assume every non-final class can form cycles, and offers an unchecked "acyclic" annotation |
| **Swift** | ownership SSA, copy-on-write, stack promotion | atomic counts everywhere; no cycle collection |
| **Lobster** | single owner chosen at the first store; ~95% of counts removed | single-threaded; cycles only reported |
| **High-performance RC runtimes** (RC Immix, LXR) | deferred and coalesced counting | stack maps and write barriers, which a C backend cannot provide cheaply |

How nts compares:

- **Allocation: ahead.** None of them chooses frame, region or heap per
  allocation site from a whole-program analysis.
- **Counting: about level.**
- **Reuse: behind.** Perceus reuses any dying value of the right size; nts
  reuses only strings.
- **nts can never be as simple:** TypeScript objects are mutable, shared and
  can form cycles, so uniqueness is checked at run time and a cycle collector
  is required. The realistic floor is what C++ pays with `shared_ptr`: counts
  only on references that are genuinely shared and long-lived.
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
7. **Frame-limited:** no transformation may hold memory longer than a constant
   per stack frame (the criterion from Lorenzen and Leijen).

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
- **the home of each site**, per calling context.

It lands without a flag day: computed but unused first, then checked equal to
today's frame placement on every program, then read by frame placement, then by
regions, then the duplicated logic is deleted.

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
  `xs = [...xs, v]` and `state = { ...state, k: v }` update in place when the old
  value is unique and dies. TypeScript's immutable-update style gets C-like
  cost.
- **A page-based allocator** (try vendored mimalloc first, as Koka, Lean and
  CPython ship): one size per page, empty pages shared by all sizes, which
  removes the cause of the `realloc` failures; then a 16-byte header instead of
  40 bytes of overhead.
- **Weak references:** `WeakRef`, `WeakMap`, `WeakSet` and
  `FinalizationRegistry`, as decided, including the cycles that run through a
  `WeakMap` (ephemerons).

### Threads

One heap per thread, with plain (non-atomic) counts permanently. JavaScript
workers share no objects, only `SharedArrayBuffer` bytes, so no program can
tell. Atomic counts cost 5–59% in Koka and 1.13–2.31x in Lean.

### Our own JSON parser needs one change

`runtime/web-platform/src/json/parse.ts` starts every open container with
*shared* empty arrays it never pushes to, guarded by `isArray`. No analysis
that does not follow that flag can tell those pushes from pushes into a global.
The fix is in our own code: `null` instead of the shared arrays, which saves
the same allocation. nts and node run the same changed source, so the
comparison stays fair; the analysis's report names such stores by site, so a
user's code written the same way can be fixed the same way.

## Build order

Each stage is measured on CPU 4 under `with-lock`, paired, on C and LLVM, with
node and Bun in the same sitting.

| stage | work | rows it must move |
|---|---|---|
| 0 | the runtime contract as a record; a memory census (sites by home and reason, counts by site, region bytes); land the six Are We Fast Yet ports; new rows (`tree-teardown`, `sort-objects`, `immutable-update`, `array-copying-methods`, `cyclic-churn`, `weak-cache`) | none: instruments |
| 1 | release specialized by type; count-free sort; erased-value releases; one count per map key; anchors held only to the last borrow | `map-entries-top-k` about −5% more; `awfy-towers` below Bun |
| 2 | the one memory analysis, facts only, checked equal to today's frame placement | none may move; compiled output identical on four backends |
| 3 | per-site regions; the arena API lands; the JSON parser's `null` placeholders | json-parse below 1.0x node and about 0.75x Bun; `json-build-append` must not regress |
| 4 | borrowed region inputs | `record-word-counts` and `json-stringify-doc` a few percent |
| 5 | reuse for arrays and objects | `immutable-update`, `array-copying-methods` below node and Bun; stop if they don't move |
| 6 | page allocator; 16-byte header; in-place growth for large buffers | `json-build-append` below Bun; memory of every allocating row |
| 7 | weak references (independent; may start any time) | test262's `WeakRef`, `WeakMap`, `WeakSet`, `FinalizationRegistry` |
| 8 | proving types acyclic from how they are built, only if a row needs it | cycle-candidate traffic |
| 9 | workers as isolated heaps | a message row against node's `worker_threads` |

Stages 1 and 2 run side by side; 3 needs 2; 4 needs 3; 5, 6 and 7 are
independent.

## Decisions for the user

| # | decision | recommendation |
|---|---|---|
| M1 | **Redirect R4(b)** into the one pre-counting analysis, keeping its types, report, budgets and fixtures, and change our JSON parser's shared placeholder arrays to `null` | **Yes.** It shelves reviewed work, so it is yours to decide. It matches your 2026-10-23 rule that json-parse is fixed at the general cause, not by the JSON builtin. |
| M2 | **Workers are isolated heaps with non-atomic counts, permanently** | **Yes.** Node and browsers behave the same, so no program can tell. |
| M3 | **Weak references follow the specification exactly,** with finalization that can run earlier than in node | **Yes.** The alternative is a `WeakMap` that leaks whenever a value refers to its key. The specification allows the earlier timing. |
| M4 | **Vendor mimalloc for the native heap if it wins the rows,** otherwise our own page allocator | **Try mimalloc first,** in stage 6. |
| M5 | **No memory annotations in the language:** no user-visible arena, unique or acyclic markers | **Confirm.** It extends decision 12; Go's explicit arenas stalled because they "do not compose well". |

## Evidence

The study behind this page, with its measurements, the comparison with 15
systems and about 70 sources, is `~/.cache/nts-scratch/foundations/memory/report.md`
(local, not in the repository).
