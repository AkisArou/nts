# Builtins in nts: what each target provides, and one mechanism to declare and resolve them

Saved by MainClaude from the builtins study's final message, 2026-10-22; the study could not write files itself. Main at `5a2242da2`; the probes ran on the compiler lane's release binary. Probes, notes and prior-art sources are beside this file: `notes-compiler.md`, `notes-backends.md`, `notes-platforms.md`, `prior-art.md`, `probe-results-*.txt`, `probes/`.

Terms used below:
- **Builtin:** a name a program uses without implementing it, either a global (`JSON`, `fetch`) or a module (`node:fs`).
- **Target:** where the artifact runs: Linux, GTK, macOS, Windows, a Chromium renderer, the JVM, Wasm in a browser, a Node addon.
- **Backend:** how code is generated: C, LLVM, JVM or Wasm.
- **Provider:** one implementation of a builtin on a target.

## 0. The answer in one screen

**What is true today**
- **One table decides which builtins exist, for every target at once.** Shared lowering (`compiler/core/src/hir/lower.rs`) recognises about 60 builtin names in Rust. C, LLVM, JVM and Wasm gave identical verdicts for all 51 builtins probed.
- **Backends differ only in how they run a provided builtin.** For example, `Math.sin` uses libm on C, `StrictMath` on the JVM, and the JS host's `Math` on Wasm.
- **The types promise much more than any target delivers.**
  - Every nts program type-checks against `lib.esnext.full`, which includes the DOM. So `fetch`, `document` and `TextEncoder` type-check on GTK, Windows and the JVM, then are refused at lowering.
  - No `lib` setting fits: with `lib: ["ESNext"]`, even `console` and `setTimeout` fail with TS2304.
- **A missing builtin gives a smaller program on three backends and no program on the fourth.**
  - C, LLVM and JVM still emit and exit 0, dropping the statements that call the refused function (NTS1003/NTS1005).
  - Wasm refuses to write an artifact for the same program.
  - The refusal comes in at least 12 different sentences, none naming the target or a provider.
- **nts's own implementations exist, and nothing connects them to programs.**
  - `runtime/ecmascript` has Intl, Temporal, RegExp and a full Date. Only conformance fixtures reach it.
  - `runtime/web-platform` has JSON, URL, TextEncoder, streams, AbortController, fetch and WebSocket. No global is bound to them.
- **A general binding mechanism exists and one target uses it.** The `@ntsBoundBy` overlay binds lib.dom's declarations to `nts:dom`, and only Chromium uses it.
- **The only built per-target provider choice is the event loop** (`LoopHost`), and it is guessed from link flags.

**The user's beliefs, checked**
- **Chromium reuses the engine's builtins: half true.**
  - Blink's web APIs, yes: `fetch`, `URL`, timers, `queueMicrotask`, `AbortController`, `performance.now` and `crypto.randomUUID` lower to `nts_dom_*` calls.
  - V8's ECMAScript builtins, no: Intl, Temporal, JSON and RegExp are refused, and Math, Map and Promise come from nts's C runtime.
- **Wasm does much the same through its JS host: only below the language level.**
  - About 50 helpers are JS host imports (Math, number formatting, about 25 String methods, URI coding, console, timers).
  - JSON, RegExp, Intl, Temporal, fetch, URL and TextEncoder are refused before the Wasm backend runs, though the host has every one of them.
- **The JVM and runtime/node use runtime/ecmascript and runtime/web-platform: no, not for compiled builtins.**
  - The JVM uses its own `nts.rt` classes plus JDK pieces.
  - runtime/node imports some web-platform modules by relative path, and uses host globals that exist only when it runs as TypeScript on node.
- **macOS, GTK and Windows likewise: they share the Linux C runtime for every builtin.** They differ only in the event loop.

**Three mechanisms, used inconsistently:** `@ntsBoundBy` with one user; `LoopHost` for one capability; and the predecessor vocabulary (`HostEnvironment`, `ApiProfile`, `Capability`, `HostSpec`), deleted on 2026-09-15 because nothing read it.

