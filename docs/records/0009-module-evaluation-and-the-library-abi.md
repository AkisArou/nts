<!-- Design record 0009. Written after five independent investigations of the
     tree and five adversarial reviews; §0 is what was measured, not what was
     assumed. Nothing here is implemented yet except the module graph itself
     (`ModuleRecord.imports`, `nts modules`) and the NTS0002 truncation
     warning. -->

# Module Evaluation and the Library ABI

**Design record. A single proposal; every section decides.**

Grounded in code read at commit `b2a4468` plus the uncommitted `link_modules` change. Every claim is a file:line I opened or a measurement made in this tree. Where neither, it says so. This revision resolves every fatal and major finding from five adversarial reviews; §14 lists the two places a reviewer was wrong and why.

---

## 0. What was measured

### 0.1 The original nine (all confirmed, all still true)

**M1 — A two-module program drops *both* modules' top-level code and exits 0.** `module_statements` returns `(None, refusals)` when `files.len() > 1` (`compiler/core/src/hir/lower.rs:971-983`) — the `None` discards the *first* file's statements too — and `emit_c` only `eprintln!`s diagnostics (`tooling/cli/src/main.rs:938-946`) before writing the artifact. `Severity::Error` is documented as "The build cannot produce an artifact" (`compiler/diagnostics/src/lib.rs:79-81`).

**M2 — `node:path` compiles wrong.** 120 error diagnostics, exit 0, `program.c` written, `grep -c module__init program.c` = 0. The conformance lane (`tooling/conformance/build.sh:52-57`) builds and tests that artifact.

**M3 — `export default <expression>` is dropped with no diagnostic.** `carries_code` (`lower.rs:471-484`) asks "does this subtree contain a node in `is_module_statement`". An `ExportAssignment` contains a *CallExpression*, not an *ExpressionStatement*, so the recursion returns false and the `else if` at `lower.rs:957` skips it. The doc comment at `lower.rs:465-470` claims this classifies unseen constructs correctly "the first time"; it does not.

**M4 — `examples/library` declares an export that produces no symbol, silently.** `greeting` (`examples/library/src/main.ts:5`) yields no symbol and no diagnostic: `ModuleScope.unsupported` is refused-on-use by design (`lower.rs:62-69`) and nothing reads it. The manifest declares it (`examples/library/nts.config.ts:23`).

**M5 — Two nts shared libraries in one process silently share one heap.**

| build | `dlopen` mode | A live | B live |
|---|---|---|---|
| default visibility | `RTLD_GLOBAL` | 1 | **2** ← B allocated into A's heap |
| default visibility | `RTLD_LOCAL` | 1 | 1 |
| `-fvisibility=hidden` + `NTS_PUBLIC` on exports | `RTLD_GLOBAL` | 1 | **1** |

`nm -D --defined-only` on the module-init example as a `.so`: **102 exported symbols**, including `bump` (never `export`ed in TypeScript). With hidden visibility: 1.

**M6 — Live bindings across modules do not work.** `import { n } from "./a.js"` gives `n` an alias symbol at the import site; `collect_module_scope` keys `variables` by the *declaring* symbol (`lower.rs:719-725`). Different ids, miss → NTS1001. Assignment to an imported binding is already fatal upstream (tsgo `TS2632`, `tooling/cli/src/main.rs:895-901`).

**M7 — The napi addon never evaluates modules and never installs a host.** `NAPI_MODULE_INIT` (`compiler/codegen/napi/src/lib.rs:393-401`) contains only `napi_create_function` pairs.

**M8 — `nts_host_install` silently clobbers.** `runtime/c/nts_runtime.c:1428-1431` is `nts_host = *host; nts_host_installed = true;` with no guard. The uv host aborts correctly (`nts_uv_host.c:328-330`).

**M9 — The runtime's two queues have no teardown.** `nts_microtask_queue` / `nts_tick_queue` (`nts_runtime.c:1451-1452`) have no free and no drop path, which `docs/async.md:183-192`'s run-or-cancel contract requires.

### 0.2 Five more, found by review, all fatal

**M10 — A module-scope declaration with a non-constant initializer is silently dropped, and step 4 of the previous plan could not reach it.**
```ts
let seen = 0;
function note(n: number): number { seen = n; return n; }
const started = note(7);
export function read(): number { return seen; }
```
Emits `static double seen = 0.0;` and a `read()` returning it. No diagnostic, exit 0. `read()` answers 0; node answers 7. Root cause is *two* classifiers disagreeing: `is_module_statement` (`lower.rs:411-444`) excludes `VARIABLE_STATEMENT` on the stated grounds that "a module-scope declaration is a global with a static initializer, which needs no code to run" — false whenever the initializer calls anything — and `is_module_declaration` (`lower.rs:451-465`) *includes* it, so the `else if !is_module_declaration(kind) && carries_code(...)` at `lower.rs:957` short-circuits before `carries_code` is ever consulted. Fixing `carries_code` does not touch this path. Worse, the same program is refused or silently wrong depending on which binding a downstream function reads: change `read` to return `started` and `collect_module_scope`'s `unsupported` entry (`lower.rs:749-755`, "a module-scope variable whose initializer is not constant") turns into NTS1001 on use.

**M11 — Type-only imports produce evaluation edges.** `link_modules` (`compiler/frontend-ts/src/tsgo/mod.rs:1487-1499`) filters on node kind and then on `import_target`; nothing consults type-only-ness, and nothing can: `NodeRecord` (`compiler/semantic-schema/src/schema.rs:542-556`) carries `flags: u32` (tsgo `NodeFlags`) and `DeclarationModifiers` (`schema.rs:142-158`, twelve modifier-keyword bits), and `isTypeOnly` is neither. ESM erases a type-only import entirely — the target is never fetched and never evaluated. So the order would evaluate modules node never loads, and a cycle refusal would refuse programs node runs.

**M12 — `create → shutdown → create` re-evaluates every module over statics nothing reset.** Measured against the real `runtime/c/nts_runtime.c`: RFC §36.4's loop (`docs/RFC.md:3179-3187`) run three times gave `reading` = 3, then 5, then 7. Node answers 3 every time. Exit 0, no diagnostic. Second defect in the same run: a handle defined as the address of the descriptor is a compile-time constant with no generation, so a handle held across shutdown validated against the *next* runtime.

**M13 — Static products defeat the visibility mechanism entirely.** Two static products, each compiled `-fvisibility=hidden`, each archiving its own `nts_runtime.o`, linked into one executable: A live=1, **B live=2**. No link error, no diagnostic — `ld` pulled `nts_runtime.o` from the first archive and never extracted the second's. Both then share `nts_allocated` (`nts_runtime.c:18`), `nts_host` (`:1424`), `nts_depth` (`:1426`), both queues (`:1451-1452`) and the collector's root buffer (`:293-300`). `-fvisibility=hidden` and version scripts are ELF *dynamic*-symbol mechanisms; a static archive has no dynamic symbol table.

**M14 — The napi product has N runtimes per image, on N threads.** `NAPI_MODULE_INIT()` expands to node's context-aware `NAPI_MODULE_INITIALIZER`, called once per `napi_env` — the main thread and every `worker_threads.Worker` that requires the addon. `process.dlopen` on the same realpath returns the same image, so every Environment shares `program.c`'s and `nts_runtime.c`'s file statics on different threads. `nts_uv_host_install` would see `nts_uv_installed` true and `nts_uv_fail("installed twice")` → `abort()` (`nts_uv_host.c:66-68, 328-330`), killing the whole process; with a status-returning guard instead, the Worker runs against the main thread's loop and `nts_uv_owner` (`nts_uv_host.c:47`), and its first post hits `nts_uv_require_owner` → abort (`:192-198`). `nts_retain`/`nts_release` are non-atomic by written design (`nts_runtime.c:183-186`).

The through-line: **every one of these is a wrong answer with exit status 0.** That is what this design is for.

---

## 1. Module evaluation order

**Decision: depth-first post-order over `ModuleRecord.imports`, computed at compile time, emitted as a straight-line sequence of direct calls in one generated HIR function. No runtime module registry, no per-module initialization flag.**

```
roots = the product's entry module (required for a library; --main's entry for an executable)

visit(m):
    if m in finished: return
    if m in started:  refuse NTS1010 (cycle), naming the path
    started += m
    for each t in modules[m].imports:      # source order, deduplicated
        visit(t)
    started -= m; finished += m
    order.append(m)

visit(entry)
```

Post-order over imports is literally ESM's `InnerModuleEvaluation`. `module_statements`' current comment ("whose evaluation order this compiler cannot see", `lower.rs:977-978`) is now false: the graph exists, and `nts modules` prints it.

**Why compile time, not a registry.** The graph is fully static once dynamic `import()` is refused (§7). A registry buys exactly one thing — evaluating a cycle with a temporal dead zone — and this compiler has no TDZ representation, so it cannot use it. `docs/node-js.md:516-525`'s four-state machine is the right shape *if* cycles are ever supported; it is cited as prior art, not authority.

### 1.1 What is an evaluation edge (M11)

An `IMPORT_DECLARATION` or `EXPORT_DECLARATION` contributes an edge when **TypeScript's own emit would keep it**:

