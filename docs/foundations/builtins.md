# Builtins

**Status:** approved by the user; stages 1 and 2 are partly built.
It carries out the eleven decisions listed at the end. The study it comes from,
with its 51 probes, is [in the records](../records/notebooks/studies/builtins.md),
with [its prior art](../records/notebooks/studies/builtins-prior-art.md).

A **builtin** is a name a program uses without implementing it: a global
(`JSON`, `fetch`, `document`) or a module (`node:fs`).
[`../targets.md`](../targets/README.md) lists what each target offers today. This
page covers how a target says what it provides, and how a build picks one
implementation of each builtin.

## Where nts stands

| | today |
|---|---|
| **What exists** | One name list in the compiler decides which globals exist, for every target at once: `PROVIDED_GLOBALS` in `compiler/core/src/hir/builtin.rs`, plus the lowering it names. |
| **A missing builtin** | NTS1100 names it and its feature: `` `Date.now` (es:Date) is not provided by this compiler ``. It stops `nts build` before anything is written. NTS1101 is a builtin no target will provide (`eval`). The inspection commands still compile what they can. |
| **Feature identity** | Each symbol a library declares records its library (`SymbolRecord::library`: `es`, `dom`, `node`, or a package's name). One classifier decides it: `Library::of_path`. |
| **Per-backend helpers** | A source can test `typeof nts_helper === "function"` on an `@ntsAbi intrinsic` declaration. Each backend's preparation answers it from that backend's own helper table (`hir/features.rs`). So one TypeScript source calls a native helper where it exists and runs its own body elsewhere. |
| **Chromium** | 374 `@ntsBoundBy` tags bind lib.dom's declarations to Blink through `nts:dom`. Whether a tag or the compiler's own intrinsic wins depends on whether the overlay file is in the program, and on code order in lowering. |
| **The event loop** | The only per-target provider choice that is built (`LoopHost`). It is guessed from the link flags (`loop_host()` in `tooling/cli/src/main.rs`). |
| **nts's own implementations** | `runtime/ecmascript` has Intl, Temporal, RegExp and a full Date; `runtime/web-platform` has JSON, TextEncoder, streams, fetch and WebSocket, and `runtime/node/url` has `URL`. No program can reach them as builtins. |
| **`node:*`** | 28 modules are in `runtime/node`, but no resolver exists, so a native program cannot `import "node:fs"`. |

What this costs:
- **A target cannot add what its host has, or say what it lacks.** Wasm in a
  browser refuses `JSON.parse`, although the host has it.
- **nts's own implementations are unreachable.** So Intl, RegExp and Temporal
  are refused everywhere.
- **Duplicates have no rule choosing between them:** two Dates, two
  `URLSearchParams`, and two each of `Blob` and `File`.
- **A helper a backend lacks fails late,** in that backend's own words. Each
  new helper also owes rows in hand-kept tables in four crates.

## Terms

- **Feature:** one thing a program names and does not implement. Its identity
  comes from the library that declares it, which `SymbolRecord::library`
  already records.
  - a global: `es:JSON`, `es:Intl`, `web:fetch`, `web:setTimeout`,
    `dom:document`;
  - a module: `node:fs`, or a platform library (`objc:AppKit`, `gi:Gtk-4.0`);
  - a capability that providers need: `host:loop`, `host:clock`,
    `host:random`, `host:tz`, `host:tcp`, `host:tls`, `host:icu`.
- **Provider:** one implementation of a feature. There are three kinds:
  - **compiler:** the compiler owns the representation (`Map`, `Promise`, typed
    arrays), and each backend runs its helpers. It is available on a backend
    only where every helper it needs exists.
  - **source:** a TypeScript module of nts's whose exports carry the global's
    names. It is compiled and tree-shaken with the program, like
    `runtime/web-platform`'s `TextEncoder`.
  - **binding:** a declaration module implemented outside nts. Either the
    **host** implements it (Blink, the Wasm JS host, node for an addon), or a
    **linked** library does (ICU4C, libuv, OpenSSL, the JDK). The FFI tags
    (`@ntsJvm`, `@ntsSelector` and the rest) stay; they say how to call a
    binding.
- **Profile:** a target's ordered list of preferred providers, with pins and
  denials.

## The design

### Manifests

A package that provides features declares them in one manifest:
`package.json`'s `nts.provides`.

```jsonc
"nts": { "provides": {
  "web:TextEncoder": { "source": "./src/core/encoding.ts" },
  "es:JSON":         { "source": "./src/json/index.ts", "members": ["stringify"] },
  "web:fetch":       { "source": "./src/fetch/index.ts",
                       "requires": ["host:tcp", "host:tls", "host:random", "host:loop"] },
  "es:Intl":         { "source": "./src/intl/index.ts", "requires": ["host:icu"] },
  "host:icu":        { "binding": "c:nts_icu", "backends": ["c", "llvm"] }
} }
```

- **A source provider exports each name the lib declares,** and the export is
  checked against that declaration.
- **`members` narrows a claim** to part of a global.
- **A feature has one identity:** a re-export names where the canonical copy
  lives. Decision 10 makes web-platform's `URLSearchParams`, `Blob` and `File`
  canonical; `runtime/node` re-exports them.
- **Only `@nts/*` packages provide `es:*` and `web:*` features.** Other
  packages may provide `host:*` capabilities and their own modules
  (decision 9).
- **The compiler's own provider uses the same form,** generated from its Rust
  table, with a test that the two agree.

### Profiles

A profile is code in `@nts/config`, one per target:

| profile | prefers | pinned or denied |
|---|---|---|
| `native` (Linux) | the compiler, then `@nts/ecmascript`, `@nts/web-platform`, `@nts/node`, then linked libraries | `host:loop` is libuv |
| `gtk`, `macos`, `windows` | as `native` | `host:loop` is GLib, CFRunLoop or the Win32 message loop |
| `chromium` | `@nts/chromium` (Blink), then as `native` | `node:*` denied (decision 8) |
| `jvm`, `android` | the compiler, then nts's sources, then the JDK and the Android SDK | `node:*` denied for now (decision 8) |
| `wasm-js` (browsers, node) | the host's Intl and RegExp (decision 3), then nts's sources; another host builtin only where a decision names it (G2) | `node:*` denied for now |
| `wasm-standalone` | the compiler, then nts's sources | Intl not provided (D6) |
| `node-addon` | as `native` | `host:loop` is node's |

Where both the host and nts implement a feature, nts's own is the default, and
the host's is taken only where a decision says so; each such choice is made
by the feature's benchmark row and conformance record (decision 3, G2).

A product may override a choice in `nts.config.ts`, but only with a provider
that has a conformance record (decision 6):

```ts
providers: { "es:Intl": { use: "@nts/ecmascript", options: { locales: ["en", "el"] } } }
```

### Resolution at build time

1. **What the program reaches:** each feature named by the library of a symbol
   the program reaches.
2. **Candidates:** the providers whose backends and host admit the target.
3. **The choice:** the product's override first, then the profile's pin, then
   the first preferred provider. Two equal candidates are an error, never a
   guess.
4. **Requirements resolve the same way.** A linked library joins the link only
   when something the program reaches requires it.
5. **One provider per feature per program.**
6. **A guard folds:** `typeof X === "undefined"` and `"X" in globalThis` on a
   feature the target lacks become constants, and the branch they rule out is
   pruned (decision 7, G3); `globalThis` itself is deferred (L24).
   `features.rs` already does this for helpers.
7. **Provider modules join the program** through the frontend's hook for added
   files, and are checked once more. The hook gets a compile-time tripwire.

`nts providers <project> [--sizes]` prints each feature the program reaches,
the provider chosen and why, and its size.

### Diagnostics

| code | meaning | state |
|---|---|---|
| NTS1100 | No provider on this target supplies the feature. The message names the target, each candidate and why it does not apply, and the fix. | Built, without the target and candidates; stops `nts build`. |
| NTS1101 | No target will provide the feature (`eval`). | Built. |
| NTS1102 | An override names a provider that does not apply here, or has no record. | New. |
| NTS1103 | A warning: a host provider's results follow the host, such as Intl's data on a JS host. | New. |

NTS1001 stays for real lowering gaps.

### Types

Every target uses one full lib, ESNext plus DOM, with `types: ["node"]` where
the profile provides `node:*`, so native programs see node's types, timers
included, and Chromium and browsers see the DOM's (G4). NTS1100 is the
per-target check (decision 11). Upstream declarations stay as written.

### Size

- **A feature the program does not reach costs nothing.** A source provider is
  ordinary code, tree-shaken.
- **A host binding costs only its glue.** Intl from a browser is 0 bytes,
  against about 33 MB for nts's own ICU with every locale.
- **A provider's `options` choose its data,** such as Intl's locales (G14).
  `nts providers --sizes` reports the bytes.

### Testing

- **Each provider runs, compiled, against its standard's own suite:**
  test262's `built-ins/<Name>` for `es:*`, the web-platform tests for `web:*`,
  and node's `test/parallel` for `node:*`.
- **A record per provider, backend and host,** in `tests/providers/`.
- **A profile resolves only to a recorded provider.** Any other is
  `experimental`, and says so.
- **A census step** runs one probe per feature and profile.
- **A benchmark row** for each provider of a hot feature.

## The clock and randomness

Decision 2 says `Date.now`, `new Date()`, local time, `Math.random`,
`performance.now` and `crypto.getRandomValues` come from the environment, with
a virtual clock and seeded randomness under the differential tests.

In this mechanism each is a capability with two providers:
- **the real provider,** which every product gets;
- **a deterministic provider,** which only the test profile pins.

So a production program contains no test provider and reads no test switch.

| | real provider | under the differential tests |
|---|---|---|
| **`host:clock`:** `Date.now`, `new Date()`, `performance.now`, timers | `clock_gettime` (Linux, macOS); `GetSystemTimePreciseAsFileTime` and `QueryPerformanceCounter` (Windows); `System.currentTimeMillis` and `nanoTime` (JVM); the host's `Date.now` and `performance.now` (JS hosts); WASI's clocks | A virtual clock: it starts at a fixed instant and moves only when a timer fires, to that timer's due time. Node gets the same clock from a preload in the differential harness. |
| **`Math.random`** | V8's generator, bit for bit (below), seeded once from `host:random` | The same generator with the test's seed. This reproduces `node --random-seed=N`, so differential tests compare programs that use `Math.random`, with no stub. |
| **`host:random`:** `crypto.getRandomValues`, `randomUUID`, TLS | The OS's generator (`getrandom`, `arc4random_buf`, `BCryptGenRandom`, `SecureRandom`, the host's `crypto`); never seeded | A seeded stream, the same on both sides through the preload. |
| **`host:tz`:** local time | The time-zone data (G13) and the process's zone | A fixed zone, UTC. |