**The recommendation**
- Keep TypeScript's own `.d.ts` files as the type surface, unedited.
- Each package that implements builtins says so in one manifest (`package.json` → `nts.provides`).
- Each target is a profile: an ordered list of preferred providers.
- At build time the compiler resolves every builtin the program reaches to exactly one provider; `nts.config.ts` can override the choice.
- A builtin with no provider is one error that stops the build and names the target and the candidates, never a partial program. A `typeof X === "undefined"` guard folds instead.
- Each provider is tested per backend by its standard's own suite: test262, WPT, or node's tests.

## 1. The matrix

Legend:
- **CR:** a compiler intrinsic, run by each backend's helpers.
- **R:** refused at lowering (NTS1001).
- **Blink:** bound through `nts:dom`, Chromium renderer only.
- **TS, unbound:** nts has a TypeScript implementation no program can reach as the builtin.

### ECMAScript core

| Builtin | CLI, GTK, macOS, Windows (C/LLVM) | Chromium | JVM | Wasm | Node addon |
|---|---|---|---|---|---|
| Math (except random) | CR → libm | CR (nts C runtime, not V8) | CR → StrictMath | CR → JS host Math | as C |
| Math.random, Math.clz32 | R (random absent on purpose: "no differential can check") | R | R | R | R |
| JSON | R; TS in web-platform/src/json, unbound | R | R | R (the host has JSON) | R |
| Date | CR minimal (`new Date(ms)`, `getTime`); `Date.now`, `new Date()`, local getters, `toISOString` R; full Date in runtime/ecmascript, unbound | same | same | same | same |
| RegExp | R ("needs a regular expression engine"); TS engine in runtime/ecmascript, host-tested only | R | R | R | R |
| Map, Set | CR | CR | CR | CR | CR |
| WeakMap, WeakRef | R | R | R | R | R |
| Promise, async | CR on the target's loop | CR on Blink's microtasks | CR | CR | CR |
| Typed arrays, ArrayBuffer, DataView | CR | CR | CR | CR | CR (crosses N-API as a copy) |
| SharedArrayBuffer, Atomics | R | R | R | R | R |
| Intl, toLocaleString, localeCompare, normalize | R; TS plus ICU4C providers in runtime/ecmascript, unbound | R | R (ICU4J providers exist, unbound) | R | R |
| Temporal | R; TS in runtime/ecmascript, unbound | R | R | R | R |
| globalThis, eval, Proxy, Reflect | R, permanent non-goal | R | R | R | R |
| parseInt, URI functions, most String methods, Symbol, BigInt, Error classes | CR | CR | CR | CR | CR |

### Web platform and node

| Builtin | CLI, GTK, macOS, Windows | Chromium | JVM | Wasm | Node addon |
|---|---|---|---|---|---|
| console | CR → fwrite (object argument or `%` format R) | CR → stdout, not DevTools | CR | CR → host console | CR → fd 1 |
| setTimeout, setInterval | CR on the loop | Blink (the overlay beats the intrinsic by code order) | CR | CR → host | CR |
| queueMicrotask | R | Blink | R | R | R |
| fetch, Request, Response, Headers | R; TS module exports in web-platform | Blink | R | R | R |
| URL, URLSearchParams | R; **two** TS copies (runtime/node, web-platform) | Blink | R | R | R |
| TextEncoder, TextDecoder | R; TS in web-platform | R | R | R | R |
| crypto.getRandomValues, crypto.subtle | R | R | R | R | R |
| crypto.randomUUID, performance.now | R | Blink | R | R | R |
| streams, AbortController, EventTarget, Blob, WebSocket | R; TS in web-platform | AbortController Blink, others R or unprobed | R | R | R |
| structuredClone, atob, btoa | R | R | R | R | R |
| document, localStorage, alert | R | Blink | R | R | R |
| node:fs, node:path, node:events | R: nothing resolves `node:*` | R | R | R | per-module addons via tooling/conformance/build.sh (C only) |
| process, Buffer | R | R | R | R | as above |
| event loop | libuv; GLib on GTK; CFRunLoop on macOS if ObjC is used; Win32 on Windows | Blink's | NtsEnv | the JS loop | node's libuv (inferred) |

### Where each fact is declared today

