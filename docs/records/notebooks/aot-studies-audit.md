# Audit of the Bun AOT and ScriptC studies

A merged reading of the two studies ([Bun](bun-aot.md), [ScriptC](scriptc.md)),
checked against nts's docs and history on 2026-10-29. It records no decisions:
where it says "adopt if", that is the result an experiment would need. The
decisions are in [plan.md](../../plan.md#from-the-bun-and-scriptc-studies).

## At a glance

- Both notebooks give the same top idea: only a proof over every value that
  actually arrives, and over every writer of a field or container, may pick a
  narrow storage format. nts has already decided this, and has partly built it.
- They overlap on seven more ideas: typed `JSON.parse`, one-test loop
  versions, builtin and helper effect contracts, cheaper calls and closures,
  startup and reachability, AOT competitor columns, and compile-or-refuse.
- The newest correctness work is missing from the pages both notebooks read.
  Three fixes have landed: the parameter-arrival fix (`c2bd26f8a`), proved
  int32 sums (`f9a0fe4db`) and the 10-27 memory-defect fixes (`d5e29279f`,
  `efdc6314a`). Yet types.md, numbers.md, memory.md and the integral-region
  note still describe them as pending; only plan.md marks the memory fixes
  done (section 4).
- Two cheap experiments aim at rows nts loses today (10-28, beside a gate):
  - a guarded int32 copy for recursion, for `awfy-towers` (1.42x Bun);
  - a borrowing comparator entry, for `sort-objects` (1.98x Bun).
- Three more cheap experiments:
  - collector counters for `cyclic-churn` (9.79x node);
  - a hand-written typed JSON parser compared with native `JSON.parse`;
  - a validation build that re-checks the facts nts uses to remove checks.
- AOT comparisons need newer builds than this machine has (row C-b). The
  user's direction (10-29) is to use the latest ScriptC and the most recent
  Bun AOT, built from source if needed:
  - the installed Bun 1.4.0 has no `--aot`;
  - the published canary has `--aot`, but not the AOT follow-up `3a9ea0043`;
  - the local ScriptC is two months old.

## Sources, revisions and terms

**Inputs.**

- Bun notebook: `origin/pr/121:docs/records/notebooks/bun-aot.md`, 531 lines.
- ScriptC notebook: `origin/pr/122:docs/records/notebooks/scriptc.md`, 527
  lines.
- Both read nts at `01b93bdcc`. Nothing under `docs/` changed between that
  commit and today's main (`7fb7cc60b`), so their line citations still apply.
- Bun revisions read: frontend `8d5672c55` (the merge of PR #45631, 10-27),
  WebKit branch `c3131ea84`, and WebKit build `286c20834`.
- ScriptC revision read: `b260a13dd` (10-29).
- Upstream heads checked on 2026-10-29 through the GitHub API (read-only):
  - **Bun:** main is `081ace731` (05:45 UTC). It includes PR #47129
    (`3a9ea0043`, merged 02:41 UTC): "AOT: fixes for modules, classes and
    Workers, WebKit upgrade", moving the engine to oven-sh/WebKit `main` at
    `f495db1d2488`. That supersedes the notebook's engine pins.
  - **Bun canary:** the published canary is `73b53109f` (2026-10-28 21:44
    UTC). It contains the original AOT merge but is 7 commits behind
    `3a9ea0043`.
  - **ScriptC:** main is `8971d694b` (05:26 UTC), one commit after the
    studied `b260a13dd`.

**Benchmark rows cited** (status in one sitting, not a change; no regression or
improvement verdict is drawn here):

| tag | run | conditions |
|---|---|---|
| [R] | `nts-bench` of main `6bb2c6217`, LLVM column, every row measured 2026-10-28 22:35 UTC | CPU 4 under `with-lock`, **beside running gates**. One sitting: compare ratios within it only. Its four flagged "regressions" against 10-23 were refuted as cross-day noise (coordinator). Its CLBG rows failed (checksum or abort), and `json-stringify-builtin` and `str-append-loop` failed its JVM size check |
| [C] | CLBG sitting 2026-10-29 00:50–01:07 UTC, source `cf162669e`, LLVM column | CPU 4, **beside a gate** (landing lock held, load average 35–57) |
| [J] | official JVM string rows on landed `4ed6bcdc6` (2026-10-29); values from the coordinator, with ratios worked out here | official run; its machine conditions are not restated here |

A ratio is nts divided by the other column: below 1.00 means nts is faster.
`results/benchmarks/full.md` (2026-10-15, `833fa3016`) is not used.

**Evidence labels**, as both notebooks define them: **code** means the
implementation or a test was read; **docs** means a documented contract;
**author report** means a result the upstream author published and nobody
here reproduced; **inference** means the notebook's own reasoning.

**Terms.**

| term | meaning |
|---|---|
| representation | how a value is stored: a double, an int32, a pointer, a tagged value |
| layout | an object's fixed fields and their byte positions |
| guard, check | a run-time test |
| alias | a second reference to the same object |
| writer | any store into a field, array slot or map entry, including one through an alias |
| arrival | a value that actually reaches a parameter or slot, as opposed to what its declared type says |
| effect | what a call can read, change, keep alive or call back |
| clone, version | an extra compiled copy of a function or loop, specialized under a test |
| certificate | a recorded proof that licenses one rewrite (nts's integral-region note) |
| residual size | the code left after specialization removes tests and calls; Bun's inliner scores it |
| borrowed entry | a function entry that uses its arguments without touching their reference counts |
| region, arena | memory that many objects share and that is freed all at once |
| trial deletion | the cycle-collection algorithm nts uses |
| raising copy | nts's second compiled copy of a function, which returns a flag when it throws |
| unwinding | finding an exception handler by walking the stack with tables |
| Node island | a package ScriptC runs inside an embedded Node instead of compiling it |
| PGO | profile-guided optimization: build, run on sample input, rebuild using the counts |
| AOT, JIT | compiling before the program runs, or while it runs |
| RSS | the memory pages resident for a process |
| artifact-only experiment | hand-edit nts's emitted C or JVM output and time it, with no compiler change |
| noise floor, layout range | how much a row moves with no change, or with only the code placement changed (`docs/contributing/lessons/measurement.md`) |

## 1. Every recommendation, merged

An id such as `B3` is the Bun notebook's rank and `S3` the ScriptC
notebook's. `§n` is a notebook section. `B+S` rows merge the same idea from
both notebooks.

### 1a. Correctness foundations

| id | idea | Bun does | ScriptC does | nts today | plan.md overlap | notebooks recommend |
|---|---|---|---|---|---|---|
| A1 · B1 + S1 | One whole-program account of what each value can be, who writes each field, slot and map entry, and what each call may change. Only that account, never a declared type, picks a narrow storage format. Its facts are dropped when the code or memory under them changes | Value flow over creation sites, solved to a fixed point under budgets. A candidate needs every caller and writer known. Facts about memory end at a possible write or suspension [code] | Whole-program int32-slot analysis drops a candidate on any unproved writer, argument or return, then re-checks its readers. Checks that rewritten functions did not change under it [code] | Facts are joined over every call site and store, but stores through wider aliases are not yet seen (numbers.md "Integers proved from doubles"). The one memory analysis is decided, not built (memory.md "The one memory analysis"). The container rule is "Not built" (types.md Decisions). In code since then: arrivals from proved callers (`c2bd26f8a`) and content facts for int32 sums (`f9a0fe4db`) | "Memory stages 1 and 2 (cheap counting wins; the one placement analysis, facts only)"; "Content facts and proved-int32 arithmetic are on `main`; the design is approved, and the shared representation is being built first." | B1: yes. S1: yes |
| A2 · S1 + B§1 | Check values wherever TypeScript's checker is loose (casts, `any`, JavaScript callers, bivariant method parameters, covariant arrays), with an adversarial test for each route | Marks casts, loose types, container reads and bodiless declarations as missing-proof sources. Tests parameters at the callee's entry. Has tests for bivariance (`undefined` into `number[]`) and for a string written through a widened array [code + test source] | A dynamic-to-native boundary inserts a check that throws a catchable `TypeError` naming the failing path. Wrappers check JavaScript callers. A bivariant override gets a checked conversion or error SC1090 [code] | An erased value cast to a primitive or class is tested; cast to an interface it is untested, and its field accesses are proved or refused. An erased value cast to a literal or enum: the value test is "Not built" (types.md "Casts", Decisions). C and LLVM dispatch a covariant-array store wrongly (types.md "When a type's claim is false"). A bivariant erased argument fails to compile, as invalid HIR (section 3) | "the covariant-array dispatch remains."; "a throw through any indirect call is catchable (L15), so a failed check of an erased value is always a catchable `TypeError` (L6);" | S§1: yes (checked boundaries, adversarial variance cases). B§1: yes, keeping nts's cast rules |
| A3 · B2 + S§1 | A diagnostic build that re-checks at run time each fact the compiler used to delete a check, and crashes by name when the fact is false. Deliberate-sabotage tests show the checker fires | The IR verifier rejects an assumption that has no protecting check. `--aot-validate` tests optimized types and shapes. A pass after machine-level optimization re-checks ranges and "unchanging" words. Has sabotage tests [code + docs] | Checks that come from compiler-inferred annotations carry their source. A contradiction throws an `Error` naming a compiler-analysis bug, distinct from a user's `TypeError` [code] | No such build in the docs. What exists: the HIR verifier, `expect-ir`, the `nts f64` column, and the differential run against node. In code: compiler-claimed dead ends become `__builtin_unreachable()` (`compiler/codegen/c/src/emit.rs:6256`); a wrong field-family set aborts by name (`nts_no_arm`, `nts_runtime.h:3380`); `NTS_POISON` checks region claims | "a sanitized, reference-counted differential run over the whole corpus in every full run (Q-7);"; "a differential program fuzzer (Q-6)."; "Representation is checked, not assumed: `expect-ir` facts on cases; `nts stats` counters per program; … an A/B switch for each representation decision." | B2: yes. S§1: yes (provenance for failed inferred facts) |
| A4 · S5 + B§10 | The full generator protocol: `return()`, `throw()`, `finally` across `yield`, closing an iterator when a loop exits early, async-generator request queues | Generator-loop fusion keeps exception routing and iterator closing, and declines when an instance may escape [code] | Keeps outgoing yields, incoming `next(v)` and a pending `return(v)` apart. A `finally` may yield during a return. Loops close unfinished iterators, and the body's error beats a closing error. A dropped suspended generator does not run `finally` [code] | An early loop exit does not call `return()`. Refused: two-way yields, calling `return()` or `throw()` by hand, and a `finally` across a `yield`. An async early exit leaves the frame open (async.md "Generators", "Async generators"). The full protocol is decided for phase 3 (async.md Decisions, L16) | "generators, the iteration protocol and `using`, in full (L16);" | S5: yes, a correctness obligation before generator speedups count. B§10: closing is a condition of fusion |
| A5 · S4 | Arrays record which slots are really filled (a "filled prefix" count, plus hole, present-`undefined` and foreign-value states), so reads are cheap and never wrong | Direct element reads only for proven ordinary fixed-length storage and an in-bounds index; other reads go through helpers [code] | Four slot states. A `filled` count covers a prefix of ordinary elements, which are read with no state check. An int32 array widens before a foreign store [code] | A hole in `number[]` or `boolean[]` reads as 0 or `false` on C and LLVM, and a read past the end stops by name (objects.md "Arrays"). `undefined` for both is decided (objects.md Decisions, the bounds rule). The mechanism X1, a reserved NaN, is only proposed (open-questions X1) | "reads that JavaScript answers with `undefined` give `undefined`: holes, … reads past the end (L4, X1). They are built on one shared representation of a possibly-undefined value … (in progress: the shared representation first);" | S4: yes |
| A6 · S7 | Make region (arena) safety checkable: release outside references at reset, prove no collector pointer survives into recycled memory, and keep use-after-reset visible to sanitizers | — (Bun keeps JavaScriptCore's tracing collector and has no arenas) | Arenas per allocation site. A reset releases outside references. Rejects groups that a separately collected cyclic object could outlive. Off when weak collections are used. Sanitized builds allocate arena objects separately [code] | The design covers it: "Resetting a region is safe only if nothing can still walk into it", "A region needs two proofs", and weakly observable objects never go in regions (memory.md). Call regions are built; per-site regions are stage 3. In code: under ASan regions keep no blocks, and `NTS_POISON` pattern-fills reset blocks and checks membership (`runtime/c/nts_runtime.c:155-175, 660-685`) | "The memory defects the outside review found. *Fixed*, with region and frame allocations kept within their proved lifetimes…"; "memory stage 3 (per-site regions, json-parse first)" | S7: yes |
| A7 · B3 + S§11 | One machine-readable contract per builtin and runtime helper: what it reads, writes, keeps alive, may throw and calls back, so a call does not erase proofs it cannot touch | One table of builtin types, effects, callbacks and retention. "Pristine" identity checks before substituting a builtin. The same contracts allow borrowed spans [code + docs] | Signatures, a may-throw set and reference-effect classes, spread over several files; the notebook warns it is not one table [code] | Per-helper tables: LLVM signatures, `ERASES_CLASS`, `READS_ONLY` purity and the JVM mapping (`runtime/c/nts_runtime.h:78-118`). A raising contract (`NoRaise`, `MayRaise` or `Diverges`) for all 578 helpers, checked against the call graph (`2fc8fbd11`, in code). Writes, retains and callbacks are not documented. A record of the runtime's ownership contracts is memory stage 0 (memory.md "Build order") | none | B3: yes. S§11: yes ("adapt helper contracts to its existing analyses") |

### 1b. Speed

| id | idea | Bun does | ScriptC does | nts today | plan.md overlap | notebooks recommend |
|---|---|---|---|---|---|---|
| B-a · B6 + S2 | One test before a loop or function picks a fast copy proved under that test; on failure the original runs unchanged. No per-iteration speculation | EntryChecks: a typed body behind parameter tests, with a generic copy on failure, skipped for cold functions [code + docs] | Loop-entry versions for innermost loops. The predicate checks the range and an exact integer conversion, rejecting NaN and −0. The assumptions do not leave the loop [code] | Exported roots get an integer clone behind one entry test (numbers.md "Across calls"). Loop versioning and exact regions exist as a design note with artifact evidence (integral-arithmetic-regions.md "Loop versioning"; `results/integral-arithmetic-attribution.json`). Not built | none by name | B6: yes, selectively. S2: yes. Both say to keep nts's own rounding and width certificates |
| B-b · B§2/§3 + S§2 | Speculate inside the loop body (an int32 test per operation) and resume in a slower compiled copy on failure | A failure inside a function moves its live values to a compiled continuation that may rejoin the fast code. Guarded int32 arms [code] | Integer shadow copies of locals. A failure resumes the statement in floating point, and a tail copy finishes the iteration. After 8 bailouts in a row, a loop stops trying [code] | The per-addend guard "was measured and is not used" (numbers.md "Truncated sums"). The proved form is built (`f9a0fe4db`) | "integer accumulators, so that `(a + b) \| 0` stays in int32: needs container content facts to prove the addend (the guarded form was measured and parked on its compile cost; the row it seemed to lose lies inside that row's layout range);" | B§3: no, not as the default. B§2: later, for large continuations. S§2: later, as a measured experiment |
| B-c · S§3 | A guarded int32 copy of a pure recursive function. On overflow, rerun the ordinary body from the start | — | An entry test on the numeric arguments. Overflow sets a flag and reruns the ordinary body, which is allowed because the copy has no side effects [code] | Not built. Integer clones exist only for exported roots (numbers.md "Across calls") | "argument ranges through recursion: an index computed as `(3 - from) - to` across recursive calls widens to an unbounded range with `NaN`, so the recursive methods of `awfy-towers` keep double indices and check them twice;" | S§3: later |
| B-d · B5 + S3 | `JSON.parse(text) as T` parses straight into `T`'s layout, with one defined behaviour on a mismatch | A global `JSON.parse` without a reviver (the optional callback that rewrites parsed values) gets a parse plan from annotations and builds compiled layouts. A mismatch silently reparses the ordinary way, with no `TypeError` [code] | A descriptor-driven parse into native records and arrays. It declines to the generic parse plus a generated check, which throws a `TypeError` naming the JSON path. Syntax errors come first [code] | Designed, not built: a per-type parser, a `TypeError` naming the JSON path, `SyntaxError` first, and simdjson's scanner (json.md "Reading"; types.md Decisions). `JSON.parse` is refused as NTS1100 today | Only "an untyped `JSON.parse` served by the TypeScript parser until the compiler has its own (G9)." and "memory stage 3 (per-site regions, json-parse first)". No line schedules the typed parser | B5: yes (keep nts's errors; no validator code generated at run time). S3: yes |
| B-e · S8 + B3 | Don't build a temporary substring or view when its user needs only the length, characters or bytes; keep the source alive and the bounds checked | Borrowed spans (a pointer and a length) for helpers that need only bytes. A temporary `subarray` disappears. Bounds are rechecked for buffers that can detach [code + docs] | Removes a local substring when only its length or character codes are read, snapshotting the source and bounds. Escapes, captures and `await` exclude it [code] | Partly built: bounded strings that do not escape live in the stack frame (memory.md "The ladder of homes"), and `substrings` never builds its slice (comment in `benchmarks/cases/str-slice-keep/case.ts`). Designed: slices that point into their owner (strings.md "Stage D"), and `out += s.slice(a, b)` onto `nts_str_append_slice` (strings.md "Stage E") | "the strings stages D and E (E's SIMD conversions also serve `TextEncoder`, `TextDecoder`, `atob` and `btoa`)" | S8: yes. B§11: yes (borrowed spans) |
| B-f · B4 + S6 | Cheaper calls and closures: <br>- inline by the code left after specializing; <br>- carry known targets through fields and returns; <br>- create closure objects only when needed; <br>- a program-wide code-growth budget; <br>- test the real target before a direct call; <br>- delay capture boxes; <br>- let indirect calls borrow their arguments | The inliner scores residual code and the tests and allocations it removes, with budgets by estimated heat. Closure objects can be deferred, slim or full [code + docs] | Callback-specialized copies, capped at a 300-node body, 4 copies and a module-wide budget. A code-pointer test before a direct call. Delayed or frame-placed capture boxes. A second "borrowing" closure entry for indirect callers [code] | Direct calls, tests for up to two classes, method tables, up to ten closure clones, two closure entries, cells for written captures, and frame-placed closures (objects.md "Calls", "Functions as values"). Not built: class sets through fields and returns, splitting call sites, typed adapters | none | B4: yes. S6: yes |
| B-g · B4 (async) | Drop the intermediate promise when an async call is awaited at once and cannot suspend; fuse a known generator with the loop that consumes it | A known async call awaited at once enters its body with no promise. An async function that never suspends becomes an ordinary call. Generator-loop fusion under budgets [code] | Functions that never suspend stay "fiberless", with no separate stack; heap-frame coroutines where eligible [code] | Async functions are heap-frame state machines (async.md "Async functions"). A `for...of` over a generator allocates nothing per element (async.md "Generators"). No benchmark row measures async | "one async ordering contract, held by shared fixtures on every backend (C-4)." | B§10: yes, keeping microtask order, cleanup and closing |
| B-h · B9 + S9 | Start fast and small: <br>- prebuilt read-only metadata, made into objects on first use; <br>- link and initialize only the runtime parts reached; <br>- a populated but unread registry must not pull in everything it names | An image of code plus 27 read-only sections. Strings, classes and layouts are made on first use. A precomputed module graph. Startup tests that add unused code and bound instructions and RSS, with TODO exceptions [code + docs] | Runtime units are selected by the program's features, and `main` installs only the facilities used. Lowering of an unread registry's initializer is deferred [code] | Runtimes are linked only where used (architecture.md "The runtimes"), with dead-section removal and ThinLTO (numbers.md "How native code is built"). Descriptors are compiler-emitted read-only data (objects.md). Builtins are resolved per target at build time (foundations/README.md, "Builtins"). No lazy-startup rule is documented; rows are planned (memory.md stage 0) | "startup time, executable size and peak RSS rows, against node and Bun (P-2);"; "Stages 1 and 2 are on `main`, and stage 3's resolver is being built." | B9: yes. S9: yes |
| B-i · B§9 + S§9 | Explain every byte of an executable; budget code growth later; test link order | Size reports separate real savings from bytes merely overwritten. Removable features and `--trim` [code + docs] | Speed and size variants of the runtime. Runtime objects are linked before program objects to steady code placement, an explanation in an author's comment [code] | Per-function sections, dead stripping and ThinLTO (numbers.md). "Region clones are fine where a benchmark row pays for them, with a code-size check" (memory.md Decisions). A layout-interval instrument (`results/layout-intervals`) | "startup time, executable size and peak RSS rows …(P-2);"; "the compile-time guard adds backend code generation and link time (P-6);" | B§9: yes (size reports), later (budgets), no (executable surgery). S§9: later (link order) |
| B-j · B§7 | Measure object density and metadata; later, 4-byte object references | Many fields hold 4-byte references into a reserved 32 GB heap; registers and stack keep full pointers [code + docs] | The count and layout share an object's first word. Only objects that may be part of a cycle get a collector header [code] | A 24-byte header, and 40 bytes before an object's first field. A 16-byte header is planned (objects.md "The header and the descriptor"; memory.md stage 6). The docs do not consider compressed references | "the memory census, whose numbers set the retention bound (M-1);" | B§7: yes (measure), later (compressed references, after the census), no (a collector change on the 48% claim) |
| B-k · S§7 | Schedule cycle collection by candidate age and by how much a pass actually frees | (JavaScriptCore's own generational collector) | Nursery, mature and old candidates. Restricted passes skip the old ones. The schedule follows heap growth, backlog and garbage recovered [code] | Trial deletion stays, and is measured first (memory.md M6). The trigger is a fixed 10,000 candidates (`nts_runtime.c:2070`), and its comment says measurement did not support generations. Open question M-3: `cyclic-churn` spends two thirds of its cycles in the collector; it recommends an adaptive trigger | "the memory rows: `tree-teardown`, `sort-objects`, `release-acyclic`, `immutable-update`, `array-copying-methods`, `cyclic-churn`;" | S§7: later, only if profiling finds repeated unproductive walks |
| B-l · B10 + S§4 | For genuinely dynamic objects: remember a lookup's answer in a small data cache, and move a field that got an incompatible value to side storage | 16-byte caches per call site, keyed by layout id. Prebuilt name tables. A field moves to a side object on an incompatible store [code + docs] | Shared run-time layouts, and 4-entry caches read by fixed code with no code patching. A dictionary fallback [code] | A member read by a key known only at run time is refused. Decided: a per-type table of member names (types.md Decisions; objects.md "Dynamic values"). Not built | "member reads on `any` and `unknown` by a run-time key (L7);" | B10: later (static objects must pay nothing). S§4: later |
| B-m · S§4 | When a value crosses between two native layouts, hand out a view onto the original's fields (keeping its identity) instead of a copy | — | Cached record views redirect field access to the source record, for eligible checked crossings [code] | Record 0356 says objects at an exported boundary are "copied in where the copy cannot be noticed, a live reference to the caller's object otherwise", and "never a silent copy". Mostly not built (objects.md "Objects at an exported boundary") | none | S§4: later |
| B-n · S10 | Optional profile-guided builds: train on sample input, then rebuild with the counts guiding layout and inlining | Static heat estimates only, no profiles [code] | `--profile-generate` and `--profile-use` through LLVM; Linux executables only, optimized and unsanitized [code] | Not in the docs. "Benchmarks build exactly as `nts build` does" (numbers.md Decisions) | none | S10: later |
| B-o · B§10 + S§10 | Native stack unwinding (tables) instead of a test after each call that may throw; or copying native frames at suspension | Handler tables and a custom unwinder, with no exception test on normal compiled calls. Frames are copied into a collected `SavedFrame` at suspension [code + docs] | A pending-exception cell, plus LLVM unwinding for selected Linux direct calls. `--exceptions=rare` widens it, and the docs warn that throw-heavy code can get several times slower [code + docs] | Raising copies, with a test after each call that can raise, and no unwinder (errors.md "How a throw travels"). Heap-frame state machines (async.md) | "host errors as catchable `Error`s carrying the host value, after research on unwinding through C frames (I-2);" | B§10: later. S§10: later, after throws through indirect calls work |
| B-p · S§8 + B§8 | Compute chosen data at compile time and embed it as constants | Rejects heap snapshots: the build runs no application code except explicit macros [docs] | `comptime` results are embedded as constants [docs] | Not in the docs. Source proved constant may be compiled later (boundaries.md "Dynamic code") | none | S§8: later |

### 1c. Measurement, diagnostics and the execution boundary

| id | idea | Bun does | ScriptC does | nts today | plan.md overlap | notebooks recommend |
|---|---|---|---|---|---|---|
| C-a · B7 | Report why a proof failed (the unknown writer, escaping object, dynamic callee or kept feature) and tie it to the hot paths that pay for it | Keeps a list of acknowledged losses (`behind-the-jit.linux-x64.json`) [code] | Rejections propagate to readers; each Node island gets an SC8001 note [code] | `nts facts`, `stats` (including failed int32-sum proofs, `f9a0fe4db`), `regions` (the first reason for each candidate), `erasure` and `receivers` (cli.md "Inspecting"). The memory analysis reports stores by site and budgets by reason (memory.md) | "analysis budgets scaled by program size, each exhaustion reported by name (P-7);"; "A diagnostic registry (L21)" | B7: yes |
| C-b · B8 + S§12 | Benchmark AOT competitors as separate columns, in realistic calling contexts: Bun AOT beside the same Bun's JIT, and ScriptC in native-only, profiled and Node-island modes | Harness modes for small, called and large programs. Compares the worse of the typed and type-erased AOT forms with the same build's JIT [code] | Its runner checks stdout, stderr and exit status against Node; a mismatch is named, not timed. Interleaved launches and bootstrap intervals [code] | Comparators are node and Bun's JIT, at pinned versions (plan.md "Benchmarks"). The installed Bun 1.4.0 (`34cbb9a40`) has no `--aot` flag. The published canary (`73b53109f`) has it, but lacks the AOT follow-up `3a9ea0043` (checked 10-29) | "every backend: node and Bun; each at a pinned version, node, Bun, the JDK and clang included (P-4)." | B8: yes. S§12: yes |
| C-c · B§6 + S§6 | Compile or refuse; never fall back silently to an interpreter or an embedded engine | Unsupported reachable code is a build error. Source generated at run time runs in an interpreter, LLInt [code + docs] | The default `--node-islands=auto` runs refused npm packages in embedded Node. Compiled `eval` and `Function` throw a catchable `EvalError` [code] | No parser, interpreter or JIT, permanently: `eval` is NTS1101 and `Function` NTS1100 (boundaries.md "Dynamic code"). Any refusal fails `nts build` | "any refusal fails `nts build`, with `--partial` for experiments (L20), so a refused program never runs with parts cut (*done*);" | B§6: yes (checked compile-or-refuse), no (interpreter). S§6: no (automatic engine fallback), later (a catchable `EvalError`, which changes the boundary) |

### 1d. Do not adopt (both notebooks' "no" items)

| id | idea | notebook | nts already |
|---|---|---|---|
| D-a | Treat TypeScript declarations as proofs | B§1: no. ScriptC: "do not adopt … unchecked assumptions from TypeScript declarations" | Decided against: types.md Decisions (10-29); foundations/README.md "The bar" |
| D-b | Copy records at crossings in ways a program can see | ScriptC: "do not adopt … observable record copying" | Decided: record 0356, "never a silent copy" (objects.md) |
| D-c | UTF-8 string storage | S§11: "keep nts's Latin-1/UTF-16 representation"; comparison table: "**no** to copying UTF-8 storage merely for parity" | Decided: "No UTF-8 storage." (strings.md "What not to do") |
| D-d | Ropes, or builtins locked against replacement, without evidence from a row | B§11: "require separate evidence before adopting locks or rope storage" | "No ropes at run time unless a row proves them" (strings.md). Builtins cannot be replaced anyway, since prototypes are fixed (boundaries.md "The prototype chain") |
| D-e | Bun's surgery that removes bytes from the finished executable | B§9: no | Only what is reached is linked (numbers.md "How native code is built") |
| D-f | A collector change on Bun's unattributed 48% memory claim | B§7: no | M6: trial deletion stays, measured first (memory.md) |
| D-g | An interpreter, or an automatic engine fallback | B§6: no; S§6: no | A permanent boundary (boundaries.md "Dynamic code"); see C-c |
| D-h | Per-operation int32 speculation as the default | B§3: no | numbers.md "Truncated sums"; see B-b |

## 2. Experiments before building

Rows are from `benchmarks/cases/`. Numbers carry the tags [R], [C] and [J]
from the conditions table above. The effort is the experiment's own, not the
build's.

| id | what to change | rows and fixtures that measure it | adopt if | effort |
|---|---|---|---|---|
| A1 | **No experiment needed to decide**: decided (types.md Decisions; memory.md M1). To order the work, the `nts f64` column (number specialization off) bounds what each proof is worth. For example [R]: `checksum` 5.58 µs against 102.23 µs in f64; `accumulate` 1.10 against 37.96; `awfy-sieve` 5.20 against 15.79; `arrays` 1.50 against 5.46. Land it as memory.md says: computed but unused first, then compared with today's answer on every program | `checksum`, `accumulate`, `arrays`, `awfy-sieve`, `awfy-queens`, `elementwise`, `map-literal-keys`, `symbol-keyed-map`; fixtures `a-string-stored-through-a-widened-number-map-reads-as-a-number` (also `-llvm`, `-jvm`), `a-typed-table-seen-with-wider-keys`, `a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass` | The fixtures agree with node, and no narrowed row loses more than its noise floor | n/a (the build is large) |
| A2 | Port the notebooks' adversarial cases as fixtures, each with a control that differs in one thing: <br>- Bun's `method-bivariance.ts`: `undefined` through an interface into a `number[]` parameter; <br>- Bun's `covariant-array.ts`: a string through a widened array alias; <br>- ScriptC's variance test: an `any` base method calling a string override with 42. <br>Run `agree` on C, LLVM and JVM | The existing `a-bivariant-method-receiving-an-erased-argument` (invalid HIR today) and its control `tests/programs/a-method-accepting-the-erased-argument`; the covariant-array outcomes | No timing. Any wrong answer becomes a `tests/outcomes/` fixture and a fix | small |
| A3 | Prototype a validation mode, first by hand on the emitted C of three or four programs: <br>- put back, as a named trap, every bounds check that `hir::bounds` removed; <br>- check each value narrowed to int32 or int64 against a double recomputation where it is defined; <br>- turn `__builtin_unreachable()` into a named trap. <br>Run the differential corpus and the five test262 records under it. Add sabotage controls: a scratch tree that drops one guard must fail by name | Overhead only: `arrays`, `awfy-sieve`, `elementwise`, `json-parse`. Fixture `a-bounds-check-removed-past-a-closures-shrink` (a stale length fact once read past the end) | It finds a broken claim; or it runs clean with every sabotage control firing, at an overhead the nightly full run can carry | medium |
| A4 | **No experiment needed**: decided (L16); a correctness obligation | Guard rows [R]: `generator` 0.05x node, 0.27x Bun, 0.98x C++; `generator-dispatched` 0.05x node, 0.19x Bun; `user-iterable` 0.07x node, 0.06x Bun. Fixtures `a-generator-close-skips-its-suspended-inner-iterator`, `an-early-async-generator-exit-leaves-the-frame-open`, `a-generator-passed-in-and-stepped-inside-a-try-ends-the-program` | The fixtures agree with node and the guard rows stay within noise | n/a (the build is large) |
| A5 | The behaviour is decided (L4, X1); the experiment only picks the mechanism. In the emitted C of rows that read `number[]` slots the compiler cannot prove written, add on each such read either: <br>- X1's reserved-NaN test; or <br>- ScriptC's `index < filled` test, with a count kept by writes. <br>Time both against today | `arrays`, `array-methods`, `array-mutations`, `elementwise`, `awfy-sieve`, `awfy-permute`, `growth-grown`; fixture `a-hole-in-an-array-of-numbers-reads-as-zero` | The chosen form costs within each row's noise floor where slots are proved written, and least where they are not | medium |
| A6 | Mostly built already. A small runtime-only check: under `NTS_POISON`, at `nts_region_reset`, scan the cycle-candidate buffer (and any collector work list) for pointers into the region's blocks, and abort by name. Run it with one sabotage case | `tests/memory`, the RC corpus; fixture `a-direct-object-return-outlives-its-local-holder-under-asan` | Zero hits on the corpus, and the sabotage case fires | small |
| A7 | Take a flat profile (`cpu_core/cycles/u` on CPU 4) of the losing rows and find the helper calls in hot loops. Hand-edit the emitted C to keep a fact that a fuller contract would preserve, such as a borrow, a hoisted length or a skipped retain (a contract saying "does not write", "does not retain" or "no callback"), and time it | [R]: `sort-objects` 1.15x node, 1.98x Bun, 2.00x C++; `release-acyclic` 1.30x node, 2.30x Bun; `immutable-update` 0.63x node, 3.12x C++; `str-split` 1.02x node, 4.17x C++ | A win beyond the noise floor on a losing row, from a fact only a fuller contract can supply | medium |
| B-a | **No new experiment needed**. Artifact-only evidence exists in `results/integral-arithmetic-attribution.json`, recorded at `e0bfdcef9` (CPU 4, three A/B/A brackets each, not a layout interval). Instructions per operation: <br>- spectral-norm's integer product: −14% on C, −3% on LLVM (cycles −13% and −10%); <br>- its exact dyadic ("scaled") denominator, an integer times a power of two: −31% on C, −14% on LLVM (cycles −17% and −18%); <br>- FASTA's integer region: −15% on both (cycles −10% and −11%); <br>- the JVM guard: about 0%. <br>The precondition, the parameter-arrival correction, landed in `c2bd26f8a`. Build per the note's delivery plan | [C]: `clbg-fasta` 2.11 ms, 1.02x node, 0.75x Bun, 5.30x C++; `clbg-spectral-norm` 626.98 µs, 0.96x node, 0.71x Bun, 1.22x C++ | As the note sets out: each consumer ships its own row on C, LLVM and JVM, with guard and clone size and compile cost recorded, and programs with no candidate unchanged | n/a (the build is large) |
| B-b | Only worth running if a row turns up whose addend or index cannot be proved; none found yet ([R] `accumulate` 1.00x C++, `checksum` 1.00x C++). Then hand-write ScriptC's three-copy form (fast loop, tail copy, original loop) with an 8-bailout counter. Compare it with the rejected one-copy guard and with the `nts f64` build, on that row and on a control with no candidate | The row found; controls `accumulate`, `checksum`, `loop` | A win larger than the row's layout range (`results/layout-intervals`), with the compile cost recorded | small to medium |
| B-c | Hand-edit the emitted C. <br>(1) `awfy-towers`: an entry-tested int32 copy of the recursive `moveDisks(disks, fromPile, toPile)`, which calls itself. `fromPile` and `toPile` are tested whole and within 0–2, so `(3 - fromPile) - toPile` stays int32. A failure goes to today's double body, so no restart is needed. The program's only outside call is `moveDisks(13, 0, 1)`. <br>(2) `fib`: ScriptC's form, an integer copy with an overflow flag (`__builtin_add_overflow`) that reruns the double body; this is allowed because `fib` has no side effects | [R]: `awfy-towers` 35.18 µs, 0.91x node, 1.42x Bun, 2.47x C++; `fib` 606.02 µs, 0.55x node, 0.83x Bun, 1.77x C++ | `awfy-towers` goes below Bun (a memory.md stage-1 target), and `fib`'s gap to C++ narrows, across three code layouts | small |
| B-d | A prototype with no compiler change. Hand-write in TypeScript the parser the compiler would generate for `json-parse`'s document (rows of `{id, name, ok, score, tags}`). It builds typed objects directly and throws a path-naming `TypeError` on a mismatch. The precedent is `json-stringify-typed`, which hand-writes the serializer "a compiler would generate … to find out what it would be worth". Add it as a new row with two engine arms: <br>- the host's native `JSON.parse(text)`; <br>- native `JSON.parse` plus an equivalent validator, the same contract ScriptC §12 asks for | A new row. `json-parse` [R]: 1.11 ms, 1.50x node, 0.90x Bun (all three columns run nts's TypeScript parser into an untyped graph, not the hosts' native parse). `json-scan` [R]: 0.82x node. The typed stringify side, for comparison: `json-stringify-builtin` [J] LLVM 391.07 µs, 0.41x node, 1.01x Bun (C 405.45 µs, 1.05x Bun) | The typed prototype beats node's and Bun's native `JSON.parse` on the same text, with and without the validator. memory.md stage 3 sets `json-parse` "below 1.0x node and about 0.75x Bun" | medium |
| B-e | Local slices are handled already. For the open part, slices that escape (strings stage D): a runtime prototype of a slice string that points into a retained owner, used only for `slice`, `substring` and `split` results | [R]: `str-split` 14.57 µs, 1.02x node, 0.81x Bun, 4.17x C++; `str-slice-keep` 3.10 µs, 1.04x node, 0.48x Bun, 1.27x C++. Controls for the extra pointer load: `substrings`, `str-index-read`, `strings`, and `str-append-loop` [J] (LLVM 12.92 µs, 1.08x C++, 0.24x node, 0.11x Bun) | Both losing rows go below node beyond noise, and no control regresses (strings.md: "Rows decide whether it pays") | medium to large |
| B-f | (1) Profile `sort-objects`. If retains and releases sit around the comparator calls, hand-edit its C so the comparator is entered through a borrowing entry, and time it. <br>(2) From `nts stats`, sum the closure and generic clones and their code size over the corpus, to see whether a program-wide growth budget (ScriptC's) would ever bind | [R]: `sort-objects` 1.15x node, 1.98x Bun (memory.md stage-1 target: below both). Regression controls, all winning today [R]: `closures` 0.06x node, `closure-merge` 0.02x, `module-closures` 0.15x, `uniform-callback` 0.17x, `pipeline` 0.19x, `optional-chain` 0.07x | (1) `sort-objects` moves beyond noise. (2) Some program's clones dominate its size or compile time | small |
| B-g | No async row exists. Add one that awaits a non-suspending async function in a loop, plus a control that awaits a real promise. Hand-edit the emitted C to call the body directly, with no promise. Run the async ordering fixtures (C-4) against node | A new row. Generator fusion needs nothing: `generator` [R] is at 0.98x C++ | A large saving per call, with every ordering fixture still agreeing | medium |
| B-h | Build P-2's instruments first: startup instructions (`perf stat`, user), wall time, private RSS and file size, for hello world and for a large program, against node, Bun and `bun build --compile`. Then run Bun's scaling test: add N unused functions, classes and modules (N = 0, 1,000 and 10,000), plus a populated, never-read registry (ScriptC's case), and plot startup instructions and RSS against N | New P-2 rows; none exist yet | Startup stays flat in N; any growth names a startup cost to remove | small to medium |
| B-i | Read the linker map (`-Wl,-Map`) per program, and attribute bytes to user code, clones, runtime units, descriptors and tables, and vendored libraries. Separately, link runtime objects before program objects, and measure the layout spread on the rows the layout-interval instrument flags | Hello world (about 16 KB, per memory.md), the `awfy-*` and `clbg-*` executables, `results/layout-intervals` | The report accounts for nearly every byte. Link order narrows the layout spread without slowing any row | small |
| B-j | After the memory census (M-1): if references dominate object bytes, hand-prototype 4-byte references for one pointer-heavy row. This needs a reserved heap range in the runtime | [C]: `clbg-binary-trees` 3.32 ms, 0.59x node, 0.62x Bun, 0.30x C++. [R]: `tree-teardown` 0.58x node; `release-acyclic` 1.30x node, 2.30x Bun; `awfy-list`; `objects` 1.04x Bun | RSS and time both improve on the pointer-heavy rows | large |
| B-k | A runtime-only change: add M6's counters and run `cyclic-churn`. The counters are candidates by age; nodes, edges and bytes visited; repeat visits to graphs that stay live; and time spent in traversal, destruction and freeing. If repeat visits dominate, try: <br>(a) an adaptive trigger that rises when a pass frees little; <br>(b) ScriptC's restricted pass over young candidates | [R]: `cyclic-churn` 96.24 µs, 9.79x node, 9.57x Bun, 3.24x C++. Also `tree-teardown`, `release-acyclic`, and `json-stringify-doc`, whose survivors the trigger's comment cites | `cyclic-churn` moves materially, and retained bytes grow no faster than live bytes at three sizes (memory.md's space rule) | medium |
| B-l | **No experiment now**: L7 is not built. Once it is, compare a per-type name-table lookup with a per-site data cache on a row that reads untyped JSON | — | — | n/a |
| B-m | **No experiment now**: crossings are decided by record 0356, and mostly not built | — | — | n/a |
| B-n | Run clang PGO by hand on the emitted C: `-fprofile-generate`, run the workload, rebuild with `-fprofile-use`. Also time a build trained on a different input, and never time the training build itself | [R]: `json-parse` 1.50x node; `case-convert-cjk` 5.25x node; `case-convert-greek` 4.06x; `str-split` 1.02x; `cyclic-churn` 9.79x; `dispatch` 0.67x Bun | Wins beyond the layout range on several rows, with a training input held out. numbers.md requires benchmarks to build as `nts build` does, so PGO would need an `nts build` mode | small |
| B-o | Hand-edit a call-heavy row's C to drop the after-call raise tests on calls that cannot throw, which is what table unwinding saves on the normal path, and time it | [R]: `fib`, `awfy-towers`, `awfy-queens` (all recursive); `exceptions` 6.80 µs against node's 16.90 ms, 1.29x C++ (node builds a stack trace for every throw) | The tests cost more than a few percent on some row; otherwise unwinding does not pay its per-platform cost | small |
| B-p | **No experiment now** (later) | — | — | n/a |
| C-a | For each row that loses to node or Bun in [R], check whether `nts facts`, `stats`, `regions`, `erasure` and `receivers` name the missing proof or the remaining run-time work | [R], losing to node (11): `awfy-mandelbrot`, `awfy-permute`, `case-convert-cjk`, `case-convert-greek`, `case-convert-latin1`, `cyclic-churn`, `json-parse`, `release-acyclic`, `sort-objects`, `str-slice-keep`, `str-split`. Losing to Bun as well (18 in all): `awfy-towers`, `erasure-typed`, `erasure-unknown`, `map-literal-keys`, `objects`, `record-word-counts`, `str-append-length`, `str-index-of`, `str-to-number`, `symbol-keyed-map` | Add a report wherever the tools cannot explain a loss | small |
| C-b | Add columns, using the newest builds, as the user directed on 10-29: <br>- **Bun AOT:** `bun build --compile --aot`, beside that same build's JIT. Build Bun from source at main or at `3a9ea0043` or later: the published canary `73b53109f` has `--aot` but not #47129's AOT fixes and engine upgrade, and the installed 1.4.0 has no `--aot` at all. At `3a9ea0043` the build script pins WebKit `f495db1d248886d7…` and downloads it prebuilt (`scripts/build/deps/webkit.ts`), and the oven-sh/WebKit release `autobuild-f495db1d248886d7de1077d0abe3a604694ebb4c` exists, so WebKit itself should not need compiling (not tried). Record the Bun and WebKit commits per section 5b. <br>- **ScriptC:** latest main (`8971d694b` on 10-29), with `--node-islands=off` and no `@scriptc/node`, plus an optional PGO arm. The local checkout (`2b6e6524a`, 2026-08-30) and npm `scriptc` 0.0.35 are both stale. <br>Start with the process rows, and follow section 5 | `awfy-*`, `clbg-*` first | It is an instrument, not an optimization. Whether an AOT column joins the "beat node and Bun" bar is for the coordinator | medium. The Bun build is a heavy job: run it under AGENTS.md's machine rules (its own unit, `nice -n 19`, off CPUs 4–5, at least 14 GB available) |
| C-c | **No experiment needed**: a permanent boundary (boundaries.md), and refusals already fail the build (L20, done). ScriptC's catchable `EvalError` would need the user to change the boundary (boundaries.md: "Changing one is the user's decision") | — | — | n/a |
| D-a to D-h | **No experiment needed**: each is already decided in nts, as listed in 1d | — | — | n/a |

## 3. Correctness findings the notebooks raise about nts

Each item is a gap in nts's docs that can give a wrong answer or unsafe
memory. The status comes from the docs and git, checked on 10-29.

1. **A store through a wider alias reads back at the narrow type.**
   - Raised by: Bun §1–3, ScriptC §1, §3 and §11.
   - The gap: a `Map<K, number>` passed as `Map<K, unknown>` that stores a
     string reads it back as a number. A `Base` pushed through a covariant
     `Sub[]` alias between equal layouts is called as a `Sub` on C and LLVM.
     Both are wrong answers (types.md "When a type's claim is false";
     numbers.md "A join is sound only if it sees every writer").
   - Fixtures: `a-string-stored-through-a-widened-number-map-reads-as-a-number`
     (also `-llvm`, `-jvm`), `a-typed-table-seen-with-wider-keys`,
     `a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass`.
   - Status: open. types.md Decisions marks the fix "Not built", and plan.md
     says "the covariant-array dispatch remains".
2. **Declared literal types read as value facts.**
   - Raised by: Bun §1, ScriptC §1 and §3.
   - The gap: types.md Decisions says "the compiler on `main` still reads
     declared literal types as facts".
   - Status: the arrival half is fixed. Commit `c2bd26f8a` says "Exported
     claimed(value: 64) returned 65 for every input on main". Its paired sweep,
     `62e6af8b9`, says the old compiler had "13 enum and 44 literal wrong
     answers per backend". The value test where an erased value is cast to a
     literal type is still documented as not built (section 4, item 1).
3. **A bivariant method that receives an erased argument does not compile.**
   - Raised by: Bun §1 (its method-bivariance test) and ScriptC §1 (loosely
     checked overrides).
   - The gap: fixture `a-bivariant-method-receiving-an-erased-argument` fails
     as invalid HIR (`CallArgumentType … expected: Float … found: Erased`)
     where node runs. The validator catches it, so it is not a silent wrong
     answer.
4. **A throw through an indirect call escapes `try`.**
   - Raised by: Bun §10 and ScriptC §10.
   - The gap: a throw from a closure in a field, a function made at run time
     or bound, an override reached through a base, or a generator stepped
     elsewhere ends the program where node catches it. These are wrong answers
     (errors.md "Throws that escape a try", four outcome fixtures).
   - Status: the fix (a raising flag on indirect calls) is decided, not built.
5. **A failed erased cast stops the program instead of throwing.** Where no
   handler can receive it, it exits with status 1 rather than throwing a
   catchable `TypeError` (types.md "Casts"; Bun §1, ScriptC §1). It diverges
   from the decided contract, but no wrong value is read.
6. **Generator completion and closing are missing.**
   - Raised by: ScriptC §10 (its rank 5) and Bun §10.
   - The gap: an early loop exit does not call `return()` (async.md
     "Generators"). These fixtures are wrong answers:
     `a-generator-close-skips-its-suspended-inner-iterator`,
     `an-early-async-generator-exit-leaves-the-frame-open` and
     `a-generator-passed-in-and-stepped-inside-a-try-ends-the-program`.
7. **Holes in `number[]` and `boolean[]` read as 0 and `false`, and a read
   past the end aborts.**
   - Raised by: ScriptC §11 (its rank 4) and Bun §11.
   - The gap: a wrong answer on C and LLVM (objects.md "Arrays"; fixture
     `a-hole-in-an-array-of-numbers-reads-as-zero`). plan.md marks the fix in
     progress.
8. **Region and frame memory safety.**
   - Raised by: ScriptC §7.
   - The gap: memory.md lists three defects: a double free through region
     helpers, a dangling stack pointer when analysis stops at a round cap, and
     overlapping loop instances sharing one slot.
   - Status: fixed on 10-27 by `d5e29279f` and `efdc6314a`, and plan.md says
     "*Fixed*". memory.md's table is stale (section 4, item 3).
9. **A proof that outlives a write to the memory it describes.**
   - Raised by: Bun §2, as a principle: facts about memory end at a possible
     write or suspension.
   - The gap: nts's docs do not say how a length or bounds fact is invalidated
     by a write through an alias or a closure. Fixture
     `a-bounds-check-removed-past-a-closures-shrink` documents that nts once
     removed a bounds check after a closure shrank the array, and read a stale
     element past the new end. It now records an abort by name, so the check
     is kept.
   - The link to this fixture is this digest's, not the notebook's.

## 4. Notebook claims about nts that look wrong or stale

Both notebooks read nts's docs faithfully. Most of what is wrong below is
wrong in the nts docs themselves, at the notebooks' pin.

| # | claim | where | evidence | verdict |
|---|---|---|---|---|
| 1 | "main still treats declared literal types as facts" (Bun); "main still reads declared literal types as facts" (ScriptC) | Bun §1 "nts today"; ScriptC §1 "nts today" and Scope | `c2bd26f8a` "derive parameter values from proved arrivals, never literal claims" landed at 2026-10-29 03:59 +0200, before the pin `01b93bdcc` (06:43); its paired sweep `62e6af8b9` and results commit `36e57ce95` landed with it. `results/parameter-arrivals/consumer-audit.json` marks the three unsound readers "Corrected". The types.md sentence was written later still, at 06:39 (`77e68eb1f`) | Stale for arrivals; the doc is the source. The other half, the value test at erased-to-literal casts, has no landing found. nts's own Casts table also states that test in the present tense, which contradicts its Decisions |
| 2 | The integral-region design is "awaiting the parameter-arrival correction" (ScriptC); "Implementation explicitly waits for the parameter-arrival correction to land" (Bun) | ScriptC §3; Bun §3 and "Source paths and design status" | The correction landed (`c2bd26f8a`, with its paired sweep `62e6af8b9`), before the note itself was written (`c9761190f`, 06:24) | Stale as current status. Bun's wording describes the note's precondition accurately |
| 3 | nts's memory note "records concrete defects involving optimistic analysis, overlapping instances and region helpers' ownership contracts"; ScriptC rank 7 says its ideas "help nts fix its existing region-analysis gaps" | ScriptC §7 and summary | memory.md's table was written at 10-27 01:53 (`7e18a4f3f`). The fixes landed at 02:41 (`d5e29279f`, "Keep region and frame allocations within proved lifetimes") and 05:10 (`efdc6314a`). plan.md phase 1 item 3: "*Fixed*" | Stale premise; memory.md was never updated |
| 4 | "Its designed truncated sums require proved int32 operands" | Bun §3 "nts today" | `f9a0fe4db` (10-28) "use content facts for proved int32 truncating sums"; `results/proved-int32-accumulators/`; plan.md: "Content facts and proved-int32 arithmetic are on `main`" | Stale: built. numbers.md still says "(designed)" |
| 5 | Per-addend speculation was rejected because its payoff depends on a dependency-chain condition the compiler cannot establish | Bun §3; ScriptC §2 | numbers.md "Truncated sums" gives that reason. plan.md's backlog gives another: "parked on its compile cost; the row it seemed to lose lies inside that row's layout range" | nts's docs disagree; the notebooks quote one of the two reasons |
| 6 | "temporary slice views remain planned" | ScriptC §11 "nts today" | Bounded strings that do not escape already live in the frame (memory.md "The ladder of homes"; `nts_str_substring_into` in core), and `substrings` "never build[s] the slice at all" (comment in `benchmarks/cases/str-slice-keep/case.ts`) | Incomplete: the local-slice idea (S8) is partly built. Owner-pointing slices (stage D) are indeed only planned |
| 7 | "sanitizer-visible disposal" offered as new | ScriptC §7, rank 7 | Under ASan regions keep no blocks and free lists stop recycling; `NTS_POISON` pattern-fills reset blocks and checks membership (`runtime/c/nts_runtime.c:155-175, 660-685`) | Incomplete: built in code, but not in the docs the notebook read |
| 8 | "function splitting remains planned" | ScriptC §5 | objects.md says "splitting call sites" | Minor wording |
| 9 | Class-number interval tests are "decided but not built" | ScriptC §4 (Bun §4: "decided or designed") | objects.md: "*Designed, not built:* a single class-id range test" | Minor wording |

No other claim about nts in either notebook disagreed with the docs when
checked, including:

- the ±(2^53−1) bound;
- the ten-clone cap;
- the two closure entries;
- the cast table;
- the boundaries;
- ThinLTO and dead stripping;
- raising copies;
- heap-frame async functions.

## 5. Benchmarking guidance, quoted

### 5a. ScriptC: running it fairly (`scriptc.md`, studied at `b260a13dd`)

- Summary: "The important compatibility qualification is that **current
  ScriptC can automatically put refused npm dependencies into embedded
  Node**. Its native dynamic values and its Node-backed modules are different
  execution paths. A fair engine-free comparison must disable automatic
  islands and exclude explicit Node bridges"
- Scope: "At this revision, executable preparation can automatically make
  refused npm packages islands, and policy defaults to `auto`. Some
  documentation lags that implementation. Section 6 follows the executing
  code, not the stale comment"
- §5: "engine-free comparisons need `--node-islands=off` and no explicit
  `@scriptc/node` use."
- §6: "The default policy is `--node-islands=auto`: refused npm packages and
  packages explicitly marked for Node become islands. Packages forced to
  remain native keep their refusal. `explicit` restricts this to marked
  packages; `off` disables this automatic selection. Each selected island
  produces an SC8001 note. Lowering failures can grow the island set and
  retry compilation."
- §6: "A comparison must report the island policy and actual selected
  dependencies; a claim of an engine-free artifact also needs to exclude
  explicit bridge use."
- §7: "Normal main-thread execution leaves still-held globals for the
  operating system at process exit. Worker contexts, auditing/sanitizer modes
  and `SCRIPTC_EXIT_FREE=1` request teardown." and "**Inference:** a benchmark
  that measures process lifetime needs to distinguish useful computation,
  reclamation during execution and final teardown; keeping live globals until
  exit must not be presented as more efficient collection."
- §8: "a startup comparison should separate first use with an empty module
  cache, a populated cache and a run that never calls Node. No startup
  percentage follows from the design alone."
- §9: "Comparing only executable file bytes omits the external engine pack
  and, in beside mode, the module payloads. Conversely, a wholly native
  program need not link or load this bridge. The same caution applies to
  memory: avoiding an engine is conditional on the actual built graph, not
  the product name." and "size must include all deployment dependencies."
- §2, on profiles: "Current generation requires Linux executable output and
  an optimized, nonsanitized build."
- §12, the evidence limit: "This inspection did not produce a timed
  ScriptC-versus-nts/Node/Bun result. The pinned repository contains
  workloads and a measurement runner; the workload JSON files are
  configurations, not performance results."
- §12, its options: "With `--exceptions=rare`, eligible Linux functions avoid
  normal-path exception-status tests, but propagating actual exceptions must
  unwind native frames. The CLI documentation warns that throw-heavy control
  flow can become several times slower. Its huge-code-page option similarly
  trades initialization and resident private memory for fewer
  address-translation misses during execution. Neither option is a free
  improvement"
- §12, its table:
  - "Report native-only and island-enabled modes separately. Do not claim an
    engine-free win when the row used Node."
  - "Compare the same validation contract and correct outputs; optimize
    construction without dropping checks."
  - "Measure repeated in-process work and retained memory, not only short
    launches that hand cleanup to the OS."
- §12, the runner: "The runner checks stdout, stderr and exit status against
  Node, and server workloads add checked client output. A timeout, build
  failure or mismatch remains a named result and is not timed. It interleaves
  contender launches, records layout variants when requested, and uses a
  bootstrap interval to distinguish a reported change from noise" and "Its
  default release build command does not itself force Node islands off"
- §12, docs: "Process rows include startup; Node directly runs the TypeScript
  entries, including its type-stripping work. Server rows measure a warmed
  in-process phase with the same load client. Those are different questions
  and should stay separate"
- §12, the recommendation: "add ScriptC native-only, explicitly profiled and
  island-enabled configurations as distinct future measurements."
- §12, the closing paragraph: "For any follow-up, record the full compiler
  commit, target CPU/OS, runtime pack, optimization mode, island policy and
  actual island notes, profile training inputs, exception policy, and
  process-exit cleanup policy. Keep source workloads unchanged. Measure cold
  startup, warm execution, build time, executable size, peak memory and
  retained memory separately. Do not time an instrumented training build as
  the optimized result. Maintainers must remeasure on the benchmark machine
  before relying on a number; any off-machine result remains indicative."
- §12, inlining budgets (an author report): "LLVM's much larger hot-call
  allowances tripled build time and memory on large programs without a
  measurable runtime gain. ScriptC caps those multipliers at two. Its
  ordinary cross-partition import limit is 40 instructions; the comment
  reports that cutting it to 30 or below made the studied program run 1–8%
  slower."

Checked locally, not quoted: `~/Projects/scriptc` is at `2b6e6524a`
(2026-08-30), the studied `b260a13dd` is not present, and the global npm
`scriptc` is 0.0.35. Upstream main was `8971d694b` on 2026-10-29 05:26 UTC.

### 5b. Bun AOT: versions, flags and what to measure (`bun-aot.md`)

- Versions: "Bun frontend, documentation and tests | `8d5672c55…` | The merge
  of PR #45631, dated 2026-10-27"; "Requested WebKit AOT branch |
  `c3131ea84…` | … `claude/compile-aot` when read, dated 2026-10-29"; "WebKit
  build selected by that Bun merge | `286c20834…` | Provenance only: Bun's
  build selects `autobuild-preview-pr-914-286c2083`".
- The revision boundary: "the requested WebKit branch is later than the
  engine selected by the Bun merge. This is a study of those explicitly
  pinned source snapshots, not a claim that the two source trees were built
  together or that every branch feature shipped on October 27."
- Preview claims: "No speed or memory experiments were run. The early 24%
  startup, 48% memory, 46% CPU and nearly 2x size figures are retained only
  as **unverified preview claims supplied in the handoff**."
- Flags:
  - the feature is "`bun build --compile --aot`" (PR #45631's title);
  - "The documented switch is `--aot-validate`.";
  - "Dynamic `import()`/`require()` of code outside the executable is refused
    by default; `--external` permits named packages, and
    `--aot-allow-code-from-disk` permits other runtime source through
    transpilation and interpretation.";
  - "When an image runs, JIT compilation is disabled.";
  - trimming is `--trim`: "A compiled image can discard machinery even
    without full `--trim`."
- Memory: "Shared file pages, private allocations and resident-set size
  (RSS: all resident memory pages counted for the process) should be measured
  separately. Sharing helps multi-process totals without removing a resident
  shared page from each process's RSS. The size guide itself says trimming
  changes file size without changing startup or memory use"
- Startup: "startup independent of unused program size is a tested design
  objective with remaining exceptions. It should not be stated as an
  unconditional property, and these tests do not reproduce the author's 24%
  preview result."
- Size (an author report): "The pinned size guide's Linux x64 todo-server
  example is 140 MB for the JIT executable, 69 MB for AOT and 33 MB for
  trimmed AOT."
- Libraries with a fallback: "A library that catches failure to create a
  function can select an ordinary compiled implementation. The compatibility
  guide documents this for zod 4, including its `jitless` option. That
  changes which implementation executes; any throughput benefit should be
  measured separately from file-size reduction"
- Losses (an author report): "warm throughput below the same Bun build's JIT
  for Express (7.1%), Elysia (13.5%), Fastify (16.9%) and Koa (22.9%). That
  experiment used Linux x64, an AMD EPYC 9R14, one core per server, a
  separate load-generator core, 64 connections and seven starts, on
  2026-10-24. It also reports median AOT/JIT instruction ratios of 0.94 for
  isolated idioms and 1.44 when compiled under its large-program conditions."
  It adds: "1.44 means 44% more instructions, not an established 44%
  slowdown."
- Harness: "Its performance harness has separate small, called and
  large-program modes; the last mode constrains the warm-code budget, and it
  compares the worse of typed and type-erased AOT forms with the same
  executable's JIT" and "Bun's own measurement guidance makes wall-clock
  behavior decisive and warns that fewer instructions with more code can
  lose"
- Calling context: "An isolated loop can give the compiler a much easier
  problem than the same function called indirectly in an application. |
  Measure the actual calling context and total code size, not only a tiny
  loop."
- Summary, rank 8: "add Bun AOT beside Bun JIT in future benchmark work, and
  distinguish cold startup, warm throughput, isolated loops and functions
  inside large programs."
- §12, the closing paragraph: "For that follow-up, record a matched Bun
  frontend/engine revision, target CPU and OS, compiler options, whether
  trimming or dynamic code is enabled, and build success or refusal for every
  row. Measure cold process startup, warm work, peak and retained memory,
  executable size and build cost separately. Use the same inputs and checked
  outputs; compare AOT with the same Bun build's JIT to avoid attributing
  unrelated runtime improvements to AOT. Instruction counts help diagnose a
  result; maintainers' wall-clock measurements on the benchmark machine
  decide it. Any off-machine measurements remain indicative."

Checked locally, not quoted: the installed Bun is `1.4.0+34cbb9a40`, and
`bun build --help` lists no `--aot` flag. Node is `v24.20.0`.

Checked upstream, not quoted: PR #47129 (`3a9ea0043`, merged 2026-10-29
02:41 UTC) is "Follow-up to #45631", upgrading WebKit to oven-sh/WebKit
`main` at `f495db1d2488`, "which holds the engine's half of this work". It
also says "Most of this is behind `--aot`" and lists changes that reach Bun
without it. A Bun AOT column should therefore record the Bun and WebKit
commits it was built from, not the notebook's `8d5672c55`, `c3131ea84` and
`286c20834`.
