# What nts can learn from ScriptC

## Summary: the ideas worth taking

**Inference.** ScriptC is a useful comparison for nts because its native path combines typed layouts, ownership analysis, reference counting and LLVM compilation. Its most transferable ideas remove work after establishing what values and references can actually reach an operation. The important compatibility qualification is that **current ScriptC can automatically put refused npm dependencies into embedded Node**. Its native dynamic values and its Node-backed modules are different execution paths. A fair engine-free comparison must disable automatic islands and exclude explicit Node bridges; see [§6](#6-what-gets-compiled-and-the-fallback).

These priorities rank applicability to nts, not measured speedups. Several reinforce designs nts has already chosen; the useful contribution is their concrete guards, invalidation rules and failure behavior.

1. **Yes — make actual arrivals and every writer the authority for representation.** Checked native boundaries, dependent-fact invalidation and diagnostics that name failed compiler inferences directly address nts's documented gaps; [§1](#1-types-and-soundness), [§3](#3-numbers).
2. **Yes — select bounded loop versions with one entry predicate.** This closely matches nts's integral-region design and keeps repeated checks out of arithmetic, while nts retains its own rounding and machine-width certificates; [§2](#2-speculation-without-a-profile), [§3](#3-numbers).
3. **Yes — implement checked JSON parsing directly into the final layout.** ScriptC demonstrates a concrete fast parser with the ordinary parse-and-check route as its semantic fallback; adapt it to nts's declared validation contract; [§11](#11-builtins-strings-arrays-typed-arrays-and-json).
4. **Yes — represent array presence and incompatible stores explicitly.** Runtime-maintained filled-prefix evidence can make reads cheap without treating `number[]` as a guarantee against holes or wider writes; [§11](#11-builtins-strings-arrays-typed-arrays-and-json).
5. **Yes — complete iterator closing and generator completion state.** Early exit, `return`, `throw` and `finally` are correctness obligations before generator benchmark improvements can count; [§10](#10-exceptions-async-functions-and-generators).
6. **Yes — refine closure specialization and ownership costs.** Global growth budgets, actual-target guards, delayed capture boxes and borrowed indirect entries complement mechanisms nts already has; [§5](#5-calls-and-closures).
7. **Yes — make arena lifetime checks and disposal auditable.** Explicit checks against pointers surviving recycled storage, outside-reference cleanup and sanitizer-visible disposal help nts fix its existing region-analysis gaps; [§7](#7-memory-ownership-and-collection).
8. **Yes — eliminate temporary string slices when their uses permit it.** Preserve the source and bounds through alias/effect checks, while keeping nts's Latin-1/UTF-16 storage; [§11](#11-builtins-strings-arrays-typed-arrays-and-json).
9. **Yes — connect reachability, runtime selection and initialization.** Avoid retaining dependency trees through unused registries, and use the same feature decisions to choose linked units and startup hooks; [§8](#8-startup-module-initialization-and-images), [§9](#9-binary-size-and-linking).
10. **Later — add optional offline profile-guided optimization.** Earlier runs can guide layout and inlining without a JIT, but profile training, build cost and ordinary unprofiled performance need separate measurement; [§2](#2-speculation-without-a-profile), [§12](#12-where-it-loses-and-how-to-compare-it).

**Do not adopt as an optimization shortcut:** automatic engine fallback for nts, observable record copying, or unchecked assumptions from TypeScript declarations. Selective dynamic caches, record views, generational collection and native unwinding merit later investigation when a supported workload needs them; their reasons appear below.

## Scope, revisions and evidence

This studies ScriptC at the revision below, including its current native compiler and engine bridge. The requested comparison is research only: no compiler changes, new tests or benchmark measurements.

| Source | Commit read | Scope |
|---|---|---|
| ScriptC | `b260a13dda56df0311c823e07ee2ca9a8a048166` | Current compiler, native runtime, LLVM helper, documentation and test sources; commit dated 2026-10-29. |
| nts | `01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5` | README, architecture, types and language boundaries, foundations, errors/async, integral-arithmetic design and cloud-agent workflow. |

**Code** labels an implementation or inspected test. **Docs** labels a documented contract. **Author report** labels a measurement claimed in upstream documentation or comments, not a result reproduced here. **Inference** labels this report's explanation or recommendation. Tests were read, not executed. The report distinguishes a policy or proposed design from shipped behavior; notably, nts's current [types Decisions section:195–217][source-001] still records unfinished literal checks, inappropriate use of declared literal types as facts, and incomplete collection representation policy.

Two distinctions govern the comparison. ScriptC's **native dynamic tier** compiles operations on values whose types are known only at runtime; it is still native code. A **Node island** runs selected modules through embedded Node and crosses a conversion or handle boundary. At this revision, executable preparation can automatically make refused npm packages islands, and policy defaults to `auto`. Some documentation lags that implementation. Section 6 follows the executing code, not the stale comment ([prepare.ts:56–71][source-002]; [284–304][source-003]; [policy.ts:65–105][source-004]).

A **representation** is a value's storage format. A **layout** describes possible fields and their positions. A **tagged value** carries a marker naming its runtime kind; an **unboxed value** stores its payload directly. A **guard** tests a condition at runtime. An **alias** is another reference to the same object. **Effects** describe what code can read, mutate, retain or call. **Reference counting**, abbreviated RC, tracks live references so an object can be freed when its count reaches zero. A **callee** is the function being called; a **calling convention** specifies how its arguments and results are passed. **int32** means a signed 32-bit integer. **NaN** is the floating-point marker for an invalid numeric result; **negative zero** is the distinct signed zero JavaScript can observe. A **sanitizer** instruments a build to detect memory or other execution errors. Ahead-of-time compilation (**AOT**) produces machine code before the program runs; a just-in-time compiler (**JIT**) generates it while the program runs.

## The pipeline, briefly

**Code + docs.** ScriptC has its own typed intermediate representation, or **IR**, a description of program operations between parsing and machine code. This IR still represents assignments, loops and nested statements; it should not be assumed to be nts's single-definition-per-value form merely because both compilers have typed IR ([ir.ts:2109–2163][source-005]).

1. **Load and check.** Resolve modules and declarations and use the TypeScript frontend through its `ts7` adapter. Shared orchestration performs preflight checks and lowering; executable preparation can reload the program after selecting Node islands.
2. **Lower and validate.** Produce explicit functions, layouts, captures and operations. Validate the IR and, when present, check declared native boundary contracts. Unhandled application failures remain build diagnostics.
3. **Analyze and emit LLVM IR.** Run program analyses for fields, integer slots, ownership, calls and other transformations; emit LLVM's low-level operations. The current code can emit large modules' functions on worker processes, so the older documentation's entirely serial emission description is not universal.
4. **Optimize and generate objects.** The LLVM 22 helper verifies and optimizes the module. Large builds can be partitioned: functions are split into compilation groups, with selected small callees imported for optimization. Optional profiles collected from earlier runs guide layout and inlining.
5. **Link.** Select the runtime components needed by the program, then link native objects and vendor libraries. A program using Node islands also needs their runtime support. Start the resulting program by executing native initialization and its entry point.

The frontend and validation path is [pipeline.ts:102–109][source-006] and [prepare.ts:123–131][source-007]; [198–222][source-008]; module emission is [emitter.ts:723–831][source-009] and [emit-module.ts:142–159][source-010]; [363–378][source-011]. The helper's verification and optimization hooks are [emit.cpp:477–540][source-012]. The architectural overview names LLVM 22 and runtime-pack linking ([how-it-works.mdx:28–33][source-013]). nts instead prepares one shared high-level IR for C, LLVM and JVM, which makes transformations expressed above a particular backend especially valuable ([architecture.md:6–45][source-014]).

## 1. Types and soundness

**[Code] ScriptC uses types to select native representations, but the inspected boundaries validate values before interpreting them in a different representation.** A dynamic value is a value carrying its runtime kind alongside its payload. When such a value enters a supported concrete slot, `coerceToExpected` inserts `dynCheck`; unsupported conversions remain subject to a compile-time representation check. This is a more specific claim than “TypeScript is sound”: the native boundary is checked, while many assertions that retain the same representation are erased. [Native conversion][source-015]; [assertion erasure][source-016].

**[Code] An ordinary failed boundary check throws a catchable `TypeError`; it does not switch the function to an interpreter.** The generated scalar helper compares the runtime kind before extracting the number, boolean or string. Its failure routine constructs a real `TypeError`, including the path through an object where validation failed. Class downcasts similarly test the actual class before exposing subclass fields. A numeric kind check establishes “this is a Number”; it does not establish an integer range, finiteness, or a particular numeric literal. [Kind checks][source-017], [scalar extraction][source-018], [failure][source-019], [class check][source-020].

**[Code / Docs] The four problematic entry routes receive different treatment.**

- **Casts and `any`:** dynamic-to-concrete conversions check the target representation; union-to-arm assertions check the stored alternative. Same-representation assertions can disappear. Plain numeric literal types map to the same double representation as `number`. Therefore `n as 64` is not, through this mapping, an integer-range certificate. [Assertions][source-016]; [mapping][source-021].
- **JavaScript callers:** a wrapper around a native function validates each typed argument; a typed wrapper around a dynamic function validates its result. Node-island ingress shares those checked conversions for supported native values, while foreign objects and `any`/`unknown` intentionally remain dynamic handles. This is not a claim that every foreign object is deeply validated. [Arguments][source-022], [results][source-023], [islands][source-024].
- **Loosely checked method parameters:** TypeScript's method *bivariance* permits some overrides to accept fewer kinds of argument than their base declaration promises. ScriptC preserves the inherited calling convention. It permits checked extraction from an inherited dynamic argument or safe widening; incompatible signatures otherwise receive SC1090. A typed override of an untyped JavaScript method explicitly converts its parameter at entry. [Override rules and adapters][source-025]; [entry conversion][source-026]. The [variance test][source-027] exercises an `any` base method calling a string override with 42; I read it, not ran it.
- **Overload selection:** the documentation explicitly keeps a dynamic result in JavaScript when an untyped argument could select another overload. In TypeScript, an `any` argument retains the checker's chosen overload, and a contradictory result throws where used. This is a declared semantic difference, not an ordinary JavaScript fallback. [Docs][source-028].

**[Code] ScriptC also distrusts narrowing that calls or writes can invalidate.** Its narrowing-stability analysis considers mutable captures, property stores, getters and effects, and preserves/checks stored alternatives when the checker may describe an earlier value. This is useful evidence of a real boundary analysis, but not a proof that every TypeScript refinement is sound. [Analysis contract][source-029]; [actual decisions][source-030].

**[Code] Compiler proof failures are distinguished from user cast failures.** An optional shape overlay adds inferred annotations to package JavaScript. It is opt-in at this revision. Surviving dynamic checks associated with those inferred annotations get source provenance; contradiction throws a catchable `Error` identifying a compiler-analysis bug, with optional logging, instead of the ordinary `TypeError`. It does not fall back at runtime. These checks are not an independent verifier of every optimization. [Enablement][source-031], [marking][source-032], [diagnostic][source-033].

**nts today [Docs].** nts likewise checks erased values at native representation boundaries, but a failed cast is catchable only on its currently supported exception paths; other paths still stop by name. Its intended rule forbids deriving facts from declared types. The latest decisions explicitly say the literal-value entry check is **not built**, that main still reads declared literal types as facts, and that the complete container-writer correction is also **not built**. These are implementation gaps, not guarantees already achieved. [Casts][source-034]; [decisions][source-001].

**Take it? Yes — adopt explicit checked calling boundaries, adversarial variance cases and provenance for failed inferred facts; preserve nts's explicit rule that declarations never prove actual arrivals.**

## 2. Speculation without a profile

**[Code] ScriptC combines static facts, runtime selection among precompiled versions, and optional profiles from earlier runs.** Static facts are attached to evaluated intermediate-representation expressions, rather than indiscriminately to a variable's later reads. Whole-program integer-slot analysis repeatedly removes candidates when a writer or caller cannot prove the required range, then revisits dependent readers. This *fixed point* means repeating the analysis until its conclusions stop changing. The optimism is a compiler analysis technique, not permission to leave failed assumptions unchecked in the executable. [Expression facts][source-035], [work queue][source-036], [rejections][source-037].

**[Code] Some specializations need no speculative failure path.** Numeric-call specialization accepts actual IR constructions of a numeric/boolean union alternative, including recognized defaults, and removes the unnecessary wrapper for that call. It checks the function's writes, captures and body size before creating a variant. A TypeScript annotation alone is not the call-site evidence used by this transformation. [Eligibility][source-038]; [actual argument recognition][source-039].

**[Code] Loop-entry versioning moves selected checks outside the hot loop.** ScriptC analyzes an eligible innermost loop under proposed integer ranges for stable local values. It keeps a version only when this proves useful remainder operands or typed-array indices, removes irrelevant assumptions, and analyzes again when necessary. The emitted entry predicate checks range and exact integer conversion, rejecting NaN and negative zero. Passing selects the fast copy under those facts; failing selects the ordinarily emitted copy. The assumptions do not escape the loop. [Planning][source-040]; [runtime predicate and copies][source-041].

**[Code] A separate mechanism speculates inside integer loops.** It maintains integer versions of selected numeric locals and their observable double values. Failure resumes the offending statement using ordinary floating arithmetic, completes that iteration in an additional tail copy, then enters the ordinary loop at its header. The third copy avoids giving the slow loop an extra entrance that would hinder LLVM optimization. Hoisted input values are saved for resumption, so supported effectful inputs need not execute twice. No interpreter or runtime compiler is involved in this bailout. [Copies and resumption][source-042]; [input preservation and writeback][source-043].

**[Code] It does learn a little at runtime, without generating code.** A per-loop byte counts consecutive entries that bail out of the fast copy. After eight, subsequent entries use the ordinary copy; successful fast-loop completion resets the count. This is profitability feedback, not evidence about future value types. [Threshold][source-044], [selection][source-045], [reset][source-046].

**[Code / Inference] AOT also permits ordinary offline profile-guided optimization:** build with instrumentation, run representative input, then rebuild using its execution counts. ScriptC implements `--profile-generate`/`--profile-use` through LLVM and supports context-sensitive profiles. Those counts guide choices such as code placement and inlining; they do not replace the value checks or range proofs above. Current generation requires Linux executable output and an optimized, nonsanitized build. [LLVM setup][source-047]; [restrictions][source-048].

**nts today [Docs / Inference].** nts already describes operator/guard-derived numeric facts, complete-caller requirements, and guarded integer clones for externally called roots. Its new region note proposes one loop-entry predicate followed by a fast loop or the unchanged floating loop, with explicit work and growth limits. That design fits ScriptC's entry-version idea more closely than its repeated speculative arithmetic checks. The latter should remain a measured experiment: nts records rejecting per-addend speculation because its checks help only when the shortened dependency chain is the bottleneck. [Current numeric foundations][source-049]; [proposed versioning][source-050].

**Take it? Yes for bounded loop-entry versions and proof-driven specialization; later for per-operation speculation and offline PGO, because profitability must be measured separately from correctness.**

## 3. Numbers

**[Code] Ordinary `number` and numeric literal types start as double-precision floating-point values.** The optimizer's integer domain describes exact integers excluding negative zero. It propagates ranges through operations, with separate handling of JavaScript's bitwise conversions. Addition, subtraction and multiplication require safe-integer result bounds; multiplication refuses possible negative zero, and its simple remainder proof requires a nonnegative dividend and positive divisor. These are operation-level conditions, not a promise inferred from the spelling `number`. [Type mapping][source-021]; [range transfers][source-051].

**[Code] Permanent 32-bit slots require evidence from their writes.** The slot analysis rejects parameter candidates for escaping functions and virtual dispatch, rejects unproved arguments, stores and returns, and propagates each rejection to readers. It also checks that certain rewritten function revisions have not changed the structure on which its analysis depended. A separate `Int32` contract is an obligation checked by the compiler: unseen callers or dynamic field writers can cause refusal, and every visible store still needs an int32 proof. It is not an unchecked branded TypeScript type. [Candidate restriction][source-052], [revision checks][source-053], [writer checks][source-054], [contract boundaries][source-055], [contract stores][source-056].

**[Code] Some arrays use a different, guarded storage policy.** A restricted local-array case may retain compact integer storage with checked writes; the first non-int32 store widens it to doubles. The analysis removes the unconditional integer-element facts before choosing that policy. Thus “ScriptC uses integer arrays” does not imply all their future values were statically proven int32. [Selection and invalidation][source-057].

**[Code] Speculative arithmetic preserves Number behavior by checking exactness before committing.** Its 64-bit integer fast path admits only values within ±(2^53−1) whose conversion to integer and back has identical bits; this excludes fractions, infinities, NaN and negative zero. Addition/subtraction stay within that safe interval. Multiplication checks both machine overflow and Number-safe range, plus a negative-zero result. Remainder rejects division by zero and a negative dividend producing a zero remainder. Unary negation also bails on a zero operand, preserving a possible negative-zero result. Failed checks take the floating continuation described in §2. JavaScript bitwise operations remain explicit modulo/truncation operations, rather than accidental signed overflow. [Entry checks][source-058]; [arithmetic checks][source-059], [negation][source-060]; [bitwise semantics][source-061].

**[Code] Pure recursive functions can get a guarded int32 clone.** Here *pure* means the restricted body has no externally visible mutation: supported array/record parameters are borrowed and read. An entry test checks numeric arguments exactly; overflow or another numeric failure propagates a bailout flag and reruns the ordinary native body from its start. Restart is permitted because that clone has no effects to repeat. A pending stack-overflow exception is forwarded instead of restarting. This is a different recovery policy from resuming one loop statement. [Eligibility and contract][source-062], [eligibility implementation][source-063], [dispatcher][source-064]. The inspected [loop corpus][source-065] includes fractional arrivals, safe-range crossing, NaN, negative zero and zero divisors; it provides test intent, not measurements or a passing result from this research.

**nts today [Docs].** The existing numeric design already separates wholeness, NaN, negative zero and range, and records gaps in seeing every writer. The newer integral-region notebook is explicitly a design awaiting the parameter-arrival correction, not a shipped optimization. It uses existing flow and container-content authorities to issue certificates for an exact value at an exact program point and immutable function revision. Missing writers, inconclusive analysis and exhausted budgets mean no certificate. This should remain the authority across C, LLVM and JVM. [Existing facts and gaps][source-066]; [design status][source-067]; [authorities and certificates][source-068].

**[Docs / Inference] The region design goes beyond simply staying in a safe integer interval.** It demands two independent proofs: preserve each original floating operation and its rounding, and show each proposed machine operation fits its chosen width. Integral inputs alone do not make a large floating product exact. A wider integer product must convert back at the original rounding boundary unless the complete prefix is proved exact. Dyadic scaling represents an exact fraction as an integer times a power of two; each alignment, shift and intermediate result still needs proof. Negative-zero permission belongs to a particular use, and effects or unproved rounding boundaries stop reassociation. ScriptC's checked safe-integer paths illustrate useful mechanisms, but do not establish these wider obligations for nts. Its entry-version implementation is the closest directly transferable comparison; nts should preserve its backend-neutral certificates and bounded, unchanged floating fallback. [Separate proofs and rounding][source-069], [dyadic region rules][source-070], [versioning][source-071].

**Take it? Yes — take all-writer invalidation, revision checks, explicit negative-zero controls and bounded entry guards; later consider pure recursive clones, while keeping nts's proposed original-rounding and machine-width certificates.**

## 4. Objects and property access

**Code — two object strategies.** ScriptC gives native records and classes fixed field positions chosen during compilation. Class inheritance, which lets a derived class reuse a base class's fields and methods, is represented by a whole-program class graph; field access calculates a position in an emitted structure. These are layouts derived from the compiler's typed program, not shapes sampled during a preliminary run. The graph also assigns class-number intervals for membership tests. This describes representation, not a proof that every TypeScript declaration is true; the checked boundaries and their gaps belong in §1. [classes.ts:145–150,196–231][source-072], [classes.ts:461–486][source-073].

**Code — dynamic objects still have native code.** Objects in the native dynamic tier can acquire a shared runtime layout describing their ordered property names. Equal key sequences share that layout, so checking its address establishes which property occupies a slot. Deleting a property, adding an accessor or unusual attributes, exhausting layout budgets, or publishing across threads converts the object permanently to a dictionary of keys, values and attributes. This preserves a general path when the compact layout no longer applies. It does not generate or patch machine code. [scr_dyn.h:656–707][source-074], [scr_json.c:1051–1080][source-075].

An **inline cache** remembers which layout made a previous property access cheap. Here it is writable data read by fixed machine instructions: on eligible 64-bit dynamic-tier sites, the emitted code checks two entries from a four-entry cache. A match loads the remembered slot; a mismatch calls a runtime probe, which can refill the cache or decline to the general property operation. Cached prototype access also checks the prototype object and its current layout. The probe handles its explicitly supported short prototype cases; it does not assume all prototype chains are stable. Thus a different dynamic shape causes another lookup, not an interpreter exit or an incorrect fixed-offset read. [js-ic.ts:47–61,84–96][source-076], [js-ic.ts:128–175][source-077], [scr_js.h:217–222][source-078], [scr_js_object.c:204–254][source-079].

**Code — an especially useful bridge between layouts.** A checked conversion can return a *record view*: an object that redirects field access to the original record's slots. The source must contain the target's fields with matching names and types; their byte positions may differ. Reads and writes then share storage, and converting the view back to a dynamic value recovers the original identity. Only record types that can receive such views pay the field-address test. The runtime caches the view and retains its source. This applies to suitable checked crossings from a dynamic wrapper around a live native record. The planner excludes incompatible shapes and cases that could introduce an untracked cycle; it is not a universal promise for every structural conversion. [view eligibility][source-080]. [record-views.ts:1–18][source-081], [record-views.ts:228–268][source-082], [scr_json.c:4378–4423][source-083].

**Docs and Code — compatibility costs remain.** The documentation admits that other native record conversions copy different property sets, changing identity and mutation sharing; SC6001 warns when this is observable. It also documents property-order approximations and deletion restrictions. The runtime explicitly throws a catchable `TypeError` when a keyed write tries to add an undeclared field to a fixed-shape record that has no open-ended property declaration. Dynamic layout fallback must not be mistaken for universal support for adding properties to native records. [record-identity-and-property-order.mdx:1–34][source-084], [scr_object.c:77–92][source-085].

**nts today — Docs.** nts already has fixed layouts, read-only class descriptors, direct field offsets and specialized interface access. Runtime-added properties and prototype mutation are outside that representation; class-number interval tests are decided but not built, and runtime-key name tables are also a decision rather than completed support. ScriptC's dynamic cache therefore solves a broader problem than nts currently accepts. [nts objects.md:28–98][source-086], [objects.md:224–228][source-087].

**Take it? Later — Inference:** use identity-preserving views when nts adds crossings between different native layouts; retain data-only caches as an option for genuine dynamic objects, but do not adopt observable copying or new-property errors as substitutes for required semantics.

## 5. Calls and closures

**Code — direct calls where the target is known.** ScriptC avoids virtual method-table entries when whole-program inheritance analysis finds no override. Where a call can reach several implementations, it can compare the actual table entry with known targets and make direct calls in the matching branches; otherwise it retains the indirect call through the table. The target-list check excludes unsuitable runtime classes and unoptimized builds. This helps LLVM inline the method body, meaning substitute its operations into the caller. Separate frontend analysis tracks method writes, including writes in JavaScript, which can invalidate a typed class's native-call proof. [classes.ts:196–231][source-088], [expr-calls.ts:1378–1462][source-089], [class-method-mutations.ts:78–105][source-090]. Checked parameter adapters for loosely checked TypeScript overrides are covered in §1; an indirect method call alone does not validate arguments.

**Code — bounded callback specialization.** A callback-taking helper can receive a separate compiled copy for each known combination of callback targets. Each copy exposes more direct calls to LLVM, while the original remains reachable by unknown callbacks and other entries. Current limits include a 300-node body, four copies per function, and a module-wide growth budget. The caller still evaluates and passes the callback value. Where target identity is not already established, the backend compares the actual closure's code pointer with the expected function and falls back to the normal indirect call if they differ. That guards initialization and boundary cases without abandoning native execution. [callback-specialization.ts:7–13][source-091], [callback-specialization.ts:124–175][source-092], [expr-calls.ts:1021–1081][source-093].

There is also a deliberately small compiler-level inliner for numeric helper functions used inside loops. It accepts a single pure number expression and arguments that can safely be read repeatedly, excluding mutable boxed locals and reads before initialization. Its purpose is to expose arithmetic on the caller's loop counters to later analyses. This is more specific than a general promise that every small function gets inlined. [expression-inlining.ts:25–72][source-094], [expression-inlining.ts:105–117][source-095].

**Code — capture costs are separated.** A closure combines a function pointer with an environment holding the variables it captures. ScriptC uses shared boxes for mutable captured bindings, immortal singleton closures for functions without captures, and identity links for signature adapters. Further analyses can delay an unchanged parameter's box until a closure is actually created, or put a box in the caller's frame when every environment using it finishes inside the variable's scope. The delayed-allocation analysis checks creation sites and nested writers; it does not infer immutability merely from a parameter's declared type. [scr_closure.h:8–22][source-096], [scr_closure.h:103–135][source-097], [expr-calls.ts:767–827][source-098], [lazy-captures.ts:26–79][source-099], [stack-captures.ts:14–39][source-100].

Closures can also carry a second entry that *borrows* arguments: uses them during the call without taking ownership. Eligible indirect callers choose that entry when present, otherwise use the ordinary entry with owned arguments. This reduces reference-count traffic across calls whose exact target remains dynamic. [expr-calls.ts:1031–1062][source-101].

**Code — native/dynamic calls and engine crossings are different.** Native checked-dynamic code uses the compiled runtime paths above. Current ScriptC can additionally put refused npm packages in an in-process Node engine: `--node-islands=auto` is the default. Explicit `call`/`callSync` bridges copy JSON arguments/results and check supported typed results; `requireModule` instead returns a handle to the engine-held export, preserving a different boundary model. These are not transparent transfers of a native closure's environment to an interpreter. Section 6 describes the automatic fallback and its limitations; engine-free comparisons need `--node-islands=off` and no explicit `@scriptc/node` use. [prepare.ts:284–304][source-003], [lower-node-island.ts:152–189,192–235][source-102].

The automatic island boundary separately keeps suitable engine objects as handles, checks typed primitive crossings, copies selected arrays, and converts promise settlement values to their declared type. A native value exported by reference can return as itself. These rules matter when assessing whether identity and mutation sharing survive a call; the explicit JSON-copy API is not the whole boundary. [lower-node-island.ts:562–640][source-103].

**nts today — Docs.** nts already selects direct calls, small target sets or table dispatch, specializes closure calls with a ten-copy cap, copies immutable captures, boxes mutable captures, and uses frame storage for nonescaping environments. Its typed and tagged call entries address mixed representations. Some broader propagation of class sets and function splitting remains planned. ScriptC therefore supplies refinements to an existing architecture. [nts objects.md:107–121][source-104], [objects.md:185–208][source-105].

**Take it? Yes — Inference:** refine nts's existing specialization with explicit code-growth budgets, actual-target guards, delayed capture boxes and borrowed indirect entries; each can remove call or ownership work while retaining a correct ordinary path.

## 6. What gets compiled, and the fallback

**Code — current ScriptC can automatically fall back to Node.** A **Node island** is JavaScript code selected to run in an embedded Node instance beside the compiled application. The executable preparation pipeline scans dependencies, selects islands, then reloads the frontend without compiling their implementations; their declarations still describe calls from native code. The default policy is `--node-islands=auto`: refused npm packages and packages explicitly marked for Node become islands. Packages forced to remain native keep their refusal. `explicit` restricts this to marked packages; `off` disables this automatic selection. Each selected island produces an SC8001 note. Lowering failures can grow the island set and retry compilation. This is a build-time package decision, not a native function returning to an interpreter after an unexpected value. [prepare.ts:56–71][source-002] [prepare.ts:284–339][source-106] [prepare.ts:143–195][source-107]

**Docs versus code.** The dependencies guide says version 0.3 removed the old `--dynamic` embedded engine and that all application and package code now compiles natively. That blanket statement does not describe the automatic-island path at this commit. The `@scriptc/node` README documents the explicit bridge, and the executable preparation code establishes automatic fallback. A comparison must report the island policy and actual selected dependencies; a claim of an engine-free artifact also needs to exclude explicit bridge use. [dependencies.mdx:217–221][source-108] [README.md:3–17][source-109]

**Code — the engine is real and loaded lazily.** The native runtime loads a bridge shared library with `dlopen`, checks its interface and Node version, starts Node, and connects event delivery and deferred module evaluation. Native code and JavaScript then coexist in one process. Explicit `call`/`callSync` copies JSON-compatible data and checks its result against the expected native type. Automatic islands have a broader boundary: foreign objects can remain handles, typed primitive crossings use checked conversions, arrays can be copied, and supported native objects can return through checked unboxing. It would be wrong to describe every crossing as either a JSON copy or a deeply validated object. [scr_node_island.c:1355–1445][source-110] [lower-node-island.ts:152–189][source-111] [lower-node-island.ts:562–640][source-103]

**Code — native `eval` is a catchable refusal.** In code compiled by ScriptC, `eval` and the `Function` constructor evaluate the relevant operands and arguments, then throw `EvalError`; the constructor also performs required object-to-string conversions. Spread arguments at those sites are refused during lowering. There is no native-path interpreter for their source text. A library can catch the error and use an ordinary implementation that ScriptC compiles; calling that library's alternative “interpreted” does not establish a JavaScript engine. **Docs:** QuickJS also supplies a separate, build-time `comptime` evaluator; selected regex and Unicode libraries are linked at runtime. Neither alone is a general runtime JavaScript engine. [code-generation.ts:67–110][source-112] [how-it-works.mdx:28–33][source-013] [how-it-works.mdx:142–148][source-113]

**Code — refusal remains a real outcome.** Remaining package/preflight failures, lowering diagnostics, invalid intermediate representation, unavailable target operations and rejected optimization contracts stop the build. Islands require a suitable libnode pack; a missing pack or unsupported pack target is also a build failure. Automatic fallback is therefore conditional compatibility, not a promise that arbitrary JavaScript will build. [prepare.ts:87–221][source-114] [libnode.ts:167–205][source-115]

**nts today — Docs:** nts deliberately carries no parser, interpreter or JIT and refuses runtime source evaluation at build time. Constant-source compilation is a possible future optimization. Its documented boundary is stronger than ScriptC's default executable policy. [boundaries.md:44–55][source-116]

**Take it? No to automatic engine fallback; later to a deliberate catchable code-generation refusal, because that could enable a library's native alternative only after nts explicitly changes its documented boundary.**

## 7. Memory ownership and collection

**Code — the native runtime is close to nts's architecture.** **Reference counting** records how many owners keep an object alive; releasing the last owner frees ordinary acyclic values. For ordinary reference-counted objects, ScriptC packs count and layout information into the first machine word. Objects that might participate in cycles additionally carry an eight-byte collector header; acyclic strings and other proven acyclic types avoid that collector metadata. Its collector uses **trial deletion**: temporarily discount references internal to a candidate group, preserve anything still reachable from outside it, and reclaim the rest. Collection is synchronous, not concurrent. [scr_rc.h:9–31][source-117] [scr_rc.h:116–159][source-118]

**Code — avoid repeatedly walking a large surviving graph.** Candidate objects have nursery, mature and old generations. Restricted passes skip older objects; full passes find cycles spanning generations. The schedule responds to heap growth, candidate backlog and how much old garbage a pass actually recovered. This targets a specific problem: a frequently edited but still-live tree can otherwise trigger repeated walks through most of the tree. The implementation also states two safety requirements: every strong root contributes a count, and a stored pointer is removed before releasing its old reference, because that release can trigger collection. [scr_cycle.c:19–124][source-119]

**Inference:** generational scheduling is a useful experiment for nts only if profiling finds repeated unproductive cycle walks. Its extra state and delayed cross-generation collection are tradeoffs, not a demonstrated universal improvement. The collector is also incomplete across some opaque edges: ScriptC's closure property-table contract explicitly says cycles through that edge, like a dynamic-value-to-closure edge, are not collected. Do not equate “has a cycle collector” with “reclaims every cyclic graph.” [scr_closure.h:107–117][source-120]

**Code — arenas are selected by allocation site and lifetime proof.** An **arena** groups objects whose storage can be recycled together. ScriptC distinguishes a returned group kept in one caller scope from a call whose allocations never escape. Only selected allocation sites use the arena; temporary and runtime-internal allocations need not follow them. Destruction still releases references to outside objects before recycling the storage. The planner rejects groups where a separately collected cyclic object might survive the arena and retain a pointer into recycled memory. It disables arenas for programs constructing weak collections, whose observations depend on individual key death. Sanitized and audit builds allocate arena objects separately so an access after disposal remains visible to memory-error tools. [scr_arena.h:3–31][source-121] [arenas.ts:66–143][source-122]

**Code — process-exit work is conditional.** Normal main-thread execution leaves still-held globals for the operating system at process exit. Worker contexts, auditing/sanitizer modes and `SCRIPTC_EXIT_FREE=1` request teardown. Ordinary reference releases still occur while the program runs. **Inference:** a benchmark that measures process lifetime needs to distinguish useful computation, reclamation during execution and final teardown; keeping live globals until exit must not be presented as more efficient collection. [scr_console.c:38–54][source-123] [emit-module.ts:600–615][source-124] [how-it-works.mdx:142–148][source-113]

**nts today — Docs:** nts already has inferred borrowing and moves, frame placement, reference counting, acyclic-type exclusion from trial deletion and call regions. Its planned unified allocation-site analysis is not built yet, and its memory note records concrete defects involving optimistic analysis, overlapping instances and region helpers' ownership contracts. The strong overlap makes ScriptC's arena/collector boundary checks more relevant than changing collectors wholesale. [memory.md:1–81][source-125]

**Take it? Yes to explicit arena closure checks, outside-reference cleanup and sanitizer-visible disposal; later to generational scheduling, because nts already has the right base and needs proof completeness before additional policies.**

## 8. Startup, module initialization and images

**Code — the inspected executable path uses ordinary native initialization, not a general heap snapshot.** Emitted `main` initializes the runtime, conditionally installs facilities actually used, then calls or starts the application's entry. Examples include stack protection, event hooks, networking and Node-island configuration. The event loop runs after entry when required. The runtime initializes stream handling and exit hooks; it does not restore a serialized application heap in these paths. [emit-module.ts:1198–1276][source-126] [scr_console.c:153–195][source-127]

**Code — the module graph becomes initialization functions.** Each source module has compiled initialization logic. Dependency calls enforce evaluation order, and guards turn repeated imports or requires into cache hits. Guards are set before executing a module body. CommonJS evaluation has enter/finish/fail operations; selected ES-module evaluation errors are remembered and rethrown on later attempts. Async dependencies start in source order before the importer waits for their completion. Synchronous CommonJS loading of an ES-module graph that requires top-level `await` is refused with guidance to use `import()`. [lower-modules.ts:3150–3263][source-128] [lower-modules.ts:3456–3601][source-129]

**Inference:** this precomputes how initialization is reached, not its arbitrary runtime results. It removes parsing and compilation from ordinary native startup but still performs observable top-level work. **Docs:** explicit `comptime` results are embedded as constants. **Code:** another optimization delays lowering an unobserved registry initializer so merely collecting a registry does not make every stored constructor reachable. If it is needed, the initializer stays at its source position. This is build-time reachability control, not a license to reorder side effects or a universal lazy-module loader. [how-it-works.mdx:28–33][source-013] [deferred-module-initializers.ts:17–60][source-130]

**Code/Docs — islands change the startup account.** Native main installs their configuration, but the bridge starts Node on first actual use. It opens the shipped module tree, loads the shared engine and starts the bridge before evaluating deferred island modules. The package README describes cache extraction and digest checks; consequently a startup comparison should separate first use with an empty module cache, a populated cache and a run that never calls Node. No startup percentage follows from the design alone. [emit-module.ts:1198–1276][source-126] [scr_node_island.c:1355–1445][source-110] [README.md:3–17][source-109]

**nts today — Docs:** nts likewise emits native code and links only the runtime it uses; its documented pipeline has no application-heap snapshot stage. Its shared intermediate representation owns decisions across C, LLVM and JVM, so a new initialization optimization should preserve the same evaluation semantics on all targets. [architecture.md:6–46][source-131]

**Take it? Yes to preventing unused registration tables from retaining whole dependency trees; later to explicit compile-time data construction, because these can reduce startup work without pretending arbitrary module evaluation has already happened.**

## 9. Binary size and linking

**Code — native runtime selection happens before the linker.** A versioned runtime pack lists precompiled units and variants. Selection evaluates predicates against the program's feature set, including optimization mode; the compiler rejects version or target mismatches. A separate speed flavor can choose runtime objects intended to trade size for speed. The native build also gates individual source units and matching build definitions, including workers, networking and the Node bridge. This prevents an unused facility from becoming a link dependency in the first place. [runtime-pack-core.ts:370–428][source-132] [executable.ts:385–426][source-133]

**Code — reachability still matters inside selected units.** Native target link flags use dead-section removal, including `--gc-sections` on Linux and `-dead_strip` on macOS. The emitted initialization calls are gated alongside their corresponding runtime units. Linux links the math library only as needed. Thus “the runtime is present” does not mean every facility is in every executable. [targets.ts:298–393][source-134] [emit-module.ts:1198–1276][source-126] [link-plan-core.ts:42–94][source-135]

**Code/Inference — layout is part of the performance experiment.** The link plan places runtime objects and vendored archives before program objects to reduce movement of runtime functions when the application changes. Its comment attributes benchmark variation to incidental instruction placement, particularly in regex loops; that is an author explanation in code, not a measured result from this study. nts could test whether ordering helps its own remaining variance, while retaining correctness and ordinary dead stripping. [link-plan-core.ts:42–94][source-135]

**Code — an island executable has additional deployment pieces.** Its runtime loads the bridge/libnode pack from the recorded location or an override; `--libnode=beside` copies the pack next to the executable. By default, JavaScript modules are embedded in the executable and extracted into a cache on use; `--libnode=beside` instead writes them beside it. Comparing only executable file bytes omits the external engine pack and, in beside mode, the module payloads. Conversely, a wholly native program need not link or load this bridge. The same caution applies to memory: avoiding an engine is conditional on the actual built graph, not the product name. [libnode.ts:167–205][source-115] [README.md:3–17][source-109] [executable.ts:385–426][source-133]

**nts today — Docs:** nts already uses ThinLTO to optimize across compilation units and removes unused function/data sections. Feature selection is therefore an extension of existing practice, not an entirely new size strategy. No Bun-like “twice as large” result has been established for ScriptC here. [numbers.md:180–198][source-136]

**Take it? Yes to one auditable feature decision governing both linked units and startup hooks; later to a controlled link-order experiment, because dead stripping already exists in nts and size must include all deployment dependencies.**

## 10. Exceptions, async functions and generators

### Exceptions

**Code — ScriptC has two ways to propagate an exception.** Its general convention keeps the thrown value in an execution-context cell and checks for a pending exception after calls that may throw. Compiler-generated cleanup releases owned references on the way to a handler. A catch binding takes an owned snapshot of the pending value, allowing the binding to escape safely and participate in collection. [scr_exception.h:124–175][source-137] [emitter.ts:4110–4157][source-138] [scr_exception.c:289–323][source-139]

**Code — eligible Linux code also uses native stack unwinding.** An **unwinder** walks callers using compiler-produced metadata and enters their cleanup blocks. ScriptC enables this for selected direct-call functions on Linux; constructors, virtual/closure targets, exported entries, async/generator paths and other ineligible callers keep the pending-value convention. Calls selected for unwinding use LLVM exception edges whose cleanup performs the same releases as the pending-check path. Default selection excludes functions near explicit throws and recursive functions; `--exceptions=rare` widens the choice. This is a compiler policy, not runtime profiling. [unwind-abi.ts:66–89][source-140] [emitter.ts:4176–4215][source-141]

**Code:** on x86-64 Linux, the runtime caches an unwind plan per return address using exception/frame tables; unsupported descriptions fall back to the system unwinder. **Inference:** the useful idea is separating frequent-error paths from mostly successful direct calls while sharing cleanup semantics. Its platform-specific machinery is a later experiment for nts, after complete indirect-call exception propagation. [scr_unwind.c:1–37][source-142]

### Async and generators

**Code — there are heap-frame and stack-preserving forms.** A **stackless coroutine** saves only values needed after suspension in a heap frame. ScriptC selects it for eligible async functions and async generators whose suspension happens only at their own `await`/`yield` points and whose callees cannot park the borrowed stack. It checks the emitted candidate again; otherwise the stackful **fiber**, a separately suspended execution stack, remains. Module-evaluation bodies and dynamically typed async results retain fibers. Debug, worker and library builds have additional restrictions; native async stackless selection also excludes Windows. Functions that never suspend can remain fiberless. [emitter.ts:2972–3019][source-143] [emitter.ts:2199–2221][source-144] [emitter.ts:2126–2132][source-145]

**Code — generator completion is a protocol, not just a saved instruction position.** ScriptC stores outgoing yields, incoming `next(v)` values and a pending `return(v)` separately. Returning into a suspended generator carries a special completion through its cleanup; a `finally` can yield before completing that return, and throwing can replace it. Generator loops emit cleanup that closes an unfinished iterator on early exit while preserving the original body error over a later closing error. Async generators add queued requests and promise settlement. [scr_generator.h:8–35][source-146] [lower-generators.ts:583–626][source-147] [scr_async.c:6373–6397][source-148]

**Code — dropping a suspended generator is a limitation.** Both stackless and stackful generator constructors use the same execution-state wrapper. When its last reference is released while suspended, the runtime retains or abandons that state instead of executing user `finally` blocks merely because an object became unreachable. This avoids inventing observable finalization but can retain memory. The distinction matters: correct explicit iterator closing does not prove that abandoning an iterator reclaims its suspended state. [scr_async.c:6423–6537][source-149]

**nts today — Docs:** nts uses shared state-machine lowering with heap frames and no suspended native stack. Its exception raising copies still miss several indirect-call paths; an indirect-call raising flag is decided but not built. Its generators currently omit early-close behavior and refuse two-way yields, explicit `return`/`throw` and `finally` spanning a yield; async iteration also lacks closing. These are correctness gaps with a direct application for ScriptC's explicit completion protocol. [errors.md:29–39][source-150] [errors.md:80–100][source-151] [async.md:49–89][source-152]

**Take it? Yes to complete iterator closing and explicit completion state; later to selective native unwinding, because nts's shared heap-frame design fits its targets and correctness must precede platform-specific call-cost optimization.**

## 11. Builtins, strings, arrays, typed arrays and JSON

**Code — helper contracts support optimization.** ScriptC records builtin argument and result signatures centrally, uses a separate set of potentially throwing builtins, and separately classifies operations that preserve references between objects. For example, a callback-free operation may leave reference relationships unchanged while another operation can replace an array element. These facts let optimizers decide whether a call invalidates an earlier proof. The metadata is spread across files; describing it as one complete, unified contract table would overstate the implementation. [builtin-signatures.ts:44–65][source-153], [builtin-effects.ts:3–10][source-154], [reference-effects.ts:19–63][source-155].

**Code — checked JSON can build the final representation directly.** `JSON.parse(text) as T` can select a compiler-generated description of a supported target: field names, storage positions, element kinds and constructors. The runtime walks that description while parsing and writes directly into native records and arrays. This avoids constructing a complete generic object tree followed by a second conversion. Supported cases include primitive leaves, arrays, records, optional/nullable members and suitable discriminated unions; tuples and some other cases retain the general checked route, and the direct record path currently has a 64-declared-field limit. The target selects validation of the supported native representation and explicitly encoded union discriminants; it does not validate every TypeScript literal or refinement. Non-enum numeric literals, for example, lower to the ordinary number representation. The annotation is not evidence that the input matches that representation. [dyn.ts:1650–1692][source-156], [scr_json.h:13–25][source-157], [scr_json.h:92–108][source-158], [scalar descriptors][source-159], [discriminants][source-160], [literal mapping][source-021].

The direct parser checks declared fields recursively and checks every array element; missing required fields or duplicate keys decline to the general route. Undeclared properties can use generic side storage, so this is not a promise of zero generic allocation. [field checks][source-161]; [array checks][source-162]; [duplicate keys][source-163]; [extra properties][source-164].

The fast parser declines silently when its answer could differ from the checked general route. Generated code then performs ordinary parsing and a generated type check, which can raise a `TypeError` naming the failing JSON path. Parsing failure prevents the type conversion, preserving syntax-error precedence. The fused path excludes revivers, so retrying parsing does not repeat user callbacks. [fusion eligibility][source-165]. This is a concrete optimization with a semantic reference path. Replacer and reviver callbacks use separate runtime operations; a reviver is the callback that can replace parsed values. Docs list source-context and array-element deletion restrictions, and the latter has an actual throwing branch in the runtime. [dyn.ts:1979–2034][source-166], [json-callbacks.mdx:1–12][source-167], [scr_json.c:14439–14462][source-168].

**Code — array fast paths retain evidence about elements.** Native arrays distinguish four states: a hole, an ordinary element, present `undefined`, and a value outside the native element type stored through a dynamic view. A `filled` count identifies a prefix proved to contain only ordinary elements; operations that create holes or other states reduce that count. A read inside the prefix needs no additional state check. This is runtime-maintained evidence, stronger than merely declaring `number[]`. Foreign-value storage can widen an int32 array before storing a dynamic value; one-byte and compressed-reference slots cannot use that mechanism. Raw accessors intended for proved-present indices can abort, so their contract must not be confused with the language's ordinary potentially missing-element read. [scr_array.h:8–67][source-169], [scr_array.h:140–153][source-170], [scr_array.c:2913–2943][source-171].

**Code and Docs — strings offer a useful optimization and a poor storage model for nts.** ScriptC stores UTF-8 bytes while implementing UTF-16 indexing semantics; its docs acknowledge some surrogate-matching differences. A positive ASCII flag establishes that byte positions equal UTF-16 positions, and mutation clears cached content facts. Another pass removes a local substring allocation when only its length or character codes are read: it snapshots the source and bounds, retaining the source so a later append cannot change the observed characters. Escapes, captures and suspension exclude that optimization. [strings-and-sorting.mdx:1–9][source-172], [scr_string.h:9–39][source-173], [scr_string.h:74–92][source-174], [string-slices.ts:21–67][source-175], [string-slices.ts:127–145][source-176].

**Code and Docs — typed arrays keep shared storage.** The runtime represents buffers, typed arrays and DataViews as views retaining a backing owner; it flattens ownership chains and applies element-kind conversions on stores. The documentation supports fixed-length shared storage and numeric kinds including Float16, while listing resizing, transferring and BigInt arrays as unsupported. Treat that last list as the documented builtin surface, not a complete audit of every worker-transfer implementation. [scr_bytes.h:8–42,54–76][source-177], [arraybuffers-and-typed-arrays.mdx:1–7][source-178].

**nts today — Docs.** nts has generated stringify, but global `JSON.parse` and the direct checked typed parser are planned, not implemented. The planned parser already requires final-layout construction, JSON-path type errors and syntax-error precedence. Arrays have a documented numeric-hole bug and a decided every-writer rule for narrow storage. Strings use Latin-1/UTF-16, with destination construction and unique-owner append already built; temporary slice views remain planned. Typed arrays already preserve backing-store aliasing. These differences make JSON parsing, truthful array states and temporary-view elimination more relevant than importing ScriptC's byte encoding. [nts json.md:6–60][source-179], [objects.md:124–183][source-180], [strings.md:6–37][source-181], [strings.md:88–98][source-182].

**Take it? Yes — Inference:** prioritize checked direct-layout JSON with a semantic fallback, explicit array presence/type states, and removable temporary string views; keep nts's Latin-1/UTF-16 representation and adapt helper contracts to its existing analyses.

## 12. Where it loses, and how to compare it

**Evidence limit.** This inspection did not produce a timed ScriptC-versus-nts/Node/Bun result. The pinned repository contains workloads and a measurement runner; the workload JSON files are configurations, not performance results. It would be unsupported to turn those files or a changelog improvement into a claim that ScriptC wins or loses every comparable row. The useful evidence here is specific upstream tradeoffs and concrete remaining work in the implementation ([runtime benchmark README:1–47][source-183]; [numeric-kernels.json:1–6][source-184]).

### Documented losing tradeoffs

**Author report + code.** Larger inlining budgets are not automatically better. A comment beside the actual profile-import controls reports that LLVM's much larger hot-call allowances tripled build time and memory on large programs without a measurable runtime gain. ScriptC caps those multipliers at two. Its ordinary cross-partition import limit is 40 instructions; the comment reports that cutting it to 30 or below made the studied program run 1–8% slower. These are upstream observations about a particular experiment, without a complete machine record in this excerpt, not transferable speed promises ([emit.cpp:70–77][source-185], [200–228][source-186]). **Inference:** nts should account for compile cost, generated code size and runtime work together; a small isolated call may not predict a large application's best budget.

**Docs/author report.** The exception policy exposes another tradeoff. With `--exceptions=rare`, eligible Linux functions avoid normal-path exception-status tests, but propagating actual exceptions must unwind native frames. The CLI documentation warns that throw-heavy control flow can become several times slower. Its huge-code-page option similarly trades initialization and resident private memory for fewer address-translation misses during execution. Neither option is a free improvement ([cli.mdx:164–170][source-187]). Section 10 describes the concrete mixed exception implementation; section 8 covers ordinary startup.

### Costs visible in the implementation

| Case | Mechanism established in earlier sections | Inference for nts |
|---|---|---|
| Unknown properties and calls | Native dynamic values still need tags, layout/cache checks, lookup helpers and sometimes boxing. | Prove the actual writer and target sets where possible. A declaration alone cannot remove that work. |
| Frequent numeric fast-path failures | ScriptC carries native alternatives, guards and bailout state; a failure counter can stop repeated attempts. | Keep nts's one-guard region design separate from per-update speculation. Measure the check, retained state and clone cost. |
| Unsupported npm packages under the default policy | Automatic Node islands add an engine boundary; conversions and handles preserve only the documented cross-boundary semantics. | Report native-only and island-enabled modes separately. Do not claim an engine-free win when the row used Node. |
| Typed validation of mismatching data | Parsing, conversion and runtime checks can end in a deliberate type error rather than Node's unchecked typed assertion. | Compare the same validation contract and correct outputs; optimize construction without dropping checks. |
| Pointer-rich or long-lived graphs | RC operations, cycle collection, opaque edges and abandoned suspended generator state can cost time or retained memory. | Measure repeated in-process work and retained memory, not only short launches that hand cleanup to the OS. |
| Non-ASCII string indexing | ScriptC's UTF-8 storage needs additional machinery to reproduce JavaScript's UTF-16 indexing. | Retain nts's chosen string representation and measure concrete conversions or slices before changing it. |

These are **code-based explanations of possible costs**, not measured rankings against a JIT. A JIT can specialize to frequent runtime cases; ScriptC's optional offline profile can improve layout and inlining but does not replace the proofs that make an operation correct. Its counter-based path selection also changes which precompiled path runs, without generating new code.

### What to take from the benchmark runner

**Code.** The runner checks stdout, stderr and exit status against Node, and server workloads add checked client output. A timeout, build failure or mismatch remains a named result and is not timed. It interleaves contender launches, records layout variants when requested, and uses a bootstrap interval to distinguish a reported change from noise ([bench-runtime.mjs:640–672][source-188], [684–727][source-189], [752–763][source-190]). Its default release build command does not itself force Node islands off ([455–491][source-191]).

**Docs.** Process rows include startup; Node directly runs the TypeScript entries, including its type-stripping work. Server rows measure a warmed in-process phase with the same load client. Those are different questions and should stay separate ([runtime benchmark README:49–79][source-192]).

**nts today — docs.** nts already requires every row, explicit refusals and correctness evidence, and its arithmetic note asks for guard/clone costs, no-candidate programs, code-layout controls and compile-time measurements ([foundations/README.md:14–39][source-193]; [integral-arithmetic-regions.md:283–321][source-194]).

**Take it? Yes — inference:** retain correctness-first, per-row comparisons and representative calling contexts; add ScriptC native-only, explicitly profiled and island-enabled configurations as distinct future measurements.

For any follow-up, record the full compiler commit, target CPU/OS, runtime pack, optimization mode, island policy and actual island notes, profile training inputs, exception policy, and process-exit cleanup policy. Keep source workloads unchanged. Measure cold startup, warm execution, build time, executable size, peak memory and retained memory separately. Do not time an instrumented training build as the optimized result. Maintainers must remeasure on the benchmark machine before relying on a number; any off-machine result remains indicative.

## Comparison table

The section links are the evidence for each compressed comparison. “Yes” means take or refine the design, not that it is absent from nts; “later” means a measured or compatibility-dependent follow-up.

| Topic | ScriptC AOT | nts today | Take it? |
|---|---|---|---|
| [1. Types and soundness](#1-types-and-soundness) | Native representation checks, checked dynamic-call adapters, override refusals; some assertions erase. | Checked erased boundaries; literal-arrival and container-writer corrections remain incomplete. | **Yes:** validate actual arrivals and preserve provenance of inferred facts. |
| [2. Speculation](#2-speculation-without-a-profile) | Static facts, precompiled loop alternatives, a bailout counter and optional offline profiles. | Operator/guard facts and guarded clones; bounded region-entry versioning is proposed. | **Yes** to entry versions; **later** to repeated speculative checks and PGO, with measured costs. |
| [3. Numbers](#3-numbers) | Doubles by default; all-writer int32 analysis, guarded array widening, exactness and negative-zero checks. | Existing numeric facts with documented gaps; proposed certificates preserve original rounding and chosen integer widths. | **Yes:** invalidation and entry guards; **later** to pure recursive restart after proving effects. |
| [4. Objects](#4-objects-and-property-access) | Fixed native layouts plus dynamic shapes/dictionaries and data-only caches; selective identity-preserving views. | Fixed layouts, direct fields and interface access; dynamic additions are outside the representation. | **Later:** views and genuine dynamic caches; **no** to changing identity as a shortcut. |
| [5. Calls and closures](#5-calls-and-closures) | Direct/guarded/table calls, bounded copies, delayed/stack capture boxes and borrowed entries. | Direct/limited-set/table calls, closure specialization, boxed mutable and frame-placed captures. | **Yes:** refine existing machinery with module budgets, guards and ownership-aware entries. |
| [6. Compilation and fallback](#6-what-gets-compiled-and-the-fallback) | Native dynamic code; default automatic Node islands for eligible refused packages; native runtime code generation raises `EvalError`. | Engine-free output; runtime source evaluation refused at build time. | **No** to automatic engine fallback; **later** to a deliberate change in catchable-refusal policy. |
| [7. Memory](#7-memory-ownership-and-collection) | RC, generational trial deletion, selected arenas; opaque cycles and suspended generator abandonment remain limitations. | RC, trial deletion, borrowing/frame placement/call regions, with known ownership-analysis gaps. | **Yes:** arena closure and sanitizer checks; **later** to collector scheduling after profiling. |
| [8. Startup](#8-startup-module-initialization-and-images) | Compiled initializers, guarded module evaluation, explicit compile-time constants; Node starts lazily if used. | Native initialization; no documented general application-heap snapshot stage. | **Yes:** unused-registry reachability; **later** to explicit compile-time data construction. |
| [9. Size](#9-binary-size-and-linking) | Feature-selected runtime units, dead stripping, speed variants; islands add external deployment pieces. | ThinLTO and dead-section removal already built. | **Yes:** align runtime selection with initialization; **later** to controlled link-order experiments. |
| [10. Exceptions and suspension](#10-exceptions-async-functions-and-generators) | Pending exceptions plus selected native unwinding; stackless coroutines and fibers; explicit completion protocol. | Shared state machines/heap frames; indirect exception propagation and iterator closing have gaps. | **Yes:** completion/closing correctness; **later** to platform-specific unwinding. |
| [11. Builtins and data](#11-builtins-strings-arrays-typed-arrays-and-json) | Checked direct-layout JSON, explicit array states, removable string slices, shared typed-array backing stores. | Typed parse planned; numeric-hole defect; temporary slices planned; backing-store aliasing already supported. | **Yes:** finish checked JSON, truthful array states and temporary-view elimination; **no** to copying UTF-8 storage merely for parity. |
| [12. Losing cases and measurement](#12-where-it-loses-and-how-to-compare-it) | Documented import/exception tradeoffs; correctness-gated, interleaved benchmark runner. | Every-row correctness and refusal accounting; region design asks for guards, code growth and layout controls. | **Yes:** separate native, trained-PGO and engine-enabled configurations; no inferred universal win. |

## Sources and method

All external source links below and throughout the report identify full commit SHAs and file-line ranges. No moving branch is used as evidence. The report reads implementation and test intent; it does not establish whole-language soundness, execute the upstream test corpus, build either compiler, or claim new performance measurements. Upstream performance comments remain author reports. Descriptions are original prose; no upstream code was copied into nts.

The baseline was read in the requested order. The integral-region notebook is included at the current nts pin and explicitly treated as a proposed design. Repository workflow is followed through one new notebook in a draft pull request under the user's research-only exception; no compiler, test or other documentation file is changed.

### nts baseline

[README][source-195]; [architecture][source-196]; [types: casts][source-034]; [types: decisions and current defects][source-001]; [foundations entry point][source-197]; [numbers][source-198]; [objects][source-086]; [memory][source-125]; [strings][source-199]; [JSON][source-200]; [language boundaries][source-116]; [errors][source-150]; [async and generators][source-152]; [integral arithmetic: status and authorities][source-201]; [integral arithmetic: regions and rounding][source-202]; [integral arithmetic: versioning and validation][source-203]; [cloud-agent workflow][source-204].

### ScriptC implementation map

The section references provide the exact supporting ranges. These entry points make the audit reproducible without treating a README as implementation evidence.

| Area | Primary entry points |
|---|---|
| Frontend and executable policy | [pipeline][source-006]; [preparation][source-002]; [island policy][source-004] |
| Typed IR and native backend | [IR statements][source-005]; [emission analyses][source-009]; [LLVM helper][source-012] |
| Boundaries and numeric proofs | [conversions][source-015]; [range transfers][source-051]; [writer invalidation][source-054] |
| Objects and calls | [dynamic layouts][source-074]; [record views][source-081]; [callback specialization][source-092] |
| Memory and suspension | [cycle collector][source-119]; [arenas][source-122]; [generator lifetime][source-149] |
| Data construction and optimization | [JSON schema][source-157]; [array states][source-169]; [slice elimination][source-175] |
| Build and performance conditions | [runtime units][source-133]; [profile restrictions][source-048]; [benchmark runner][source-188] |

### Pinned file references

[source-001]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/language/types.md#L195-L217
[source-002]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L56-L71
[source-003]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L284-L304
[source-004]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/node-islands/policy.ts#L65-L105
[source-005]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/ir.ts#L2109-L2163
[source-006]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/pipeline.ts#L102-L109
[source-007]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L123-L131
[source-008]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L198-L222
[source-009]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emitter.ts#L723-L831
[source-010]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-module.ts#L142-L159
[source-011]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-module.ts#L363-L378
[source-012]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/native/llvm-codegen/src/emit.cpp#L477-L540
[source-013]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/docs/how-it-works.mdx#L28-L33
[source-014]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/architecture.md#L6-L45
[source-015]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lowerer.ts#L12430-L12505
[source-016]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/expressions/narrowing.ts#L1535-L1576
[source-017]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L2446-L2457
[source-018]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L2513-L2531
[source-019]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L12422-L12440
[source-020]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/class-assertions.ts#L36-L74
[source-021]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/type-mapper.ts#L2025-L2035
[source-022]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L5420-L5467
[source-023]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L5931-L5959
[source-024]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-node-island.ts#L562-L639
[source-025]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-classes.ts#L3578-L3743
[source-026]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lowerer.ts#L15300-L15312
[source-027]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/tests/corpus/6401-override-param-variance.ts#L1-L33
[source-028]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/limitations/untyped-values.mdx#L19-L20
[source-029]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/narrowing-stability.ts#L8-L43
[source-030]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/narrowing-stability.ts#L239-L270
[source-031]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/shape-inference/index.ts#L137-L142
[source-032]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/shape-inference/index.ts#L519-L560
[source-033]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L12382-L12427
[source-034]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/language/types.md#L82-L110
[source-035]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/integer-ranges.ts#L12-L31
[source-036]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/int32-slots.ts#L1432-L1445
[source-037]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/int32-slots.ts#L1670-L1752
[source-038]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/numeric-call-specialization.ts#L33-L87
[source-039]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/numeric-call-specialization.ts#L174-L185
[source-040]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/loop-entry-ranges.ts#L28-L109
[source-041]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/loop-entry-versions.ts#L82-L175
[source-042]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-statements.ts#L2586-L2618
[source-043]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-statements.ts#L3138-L3221
[source-044]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-statements.ts#L2315-L2317
[source-045]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-statements.ts#L2553-L2568
[source-046]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-statements.ts#L2673-L2687
[source-047]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/native/llvm-codegen/src/emit.cpp#L162-L212
[source-048]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/native-profile.ts#L75-L104
[source-049]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/numbers.md#L38-L90
[source-050]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L231-L265
[source-051]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/integer-ranges.ts#L12-L138
[source-052]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/int32-slots.ts#L1303-L1317
[source-053]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/int32-slots.ts#L1496-L1523
[source-054]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/int32-slots.ts#L1679-L1752
[source-055]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/contracts/check.ts#L829-L893
[source-056]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/contracts/check.ts#L935-L990
[source-057]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/int32-slots.ts#L1586-L1636
[source-058]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/speculative-integers.ts#L875-L904
[source-059]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/speculative-integers.ts#L1030-L1082
[source-060]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/speculative-integers.ts#L1098-L1107
[source-061]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/integer-ranges.ts#L97-L138
[source-062]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/integer-clones.ts#L8-L40
[source-063]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/integer-clones.ts#L149-L179
[source-064]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/integer-clones.ts#L1631-L1697
[source-065]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/tests/corpus/speculative-integer-loops.ts#L1-L119
[source-066]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/numbers.md#L24-L63
[source-067]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L3-L17
[source-068]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L31-L67
[source-069]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L90-L97
[source-070]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L131-L168
[source-071]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L231-L250
[source-072]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/classes.ts#L145-L231
[source-073]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/classes.ts#L461-L486
[source-074]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_dyn.h#L656-L707
[source-075]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L1051-L1080
[source-076]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/js-ic.ts#L47-L96
[source-077]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/js-ic.ts#L128-L175
[source-078]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_js.h#L217-L222
[source-079]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_js_object.c#L204-L254
[source-080]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/record-views.ts#L157-L203
[source-081]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/record-views.ts#L1-L18
[source-082]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/record-views.ts#L228-L268
[source-083]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L4378-L4423
[source-084]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/limitations/record-identity-and-property-order.mdx#L1-L34
[source-085]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_object.c#L77-L92
[source-086]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/objects.md#L28-L98
[source-087]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/objects.md#L224-L228
[source-088]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/classes.ts#L196-L231
[source-089]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/expr-calls.ts#L1378-L1462
[source-090]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/class-method-mutations.ts#L78-L105
[source-091]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/callback-specialization.ts#L7-L13
[source-092]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/callback-specialization.ts#L124-L175
[source-093]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/expr-calls.ts#L1021-L1081
[source-094]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/expression-inlining.ts#L25-L72
[source-095]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/expression-inlining.ts#L105-L117
[source-096]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_closure.h#L8-L22
[source-097]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_closure.h#L103-L135
[source-098]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/expr-calls.ts#L767-L827
[source-099]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/lazy-captures.ts#L26-L79
[source-100]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/stack-captures.ts#L14-L39
[source-101]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/expr-calls.ts#L1031-L1062
[source-102]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-node-island.ts#L152-L235
[source-103]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-node-island.ts#L562-L640
[source-104]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/objects.md#L107-L121
[source-105]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/objects.md#L185-L208
[source-106]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L284-L339
[source-107]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L143-L195
[source-108]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/docs/dependencies.mdx#L217-L221
[source-109]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/node/README.md#L3-L17
[source-110]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_node_island.c#L1355-L1445
[source-111]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-node-island.ts#L152-L189
[source-112]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/code-generation.ts#L67-L110
[source-113]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/docs/how-it-works.mdx#L142-L148
[source-114]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/executable/prepare.ts#L87-L221
[source-115]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/node-islands/libnode.ts#L167-L205
[source-116]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/language/boundaries.md#L44-L55
[source-117]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_rc.h#L9-L31
[source-118]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_rc.h#L116-L159
[source-119]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_cycle.c#L19-L124
[source-120]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_closure.h#L107-L117
[source-121]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_arena.h#L3-L31
[source-122]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/arenas.ts#L66-L143
[source-123]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_console.c#L38-L54
[source-124]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-module.ts#L600-L615
[source-125]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/memory.md#L1-L81
[source-126]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emit-module.ts#L1198-L1276
[source-127]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_console.c#L153-L195
[source-128]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-modules.ts#L3150-L3263
[source-129]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-modules.ts#L3456-L3601
[source-130]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/deferred-module-initializers.ts#L17-L60
[source-131]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/architecture.md#L6-L46
[source-132]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/runtime-pack-core.ts#L370-L428
[source-133]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/native/executable.ts#L385-L426
[source-134]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/targets.ts#L298-L393
[source-135]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/link-plan-core.ts#L42-L94
[source-136]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/numbers.md#L180-L198
[source-137]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_exception.h#L124-L175
[source-138]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emitter.ts#L4110-L4157
[source-139]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_exception.c#L289-L323
[source-140]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/unwind-abi.ts#L66-L89
[source-141]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emitter.ts#L4176-L4215
[source-142]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_unwind.c#L1-L37
[source-143]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emitter.ts#L2972-L3019
[source-144]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emitter.ts#L2199-L2221
[source-145]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/emitter.ts#L2126-L2132
[source-146]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_generator.h#L8-L35
[source-147]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/frontend/lowering/lower-generators.ts#L583-L626
[source-148]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_async.c#L6373-L6397
[source-149]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_async.c#L6423-L6537
[source-150]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/language/errors.md#L29-L39
[source-151]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/language/errors.md#L80-L100
[source-152]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/language/async.md#L49-L89
[source-153]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/builtin-signatures.ts#L44-L65
[source-154]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/ir/builtin-effects.ts#L3-L10
[source-155]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/reference-effects.ts#L19-L63
[source-156]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L1650-L1692
[source-157]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.h#L13-L25
[source-158]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.h#L92-L108
[source-159]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L1763-L1769
[source-160]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L1917-L1930
[source-161]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L13835-L13874
[source-162]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L14118-L14158
[source-163]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L14090-L14096
[source-164]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L13955-L14020
[source-165]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/expr-async.ts#L390-L401
[source-166]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/dyn.ts#L1979-L2034
[source-167]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/limitations/json-callbacks.mdx#L1-L12
[source-168]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_json.c#L14439-L14462
[source-169]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_array.h#L8-L67
[source-170]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_array.h#L140-L153
[source-171]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_array.c#L2913-L2943
[source-172]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/limitations/strings-and-sorting.mdx#L1-L9
[source-173]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_string.h#L9-L39
[source-174]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_string.h#L74-L92
[source-175]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/string-slices.ts#L21-L67
[source-176]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/compiler/src/backend/llvm/string-slices.ts#L127-L145
[source-177]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/packages/runtime/src/scr_bytes.h#L8-L76
[source-178]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/limitations/builtin-apis/arraybuffers-and-typed-arrays.mdx#L1-L7
[source-179]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/json.md#L6-L60
[source-180]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/objects.md#L124-L183
[source-181]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/strings.md#L6-L37
[source-182]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/strings.md#L88-L98
[source-183]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/benchmarks/runtime/README.md#L1-L47
[source-184]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/benchmarks/runtime/workloads/numeric-kernels.json#L1-L6
[source-185]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/native/llvm-codegen/src/emit.cpp#L70-L77
[source-186]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/native/llvm-codegen/src/emit.cpp#L200-L228
[source-187]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/docs/content/docs/cli.mdx#L164-L170
[source-188]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/scripts/bench-runtime.mjs#L640-L672
[source-189]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/scripts/bench-runtime.mjs#L684-L727
[source-190]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/scripts/bench-runtime.mjs#L752-L763
[source-191]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/scripts/bench-runtime.mjs#L455-L491
[source-192]: https://github.com/vercel-labs/scriptc/blob/b260a13dda56df0311c823e07ee2ca9a8a048166/benchmarks/runtime/README.md#L49-L79
[source-193]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/README.md#L14-L39
[source-194]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L283-L321
[source-195]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/README.md#L1-L30
[source-196]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/architecture.md#L1-L46
[source-197]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/README.md#L1-L39
[source-198]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/numbers.md#L24-L90
[source-199]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/strings.md#L1-L37
[source-200]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/foundations/json.md#L1-L60
[source-201]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L1-L67
[source-202]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L90-L168
[source-203]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/records/notebooks/integral-arithmetic-regions.md#L231-L321
[source-204]: https://github.com/AkisArou/nts/blob/01b93bdcc2f12d9c8cea687c30a3f1013bddd1f5/docs/contributing/cloud-agents.md#L128-L150