- **Types:** TypeScript's lib files, chosen by tsconfig `lib`, and `@types/node` through `types`.
- **What the compiler provides:** Rust name checks spread through lower.rs (`lower_provided_builtin`, `intrinsic_of`, `console_method`, `lower_decided_static`, the global-member refusals, `no_such_callee`), plus schema.rs `provided_name` and hir/builtin.rs `ERRORS`.
- **How each backend runs a builtin:** five hand-kept tables per helper (checklist at `runtime/c/nts_runtime.h:78-111`), plus every header function in the Wasm catalog.
- **Chromium's bindings:** the `@ntsBoundBy` overlay (`runtime/chromium/dom/types/lib-dom-bindings.d.ts`, 374 tags) plus `nts:dom`, reached through tsconfig `files` or `target.chromium()`.
- **Event loop:** `LoopHost`, chosen by `loop_host()` (`tooling/cli/src/main.rs:8997-9013`) from `-lglib-2.0` in the link and the OS.
- **JVM networking:** global `nts_jvm_web_*` declarations marked `@ntsAbi intrinsic`.
- **runtime/node natives:** about 576 inline `declare function nts_*`, linked by build.sh.
- **ICU:** one tsconfig per backend under `tooling/conformance/ecmascript/icu-compiled/`.

### What happens when something is missing

- **No lib declares it:** TS2304/TS2584, and the build stops.
- **The lib declares it, lowering doesn't provide it:** NTS1001; the function is dropped and the statements calling it skipped. C, LLVM and JVM exit 0; Wasm exits 1; `nts check` says "nothing to check" and exits 0.
- **Provided, but this backend lacks a helper:** each backend fails late, in its own words (NTS2007, NTS5001, NTS4001, NTS3001). Declarations aren't tied to a target, so a JVM-only one reaches C's emitter before anything refuses it.

## 2. Inconsistencies, ranked by cost

1. **What exists is decided once, for all targets, in Rust.** A target can neither add what its host has nor say what it lacks. The intended design (`docs/any-unknown.md:532-566`, "profiles that associate trusted declaration identities") was never built.
2. **Types promise everything; compilation delivers a subset.** No `lib` fits.
3. **A missing builtin silently shrinks the program on three backends of four.**
4. **nts's own implementations cannot be connected to programs.** `DATE-TEMPORAL-INTL.md:51` still lists "standard builtin binding" as an open first step.
5. **The general mechanism has one user, and its precedence is accidental:** whether the overlay file is in the program, and code order in lowering.
6. **One cause, a dozen sentences, none actionable.** All share NTS1001 with real lowering gaps. The `Date.now`/`Date.UTC` messages carry 31 stray spaces (lower.rs:23294-23296).
7. **Capabilities are decided in prose at refusal sites.** Clock and randomness are withheld though the runtimes have them; the real reason, that differentials can't check them, is a testing problem.
8. **Duplicates with no rule choosing:** two Dates, URLSearchParams ×2, Blob/File ×2, and runtime/node's host-global `declare global` forms.
9. **Helper-level choices differ per backend and fail late.** Each new helper owes rows in five hand-kept tables.
10. **Declarations arrive four ways:** listed in `include`, generated by a Binder, injected by `Target.surface`, swapped by tsconfig `paths`. Products' surfaces are unioned (main.rs:1404-1417) where nts-config.md §4 says intersection.
11. **The only per-target provider is chosen by heuristics** (`-lglib-2.0`, ObjC use, `--glib`).
12. **Vocabulary and documents disagree.** "Provider" means four things. typescript.md §8 lists Intl as "not a goal" while runtime/ecmascript implements it. `@ntsNoFold` is written five times and read by nothing. Three generators are Python, against the TypeScript-tooling rule.
13. **`node:*` has no resolver.** A native program cannot `import "node:fs"`.
14. **`@types/node` and lib.dom disagree on `setTimeout`,** and the node form is refused.

## 3. Prior art

Full notes in `prior-art.md`.
- **Kotlin `expect`/`actual`:** a build-time completeness check, with host types allowed as implementations.
- **Rust `cfg` and `std`/`core`:** keys fixed by the target; `no_std` makes using `std` a compile error. Avoid wasm32-unknown-unknown's "compiles but fails at run time".
- **.NET `[SupportedOSPlatform]` and CA1416:** the message names the platform; guarded calls are accepted; trimming switches choose host versus own and drop the loser.
- **Node `internalBinding`, Deno ops, Bun:** take one unit and builtins written in the source language; avoid four mechanisms.
- **Hermes, Porffor, AssemblyScript, GraalJS, Javy:** host Intl, TypeScript builtins included only when reached, `@builtin declare`, option-chosen surfaces, plugin-decided APIs.
- **TypeScript `lib`/`types`:** types only; `customConditions` lets an editor resolve the same per-target file nts picks.
- **WinterTC Minimum Common Web API:** a named, versioned list of globals a runtime shall provide, plus a runtime-keys registry.

