# What nts can learn from Bun's ahead-of-time compiler

Research notebook, 2026-10-29. Research only; no implementation changes or new measurements.

## Summary: ideas worth taking, ranked

Bun's most useful contribution to nts is the machinery designed to keep fast storage and operations correct when TypeScript's claim about a value is false. Fixed object layouts, numbers stored directly and compiling before execution are already part of nts. The opportunities are better proofs across calls and containers, carefully placed checks, precise contracts for native helpers, and evidence that each optimization is both correct and profitable.

A **representation** is a value's storage format; a **layout** fixes possible object fields and their positions. A **guard** is a runtime check. An **alias** is another reference to the same object; **effects** describe what code can read, change, retain or call. A **tagged value** carries a marker identifying its runtime kind; an **unboxed value** stores the payload directly. **Metadata** means descriptive tables used by the compiler or runtime. A **callee** is the function being called.

These are recommendations, not new nts decisions. “Yes” means adopt the design principle or finish the corresponding existing plan; “later” means retain it as a measured option.

| Rank | Idea | Recommendation and reason | Sections |
|---|---|---|---|
| 1 | One account of values, aliases and effects for the whole program | **Yes:** let integer ranges, container representations, dispatch and memory placement consume the same conservative facts, including every writer and unknown caller. | [2](#2-speculation-without-a-profile), [3](#3-numbers), [5](#5-calls-and-closures), [11](#11-builtins-strings-arrays-typed-arrays-and-json) |
| 2 | Make compiler proof claims executable in diagnostic builds | **Yes:** independently check the facts that remove guards, and compare typed, type-erased and optimization-disabled builds on adversarial values. | [1](#1-types-and-soundness), [2](#2-speculation-without-a-profile) |
| 3 | Contracts for every builtin and native helper | **Yes:** describe reads, writes, retained arguments, throws and callbacks; these facts preserve proofs and can remove temporary view objects when a helper only needs their bytes. | [7](#7-memory-and-the-48-claim), [11](#11-builtins-strings-arrays-typed-arrays-and-json) |
| 4 | Remove unnecessary call, function and promise machinery | **Yes:** follow actual targets through fields and returns, then prove when inlining, deferred function objects, intermediate-promise removal or generator-loop fusion is safe. | [5](#5-calls-and-closures), [10](#10-exceptions-async-functions-and-generators) |
| 5 | Typed JSON construction plus explicit validation semantics | **Yes:** build the already planned parser directly into the target layout, retaining nts's specified errors and avoiding runtime-generated validator code. | [11](#11-builtins-strings-arrays-typed-arrays-and-json) |
| 6 | Guarded compiled alternatives at useful boundaries | **Yes, selectively:** amortize a check over a function or region where ordinary JavaScript behavior is required; keep nts's deliberate checked-cast error and its rejection of unproved per-iteration numeric speculation. | [1](#1-types-and-soundness), [2](#2-speculation-without-a-profile), [3](#3-numbers) |
| 7 | Explain lost proofs and expensive representations | **Yes:** report the specific unknown writer, escaping object, dynamic callee or retained feature; connect static counts to measured hot paths. | [2](#2-speculation-without-a-profile), [9](#9-size-and-the-2x-claim), [12](#12-where-it-loses) |
| 8 | Benchmark AOT as a separate competitor, in realistic calling contexts | **Yes:** add Bun AOT beside Bun JIT in future benchmark work, and distinguish cold startup, warm throughput, isolated loops and functions inside large programs. | [12](#12-where-it-loses) |
| 9 | Compact immutable metadata and lazy runtime initialization | **Yes:** use precomputed descriptions and demand-driven initialization where they reduce startup and private memory without executing user code during the build. | [7](#7-memory-and-the-48-claim), [8](#8-startup-and-the-24-claim), [9](#9-size-and-the-2x-claim) |
| 10 | Data-only property caches and exceptional-property storage | **Later:** useful for nts's deferred dynamic property/reflection work, provided programs with entirely static objects pay no cost. | [4](#4-objects-and-property-access) |

## Scope, revisions and evidence

The labels in this notebook have a specific meaning. **Code** means the implementation or a test was read; a test is evidence of what is exercised, not proof that it passes on every platform. **Docs** means a documented contract or design. **Author report** means a performance result published by Bun's author, not a measurement made here. **Inference** means this notebook's interpretation or recommendation. In each section, the closing comparison is an inference based on the cited implementation and nts documentation.

All source links below use full commit IDs and file line ranges. `B:` paths are in `oven-sh/bun`; `W:` paths are in `oven-sh/WebKit`, under `Source/JavaScriptCore/` unless shown otherwise; `N:` paths are in `AkisArou/nts`.

| Source | Revision read | What it establishes |
|---|---|---|
| nts | `b698106e055c5a612408860a4a562e031d2c3782` | The requested language and foundation documents, distinguishing current behavior from decisions not yet built. |
| Bun frontend, documentation and tests | `8d5672c5529049f1a9a3453d07e6cd6a1564abc7` | The merge of PR #45631, dated 2026-10-27; its commit message preserves the PR description used here. |
| Requested WebKit AOT branch | `c3131ea84f7eaad531619e3842bb30c48df18ab1` | The compiler/runtime source on `claude/compile-aot` when read, dated 2026-10-29. |
| WebKit build selected by that Bun merge | `286c20834be3cb8855f6095fb1a1a8ed7db6ec1e` | Provenance only: Bun's build selects `autobuild-preview-pr-914-286c2083`, which resolves to this commit. |

**Revision boundary:** the requested WebKit branch is later than the engine selected by the Bun merge. This is a study of those explicitly pinned source snapshots, not a claim that the two source trees were built together or that every branch feature shipped on October 27. The build selection is visible in [B: scripts/build/deps/webkit.ts:1–6][source-001]. The PR's frozen description is the [merge commit message][source-002].

**Two source corrections.** The requested `docs/bundler/aot.mdx` is absent at the merge revision; the document is [docs/compiler/aot.mdx][source-003]. The additional [docs/compiler/internals.mdx][source-004] supplied in the conversation was read and used as the source map. The requested nts `docs/records/notebooks/integral-arithmetic-regions.md` is absent at the pinned revision, and the repository's history query for that exact path returned no commits. Its contents are therefore **not claimed as reviewed**. Section 3 compares against the published numeric proof contract and the handoff's description of the work in progress; it does not invent details of the missing note.

No speed or memory experiments were run. The early 24% startup, 48% memory, 46% CPU and nearly 2x size figures are retained only as **unverified preview claims supplied in the handoff**. Neither source inspection nor a later result on another workload can validate those percentages or apportion their causes.

## The pipeline, briefly

**Code + docs.** The source-to-bytecode description in the handoff needs correction. Bun parses source into its own syntax tree, checks it, and lowers it into a dedicated intermediate representation (**IR**: the compiler's structured description of operations). That IR uses **static single assignment**, or **SSA**, meaning each intermediate value has one definition, making its origin easier to follow. It is not JavaScriptCore interpreter bytecode with TypeScript metadata added.

1. **Load and bind:** find reachable modules, parse them, connect imports and exports, and determine module evaluation dependencies.
2. **Check and lower:** ask Bun's checker about expressions and signatures; turn each file into IR. Application type errors and lowering failures become build diagnostics.
3. **Link the program:** combine per-file identities, layouts and functions; send the serialized IR to JavaScriptCore's AOT compiler.
4. **Prove and optimize:** analyze values across the whole program; resolve checks, properties and callees; choose field storage and machine representations.
5. **Generate machine code:** lower into **B3**, JavaScriptCore's machine optimization representation, then **Air**, its representation for instructions and register allocation.
6. **Write and load the image:** package code and immutable descriptions into the executable; initialize the live runtime when it starts.

The frontend stage order is [B: compile.rs:1350–1450][source-005]; the bridge is [B: BunAOTCompile.cpp:403–423][source-006]; the engine stage order and error return are [W: AOTPipeline.cpp:1854–1942][source-007]. The architectural description is [B: internals.mdx:72–116][source-004]. nts already has a comparable separation: one typed high-level IR and shared preparation feed C, LLVM and JVM emission, with no JavaScript engine in the program ([N: architecture.md:6–45][source-008]).

## 1. Types and soundness

**[Code] Bun separates a type it expects from a fact that licenses a machine operation.** A guard is a runtime test that admits a value to faster code only when its assumptions hold. The engine represents expected and proven types separately, including whether a proof depends on preceding checks. A declared position is established only when every arrival is constrained to its type; asking what type was written says nothing about an actual value. Facts can come from construction, operation rules, tracked arrivals or successful tests. [ir/AOTTypeKinds.h:21–40][source-009]; [ir/AOTTypeKinds.h:81–123][source-010]; [ir/AOTDeclaredType.h:42–77][source-011].

**[Code] Candidate proofs require more than a matching annotation.** Parameter promotion requires all callers to be known and excludes unobserved indirect calls. Candidate variables require all writers known and every store to identify the location. The compiler retracts candidates and repeats its analysis before applying the surviving claims. [passes/AOTAddGenericVersion.cpp:884–937][source-012]; [passes/AOTAddGenericVersion.cpp:1932–1945][source-013].

**[Code + docs] A wrong type normally selects slower compiled code.** EntryChecks creates a generic copy, tests parameters, calls the typed body on success and passes the original arguments to the generic body on failure. A failure inside a function transfers current live values—the values its remaining work needs—to a compiled continuation. It can return to specialized code after retesting them. Already performed effects are preserved; restarting from the beginning is restricted to failures before observable effects. The interpreter is not this fallback. [passes/AOTEntryChecks.cpp:579–628][source-014]; [passes/AOTAddGenericVersion.cpp:2108–2141][source-015]; [docs/compiler/internals.mdx:596–610][source-016].

**[Code + test source] The routes around TypeScript's checks receive explicit treatment.** The frontend labels assertions, loose types, container reads and declarations without implementations as possible sources of missing proof. Argument lowering places parameter tests at the callee's entrance. The method-bivariance test exercises TypeScript's loose method-parameter compatibility: it passes `undefined` through an interface to an implementation requiring `number[]`; a separate test writes a string through a widened array alias. These demonstrate intended adversarial coverage, not passing results from this investigation. JavaScript and `any` callers are explicitly covered by the documented entry-guard contract. [src/aot/lower/convert/edges.rs:137–205][source-017]; [src/aot/lower/convert/calls.rs:134–185][source-018]; [test/aot/values-against-their-types/method-bivariance.ts:1–6][source-019]; [test/aot/values-against-their-types/covariant-array.ts:1–7][source-020]; [docs/compiler/types.mdx:386–389][source-021].

**[Docs] An ordinary assertion itself does not convert or throw.** Subsequent JavaScript operations retain their usual behavior: accessing a property of undefined can throw because of the access. Thus an inaccurate annotation is different from a failed explicit validation written by the program. [docs/compiler/internals.mdx:632–645][source-022].

**[Docs + code; qualification] Bun also depends on the frontend correctly classifying assignment edges.** When value-flow sets exceed their budget, the documentation distinguishes untracked objects made by this program from unknown outside values. Across an edge classified as sound, the declared family restricts the untracked objects; an unsound edge loses that restriction. The frontend accepts checker assignability as having no unsoundness cause. This is a dependency of Bun's design, not evidence that TypeScript assignability is universally sound. nts must retain its rule that a declaration alone proves no payload, range or bound. [docs/compiler/internals.mdx:1314–1346][source-023]; [src/aot/lower/convert/edges.rs:180–200][source-024].

### Checking the compiler's own claims

**[Code + docs] Validation is separate from production fallback.** The IR verifier rejects a behind-check assumption without a protecting check. A validating build tests optimized value types and guarded shapes; a broken compiler claim ends the process with a named diagnostic. The documented switch is `--aot-validate`. These failures identify compiler errors, whereas ordinary mismatches continue through generic code. [ir/AOTVerifierProofs.cpp:322–345][source-025]; [codegen/AOTRuntimeValidationChecks.cpp:143–155][source-026]; [codegen/AOTRuntimeValidationChecks.cpp:186–211][source-027]; [docs/compiler/internals.mdx:1922–1924][source-028].

**[Code + test source] ClaimsToBackEnd checks assumptions after B3 has performed its code-moving optimizations.** It checks numeric ranges, rereads supposedly unchanging words and detects unwritten frame-slot reads. Sabotage tests deliberately drop guards or supply false facts and require a named crash, with valid controls. This tests the checker itself without treating test coverage as a universal soundness proof. [codegen/AOTClaimChecks.cpp:241–252][source-029]; [tests/AOTProofValidationTests.cpp:631–706][source-030]; [test/aot/README.md:155–159][source-031].

**Author report + docs.** The frozen PR reports continuing fuzzer-discovered miscompilations, and the test documentation retains known wrong-output cases as TODOs. These are implemented checking and fallback mechanisms in an experimental compiler, not a guarantee for every accepted program ([merge description][source-002]; [B: test/aot/README.md:139–153][source-194]).

**nts today [docs].** nts deliberately checks erased primitive/class casts. A mismatch is TypeError where exception transport currently permits it; elsewhere it is a named stop pending the decided fix. Erased interface casts instead require provable field access or refusal. Its every-writer collection rule is decided but not fully built. [nts docs/language/types.md:82–108][source-032]; [nts docs/language/types.md:193–204][source-033].

**Take it? [Recommendation] Yes: explicit proof provenance and independently checked backend claims address nts's core correctness risks; retain nts's chosen cast semantics and never substitute TypeScript assignability for runtime proof.**

## 2. Speculation without a profile

**[Code + docs] Bun combines static value flow, expectations and guarded native alternatives.** Value flow follows which object-creation sites, functions and primitive values can reach each position. Assignments, arguments and returns connect those positions; reads and calls add further connections as possible receivers and callees become known. This describes possible executions, rather than recording a previous run. The solver grows its sets in rounds, resolves new connections and repeats until work stops, subject to its budgets. [docs/compiler/internals.mdx:1280–1312][source-034]; [valueflow/AOTValueFlowSolver.cpp:6219–6267][source-035]; [valueflow/AOTValueFlowSolver.cpp:6304–6333][source-036].

**[Code] Bun estimates where optimization will pay.** Its heat model combines loop frequencies, chains of calls and event-driven invocation estimates, then ranks blocks under hot/warm code-size budgets. This controls duplication and specialization. Entry splitting, for example, creates three functions for one and is skipped for cold functions. These frequency estimates predict profitability; they do not prove what values exist. [passes/AOTHeat.cpp:167–195][source-037]; [passes/AOTHeat.cpp:306–343][source-038]; [passes/AOTHeat.cpp:634–657][source-039]; [passes/AOTEntryChecks.cpp:655–676][source-040].

**[Code] It retains speculations that a runtime test can discharge:** expected argument kinds, object layout, array storage, bounds, unchanged members and integer paths. Facts about a value are distinguished from facts about mutable state. The schema marks the latter as lasting only for a stretch of code. Effect analysis—tracking what an operation can change—ends those proofs when execution may write the relevant memory or suspend. This prevents a previous bounds or shape test from automatically justifying an access after intervening mutation. [ir/AOTSchema.def:32–41][source-041]; [analysis/AOTGuardAvailability.cpp:42–44][source-042]; [analysis/AOTGuardAvailability.cpp:99–128][source-043].

**[Code + docs] Failed speculation has a precompiled destination.** Entry failures choose the generic body; interior failures transfer current state. Rejoin planning checks the live-value requirements before returning to specialized code. Cold code may use small per-operation guards instead of a larger generic continuation. Both choices trade execution cost against binary size without generating replacement machine code during the run. [passes/AOTEntryChecks.cpp:579–628][source-014]; [analysis/AOTGenericCopy.cpp:645–705][source-044]; [docs/compiler/internals.mdx:596–610][source-016].

**[Inference] A JIT can still make a better profitability choice.** A static estimate cannot know which branch a deployment repeatedly takes or which member of a large possible-value set predominates. Bun's AOT must establish a stronger fact, carry tested alternatives or use generic operations. For nts, such a loss should identify the missing fact and motivate proof from all callers/writers or an existing language operation. Repeated tests need demonstrated payoff of their own.

**nts today [docs].** nts already propagates numeric facts through operations, guards, stores and call sites, and can use one guarded integer clone at an external entry. Its proposed common memory analysis follows allocation sites and aliases, supplies every-writer content summaries, and records effects of callbacks, exceptions and suspension. That analysis is decided, not built; unknown writers must make its content facts unknown. [nts docs/foundations/numbers.md:24–77][source-045]; [nts docs/foundations/memory.md:3–5][source-046]; [nts docs/foundations/memory.md:156–192][source-047].

**Take it? [Recommendation] Yes: shared value/effect analysis and explicit proof lifetimes; later: larger generic continuations where a measured workload justifies their binary size and complexity.**

## 3. Numbers

**[Code] Proven numeric sets determine which unboxed representations are legal.** `Int32` holds signed whole numbers from −2,147,483,648 to 2,147,483,647; a proved range within those limits can use it. Wider integers can use `Int64`; an unboxed number needing floating-point states uses `Double`, the usual JavaScript number format. Calling or storage requirements can still keep known numbers in a tagged representation. `NaN` is the special not-a-number result, such as from zero divided by zero. The arithmetic rules derive result ranges from operands and broaden the result when exactness, negative zero or NaN prevents an integer conclusion. [represent/AOTRepresentationRules.cpp:73–86][source-048]; [ir/AOTResultRulesNatural.cpp:75–113][source-049]; [ir/AOTResultRulesNatural.cpp:193–264][source-050].

**[Code] Proof and speculation coexist.** For suitable operations on already-known numeric values held in tagged storage, Bun can emit an int32 test and copy a specialized arithmetic path. Failed tests enter the original numeric arm. This proves the condition for that execution; it does not establish that every execution is integral. [select/AOTNumberPathRules.cpp:64–103][source-051]; [select/AOTNumberPathRules.cpp:250–267][source-052]; [select/AOTNumberPathRules.cpp:322–350][source-053].

**[Code + docs] Bun's explicit int32 annotation requests proof, not silent wrapping.** Its promise checker reports stores it cannot establish as int32; numeric proof rejects fractions, NaN, −0 and out-of-range constants, and returns unknown when its work budget is exhausted. Ordinary addition of two int32s can therefore fail compilation for an int32 destination unless bounded or explicitly truncated with JavaScript's bitwise operation. Unseen calls remain guarded: a fraction can select the slow function. Untyped field writes preserve the actual value through generic storage. The annotation is not recursively enforced inside arrays or maps. [ir/AOTCheckInt32Promises.cpp:100–126][source-054]; [ir/AOTInt32Proof.cpp:40–50][source-055]; [ir/AOTInt32Proof.cpp:278–298][source-056]; [docs/compiler/types.mdx:353–392][source-057].

**[Code] Ordinary addition does not silently wrap at 32 bits.** Exact integer operations require justified operand/result facts. The CheckedIntegers form can widen addition/subtraction and then convert the result to double; multiplication/division use converted doubles. Its name does not imply a universal overflow trap or interpreter bailout. A boxed-number fast path likewise checks integer tags and uses a widened sum. [select/AOTArithmeticForms.cpp:13–30][source-058]; [codegen/AOTOperatorEmitterArithmetic.cpp:99–140][source-059]; [codegen/AOTOperatorEmitterArithmetic.cpp:525–551][source-060].

**[Code] Integer tracking and exact arithmetic are separate.** Range-endpoint calculations use checked host integers; overflow or a result outside the exact double interval broadens the numeric kind. Bun's exact-result interval includes ±2^53, while nts documents ±(2^53−1). Bun can track particular larger representable integers without claiming that arithmetic over an entire wider interval is exact. [ir/AOTPrimitives.h:49–79][source-061]; [ir/AOTResultRulesNatural.cpp:75–100][source-062]; [nts docs/foundations/numbers.md:55–63][source-063].

**[Code] Minus zero is preserved explicitly.** The rules retain its possibility for negative-times-zero, negation of zero and negative remainders. The generic integer test compares the bits after conversion back to double, rejecting −0 despite its ordinary equality with +0. Remainder emission supplies −0 when a negative dividend has zero remainder, and NaN for a zero divisor. [ir/AOTResultRulesNatural.cpp:86–113][source-064]; [ir/AOTResultRulesNatural.cpp:193–204][source-065]; [codegen/AOTTypeTestEmitter.cpp:572–604][source-066]; [codegen/AOTOperatorEmitterArithmetic.cpp:289–336][source-067].

**nts today [docs].** nts's numeric contract requires integrality, range, exclusion of NaN and preservation of observable −0. Existing analyses propagate facts through operations, guards, stores and call sites, but the docs acknowledge missing writes through wider aliases; complete every-writer collection summaries remain part of the unbuilt fix. Its designed truncated sums require proved int32 operands; numbers.md records that repeated per-addend integer tests were measured and rejected because their payoff depended on a dependency-chain condition the compiler could not establish. Bun's speculative integer arms should therefore not replace the proof-based integral-region direction. [nts docs/foundations/numbers.md:24–90][source-068].

**Take it? [Recommendation] Yes: use Bun's exactness, widening and −0 checks to review and independently validate nts's integer proofs; no: adopting repeated int32 speculation as the default after nts has rejected that tradeoff.**

## 4. Objects and property access

**Code and docs.** Bun chooses physical object layouts during compilation. A layout describes its possible fields and their storage offsets. Classes, interfaces, object types and literals supply candidates; whole-program value flow helps select each field's representation, including raw doubles, narrow integers, compressed references and general tagged values. No runtime profile is collected during the build. The object retains a permanent compiled-layout identifier, alongside JavaScriptCore's collector header and a word recording property order and mutable state. Its first field begins at byte 16. [AOTCellFormat.h, L26–85][source-069]; [internals.mdx, L1424–1477][source-070].

**Code.** If a writable numeric field receives a string, its narrow-slot store fails and that property moves into a side object capable of holding arbitrary JavaScript values. Bun marks the original object's state, clears the old slot and invalidates affected property facts. Other fields remain compact; a compatible later value may move back. Ordinary read-only-property errors still apply. Crucially, the permanent layout identifier proves the object's compiled identity, while additional facts establish whether a particular field still occupies its original slot. [AOTObjectMethodTable.cpp, L59–79][source-071], [L969–1003][source-072].

**Docs.** Proved stable fields need one load. Possibly absent fields need an absence check; fields that might have left their slots need a state check; unproved receivers need a layout check. The other arm performs general property access. An ordinary parsed object can contain the expected properties yet miss the compiled-layout test and still work. [internals.mdx, L1479–1515][source-073]; [types.mdx, L234–299][source-074].

**Code and docs.** Dynamic lookups remember answers in mutable data. A hot lookup's 16-byte site cache compares the receiver's engine property-layout identifier; compiled objects also have a prebuilt read-only layout/name table. Further tables, prototype searches and runtime handlers cover other cases. Dependencies invalidate answers after relevant mutations. Machine instructions remain unchanged. Related compiled layouts can receive neighboring identifiers so a family-membership test becomes a range comparison. [AOTStubsPropertySiteCaches.cpp, L140–204][source-075]; [internals.mdx, L1517–1532][source-076], [L1581–1600][source-077].

**Docs and inference.** This design still learns lookup answers while the program runs. It pays for that flexibility: the documented cache hit includes a call, loads, a comparison and a return. A warm JIT can place its answer inside the instruction stream. For nts, avoiding dynamic lookup through proof is therefore more valuable than reproducing the entire cache hierarchy. [internals.mdx, L1581–1600][source-077].

**nts today — docs.** nts already has fixed layouts, merged identical layouts, direct offsets and interface field-access tables. Runtime-added properties and prototype values are unrepresented; unknown-key access on erased values is refused. Descriptor/name tables and class-family range tests are decided or designed, not built. [objects.md, L28–98][source-078], [L224–228][source-079].

**Take it? Later — inference:** use permanent layout identity and prebuilt name tables when implementing dynamic access; preserve proved direct loads, and add property-local side storage only where the chosen semantics requires it.

## 5. Calls and closures

**Code and docs.** Bun selects a direct call for one known stable target, tests followed by direct calls for a small target set, a method-table lookup for larger compatible families, and property lookup plus function-value dispatch for unknown targets. Direct calls allow inlining: merging the callee's body into its caller. Table construction checks parameter representations and retains the original dynamic call for incompatible layouts. User methods remain replaceable: a guard bit records whether a method is unchanged, mutation clears it, and dependent dispatch can return to ordinary lookup. [AOTResolveCalls.cpp, L3122–3186][source-080]; [AOTMemberGuards.cpp, L340–399][source-081]; [internals.mdx, L1534–1547][source-082].

**Code.** Bun's inliner estimates the code remaining after specialization. It subtracts removable tests and calls, rewards exposed known receivers/callees and eliminated allocations, and reduces budgets for cold code and deeper nesting. Static loop/call estimates guide these choices. This links inlining to the work it unlocks while limiting code growth. [AOTInlining.cpp, L2294–2359][source-083], [L2373–2419][source-084].

**Code and docs.** A closure combines a function with captured surrounding variables. Bun can defer a function object's creation, use a slim entry-and-captures object, or use a full engine function. A closure stored in a field need not exist until read as a value. Slim closures gain normal property storage on demand while preserving identity. Captured values can be copied; changing variables use shared environments, storage shared by closures. A module environment proved to exist once can become variables belonging to each runtime instance. These representations avoid allocation while preserving shared mutable state. [internals.mdx, L1549–1573][source-085]; [captures/values.rs, L69–117][source-086]; [AOTClosure.cpp, L914–949][source-087]; [AOTEnvironments.cpp, L182–218][source-088].

**Docs.** Allocation removal has two stages. First, local objects can dissolve into individual values, with a real object created only on paths that need it. Remaining objects that cannot outlive the call can live in its machine frame, the call's stack storage. A capture-free function created once can also share one lazily created cell per runtime instance; a function used only by direct calls needs none. [internals.mdx, L1555–1573][source-089].

**Code and docs.** Direct entries can pass raw numbers and return values in registers, the CPU's working storage; general function-value entries accept tagged JavaScript values. Adapters translate between compiled and engine calling conventions, the rules for passing arguments and results. Compiled closures advertise a compiled entry to JavaScriptCore, while compiled callers can enter interpreted or native targets through engine call data. The same objects cross this boundary. [internals.mdx, L1639–1652][source-090]; [AOTClosure.cpp, L149–166][source-091]; [AOTCallOperations.cpp, L313–342][source-092], [L879–927][source-093].

**nts today — docs.** nts already has direct/small-set/table dispatch, closure-specific clones, typed and tagged closure entries, copied immutable captures, shared mutable cells and frame placement for nonescaping closures. Captured loop-written per-iteration variables remain refused. Propagating class sets through fields/returns and splitting call sites are unfinished. Its output has no interpreter. [objects.md, L107–121][source-094], [L185–208][source-095].

**Take it? Yes — inference:** base inlining on remaining specialized code and removable allocations; defer unobserved closures and finish class-flow propagation, building on nts's existing call representations.

## 6. What gets compiled, and the fallback

**Code.** Reachable JavaScript available at build time is compiled, inlined or eliminated. Unsupported reachable code produces a build error; it does not silently become interpreted code. Bun stops after checking/lowering errors, and the engine discards its output image if diagnostics remain ([compile.rs, 1350–1381][source-096]; [AOTCompile.cpp, 360–420][source-097]). Application checker errors and incomplete lowering therefore matter before machine-code generation. Dependency type problems have a separate path: diagnostics that withdraw trust can become warnings and those files still compile without their types ([package_diagnostics.rs, 32–67][source-098]; [diagnostic_codes.rs, 34–35][source-099]).

**Code + Docs.** When an image runs, JIT compilation is disabled. Runtime-generated source from `eval`, `new Function`, `node:vm` and string Workers can run in LLInt, JavaScriptCore's low-level interpreter. Its AOT-specific handlers understand compiled objects and omit JIT value profiling. Adapters translate the calling convention so interpreted and compiled functions share values and call one another ([Options.cpp, 805–819][source-100]; [LowLevelInterpreterAOT.asm, 4–13][source-101]; [internals, 1827–1837][source-102]). An ordinary unexpected input to a compiled function does not imply this interpreter route.

**Code.** Some constant source is compiled too. Bun creates source files for recognized constant Function/eval text, then checks that the required environment is sufficiently known. Lowering tests the callee's builtin identity before creating or calling the compiled closure; an alternative callee keeps an ordinary call. Eligibility tests explicitly reject some constant texts, so “constant” alone is insufficient ([evaluated_texts.rs, 35–80][source-103], [647–672][source-104]; [evaluated_text.rs, 33–73][source-105]).

**Code.** Validation instrumentation counts interpreter use and can reject unexpected execution of static source, with explicit exceptions for some implicit constructors and other-realm builtin text. This is a compiler testing aid rather than an unconditional production restriction ([AOTInterpreterSlowPaths.cpp, 42–60][source-106]).

**Docs.** Dynamic `import()`/`require()` of code outside the executable is refused by default; `--external` permits named packages, and `--aot-allow-code-from-disk` permits other runtime source through transpilation and interpretation. Native addons have a separate explicit route: `process.dlopen()` can load one from disk ([compatibility:1103–1105][source-195]). A hidden eval/Function call the compiler did not account for can throw `EvalError`. Imported Wasm is compiled, while other Wasm uses an interpreter; the docs acknowledge fallback even for compiled Wasm under unsuitable machine/memory conditions. Runtime-created regexps use a matcher that generates no executable code ([compatibility, 456–468][source-107], [729–798][source-108], [588–603][source-109]; [internals, 1835][source-102]).

**Code.** The reported addon limitation needs qualification. Ordinary Linux builds request a kernel prohibition on gaining execute permission after loading the image, but ignore failure; the non-Linux function here does nothing. Hardened builds enforce stronger controls. An addon that generates code can therefore fail where these restrictions apply, but the source does not establish an identical guarantee on every platform ([compiled_program.rs, 410–485][source-110], [622–664][source-111]).

**nts today — Docs.** nts permanently refuses runtime source and ships no parser, interpreter or JIT; compiling proven constant source remains a permitted future optimization ([boundaries, 44–57][source-112]).

**Take it? — Inference:** **Yes** to explicit compile-or-refuse behavior and checking that compilation never silently falls back; **no** to adding an interpreter, because nts deliberately excludes one.

## 7. Memory and the 48% claim

**Inference.** The implementation explains several possible savings, but cannot attribute the handoff's 48% to individual mechanisms. That percentage remains an author-reported workload result.

**Code + Docs.** Compiled execution removes running JIT compilation/profiling work. Its native frames do not require ordinary per-function `CodeBlock` objects; machine code and lookup metadata reside in the image. Read-only file-backed data can be shared, while string objects, classes and structures are materialized on use ([Options.cpp][source-100]; [internals, 1639–1652][source-090], [1723–1735][source-113]). This does not mean all bytecode or object shapes disappear: runtime source still needs interpretation and compiled layouts still acquire engine Structures.

**Code + Docs.** Many object-field references occupy four bytes. They encode positions within an eight-byte-aligned managed-heap reservation, allowing a 32-bit index to address 32 GB. References in registers, ordinary stack slots and general `JSValue` slots remain full pointers; large backing stores use separate allocation. Density gains therefore depend on the program's object mix ([MarkedBlockCage.h, 49–59][source-114]; [internals, 1774–1793][source-115]).

**Docs.** Bun retains JavaScriptCore's garbage collector: it identifies reachable objects, marks them and reclaims the rest. It is generational, mostly concurrent and non-moving, so references stay valid across collections. Conservative running-stack scanning treats pointer-like words as possible references. That simplifies native frames but can retain otherwise dead objects ([internals, 1759–1772][source-115]).

**Code.** The AOT runtime registers roots, references that keep objects reachable, from the virtual machine (VM) and program instance with that collector. Layout metadata tells visitors exactly where references occur inside compiled objects; reference stores perform write-barrier bookkeeping so collection notices new links. Suspended coroutine frames have precise maps of live reference slots, including handling for concurrent visitation ([AOTHeapHooks.cpp, 47–99][source-116]; [AOTObjectStorage.cpp, 150–169][source-117]; [AOTObjectVisiting.h, 48–149][source-118]; [AOTSavedFrame.h, 309–364][source-119]). Compiled objects therefore cooperate with JSC collection rather than occupying an unrelated native heap.

**Inference.** Shared file pages, private allocations and resident-set size (RSS: all resident memory pages counted for the process) should be measured separately. Sharing helps multi-process totals without removing a resident shared page from each process's RSS. The size guide itself says trimming changes file size without changing startup or memory use ([size, 35][source-120]).

**nts today — Docs.** Native nts uses reference counting plus cycle collection; managed targets use host GC. Frame placement and removal of unnecessary counts already exist. Its memory plan puts allocation measurements before allocator/header experiments ([architecture, 26–36][source-121]; [memory, 428–439][source-122]).

**Take it? — Inference:** **Yes** to density and lazy-metadata measurements; **later** to compressed references after nts's planned census, and **no** to replacing its collector on the strength of an unattributed percentage.

## 8. Startup and the 24% claim

**Code.** The image is prebuilt machine code and read-only metadata. Its 27 sections include function/address indexes, frame and reference maps, exception handlers, names, strings, layouts, module tables, regexp/Wasm information and dispatch tables. Loading checks format, runtime/CPU compatibility, bounds and memory protections before publishing it ([AOTImageFormat.h, 54–84][source-123]; [AOTImageLoading.cpp, 566–610][source-124]). These checks replace runtime compilation work; they do not restore an already-running application.

**Code.** On Linux, the loader can map the executable's code again at a randomized address, then remove execute permission from the original mapping. The code was already compiled to tolerate relocation: startup changes where it is mapped, without recompiling it ([AOTImageLoading.cpp, 450–505][source-125]).

**Code + Docs.** Each VM reserves its own mutable instance for module variables, caches and evaluation state, while the immutable image is shared. A name's prepared header and hash can be read from the image; a string object is created and cached only on first use. Classes and layout Structures are similarly deferred. Reserving address space is distinct from touching pages and making them resident ([AOTInstance.cpp, 418–513][source-126]; [AOTProgramIdentifiers.cpp, 66–80][source-127]; [AOTProgramStrings.cpp, 205–227][source-128]; [internals, 1723–1735][source-113]).

**Code.** The module graph is substantially precomputed: tables describe dependency requests, link plans and groups loaded together. Synchronous module initialization can become direct calls guarded by an already-evaluated flag. Module bodies still execute at runtime; the runtime explicitly calls compiled body functions ([AOTModuleGraph.h, 19–53][source-129]; [AOTCallModules.cpp, 570–587][source-130]; [AOTModuleEvaluation.cpp, 469–488][source-131]). **Docs** identify top-level await and associated cycles as cases needing the table-driven evaluation algorithm. They explicitly reject heap snapshots: apart from explicit build-time macros, the build does not execute the application to capture its heap ([internals, 1747–1757][source-113], [1971–1981][source-132]).

**Code.** Bun tests startup scaling by adding large numbers of unused declarations and bounding additional instructions, private memory and resident memory. However, the same test has TODO cases with documented growth beyond its allowance ([startup-scaling.ts, 101–140][source-133]). **Inference:** startup independent of unused program size is a tested design objective with remaining exceptions. It should not be stated as an unconditional property, and these tests do not reproduce the author's 24% preview result.

**nts today — Docs.** nts already has whole-program compilation, fixed layouts and runtime components linked where used. Its memory plan adds startup, executable-size and peak-RSS rows against Node and Bun; the docs do not establish a comparable lazy-startup invariant ([architecture, 21–48][source-121]; [memory, 430][source-122]).

**Take it? — Inference:** **Yes** to ready-to-read immutable descriptors, first-use materialization and tests that enlarge unused program code; these expose startup taxes without requiring a heap snapshot or a new execution model.

## 9. Size and the 2x claim

**Code + Docs.** Native application code adds executable bytes, including specializations, shared slow paths, stubs and tables for layouts, dispatch, strings, exceptions and suspended frames. Bun also retains function source for reflection unless requested otherwise ([AOTImageFormat.h, 54–84][source-123]; [size, 359–369][source-134]). Whether the whole executable grows depends on how much runtime machinery can be removed.

**Author report.** The pinned size guide's Linux x64 todo-server example is 140 MB for the JIT executable, 69 MB for AOT and 33 MB for trimmed AOT. These are the author's documentation measurements, not measurements made here. They show why the early “nearly 2×” claim cannot be treated as an unavoidable current property ([size, 12–37][source-120]).

**Code.** Bun tracks JIT, interpreter, builtin source, image compiler, Wasm and tooling as separate removable features. A compiled image can discard machinery even without full `--trim`. Runtime-text or disk-code requirements retain the interpreter; a program whose code is entirely known can remove it. Plans select eligible byte ranges and the executable rewriter removes file ranges and relocations where possible, filling holes where necessary ([engine.def, 1–20][source-135]; [decide.rs, 73–110][source-136], [582–614][source-137]; [plan.rs, 147–190][source-138]; [apply.rs, 35–79][source-139]).

**Code.** Runtime JIT disabling and absence of all JIT implementation bytes are different properties. A program using `Bun.build` can retain checker/AOT/image-compiler/JIT features unless trimmed; the source tests that exception ([decide.rs, 43–49][source-136], [709–728][source-140]). **Docs:** disallowing runtime string compilation can enable interpreter removal, but changes permitted behavior. The size report also explains why features remain and distinguishes actual file savings from bytes merely overwritten ([size, 235–264][source-141], [371–395][source-134]).

**Docs.** A library that catches failure to create a function can select an ordinary compiled implementation. The compatibility guide documents this for zod 4, including its `jitless` option. That changes which implementation executes; any throughput benefit should be measured separately from file-size reduction ([compatibility, 504–530][source-142]).

**nts today — Docs.** nts already uses per-function/data sections and linker dead stripping, which omit unreachable runtime pieces, plus ThinLTO to optimize across program/runtime compilation units. Its architecture links runtime components only where used ([numbers, 183–198][source-143]; [architecture, 42–48][source-121]).

**Take it? — Inference:** **Yes** to reports explaining retained runtime, specialization and metadata bytes, with later code-size budgets if measurements justify them; **no** to Bun's whole-executable byte-removal machinery, because nts already has an appropriate native-linking strategy.

## 10. Exceptions, async functions and generators

### Exceptions

**Code.** Bun records which machine-code locations have exception handlers. When a throw crosses calls, its unwinder follows return addresses, finds the appropriate handler and restores registers that callers expect to retain. It also understands generator completion, async rejection and adapters into engine frames. Crossing that boundary can continue through the engine's ordinary unwinder; a JavaScript exception is not a reason to interpret the compiled function ([AOTUnwinding.cpp, 179–229][source-144], [246–314][source-145]).

**Code + Docs.** Code generation records handler entry points and register information, while a locally known throw can jump directly to its handler. The docs describe compiled-to-compiled calls without an exception-result test on the normal path. Source-position and inlining tables support stack traces that retain logical TypeScript frames after optimization ([AOTExceptionEmitter.cpp, 178–239][source-146], [387–455][source-147]; [internals, 1795–1805][source-148]). This is custom image-table unwinding, not simply an assertion that ordinary C++ exception handling does the work.

### Async functions and generators

**Code.** A coroutine is a function that can suspend. Bun splits it into an entry that creates the public promise/generator and a body that runs ordinary native code. An async function proved not to suspend becomes an ordinary worker returning through a promise ([AOTCoroutines.cpp, 986–1080][source-149]). At a real suspension, stubs copy live machine-frame words and a resume address into a GC-managed `SavedFrame`. Resumption copies them back to the stack and jumps to that address; rejected awaits enter the exception route. Reference maps let the collector find pointers within the suspended frame ([AOTStubsCoroutineSuspension.cpp, 248–320][source-150]; [AOTStubsCoroutineResumption.cpp, 432–591][source-151]; [AOTSavedFrame.h, 309–364][source-119]).

**Inference.** This allows ordinary execution to retain unboxed locals in registers and stack slots, paying the copy cost at suspension. It differs from placing every across-await local permanently in a heap state-machine object, though it still represents resumable control state.

**Code.** Saved-frame maps also distinguish live references from numeric words and clear dead words after collection visits. Suspension therefore has a specific memory-lifetime contract, not just a byte-copy operation ([AOTSavedFrame.h, 309–364][source-119]).

**Code.** More transferable optimizations eliminate intermediate promises and, in eligible generator loops, suspension machinery. A known immediately awaited async call can enter a body without an intermediate promise. Generator-loop fusion combines a known producer and consumer, replacing yields with control-flow transfers while preserving exception routing. It declines when instances may escape, steps may reach another generator, or code-size/depth budgets are exceeded ([AOTCoroutines.cpp, 1485–1510][source-152], [1646–1674][source-153]; [AOTFuseGeneratorLoops.cpp, 467–541][source-154], [812–857][source-155]).

**nts today — Docs.** Local throws already jump; throws across calls use raising copies and caller tests, allowing reference-count cleanup on returns. Indirect-call gaps have a decided raising-flag fix. Async functions use heap-frame state machines. Generator loops already allocate nothing per element, but iterator closing and several two-way/async-generator operations remain incomplete ([errors, 29–39][source-156], [80–100][source-157]; [async, 49–89][source-158]).

**Take it? — Inference:** **Yes** to proof-driven promise elimination and generator fusion in the shared high-level IR, preserving the order of queued microtask callbacks, cleanup and iterator closing; **later** to native frame copying or table unwinding, whose target-specific conventions and reference-count cleanup must justify their cost across C, LLVM and JVM.

## 11. Builtins, strings, arrays, typed arrays and JSON

**Code and docs.** Bun describes builtin argument types, results, effects, callbacks and retention in one machine-readable table. Effects specify what a call reads or changes; retention specifies whether it keeps an argument after returning. A normal-array `push` has a narrower contract than arbitrary array-like objects that might invoke setters. Callback rows connect array elements to callback parameters and results to destination elements. Compiling callback-based array routines makes their loops and callbacks available for inlining. [array.builtins.ts, L360–382][source-159]; [array-callbacks.builtins.ts, L16–59][source-160]; [internals.mdx, L1133–1183][source-161].

**Docs.** Specialization first establishes the callee's identity. For `list.push`, Bun needs to know that the array has no overriding property, its prototype still leads to the standard method, and its storage is ordinary. These “pristine” facts describe unmodified behavior and come from proof or explicit checks. An annotation alone does not authorize substituting a builtin instruction for an arbitrary method. [internals.mdx, L1139–1155][source-162].

**Code and docs.** The same contracts permit borrowed spans: a pointer and length valid during a call. A temporary `subarray` can disappear when its consumer only needs bytes. The compiler retains the owner, obtains usable characters before exposing a string pointer, and rechecks view bounds at the call because a buffer might have detached. Retaining or asynchronous consumers keep receiving the object. Generated whole-view and range forms share one declaration and native implementation. A small native result can also return its fields in registers: an object is created only if subsequent code needs to keep the object itself. [forms-in-ranges.ts, L16–43][source-163], [L48–101][source-164]; [internals.mdx, L1192–1252][source-165].

**Code and docs.** Ordinary arrays and strings remain engine objects. Proven normal array storage permits direct elements. The inspected direct element-read path checks fixed-length, nonresizable storage and an in-bounds index, or consumes equivalent earlier proofs; other reads use helper paths. Floating-point bytes remain potentially arbitrary NaN representations. Strings expose characters, length and Latin-1/UTF-16 width; nonflat strings use a rope handler, which obtains characters from their concatenation tree. [internals.mdx, L1575–1579][source-166]; [AOTElementAccessEmitterTypedArrays.cpp, L51–77][source-167], [L115–164][source-168]; [AOTStringEmitter.cpp, L66–106][source-169], [L118–159][source-170].

**Code and docs.** Ordinary global `JSON.parse` without a callable reviver (the optional callback that transforms parsed values) can receive an expected-result plan from annotations, casts or surrounding calls. The generated parser constructs compiled layouts directly. When a result fails the plan, both rejected and unknown outcomes return to the original ordinary parse with its expected-result hint cleared. Thus a mismatching `JSON.parse(text) as T` does not itself throw a type error. Matching text receives faster storage and passes subsequent layout guards. [json.builtins.ts, L11–40][source-171]; [AOTSelectTypedResults.cpp, L393–430][source-172]; [types.mdx, L287–299][source-173].

**Code.** Direct construction preserves optional-field absence and duplicate-key rules: the last value wins while enumeration retains the first key's position. Unknown keys can use extra properties. Specialized serialization checks layouts and `toJSON` eligibility and retains generic handling. [AOTJSONParser.cpp, L641–735][source-174], [L785–793][source-175]; [AOTJSONSerializer.cpp, L201–208][source-176], [L891–918][source-177].

**PR claim, unconfirmed here.** The PR advertises separate checked APIs: `JSON` imported from `"bun"` with `parse<T>`, and `validate<T>` from `"bun:bundle"`. Their implementation was not located at these pins. They must remain separate from the code-confirmed global parse optimization above ([frozen merge description][source-002]).

**Docs.** Some builtin specialization relies on locked intrinsic members. Attempted replacement, redefinition or deletion can produce build diagnostics or runtime `TypeError`. Mutable facilities such as `console`, `process` and `fetch` instead rely on analysis. This is a compatibility restriction with a performance purpose. [internals.mdx, L1254–1268][source-178].

**nts today — docs.** nts generates typed `JSON.stringify`; global `JSON.parse` is unavailable. Its planned direct-layout parser throws a path-bearing `TypeError` on mismatch, preserving syntax-error precedence. Strings already support Latin-1/UTF-16, writing directly into the final output string and uniquely owned in-place append; uniform character pointers and slices are planned, while ropes require benchmark evidence. Native arrays/views and bounds checks exist, with documented unfinished ordinary-array hole and out-of-range semantics. [json.md, L6–60][source-179]; [strings.md, L6–37][source-180], [L88–98][source-181]; [objects.md, L124–183][source-182].

**Take it? Yes — inference:** prioritize shared builtin contracts, borrowed spans and direct-layout JSON construction; preserve nts's mismatch contract, and require separate evidence before adopting locks or rope storage.

## 12. Where it loses

**Author report.** The PR's frozen description reports warm throughput below the same Bun build's JIT for Express (7.1%), Elysia (13.5%), Fastify (16.9%) and Koa (22.9%). That experiment used Linux x64, an AMD EPYC 9R14, one core per server, a separate load-generator core, 64 connections and seven starts, on 2026-10-24. It also reports median AOT/JIT instruction ratios of 0.94 for isolated idioms and 1.44 when compiled under its large-program conditions. These are the author's experiments, not results reproduced here ([PR #45631 at its merge commit][source-002]).

**Code-based inference.** The mechanisms below explain plausible reasons for losses; they are not profiles proving how much each mechanism cost a particular framework. The instruction ratios above count work, not elapsed time: 1.44 means 44% more instructions, not an established 44% slowdown.

| Workload | Mechanism and evidence | What nts needs |
|---|---|---|
| Untyped frameworks and objects made by old constructor/helper patterns | The compiler cannot always prove which object or callee arrives, so it performs a property lookup or dynamic call. A JIT can observe a recurring case and specialize it. A static type declaration alone does not solve an unknown writer or escape. | Follow actual allocation sites, aliases and callback targets across the whole program; retain an honest dynamic operation when proof ends. See sections 2, 4 and 5. |
| Validators and serializers made with runtime `new Function` | That new source is interpreted and never becomes JIT code. This is a permanent execution cost in Bun's AOT mode, not a warmup interval. See section 6. | Preserve nts's runtime-code boundary and generate parsers/validators during compilation. See section 11. |
| Integer-looking arithmetic on unknown array elements | The addition can still need JavaScript conversion, including string concatenation; a later truncation does not prove the operands were integers. See section 3. | Prove the container's contents over every writer, the numeric range and the relevant truncation demand. |
| Functions inside a large application | Code-size budgets and source-derived heat determine which paths inline, get site caches or use shared helpers. An isolated loop can give the compiler a much easier problem than the same function called indirectly in an application. | Measure the actual calling context and total code size, not only a tiny loop. |

**Code.** Bun explicitly models hot, warm, cold and once-only code, with limits on how much code gets the expansive fast forms ([W: AOTHeat.h:37–122][source-183]). Its performance harness has separate small, called and large-program modes; the last mode constrains the warm-code budget, and it compares the worse of typed and type-erased AOT forms with the same executable's JIT ([B: measure-idioms.ts:22–47][source-184]). Its stored loss list includes [closure-built properties:59–63][source-185], [runtime-generated validation:152–156][source-186], [JSON:248–253][source-187] and [arithmetic:446–449][source-188] in `test/aot/perf/behind-the-jit.linux-x64.json`. This is a record of acknowledged losses, not a fresh performance certificate.

**Inference.** Value-flow precision can remove many guard and lookup costs, but it cannot establish how often an arbitrary input will take each branch. The two problems need different evidence. More facts can justify a direct load; deciding whether a large inline expansion is worth its instruction-cache footprint still needs representative workloads. Bun's own measurement guidance makes wall-clock behavior decisive and warns that fewer instructions with more code can lose ([B: perf/README.md:109–116, 137–151][source-189]).

**nts today — docs and handoff.** The foundation contract requires every benchmark row to beat node and Bun and requires compiler proofs for unchecked operations ([N: foundations/README.md:14–39][source-190]). The handoff states that the existing competitor is Bun's JIT, not its AOT output. The numeric and memory plans already identify the missing all-writer summaries that would resolve some of these cases; this study proposes no benchmark or compiler edits.

**Take it? Yes — add Bun AOT as its own future benchmark column and adopt the realistic calling-context comparison; use each loss to name the missing proof or remaining runtime work.**

For that follow-up, record a matched Bun frontend/engine revision, target CPU and OS, compiler options, whether trimming or dynamic code is enabled, and build success or refusal for every row. Measure cold process startup, warm work, peak and retained memory, executable size and build cost separately. Use the same inputs and checked outputs; compare AOT with the same Bun build's JIT to avoid attributing unrelated runtime improvements to AOT. Instruction counts help diagnose a result; maintainers' wall-clock measurements on the benchmark machine decide it. Any off-machine measurements remain indicative.

## Comparison table

This table condenses the evidence above. “Today” follows the pinned nts documentation; designs explicitly marked as unbuilt remain unbuilt in this comparison.

| Topic | Bun AOT | nts today | Take it? |
|---|---|---|---|
| 1. Types and soundness | Expected types, proven facts and guards are distinct; mismatch normally selects compiled generic work. | Runtime representation needs proof; erased primitive/class casts deliberately check, with incomplete exception transport. | **Yes:** proof reasons and independent validation. **No:** trusting declarations or changing the checked-cast contract. |
| 2. Speculation without a profile | Whole-program value flow, static frequency estimates and precompiled alternatives. | Numeric flow and guarded external-entry clones; the shared alias/effect/content analysis is decided, not built. | **Yes:** shared conservative facts and explicit invalidation. **Later:** large generic continuations where measured benefit pays for them. |
| 3. Numbers | Proven integer representations coexist with guarded int32 paths; widening and floating-point paths preserve results. | Double by default; integrality, range, NaN and observable minus-zero obligations; repeated speculative addend checks rejected. | **Yes:** review and validate the numeric proof obligations. **No:** adopting per-operation speculation by default. |
| 4. Objects and properties | Fixed compiled layouts, exceptional fields in side storage, data-only property caches. | Fixed structs, direct proved accesses and interface dispatch; general runtime-key member tables are deferred. | **Later:** prebuilt name lookup and side storage for supported dynamic behavior; keep proved static accesses cheap. |
| 5. Calls and closures | Known-target calls and tables, specialization-aware inlining, deferred/slim/full closures, interpreter adapters. | Direct/small-set/table dispatch, typed/tagged closure entries, shared mutable captures; some flow extensions planned. | **Yes:** actual-callee flow, residual-size inlining and avoiding unnecessary closure objects. |
| 6. Compilation and fallback | Build-known JavaScript compiles or fails; permitted runtime source is interpreted; some constant source compiles. | No engine; runtime source permanently refused. | **No:** interpreter inclusion. **Yes:** clear diagnostics and checks that enforce the intended execution boundary. |
| 7. Memory | JSC collector, dense fields, compressed field references, shared and lazy metadata. | Native reference counting plus cycle collection; host GC on JVM; borrowing and frame placement already built. | **Yes:** measure density and metadata cost. **Later:** pointer compression. **No:** a collector change justified by the preview percentage. |
| 8. Startup and image | Code and descriptions are prebuilt; module bodies run at startup/use; mutable state is lazy. | Whole-program compilation, static layouts and selective runtime linking; startup/RSS rows planned. | **Yes:** demand-driven metadata and startup tests that add unused program size. |
| 9. Binary size | Native variants and tables add bytes; feature reachability can remove compiler, interpreter and API bytes. | Per-function/data sections, dead stripping and ThinLTO. | **Yes:** explanations of retained bytes and measured specialization budgets. **No:** copying Bun's executable surgery. |
| 10. Exceptions, async and generators | Handler tables/custom unwinding; native frames saved at suspension; known-await and generator-loop elimination. | Local jumps, raising copies, heap-frame async state machines; indirect-throw and generator protocol gaps documented. | **Yes:** portable promise/dispatch elimination with full semantics. **Later:** native unwinding or frame copying. |
| 11. Builtins, strings, arrays and JSON | Shared type/effect contracts, borrowed spans, checked views, opportunistic typed JSON construction. | Typed storage and string optimizations; generated stringify; typed parse with explicit mismatch errors is planned. | **Yes:** contracts and direct parsing into layouts, preserving nts's chosen validation and string semantics. |
| 12. Losses and measurement | Generic property work, interpreted generated code, unknown values and static optimization budgets can lose to JIT. | Bun JIT is the measured competitor; proof and every-row performance obligations already exist. | **Yes:** add a separate Bun AOT comparison and realistic calling contexts; diagnose the missing proof or unavoidable work. |

## Sources and verification

The source revisions are listed near the beginning; every implementation and documentation reference in this notebook is pinned to one of them. The entry points are:

- **nts:** [README.md:1–36][source-191] and [architecture.md:6–45][source-008], followed by the language and foundation pages cited in each section. The unavailable integral-arithmetic notebook is a stated limitation, not an inferred source.
- **Bun feature:** PR #45631, “Compile TypeScript to machine code ahead of time: `bun build --compile --aot`,” using the description preserved in its [merge commit][source-002]; [compiler/aot.mdx:1–23][source-003] and [compiler/internals.mdx:72–116][source-004] at that same revision. The public preview percentages supplied in the handoff are not independent evidence.
- **Compiler implementation:** [WebKit aot/README.md:1–8][source-192], then the analysis, value-flow, representation, object, IR, passes, selection, code generation, placement, image, runtime, stubs and builtin sources identified alongside the claims.
- **Contribution scope:** the [cloud-agent PR workflow][source-193], with the handoff's explicit exception authorizing this one research notebook.

**Verification performed:** read the cited source and test implementations; check that reference paths and line ranges exist in the pinned snapshots; check the notebook's internal links and section coverage. The test descriptions report inspected test source only. No Bun/nts build, executable test, benchmark or memory profile was performed. The notebook contains original explanation and recommendations, without copied Bun or WebKit code. Its recommendations do not change nts's design contracts.

[source-001]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/scripts/build/deps/webkit.ts#L1-L6
[source-002]: https://github.com/oven-sh/bun/commit/8d5672c5529049f1a9a3453d07e6cd6a1564abc7
[source-003]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/aot.mdx#L1-L23
[source-004]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L72-L116
[source-005]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/compile.rs#L1350-L1450
[source-006]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/jsc/bindings/BunAOTCompile.cpp#L403-L423
[source-007]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/pipeline/AOTPipeline.cpp#L1854-L1942
[source-008]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/architecture.md#L6-L45
[source-009]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTTypeKinds.h#L21-L40
[source-010]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTTypeKinds.h#L81-L123
[source-011]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTDeclaredType.h#L42-L77
[source-012]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTAddGenericVersion.cpp#L884-L937
[source-013]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTAddGenericVersion.cpp#L1932-L1945
[source-014]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTEntryChecks.cpp#L579-L628
[source-015]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTAddGenericVersion.cpp#L2108-L2141
[source-016]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L596-L610
[source-017]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/lower/convert/edges.rs#L137-L205
[source-018]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/lower/convert/calls.rs#L134-L185
[source-019]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/values-against-their-types/method-bivariance.ts#L1-L6
[source-020]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/values-against-their-types/covariant-array.ts#L1-L7
[source-021]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/types.mdx#L386-L389
[source-022]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L632-L645
[source-023]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1314-L1346
[source-024]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/lower/convert/edges.rs#L180-L200
[source-025]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTVerifierProofs.cpp#L322-L345
[source-026]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTRuntimeValidationChecks.cpp#L143-L155
[source-027]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTRuntimeValidationChecks.cpp#L186-L211
[source-028]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1922-L1924
[source-029]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTClaimChecks.cpp#L241-L252
[source-030]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/tests/AOTProofValidationTests.cpp#L631-L706
[source-031]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/README.md#L155-L159
[source-032]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/language/types.md#L82-L108
[source-033]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/language/types.md#L193-L204
[source-034]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1280-L1312
[source-035]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/valueflow/AOTValueFlowSolver.cpp#L6219-L6267
[source-036]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/valueflow/AOTValueFlowSolver.cpp#L6304-L6333
[source-037]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTHeat.cpp#L167-L195
[source-038]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTHeat.cpp#L306-L343
[source-039]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTHeat.cpp#L634-L657
[source-040]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTEntryChecks.cpp#L655-L676
[source-041]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTSchema.def#L32-L41
[source-042]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/analysis/AOTGuardAvailability.cpp#L42-L44
[source-043]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/analysis/AOTGuardAvailability.cpp#L99-L128
[source-044]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/analysis/AOTGenericCopy.cpp#L645-L705
[source-045]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/numbers.md#L24-L77
[source-046]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/memory.md#L3-L5
[source-047]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/memory.md#L156-L192
[source-048]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/represent/AOTRepresentationRules.cpp#L73-L86
[source-049]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTResultRulesNatural.cpp#L75-L113
[source-050]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTResultRulesNatural.cpp#L193-L264
[source-051]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/select/AOTNumberPathRules.cpp#L64-L103
[source-052]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/select/AOTNumberPathRules.cpp#L250-L267
[source-053]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/select/AOTNumberPathRules.cpp#L322-L350
[source-054]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTCheckInt32Promises.cpp#L100-L126
[source-055]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTInt32Proof.cpp#L40-L50
[source-056]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTInt32Proof.cpp#L278-L298
[source-057]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/types.mdx#L353-L392
[source-058]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/select/AOTArithmeticForms.cpp#L13-L30
[source-059]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTOperatorEmitterArithmetic.cpp#L99-L140
[source-060]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTOperatorEmitterArithmetic.cpp#L525-L551
[source-061]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTPrimitives.h#L49-L79
[source-062]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTResultRulesNatural.cpp#L75-L100
[source-063]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/numbers.md#L55-L63
[source-064]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTResultRulesNatural.cpp#L86-L113
[source-065]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/ir/AOTResultRulesNatural.cpp#L193-L204
[source-066]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTTypeTestEmitter.cpp#L572-L604
[source-067]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTOperatorEmitterArithmetic.cpp#L289-L336
[source-068]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/numbers.md#L24-L90
[source-069]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTCellFormat.h#L26-L85
[source-070]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1424-L1477
[source-071]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTObjectMethodTable.cpp#L59-L79
[source-072]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTObjectMethodTable.cpp#L969-L1003
[source-073]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1479-L1515
[source-074]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/types.mdx#L234-L299
[source-075]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/stubs/AOTStubsPropertySiteCaches.cpp#L140-L204
[source-076]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1517-L1532
[source-077]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1581-L1600
[source-078]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/objects.md#L28-L98
[source-079]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/objects.md#L224-L228
[source-080]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTResolveCalls.cpp#L3122-L3186
[source-081]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTMemberGuards.cpp#L340-L399
[source-082]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1534-L1547
[source-083]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTInlining.cpp#L2294-L2359
[source-084]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTInlining.cpp#L2373-L2419
[source-085]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1549-L1573
[source-086]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/lower/captures/values.rs#L69-L117
[source-087]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTClosure.cpp#L914-L949
[source-088]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTEnvironments.cpp#L182-L218
[source-089]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1555-L1573
[source-090]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1639-L1652
[source-091]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTClosure.cpp#L149-L166
[source-092]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTCallOperations.cpp#L313-L342
[source-093]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTCallOperations.cpp#L879-L927
[source-094]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/objects.md#L107-L121
[source-095]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/objects.md#L185-L208
[source-096]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/compile.rs#L1350-L1381
[source-097]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/image/AOTCompile.cpp#L360-L420
[source-098]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/package_diagnostics.rs#L32-L67
[source-099]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/diagnostic_codes.rs#L34-L35
[source-100]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/runtime/Options.cpp#L805-L819
[source-101]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/llint/LowLevelInterpreterAOT.asm#L4-L13
[source-102]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1827-L1837
[source-103]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/load/evaluated_texts.rs#L35-L80
[source-104]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/load/evaluated_texts.rs#L647-L672
[source-105]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/aot/lower/call/evaluated_text.rs#L33-L73
[source-106]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTInterpreterSlowPaths.cpp#L42-L60
[source-107]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/compatibility.mdx#L436-L468
[source-108]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/compatibility.mdx#L729-L798
[source-109]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/compatibility.mdx#L588-L603
[source-110]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/jsc/compiled_program.rs#L410-L485
[source-111]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/jsc/compiled_program.rs#L622-L664
[source-112]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/language/boundaries.md#L44-L57
[source-113]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1706-L1757
[source-114]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/heap/MarkedBlockCage.h#L49-L59
[source-115]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1759-L1793
[source-116]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTHeapHooks.cpp#L47-L99
[source-117]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTObjectStorage.cpp#L150-L169
[source-118]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/object/AOTObjectVisiting.h#L48-L149
[source-119]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTSavedFrame.h#L309-L364
[source-120]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/size.mdx#L12-L37
[source-121]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/architecture.md#L21-L48
[source-122]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/memory.md#L428-L439
[source-123]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/image/AOTImageFormat.h#L54-L84
[source-124]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/image/AOTImageLoading.cpp#L566-L610
[source-125]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/image/AOTImageLoading.cpp#L450-L505
[source-126]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTInstance.cpp#L418-L513
[source-127]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTProgramIdentifiers.cpp#L66-L80
[source-128]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTProgramStrings.cpp#L205-L227
[source-129]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTModuleGraph.h#L19-L53
[source-130]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTCallModules.cpp#L570-L587
[source-131]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTModuleEvaluation.cpp#L469-L488
[source-132]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1971-L1981
[source-133]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/startup-scaling/startup-scaling.ts#L101-L140
[source-134]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/size.mdx#L359-L395
[source-135]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/trim/features/engine.def#L1-L20
[source-136]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/trim/decide.rs#L11-L110
[source-137]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/trim/decide.rs#L582-L614
[source-138]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/trim/plan.rs#L147-L190
[source-139]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/trim/apply.rs#L35-L79
[source-140]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/src/trim/decide.rs#L709-L728
[source-141]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/size.mdx#L235-L264
[source-142]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/compatibility.mdx#L504-L530
[source-143]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/numbers.md#L183-L198
[source-144]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTUnwinding.cpp#L179-L229
[source-145]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/runtime/AOTUnwinding.cpp#L246-L314
[source-146]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTExceptionEmitter.cpp#L178-L239
[source-147]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTExceptionEmitter.cpp#L387-L455
[source-148]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1795-L1805
[source-149]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTCoroutines.cpp#L986-L1080
[source-150]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/stubs/AOTStubsCoroutineSuspension.cpp#L248-L320
[source-151]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/stubs/AOTStubsCoroutineResumption.cpp#L432-L591
[source-152]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTCoroutines.cpp#L1485-L1510
[source-153]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTCoroutines.cpp#L1646-L1674
[source-154]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTFuseGeneratorLoops.cpp#L467-L541
[source-155]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTFuseGeneratorLoops.cpp#L812-L857
[source-156]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/language/errors.md#L29-L39
[source-157]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/language/errors.md#L80-L100
[source-158]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/language/async.md#L49-L89
[source-159]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/builtins/array.builtins.ts#L360-L382
[source-160]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/builtins/array-callbacks.builtins.ts#L16-L59
[source-161]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1133-L1183
[source-162]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1139-L1155
[source-163]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/builtins/generator/forms-in-ranges.ts#L16-L43
[source-164]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/builtins/generator/forms-in-ranges.ts#L48-L101
[source-165]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1192-L1252
[source-166]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1575-L1579
[source-167]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTElementAccessEmitterTypedArrays.cpp#L51-L77
[source-168]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTElementAccessEmitterTypedArrays.cpp#L115-L164
[source-169]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTStringEmitter.cpp#L66-L106
[source-170]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/codegen/AOTStringEmitter.cpp#L118-L159
[source-171]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/builtins/json.builtins.ts#L11-L40
[source-172]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTSelectTypedResults.cpp#L393-L430
[source-173]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/types.mdx#L287-L299
[source-174]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTJSONParser.cpp#L641-L735
[source-175]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTJSONParser.cpp#L785-L793
[source-176]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTJSONSerializer.cpp#L201-L208
[source-177]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTJSONSerializer.cpp#L891-L918
[source-178]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/internals.mdx#L1254-L1268
[source-179]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/json.md#L6-L60
[source-180]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/strings.md#L6-L37
[source-181]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/strings.md#L88-L98
[source-182]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/objects.md#L124-L183
[source-183]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/passes/AOTHeat.h#L37-L122
[source-184]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/perf/measure-idioms.ts#L22-L47
[source-185]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/perf/behind-the-jit.linux-x64.json#L59-L63
[source-186]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/perf/behind-the-jit.linux-x64.json#L152-L156
[source-187]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/perf/behind-the-jit.linux-x64.json#L248-L253
[source-188]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/perf/behind-the-jit.linux-x64.json#L446-L449
[source-189]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/perf/README.md#L109-L151
[source-190]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/foundations/README.md#L14-L39
[source-191]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/README.md#L1-L36
[source-192]: https://github.com/oven-sh/WebKit/blob/c3131ea84f7eaad531619e3842bb30c48df18ab1/Source/JavaScriptCore/aot/README.md#L1-L8
[source-193]: https://github.com/AkisArou/nts/blob/b698106e055c5a612408860a4a562e031d2c3782/docs/contributing/cloud-agents.md#L123-L149
[source-194]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/test/aot/README.md#L139-L153
[source-195]: https://github.com/oven-sh/bun/blob/8d5672c5529049f1a9a3453d07e6cd6a1564abc7/docs/compiler/compatibility.mdx#L1103-L1105