**Why V8's generator.** "`Math` is bit-identical to node" is decided
([decisions](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), "Numbers and JSON"), and the generator can
match exactly.

**What V8's generator is:**
- xorshift128+;
- the state seeded from MurmurHash3's finalizer of the seed and of its
  complement;
- refilled 64 values at a time and read from the end;
- each value is `(s0 >> 11) / 2^53`.

**Checked.** A TypeScript model reproduces node 24.20.0's
`--random-seed=N` exactly: 1,000 of 1,000 values at each of four seeds,
including a negative one and the largest. So node's startup draws nothing
before the program's first call. In node, seed 0 means unseeded. The model and
its result are [in the records](../records/notebooks/studies/v8-math-random.md).

## Where each piece lives

- **The resolver:** `build/src/features/`.
- **The binding table:** `compiler/core/src/hir/features.rs`, grown from
  today's helper slice. It replaces the name lists spread through lowering
  (`PROVIDED_GLOBALS`, `primitive_builtin`, `intrinsic_of`, `console_method`,
  `math_member` and the rest).
- **Profiles:** `tooling/config/src/profiles.ts`.
- **Records:** `tests/providers/`.

## What it replaces

- the `@ntsBoundBy` overlay and its accidental precedence;
- `loop_host()`, and the guesses from `--glib` and Objective-C use;
- `Target.surface`, and the four ways declarations arrive today;
- the global `nts_jvm_web_*` declarations;
- `runtime/node`'s `build.sh` linking and its `@nts/runtime/*` alias;
- the tsconfig `paths` swaps, and `runtime/sdk`'s `availability()`;
- about twelve refusal sentences, replaced by one NTS1100.