## 4. The proposal: features, providers, profiles

### 4.1 Terms

- **Feature:** one thing a program names and doesn't implement.
  - A global: `es:JSON`, `es:Intl`, `web:fetch`, `web:setTimeout`, `dom:document`.
  - A module: `node:fs`, `objc:AppKit`, `c:Gtk-4.0`.
  - A capability: `host:loop`, `host:clock`, `host:random`, `host:tcp`, `host:tls`, `host:icu`.
  Identity is derived from the declaration (lib.es → `es:`, lib.dom → `web:`/`dom:`, @types/node → `node:`).
- **Provider,** one of three kinds:
  - `compiler`: the compiler owns the representation. Available on a backend only if it implements every helper.
  - `source`: an nts TypeScript module whose exports carry the global's name, compiled and tree-shaken with the program.
  - `binding`: a declaration module implemented outside nts, either `host` (Blink, the Wasm JS host, node) or linked (ICU4C, libuv, OpenSSL, GLib, Foundation, WinRT, the JDK).
  The FFI tags (`@ntsJvm`, `@ntsSelector`, ...) stay: they say how to call a binding.
- **Profile:** a target's ordered preferences, plus pins and denials.
- **Rename:** `hir::Provider` becomes `hir::Memory`.

### 4.2 Types

Upstream declarations stay as written. The default lib stays `ESNext`+`DOM` for every target, with `types:["node"]` where the profile provides `node:*`. The resolver plays the analyzer's part.

### 4.3 One manifest per provider package

The manifest lives in `package.json` under `nts.provides`, with entries like these:
- `"web:TextEncoder": {"source": "./src/core/encoding.ts"}`
- `"es:JSON": {"source": ..., "members": ["stringify"]}`
- `"web:fetch": {"source": ..., "requires": ["host:tcp", "host:tls", "host:dns", "host:random", "host:loop"]}`
- `"es:Intl": {"source": ..., "requires": ["host:icu"]}`
- `"host:icu": {"binding": "c:nts_icu", "backends": ["c", "llvm"]}`
- Chromium's `"dom:*": {"binding": "nts:dom", "host": "chromium-renderer"}`
- `"node:fs": {"source": ..., "backends": ["c", "llvm"], "link": {...}}`

Rules:
- Export by name, checked against the lib declaration.
- `members` narrows a claim.
- `reexports` enforces one identity.
- The compiler's own provider uses the same form, generated from a Rust table (`compiler/core/src/hir/features.rs`), with a drift test.

### 4.4 Profiles

Profiles are code in `@nts/config` (`tooling/config/src/profiles.ts`):
- `native`: backends c and llvm; prefer compiler, then ecmascript, web-platform, node and host-native; `host:loop` pinned to libuv.
- `gtk`, `macos`, `windows`: `native` with `host:loop` pinned to GLib, CF or Win32.
- `chromium`: prefer `@nts/chromium` first, and deny `node:*`.
- `jvm`, `wasmBrowser`, `nodeAddon`.

`nts.config.ts` overrides per product, e.g. `providers: {"es:Intl": {use: "@nts/ecmascript", options: {locales: ["en", "el"]}}, "web:fetch": "none"}`.

### 4.5 Resolution at build time

1. **Dependencies are what the program reaches:** a new `SymbolRecord::library` field, bumping `SCHEMA_VERSION`.
2. **Candidates** are the providers whose backends and host admit the target.
3. **Choice order:** the config's choice, then the profile's pin, then the first in `prefer`. An ambiguity is an error.
4. **`requires` resolve recursively;** linked inputs join only if reached.
5. **One provider per feature per program.**
6. **A guard folds:** `typeof X === "undefined"` on an unavailable global becomes a constant.
7. **Missing provider modules are added** through the frontend's `with_added` hook (two passes; the snapshot cache makes the second cheap; give it a tripwire).