1. it has no import clause at all (`import "./x.js"` — always an edge, and this is why `link_modules` keys on the specifier's symbol rather than the clause); or
2. it is not marked `type`, and at least one of its bindings is not marked `type` **and** resolves to a symbol with a value meaning (`SymbolFlags::VARIABLE | FUNCTION | CLASS | ENUM | …`, `schema.rs:290-293`).

Clause (2)'s second half is checkable in today's snapshot; its first half is not — `isTypeOnly` is absent from `NodeRecord` (M11). **Decision: extend the schema.** `DeclarationModifiers` gains `TYPE_ONLY = 1 << 12` (`schema.rs:158` is the last bit used), set by the tsgo encoder on `import type` / `export type` declarations and on individual `{ type T }` specifiers. It is written like a modifier keyword; that is where it belongs. This is step 0 of the migration, and nothing in §1 may land before it: an order computed over an over-approximated graph is a wrong answer, not an approximate one.

### 1.2 Alias resolution — where M6 is fixed

Same data, same pass. For `import { n } from "./a.js"`, take `import_target`'s `ModuleId` and look `n` up in `snapshot.modules[t].exports` (populated at `compiler/frontend-ts/src/tsgo/symbols.rs:146-162`). That yields the *declaring* symbol, which `ModuleScope.variables` already keys on. Live bindings then work by construction: both modules name the same C storage.

### 1.3 Modules not reachable from the entry

ESM does not evaluate them, so neither do we. If such a module carries top-level code, **NTS3005 (warning)**. Warning, not error: the build is correct and the user is probably surprised. This is safe for a library too, because §6.2 makes the declared surface the *entry module's* export table — a module unreachable from the entry cannot contribute a declared export, so the "reachable from outside but never evaluated" hole a reviewer found in the previous draft cannot exist.

---

## 2. What is emitted

### 2.1 Names

**Decision: every generated function and every module-scope global carries a module key, always. The key is the workspace-relative path with the extension stripped and `/` → `.`. Declared exports additionally carry a product prefix in their C symbol.**

`src/counter.ts` → key `src.counter`.

| HIR name | C name |
|---|---|
| `src.counter#init` | `src___counter__init` |
| `src.counter#count` (a global) | `src___counter__count` |
| `bump`, declared in counter.ts | `src___counter__bump` |
| the orchestrator, `module#evaluate` | `module__evaluate` |
| the declared export `reading`, product `counter` | `counter_reading` |

`c_identifier` already maps `.` → `___` and `#` → `__` (`compiler/codegen/c/src/emit.rs:596-607`), and neither can appear in a TypeScript identifier, so this reuses the existing mechanism. Module-first matches the existing `Class#method` convention: `#` means "member of".

**This deletes `naming()`** (`lower.rs:666-707`), whose scheme is `format!("{name}@{module}")` with `module` = **file stem** (`lower.rs:698-704`) and which qualifies *only on collision*. Two `util.ts` in different directories map to one key, and a symbol whose spelling depends on what else is in the program is not a stable name. It also deletes the `-Ddirname=nts_node_dirname` hack, whose comment (`tooling/conformance/build.sh:36-39`) already says "Remove both when the module-qualified naming of RFC §27.1 lands": `dirname` becomes `runtime___node___path__dirname`.

**Why exports get a product prefix.** `log`, `read`, `write`, `open`, `close`, `time`, `index`, `remove`, `exit`, `abs`, `div`, `random`, `send`, `signal`, `system` and `error` are all ordinary TypeScript export names and all libc/libm symbols. A version script's `global:` list does not prevent a collision — it guarantees the symbol *is* exported at default visibility, which is the collision. Under a static link the archive member can satisfy a program's call to `log()`, with a `double` reinterpreted as an `NtsTextView`. The prefix costs a consumer one mechanical rename and removes the whole class. The declared *JavaScript* name is unchanged everywhere it is observable: the descriptor lists it, the generated header documents it, and a napi addon still registers `exports.reading`.

### 2.2 The orchestrator is an HIR function, not hand-written C

**One `<key>#init` per module that has top-level statements, plus exactly one `module#evaluate`, always, whose body is a direct call to each init in evaluation order.**

The orchestrator is lowered as a real HIR function — not emitted as C text by the backend. This is what makes root sets work at all (§6.3): reachability matches HIR `func.name` by exact string (`compiler/core/src/hir/reachable.rs:111-116`), and the executable's entry is literally `let entry = [hir::lower::MODULE_INIT.to_owned()]` (`tooling/cli/src/main.rs:935`). Hand-written C in the emitter is invisible to that pass, so per-module inits would be pruned as unreachable and the program would silently become the empty one M1 already produces.

Per-module rather than flattened, because:
- **Provenance.** `Origin.location.file` on each init points at the module it came from; RFC Decision 20 (`docs/RFC.md:3501`) is not satisfiable from a flattened init.
- **HMR.** RFC §32.5 (`docs/RFC.md:2423-2434`) registers module exports *per patch*; per-module inits are the unit a patch replaces.
- **It is nearly free.** N direct calls to statically-known functions in a function called once.

It is *not* free the way the previous draft claimed. Under §3 the orchestrator is reached through a function pointer handed to `nts_enqueue_microtask` in another translation unit, so LTO cannot delete it and the entry to the program is an indirect call out of a queue. The honest cost is stated in §5.

Always emitting `module#evaluate` **deletes the `initializes: bool` parameter** from `standalone_main` (`emit.rs:57-67`), from `tooling/differential/src/lib.rs:846-849`, and from the flag `write_standalone` computes at `tooling/cli/src/main.rs:860-864`. The same `.any(|f| f.name == MODULE_INIT)` predicate is duplicated in three places and absent from a fourth — which is exactly M7. A symbol that always exists cannot be conditionally forgotten.

Each synthesized init and the orchestrator carry `Origin::generated(loc, GeneratedReason::ModuleInitialization)` — the variant exists at `compiler/semantic-schema/src/origin.rs:86` and is constructed nowhere in the tree; `lower_module_init` currently uses plain `self.origin(file)` (`lower.rs:2614`).

### 2.3 When an init is elided — and the fold that is *not* happening

**Decision: an init is emitted exactly when its module has at least one module statement. There is no constant-folding of statements into initializers.**

The previous draft folded a body of constant stores into `Global::initial` and argued soundness from the cycle refusal. Two reviewers found the argument incomplete in the same way: a folded store runs at image load, a non-folded one at `nts_runtime_create`, and any future reset path has to know which globals are in which category. **The fold is deleted.** What survives is the rule that already exists and that everyone endorsed: a declaration whose initializer is a compile-time constant is a `Global` with an `initial` and produces no code (`lower.rs:783-798`); `const` folds to a value (`lower.rs:781-787`); module-scope string constants fold to a pointer to a static immortal `NtsString`, which is already exactly how string literals are emitted (`emit.rs:1025-1055`, `NTS_IMMORTAL`).

Elision is then a syntactic fact about a module, not an analysis result, and needs no soundness argument at all. A program with no top-level code anywhere emits `NtsStatus module__evaluate(void) { return NTS_OK; }` — no task, no queue allocation, no checkpoint (the previous draft's unconditional enqueue would have malloc'd a 16-entry ring, `nts_runtime.c:1453-1471`, for a library that is nothing but pure functions).

### 2.4 Module-scope declarations are classified per declaration (M10)

**Decision: `VARIABLE_STATEMENT` leaves `is_module_declaration`. Each declarator is classified on its own:**

| declarator | becomes |
|---|---|
| constant initializer, scalar type | `Global { initial }`, no code |
| constant initializer, `const` | a folded constant (`scope.constants`) |
| **non-constant initializer, representable type** | a `Global { initial: 0 }` **plus a store in the module's init**, in source order among the other module statements |
| non-constant initializer, unrepresentable type | **NTS1016**, always, not on use |
| no initializer | **NTS1016** |
| reference-typed | **NTS1017** in v1 |

And: `ModuleScope.unsupported`'s refuse-on-use laziness — right for module-private data, and worth 54 lowered files against 25 per its own comment (`lower.rs:62-69`) — **does not apply to a declaration whose initializer carries code.** A side effect is observable whether or not the binding is read. That is the M10 fixture's whole failure.

### 2.5 Visibility, and one translation unit

**Decision: `program.c` is the only translation unit the compiler emits for a product's code, and it contains the product's surface. Every generated function is `static` except the surface. Shared products are built `-fvisibility=hidden` with a generated version script; static products are localized at archive time (§4.2).**

Today `signature`/`emit_func` (`emit.rs:1454-1497`) never emit `static` and never emit a visibility attribute, so all 102 symbols of M5 are public. `emit_globals` already gets globals right (`emit.rs:973-993`).

The napi addon **moves into `program.c`.** Today `wrapper()` (`compiler/codegen/napi/src/lib.rs:246-247`) emits its own forward declaration of the compiled function into a *separate* `addon.c`, compiled separately (`tooling/conformance/build.sh:53-55`); making generated functions `static` would leave every symbol it references undefined, and the conformance oracle would stop building. Emitting into one TU fixes that, lets the internal function inline into its wrapper, and deletes the duplicated `NtsObj_X` struct definitions the napi emitter apologises for at `lib.rs:349-352` ("A header emitted by `codegen/c` would be better still, and would remove this repetition entirely" — this is that, from the other direction).

So the C backend takes a `Surface`: `Executable` (nothing; `module__evaluate` is the one extern), `Library { product, exports, linkage }`, or `Napi { exports }`. One TU, one visibility rule, three surfaces. `main.c` stays a separate generated file for executables, because the host really is a choice there (`tooling/cli/src/main.rs:862-864`) and an embedder may replace it.

---

## 3. Lifecycle: how initialization is invoked, per product

**The design rule: there is no product in which a human writes the code that evaluates modules.**

The shared mechanism, emitted into `program.c`:

```c
static void nts_evaluate_task(void *state) { (void)state; src___counter__init(); src___main__init(); }

NtsStatus module__evaluate(void) {
    NtsTask task = { nts_evaluate_task, 0, 0 };
    nts_enqueue_microtask(task);
    nts_enter();
    nts_leave();
    return nts_evaluation_status;
}
```

**Enqueue, not call.** `emit.rs:64` currently emits `module__init(); nts_enter(); nts_leave();`, and `tooling/differential/src/lib.rs:704-711` the same. `docs/RFC.md:1090-1095` and `docs/async.md:154-163` both state the enqueue form as a requirement. I traced the observable difference through the drain at `nts_runtime.c:1521-1530` (ticks, then microtasks, repeat while ticks non-empty): enqueueing evaluation as a microtask yields micro-before-tick, which is ESM; a direct call plus a checkpoint yields tick-before-micro, which is CommonJS. It is unobservable today only because nothing in TypeScript can enqueue a tick (`nts_enqueue_tick` is called only from `runtime/c/tests/checkpoint.c`). It also matters now under a host that supplies `enqueue_microtask`: `nts_enqueue_microtask` routes to the host (`nts_runtime.c:1485-1493`) and `nts_leave` declines to drain (`nts_runtime.c:1543-1546`); a direct call bypasses both, which is a second code path per host. `drop` is null because the task owns nothing, which `nts_runtime.h:697-700` explicitly permits.

**Evaluation has a failure channel.** `NtsTask.run` returns void (`nts_runtime.h:698`), so the task writes into a generated `static NtsStatus nts_evaluation_status = NTS_OK;` that `module__evaluate` returns. Today the only value it can carry is `NTS_HOST_REQUIRED` (§3.2); tomorrow it carries `NTS_THREW` and `NTS_PENDING`. It exists now so that `nts_runtime_create`'s contract — "NTS_OK means the modules were evaluated" — is enforced by code rather than by an argument.

### 3.1 Per product

| Product | Entry point | Who writes it | Can the user forget? |
|---|---|---|---|
| **executable** | generated `main.c`: install uv host, `module__evaluate()`, run, shut down | compiler | No — `main` is generated |
| **shared library, `bundled-private`** | `nts_runtime_create` evaluates before returning `NTS_OK` | compiler | **No.** Exports take `NtsRuntimeHandle`, and the only source of a valid one is a successful create (§4.1 makes this true rather than claimed) |
| **static library / `build-time-composed`** | generated `<product>_init(const NtsHost *)`; exports keep plain signatures | compiler declares, embedder calls | Yes at the ABI level; caught by `NTS_ASSERT_EVALUATED()` in checked builds |
| **napi addon** | generated `NAPI_MODULE_INITIALIZER`: refuse a second Environment (§4.3), install the uv host on `napi_get_uv_event_loop`'s loop, `module__evaluate()` | compiler | No |

**On the static-library gap.** `build-time-composed` is the one mode RFC §27.1 licenses to omit the runtime parameter (`docs/RFC.md:2058`), and taking that licence means there is no handle to gate on. An `__attribute__((constructor))` is wrong (inter-DSO constructor order is unspecified, and a module body that arms a timer would run before any host exists). A per-call guard costs a branch in release for a contract violated once or never. The project already makes exactly this trade for exactly this class of contract: `docs/RFC.md:1448-1450` says resolution "asserts the owner thread in checked builds". `NTS_ASSERT_EVALUATED()` expands to a load-and-branch on one static bool under `-DNTS_CHECKED` and to nothing otherwise.

### 3.2 The host is not optional by accident — it is optional by proof

A reviewer found that the previous draft's header said "`host` may be null; a module body that arms a timer then refuses", and that this is false twice over: `nts_require_host` (`nts_runtime.c:1433-1438`) prints without the `NTS_REFUSED` prefix and calls `abort()`, and `nts_runtime.h:669-671` classifies "a task posted before a host exists" as a **defect**, not a refusal. A shared library that kills its embedder because a top-level statement called `setTimeout` is not an ABI.

**Decision: whether the product needs a host is a compile-time fact, and the descriptor carries it.** `requires_host` is true when any module init, or any function reachable from the declared surface, can reach a host operation (`nts_post_task`, `nts_post_delayed`, `nts_post_from_any_thread`) — a walk of the call graph the compiler already has.

- `host == NULL` and `requires_host` → `nts_runtime_create` returns **`NTS_HOST_REQUIRED`** before evaluating anything.
- `host == NULL` and `!requires_host` → the runtime installs its built-in **refusing host**, whose post operations set `nts_evaluation_status = NTS_HOST_REQUIRED` and return a zero timer id instead of aborting. That path is unreachable by construction; it exists so that a bug in the reachability walk surfaces as a status from `create` rather than as an `abort()` inside an embedder. It is tested directly in `runtime/c/tests/` by installing the refusing host and posting.
- `host->enqueue_microtask != NULL` → **`NTS_HOST_OWNS_MICROTASKS`**. Evaluation has not finished when create returns — it is sitting in the embedder's queue — and this ABI has no way to say "not yet". That is not a Chromium regression: a renderer is a `build-time-composed` or `chromium-shell` product whose entry point is generated, and the enqueue-then-checkpoint shape is correct there under both host kinds. Adopting an embedder's queue from inside a `bundled-private` library is the `host-provided` linkage mode, which `docs/RFC.md:1418-1422` defers.

---

## 4. One runtime per loaded image — enforced, per product kind

**Decision: multiple runtime instances are REFUSED with a named status, `nts_runtime_shutdown` is terminal, and the refusal is enforced by a mechanism appropriate to each product kind rather than by a sentence in a document.**

`docs/RFC.md:230-235` (§3.7, gate 2) permits this: "MMTk may become a default only after all of the following pass: … 2. Defined support for multiple independent Native TypeScript runtime instances, **or an accepted one-runtime-per-process product restriction**." That is a licence scoped to the MMTk-default decision, not a general one, and `docs/RFC.md:3189` says plainly "Test multiple libraries and runtime instances in one process." §14 proposes the amendment rather than pretending the conflict is not there.

**Why not build multi-instance now.** `runtime/c/nts_runtime.c` has 24 mutable file-scope objects (`:18,19,36,37,40,97,242,243,293-300,454,455,456,1424,1425,1426,1451,1452`) and no TLS anywhere. The cycle collector is the sharp edge: `nts_release` (`:350-374`) triggers `nts_collect_cycles` over the one shared root buffer, `nts_mark_gray` decrements `child->reserved` across everything reachable, and the `nts_collecting` guard (`:471`) makes a concurrent second instance *drop* its candidates rather than merely confuse them. `nts_retain`/`nts_release` are non-atomic on the written invariant that one thread touches a count (`:183-186`). Threading an `NtsRuntime *` through this is the largest change in the codebase and buys nothing the shipping product needs.

**And not thread-local, ever.** A `__thread` pointer in a `dlopen`'d `.so` is global-dynamic TLS: `leaq x@TLSGD(%rip),%rdi; callq __tls_get_addr@PLT` — a PLT call per access. `-ftls-model=initial-exec` reduces it to two dependent loads and risks "cannot allocate memory in static TLS block" on `dlopen`. An explicit parameter is one `mov`. If multi-instance is ever built, it is a parameter.

### 4.1 Shutdown is terminal, and the handle is not forgeable (M12)

```c
/* Hidden: -fvisibility=hidden keeps this address out of the dynamic symbol
 * table, so the only way an embedder can hold this value is to have been
 * given it by a successful create. The previous design used the descriptor's
 * address, which nts_library_descriptor() hands to anyone who asks. */
static const char nts_runtime_identity = 0;
#define NTS_THE_RUNTIME ((NtsRuntimeHandle)(void *)&nts_runtime_identity)

static _Atomic(NtsRuntimeHandle) nts_runtime_current = 0;   /* 0 unless live */
static _Atomic(unsigned)         nts_runtime_state   = 0;   /* fresh/evaluating/live/spent */
```

A facade's hot-path check is **one relaxed load and one compare** against `nts_runtime_current`: it rejects a forged handle, a null handle, a handle used before create, and a handle used after shutdown, all at once. On the failure path — cold, `noinline` — `nts_runtime_state` picks the precise status (`NTS_INVALID_HANDLE`, `NTS_NOT_YET_EVALUATED`, `NTS_SHUTTING_DOWN`/`NTS_RUNTIME_SPENT`). That is strictly cheaper *and* strictly stronger than the previous draft's two unconditional checks.

`nts_runtime_shutdown` moves the state to `spent` and never leaves it. A second `nts_runtime_create` returns **`NTS_RUNTIME_SPENT`**, forever, and the generated header says so. This is the decision that makes M12 impossible: module-scope statics are C file statics with load-time initializers, module evaluation runs exactly once per image, and there is nothing to reset because there is never a second evaluation. The alternative — emitting an `nts_module_reset()` that restores every global and releases everything the first evaluation allocated — is real work, and it makes correctness depend on a generated reset staying in step with a generated init forever. Terminality costs nothing and is honest: an embedder that wants a fresh runtime unloads and reloads the image, which is what RFC §36.4's loop already spells.

The relaxed-atomic choice is deliberate: on x86-64 and ARM64 a relaxed load is exactly a plain load, so the hot path pays nothing and the C abstract machine has no data race.

### 4.2 The guards are atomic; nothing else becomes atomic (M13's sibling)

`nts_runtime_live` as a plain bool read-then-written is a TOCTOU: two threads calling `nts_runtime_create` concurrently both see false, both evaluate, both return `NTS_OK`. The same applies to `nts_host_installed` (`nts_runtime.c:1425`, which today does not even guard — M8) and `nts_uv_installed` (`nts_uv_host.c:48`).

**Decision: exactly three words become C11 atomics** — the runtime state, the current handle, and `nts_host_installed` — claimed with `atomic_compare_exchange_strong` on paths called once. Everything else in the runtime stays single-threaded by contract, including refcounts, because a locked instruction on a cold path is free and one on `nts_retain` is not. `nts_host_install` returns `NtsStatus` and refuses a second install rather than clobbering a host while its queues, timers and in-flight tasks keep running against the old one.

### 4.3 Static products are localized at archive time (M13)

Hidden visibility and version scripts are ELF *dynamic*-symbol mechanisms and do nothing for `library({kind:"static"})`. The measured failure is silent: two static products in one link share one heap because `ld` extracts `nts_runtime.o` from the first archive only.

**Decision: a static product is emitted as a partially linked, symbol-localized object, archived alone.** The compiler generates the recipe as part of the product:

```sh
ld -r program.o nts_runtime.o -o merged.o
objcopy --localize-hidden merged.o counter.o
ar rcs libcounter.a counter.o
```

with `NTS_PUBLIC` (default visibility) on the declared surface only. Verified by a reviewer in this tree: with it, two static products in one executable report A live=1, B live=1; without it, B live=2. This is the static analogue of the version script and it belongs in step 10's test, which previously covered shared objects only.

It does not fix an export-name collision between two static products — and it cannot, because the compiler compiles one product and the composition is the embedder's link. §2.1's product prefix is what handles that: `analytics_parse` and `render_parse` do not collide, and neither collides with libc.

### 4.4 The napi addon refuses a second Node Environment (M14)

The user cannot forget to initialize a napi addon, but the user *can* type `new Worker(...)`, and no compile-time check can see it. `NAPI_MODULE_INITIALIZER` then runs a second time, in the same image, on a second thread, against non-atomic refcounts and a uv host that aborts on a second install.

**Decision: the generated initializer counts Environments in a static and refuses the second with a JavaScript-visible error before touching the uv host or the runtime:**

```
nts: refused: this addon supports one Node.js Environment per process;
it was required from a Worker. Load it on the main thread, or build it as a
shared library and create one runtime per process.
```

`napi_throw_error`, not `abort()` — a Worker requiring an addon must not kill the main thread's work. The real fix is per-`napi_env` state via `napi_set_instance_data` + `napi_add_env_cleanup_hook`, which is the multi-instance refactor this design declines; so refuse, and **test the refusal** (a fixture that requires the addon from a Worker and asserts the thrown message). §13 lists it as deliberately not done.

### 4.5 The owner thread belongs to the runtime, not to the host

`nts_is_owner_thread` (`nts_runtime.c:1557-1560`) is `!nts_host_installed || !nts_host.is_owner_thread || nts_host.is_owner_thread(nts_host.state)` — **true when no host is installed**, and otherwise an indirect call through the host vtable that for the uv host lands in `uv_thread_equal` (`nts_uv_host.c:187-190`), i.e. two more cross-DSO calls. Nothing in the runtime records an owner thread: `pthread_self`, `thrd_current`, `uv_thread_self` and `_Thread_local` all appear zero times in `runtime/c/*.c` and `*.h` outside the uv host's own bookkeeping. So RFC §17.4's requirement (`docs/RFC.md:1426-1434`, "A foreign thread cannot access a runtime heap merely because it has a handle") is satisfied by an assertion that is vacuous in precisely the configuration where a library is most exposed.

**Decision: the runtime captures the owner thread at `nts_host_install` / `nts_runtime_create`, whichever comes first, and `nts_is_owner_thread` becomes a `static inline` comparison in `nts_runtime.h`. `NtsHost.is_owner_thread` is deleted from the vtable.** Ownership is a runtime fact, not a host configuration; the uv host already stores exactly this at `nts_uv_host.c:333` for its own assertions and keeps doing so. This removes a per-crossing indirect call *and* makes the check mean something. `nts_runtime_shutdown` gains the check too — it runs disposals and drops queued tasks, each of which releases managed references and can enter `nts_collect_cycles` (`nts_runtime.c:474`).

### 4.6 What multi-instance would cost later, and what it would not change

(a) the 24 statics move into an `NtsRuntime`; (b) module globals move into a per-instance block reached through the handle; (c) internal calls gain a runtime parameter — the expensive one. **No public signature changes**, because exports already take `NtsRuntimeHandle` (§5) and module state never crosses the ABI (§12). That is the point of paying for the parameter now.

Module-scope variables stay C file statics (`emit.rs:973-993`). A `static double` in a `-fPIC` shared object is RIP-relative with no GOT indirection; a handle-relative field is a pointer load plus an offset on every read and write of module state in *ordinary internal code*. Per-image statics are exactly per-runtime under one-runtime-per-image **and terminal shutdown** — the second clause is what M12 showed the first one needs.

---

## 5. The headers, the projections, and what a crossing costs

### 5.1 Three headers

`nts_runtime.h` is **not** publishable: it declares `NtsHeader`, `NtsString`, `NtsArray`, `NtsPromise`, `nts_alloc`, the collector and `NTS_ELEMENTS`, every one of which `docs/RFC.md:1244-1252` (§15.1) forbids in a public header, and Decision 12 (`docs/RFC.md:3493`) restates.

- **`nts_host.h`** (new; split out of `nts_runtime.h:679-735`). `NtsTask`, `NtsTimerId`, `NtsHost`. Publishable: it is the seam an embedder implements and contains no managed type.
- **`nts_abi.h`** (new). The §15.1 vocabulary and nothing else.
- **`<product>.h`** (generated). Includes `nts_abi.h`. The three §27.1 entry points, the surface digest, and one prototype per declared export. Nothing else — no module init, no orchestrator, no global, no `NtsObj_X`.

`NtsHostServices` (`docs/RFC.md:2051`) is **renamed `NtsHost`**, and host installation becomes a parameter of `nts_runtime_create`. `NtsHost` has an implementation, two hosts, a test suite and a written rationale (`docs/async.md` §7); `NtsHostServices` is a name in a spec. §14 proposes the amendment.

### 5.2 A stale header is a link-time or create-time failure, never a silent one

An export's C symbol is `<product>_<name>`, so a *signature* change does not change the symbol; `abi_version`, the export name and the export count are all unchanged by it. Today every check would pass while the callee writes a 24-byte owned buffer through an 8-byte `double *`.

**Decision: the generated header carries a 64-bit digest of the product's entire declared surface, and `nts_runtime_create` compares it.**

```c
#define NTS_PRODUCT_COUNTER_DIGEST   UINT64_C(0x9d3f7a1c04b2e615)
#define NTS_PRODUCT_COUNTER_OPTIONS  { NTS_ABI_VERSION, NTS_PRODUCT_COUNTER_DIGEST }
```

The digest is FNV-1a over a canonical text: product name, provider, linkage, then each export's name, C symbol and projected signature, in declaration order. `options` is **required**; a null `options`, a wrong `abi_version` or a wrong digest returns `NTS_ABI_MISMATCH`. The descriptor also carries the per-export signature strings, so a tool can say *which* export moved.

**Bump policy** (previously an open item; now decided): `NTS_ABI_VERSION` bumps when `nts_abi.h`'s vocabulary changes — a struct layout, a status value's meaning, a lifecycle signature. It does **not** bump for a product's exports changing; that is the digest's job. The two are different questions and conflating them is why a single version field never detects anything.

### 5.3 Export signature shape

**Decision: uniform. `NtsStatus <product>_<name>(NtsRuntimeHandle, <projected args…>, <projected out…>)` for `bundled-private`; the same minus the handle for `build-time-composed`.**

Uniform rather than "return the value directly when the compiler proved the function cannot throw", because that makes the public ABI a function of an *analysis result*: adding a `throw` three calls deep would silently change an exported signature. An ABI is a function of the declared source.

### 5.4 The projection table (RFC §27.2's five crossing forms)

| TypeScript | Crosses as | §27.2 form |
|---|---|---|
| `number`, `boolean` | `double`, `bool` | scalar |
| `string` parameter | `NtsTextView` — borrowed, call-scoped, `units` = UTF-16 code units | borrowed span |
| `string` result | `NtsOwnedText` — `units` + `two_byte`; `release` may be **null**, meaning static | owned buffer |
| `Uint8Array` parameter | `NtsByteSpan` — `bytes` | borrowed span |
| `Uint8Array` result | `NtsOwnedBytes` — `bytes`; `release` may be null | owned buffer |
| `readonly number[]` parameter | `NtsF64Span` | borrowed span |
| `number[]` result | caller-supplied `double *out, size_t capacity, size_t *written`; `NTS_OUT_OF_CAPACITY` when short | copied record |
| object literal / record of scalars | a `struct` declared in `<product>.h`, by value | copied record |
| a thrown value | `NTS_THREW` + `NtsOwnedText *error` out-param | copied record |
| class instance | **refused in v1** (`NtsHandle` is deferred) | opaque handle |
| `Promise<T>`, arrays of objects, closures | **refused in v1** | — |

Four things this fixes from the previous draft, all found by review:

1. **`release == NULL` is legal.** String literals are already emitted as *static, immortal, NUL-terminated* `NtsString`s (`emit.rs:1025-1055`, `NTS_IMMORTAL` at `nts_runtime.h:168`). `greeting`, which §8.4 insists must build as written, hands back a pointer into `.rodata` and allocates nothing. Under a mandatory `release` it would have malloc'd and transcoded on every call to return a constant.
2. **Units are named, per struct.** `units` for code units, `bytes` for bytes. The previous draft had `length` meaning UTF-16 units on one side of one call and bytes on the other.
3. **`two_byte` exists on the owned form too**, so a one-byte string is handed over rather than transcoded into UTF-8.
4. **There is a bulk crossing.** An out-span for numeric and byte results is in v1, not deferred behind the handle table. Without it the only expressible ABI for "transform 100k numbers" is 100k crossings, which is a worse throughput floor than the scripting FFI this project exists to beat.

For a parameter the compiler proves the callee does not retain past the call — the same escape analysis that already reports `framed` allocations (`Prepared::framed`) — the facade builds a stack `NtsString` with `reserved = NTS_IMMORTAL` (the exact construction at `emit.rs:1962`) instead of calling `nts_string_from_utf8` (`nts_runtime.c:1324-1332`, which mallocs `(length+1)*sizeof(uint16_t)` and transcodes). When it may retain, it copies. This is the one place a projection depends on an analysis, and it is safe to do so because it changes *no signature* — only what happens behind one.

Each projection is a generated facade carrying `GeneratedReason::AbiProjection` (the variant exists at `origin.rs:92`). **The internal function is unchanged**: it keeps `NtsString *` (`emit.rs:1433-1439`) and stays `static`. That is what makes §15.1 compliance cheap.

### 5.5 What a crossing actually costs

The previous draft priced the facade at "three predictable branches and two increments". A reviewer read every step and found roughly five non-inlinable calls, one indirect through a vtable and two into another shared object. That was correct, and it is now fixed at the source rather than re-described:

| step | before | after |
|---|---|---|
| handle validation | 2 loads + 2 compares against a **public** address | 1 relaxed load + 1 compare against a hidden address |
| owner thread | cross-TU call → indirect vtable call → `uv_thread_equal` PLT | inline compare of a runtime-owned thread id (§4.5) |
| `nts_enter` | cross-TU call (`nts_runtime.c:1533`) | `static inline` `nts_depth++` |
| `nts_leave` | cross-TU call, then `nts_process_ticks_and_rejections` at depth 0 | `static inline` decrement; the drain stays out-of-line and is called only at depth 0 with no host checkpointing |
| the call itself | cross-TU, interposable through the PLT | direct, same TU, inlinable |

`nts_enter`/`nts_leave` move into `nts_runtime.h` alongside the 19 `static inline` helpers already there (`nts_runtime.h:381-650`), which is what the header's own rule asks for: "a bounds test that costs one comparison must not cost a call" (`nts_runtime.h:15-17`). Shared and static products build with `-flto`.

**The cost table the previous draft owed** (operations, not invented nanoseconds; the shapes are read from the code cited above):

| item | frequency | cost |
|---|---|---|
| per-module init call from the orchestrator | once per module, at startup | one direct call |
| the rejected per-module registry flag | once per module, at startup | one predictable branch + one store |
| module evaluation as a microtask | once per image | one task struct, one 16-entry queue allocation (`nts_runtime.c:1453-1471`), one indirect call |
| export facade, after §5.5 | per boundary crossing | 1 relaxed load, 2 compares, 2 increments, 0 extra calls |
| internal TS→TS call (`src___main__reading` → `src___counter__bump`) | ordinary path | a direct call, inlinable — **nothing from the facade** |
| module-scope global read | ordinary path | RIP-relative load |

Note what this makes explicit and what the previous draft got backwards: the registry it rejected as "the unjustified branch" costs N branches *once*, while the facade costs something on every crossing *forever*. The registry is still rejected — but on the grounds that it is a data structure with no reader (§1), not on cost.

---

## 6. Roots, the declared surface, and fatality

### 6.1 The public surface of a library is its entry module's export table

**Decision: `exports: [...]` names are resolved through `snapshot.modules[entry].exports`.**

This settles three problems at once. It gives every declared name a unique `(module, symbol)` pair without inventing manifest syntax, because an export table is keyed by name. It makes NTS3001 exact. And it closes the hole where a declared export lived in a module the entry never imports: if the entry re-exports it, the entry imports it, so it is evaluated. `entry` becomes required for a library product (**NTS3006** if absent).

### 6.2 A declared export is a use (M4)

`ModuleScope.unsupported` refuses on use, and its comment is right about why (`lower.rs:62-69`). But a declared public surface is not module-private data, and the manifest is precisely the thing that distinguishes them. Build planning resolves each declared name against `ModuleScope.unsupported` *before* the laziness applies and reports the stored reason at the declaration site — **NTS3002**.

### 6.3 Root sets, stated (previously unspecified, and fatal)

| product | `Roots` |
|---|---|
| executable | `Entry(["module#evaluate"])` |
| library, declared surface | `Declared([…resolved HIR names…])` **∪ `{"module#evaluate"}`** |
| library, no declared surface | `EveryExport` ∪ `{"module#evaluate"}` |
| napi | `EveryExport` ∪ `{"module#evaluate"}` |

`module#evaluate` is a root in every product and is never pruned. `tooling/cli/src/main.rs:935`'s `[MODULE_INIT]` becomes `[MODULE_EVALUATE]`; the per-module inits are reached through it, which is why §2.2 makes the orchestrator an HIR function. Without this, step 1's renaming turns `Roots::Entry(["module#init"])` into a set that matches nothing and prune deletes the program — reproducing M1 exactly, except with some globals now carrying plausible values.

### 6.4 Fatality — made implementable

Today: 120 errors, exit 0, artifact written (M2). "All refusals are fatal" is also wrong: a refusal on a function nothing in the root set reaches is legitimately non-fatal, and `drop_callers_of_refused` (`compiler/core/src/hir/mod.rs:1172-1210`, NTS1003) already prunes those correctly.

The previous draft said "fatal if any `Severity::Error` lands on a function in the root set", which cannot be implemented: a `Diagnostic` carries `severity, code, message, primary: Location, labels`, `Location` is `{ file, span }`, and there is no span-to-function map anywhere. **Decision: `drop_callers_of_refused` returns the set of dropped function names; `Prepared` carries it alongside `diagnostics` (next to the existing `pruned` counter at `mod.rs:985`); fatality is a set intersection with `root_names(program, roots)`.** Exact, no heuristics, and it gives `--partial`'s summary line something real to count.

1. **`nts build`** exits non-zero and writes nothing when that intersection is non-empty. This is what `Severity::Error` already means (`compiler/diagnostics/src/lib.rs:79-81`).
2. **`nts emit-c`** keeps today's partial behaviour behind an explicit `--partial`, for bring-up and conformance, printing how many roots were dropped. Without the flag it follows rule 1.
3. **A dropped module evaluation is fatal in every mode, including `--partial`** — **NTS3007**. There is no such thing as a partially evaluated program: an artifact missing its module init answers *wrongly*, not incompletely. This is the rule that catches M1, M2, M3 and M10.

---

## 7. Every construct that is refused

Message text is the whole emitted sentence; new codes call `Diagnostic::error(code, message, location)` directly rather than the `unsupported` helper at `lower.rs:2433-2439`, whose "… is not supported by this lowering yet" suffix is wrong for a permanent refusal.

| Code | Condition | Exact message | Fixture |
|---|---|---|---|
| **NTS1010** | a back edge in §1's DFS where at least one module on the cycle has a non-empty init | `` a cycle in the module graph (src/a.ts → src/b.ts → src/a.ts) whose modules have top-level code. ES modules resolve this with a temporal dead zone on the not-yet-initialized binding; this compiler has no representation for one, so it would read the binding's static initializer instead of throwing. `` | `examples/module-cycle` |
| **NTS1011** | a `CallExpression` whose callee is the `import` keyword | `` a dynamic `import()`, which makes the module graph a value this compiler cannot see; module evaluation order is computed at compile time. `` | `tests/refusals/dynamic-import` |
| **NTS1012** | `EXPORT_ASSIGNMENT` with `isExportEquals`, or `IMPORT_EQUALS_DECLARATION` | `` an `export =` declaration, which is CommonJS interop this compiler does not model. `` | `tests/refusals/export-equals` |
| **NTS1013** | `EXPORT_ASSIGNMENT` without `isExportEquals`, operand not a function or class declaration | `` an `export default` of an expression, which is a module-scope statement whose value would have to be module state of the expression's type. `` | M3's fixture |
| **NTS1014** | `await` at module scope (today's refusal at `lower.rs:3733`, given a code) | `` a top-level `await`, which makes a module's evaluation asynchronous; this compiler evaluates every module synchronously before any export is callable. `` | `tests/refusals/top-level-await` |
| **NTS1015** | the **default arm** of `module_statements` — any module-scope node kind that is neither a known statement nor a known declaration | `` a module-scope construct of kind {kind}, which has code in it that module evaluation does not run. `` | `tests/refusals/namespace-with-statement` |
| **NTS1016** | a module-scope declarator with no initializer, or a non-constant initializer of an unrepresentable type | `` a module-scope declaration whose initializer is not representable: {stored reason}. Its value would have to be module state of that type. `` | M10's fixture, second form |
| **NTS1017** | a module-scope declarator of reference type (today's `lower.rs:769` case, given a code) | `` a module-scope variable holding a reference, which needs an allocation this compiler does not yet make before module evaluation. `` | `tests/refusals/module-object` |
| **NTS1018** | assignment to an imported binding, if it ever reaches lowering (today fatal upstream as tsgo `TS2632`, `tooling/cli/src/main.rs:895-901`) | `` an assignment to an imported binding, which is not an assignable reference. `` | M6's fixture, assignment form |
| **NTS3001** | a declared export absent from the entry module's export table | `` the manifest declares export `parse`, which the entry module `src/main.ts` does not export. `` | `tests/manifest/undeclared` |
| **NTS3002** | a declared export resolving to a `ModuleScope.unsupported` symbol | `` the manifest declares export `greeting`, but it is {stored reason}. `` | M4's fixture |
| **NTS3003** | a declared export whose parameter or result type has no projection | `` the manifest declares export `render`, whose result of type `Promise<string>` has no projection across the public ABI (RFC §27.2). `` | `tests/manifest/unprojectable` |
| **NTS3004** | `bundled-private` with a provider `docs/RFC.md:1397-1401` does not permit | `` the product `hello` links a private runtime and selects the MMTk provider; a bundled private runtime supports RC plus cycle collection (RFC §17.3). `` | `tests/manifest/provider-linkage` |
| **NTS3005** *(warning)* | a module with top-level code not reachable from the entry | `` `src/unused.ts` has top-level code and is not reachable from the entry, so it is not evaluated. `` | `tests/manifest/unreachable-module` |
| **NTS3006** | a library product with no `entry` | `` the product `hello` is a library and names no entry module; a library's public surface is its entry module's exports. `` | `tests/manifest/no-entry` |
| **NTS3007** | module evaluation dropped for any reason, in any mode | `` no artifact was written: module evaluation for `src/counter.ts` was refused, and a program that skips its top-level code answers wrongly rather than incompletely. `` | M1's fixture |
| **NTS2004** | two declared exports colliding after `c_identifier` (existing, `emit.rs:577-586`) | existing wording | existing |

Runtime refusals, which are statuses or thrown errors rather than diagnostics:

| Name | Where | Text / status |
|---|---|---|
| `NTS_HOST_REQUIRED` | `nts_runtime_create` | the product's descriptor says it posts work and no host was supplied |
| `NTS_HOST_OWNS_MICROTASKS` | `nts_runtime_create` | `host->enqueue_microtask` is set; evaluation could not be finished before returning |
| `NTS_RUNTIME_EXISTS` | `nts_runtime_create` | this image already has a live runtime |
| `NTS_RUNTIME_SPENT` | `nts_runtime_create` | this image's runtime was shut down; unload and reload to run again |
| `NTS_ABI_MISMATCH` | `nts_runtime_create` | `options` is null, or its `abi_version`/`surface_digest` does not match this artifact |
| second Environment | generated `NAPI_MODULE_INITIALIZER` | thrown: `` this addon supports one Node.js Environment per process; it was required from a Worker `` |

---

## 8. `nts.config.ts`

### 8.1 Nothing in Rust reads it today

`grep` for `nts.config` over `*.rs` finds two comments (`compiler/core/src/hir/reachable.rs:16`, `compiler/core/tests/reachability.rs:113`); `Roots::Declared` (`reachable.rs:69-73`) is constructed nowhere and `undeclared()` (`reachable.rs:78-89`) is never called. The seam is cut; the reader is missing.

### 8.2 Node evaluates it

**Decision: `nts build` runs `node --experimental-strip-types <shim>` where the shim imports the config and writes `JSON.stringify(default)` to stdout; the Rust side parses the JSON.**

The config's value comes from being *computed*: `library({…})` normalizes `"shared"` to `"shared-library"` (`tooling/config/src/product.ts:106-114`), `memory.rcCycle()` builds a provider record, `defineConfig` is the identity whose doc comment says validation happens at build planning (`product.ts:100-104`). A JSON-subset restriction throws that away; a Rust re-implementation is a second implementation free to drift — the same argument `link_modules` makes for not writing a second module resolver. The node dependency is build-time only and the project already depends on node for its differential oracle.

### 8.3 Build-planning validation (RFC §27.3's "fail at build planning")

1. Provider × linkage → **NTS3004** (`docs/RFC.md:1397-1401`).
2. **No default provider for a library.** `RuntimeSpec.memory` is already non-optional (`product.ts:117`). Today `emit_c` defaults to NoGC (`tooling/cli/src/main.rs:903-910`) behind a comment that reads §9.1 backwards: `docs/RFC.md:788` says "NoGC must never be selected silently for a general application", and `docs/RFC.md:197` pins native libraries to "RC plus cycle collection". `--rc` stays as a bring-up flag on `emit-c`, which has no manifest; `nts build` has no default at all.
3. Entry present → **NTS3006**; declared names resolvable → **NTS3001/3002/3003**.

### 8.4 `examples/library` must build as written

A first library example that cannot compile its own manifest is not one. So `export const greeting: string = "hello from nts"` becomes supported — it needs no allocation and no init code (§2.3), and it is the first thing that exercises `NtsOwnedText` with a null `release` end to end.

One prerequisite, which was an open item and is now decided: `examples/library/tsconfig.json:7` has `"include": ["src/**/*", "nts.config.ts"]`, so the compiler parses the manifest as part of the program — and its `export default defineConfig({…})` is exactly the NTS1013 construct. **The manifest is excluded from the compiled project.** The manifest describes the build; it is not part of it, and a config that the product must also be able to compile is a circularity with no upside. `nts build` reads it from the workspace root, outside any tsconfig.

---

## 9. The two-module example, concretely

```ts
// src/counter.ts
export let count = 0;
export function bump(n: number): number { return n + 1; }
count = bump(count);
count = bump(count);
```
```ts
// src/main.ts
import { count, bump } from "./counter.js";
let started = 0;
started = bump(count);
export function reading(): number { return started; }
```
```ts
// nts.config.ts (excluded from tsconfig; see §8.4)
export default defineConfig({
  workspace: { root: ".", tsconfig: "./tsconfig.json" },
  products: {
    counter: library({
      entry: "./src/main.ts",
      kind: "shared",
      runtimeLinkage: "bundled-private",
      target: { os: "linux", arch: "x86_64", backend: "c" },
      runtime: { family: "native", memory: memory.rcCycle() },
      exports: ["reading"],
    }),
  },
});
```

**What the compiler emits today** (measured, exit 0): a `program.c` with `bump`, `reading`, `static double count = 0.0;` and `static double started = 0.0;`, no `module__init`, one printed diagnostic, and `reading()` answering **0** where node answers **3**.

### 9.1 `nts_abi.h` — product-independent, written once

```c
/* Generated by nts. Do not edit.
 * The public vocabulary of RFC 15.1. Nothing here is a managed pointer, and
 * nothing here is defined in terms of one. */
#ifndef NTS_ABI_H
#define NTS_ABI_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "nts_host.h"          /* NtsTask, NtsTimerId, NtsHost */

#define NTS_ABI_VERSION 1u

/* Opaque, and never dereferenced by a consumer. The value is not the address
 * of any exported symbol: a handle you were not given by a successful create
 * is one you cannot construct. */
typedef struct NtsRuntime *NtsRuntimeHandle;

typedef enum NtsStatus {
    NTS_OK                     = 0,
    NTS_THREW                  = 1,  /* the TypeScript threw; see the error out-param */
    NTS_REFUSED                = 2,  /* the program correctly declined its input */
    NTS_INVALID_HANDLE         = 3,
    NTS_WRONG_THREAD           = 4,  /* RFC 17.4 */
    NTS_NOT_YET_EVALUATED      = 5,  /* called re-entrantly during module evaluation */
    NTS_RUNTIME_EXISTS         = 6,  /* this image already has a live runtime */
    NTS_RUNTIME_SPENT          = 7,  /* shutdown is terminal; unload and reload */
    NTS_HOST_REQUIRED          = 8,  /* this product posts work and got no host */
    NTS_HOST_OWNS_MICROTASKS   = 9,  /* see nts_runtime_create */
    NTS_ABI_MISMATCH           = 10, /* stale header, or null options */
    NTS_OUT_OF_CAPACITY        = 11, /* a caller-supplied out-span was too small */
    NTS_OUT_OF_MEMORY          = 12
} NtsStatus;

/* Borrowed and call-scoped: valid only for the call it is passed to.
 * `units` counts UTF-16 code units, which is what String#length counts. */
typedef struct NtsTextView {
    const void *data;
    uint32_t    units;
    bool        two_byte;      /* false: one byte per unit */
} NtsTextView;

/* Allocated by the callee. `release` may be null, which means the bytes are
 * static and must not be freed -- a string literal crosses at zero cost. */
typedef struct NtsOwnedText {
    void    *data;
    uint32_t units;
    bool     two_byte;
    void   (*release)(void *data);
} NtsOwnedText;

typedef struct NtsByteSpan   { const uint8_t *data; size_t bytes; } NtsByteSpan;
typedef struct NtsOwnedBytes { void *data; size_t bytes; void (*release)(void *data); } NtsOwnedBytes;
typedef struct NtsF64Span    { const double *data; size_t count; } NtsF64Span;

/* Roots a managed object in the owning runtime (RFC 15.2). Zero is never live.
 * No export in this product uses one yet. */
typedef uint64_t NtsHandle;

/* Required. `surface_digest` is the constant the generated product header
 * defines; comparing it is how a header compiled against an older artifact
 * fails at create instead of writing through the wrong out-parameter. */
typedef struct NtsRuntimeOptions {
    uint32_t abi_version;
    uint64_t surface_digest;
} NtsRuntimeOptions;

typedef struct NtsExportRecord {
    const char *name;       /* the TypeScript export name */
    const char *symbol;     /* the C symbol in this artifact */
    const char *signature;  /* the canonical projected signature */
} NtsExportRecord;

typedef struct NtsLibraryDescriptor {
    uint32_t                     abi_version;
    uint64_t                     surface_digest;
    const char                  *product;
    const char                  *nts_version;
    const char                  *memory_provider;   /* "rc-cycle" | "nogc" */
    const char                  *runtime_linkage;   /* "bundled-private" | ... */
    uint32_t                     export_count;
    const NtsExportRecord *const exports;
    bool                         evaluates_modules;
    /* Whether any module init or reachable export can reach a host operation.
     * False means `host` may be null; see nts_runtime_create. */
    bool                         requires_host;
} NtsLibraryDescriptor;

#if defined(_WIN32)
#  define NTS_PUBLIC __declspec(dllexport)
#else
#  define NTS_PUBLIC __attribute__((visibility("default")))
#endif

#endif /* NTS_ABI_H */
```

### 9.2 `libcounter.h` — generated per product

```c
/* Generated by nts. Do not edit.
 *
 * Product `counter`: shared library, bundled-private runtime, rc-cycle.
 * Modules, in evaluation order: src/counter.ts, src/main.ts.
 *
 * Exported C symbols carry the product name. `reading` in TypeScript is
 * `counter_reading` here, because `log`, `read`, `time` and `index` are all
 * ordinary TypeScript export names and all libc symbols.
 */
#ifndef NTS_PRODUCT_COUNTER_H
#define NTS_PRODUCT_COUNTER_H

#include "nts_abi.h"

#ifdef __cplusplus
extern "C" {
#endif

/* The digest of this product's declared surface: its name, provider, linkage,
 * and every export's name, symbol and projected signature. Pass it in the
 * options; an artifact built from different sources will refuse it. */
#define NTS_PRODUCT_COUNTER_DIGEST  UINT64_C(0x9d3f7a1c04b2e615)
#define NTS_PRODUCT_COUNTER_OPTIONS { NTS_ABI_VERSION, NTS_PRODUCT_COUNTER_DIGEST }

const NtsLibraryDescriptor *nts_library_descriptor(void);

/* Creates this library's private runtime, installs `host`, and evaluates every
 * module in import order. Evaluation is enqueued as a microtask and drained
 * before this returns (RFC 12.1, docs/async.md 3), so a handle returned with
 * NTS_OK is one whose module state is initialized. There is no separate
 * "initialize" call to forget.
 *
 * `host` may be null only when the descriptor's `requires_host` is false --
 * that is, when the compiler proved no module init and no reachable export can
 * post a task or arm a timer. Otherwise this returns NTS_HOST_REQUIRED, rather
 * than letting a top-level setTimeout abort inside your process.
 *
 * The thread that calls this owns the runtime. Every export validates it.
 *
 * NTS_RUNTIME_EXISTS        this loaded image already has a live runtime
 * NTS_RUNTIME_SPENT         its runtime was shut down; shutdown is terminal.
 *                           Unload and reload the image to run again.
 * NTS_HOST_OWNS_MICROTASKS  `host->enqueue_microtask` is set. A runtime whose
 *                           checkpoints belong to the embedder cannot promise
 *                           evaluation finished before this returned.
 * NTS_ABI_MISMATCH          `options` is null, or was built from a different
 *                           version of this header.
 */
NtsStatus nts_runtime_create(const NtsRuntimeOptions *options,
                             const NtsHost           *host,
                             NtsRuntimeHandle        *out);

/* Runs registered disposals, drops whatever is still queued, and invalidates
 * `runtime` permanently. Deterministic: no collection is required for this to
 * be correct (RFC 16.3). Must be called on the owning thread. */
NtsStatus nts_runtime_shutdown(NtsRuntimeHandle runtime);

/* --- Exports -------------------------------------------------------------
 * src/main.ts:5   export function reading(): number
 */
NtsStatus counter_reading(NtsRuntimeHandle runtime, double *out);

#ifdef __cplusplus
}
#endif
#endif /* NTS_PRODUCT_COUNTER_H */
```

### 9.3 `program.c`

```c
/* Generated by nts. Do not edit. */
#include <stdatomic.h>
#include "nts_runtime.h"
#include "libcounter.h"

/* Internal. `static` because nothing below is part of this artifact's declared
 * surface -- which is also what lets the compiler inline `bump` into the init
 * that calls it. */
static double src___counter__bump(double v0);
static double src___main__reading(void);
static void   src___counter__init(void);
static void   src___main__init(void);

/* Module-scope state, qualified by module, always: `count` and `started`
 * belong to different modules and must not be able to collide. */
static double src___counter__count = 0.0;
static double src___main__started  = 0.0;

static double src___counter__bump(double v0) {
    double v2;
    double v3;
    v3 = 1.0;
    v2 = v0 + v3;
    return v2;
}

/* src/counter.ts: two top-level statements, in source order. */
static void src___counter__init(void) {
    double v0;
    double v1;
    v0 = src___counter__bump(src___counter__count);
    src___counter__count = v0;
    v1 = src___counter__bump(src___counter__count);
    src___counter__count = v1;
    return;
}

/* src/main.ts: one top-level statement. `count` is read from the storage of
 * the module that declares it, which is what makes the binding live. */
static void src___main__init(void) {
    double v0;
    v0 = src___counter__bump(src___counter__count);
    src___main__started = v0;
    return;
}

static double src___main__reading(void) {
    double v0;
    v0 = src___main__started;
    return v0;
}

/* --- Module evaluation ----------------------------------------------------
 *
 * Evaluation order is post-order over the import graph:
 *     src/main.ts -> src/counter.ts
 * so counter is evaluated first. The order is a compile-time constant, so
 * there is no registry, no per-module flag, and no branch.
 *
 * `module#evaluate` is a real HIR function, not text this backend writes:
 * reachability matches HIR names, so an orchestrator invented here would be
 * invisible to it and every init below would be pruned.
 */

/* NtsTask.run returns void, so the outcome comes back through here. Today the
 * only non-OK value is NTS_HOST_REQUIRED from the refusing host; the field
 * exists so that create's "NTS_OK means evaluated" is enforced by code rather
 * than by an argument, and so that a throw during evaluation has somewhere to
 * land when there is one. */
static NtsStatus nts_evaluation_status = NTS_OK;

static void nts_evaluate_task(void *state) {
    (void)state;
    src___counter__init();
    src___main__init();
}

NtsStatus module__evaluate(void) {
    /* Enqueued and then checkpointed rather than called: a top-level `.then`
     * must run before a top-level tick, as it does in node. A direct call plus
     * a checkpoint produces CommonJS ordering, and under a host that owns the
     * microtask queue it bypasses the host entirely -- a second code path per
     * host, which is a contract bug rather than a host difference.
     *
     * No `drop`: the task owns nothing, which nts_runtime.h permits, so the
     * run-or-cancel accounting of docs/async.md 4 has no hole here.
     *
     * The cost is one task struct, one 16-entry queue allocation and one
     * indirect call, once. It is not free and it is worth it. */
    NtsTask task = { nts_evaluate_task, 0, 0 };
    nts_enqueue_microtask(task);
    nts_enter();
    nts_leave();
    return nts_evaluation_status;
}

/* --- The public surface (RFC 27.1) ---------------------------------------
 *
 * These four symbols are the only ones with default visibility. Everything
 * else is static or hidden, which is what stops a second nts library loaded
 * RTLD_GLOBAL from binding this one's allocator (measured: without it, the
 * second library allocates into the first library's heap).
 */

/* The handle's identity. Hidden, so its address is not in the dynamic symbol
 * table and cannot be obtained except from a successful create -- unlike the
 * descriptor, which nts_library_descriptor() hands to anyone who asks. */
static const char nts_runtime_identity = 0;
#define NTS_THE_RUNTIME ((NtsRuntimeHandle)(void *)&nts_runtime_identity)

enum { NTS_STATE_FRESH = 0, NTS_STATE_EVALUATING = 1, NTS_STATE_LIVE = 2, NTS_STATE_SPENT = 3 };

/* One relaxed load and one compare is the entire hot-path check: it rejects a
 * forged handle, a null handle, a handle used before create, and a handle used
 * after shutdown. Relaxed because on every target we emit for it is a plain
 * load; atomic because create and shutdown must not race with it in the C
 * abstract machine. */
static _Atomic(NtsRuntimeHandle) nts_runtime_current = 0;
static _Atomic(unsigned)         nts_runtime_state   = NTS_STATE_FRESH;

/* Cold: reached only when the compare above already failed, so it may take as
 * long as it likes to produce the precise answer. */
static NtsStatus nts_handle_fault(void) {
    switch (atomic_load_explicit(&nts_runtime_state, memory_order_acquire)) {
        case NTS_STATE_EVALUATING: return NTS_NOT_YET_EVALUATED;
        case NTS_STATE_SPENT:      return NTS_RUNTIME_SPENT;
        default:                   return NTS_INVALID_HANDLE;
    }
}

static const NtsExportRecord nts_exports[] = {
    { "reading", "counter_reading", "(NtsRuntimeHandle, double *out) -> NtsStatus" }
};

static const NtsLibraryDescriptor nts_descriptor = {
    NTS_ABI_VERSION, NTS_PRODUCT_COUNTER_DIGEST,
    "counter", "0.0.0", "rc-cycle", "bundled-private",
    1u, nts_exports,
    /* evaluates_modules */ true,
    /* requires_host     */ false   /* no module init and no export can post */
};

NTS_PUBLIC const NtsLibraryDescriptor *nts_library_descriptor(void) {
    return &nts_descriptor;
}

NTS_PUBLIC NtsStatus nts_runtime_create(const NtsRuntimeOptions *options,
                                        const NtsHost           *host,
                                        NtsRuntimeHandle        *out) {
    unsigned expected = NTS_STATE_FRESH;

    if (!out) { return NTS_INVALID_HANDLE; }
    *out = 0;
    if (!options || options->abi_version != NTS_ABI_VERSION ||
        options->surface_digest != NTS_PRODUCT_COUNTER_DIGEST) {
        return NTS_ABI_MISMATCH;
    }
    if (!host && nts_descriptor.requires_host)   { return NTS_HOST_REQUIRED; }
    if (host && host->enqueue_microtask)         { return NTS_HOST_OWNS_MICROTASKS; }

    /* Claimed with a compare-exchange, not a plain bool: two threads
     * initializing two subsystems in parallel would otherwise both see "fresh"
     * and both evaluate every module. This is a cold path called once, so the
     * locked instruction is free -- and it is the only place in this runtime
     * that becomes atomic. */
    if (!atomic_compare_exchange_strong(&nts_runtime_state, &expected,
                                        NTS_STATE_EVALUATING)) {
        return expected == NTS_STATE_SPENT ? NTS_RUNTIME_SPENT : NTS_RUNTIME_EXISTS;
    }

    /* The calling thread owns this runtime from here on. The runtime records
     * it rather than asking the host, so the check means something even when
     * `host` is null. */
    nts_runtime_claim_owner_thread();
    if (nts_host_install(host) != NTS_OK) {
        atomic_store_explicit(&nts_runtime_state, NTS_STATE_SPENT, memory_order_release);
        return NTS_RUNTIME_EXISTS;
    }

    if (module__evaluate() != NTS_OK) {
        /* Evaluation is not restartable and shutdown is terminal, so the
         * partially evaluated state is unobservable: no handle was issued and
         * no second create will ever run. */
        atomic_store_explicit(&nts_runtime_state, NTS_STATE_SPENT, memory_order_release);
        return nts_evaluation_status;
    }

    atomic_store_explicit(&nts_runtime_current, NTS_THE_RUNTIME, memory_order_release);
    atomic_store_explicit(&nts_runtime_state, NTS_STATE_LIVE, memory_order_release);
    *out = NTS_THE_RUNTIME;
    return NTS_OK;
}

NTS_PUBLIC NtsStatus nts_runtime_shutdown(NtsRuntimeHandle runtime) {
    if (runtime != atomic_load_explicit(&nts_runtime_current, memory_order_relaxed)) {
        return nts_handle_fault();
    }
    /* Teardown releases managed references and can enter the cycle collector,
     * so it is as much a heap entry as any export is. */
    if (!nts_is_owner_thread()) { return NTS_WRONG_THREAD; }

    atomic_store_explicit(&nts_runtime_current, 0, memory_order_release);
    /* Terminal. Module-scope statics were initialized once, at this image's
     * load and by this evaluation; there is no mechanism that could restore
     * them, so there is no second create. Measured before this rule existed:
     * create/shutdown/create answered 3, then 5, then 7. */
    atomic_store_explicit(&nts_runtime_state, NTS_STATE_SPENT, memory_order_release);

    /* Runs registered disposals, then drops what is still queued and frees the
     * two queues: a queued task owns a reference, and whoever holds it either
     * runs it or gives it back (docs/async.md 4). */
    nts_runtime_teardown();
    return NTS_OK;
}

/* src/main.ts:5   export function reading(): number */
NTS_PUBLIC NtsStatus counter_reading(NtsRuntimeHandle runtime, double *out) {
    if (runtime != atomic_load_explicit(&nts_runtime_current, memory_order_relaxed)) {
        return nts_handle_fault();
    }
    if (!out)                   { return NTS_INVALID_HANDLE; }
    if (!nts_is_owner_thread()) { return NTS_WRONG_THREAD; }   /* RFC 17.4, now inline */
    nts_enter();                                               /* inline: depth++ */
    *out = src___main__reading();
    nts_leave();                                               /* inline: depth--, drain at 0 */
    return NTS_OK;
}
```

`counter_reading(rt, &v)` yields `v == 3.0`, which is what node computes. What is **absent**: `nts_runtime.h`, `NtsString`, `NtsHeader`, `bump`, `count`, `started`, `src___counter__init`, `nts_alloc`, and every other one of the 102 symbols M5 found.

### 9.4 `libcounter.map` and the build lines

```
NTS_1.0 {
  global:
    nts_library_descriptor;
    nts_runtime_create;
    nts_runtime_shutdown;
    counter_reading;
  local: *;
};
```
```sh
# shared
cc -std=c11 -O2 -flto -fPIC -fvisibility=hidden -DNTS_PROVIDER_RC \
   -Wl,--version-script=libcounter.map \
   -shared -o libcounter.so program.c nts_runtime.c -lm

# static: partial link, then localize, then archive. A plain `ar` of two nts
# products lets the linker satisfy both from one runtime object -- measured:
# the second product allocates into the first product's heap, with no link
# error and no diagnostic.
cc -std=c11 -O2 -fvisibility=hidden -DNTS_PROVIDER_RC -c program.c nts_runtime.c
ld -r program.o nts_runtime.o -o merged.o
objcopy --localize-hidden merged.o counter.o
ar rcs libcounter.a counter.o
```

### 9.5 The executable form of the same program

```c
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif
#include "nts_runtime.h"
#include "nts_uv_host.h"

NtsStatus module__evaluate(void);

int main(void) {
    nts_uv_host_install(uv_default_loop());
    /* Unconditional. A program with nothing to evaluate emits an empty
     * module__evaluate, so no product emitter carries a flag one of them can
     * forget to check -- which is how the napi path came to skip module
     * evaluation entirely. */
    if (module__evaluate() != NTS_OK) { return 1; }
    nts_uv_host_run();
    nts_uv_host_shutdown();
    return 0;
}
```

In this product `reading` is not a root (`Roots::Entry(["module#evaluate"])`), so it and its facade are pruned; `module__evaluate` is the one non-static symbol `program.c` contributes.

---

## 10. Migration path

Eleven steps. Each compiles, each ships, each has a test that fails before it and passes after.

**0 — Schema.** `DeclarationModifiers::TYPE_ONLY`, set by the encoder on `import type` / `export type` and on individual specifiers. Add `EXPORT_ASSIGNMENT` and `IMPORT_EQUALS_DECLARATION` to `compiler/semantic-schema/src/syntax.rs` (which today has only `IMPORT_DECLARATION: 273` at line 161 and `EXPORT_DECLARATION: 279` at line 166 — neither of the constructs step 5 must refuse can even be named). `link_modules` applies §1.1's edge rule.
*Test:* `nts modules` shows no edge for `import type { T } from "./opts.js"`, and no edge for `import { Options }` where `Options` has no value meaning; still an edge for `import "./x.js"`, `import { type T, v }`, and `export * from`.

**1 — Module keys and product-prefixed exports.** `moduleKey(SourceId)`; every function and global qualified. Delete `naming()` (`lower.rs:666-707`) and `-Ddirname=nts_node_dirname` (`tooling/conformance/build.sh:36-39`).
*Test:* two `util.ts` in different directories, each with a reachable `helper()`. Today: NTS2004 or one silently wins. After: two symbols. Plus `runtime/node/path` builds with no `-D` renames.

**2 — Alias resolution.** Resolve `import { n }` through `modules[target].exports`.
*Test:* M6's fixture; `live()` returns 5 and matches node under `nts check`.

**3 — Module-scope declarations classified per declarator (§2.4).** `VARIABLE_STATEMENT` leaves `is_module_declaration`; non-constant initializers become init stores; NTS1016/NTS1017; the `unsupported` laziness stops applying to a declaration whose initializer carries code.
*Test:* M10's fixture answers 7, not 0; the `const started = note(7)` and `let started = note(7)` forms behave identically; a declaration of unrepresentable type refuses whether or not anything reads it.

**4 — Per-module init, the orchestrator, and the order.** `module_statements` returns `Vec<(ModuleId, Vec<NodeId>)>`; emit `<key>#init` per module and `module#evaluate` always, as HIR; delete the `files.len() > 1` refusal; NTS1010 and NTS3005; `GeneratedReason::ModuleInitialization`; root sets updated per §6.3.
*Tests:* `examples/two-modules` executes and answers 3; `examples/module-cycle` refuses by name; `examples/type-only-cycle` compiles and matches node; `examples/side-effect-import`; `examples/re-export-chain` (base → mid re-exports only → main). All five under `nts check` against node.

**5 — Close the classifier hole.** The default arm of `module_statements` **refuses rather than skips** (NTS1015); `carries_code` asks "a statement **or an expression evaluated at module scope**"; NTS1011/1012/1013; NTS1014 for the existing TLA refusal.
*Test:* M3's fixture refuses instead of answering 0. This is the step that makes "refuse rather than approximate" true for module scope rather than aspirational.

**6 — Fatality.** `drop_callers_of_refused` returns the dropped set; `Prepared` carries it; `nts build` is fatal on a root intersection; `emit-c --partial` reproduces today's behaviour with a summary; NTS3007 in every mode.
*Test:* M1's fixture exits non-zero and writes no `program.c`; `--partial` still writes one but prints "3 roots dropped"; M2's `node:path` no longer silently ships without its evaluation.

**7 — Enqueue instead of call, and a failure channel.** `module__evaluate` does enqueue + enter + leave and returns `NtsStatus`; `standalone_main` loses `initializes`; `tooling/differential/src/lib.rs:700-711, 846-849` follows; the napi emitter installs the uv host on `napi_get_uv_event_loop`'s loop and calls it.
*Test:* a module whose top-level code does `Promise.resolve().then(…)` while the C harness enqueues a tick (as `runtime/c/tests/checkpoint.c:52-114` already does) — direct call and enqueue order differently, and the deterministic host and the uv host must agree (`docs/async.md:401-409`). Plus: the napi conformance artifact for `node:path` now runs its module evaluation.

**8 — One translation unit, visibility, and the runtime's own gaps.** napi surface emitted into `program.c`; `static` on everything but the surface; `NTS_PUBLIC` on the surface; `-fvisibility=hidden` + version script for shared, `ld -r` + `objcopy --localize-hidden` for static; `nts_host_install` returns a status and refuses a second install; `nts_runtime_teardown` frees the two queues (M9); `nts_enter`/`nts_leave`/`nts_is_owner_thread` become `static inline`; the runtime captures the owner thread and `NtsHost.is_owner_thread` is deleted; the three guard words become atomics; the napi initializer refuses a second Environment.
*Tests:* M5's experiment promoted into `tests/products/` (fails today with `b_live -> 2`); M13's two-static-products executable (fails today with `B live=2`); M14's Worker fixture asserts the thrown refusal; **and "the conformance lane still links and still runs"**, which is the test the previous plan's step 7 was missing and which would have caught the `static`-breaks-`addon.c` failure.

**9 — The manifest.** `nts build`; node evaluates the config to JSON; `Roots::Declared` and `undeclared()` finally constructed; NTS3001/3002/3004/3006; provider from the manifest with no default; `nts.config.ts` excluded from `examples/library/tsconfig.json`.
*Tests:* a fixture declaring a nonexistent export fails NTS3001; `examples/library` fails NTS3002 on `greeting` with the stored reason (until step 10 makes it build); `bundled-private` + MMTk fails NTS3004; a library with no entry fails NTS3006.

**10 — The ABI.** `nts_host.h` split out; `nts_abi.h`; `<product>.h` with the surface digest; the three §27.1 entry points; scalar / text / bytes / f64-span / out-span projections with `GeneratedReason::AbiProjection`; NTS3003 for the rest; module-scope string constants so `examples/library` builds as written.
*Tests:* RFC §36.4's load / create / execute / shutdown / unload loop, run twice, with two different libraries, in one process — passing only because of step 8; a second `create` without an unload returns `NTS_RUNTIME_SPENT`; a handle held across shutdown returns `NTS_RUNTIME_SPENT`, not a value; `(NtsRuntimeHandle)nts_library_descriptor()` returns `NTS_INVALID_HANDLE`; a header with a hand-edited digest returns `NTS_ABI_MISMATCH`; `greeting` returns a buffer with `release == NULL` and allocates nothing; a 100k-element out-span crossing.

---

## 11. Cost, stated honestly

| decision | what it costs | how often |
|---|---|---|
| per-module inits + orchestrator | N direct calls | once, at startup |
| evaluation as a microtask | one task struct, one queue allocation, one indirect call | once, per image with any top-level code |
| the rejected per-module registry | N predictable branches | once — it was rejected for having no reader, not for cost |
| export facade | 1 relaxed load, 2 compares, 2 increments | per boundary crossing |
| the `NtsRuntimeHandle` parameter | one register (`%rdi` on x86-64 SysV) | per boundary crossing |
| internal TS→TS call | nothing | ordinary path |
| module-scope global access | RIP-relative load/store | ordinary path |
| `static` + hidden visibility | **negative** — direct calls instead of PLT calls to `nts_alloc`, `nts_retain`, `nts_release`, and inlining of internal functions into their callers | everywhere |
| string literal crossing the ABI | nothing — a pointer into `.rodata` with `release == NULL` | per crossing |

---

## 12. Decisions that are hard to reverse, and why they are right

Everything else here — internal symbol names, per-module vs flattened inits, where the order is computed, module globals as file statics — is reversible by recompiling, because nothing outside the artifact can observe it. These five are not.

**1. An export takes `NtsRuntimeHandle`, from day one, even though it is ignored.** This is the only *external* ABI decision in the document. Changing it later breaks every consumer. The cost is one register at a boundary that already costs a call, paid per crossing, never per element and never on an internal call. `docs/RFC.md:2058` licenses omitting it only for `build-time-composed`, and there we do omit it. This is precisely the "so we do not refactor later" purchase, and §4.6 is the list of what it buys.

**2. Shutdown is terminal.** The alternative is a generated `nts_module_reset()` that must stay in step with a generated init forever, and whose divergence is silent (M12 measured the divergence that exists without either). Terminality is one state word, is documented in the generated header, and makes "per-image statics are per-runtime" true rather than nearly true. It is the reason no fold, no reset table and no generation counter are needed anywhere else.

**3. Module state never crosses the public ABI.** `Global::exported` is hard-coded `false` (`lower.rs:797`) and the non-static branch at `emit.rs:976` is unreachable — **delete the flag** rather than leave something that looks implemented. RFC §27.2's crossing forms do not include "a value"; a library that wants to expose state exposes an accessor. This is what keeps decision 5 reversible: nothing outside can name a module global, so relocating them into an instance struct later is an internal change.

**4. An export's C symbol is `<product>_<name>`; the module key never appears in it.** The prefix is what makes `log`, `read` and `time` safe to export and what lets two static products coexist. The absence of the module key is what lets the key scheme change later without renaming anything a consumer links against.

**5. Evaluation order is a compile-time constant, and one runtime per image is refused rather than supported.** Reversible if dynamic `import()` ever lands, at the cost of a per-module guard; reversible for multi-instance at the cost of §4.6's (a)(b)(c), of which (c) is expensive. Stated here so both are a known future purchase rather than a discovery.

---

## 13. Deliberately deferred

| Not doing | What it would take |
|---|---|
| **Multiple runtimes in one image** | §4.6. No public signature changes, which is the point. |
| **Top-level await** | `module__evaluate` returns `NTS_PENDING` and the evaluation task settles a promise. No signature change — create already returns `NtsStatus` and evaluation already has a failure channel. |
| **A napi addon in more than one Node Environment** | Per-`napi_env` state via `napi_set_instance_data` + `napi_add_env_cleanup_hook` — the multi-instance refactor above. Until then it is refused, in JavaScript, with a test (§4.4). |
| **Dynamic `import()`** | A runtime module registry with the four states of `docs/node-js.md:516-525` and a per-module guard. That guard is why it is not built speculatively. |
| **Import cycles with top-level code** | A TDZ representation for module bindings. |
| **Objects, arrays of objects, promises across the ABI** | A handle table (RFC §15.2) and async projections. Numeric and byte bulk crossings are *not* deferred (§5.4) — they need neither. |
| **A runtime module registry** | Only needed for dynamic import or HMR. The order is a link-time constant; a registry is a data structure with no reader. |
| **HMR export slots** | RFC §32.1 (`docs/RFC.md:2362-2378`) makes them a development-mode product composition. Release artifacts keep direct calls. |
| **`host-provided` runtime linkage** | A versioned public runtime ABI; RFC §17.3 already defers it. |
| **Restarting a runtime in a loaded image** | See decision 2. Unload and reload. |

---

## 14. RFC amendments, disagreements with reviewers, and what remains open

### 14.1 Amendments this design requires

1. **§27.1 (`docs/RFC.md:2051`): `NtsHostServices` → `NtsHost`.** `NtsHost` has an implementation, two hosts, a test suite and a written rationale (`docs/async.md` §7); `NtsHostServices` is a name in a spec. Host installation becomes a parameter of `nts_runtime_create`.
2. **§26.1 (`docs/RFC.md:1937-1944`) contradicts `docs/async.md` §2 and `nts_runtime.c:1600-1608` on timer ownership.** §26.1's embedder surface lists "run expired timers", implying the runtime owns a timer heap; the implemented seam puts `post_delayed`/`cancel_delayed` on `NtsHost`. **The host owns timers**, and §26.1's list should read as what an embedder-provided host implements over its own facility. The alternative is two timer implementations, which is the second-code-path-per-host the project forbids.
3. **§36.4 (`docs/RFC.md:3179-3189`).** "Repeatedly: load / create / execute / destroy / unload" is satisfied only with `unload` mandatory, and "Test multiple libraries and runtime instances in one process" must become "Test multiple libraries in one process; a second runtime instance in one image is refused with `NTS_RUNTIME_EXISTS`, and a second create after shutdown with `NTS_RUNTIME_SPENT`." §3.7 gate 2 (`docs/RFC.md:235`) permits the restriction, but its scope is the MMTk-default decision (`docs/RFC.md:230`), so §36.4 is where the restriction has to be written down.
4. **§17.4 (`docs/RFC.md:1426-1434`)** should say the *runtime* owns the owner-thread identity. `NtsHost.is_owner_thread` is deleted (§4.5): delegating it made the assertion vacuous exactly where a library is most exposed, and cost an indirect call per crossing where it was not.

### 14.2 Where a reviewer was wrong

- **"§5.4's owner-thread cost buys nothing, so drop the check."** Half right, and the diagnosis was exactly right — with a null host `nts_is_owner_thread` returns true unconditionally (`nts_runtime.c:1557-1560`) and nothing in `runtime/c` records a thread. The conclusion is inverted: RFC §17.4 *requires* the validation, so the answer is to make it real and cheap (§4.5), not to delete it. Both reviewers who raised it proposed the same fix; it is adopted.
- **"Move the handle comparison behind `NTS_CHECKED`, like `NTS_ASSERT_EVALUATED`."** Declined, because the premise was the forgeable descriptor-address sentinel, which is gone (§4.1). With a hidden identity, the same one load and one compare catches a forged handle, a stale handle and a use-after-shutdown — the last of which is a genuine runtime error, not a contract violated once or never. The two modes are now honestly different: `bundled-private` has a handle to check, `build-time-composed` has none by RFC licence, and the checked-build assertion is the best available there.
- **"The fold is good, keep it."** Endorsed by two reviewers and challenged by two on soundness. Dropped anyway (§2.3): per-declaration classification (§2.4) already gives constant initializers the zero-cost path, and what the fold added beyond that was hoisting *statements*, which is where both soundness preconditions and the whole reset-divergence problem came from. Deleting it removes a class of divergence for a startup cost measured in a handful of stores.

### 14.3 Still open

- **`abi_version` bump policy** was open; it is now decided (§5.2). What is genuinely still open is whether the surface digest should also cover the *host* vocabulary (`nts_host.h`), since an embedder implementing `NtsHost` compiles against it too. My inclination is yes, via `NTS_ABI_VERSION`, since `NtsHost` is not per-product; I did not settle it.
- **I did not build and run a `.node` addon end to end** to demonstrate M7's wrong answer at the JavaScript level. The claim rests on reading the generated `addon.c` (zero occurrences of `module__init`, `nts_host_install` or `nts_enter`) and on `tooling/conformance/build.sh:52-57` not linking `nts_uv_host.c`. M14's Worker failure is likewise read from `nts_uv_host.c:66-68, 192-198, 328-330` and node's context-aware registration, not executed.
- **Windows.** Everything in §4.2 and §4.3 is ELF and GNU-binutils shaped. `__declspec(dllexport)` and a `.def` file are the shared-library analogue; the static-localization step has no direct equivalent and I did not determine what replaces it. RFC §3.7 gate 1 asks for a Windows build before MMTk defaults; this is one of the things that gate should cover.

---

# Appendix: what this record is still missing

An independent completeness pass over the proposal above. These are gaps in
*this document*, not in the code it describes, and two of them contradict
sections of it. They are kept here rather than fixed silently, because a
design record that has been reviewed and had its holes listed is worth more
than one that reads as finished.

# Completeness review — what is missing

Everything below is read in this tree at the stated line. Ordered by how badly it breaks the design as written.

---

### 1. A non-function export has no answer anywhere, and `examples/library` is one
`examples/library/src/main.ts:5` is `export const greeting: string = "hello from nts"`, and `examples/library/nts.config.ts:23` declares it. §8.4 says it "must build as written"; §12 decision 3 says "module state never crosses the public ABI… a library that wants to expose state exposes an accessor"; §5.3/§5.4 project *function* signatures only; §9.2's header emits only function prototypes; and §6.3's root sets are sets of **HIR function names** — `undeclared()` (`compiler/core/src/hir/reachable.rs:78-89`) and `root_names` (`:109`) both scan `program.funcs`, while a `const` is a `Global`. So a declared value export resolves to nothing, NTS3001 fires with the wrong sentence ("the entry module does not export it" — it does), and §8.4 contradicts §12.3. The document decides both sides of this and never notices.

### 2. Re-export aliases: the frontend cannot do what §1.2 and §6.1 require
`snapshot.modules[t].exports` comes from tsgo `getExportsOfModule` (`compiler/frontend-ts/src/tsgo/symbols.rs:146-157`). For a re-export that yields an **alias** symbol, not the declaring one. There is no alias resolution: `SymbolFlags` has nine bits and none is `Alias` (`compiler/semantic-schema/src/schema.rs:290-298`; the tsgo bit map at `symbols.rs:31-42` never mentions `1 << 21`), and `getAliasedSymbol` is not among the ~50 methods in `compiler/frontend-ts/src/tsgo/proto.rs:16-69`. §1.2 ("that yields the *declaring* symbol"), §6.1 (the library surface) and step 4's own `examples/re-export-chain` fixture all rest on this. `runtime/node/path/src/main.ts:13-16` is nothing *but* `export * from` / `export * as posix from` — so the conformance lane's flagship module is the counterexample. Star exports and namespace re-exports (`export * as posix`) also appear in no table in §2.1, §5.4 or §7. **This is a missing step 0 item, and step 0 is the one step the document says nothing may land before.**

### 3. Module-qualifying `Func::name` silently disables the differential oracle
`hir::Func` (`compiler/core/src/hir/mod.rs:172-207`) carries `name` and `exported` and **no JavaScript export name**. Three consumers key off the HIR name being the TS name:
- `tooling/differential/src/lib.rs:257` — `.filter(|func| importable.contains(func.name.as_str()))`, `importable` being the TS export table. After step 1 nothing matches, `testable` is empty, `check` returns `Report::default()`, and `nts check` hits `report.functions == 0` and prints "nothing to check" and **exits 0**. Steps 2, 3 and 4 state their tests as "matches node under `nts check`". Step 1 turns their oracle off, with exit status 0 — the exact failure class the document exists to eliminate.
- `compiler/codegen/napi/src/lib.rs:398` registers `napi_set_named_property(env, exports, "{name}", …)` with the HIR name, so §2.1's "a napi addon still registers `exports.reading`" becomes `exports["src.main#reading"]`.
- `reachable.rs:78-89` compares manifest names to `func.name` directly.

The carrier for the JS name is not proposed.

### 4. A module init that throws aborts the embedder's process
`THROW_STATEMENT` is an accepted module statement (`lower.rs:442`), `lower_throw` emits `Callee::External("nts_thrown")` (`lower.rs:4242-4252`), and `nts_thrown` prints and `abort()`s (`runtime/c/nts_runtime.c:529-541`) because there is no try/catch at all (`runtime/c/nts_runtime.h:355-361`). So a shared library whose top-level code throws kills the host process **inside `nts_runtime_create`** — the identical defect §3.2 correctly diagnosed for `nts_require_host` and fixed there. §3 defers `NTS_THREW` to "tomorrow" without refusing the construct today, and §7 has no code for "a module init can reach a throw". Given "refuse rather than approximate", this needs either NTS_THREW now or a refusal now.

### 5. Host-owned microtasks: the guard exists only where it is least needed
§3.2 returns `NTS_HOST_OWNS_MICROTASKS` from `nts_runtime_create` — the `bundled-private` path only. The generated `<product>_init(const NtsHost *)` for `build-time-composed` and §9.5's `main.c` have no such guard, and under such a host `nts_leave` returns without draining (`nts_runtime.c:1545-1547`). `module__evaluate()` then returns `NTS_OK` with **nothing evaluated**. RFC §12.2 (`docs/RFC.md:1105-1111`) admits that host as a configuration and insists "There is one code path either way" — and `chromium-shell`, the product kind that requires it, has no row in §3.1's lifecycle table.

### 6. Six of ten product kinds are unmentioned, and napi is not a product kind at all
`tooling/config/src/product.ts:12-24` defines `executable | static-library | shared-library | application | framework | android-library | native-ui-sdk | host-surface-library | chromium-shell | module-package`. §3.1 covers three plus napi. `application` has a live constructor today (`product.ts:80-83`). Conversely the **napi addon — the product whose lifecycle M7 and M14 are about — has no `ProductKind`**, so §8's manifest reader has no way to select it. RFC §31 (`module-package`, `docs/RFC.md:2281-2336`) is untouched.

### 7. Class, layout and closure names are still unqualified
§2.1 qualifies "every generated function and every module-scope global". It does not qualify types: `object_type_name` is `NtsObj_` + `layout.name` with non-alphanumerics collapsed (`compiler/codegen/c/src/emit.rs:1277-1282`), and the `naming()` being deleted only ever qualified `FUNCTION_DECLARATION`s (`lower.rs:669-671`). Two modules each declaring `class Point` collide in one `NtsObj_Point` — and step 1's test (two `util.ts` with a `helper()`) is a function test that would pass anyway. §2.5 makes this worse by moving the napi struct definitions into the same TU.

### 8. The module key is redefined instead of reusing §20.4, and is not collision-free
`SourceFile` already carries `uri: "nts-workspace:///src/App.tsx"` and a content `digest` (`compiler/diagnostics/src/lib.rs:33-40`) — RFC §20.4's requirement, already implemented. §2.1 invents "workspace-relative path" instead and never cites it. Two consequences it does not address: `workspace_uri` (`tsgo/mod.rs:1240-1243`) and `normalize_name` (`symbols.rs:216-222`) **fall back to the raw absolute path** for a file outside the root, so a dependency outside the workspace produces a machine-dependent C symbol, which §20.4 forbids for reproducible builds. And key uniqueness is argued from "`.` and `#` cannot appear in a TypeScript identifier" — but a key is built from a *path*, and `c_identifier` collapses every remaining non-alphanumeric to `_` (`emit.rs:595-600`), so `src/v1.2/x.ts`, `src/v1-2/x.ts` and `src/v1/2/x.ts` all land on the same symbol. No key-collision diagnostic is proposed (NTS2004 is about export names).

### 9. Constructs whose code-at-evaluation-time is still classified as "no code"
§2.4 correctly removes `VARIABLE_STATEMENT` from `is_module_declaration`, and stops there. `CLASS_DECLARATION` and `ENUM_DECLARATION` remain (`lower.rs:451-463`) — but a `static x = f()`, a static block, and a non-const enum with computed members all run at module evaluation. That is M10's bug in two other node kinds, left in place with no diagnostic. Separately, `using` / `await using` (RFC §16.3, `docs/RFC.md:1345-1353`) appear nowhere: zero hits for `dispos`/`using` across `runtime/c/*.c|h` and the compiler, no row in §2.4's declarator table, no refusal code in §7 — yet §9.3's `nts_runtime_shutdown` claims to run "registered disposals".

### 10. `nts_runtime_teardown()` and the disposal registry do not exist and no step creates them
§9.3 calls it and §4.5 reasons about what it does. `runtime/c/nts_runtime.c` has no shutdown or teardown function of any kind, and no disposal registry. Step 8 says only "frees the two queues (M9)". RFC §17.1's `RuntimeInstance` also lists a **module registry**, a **root registry**, **active resources**, a **debug registry** and **shutdown state** (`docs/RFC.md:1361-1377`); §13 rejects the module registry with an argument, but the other four are dropped without mention.

### 11. Making `nts_enter`/`nts_leave` inline moves state the proposal never discusses
§5.5's cost table depends on inlining them. `nts_depth` is a file static (`nts_runtime.c:1426`), and `nts_leave`'s drain condition is not `depth == 0` — it also reads `nts_host_installed && nts_host.enqueue_microtask` (`:1545`). Inlining requires publishing all three to every TU, which is in direct tension with §4.6's promise that the 24 statics can later move into an `NtsRuntime` "with no public signature changes".

### 12. Step 6 breaks the conformance lane and no step repairs it
`tooling/conformance/build.sh:31-34` runs `emit-c`; M2 records 120 errors and no `module__init` for `node:path`. NTS3007 is fatal "in every mode, including `--partial`". The lane exists precisely to ship partial artifacts against a refusal histogram, and the document offers no story for what it builds between step 6 and full module-scope support — while listing "M2's `node:path` no longer silently ships" as step 6's *success* criterion. Relatedly, step 7 says the napi initializer installs the uv host, but `build.sh:53-57`'s clang line does not compile `nts_uv_host.c` and no step changes the script.

### 13. The corpus suite cannot exercise any of this
`tooling/suite/src/main.rs:31`: "Multi-file cases are skipped." Every construct this design turns on is multi-module. The project's one broad, non-self-authored evidence source stays silent throughout, so nothing in the refusal histogram will move and no step gets corpus confirmation.

### 14. No performance gate for the document's central performance claim
`tooling/bench` exists and is explicitly the project's performance conscience (`tooling/bench/src/main.rs:1-21`). §5.5 and §11 assert a crossing costs "1 relaxed load, 2 compares, 2 increments" and that hidden visibility is net-negative cost. No migration step adds a measurement of either. For a project whose stated constraint is "a per-call branch or indirection must be justified", the justification is arithmetic on read code, not a benchmark.

### 15. Manifest fields with no reader — M4 one level up
§8.2 evaluates the whole config to JSON; §8.3 validates three things. `ProductBase` also carries `host: HostSpec`, `profiles: ApiProfile[]`, `capabilities: Capability[]`, `debug: DebugProfile` (`tooling/config/src/product.ts:50-58`). §3.2 derives `requires_host` from a call-graph walk and never consults the *declared* `host.environment`; RFC §6.7 capabilities and §6.9 debug profiles go unread. A declared field with no reader is exactly the defect M4 names.

### 16. Refusals whose fixture cannot reach them
NTS1018 ("assignment to an imported binding") is listed with fixture "M6's fixture, assignment form", and the same row says it is already fatal upstream as tsgo `TS2632` (`tooling/cli/src/main.rs:895-901`). Under the project's "every rule must have a test case that executes it", that row either needs a path that reaches lowering or should be deleted. NTS1015's `namespace-with-statement` also needs checking: `is_module_declaration` (`lower.rs:451-463`) has no `MODULE_DECLARATION` entry, so which kind actually reaches the default arm is unstated. Finally, §7's NTS1015 promotes today's skip into a permanent named refusal for statement kinds legal at module scope and absent from the allow-list (`lower.rs:420-444`) — `LABELED_STATEMENT`, `for…in` (not even a constant in `syntax.rs`) — without deciding whether those are refusals or omissions.

---

## Genuinely complete

- **§1's ordering algorithm.** Depth-first post-order over `ModuleRecord.imports` is ESM's `InnerModuleEvaluation`, and the graph now exists (`link_modules`, `tsgo/mod.rs:1487-1500`). The rejection of a runtime registry is argued correctly from the absence of a TDZ representation.
- **§2.4's per-declarator classification.** The diagnosis — two classifiers disagreeing so `carries_code` is never consulted for `VARIABLE_STATEMENT` (`lower.rs:451-463` vs `:957`) — is exactly right and the fix is the right shape.
- **§4.1/§4.2's handle.** The hidden identity plus one relaxed load and compare is strictly cheaper and strictly stronger than the descriptor-address sentinel, and the choice to make exactly three words atomic is well-supported by the 24 non-atomic statics and the `nts_collecting` guard at `nts_runtime.c:471`.
- **§6.4's fatality mechanism.** Implementable exactly as written: `drop_callers_of_refused` (`hir/mod.rs:1155+`) and `root_names` (`reachable.rs:109`) both exist, and the set intersection is exact rather than heuristic.
- **§5.4's `release == NULL` and per-struct unit naming.** Correct, and correctly grounded in `NTS_IMMORTAL` static string emission.
---

# Amendments after review

Three decisions in the body above were overturned by the user on reading it.
Recorded here rather than edited in place, so that the argument the reviewers
made and the reason it did not survive are both visible.

## A1. An export does not take `NtsRuntimeHandle`

**Was:** §12 decision 1, "an export takes `NtsRuntimeHandle`, from day one,
even though it is ignored", described as the only external ABI decision in the
document and the central "so we do not refactor later" purchase.

**Now:** exports take their own arguments and nothing else.

```c
double counter_reading(void);
```

The reviewers' argument was future-proofing: changing a signature later breaks
every consumer. It does not survive contact with the rest of the same
document. §4 refuses more than one runtime per image and makes shutdown
terminal, so there is exactly one runtime and the handle is a compile-time
constant carrying no information. Every check it was said to enable --
use-before-create, use-after-shutdown, a forged handle, the §17.4 thread check
-- is a comparison against the image's own state word, which a parameter does
not help with and which §4.1 already performs internally.

What remains is a bet on multi-instance. But §4 lists what multi-instance
actually costs: threading an `NtsRuntime *` through twenty-four file-scope
objects and a cycle collector whose `nts_collecting` guard makes a concurrent
second instance *drop* its candidates. The handle is the cheapest part of that
change, so carrying it now buys a small fraction of a transition that is
explicitly deferred, at the price of a parameter on every call in every
program that ever links this.

And the mechanism for changing it exists: §5's `NTS_ABI_VERSION` and surface
digest were built for precisely this, then argued against being used. A
pre-1.0 compiler with a version field and a staleness check should use them.

The handle survives where it means something -- `create` produces one,
`shutdown` consumes it -- because there it is the token that says *you* created
this runtime.

## A2. An export returns its own type, not `NtsStatus`

**Was:** §5, uniform `NtsStatus <product>_<name>(handle, args…, out…)`.

**Now:** `double counter_reading(void)`.

The justification was that a TypeScript function can throw and a `double`
return has nowhere to put that. But nothing throws *out* of a function today:
there is no `try`/`catch`, so `nts_thrown` prints and calls `abort()`
(`runtime/c/nts_runtime.c`, and the header says so at
`runtime/c/nts_runtime.h:355-360` -- "every throw is uncaught by construction
and a throw is a *termination*"). Every export would pay an out-parameter and a
status test for a failure channel that does not exist.

When exceptions land, a function that can throw takes the status form, the ABI
version bumps and the digest catches stale headers. That is one bump on a
compiler with no released ABI, against a permanent cost on every call.

The status enum itself stays: `create` and `shutdown` genuinely have several
outcomes, and that is where it belongs.

## A3. The public surface is the entry module's exports

**Was:** §6 and §8, the surface is `exports: [...]` in `nts.config.ts`.

**Now:** by default the surface is what the entry module `export`s.
TypeScript's `export` keyword already declares it; restating each name in a
manifest is duplication that drifts, and the drift is silent in the direction
that matters -- a name removed from the manifest is quietly pruned from the
artifact.

`exports: [...]` remains as optional *narrowing*, for a product that wants to
publish less than its entry module exports. `undeclared()`
(`compiler/core/src/hir/reachable.rs:78-89`) already reports the reverse
mistake, a manifest naming something the program does not export.

This also matches how a JavaScript package works: the entry's exports are its
API. It removes the manifest from the common case entirely -- a library with
one entry module and no narrowing needs no `exports` key at all.