## Stages, smallest first

| # | stage | state |
|---|---|---|
| 1 | One diagnostic: NTS1100, fatal on every backend. The study's 51 probes become refusal fixtures, each with a control. `hir::Provider` is renamed `hir::Memory`. | NTS1100 and NTS1101 built, and fatal for `nts build`; the rename built; the probe fixtures open |
| 2 | Feature identity, and the compiler's table | `SymbolRecord::library` and the helper slice of `features.rs` built; the compiler's provider table, with members, open |
| 3 | Manifests, profiles and the resolver, encoding exactly what exists today. `host:loop` replaces `loop_host()`. `nts providers` and a census step. | open |
| 4 | One binding table in lowering. `nts:dom` binds by name, and the overlay goes. | open |
| 5 | The first source providers: `TextEncoder` and `TextDecoder`, `atob` and `btoa`, `AbortController`, and `es:JSON` (`stringify` first) | open |
| 6 | The clock and randomness (above) | designed |
| 7 | Wasm host providers | decided (decision 3) |
| 8 | `runtime/ecmascript` as Intl, Temporal, RegExp and the full Date. `host:icu` is ICU4C on native and ICU4J on the JVM. | open |
| 9 | `node:*` for native programs, with a resolver and the `process` and `Buffer` globals (G10) | open |
| 10 | Platform providers for the network (G8) | open |
| 11 | Editors and libraries: the language server shows NTS1100, and a library resolves against each of its targets | open |
| 12 | One helper registry with a column per backend, replacing the per-crate tables | open |