Where each piece lives:
- the resolver: `build/src/features/`;
- the binding table: `compiler/core/src/hir/features.rs` (`binding_of`), replacing `provided_name`, `primitive_builtin`, `global_predicate`, `math_member`, `console_method`, the error list, `bound`, `bound_types` and `lower_bound_global_call`;
- inspection: `nts providers <project> [--sizes]`.

### 4.6 Diagnostics

One code, fatal on every backend, reported at type-check time. NTS1001 stays for real lowering gaps.
- **NTS1100** "`fetch` is not available on target linux-x64": it lists each provider and why it doesn't apply, then the fix.
- **NTS1101** never-provided (eval).
- **NTS1102** an invalid config choice.
- **NTS1103** a warning that a host provider's results follow the host.

### 4.7 Size

- Unreached features cost nothing; source providers are ordinary tree-shaken code.
- Host bindings cost only glue: Intl from the browser is 0 KB, against about 33 MB for nts's full-locale ICU.
- Provider `options` choose data variants, and `nts providers --sizes` reports the bytes.

### 4.8 Testing each provider

- **Suites:** test262 `built-ins/<Name>` for `es:*`, WPT for `web:*`, node's test/parallel for `node:*`.
- **Records** per (provider, backend[, host]) in `tests/providers/`, from compiled runs only.
- **Admission:** a profile resolves only to a recorded provider, otherwise `experimental`.
- **A census step** of one probe per feature × profile.
- **A bench row** per provider for each hot feature.

### 4.9 What this replaces

- `@ntsBoundBy` and the overlay;
- `Target.surface`/`native`;
- `loop_host()`/`for_program`/`--glib`;
- the global `nts_jvm_web_*`;
- build.sh linking and the `@nts/runtime/*` alias;
- the `paths` swaps;
- sdk's `availability()`;
- the name lists in lower.rs and schema.rs;
- `hir::Provider` (renamed);
- about 12 refusal sentences and the partial artifacts.

## 5. Staged migration, smallest first

1. **One word, one diagnostic (compiler lane):** the `hir::Memory` rename; NTS1100 fatal on all backends; the 31-space defect; the 51 probes as refusal fixtures, each with a control.
2. **Feature identity and the compiler's table:** `SymbolRecord::library` plus a schema bump, and `hir/features.rs`. Behaviour-neutral.
3. **Manifests, profiles and the resolver, encoding exactly today:** `host:loop` replaces `loop_host()`, plus `nts providers` and a census gate step.
4. **One binding table in lowering:** `nts:dom` exports by name, and the overlay goes.
5. **First source providers:** TextEncoder/TextDecoder, atob/btoa, AbortController, `es:JSON` (stringify first). `web:URL` waits for the canonical-copy decision.
6. **Clock and randomness** (needs question 2).
7. **Wasm host providers** (needs question 1).
8. **runtime/ecmascript** as Intl, Temporal, RegExp and full Date; `host:icu` is ICU4C on C/LLVM and ICU4J on the JVM.
9. **`node:*` for native programs.**
10. **Platform-library providers:** OpenSSL, URLSession, WinHTTP, libsoup.
11. **Editors and libraries:** the LSP shows NTS1100, a library resolves against each of its targets, and reached features are written into package metadata.
12. **One helper registry** with per-backend columns, replacing the five tables.

Stages 1-3 need no product decision; 6 and 7 wait on §6.

## 6. Open questions for the user

1. **Host versus own** where both exist (Intl, RegExp, JSON and Date on wasm-browser and Chromium).
2. **Provide** `Date.now`, `new Date()`, `Math.random` and `performance.now`, with deterministic test providers?
3. **May apps override providers in nts.config.ts?**
4. **Is Intl a goal?** typescript.md §8 says no; runtime/ecmascript implements it.
5. **Type world:** keep `lib.esnext.full` plus the NTS1100 analyzer, or per-target libs?
6. **Should `typeof fetch` fold to "undefined"** on a target without it?
7. **Node APIs:** native-only, or also the JVM, Wasm and Chromium?
8. **May packages outside `@nts/*` provide `es:*`/`web:*` features?**
9. **The canonical copy of URLSearchParams and Blob/File.**

## 7. Not verified

- `nts build` on a product with an NTS1001, and executing the partial artifacts;
- the node addon's loop;
- macOS, iOS and Windows;
- Chromium's Blob and EventTarget;
- the two-pass frontend cost;
- any size or speed effect of the proposal.
