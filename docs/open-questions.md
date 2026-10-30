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
| 1 | **System packages in the build:** host builds need the system's clang, and configs need node, against "nts never depends on a system package" (T-1) | Bundle the toolchain (zig). **research:** its size and licences |

## 1. Language and compiler

| # | question | today | recommendation |
|---|---|---|---|
| L5 | TypeScript's unsoundness against typed layouts: covariant arrays, bivariant parameters | Widening between different element layouts is refused on every backend (NTS1001). A wider `Sub` makes the widening itself refused (NTS1001), so a read past the object cannot arise. Between equal layouts, C and LLVM call a `Base` pushed through a `Base[]` alias of a `Sub[]` as a `Sub`; the JVM refuses by name (NTS4001) only where the alias and the store share one function, and across a function boundary it aborts (`ClassCastException` at the read, `ArrayStoreException` at an indexed store). Pinned in `tests/outcomes/a-base-pushed-through-a-covariant-array-dispatches-as-the-subclass*` | **user** (10-27): behave as node does. The mechanism: refuse the widening at compile time where the layouts differ; check at the store where an idiom needs it. **research:** Dart, Static Hermes |
| L9 | Generics that cannot be copied per type: polymorphic recursion, a library's exported generic classes | copies only, at most ten | An erased fallback: one shared copy over erased values. **research:** Go's GC-shape stenciling |
| L14 | Which run-time errors are catchable | only explicit throws; stack exhaustion, BigInt past 128 bits and failed `this` tests abort; Windows has no stack-exhaustion handler | **user** (10-28): everything JavaScript throws is catchable, stack exhaustion as a `RangeError`. **research:** the cost of an entry check against guard pages |
| L17 | Top-level `await`, `import.meta`, JSON and text modules | refused or not lowered | **user** (10-28): implement them. **research:** what `import.meta.url` holds under `bun build --compile` |
| L22 | Separate and incremental compilation | whole program only; no cache | Closed world for executables; libraries declare an export surface with L9's fallback; a validated cache later. **research:** Kotlin/Native, Swift |
| L24 | How `globalThis` costs nothing where unused | refused; in scope for later (user, 10-27): after the static foundations, and discussed before any design | A static `globalThis.X` folds to the binding; only a dynamic read or write builds a global object, holding just the globals the program can reach |
| L25 | How `Proxy` and `Reflect` cost nothing where unused | refused; in scope for later (user, 10-27): after the static foundations, and discussed before any design | Only values a `new Proxy` can reach take the trap path, which the compiler proves; every other access stays direct |
| L26 | How object integrity (`Object.freeze`, `seal`, `preventExtensions` and their predicates) costs nothing where unused | refused; in scope for later (user, 10-27): after the static foundations, and discussed before any design | A flag in the object's header, checked on a write only where a freeze can reach the object |

## 2. Builtins and globals

| # | question | today | recommendation |
|---|---|---|---|
| G8 | Platform network stacks or the shared engine | the shared engine; OkHttp on Android | The shared engine first; platform stacks only where store rules require. **research:** trust stores, proxies |
| G13 | Time zones without Intl | local time refused | Node's pinned TZDB, emitted as data only into programs that use local time. **research:** size |
| G14 | Intl locales and data | providers exist, unbound | Locales declared in `nts.config` (default `en`), with ICU's fallback; never the device's ICU (D2, D3). **research:** sizes |
| G15 | Temporal on Wasm, and whether to provide what node lacks | refused everywhere; node 24.20 has no `Temporal`, Bun 1.4 has it (checked 10-27) | **user** (10-28): `runtime/ecmascript`'s wherever the host lacks it, node included. **research:** browser support, for Wasm |
| G17 | The DOM in a browser | refused | **research** (W5), then WebIDL-generated `externref` imports in Chromium's binding shape |

## 3. Memory

| # | question | today | recommendation |
|---|---|---|---|
| M-3 | The cycle collector: its throughput, its pauses, and returning memory to the OS | trial deletion with a fixed 10,000-candidate trigger; glibc's thresholds. `cyclic-churn` is 8.4× node, two thirds of its cycles in the collector, where the JVM is 1.1× | Typed visitors in memory stage 1; then pause-time and RSS rows, an adaptive trigger, and purging with stage 6. **research:** trial deletion against a backup tracing pass for cyclic garbage |
| M-4 | Cycles through Objective-C blocks | design open | **research:** whether a block's retains can be observed |
| M-5 | Weak references off native | J1 and W1 proposed | **research** (the JVM/Wasm request) |

## 4. Concurrency and async

| # | question | today | recommendation |
|---|---|---|---|
| C-5 | Two microtask queues on JS hosts | Chromium already runs the program's jobs on Blink's queue; Wasm in a JS host is designed to keep its own queue, drained at each export | Adopt the host's queue wherever promises cross, as Chromium does. **research:** ordering traces |

## 5. Interop and hosts

| # | question | today | recommendation |
|---|---|---|---|
| I-2 | Host failures reaching a `catch` | GError, NSError, HRESULT built; Java declines; `NSException` and C++ exceptions nowhere | **user** (10-28): every host error becomes a catchable `Error` carrying the host value. Settled (10-30): nothing unwinds through C frames; a C error is a return code, a `longjmp` library is called through a C adapter, and a throw escaping a callback is the program's uncaught error ([Calling C](targets/calling-c.md#errors)) |
| I-8 | One DOM source for Chromium and browser Wasm | Blink's IDL for Chromium; nothing for Wasm | One generator over one IDL set. **research:** coverage of webref against Blink's IDL |
| I-9 | Supported engines and the WASI version | JS String Builtins and `JSTag` required | Current Chromium, Firefox and Safari; WASI 0.2 first. **research** |
| I-10 | nts as a Node-API host: a native program loading a `.node` addon, such as `sharp`'s, as node, Bun and Deno do | none: nts builds addons that node loads, and loads none itself | **user** (10-28): native targets (C, LLVM) load Node-API addons; the JVM and browsers load no native code. **research:** the Node-API version and function coverage to owe first; the object model addons see (dynamic properties, prototypes, `napi_wrap`, references and finalizers, on L7's member tables); how handle scopes, references and finalizers meet reference counting and the cycle collector; async work and threadsafe functions on the event loop; the addon ABI across nts versions |

## 6. Bindings, products, toolchains, dependencies

| # | question | today | recommendation |
|---|---|---|---|
| T-1 | A bundled toolchain or an installed one | system clang (or zig), node for configs | Bundle zig (clang, lld, libcs) as the default. **research:** size, licences |
| T-2 | LLVM version coupling; ThinLTO on cross builds | text IR; cross builds without LTO | Text IR at the bundled LLVM's version; ThinLTO through `zig cc`. **research** |
| D-2 | Binaryen inside the compiler | decided, not adopted | Vendored and built from source at W7's pin. **research:** build time, size |

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
9. "One answer per question across backends"; holes and covariant stores get a wrong answer on C and LLVM; covariant stores abort on the JVM across a function boundary (L4, L5).
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