Stages 1 to 6 need no decision beyond approving this page.

## Still open

These are in [`../open-questions.md`](../open-questions.md#2-builtins-and-globals),
with recommendations:
- G8: platform network stacks beside the shared engine (stage 10);
- G13: time zones without Intl;
- G14: Intl's locales, and what each costs;
- G15: whether browsers provide `Temporal` to Wasm;
- G17: the DOM in a browser, for Wasm.

## Decisions

This page is approved as a whole (10-28,
[log](../records/notebooks/decisions-log.md#builtins-mechanism-10-28)): a package declares
what it can provide in its `package.json`, each target's profile orders the
providers, and an app's `nts.config.ts` may override a choice. With it, also
10-28:

- **The web floor on native and the JVM is WinterTC's Minimum Common Web
  API:** every API in it is provided there (register G5, G7).
- **The floor includes the `WebAssembly` JavaScript API** (`compile`,
  `instantiate`, `validate`, `Module`, `Instance`, `Memory`, `Table`, `Global`
  and the error types). On native and the JVM a program that reaches
  `WebAssembly` gets an embedded Wasm engine, chosen under the dependency
  policy (D-1, [foundations](README.md#decisions)) and linked only into that
  program; a program that does not reach it pays nothing. It comes last in the
  web-floor work.
- **One package per spec family:** `es:*` features live in
  `runtime/ecmascript`, `web:*` in `runtime/web-platform` and `node:*` in
  `runtime/node`. So JSON (ECMAScript) moves to `runtime/ecmascript` and `URL`
  (WHATWG) to `runtime/web-platform`.

From the open-questions audit, also 10-28
([log](../records/notebooks/decisions-log.md#builtins-and-globals-10-28)):

- **nts's own implementation is the default;** the host's only where a
  decision says so, as decision 3 does for Intl and RegExp on JS hosts, each
  chosen by its benchmark row and conformance record (G2).
- **Feature detection folds per target at compile time,** in both forms:
  `typeof X === "undefined"` and `"X" in globalThis` (G3).
- **`types: ["node"]` wherever a profile provides `node:*`:** native programs
  see node's types, timers included; Chromium and browsers see the DOM's (G4).
- **Randomness and crypto:** the OS's secure random generator on each target,
  as `host:random`; `crypto.subtle` from the vendored OpenSSL on native, the
  JCA on the JVM, and the host on JS hosts (G16).
- **`console` formats values as node's `util.inspect` does,** in shared
  TypeScript, and writes to each platform's log (G18).

Each target's own choices are on its page: Chromium's overlay (G6) on
[Chromium](../targets/chromium.md#decisions), a Node addon's builtins (G11) on
[Node addon](../targets/node-addon.md#decisions), `SharedArrayBuffer` on
Android (G19) on [the JVM](../targets/jvm.md#decisions); the untyped JSON
parser (G9) is on [JSON](json.md#decisions), `node:*` (G10) on
[modules](../language/modules.md#decisions), and `Temporal` (G15) on
[time and Intl](time-and-intl.md#decisions).

Also 10-28, a new decision
([log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)):

- **nts is a Node-API host on native targets**
  ([native](../targets/native.md#decisions)). In the `node:*` surface, a
  `require` of a `.node` file and `process.dlopen` resolve to that host, so an
  npm package that ships a native addon, such as `sharp`, runs. Not built;
  what is still to design is register
  [I-10](../open-questions.md#5-interop-and-hosts).

From the user ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)):

1. Intl is in scope, with locale subsets keeping it small.
2. The clock and randomness come from the environment, with a virtual clock and
   seeded randomness under the differential tests.
3. On JS hosts (Wasm in a browser or node, Chromium) take the host's builtins,
   starting with Intl and RegExp; on native and standalone Wasm use nts's own.
   Each feature is chosen by its benchmark row and conformance record.
4. `WeakRef` and `FinalizationRegistry` are represented, not designed around.
5. RegExp: matchers generated at compile time for literal patterns, plus the
   TypeScript interpreter for dynamic ones and as the oracle. No second native
   engine.
6. Apps may override a provider in `nts.config.ts`, but only with one that has
   a conformance record.
7. `typeof X === "undefined"` folds where a target lacks `X`.
8. `node:*` APIs are native-only for now, and never in a Chromium renderer.
9. Only `@nts/*` packages provide `es:*` and `web:*` features; others may
   provide `host:*` capabilities and their own modules.
10. The canonical `URLSearchParams`, `Blob` and `File` are web-platform's;
    `runtime/node` re-exports them.
11. One full lib (ESNext plus DOM) for every target, with NTS1100 as the
    per-target error, not per-target libs.
