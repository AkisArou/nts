# Open questions

**Every fundamental design question nts has not yet decided, across all
targets,** each with today's state and the coordinator's recommendation.
**research** means outside evidence is needed first; **user** means it is the
user's call (product direction or money). An answered question leaves this
page: its answer goes into the page it governs, and its dated entry into the
[decisions log](records/notebooks/decisions-log.md). Bureaucracy (signing,
store submission, paperwork) is out of scope.

The per-target picture is [`targets/`](targets/README.md); the JVM and Wasm
proposals are [`foundations/jvm-and-wasm.md`](foundations/jvm-and-wasm.md).

## Decide first

Ranked by how much each blocks or how much harm it does today.

| # | question | recommendation |
|---|---|---|
| 1 | **The builtins mechanism:** how each target says what it provides. Every global outside one fixed list waits on it (G1) | Approve [`foundations/builtins.md`](foundations/builtins.md), proposed 10-27 |
| 2 | **What happens when a type's claim is false at run time:** holes read 0, out-of-range reads abort, and on C and LLVM an object stored through a covariant array is called as the wrong class (L4, L5, L6) | One policy: represent `undefined` where JavaScript produces it (X1 generalized), check widening stores, throw `TypeError` on a failed erased cast |
| 3 | **Exceptions escape `try`** through closures in fields and overrides; stack exhaustion aborts (L14, L15) | A raising flag for every indirect call; everything JavaScript throws is catchable |
| 4 | **The clock and randomness** are refused although decision 2 provides them (G12) | Implement decision 2 as [builtins](foundations/builtins.md#the-clock-and-randomness) designs it |
| 5 | **`nts build` still writes a partial program** when a function is refused for a lowering gap; only a missing builtin stops it (L20) | Any refusal fails `nts build`; partial builds only behind a flag |
| 6 | **Decorators are silently dropped** (L10) | Refuse them until implemented |
| 7 | **No dependency policy, and system packages in the build** (libuv, OpenSSL, clang) against the decisions (D-1, T-1) | Write the policy; bundle the toolchain (zig) |
| 8 | **Compiled programs cannot be debugged or give stack traces** (X-1, X-2) | Line tables and `#line` by default; `Error.stack` from them |

## 1. Language and compiler

| # | question | today | recommendation |
|---|---|---|---|
| L1 | `eval` and `Function`: permanent boundary, or future? | refused "never provided"; `eval.md` keeps a design | **user:** a permanent boundary, except proved-constant source (`eval.md`) as a later optimization; eval tests leave the denominator |
| L2 | The `arguments` object | refused "not yet" | Implement it; it is legal strict code and common in npm JavaScript |
| L3 | Proper tail calls | none; test262 requires them, node lacks them | Follow node (L23): out of the denominator |
| L4 | Reads where JavaScript answers `undefined` but the type says a value is there: holes, out-of-range reads, uninitialized `var`, definite-assignment fields | mixed: 0 on C, abort, refusal on Wasm | One rule: a reserved NaN (number slots) and a reserved reference mean `undefined` where a slot is not proved written, so reads match node. X1, generalized. **research** (in the JVM/Wasm request) |
| L5 | TypeScript's unsoundness against typed layouts: covariant arrays, bivariant parameters | Widening between different element layouts is refused on all four (NTS1001). A wider `Sub` makes the widening itself refused (NTS1001), so a read past the object cannot arise. Between equal layouts, C and LLVM call a `Base` pushed through a `Base[]` alias of a `Sub[]` as a `Sub`; Wasm refuses the widening by name (NTS5001); the JVM refuses by name (NTS4001) only where the alias and the store share one function, and across a function boundary it aborts (`ClassCastException` at the read, `ArrayStoreException` at an indexed store). Pinned in `tests/outcomes/a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass*` | Refuse the widening at compile time where the layouts differ; check at the store where an idiom needs it. **research:** Dart, Static Hermes |
| L6 | Does `as T` do anything at run time? | erased-value casts stop by name; two documents disagree | Erased between known types; a failed check of an erased value throws a catchable `TypeError` |
| L7 | Member reads on `any`/`unknown` by a key known only at run time | refused; 547 of 578 such sites have a known receiver type | A name table per type, dispatched by the value's descriptor; this unlocks untyped JSON and npm JavaScript |
| L8 | Which tsconfig settings nts requires or obeys | 6 captured, 3 checked; strictness never captured | Require `strict` (layouts depend on `strictNullChecks`); list what is honoured |
| L9 | Generics that cannot be copied per type: polymorphic recursion, a library's exported generic classes | copies only, at most ten | An erased fallback: one shared copy over erased values. **research:** Go's GC-shape stenciling |
| L10 | Decorators, `accessor`, JSX | TC39 decorators **compiled away silently** on all four backends, pinned in `tests/outcomes/a-method-decorator-replacement-is-ignored*`; JSX only through React's transform | Refuse decorators now; implement the standard semantics later; JSX in core with TypeScript's emit as the oracle |
| L11 | Namespaces holding values; declaration merging | all refused (21 of 23 cases fail) | Implement them as TypeScript emits them |
| L12 | Run-time identity of classes and methods: a class per evaluation, `o.m === o.m`, `new.target`, `#x in o` | one static storage per class; `o.m !== o.m` on all four backends, pinned in `tests/outcomes/a-method-read-twice-is-two-different-functions*` | Match JavaScript identity, caching method values per class |
| L13 | What `declare` means | bound as a C function; the suite expects an environment value | `declare` is provided by the environment; C only through `c:` imports |
| L14 | Which run-time errors are catchable | only explicit throws; stack exhaustion, BigInt past 128 bits and failed `this` tests abort | Everything JavaScript throws is catchable: stack exhaustion is a `RangeError`. **research:** the cost of an entry check against guard pages |
| L15 | Exceptions through indirect calls | the raising copies miss closures in fields, overrides reached through a base that cannot throw, and a method called as a value even when its base can throw (the same call made directly is caught): **the throw escapes the `try`** on all four backends, pinned in `tests/outcomes/a-throw-from-a-closure-in-an-object-field-escapes-a-try*` and `a-throwing-override-escapes-a-try-through-a-base-that-cannot-throw*` | A raising flag in the calling convention for every indirect call, as Swift does |
| L16 | Generators, the iteration protocol, `using` | iteration 1 of 16 cases, `using` 0 of 10 | The full protocol, as phase 3 work |
| L17 | Top-level `await`, `import.meta`, JSON and text modules | refused or not lowered | Implement them; `import.meta.url` as `bun build --compile` defines it. **research** |
| L18 | CommonJS and sloppy-mode JavaScript | `.js` compiles with inferred types; sloppy mode excluded only for test262 | **user** (with D-4): strict ESM for sources, CommonJS dependencies through an interop layer |
| L19 | The TypeScript version policy | tsrs 0.19.0, TypeScript 7.1.0-beta | Follow tsrs releases of stable TypeScript; upgrades gated by the four suites |
| L20 | Partial builds | `nts build` stops for a builtin nothing provides (NTS1100, NTS1101); any other refusal still writes a program without the refused functions, and refused top-level statements are cut | Any refusal fails `nts build` |
| L21 | Diagnostics: marking permanence, and early errors | inconsistent wording, no code registry (NTS5001 means three things: the scalar check, an LLVM internal error, a Wasm decline); 1,315 negative test262 cases accepted | A diagnostic registry (code, permanent or not, message); complete the early errors (phase 3) |
| L22 | Separate and incremental compilation | whole program only; no cache | Closed world for executables; libraries declare an export surface with L9's fallback; a validated cache later. **research:** Kotlin/Native, Swift |
| L23 | Which oracle wins when test262 and node disagree | unstated | Node: the promise is "behaves like node"; the boundary set is written down |
| L24 | How `globalThis` costs nothing where unused | refused; in scope for later (user, 10-27): after the static foundations, and discussed before any design | A static `globalThis.X` folds to the binding; only a dynamic read or write builds a global object, holding just the globals the program can reach |
| L25 | How `Proxy` and `Reflect` cost nothing where unused | refused; in scope for later (user, 10-27): after the static foundations, and discussed before any design | Only values a `new Proxy` can reach take the trap path, which the compiler proves; every other access stays direct |
| L26 | How object integrity (`Object.freeze`, `seal`, `preventExtensions` and their predicates) costs nothing where unused | refused; in scope for later (user, 10-27): after the static foundations, and discussed before any design | A flag in the object's header, checked on a write only where a freeze can reach the object |

## 2. Builtins and globals

| # | question | today | recommendation |
|---|---|---|---|
| G1 | The provider mechanism | one name list for every target; NTS1100 stops a build that reaches a missing builtin | Proposed: [`foundations/builtins.md`](foundations/builtins.md) |
| G2 | Host or own, feature by feature | only Intl and RegExp decided (host on JS hosts) | Own by default (exactness); the host only where decided; Node addons own |
| G3 | Feature detection: `typeof X === "undefined"`, `"X" in globalThis` | folds for intrinsics only | Fold both forms per target at compile time; `globalThis` itself is L24 |
| G4 | Node's types in the one lib | no rule | `types: ["node"]` where a profile provides `node:*`; node's timer types on native, the DOM's elsewhere |
| G5 | Web globals for native apps | `runtime/sdk`'s lib subset, unimplemented | WinterTC's Minimum Common Web API as the floor on native and the JVM; retire the subset (decision 11) |
| G6 | Chromium's overlay | listed in tsconfig | Injected by `target.chromium()`, checked against lib.dom; Blink errors as `DOMException` |
| G7 | Web platform coverage | TypeScript exists for most, bound to no global | The WinterTC floor as plan of record; `URL` lives in `runtime/web-platform`; carry out decision 10 |
| G8 | Platform network stacks or the shared engine | the shared engine; OkHttp on Android | The shared engine first; platform stacks only where store rules require. **research:** trust stores, proxies |
| G9 | `runtime/web-platform`'s JSON parser | runs `json-parse`; documents disagree | Stays the untyped path until the compiler's untyped parser exists, then becomes a test oracle |
| G10 | `node:*` scope and how programs reach it | 28 modules, no resolver | Owe the 28; a `node:` resolver and `process`/`Buffer` globals in the native profile |
| G11 | A Node addon: node's builtins or ours | ours | Ours (one semantics); revisit by size |
| G12 | The clock and randomness, and the seeded test mode | refused (contradicts decision 2); a JVM runnable jar runs its timers on a virtual clock | Designed in [builtins](foundations/builtins.md#the-clock-and-randomness): real providers by default, deterministic ones pinned only by the test profile. `Math.random` is V8's generator, which reproduces `node --random-seed=N` exactly (checked) |
| G13 | Time zones without Intl | local time refused | Node's pinned TZDB, emitted as data only into programs that use local time. **research:** size |
| G14 | Intl locales and data | providers exist, unbound | Locales declared in `nts.config` (default `en`), with ICU's fallback; never the device's ICU (D2, D3). **research:** sizes |
| G15 | Temporal on Wasm, and whether to provide what node lacks | refused everywhere; node 24.20 has no `Temporal`, Bun 1.4 has it (checked 10-27) | `runtime/ecmascript`'s wherever the host lacks it, node included. **user:** providing a builtin node lacks goes beyond "behaves like node". **research:** browser support |
| G16 | Crypto and randomness sources | none in `runtime/c` | The OS's CSPRNG per target; `subtle` from vendored OpenSSL, JCA, or the host |
| G17 | The DOM in a browser | refused | **research** (W5), then WebIDL-generated `externref` imports in Chromium's binding shape |
| G18 | `console` beyond strings | strings only | `util.inspect`-compatible formatting in shared TypeScript; output to each platform's log |
| G19 | `SharedArrayBuffer`, `Atomics` | refused | With workers (C-1); **user:** Android's API floor (VarHandle needs 33) |

## 3. Memory

| # | question | today | recommendation |
|---|---|---|---|
| M-1 | How much a region or reuse may keep alive | "a bound per active call", no number | Set it from stage 0's census |
| M-2 | The 16-byte header: where the candidate index goes | later | Stage 6, measured |
| M-3 | The cycle collector: its throughput, its pauses, and returning memory to the OS | trial deletion with a fixed 10,000-candidate trigger; glibc's thresholds. `cyclic-churn` is 8.4× node, two thirds of its cycles in the collector, where the JVM is 1.1× | Typed visitors in memory stage 1; then pause-time and RSS rows, an adaptive trigger, and purging with stage 6. **research:** trial deletion against a backup tracing pass for cyclic garbage |
| M-4 | Cycles through Objective-C blocks | design open | **research:** whether a block's retains can be observed |
| M-5 | Weak references off native | J1 and W1 proposed | **research** (the JVM/Wasm request) |

## 4. Concurrency and async

| # | question | today | recommendation |
|---|---|---|---|
| C-1 | What a worker is | one shared environment | The web `Worker` API first: a thread per worker, an isolated environment, structured clone and transfer, literal hashes per thread |
| C-2 | `SharedArrayBuffer` and `Atomics` semantics | deferred | Memory stage 9, on C11 atomics; `Atomics.wait` refused on the main thread, as browsers do |
| C-3 | A thread nts does not own entering the runtime | aborts with libuv's host; **unchecked** without one (addons, libraries) | Build record 0018: the runtime owns the check; `c:` callbacks may opt into posting to the owner |
| C-4 | One async runtime or three (C, JVM, Wasm) | three implementations | One contract, enforced by shared ordering fixtures on every backend |
| C-5 | Two microtask queues on JS hosts | Chromium already runs the program's jobs on Blink's queue; Wasm in a JS host keeps its own queue, drained at each export | Adopt the host's queue wherever promises cross, as Chromium does. **research:** ordering traces |
| C-6 | How native `setTimeout` clamps its delay | its own rule; by reading, it orders differently from node | Node's rule on native, HTML's in Chromium and browsers; a two-arm fixture now |

## 5. Interop and hosts

| # | question | today | recommendation |
|---|---|---|---|
| I-2 | Host failures reaching a `catch` | GError, NSError, HRESULT built; Java declines; `NSException` and C++ exceptions nowhere | Every host error becomes a catchable `Error` carrying the host value. **research:** unwinding through setjmp |
| I-3 | Callbacks on threads nts does not own | a different answer per host; GLib has none | One rule: carry to the owner thread; refuse calls that must return a value from another thread |
| I-4 | Promises across a boundary | N-API refuses; C embedders drain microtasks by an unwritten rule | N-API: a deferred plus a threadsafe function; document `nts_checkpoint` for C embedders |
| I-5 | Ownership of plain C pointers | by hand; ResourceFlow unbuilt | ResourceFlow with enforcement; state that M5 covers the language, not binding declarations |
| I-6 | Cycles through host objects | collected on GTK only | Memory stage 7; Chromium's joint collection; an N-API family once record 0356's references exist |
| I-7 | More than one instance per process | shared statics per `napi_env` | One instance per process for now, refused clearly; the instance becomes a parameter with workers |
| I-8 | One DOM source for Chromium and browser Wasm | Blink's IDL for Chromium; nothing for Wasm | One generator over one IDL set. **research:** coverage of webref against Blink's IDL |
| I-9 | Supported engines and the WASI version | JS String Builtins and `JSTag` required | Current Chromium, Firefox and Safari; WASI 0.2 first. **research** |

## 6. Bindings, products, toolchains, dependencies

| # | question | today | recommendation |
|---|---|---|---|
| B-1 | What `bind-c` derives | named items only | Whole headers with an overrides file, after ResourceFlow |
| B-2 | Per-target bindings against "typecheck once against the intersection" | written, not implemented | Implement the intersection check |
| B-3 | Platform surface packages: published or generated locally | generated locally | Generate locally by default; **user:** publish only the permissively licensed ones (GIR, Win32 metadata) |
| S-1 | Wasm as a product in `nts.config` | no Wasm target or product | `target.web()` and `target.wasi()` with ES-module and component products, after Binaryen |
| S-2 | Library surfaces beyond functions | classes cross nothing | Opaque handles in the C ABI; generated Swift, Kotlin and Java wrappers later |
| S-3 | Shipping to npm | builds at install time | Prebuilt binaries per platform, as esbuild and swc do |
| S-4 | The Chromium app's shape | two options written | **user:** a separate app process with IPC, as Electron |
| T-1 | A bundled toolchain or an installed one | system clang (or zig), node for configs | Bundle zig (clang, lld, libcs) as the default. **research:** size, licences |
| T-2 | LLVM version coupling; ThinLTO on cross builds | text IR; cross builds without LTO | Text IR at the bundled LLVM's version; ThinLTO through `zig cc`. **research** |
| T-3 | Which hosts run nts | Linux | **user:** Linux, then macOS (Apple silicon); Windows through WSL |
| D-1 | A dependency policy | each library chosen alone; contradicted by the code | A foundations page: exactness against node, permissive licence, size, built from vendored source, linked only when used; platform SDKs are not "system packages" |
| D-2 | Binaryen inside the compiler | decided, not adopted | Vendored and built from source at W7's pin. **research:** build time, size |
| D-3 | The platform's ICU, or a bundled one | ICU4J bundled | Bundled (exactness, D2 and D3); revisit for mobile size |
| D-4 | npm packages that ship only JavaScript (about 87%) | none compile | **user:** compile `.js` against its JSDoc and `.d.ts` types (record 0011) as the main path, plus ports of the top packages |

## 7. Performance and compile time

| # | question | today | recommendation |
|---|---|---|---|
| P-2 | Startup time, executable size, peak RSS as rows | not measured, though decided ("a code-size check") | Add the rows (stage 0 instruments) against node and Bun |
| P-3 | Regression against noise | sign over two rounds | Paired A/B, at least 5 processes, band = max(3%, 2× spread); counts for deterministic rows |
| P-4 | The quiet host and the comparators' versions | one quiet core; Bun, the JDK and clang unpinned | Pin all comparators; acceptance numbers only with no gate running; load recorded in every report |
| P-5 | Which numbers gate | none | Native instruction counts in the full run, with the noise band (native counting drivers first) |
| P-6 | What the compile-time guard covers | `hir --prepared` on runtime modules, full run only | Add backend and link time; core for compiler changes |
| P-7 | Analysis budgets | caps of 32 and 256 rounds once caused a defect | Budgets scaled by program size, reported when exhausted (with M1) |

## 8. Process: gate, conformance, testing

| # | question | today | recommendation |
|---|---|---|---|
| Q-1 | Counting steps per landing | full run only | *Decided 10-27, being built:* `rc` and `memory` for C backend changes, `llvm-rc` for LLVM backend changes, and all three for compiler core and the C runtime |
| Q-2 | A halved train can drop the step that failed | it did on 10-27: a culprit landed | *Being fixed:* each half runs what it owes plus the red steps, and a step red on `main` itself is reported as red on main, not blamed on a landing |
| Q-3 | Full-run cadence; test selection | by hand; `--touching` unbuilt | Nightly full run, weekly cache-off run; `--touching` only after a determinism test |
| Q-4 | A ratchet that rises | records re-recorded by hand | A per-case ratchet, recorded through reviewed `results:` commits |
| Q-5 | Node's own tests; moving the node pin | lane-local; no bump rule | The pin moves with node LTS releases and D2's Unicode pin; node's tests gate when the node lane resumes |
| Q-6 | Generated programs and fuzzing | not started | Yes: a differential program fuzzer as a phase 2 instrument (review, not the gate, found the memory defects) |
| Q-7 | Proving optimized output memory-safe | ASan for opted-in fixtures only | A sanitized, counted differential run over the corpus in the full run |

## 9. Debugging, reproducibility, security, versioning

| # | question | today | recommendation |
|---|---|---|---|
| X-1 | Debug and profile builds | no DWARF or `#line` from C or LLVM | `#line` plus line tables by default; frame pointers on (measured); an unoptimized debug profile |
| X-2 | `Error.stack`, and the report of an uncaught error | `stack` refused. C, LLVM and the JVM print `nts: uncaught Error: boom` and exit 1, as node does, though node also prints the source line and the stack. Wasm exits 1 with a decline (NTS5001) | `stack` symbolized from line tables on demand; node's report format. **research:** cost |
| X-8 | Vendored assertions in release builds | kept: release builds define no `NDEBUG`, so a vendored `assert` (zmij's, for one) stays in shipped code | Keep them, since they guard vendored code nts does not edit, unless a benchmark row shows their cost; then decide per library |
| X-4 | Hash flooding | unseeded | The pending A/B and J2 |
| X-5 | Bounds checks | proved or checked; a rule only in records | Record the rule in `decisions.md`, with L4's answer for out-of-range reads |
| X-6 | Stack exhaustion | aborts; Windows has no handler | L14 |
| X-7 | The library ABI and the schema version | record 0018's ABI version unbuilt | Build it; the result cache keys on schema, compiler and runtime digests |

## 10. Platforms and hardware

| # | question | today | recommendation |
|---|---|---|---|
| A-1 | How Apple, Windows, Android and arm64 are verified | no Mac now (the VM's macOS was Intel's last); Windows VM only; no arm64 Android | **user** (money): an Apple-silicon Mac, a Windows machine and an arm64 device, or hosted CI; until then they stay unrun at landing (decided) |

## Contradictions

**The code goes against a decision:** fix the code, or change the decision.

1. Decision 2 provides the clock and randomness; lowering refuses them (G12).
2. Decision 10 removes `runtime/node`'s own `URLSearchParams`, `Blob` and `File`; they remain (G7).
3. libuv is decided to come from node's sources; host builds link the system's (D-1).
4. OpenSSL is decided vendored; `crypto` links the system's libcrypto (D-1).
5. "nts never depends on a system package"; host builds need the system clang, and configs need node (T-1).
6. Counting is the shipping mode; no landing ran it (Q-1, now decided).
7. The plan's performance tiers do not exist (P-5); "a code-size check" is required and nothing measures size (P-2).
8. Record 0018 deletes `is_owner_thread`; the code answers true when no host is installed (C-3).
9. "One answer per question across backends"; holes and covariant stores get a wrong answer on C and LLVM; covariant stores are refused on Wasm and abort on the JVM across a function boundary (L4, L5).
10. `as` throws in `any-unknown.md` and is erased by D4 (L6).
11. `runtime/sdk` selects no providers and keeps a lib subset, against decisions 6 and 11 (G5).
12. Decorators are a silent wrong answer, while the plan puts wrong answers first (L10).
13. The tsrs patch adds a checker API beyond what its decision allows ("for the two crashes only").

**Code and scripts behind the documents:** small fixes, each its own change.
- `tooling/gate/with-lock.sh` and `wait-idle.sh` disagree on whether
  measurement needs a quiet machine.
- The project's `CLAUDE.md` names only node as the bar; the bar is node and
  Bun (the user's file to change).
- Comments behind the code: `compiler/semantic-schema/src/schema.rs` cites the
  deleted `cache.rs`; `NtsGrisu.java` the removed `nts_grisu.h`; the `parseFloat`
  comment names `strtod` (the code uses ffc); `refused_by_name` in `lower.rs`
  lists async generators, which compile; `builtin.rs` calls BigInt absent.
- `tests/refusals/a-lone-surrogate-in-a-string-literal` expects three U+FFFD,
  while the semantic schema now keeps lone surrogates.
- Code comments cite documents that moved to `docs/records/notebooks/` in the
  documentation restructure. The sweep is prepared (`helper/docs-citations`)
  and lands through the fast lane for comment-only changes.
- The `nts` help text says "See docs/nts-config.md" (`tooling/cli/src/main.rs`);
  the page is `docs/reference/nts-config.md`.
- Eighteen `runtime/node/*/not-applicable` files give reasons citing
  `typescript.md` §13; their boundaries are now sections of
  `docs/language/boundaries.md`.
