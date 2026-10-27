# One memory design for nts's native backends (C and LLVM)

Research and design study, 2026-10-26/27. Main is `b22504de1`.

**Terms used throughout:**

| term | meaning here |
| --- | --- |
| **RC** | reference counting: each heap object counts the references to it and is freed when the count reaches zero |
| **retain / release** | add one to / take one from a count |
| **borrow** | use a reference without a count of its own, because something else provably keeps the object alive |
| **move** | hand a reference on without touching the count (the giver stops using it) |
| **frame placement** | an object lives in its function's stack frame because nothing outlives the call |
| **region / arena** | memory that many objects are bump-allocated into and freed all at once (a "reset") |
| **cohort** | the objects that die together at one reset |
| **trial deletion** | nts's cycle-collection algorithm (Bacon and Rajan): pretend to delete candidates' internal references and see what is left |
| **reuse** | build a new value in the memory of a dying one when a run-time check shows it is the only reference (Perceus) |
| **size class / free pool** | the allocator rounds sizes up to classes and keeps a list of freed blocks per class |
| **frame-limited** | holding extra memory bounded by a constant per stack frame (Lorenzen and Leijen's space-safety criterion) |

---

## 1. Summary

**The recommendation:**
- Keep reference counting as the base.
- For each allocation site, choose one *home* for its objects: registers, the frame, a region that dies with a caller's result, or the counted heap.
- Make that choice from **one** whole-program alias-and-lifetime analysis, run before counts are inserted.
- Then reuse dying unique values in place, and let the cycle collector see only what none of that could prove.

**Why this design:**
- **RC is the right base, and the evidence says so.**
  - It reuses memory the instant it dies, which keeps hot data in L1. Making container frees a no-op was *slower on every row*: json-build-join +74-76%, RSS 18 -> 328 MiB.
  - It allows in-place mutation of a value nobody else can see, which a tracing collector cannot do. The in-place string append took `node-utf8` from 3.14x to 1.28x node (record 0029).
  - It needs no map of where pointers sit on the stack. Deferred RC and tracing need one (RC Immix, LXR, V8's scavenger); ISMM'12 says deferral "require[s] GC maps, removing the implementation advantage over tracing". A C backend could provide such a map only through a shadow stack that costs on every call.
  - The competitors pay almost nothing per dead young object (V8's scavenger costs "proportional to the number of surviving objects"). So nts wins only where an object is never heap-allocated, is reused in place, or is freed in bulk. That is exactly the ladder below.
- **Counting is close to its floor; allocation and teardown are not.**
  - All 77 `tests/memory` cases sit at their argued floors, for both operations and allocations.
  - **Teardown.** json-parse spends about 28% of its cycles in release, destroy and the reference walk. A region per parse measured -50% wall, 1.58x -> 0.78x node and 1.35x -> 0.67x Bun, on the corrected collector.
  - **Count traffic in sorts.** `map-entries-top-k`'s count-free sort arm measured -11.7%.
  - **Fat objects.** Every heap object carries 40 bytes of header and allocator prefix before its first field.
- **The pieces exist, but each has its own model of aliasing.**
  - `escape.rs`, `own.rs`, `regions.rs` and the frozen R4(b) branch each re-derive "who can reach this object, and until when". That is the failure record 0024 diagnosed for counting.
  - R4(b) is the starkest case. It reasons over the *output* of counting, path-exactly under small budgets. After 5,814 lines, its summaries cover 12 functions' normal returns, 37 functions stay Unknown, and all 372 json-parse placements stay Unknown.
  - **Redirect it:** one pre-counting "home" analysis that generalizes escape analysis from "outlives the frame?" to "outlives which scope?". Frame placement, regions, ownership and the cycle analysis all read it.

**How smart can nts's RC get?**

| area | how nts compares |
| --- | --- |
| **Allocation** | Smarter than Koka, Lean or Nim. None of them chooses heap, frame or region per allocation site from an escape analysis. nts has the whole program and static types to do it. |
| **Counting** | About level with them. nts already has precise last-use releases, inferred borrowing, moves, Swift-style "take" loads and inferred consuming parameters. |
| **Reuse** | Behind. Perceus reuses any dying unique value of the right size; nts reuses only strings. |

And nts can never be as simple, because TypeScript objects are mutable, shared and cyclic:
- Uniqueness must be checked at run time. Koka and Swift check it too, and FP² measured the check at about 1%.
- A cycle collector is mandatory. Koka "leave[s] the responsibility to the programmer to break cycles"; Lean, Lobster and Swift collect none.

The realistic ceiling is that counts remain only on genuinely shared, long-lived, mutable references, which is what C++ with `shared_ptr` also pays.

**Were we influenced by Perceus or Lean 4?** Only lightly, by name:
- Record 0024 names Perceus reuse as the next mechanism. The string append is a run-time-checked reuse of exactly that kind, but record 0029 arrived at it from `sds` and V8 strings, not from Koka.
- The code cites Swift's OSSA load kinds (copy, borrow, take), Lobster's 95% figure and Bacon and Rajan. Objective-C ARC shaped the foreign-handle rules.
- Nothing in the repository mentions Lean, Nim, Koka or Roc.
- nts reached Nim ARC/ORC's design independently, and Nim is its closest relative (section 3).

**Build order (section 5):**

| stage | what |
| --- | --- |
| 0 | the contract record, the instruments and the missing rows, including landing the six AWFY ports |
| 1 | cheap wins on today's analyses: release specialized by type, count-free sort, erased releases, anchors that stop holding at the last borrow |
| 2 | the one memory analysis: facts only, proven equal to today's escape answer |
| 3 | per-site cohort regions (stage C proper, json-parse first); the held arena API lands here |
| 4 | borrowed region inputs |
| 5 | reuse for arrays and objects |
| 6 | a page-based allocator (vendored mimalloc first) and a smaller header |
| 7 | weak references with ephemerons: a feature, which may start any time |
| 8 | acyclicity proved from construction, only if a row needs it |
| 9 | workers as isolated heaps |

**Your three main decisions (section 6), all recommended yes:**
1. Redirect R4(b).
2. Workers get isolated heaps with non-atomic counts, permanently.
3. `WeakMap`, `WeakRef` and `FinalizationRegistry` follow the specification exactly, accepting finalization earlier than node's.

---

## 2. What nts does today

### 2.1 The pipeline, as it touches memory

`prepare_lowered` (`compiler/core/src/hir/mod.rs:7777`) runs these steps in order:
1. `scalarize`
2. number specialization
3. `simplify`
4. `boxing::materialize`
5. `entries::share`
6. `destinations::pass` (strings, under RC)
7. `place_allocations` (escape -> frame)
8. `regions::rewrite` (call regions, under RC)
9. `rc::insert` (ownership and counts)
10. bounds checks
11. `regions::placement::inventory` (R4(a), report only)

`runtime/c/nts_runtime.{h,c}` supplies the allocator, retain and release, the cycle collector and regions. JVM and Wasm (`HostGc`) skip frame placement, regions and counting (`mod.rs:7943`).

### 2.2 Mechanism by mechanism

| # | mechanism | what it proves or decides | where | what it moved (measured) | known gaps |
| --- | --- | --- | --- | --- | --- |
| 1 | **Object representation** | 24-byte header: descriptor, count word, flags (colours, buffered, dying, string width, grown, hashed, 26 presence bits), length. Heap blocks add a 16-byte prefix: size, plus candidate index or free link | `nts_runtime.h:367`, `:1117-1220`; `nts_runtime.c:921-990` | -- | 40 bytes before the first field; `length` carried by objects that have none |
| 2 | **Scalar replacement** | an object whose every use is its own field reads and writes, or a store-only constructor, becomes SSA values | `hir/scalarize.rs` | `user-iterable`, `optional-chain` (module notes) | runs before counting; objects that cross calls stay objects |
| 3 | **Frame placement** | an `ObjectNew`, or a bounded string from an `_into` helper (128 units at most), whose reference never outlives the frame lives in it. One slot per site, an `NTS_IMMORTAL` header, and a compiler-emitted release walk of its reference fields | `hir/escape.rs`; `mod.rs:8288` (`place_allocations`), `frame_capacity` | `objects` 31x -> parity with C (0006); `early-return` 17 -> 0 allocations (0028) | arrays are never frame-placed; an array that can be a cycle candidate cannot hold frame objects (0056); a repeated allocation stored into a container goes to the heap |
| 4 | **Ownership, one answer per value** | each SSA value is `Unowned`, `Produced`, `Copied`, `Taken` or `Borrowed`. Borrowing is a *greatest* fixpoint from anchors (parameters, entry-owned locals, settled slots, settled `const` globals). `Taken` loads (Swift's `load [take]`); a store over a zero owes nothing | `hir/own.rs:59`, `:697` (`analyze`), `:1898`, `:2694`, `:3984` | the 15 original cases cut 75% of naive operations, the rest argued necessary (0024); `awfy-towers` 6.79x -> 1.28x C++ and `awfy-list` 12.97x -> 1.80x (0024, 0025); all 77 memory cases at both floors (`tooling/memory/run.sh`) | anchors are held to **every exit** (`own.rs:1725-1800`), so garbage lives to function end (4.4, 4.12) |
| 5 | **Per-function summaries** | `mutates` (a boolean), `harmless`, `hands_back`, `consumes`, `stores`, `zeroed`, `settled_globals`, `stack_returns` | `own.rs:82`, `:244` | `param-returned` 68 -> 34 and `store-elsewhere` 168 -> 33 (0024) | 0024's per-slot `writes` column is unbuilt |
| 6 | **Counting** | a release follows the last use inside a block, or sits on a split edge where a value dies along one arm. Parameters are borrowed by default; a hand-off where a value dies is a move | `hir/rc.rs:128`, `:867`, `:1472` | (row 4) | releases are not specialized by type (`emit.rs:6021` emits generic `nts_release` / `nts_value_release`) |
| 7 | **In-place string growth** | a `+` whose left side is owned and dies becomes consuming `nts_str_append`, which writes in place when `reserved == 1` and there is room. Non-consuming twins where the left side survives. Capacity derived from length (`NTS_GROWN`, floor 16, doubling to 1 Mi units) | `rc.rs:896-922`; `own.rs:2506`, `:2526`; `nts_runtime.c:3844-3900` | `node-utf8` 3.14x -> 1.28x node, `string-append` 17 -> 2 allocations (0029); 1.06x node by 2026-10-23 (`results/benchmarks/full.md`) | grows by copying into the next class; two realloc variants rejected (2.4) |
| 8 | **Destination passing for strings** | a function whose string answer is only appended gets an `f#into` variant that appends into the caller's string; helper answers append without a temporary | `hir/appended_results.rs`, `hir/destinations.rs` | JSON writer rows at 0.38-0.50x node (2.5), one cause among several (formatter, quoting, literal hashes) | strings only |
| 9 | **Inline RC fast path** | `nts_retain` inline. `nts_release` decides two cases inline: count > 1 with an acyclic type, and count > 1 with a cyclic type already buffered. The rest goes out of line | `nts_runtime.c:1382`, `:2121` (`9555dc925`, `00b9eab90`) | `map-entries-top-k` -27%, `awfy-bounce` -10%, json-parse -8% (memory study); `awfy-list` 18.3 -> 12.1 us, `awfy-towers` 49.2 -> 35.2 us | still loads `descriptor->cyclic` where the static type already proves the answer |
| 10 | **Type-level cycle analysis** | a layout is cyclic if it sits in a non-trivial strongly connected component of the layout/slot graph (fields, bases, structural prefixes, casts; erased and closure slots lead anywhere). Array descriptors are per element type | `hir/cycles.rs`; `mod.rs:4497` | `Row[]` arrays stopped being walked at every checkpoint | trees of a recursive type (`JsonValue`, list nodes) count as cyclic; decision 12 forbids declaring otherwise |
| 11 | **Cycle collector** | synchronous Bacon-Rajan trial deletion. A non-zero decrement of a cyclic-type object buffers it (purple); a pass marks gray, scans, gathers white, then frees, over iterative work lists. Threshold `max(10,000, survivors of the last pass)`; a pass at each task checkpoint; foreign holder nodes; never inside a region's call | `nts_runtime.c:1991-2460`, `:11323` | starvation fix `17791f3c3`: json-parse -28.6% C / -26.5% LLVM, RSS 273 -> 7.5 MiB; `json-stringify-doc` -57% / -59% | no ephemerons (weak collections are refused); a cycle is found only through a decrement that does not reach zero (0025) |
| 12 | **Call regions (R1-R3, landed)** | for `r = f(args)` whose closure stores only into fresh objects, points outside only at fresh, immortal, settled-global or kept-argument values, and whose result the caller only reads: a `f#region` clone compiled without counting. Every allocation in its dynamic extent goes to an ambient region (`NTS_IMMORTAL`), reset when a counted handle dies | `hir/regions.rs:1421`; `nts_region_*` (1 MiB blocks, 8 kept) | `awfy-list` 0.83x of its own baseline; `traversal` 33 ops -> 1 (`~/.cache/nts-scratch/compiler/regions-design.md`) | ambient, so every allocation in the call goes to the region; refuses raising and appending closures; one benchmark site family (`JsonValue.objectValue -> ascendingByIndex`) |
| 13 | **Per-site placement** | R4(a) (`ecdc70411`): inventory only, every site `Unknown(not analysed)`. R4(b) (`7d768f73a`, frozen): bounded symbolic provenance over *prepared, counted* HIR, exact retain credits, caller intervals | `hir/regions/placement.rs`; R4(b) adds 5,814 lines | summaries cover 12 functions' normal returns, 37 functions Unknown, 372 json-parse placements Unknown; compile instructions +0.71% on json-parse and +1.03% on the region control (empirical, not final) | no consumer (4.6) |
| 14 | **Explicit arena API (held)** | per-owner arena allocation; adopt, keep and forget tickets for arena-to-heap edges; reset releases outstanding tickets; 8 MiB idle cache per environment | `252b3ba25` | inactive overhead: join +0.77% instructions, +1.4-3.1% wall, hence the `NTS_RUNTIME_ARENAS` build fact | lands only with its first caller |
| 15 | **Allocator** | per environment: 65 classes in 16-byte steps up to 1 KiB, LIFO free lists threaded through dead blocks, over `malloc`; blocks never returned and never moved between classes | `nts_runtime.c:184-185`, `:936-1030` | LIFO reuse is why freeing beats leaking (2.4) | pools cannot rebalance, the root of the realloc failure (2.4) |
| 16 | **Threads** | one `NtsEnvironment` (heap, collector, queues) per owner thread; counts non-atomic by contract; the `_Thread_local` environment pointer measured free (0.215 s vs 0.212 s) | records 0176, 0018 | -- | no workers yet |
| 17 | **Exceptions** | explicit: a raise sets a slot and callers test after each call; releases and region resets on raise paths are ordinary edges | 0070, 0071 | -- | a raised value must not live in a region (R3 refuses such sites) |
| 18 | **Weak references** | `WeakRef`, `WeakMap`, `WeakSet` and `FinalizationRegistry` refused as unrepresentable | `hir/lower.rs` ~46435 | -- | the user decided they are represented (first decision set, item 4) |
| 19 | **Written widths** | a written scalar kind (`Uint8`) is stored at its width | `written_roots.rs`, `written_storage.rs` | smaller objects | sizes, not lifetimes |

### 2.3 Four models of one question

| pass | question it answers | model | runs |
| --- | --- | --- | --- |
| `escape.rs` | does this allocation outlive its frame? | per-parameter least fixpoint, `(what, into)` store pairs, contents returned | before counting |
| `own.rs` | is this value kept alive by an anchor? is this slot still zero? | freshness dataflow, anchors, greatest fixpoint | inside counting |
| `regions.rs` | does everything this call makes stay inside its result? | three whole-program facts over a call's closure | before counting |
| R4(b) | does this allocation instance survive to a reset? | path-exact symbolic provenance and retain credits | after counting |

Record 0024 warned that "the last four analyses in this area were each locally right and jointly incoherent". The region facts failed on json-parse because "a value read from a field is not fresh" (R2), which is a points-to question none of the four answers in a way the others can reuse.

### 2.4 What the experiments already taught

All runs were by the runtime agent or the memory study: CPU 4 under `with-lock`, paired A/B. Floors and loads are in the cited tables.

| experiment | result | lesson |
| --- | --- | --- |
| **Leak ceiling** (container release a no-op) | slower on every row: parse +17%, word counts +9-13%, join +74-76% (RSS 18 -> 328 MiB); a low-retention repeat was still slower on every row | per-object frees are cheap; immediate LIFO reuse is worth more |
| **Collector starvation fix** `17791f3c3` | parse -28.6% / -26.5%; doc -57% / -59%; RSS 273 -> 7.5 MiB | the trigger must not depend on the garbage it should find |
| **Region ceiling on the fixed collector** | parse -50.1% / -48.9% wall, -43% instructions; node 1.575 -> 0.777x, Bun 1.347 -> 0.667x; join -5.7% / -4.8%; doc -3.8% / +4.7%, inside 20-30% floors; **append +9.3% / +6.9%** | regions pay for cohorts that die together and lose for young temporaries (`collector/fixed-regions/table.md`) |
| **Why append lost** | same 448 allocations and 160 regrows in every arm; the heap reused 8 addresses (864 B) per call while the arena touched 448 (37 KB); L1 misses per call 0.05 -> 219 | placement must be per site: what dies young stays on the heap |
| **Borrowed-input ceiling** (inputs pinned immortal) | 2-8% fewer instructions than the counted-production arm | second order |
| **Ambient region for a one-string call** (R3) | serialize 1.13x, fused 1.19-1.27x, inline 1.25-1.27x of baseline | a region needs repeated allocation (the cost rule) |
| **General realloc for unique strings** (`96cbfef9b`) | blocks parked in destination pools: 9.7-18.4 KB per call; RSS 4.4 -> 349 / 470 / 816 MiB; join +65%, template +79-84%, serialize +42%; large-output stringify rows **-4 to -8%** | the allocator's pools, not realloc, were the problem |
| **Realloc outside the pools only** (`2cf3462c0`) | no accumulation; append +5.6% (C), join +5-6%, serialize +3.1% (C); stringify rows -5 to -9%; the class guard alone cost +5.3% instructions | in-place growth pays for large outputs and costs for medium ones |
| **Inactive arena API** | join +0.77% instructions, +1.4-3.1% wall | a mechanism no site selects must cost nothing |
| **Count-free sort arm** | top-k -11.7% alone; 21.3 -> 20.1 us on top of the fast path | sorting should move references, not copy them |

### 2.5 The rows memory decides

- Ratios are nts over the host running the *same* TypeScript; lower is better.
- **A** = append-growth matrix, scaffold arm (inside the baseline's floor), C, 2026-10-25, load 1.4-4.4.
- **F** = `results/benchmarks/full.md`, 2026-10-23, LLVM ratios, measured **before** the collector fix.

| row | x node | x Bun | source | what memory decides there |
| --- | ---: | ---: | --- | --- |
| json-parse | 1.56 | 1.25 | A | teardown of the document (regions) |
| record-word-counts | 0.58 | 1.31 | A | borrowed inputs, about 5%; the rest is Map and strings |
| json-build-append | 0.50 | 1.10 | A | string growth (builders must stay on the heap) |
| json-build-join | 0.58 | 1.03 | A | part arrays and strings (regions, -5%) |
| json-serialize | 0.49 | 1.02 | A | string growth |
| json-stringify-doc | 0.74 | 0.32 | A | collector; borrowed walk stack |
| str-append-length | 1.28 | 1.34 | A | rope versus flat representation, not ownership |
| array-from | 4.37 | 1.70 | F | probably growth without a capacity hint (not profiled) |
| awfy-towers / awfy-list | 0.65 / 0.45 | 1.00 / 0.55 | F | releases of a recursive type |
| objects | 0.96 | 1.22 | F | **not memory**: frame placement removes every allocation, and C++ (1.82 us) is equally behind Bun (1.49 us) |
| map-entries-top-k | -- | -- | not published | sort copies, key retains (C 30.3 us vs C++ 18.2 us before the fast path) |

---

## 3. State of the art

### 3.1 Comparison

| system | how counts are minimized | in-place reuse | allocation off the heap | cycles | threads | relies on |
| --- | --- | --- | --- | --- | --- | --- |
| **nts today** | borrow inference (greatest fixpoint), moves, takes, inferred consuming parameters, initializing stores, whole-program summaries | strings, run-time count == 1 | scalar replacement, frame placement, call regions | synchronous trial deletion plus whole-program type-level acyclicity | one heap per thread, non-atomic | whole program, static types |
| **Koka (Perceus)** | precise owned dup/drop (drop as early as possible), dup push-down and fusion, drop specialization | reuse tokens checked at run time; reuse specialization; FBIP and `fip` | none by escape analysis | **none** ("responsibility to the programmer") | thread-shared objects marked; negative count means atomic | immutable data, explicit control flow, strict evaluation |
| **Lean 4** | borrowed parameters with a heuristic inference | `reset`/`reuse` checked at run time | none | none: the verifiable fragment cannot make cycles | single-threaded, multi-threaded or persistent tag in the count | purity |
| **Nim ARC/ORC** | last-read moves, `sink`/`lent`, cursor inference, scope-based destroy | `sink` moves | value objects by type, not by escape analysis | ORC: Bacon-Rajan based, O(1) root removal, adaptive threshold, generational pruning since 2026-10; type acyclicity plus an unchecked `{.acyclic.}` pragma | moved isolated subgraphs; `atomicArc` / `yrc` options | static ref graphs |
| **Swift** | OSSA ownership SSA, copy propagation, `borrowing`/`consuming`/`consume` | copy-on-write through `isKnownUniquelyReferenced` | stack promotion of non-escaping classes | none (weak and unowned) | **atomic** counts | separate compilation and ABI stability |
| **Lobster** | single owner chosen at first store, the rest borrows; functions specialized by ownership | strings when unique | inline structs | not collected (a cycle report at exit) | single-threaded | whole program |
| **Roc** | Perceus plus Morphic borrow inference | opportunistic in-place mutation | platform arenas | impossible by design (no mutation) | -- | purity |
| **RC Immix / LXR** | deferred and coalesced RC (stack not counted) | -- | Immix lines and blocks, copying | backup tracing | concurrent | GC maps, barriers, a moving collector |
| **MLKit** | -- | -- | inferred regions (`letregion`) | GC fallback | -- | ML types and effects |
| **Go** | -- | -- | escape analysis -> stack; experimental `freegc`; region design without a prototype | tracing GC | -- | GC |
| **HotSpot / Graal** | -- | -- | connection-graph escape analysis; scalar replacement; partial escape analysis | tracing GC | -- | JIT, deoptimization |
| **V8 / JSC** (the hosts nts is measured against) | -- | -- | V8 has allocation elimination | generational tracing (V8 copying nursery; JSC non-copying "sticky mark bits") | -- | JIT |

### 3.2 System by system

#### Koka, Perceus
Reinking, Xie, de Moura, Leijen, PLDI'21 ([TR](https://www.microsoft.com/en-us/research/uploads/prod/2020/11/perceus-tr-v4.pdf)).
- **Mechanism:**
  - Drops are placed "as soon as possible" and dups "as late as possible".
  - Drop specialization inlines a known constructor's drop; dup/drop pairs then fuse.
  - Reuse analysis pairs a dying matched value with a same-size allocation; `drop-reuse` returns a token only if the count is one at run time.
  - Reuse specialization rewrites only the changed fields.
- **Results** (TR Fig. 9):
  - rbtree "within 10% of the C++ performance".
  - Without the optimizations it is more than 2x slower.
  - Java uses almost 10x the memory.
  - Atomic counts everywhere: "a slowdown from 5% (rbtree) up to 59% (nqueens)".
- **Preconditions:** explicit control flow, immutable data ("it is statically known where cycles can possibly be introduced"), no cycle collector.
- **The authors' own caveat:** "we expect a GC to do better when reuse optimization is not triggered, and there is lots of short-lived object allocation". That is nts's case for frame placement and regions.
- **Transfers to nts:** drop specialization, dup/drop fusion, run-time-checked reuse tokens.
- **Does not transfer:** garbage-freedom and having no collector.

#### Frame-limited reuse
Lorenzen and Leijen, ICFP'22 ([PDF](https://www.microsoft.com/en-us/research/uploads/prod/2023/07/flreuse.pdf)).
- **The problem:**
  - Earlier reuse was fragile (Koka) or could "lead to an arbitrary increase in peak memory usage" (Lean).
  - Even "while Perceus itself is garbage-free, reuse analysis does not have this property".
- **The fix:** *drop-guided* reuse, performed after drop insertion, is provably frame-limited.
- **Results:**
  - Always as fast as the old algorithm, sometimes up to 1.6x faster.
  - rbtree beats C++ by almost 20%.
- **A warning that applies to nts:** borrowing "can increase the memory usage of a program by an arbitrary amount and it is generally not frame-limited", which is why Koka has no automatic borrow inference.

#### FP², fully in-place functional programming
ICFP'23 ([TR](https://www.microsoft.com/en-us/research/uploads/prod/2023/05/fip-tr-v2.pdf)).
- **Mechanism:** a static check that a `fip` function needs "no (de)allocation and uses constant stack space".
- **Result:** the dynamic uniqueness check is negligible (std-reuse is about 1% slower where no reuse is possible).
- **For nts:** a reporting idea (an "allocation-free" column in the census), not a language feature.

#### Tail recursion modulo context, and destination-passing style
TRMC (POPL'23, [PDF](https://www.microsoft.com/en-us/research/uploads/prod/2023/07/trmc-popl23.pdf)) and DPS (FHPC'17, [PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/dps-fhpc17.pdf)).
- TRMC appends each cell straight into the final result through a hole pointer. It falls back to copying only for non-linear control.
- This is the formal ground for nts's `destinations` and `appended_results`. JavaScript generators and async functions resume each continuation at most once, so the linear form applies; that is the survey's inference.
- DPS needs result sizes up front.

#### Lean 4, Counting Immutable Beans
IFL'19 ([arXiv](https://arxiv.org/pdf/1908.05647)).
- **Mechanism:**
  - Borrowed parameters with an inference heuristic.
  - `reset`/`reuse` on the "resurrection hypothesis".
  - Single-threaded objects use no fences; persistent objects are never counted.
- **Results:**
  - Removing reuse costs 3.23x on rbmap and 1.64x on const_fold.
  - Atomic counts for all values cost 1.13-2.31x.
- **Facts for nts:**
  - Lean's header is "16 bytes long, twice the size of the header used in OCaml".
  - Lean moved to mimalloc in 2025, which improved memory "by up to 60%" ([PR 7710](https://github.com/leanprover/lean4/pull/7710)).
  - The runtime "does not have a technique to detect" cycles ([reference](https://lean-lang.org/doc/reference/4.24.0/Run-Time-Code/Reference-Counting/)).

#### Nim ARC/ORC, nts's closest relative
Sources: [destructors](https://nim-lang.org/docs/destructors.html), [orc.nim](https://raw.githubusercontent.com/nim-lang/Nim/devel/lib/system/orc.nim), [types.nim](https://raw.githubusercontent.com/nim-lang/Nim/devel/compiler/types.nim), [Introducing ORC](https://nim-lang.org/blog/2020/12/08/introducing-orc.html), [PR 26305](https://github.com/nim-lang/Nim/pull/26305).
- **Moves and cursors:**
  - Moves come from a static `lastReadOf` analysis.
  - Cursor inference is "a compile-time copy-on-write analysis".
  - Destruction is at scope exit. nts is more precise here: it releases at last use.
- **ORC's collector:**
  - "Cycle collector based on Bacon01Concurrent.pdf".
  - Root index in the header for O(1) removal, the same thing nts's fix put in the prefix.
  - Adaptive threshold: if at least 50% of touched nodes were collected, the threshold becomes `max(threshold*2/3, 16)`; otherwise it grows 1.5x.
  - Generational pruning merged 2026-10-01: cells that survived 3 trial deletions are skipped within an epoch of 64 collections.
- **Acyclicity:**
  - Nim must assume "inheritance may introduce cycles": every non-final object is cyclic-capable, and every closure too.
  - The `{.acyclic.}` pragma may leak if wrong. nts's decision 12 forbids that, and nts's whole-program graph needs no such pessimism.
- **Threads:** "RC ops do not use atomic instructions… entire subgraphs are *moved* between threads" (`Isolated[T]`).
- **Numbers:** the only published comparison is ORC versus Nim's own mark-and-sweep on an HTTP server: average latency 320 us vs 65 ms with forced collections. Nothing against other systems.

#### Swift
Sources: [Ownership.md](https://github.com/swiftlang/swift/blob/main/docs/SIL/Ownership.md), [ARCOptimization.md](https://github.com/swiftlang/swift/blob/main/docs/SIL/ARCOptimization.md), SE-0366/0377/0390.
- **Mechanism:**
  - OSSA requires exactly one lifetime-ending use on every path.
  - Copy propagation relies on that invariant.
  - Lexical lifetimes with "deinit barriers", such as weak loads.
  - Copy-on-write through `is_unique`.
  - Stack promotion of non-escaping classes, by interprocedural escape analysis ([swift-dev](https://lists.swift.org/pipermail/swift-dev/Week-of-Mon-20171009/005563.html)).
- **Cost of ARC** (BRC paper, [PACT'18](https://iacoma.cs.uiuc.edu/iacoma-papers/pact18.pdf)):
  - RC operations take "42% of the execution time in client programs".
  - An atomic increment is 2.40x a plain one.
  - Swift's compiler already "removes up to 97% of RC operations".
- **Cycles:** not collected.
- **Taken by nts:** the copy/borrow/take load kinds. Stack promotion corresponds to nts's frame placement, and copy-on-write to the string append.

#### Lobster
[Memory management](https://aardappel.github.io/lobster/memory_management.html).
- Picks a single owner at the first store; the rest are borrows.
- "remove around 95% of runtime reference count operations".
- Cycles are reported at exit, not collected.

#### Roc, Morphic, Rust
- Roc mutates in place opportunistically, and "lack of direct mutation primitives lets it rule out reference cycles" ([archived](https://web.archive.org/web/20241129010953/https://www.roc-lang.org/functional)).
- Morphic's borrows-with-lifetimes inference (OOPSLA'26) reports "reducing reference count increments by 75-100%… 1.48x geomean speedup" over Perceus. The survey read the abstract only.
- Rust's `Rc` is non-atomic and its cycles leak ("memory leaks are memory safe").

#### High-performance RC runtimes
- **Down for the Count?** (ISMM'12, [PDF](https://users.cecs.anu.edu.au/~steveb/pubs/papers/rc-ismm-2012.pdf)):
  - 99% of objects have a maximum count of 6 or less.
  - 71% of increments and decrements hit newly allocated objects.
  - 84% of objects are reclaimable without a cycle collector.
  - Lazy mod-buf plus allocate-as-dead reach parity with mark-sweep.
- **RC Immix** (OOPSLA'13): 3% better than GenImmix, and "RC's free-list heap layout has poor cache locality".
- **LXR** (PLDI'22): 7.8x throughput versus Shenandoah on Lucene in a tight heap.
- **Levanoni and Petrank**: coalescing turns 2n updates of a slot into 2.
- **Deutsch and Bobrow**: do not count stack references.
- **What fits nts:** all of these need stack maps and write barriers, so they do not fit. The workload facts do fit: low counts, and most counting on young objects.

#### Bacon and Rajan
ECOOP'01 ([PDF](https://web.archive.org/web/2015/http://researcher.watson.ibm.com/researcher/files/us-bacon/Bacon01Concurrent.pdf)).
- nts's algorithm, including the "buffered" flag and processing the roots' whole transitive closure as one graph.
- "Green" (acyclic) classes are skipped.
- Pauses as low as 6 ms in the concurrent Recycler.

#### Biased RC and CPython free threading
[PEP 703](https://peps.python.org/pep-0703/).
- Biased RC cuts client execution time by 22.5%.
- CPython's free-threaded build pays 5-8% for it, and allocates with mimalloc.
- This is the fallback if managed objects were ever shared between threads; nts does not need it (4.10).

#### Immutable cycles by strongly connected components; Verona; Pony
- **Parkinson et al.** (ISMM'24, [preprint](https://www.microsoft.com/en-us/research/uploads/prodnew/2024/05/preprint.pdf)): one count per strongly connected component of a *deeply frozen* graph; freezing costs about twice a trace. It needs deep immutability, and JavaScript's `Object.freeze` is shallow, so it does not fit.
- **Verona** (OOPSLA'23): a forest of isolated regions, each managed by arena, RC or tracing, chosen at creation, with non-atomic counts. Conceptually this is nts's target, without the type system that proves isolation.
- **Pony ORCA**: counts piggy-backed on messages between actors.

#### Regions and arenas
- **MLKit** retrospective (HOSC'04, [PDF](https://elsman.com/mlkit/pdf/retro.pdf)):
  - 90% or more of allocations went to finite regions, about 3x faster.
  - But: "Unless combined with garbage collection, leaving region inference completely to the compiler is probably not a good idea… vulnerable to program changes".
  - Programs "often contained space leaks that made memory usage linear in the running time"; a region profiler was "a breakthrough".
- **Cyclone** (PLDI'02): programmer annotations, up to 3x slower from checks.
- **Gay and Aiken**: per-region reference counts, "deleteregion is a no-op when this reference count is nonzero"; regions plus RC ran 12% slower to 59% faster than malloc/free or Boehm.
- **Go** ([escape.go](https://github.com/golang/go/blob/master/src/cmd/compile/internal/escape/escape.go)):
  - The invariants "pointers to stack objects cannot be stored in the heap" and pointers to a stack object cannot outlive it ("reused across loop iterations for logically distinct variables").
  - A weighted location graph, flow- and path-insensitive.
  - Explicit arenas are "on hold indefinitely due to serious API concerns" ([#51317](https://github.com/golang/go/issues/51317)), because they "do not compose well".
  - The memory-regions design (no prototype yet) uses a write barrier that "fades" escaping memory back to the GC, at an estimated 1.1-4.5% worst case ([design](https://go.googlesource.com/proposal/+/HEAD/design/70257-memory-regions.md)).
  - Compiler-inserted `freegc` made `strings.Builder` about 2x faster.
- **HotSpot and Graal:**
  - Choi et al. (OOPSLA'99): stack-allocatable objects median 19%, time -2 to -23%.
  - Kotzmann (VEE'05): mtrt 27.4% faster.
  - Graal's partial escape analysis (CGO'14, [PDF](https://oberon.ssw.jku.at/Research/Papers/Stadler14/Stadler2014-CGO-PEA.pdf)) materializes an object only on the branches where it escapes: up to 58.5% less allocated memory and 33% faster.
- **Pointer analysis at scale:** Das's one-level flow (PLDI 2000, [PDF](https://web.eecs.umich.edu/~weimerw/590/reading/das-golf.pdf)) sits between Steensgaard's near-linear unification and Andersen's precision.

#### Allocators and the competitors' heaps
- **mimalloc** (APLAS'19, [TR](https://www.microsoft.com/en-us/research/uploads/prod/2019/06/mimalloc-tr-v1.pdf)):
  - "a free list per mimalloc page (usually 64KiB)".
  - Metadata found by masking the pointer.
  - A `deferred_free` hook that bounds cascading frees under RC.
  - A bump-pointer variant was "consistently about 2% worse".
  - Heaps can be destroyed whole: `mi_heap_destroy` frees "all its still allocated blocks" ([API](https://microsoft.github.io/mimalloc/group__heap.html)).
  - Used by Koka, Lean and CPython free threading.
- **V8 Orinoco** ([trash talk](https://v8.dev/blog/trash-talk)): a bump-pointer nursery whose scavenger pays only for survivors; pointer compression "reduces V8 heap size up to 43%". Whether official Node builds enable it is unverified.
- **JavaScriptCore Riptide** ([WebKit blog](https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/)): non-copying, generational by sticky mark bits, with a "bump'n'pop" allocator.

### 3.3 What nts took, and what it should take

| idea | source | status in nts |
| --- | --- | --- |
| copy / borrow / take loads | Swift OSSA | taken (0024) |
| one owner, everything else borrowed; measured fraction removed | Lobster | taken as the `tooling/memory` metric |
| trial deletion; acyclic classes skipped | Bacon-Rajan | taken |
| stack allocation by escape analysis; scalar replacement | HotSpot, Go, Swift | taken |
| run-time-checked in-place update | Perceus, Lean, Swift copy-on-write | taken for strings only; **extend to arrays and objects** (4.5) |
| drop specialization; dup/drop fusion | Perceus | **take** (4.4) |
| drop-guided, frame-limited reuse; frame-limited as the space criterion | Lorenzen-Leijen | **take** (4.5); it also flags nts's anchors (4.4) |
| one alias substrate (connection graph / location graph) | Choi, Go | **take** (4.3) |
| partial escape analysis | Graal | later, if the census shows sites lost to cold-path escapes |
| O(1) root removal; adaptive threshold; generational pruning | Nim ORC | O(1) removal done; the other two when a row shows trace cost |
| page-sharded free lists; heap destroy | mimalloc | **take** (4.8) |
| regions only over a fallback collector; a region profiler | MLKit | the fallback is RC; the profiler is the census (stage 0) |
| implicit regions, no explicit arena API | Go's arena failure | **take** (decision 5) |
| non-atomic counts; move isolated graphs between threads | Nim, Lean, Koka, Verona | **take** (4.10) |
| an unchecked acyclic pragma | Nim | rejected (decision 12) |

---

## 4. The proposed target design

### 4.1 Principles

1. **One answer per allocation**, as 0024 gave one answer per value. Every allocation site has exactly one home and every value exactly one ownership. Passes read them; none re-derives them.
2. **Proved, never declared** (decision 12). A fact not proved falls back to the counted heap, which is always correct.
3. **Decide statically; check cheaply at run time where aliasing hides the answer.** In-place mutation stays behind a `count == 1` test, as in Koka, Lean and Swift.
4. **Per site, not per type.** One type has young and long-lived instances; the append measurement settled this.
5. **A mechanism no site selects costs nothing.** Use build facts, not run-time switches (the inactive-arena lesson).
6. **The collector is the backstop.** It sees only heap objects that can be cyclic, after a decrement.
7. **Frame-limited.** No transformation may hold memory longer than a constant per frame: reuse tokens, borrows and anchors included.

### 4.2 The ladder of homes

| home | lifetime | cost per object | decided by | status |
| --- | --- | --- | --- | --- |
| registers | never more than its fields | none | `scalarize` | built |
| frame slot | dies before its function returns; fixed size; one live instance per slot | a store or two | home analysis (today `escape.rs`) | built for objects and bounded strings |
| cohort region | survives exactly until a chosen reset in some caller | a bump; nothing at death | home analysis plus reset placement | ambient call regions built; per site is stage 3 |
| counted heap | anything else | a size-class allocation, counts, a free at zero | default | built |
| immortal | the whole run (literals, settled constant data) | nothing | lowering, `settled_globals` | built |

Inside the counted heap, three refinements apply in order:
1. **Elision** (borrow, move, take): built.
2. **Reuse** of a dying unique value: strings built; arrays and objects in stage 5.
3. **Cycle collection**, only for sites and types that can form cycles.

### 4.3 The one memory analysis ("home")

**What it is.** A whole-program alias and lifetime analysis over allocation sites, run on prepared HIR *before counting*: the level `escape.rs` and `regions.rs` already use. It generalizes escape analysis from a boolean to a small lattice of scopes, as Go's location graph and HotSpot's connection graph do.

**What it produces:**

| fact | content | read by |
| --- | --- | --- |
| identity classes | which SSA values denote the same object: block-parameter edges, moves, `Erase`/`Unerase`/`Convert`, helpers that hand back an argument. Union-find in one linear pass; 0024's "identity" relation | own, rc, home |
| site graph | per site and per slot (field by *field name*, the `field_name` rule; array elements; map keys and values; closure captures): which sites, parameters, globals or "outside" the slot may hold | home, cycles, reuse |
| function summaries | per parameter: escapes, stored into which parameter's field, returned, raised, captured, **fields written** (0024's `writes`). Per result: which of the function's own sites it may contain | home, own, borrowed inputs |
| **home per site**, per specialization context | `Scalar` / `Frame(f)` / `Cohort(root call): Survives or Young` / `Heap(reason)` | `place_allocations`, regions, rc, backends |
| static uniqueness | a value nothing has published yet (not stored, captured or passed to an unknown callee) | reuse (skips the slow path) |
| site-level acyclicity (stage 8) | a layout's fields are written only while their container is unpublished | cycles |

**How a home is computed.** A monotone fixpoint like `escape.rs`'s. Every site starts at `Frame` and is raised on evidence:

| flow | raises the home to |
| --- | --- |
| returned | what the *caller* decides for that call's result. So a parser's result is `Cohort` in the caller's loop and `Heap` elsewhere, with clones per context, as `f#region` already does |
| stored into a slot of a site with home H | at least H |
| stored into a global; captured by an escaping closure; crossing a suspension; passed to an unknown callee, an open dispatch, a foreign function or a non-region-safe helper; made a `WeakRef` target or registered with a `FinalizationRegistry` | `Heap` |
| raised | `Heap`: throws are cold, and this removes R3's evacuation problem |
| through `any` / erased | the erased value's own class (a representation, not a new ownership kind, per 0024) |

**Survives versus Young.** A `Cohort` site is **Survives** when its objects flow into the root's graph, and **Young** otherwise. Only Survives sites bump-allocate; Young sites stay on the heap, where LIFO reuse keeps them in L1. That is the append lesson, decided statically.

**Cost.** Unknown until built.
- Unification is near-linear, the lattice has height 4, and per-function budgets fail closed to `Heap` with a named reason, as R4(b)'s do.
- If inclusion-based precision is needed and proves slow, Das's one-level flow is the published middle ground.
- Acceptance includes the compile-time tripwires and the paired `--rc` endpoint from R4(b)'s cost contract.
- It replaces logic in `escape.rs` and `regions.rs`, so the net cost may be small. That is an estimate.

**Landing without a flag day** (0024's recipe):
1. Compute and do not use.
2. Assert that every site `escape.rs` frames, home also frames; report every difference.
3. Switch `place_allocations` to read it.
4. Switch regions.
5. Delete the duplicated logic.

**Later refinement.** Partial escape analysis in the Graal style: keep an object virtual (scalar-replaced, extending `scalarize`) and materialize it only on the branch where it escapes. Build it if the census shows sites lost to cold-path escapes.

### 4.4 Ownership and counting: what is left

| item | what it does | evidence | stage |
| --- | --- | --- | --- |
| **Drop specialization** (Perceus) | where every layout a slot type can hold is acyclic, a release skips the descriptor load and the candidate logic. A leaf of known size frees straight to its class. Per layout, compiler-written death code releases exactly its reference fields, still through the iterative dying list (no recursion) | parse self time: `nts_each_reference` 5.95%, `nts_destroy` 3.87%, foreign-slot cleanup 1.58% (strings design §3) | 1 |
| **Count-free sort** | `sort(compare)` permutes an index array over one counted snapshot | -11.7% alone; about -5% on top of the fast path | 1 |
| **Erased releases** | specialize `nts_value_release` by the representations that reach the site | three out-of-line erased releases per top-k iteration | 1 |
| **Map key counted once** | one count for a key a map entry keeps | memory study | 1 |
| **Anchors stop at the last borrow** | an anchor is held only until the last use of anything borrowed from it, not to every exit (`own.rs:1725-1800`). Today a list built, walked and then idle stays alive to function end. That is neither garbage-free nor frame-limited (Lorenzen-Leijen §4.2); the region "hold" placement already computes the right point | literature; a peak-live fixture must show it | 1 |
| **Per-slot `writes` summary** | a borrow survives calls that cannot write its slot. It also closes the `readonly` trust gap (4.12) | 0024 | 2 / 4 |
| **Borrowed region inputs** | an input that outlives the cohort, and whose anchoring slots nothing writes during the interval, needs no ticket | 2-8% instructions | 4 |
| **Reuse-profitable consumption** | infer a parameter "consumed" where the callee reads its fields and then allocates the same shape, so the caller moves its dying reference in (Perceus's owned parameters, applied where they pay) | needs rows | 5 |
| **Stores that close a cycle** | a move into a slot of an object the moved value can reach must keep a decrement, or the cycle is never offered to the collector (0025) | 0025 | invariant |

### 4.5 In-place reuse: strings, arrays, objects

**What nts has.** Perceus reuse for strings only, built as consuming helpers with non-consuming twins (`nts_str_append*`, `own::consumes`, `own::non_consuming_twin`), chosen by `rc` from "the left side dies here".

**What to add, using the same pattern:** the ES2023 *copying* array methods and spreads. They exist to copy, and they are TypeScript's idiomatic immutable-update style.

| source idiom | in place when the receiver is unique and dies |
| --- | --- |
| `xs = xs.toSorted(c)`, `toReversed()`, `toSpliced(...)`, `with(i, v)` | sort, reverse, splice or set in place |
| `xs = xs.map(f)` (same element width), `xs = xs.filter(p)` | overwrite or compact in place |
| `xs = [...xs, v]`, `xs = xs.concat(ys)` | push in place |
| `state = { ...state, k: v }` (same layout) | write `k` and skip the unchanged fields (reuse specialization) |
| a drop then `new C(...)` of the same size class in one block | a reuse token, drop-guided |

**Rules:**
- The run-time count test is the safety argument; static ownership is not uniqueness (0029).
- Pair drops with allocations *after* releases are placed, and only within one function, never across a call that may allocate without bound. Lorenzen and Leijen prove that version frame-limited.
- Erased values never reuse (0024).

**What the rejected realloc experiments teach.** In-place *growth* failed for two separate reasons, and neither argues against reuse:
1. **The allocator cannot move memory between classes.** A block that grew through `realloc` later died into a larger class's pool, which nothing allocates from directly: 9.7-18.4 KB parked per call, RSS up to 816 MiB. Fix the cause: one class per page, and empty pages returned to a pool any class can use (4.8).
2. **For medium strings, a `realloc` call costs more than doubling and copying.** Append lost 5.6% and join 5-6% while the large-output stringify rows gained 5-9%. So:
   - keep geometric growth for small and medium buffers;
   - use exact capacity where it is known: destination passing, n-ary concatenation, `Array.from` of a sized source;
   - grow large buffers in place only once pages make that exact.

### 4.6 Regions per site

**Placement.** Per site, with clones per context; region clones are approved where a row pays, with a code-size check. In a clone, each site uses the allocator its home chose: arena for Survives, heap for Young. Nothing at run time decides; the ambient path is deleted once every served call has migrated (stage C's mandatory step 3b). This keeps the approved stage C *contract* (ResetCohort / Young / Unknown per site, owner scope, the explicit arena API, reports) and changes only how the fact is computed.

**What the compiler must prove,** for a site in cohort `c` with root `r = f(args)`:
1. **No use after the reset.** Nothing the site makes is reachable from anything that outlives the reset: no global, no heap field, no escaping closure, no raise, no suspension past the reset, no weak target. This is `home <= Cohort(c)`, by construction.
2. **Outgoing edges are paid for.** Every arena-to-heap reference is counted on the owner's ledger (the held API's tickets) or proved to outlive the reset (stage 4). A missing ticket is never read as a borrow.
3. **Construct-once.** Survives objects are stored only by initializing stores, or by appends into cohort arrays. A slot overwritten inside a cohort makes the old target unreclaimable until the reset: MLKit's "memory usage linear in the running time". Such sites are Young or Heap. Old array backing stores waste at most the geometric growth factor.
4. **Worth it.** The cohort's Survives sites allocate repeatedly: R3's cost rule.

**The reset point.** Keep R3's design. A counted handle owns the region; its last use is the last read of anything borrowed from the result; `rc` places its release, and the release is the reset. That puts resets on every path, raise edges included. For json-parse that is the end of each `work()` iteration.

**Exceptions, closures, async.**
- A raised value's site is `Heap`.
- The handle's release on a raise edge resets the region.
- A closure capturing a Survives object is itself in the cohort, or forces the captured site to `Heap`.
- Across an `await` the handle is a counted frame field like any other, so the reset waits for it.

**Is R4(b) the right foundation? No: redirect it.**
- **It analyses already-counted HIR** and reconstructs ownership from retain and release credits. Placement must be decided *before* counting (an arena object is not counted at all), and ownership is already computed once in `own.rs`. Re-deriving it is 0024's four-predicates failure again.
- **It is path- and instance-exact under small budgets** (256 work units per operation, 16 origins per value). Every loop, join, dispatch and reused frame is therefore Unknown, and cohorts are built in loops.
- **The result after the full effort:** 12 functions' normal returns, 37 functions Unknown, 372 sites Unknown, at +0.7-1.0% compile instructions.
- **Keep from it:** the `Placement` types with named Unknown reasons, the `nts regions` report, fail-closed budgets, the Young/Survives split, its fixtures and controls, and the reset audits the arena API owes before its first caller (the live-heap scan for heap-to-arena edges, and the ledger multiset check).

**json-parse needs one source change.** Its parser defeats every flow-insensitive analysis, R4(b) included. `Frame.items` starts as a shared module array (`UNUSED_ITEMS`) that "nothing pushes to, because every push below is guarded by `isArray`" (`runtime/web-platform/src/json/parse.ts:50-57`). An analysis that cannot correlate `isArray` with `items` must assume `frame.items.push(value)` stores parse results into a global.
- **The fix is at the cause, in our own runtime code:** `items: JsonValue[] | null`, and the same for the shared `keys` lists and `JsonValue`'s sentinels. A null sentinel saves exactly the allocation the shared array saved.
- **The prerequisite is now met:** the `T[] | null` choice that once blocked this lowers today (fixture `an-array-allocation-keeps-its-type-past-a-choice`).
- **It conflicts with an earlier choice:** MainClaude's 2026-10-23 choice to send json-parse through the JSON builtin instead. Stage C (2026-10-24) made parse the first target, which needs this change.
- **What users get:** the census names such stores by site and reason, so a user's parser written the same way can be fixed the same way.

**Dynamic fallbacks, not recommended at first.** Gay and Aiken's per-region external counts (a deferred reset), and Go's "fade" barrier, could make ambiguous stores safe at run time. Consider them only if the census shows many cohorts lost to ambiguity.

### 4.7 Cycles

- **Keep synchronous trial deletion.** Nim's ORC uses it as well, and nts's measurements say the trigger, now fixed, was the problem.
- **Shrink what it sees, statically:**
  - drop specialization keeps acyclic slot types away from candidate logic;
  - frame, arena and immortal objects are never candidates (built);
  - acyclicity proved from construction (decision 12's route), in stage 8, only if a row needs it.
  - nts's whole-program graph already avoids Nim's assumption that every non-final object is cyclic-capable.
- **Collector options when a row shows trace cost:** doc kept 34,003 live input roots buffered. Nim's adaptive threshold and generational pruning, and mimalloc-style deferred frees to bound cascading teardown pauses.
- **Strongly-connected-component counting** needs deep immutability. JavaScript's freeze is shallow, and nts's constant data is already immortal, so it is not a fit.
- **Ephemerons** for `WeakMap`/`WeakSet` are the one collector extension JavaScript requires (4.9).
- **The invariant elision must keep:** every unreachable cyclic structure received a non-zero decrement after it became unreachable (0025). The memory suite's leak checks hold this line.

### 4.8 The allocator

**Target: a page-based small-object allocator per environment, of mimalloc's kind.** Evaluate vendored mimalloc first: Koka, Lean and CPython ship it, and its heaps can be destroyed whole.
- **One class per page.** A freed block returns to its page's free list; LIFO, so the L1 behaviour that made freeing beat leaking is kept.
- **Empty pages return to a pool any class can use.** Memory can no longer be stranded in a class: the realloc failure.
- **The page header gives the size, so the 16-byte prefix can go.** The collector's root index moves into a 32-bit half of the count word, as Nim's ORC keeps `rootIdx` in its two-word header. A 32-bit count saturating to immortal is ample; ISMM'12 found 99% of objects never exceed a count of 6.
- **Arenas take whole pages and return them at reset**, under the 8 MiB idle cap per environment that stage C already requires. One mechanism serves heap and arena.
- **Large blocks come straight from the OS**, where in-place growth is exact.
- **A smaller header belongs to the same stage:** 16 bytes (descriptor, count, flags), with `length` only on arrays and strings. Lean's is 16 bytes. It needs its own representation proof; the strings design §3 lists what the prefix carries today.
- **Ordering:** after cohorts, behind rows. Today's free lists are already fast; the gain is footprint, rebalancing and returning memory.

### 4.9 Weak references and finalization

These are to be represented (user decision). Under RC, the natural design:

**`WeakRef`.**
- The first weak reference creates a side cell `{target}` and sets a flag bit on the object.
- Death clears the cell, whether the count reaches zero or the collector frees the object.
- `deref()` adds the target to the current job's kept list, cleared at the checkpoint. This is the specification's `AddToKeptObjects`, which keeps the target "strongly… until ClearKeptObjects is called"; `ClearKeptObjects` runs "when a synchronous sequence of ECMAScript executions completes" ([§9.9-9.11](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html)). RC would otherwise free a target between two `deref`s in one job.

**`FinalizationRegistry`.** A record on the same cell. Death enqueues a cleanup job through the host (`HostEnqueueFinalizationRegistryCleanupJob`); never call back from inside a release or a collection pass.

**`WeakMap` / `WeakSet` (ephemerons).**
- The specification's note points to "an inverted per-object/symbol mapping" and Hayes's ephemerons.
- RC handles the common case: a dying key drops its entries through its cell.
- A value that refers back to its key forms a cycle through the table that RC cannot see. Trial deletion handles it if the table's edge to the value is treated as an edge *from the key*: deleting the key trial-deletes what only it keeps.
- A weak key must be offered to the collector even when its *type* is acyclic, because the cycle runs through the table, not through layouts. The flag bit does this.

**Placement and timing.**
- Weak targets are always `Heap` (never frame, arena or scalar). The specification also forbids optimizations that "observably empty the WeakRef".
- Finalization runs earlier and more deterministically than in node. The specification permits it: "Liveness is the lower bound". Decision 3 accepts the difference.

### 4.10 Threads and workers

- **One heap per environment, and counts non-atomic forever.** JavaScript workers share no objects, only `SharedArrayBuffer` bytes. The evidence for avoiding atomics:
  - Koka: 5-59% slower with atomic counts everywhere.
  - Lean: 1.13-2.31x.
  - Swift: atomic increments 2.4x slower, RC 42% of client time.
- **Messages** are structured clones into the receiver's heap; `ArrayBuffer` transfer detaches.
- **Later: hand over a whole cohort.** A cohort the compiler proves isolated could move to another environment in one step, as Nim moves `Isolated[T]`, Verona moves regions and Pony moves `iso`.
- **Immortal data can be shared read-only,** because nothing writes it; literal hashes are already precomputed for that reason.
- **The fallbacks if sharing ever appears:** a shared tag in the count (Koka, Lean), or biased counting.

### 4.11 The runtime contract

The invariants both sides rely on, to be written down once as a record (stage 0):
1. **Count word.** A heap object's count word is its count; `NTS_IMMORTAL` for literals, frame and arena objects; the dying-list link while `NTS_DYING`.
2. **Frame objects.** Storage ends with the frame. The compiler emits the release of their reference fields. Their header holds what `nts_object_new` writes (0352).
3. **Arena objects.** Never counted and never candidates. Never pointed at by a heap or frame object. Freed only by their owner's reset. Outgoing heap edges are ticketed unless proved borrowed.
4. **The collector** consumes only references the heap owns, and no real release runs while a count is trial-decremented (0024).
5. **Cycles.** Every unreachable cyclic structure received a non-zero decrement after it became unreachable.
6. **In-place mutation** happens only under a run-time count of one or a static unpublished proof. Immortal storage is never written.
7. **No callback, finalizer or foreign code** runs while the candidate buffer or a dying list is walked (`nts_runtime.c:2358`).
8. **One owner thread per environment;** nothing managed crosses environments.
9. **Frame-limited:** no pass holds memory past a constant per frame (anchors included).

### 4.12 Risks for JavaScript semantics, and how each is closed

| risk | why it is risky | closed by |
| --- | --- | --- |
| aliasing of mutable shared objects | ownership is not uniqueness | a run-time count test before every in-place write (0029) |
| `any` / erased values | the referent, its layout and its uniqueness are unknown | erased values never reuse; an erased slot means "anything" in the site graph |
| `readonly` trusted across calls | not enforced at run time; `(o as any).f = x` in a callee writes it (0026 notes the gap) | the per-slot `writes` summary counts erased and computed-key writes as writes of every field of that name; then the readonly shortcut can go |
| anchors held to every exit | a large structure stays alive to function end: not garbage-free, not frame-limited | hold to the last borrow (4.4); a peak-live fixture |
| cycles hidden by elision | a move into a cycle removes the last decrement (0025) | invariant 5; such moves retain; the suite's leak checks |
| exceptions | a raise could skip a release or a reset | explicit raise edges make both ordinary edges; raised values never live in arenas |
| closures | a capture extends a lifetime invisibly | captures are fields in the site graph |
| generators and `async` | suspended frames hold values for unbounded time | values crossing a suspension are counted frame fields with `Heap` sites; borrows end at a suspension (an existing `own` rule) |
| finalization and `WeakRef` timing | they make death observable | callbacks only as jobs; the kept list; weak targets on the heap |
| foreign objects | a platform holds references without counts | the existing rule keeps them to the block's end or every exit (`own.rs:1012`); never arena-placed |
| reset before a last use | a dangling read of reset memory | `home <= cohort` by construction; `NTS_POISON` fills reset chunks; stage C's reset audits |
| region waste | overwritten slots and long intervals hold garbage until the reset | the construct-once rule; arena bytes and waste in the census |
| fragility under program change | MLKit's lesson: placements silently regress | a placement ratchet in the gate for benchmark programs |
| exported boundaries | an outside caller keeps or mutates what it passed | record 0356's crossing rules; exported parameters' sites are `Heap` unless a copy is proved |

---

## 5. Build order

How every stage is measured:
- paired A/B on CPU 4 under `with-lock`, on C and LLVM, across three layouts;
- node and Bun in the same sitting, with the P90 repeat floor;
- "ceiling" means a measured hand-built upper bound.

| stage | what | rows it must move (now -> target) | fixtures and checks | main risk |
| --- | --- | --- | --- | --- |
| **0** | the contract record (4.11). A memory census: sites by home and reason, counted operations by site, candidates by type, arena bytes and waste. A placement ratchet. A peak-live column in `tests/memory`. Land the six AWFY ports on `compiler/awfy-six` (`454b51e7c`: Richards, DeltaBlue, Havlak, CD, Json, Storage) once they agree on every backend; they are the standard macro memory workloads. New rows: `tree-teardown`, `sort-objects`, `release-acyclic`, `immutable-update`, `array-copying-methods`, `cyclic-churn`, `weak-cache` | none: instruments | the rows agree across C, LLVM, JVM, Wasm and node | rows that measure the wrong thing (0142) |
| **1** | release specialized by type; per-layout death code; count-free sort; erased-release specialization; one count per map key; anchors held to the last borrow | `map-entries-top-k` about -5% on top of the fast path; json-parse a measured part of its 11.4% walker, destroy and foreign self share; `awfy-towers` 1.00x Bun -> below 1.0 | a subclass that adds a cyclic field to an acyclic base (control: none); comparators that mutate, throw or are unstable; `toSorted`; each erased representation; a list freed after its walk (peak-live) | the static type is a lower bound on the layout: answer from slot reachability, which `cycles.rs` models |
| **2** | the one memory analysis, facts only; equal to `escape.rs`'s frame answer; then `place_allocations` reads it | none may move; prepared HIR byte-identical on 4 backends and the RC arms (as R4(a) proved) | every escape fixture; a loop allocation stored into a container; a settled-global sentinel stored into a fresh object (control: a mutable global) | compile time: tripwires plus the `--rc` endpoint |
| **3** | per-site cohort regions; the held arena API lands with its first caller; migrate call regions and delete the ambient path (3b); null sentinels in our JSON parser | json-parse 1.56x node / 1.25x Bun -> **below 1.0x node and about 0.75x Bun**, at the approved bar of 80% of the 43% instruction ceiling (the ceiling itself is 0.78x / 0.67x); json-build-join -5% (ceiling -5.7%); AWFY Storage and Havlak measured; **json-build-append must not regress** | stage C's list: an escaping result (refused); throws out of the callee and inside the span; a global write (refused); cached helpers; overwritten slots; duplicate ownership; poison, ASan, reset audits | a missed edge into an arena is a use-after-free |
| **4** | borrowed region inputs via the per-slot `writes` summary | record-word-counts 1.31x Bun -> about 1.24x (pinned -5.4% / -6.5%; the rest is not memory); json-stringify-doc pinned -10% / -12%, needs a quieter sitting (floors were 20-30%); json-parse a further 2-3% | an input mutated during the interval (refused); interior borrowed targets; a missing ticket never read as a borrow | borrowing something the interval frees |
| **5** | drop-guided reuse: copying methods, spreads, filters, reuse tokens, reuse-profitable consumption | `immutable-update` and `array-copying-methods` below 1.0x node and Bun; `pipeline` and `array-methods` hold. **If the new rows do not move, stop** | a second alias (must copy); `xs.concat(xs)`; width changes; reuse across a call that allocates (must not pair) | reuse holding memory (frame-limited rule) |
| **6** | page allocator (vendored mimalloc evaluated first); no prefix; a 16-byte header; in-place growth for large buffers | json-build-append 1.10x Bun -> below 1.0; RSS of every allocating row; stringify rows keep the -5 to -9% in-place growth showed | the realloc alias fixtures (self, slice, quote, raw views, both widths); RSS under large/small alternation | regressing the LIFO fast path |
| **7** | `WeakRef`, `FinalizationRegistry`, `WeakMap`, `WeakSet` with ephemerons and the kept list; a feature, so it may start any time | test262 `built-ins/WeakRef`, `FinalizationRegistry`, `WeakMap`, `WeakSet` on C and LLVM; `weak-cache` row | a value referring to its own key (collected); `deref` twice in one job; no re-entrant cleanup | collector complexity |
| **8** | acyclicity proved from construction, only if a row needs it | candidate traffic on json-stringify-doc, `awfy-list`, `awfy-towers` | a tree type later closed into a cycle through an alias (must stay cyclic) | a wrong proof leaks silently: sabotage control required |
| **9** | workers as isolated environments; later, handing an isolated cohort to another environment | a structured-clone row against node `worker_threads` | owner-thread checks at every boundary (0018) | none until workers exist |

**Dependencies:** stages 1 and 2 run side by side; 3 needs 2; 4 needs 3 and 2's `writes` summary; 5, 6 and 7 are independent and gated on their rows; 8 needs 2's site graph.

---

## 6. Decisions you need to make

Product-level only. Each has a recommendation; if you do not answer, the recommendation stands.

1. **Redirect R4(b).** Freeze the branch as evidence, and build the pre-counting home analysis (4.3) in its place, keeping R4(b)'s types, report, budgets and fixtures. This includes reshaping our own JSON parser's shared sentinels to `null` (4.6), which reverses the 2026-10-23 choice to send json-parse through the JSON builtin.
   - *Recommended: yes.* It shelves reviewed work, which is why it is yours to decide.
2. **Workers are isolated heaps with non-atomic counts, permanently.** Objects never cross threads; messages are cloned or transferred; only `SharedArrayBuffer` is shared.
   - *Recommended: yes.* Node and browsers do the same, so no program can tell.
3. **Weak references follow the specification exactly, with RC's earlier finalization.** This means ephemeron-correct `WeakMap` and `WeakSet` (collector work), and `FinalizationRegistry` callbacks that can run sooner than in node.
   - *Recommended: yes.* The alternative is a `WeakMap` that leaks whenever a value refers to its key.
4. **Vendor mimalloc for the native heap if it wins the rows**, otherwise an in-tree page allocator. mimalloc is MIT-licensed C, and Koka, Lean and CPython ship it.
   - *Recommended: try mimalloc first, in stage 6.*
5. **No memory annotations in the language surface:** no user-visible arena, unique or acyclic markers; everything is proved. This extends decision 12; Go's explicit-arena API stalled because arenas "do not compose well".
   - *Recommended: confirm.*

---

## 7. Sources

**nts evidence:**
- **Decision records:** `docs/records/0006`, `0018`, `0024`, `0025`, `0026`, `0028`, `0029`, `0055`, `0056`, `0070`, `0166`, `0168`, `0176`, `0208`, `0302`, `0352`, `0356`.
- **Code:** `compiler/core/src/hir/{own,rc,escape,cycles,regions,destinations,appended_results,liveness,scalarize,written_roots,written_storage}.rs`, `hir/regions/placement.rs`, `hir/mod.rs`; `runtime/c/nts_runtime.{h,c}`; `runtime/web-platform/src/json/parse.ts`; `tooling/memory/run.sh`; `results/benchmarks/full.md`.
- **Study notes:**
  - `~/.cache/nts-scratch/primitives/memory/report.md` and `runs-all.txt`
  - `~/.cache/nts-scratch/strings-audit/design.md` §3
  - `~/.cache/nts-scratch/compiler/regions-design.md`
  - `~/.cache/nts-scratch/compiler/unlanded-compiler-inventory-v18/inventory.md`
  - `~/.cache/nts-scratch/compiler/region-fresh-graphs/{checkpoint-notes,next-boundary,close-frame-boundary}.md`
- **Runtime agent results**, under `~/.cache/nts-helper/escape/codex-runtime/`:
  - `collector/fixed-regions/table.md`
  - `append-growth/table.md`
  - `append-unpooled/{prepared/table.md,append-unpooled-message.txt}`
  - `append-early-class/`
  - `arena-api/{commit-final.txt,controls-final/table.md}`
- **Decisions and memory notes:** `~/.cache/nts-scratch/primitives/DECISIONS.md`; memory notes `leaking-is-not-a-free-ceiling.md`, `acyclic-types-are-proved-not-declared.md`.
- **Branches:** `7d768f73a` (R4(b)), `252b3ba25` (arena API), `454b51e7c` (AWFY six).

**Literature:**
- **Koka line:**
  - Perceus TR: https://www.microsoft.com/en-us/research/uploads/prod/2020/11/perceus-tr-v4.pdf (PLDI'21, doi 10.1145/3453483.3454032)
  - frame-limited reuse: https://www.microsoft.com/en-us/research/uploads/prod/2023/07/flreuse.pdf
  - FP²: https://www.microsoft.com/en-us/research/uploads/prod/2023/05/fip-tr-v2.pdf
  - TRMC: https://www.microsoft.com/en-us/research/uploads/prod/2023/07/trmc-popl23.pdf
  - DPS: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/dps-fhpc17.pdf
- **Lean:**
  - Counting Immutable Beans: https://arxiv.org/pdf/1908.05647
  - reference manual: https://lean-lang.org/doc/reference/4.24.0/Run-Time-Code/Reference-Counting/
  - `lean.h`: https://raw.githubusercontent.com/leanprover/lean4/master/src/include/lean/lean.h
  - mimalloc by default: https://github.com/leanprover/lean4/pull/7710
- **Nim:**
  - https://nim-lang.org/docs/destructors.html
  - https://nim-lang.org/docs/mm.html
  - https://raw.githubusercontent.com/nim-lang/Nim/devel/lib/system/orc.nim
  - https://raw.githubusercontent.com/nim-lang/Nim/devel/lib/system/arc.nim
  - https://raw.githubusercontent.com/nim-lang/Nim/devel/compiler/types.nim
  - https://nim-lang.org/blog/2020/12/08/introducing-orc.html
  - https://github.com/nim-lang/Nim/pull/26305
  - https://nim-lang.org/blog/2023/08/01/nim-v20-released.html
- **Swift:**
  - https://github.com/swiftlang/swift/blob/main/docs/SIL/Ownership.md
  - https://github.com/swiftlang/swift/blob/main/docs/SIL/ARCOptimization.md
  - https://github.com/swiftlang/swift/blob/main/docs/OwnershipManifesto.md
  - SE-0366, SE-0377, SE-0390: https://github.com/swiftlang/swift-evolution/tree/main/proposals
  - stack promotion: https://lists.swift.org/pipermail/swift-dev/Week-of-Mon-20171009/005563.html and https://forums.swift.org/t/stack-promotion-of-reference-types/55658
- **Lobster:** https://aardappel.github.io/lobster/memory_management.html
- **Roc, Morphic, Rust:**
  - https://web.archive.org/web/20241129010953/https://www.roc-lang.org/functional
  - https://collaborate.princeton.edu/en/publications/fully-automatic-type-inference-for-borrows-with-lifetimes/
  - https://doc.rust-lang.org/std/rc/index.html
  - Reference Counting with Reuse in Roc (Utrecht thesis): https://studenttheses.uu.nl/handle/20.500.12932/44634
- **RC runtimes:**
  - https://users.cecs.anu.edu.au/~steveb/pubs/papers/rc-ismm-2012.pdf
  - https://users.cecs.anu.edu.au/~steveb/pubs/papers/rcix-oopsla-2013.pdf
  - https://users.cecs.anu.edu.au/~steveb/pubs/papers/lxr-pldi-2022.pdf
  - https://csaws.cs.technion.ac.il/~erez/Papers/refcount.pdf
  - https://people.cs.umass.edu/~emery/classes/cmpsci691s-fall2004/papers/p522-deutsch.pdf
  - https://web.archive.org/web/2015/http://researcher.watson.ibm.com/researcher/files/us-bacon/Bacon01Concurrent.pdf
  - https://iacoma.cs.uiuc.edu/iacoma-papers/pact18.pdf
  - https://peps.python.org/pep-0703/
  - https://docs.python.org/3.14/howto/free-threading-python.html
- **Frozen data, Verona, Pony:**
  - https://www.microsoft.com/en-us/research/uploads/prodnew/2024/05/preprint.pdf
  - https://www.microsoft.com/en-us/research/uploads/prod/2023/10/oopslab23main-p377.pdf
  - https://www.doc.ic.ac.uk/~scd/ORCA_17.pdf
- **Regions and escape analysis:**
  - https://elsman.com/mlkit/pdf/retro.pdf
  - https://homes.cs.washington.edu/~djg/papers/cyclone_regions.pdf
  - https://www.cs.cornell.edu/courses/cs612/2000SP/papers/gay-regions.pdf
  - http://www2.eecs.berkeley.edu/Pubs/TechRpts/2000/CSD-00-1115.pdf
  - https://github.com/golang/go/blob/master/src/cmd/compile/internal/escape/escape.go
  - https://github.com/golang/go/issues/51317
  - https://go.googlesource.com/proposal/+/HEAD/design/70257-memory-regions.md
  - https://go.dev/design/74299-runtime-freegc
  - https://faculty.cc.gatech.edu/~harrold/6340/cs6340_fall2009/Readings/choi99escape.pdf
  - https://oberon.ssw.jku.at/Research/Papers/Ko05/Ko05.pdf
  - https://oberon.ssw.jku.at/Research/Papers/Stadler14/Stadler2014-CGO-PEA.pdf
  - Das, PLDI 2000: https://web.eecs.umich.edu/~weimerw/590/reading/das-golf.pdf
- **Allocators:**
  - https://www.microsoft.com/en-us/research/uploads/prod/2019/06/mimalloc-tr-v1.pdf
  - https://microsoft.github.io/mimalloc/group__heap.html
- **Hosts:**
  - https://v8.dev/blog/trash-talk
  - https://v8.dev/blog/orinoco-parallel-scavenger
  - https://v8.dev/blog/pointer-compression
  - https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/
- **ECMAScript:**
  - WeakRef processing, kept objects, cleanup jobs: https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html (§9.9-9.12)
  - WeakMap: https://tc39.es/ecma262/multipage/keyed-collections.html (§24.3)

---

## Summary (15-20 lines)

1. **Recommendation:** keep reference counting as the base, and add one pre-counting "home" analysis. It gives every allocation site one home: registers, frame, a caller's cohort region, or the counted heap. Frame placement, regions, ownership and cycles all read it.
2. **Why:** counting is already at its floor on all 77 memory cases. The remaining native cost is teardown (json-parse about 28%; a region measured -50%, 1.58x -> 0.78x node), count traffic in sorts, and 40-byte object overhead. RC's immediate LIFO reuse beats leaking on every row measured.
3. **Versus others:** nts beats Koka, Lean and Nim at allocation elimination and matches them on elision. It trails Perceus on reuse (strings only), and it must keep a cycle collector, which Koka, Lean, Swift and Lobster lack. Nim ARC/ORC is the closest relative. Perceus and Lean barely influenced the design: the code cites Swift OSSA, Lobster and Bacon-Rajan only.
4. **New mechanisms:**
   - release specialized by type; count-free sort;
   - anchors held only to the last borrow (today to every exit, which is not frame-limited);
   - drop-guided reuse for the ES2023 copying methods and spreads;
   - a mimalloc-style page allocator, which removes the cause of the realloc failures (pools that never rebalance);
   - ephemeron-correct weak collections.
5. **R4(b):** redirect it. It analyses already-counted HIR path-exactly, and leaves 372 of 372 placements Unknown. json-parse also needs its shared mutable sentinels replaced by `null`; no flow-insensitive analysis can see past them.
6. **Top three decisions** (all recommended yes): redirect R4(b), including the parser change; isolated worker heaps with non-atomic counts forever; specification-exact weak references with earlier finalization than node.
7. **Not verified:**
   - the home analysis's compile cost and precision (it is not built);
   - the gains from per-layout death code and drop specialization (estimated from profile shares);
   - node and Bun ratios for map-entries-top-k (not published);
   - whether official Node builds use pointer compression;
   - Ungar et al.'s ARC numbers and Morphic's (abstracts only);
   - MLKit plus GC figures (via the retrospective);
   - whether in-place growth wins under a page allocator.
8. **The report file was not written:** the harness blocked it. This message is the full report; please save it to `~/.cache/nts-scratch/foundations/memory/report.md`.