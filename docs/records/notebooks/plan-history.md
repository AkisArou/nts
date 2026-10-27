# The plan's history

Sections of `docs/plan.md` kept as history when the plan became a page that
shows only what is current (2026-10-27): how the old plan's "FIRST" list was
resolved, where the old plan and the foundations disagreed, and where the
older plans lived.

### What the old plan's "FIRST" list became

| old item (10-22) | where it is now |
|---|---|
| Strings first, stages 0 and A–G | 0, A (zmij) and B (destination passing) are built. C (allocation) is [memory](foundations/memory.md) stages 1–3. D (header hash and flags) and E (SIMD copy-and-check) are pending, for a strings page. F (Wasm strings) moves to phase 4. G (parse regions) is memory stage 3, plus field ranges. |
| Closures passed as values | The two-class devirtualization is built. Field and return-value class sets, call-site splitting and typed adapters are pending (the calls study's stages 2–4). |
| Reference counting in moves and sorts | Memory stage 1. |
| Wasm type tests and array access | Phase 4. |
| Map key paths | Hash tables: the seeded hash (open), and `Map<K, number>` values stored unboxed. |
| Native indirect calls | The calls study's stages 2–4. |
| JSON as a compiler-specialized builtin | After the general causes (decision of 10-23). Typed stringify is built. Typed `JSON.parse(...) as T` and simdjson come on top of memory stage 3. |
| Finish and optimize runtime/ecmascript and runtime/web-platform | After the foundations, through the builtins provider mechanism. |
| Builtins: one mechanism to declare providers per target | The host-boundary foundation, in 12 stages. Its 11 product decisions are made. |
| tsrs replaces tsgo | Phase 1. |
| QuickJS goes entirely | `dtoa.c` is gone. `libregexp` is unused: delete it. `libunicode` goes through [Unicode](foundations/unicode.md) stages 1–3. Then `runtime/c/quickjs/` is deleted with its license and README entries. |


## Where the old plan and the foundations disagreed, and the resolution

| the old plan said | now | why |
|---|---|---|
| tsrs in stages: bump tsgo, digest-equal snapshots, switch with `NTS_FRONTEND=tsgo` kept for a cycle | one switch, no tsgo intermediate steps; tsgo deleted after it | the user, 10-23 |
| no local patches to vendored tsrs | one temporary patch for two checker crashes, removed when upstream fixes them | the user, 10-24 |
| replace `libunicode` with "our own Rust generator or ICU4X data, whichever measures faster" | our own generator (D1), with an A/B on `case-convert-greek` to honour the criterion | [unicode.md](foundations/unicode.md) |
| ICU4C only as an opt-in link, and no C++ standard library | ICU4C for locale services only, with a static C++ library in Intl programs only (D3) | byte-identical Intl answers to node |
| answer the json-parse row with the typed `JSON.parse` builtin (MainClaude, 10-23 morning) | fix the general cause first: per-site regions, and `null` placeholders in our parser (M1); the builtin comes on top | the user, 10-23 evening |
| regions as R4 placement facts over counted code | one analysis before counting (M1) | [memory.md](foundations/memory.md) |
| "declare a JSON-shaped type acyclic?" | proved, never declared (decision 12, M5) | the user, 10-23 |
| the string hash takes a per-process random seed | still the decision; main's hash is unseeded and literal hashes are fixed at compile time, so main must change | open item in the [map](foundations/README.md) |
| Wasm owns its strings in GC arrays (strings design, 10-22) | the JS-hosted profile uses the host's strings (10-25 direction); measured again when Wasm resumes | the later direction |
| five agents: MainClaude, CompilerHelper, CompilerHelper2, JVM, Wasm | MainClaude coordinates; Codex agents compiler, runtime, tsrs and tsrs-helper | the user, 10-23 and 10-27 |
| disk: clear targets before phase 4 of the old plan | disk floors before every build; targets cleaned whole; the gate prunes its own binaries | lessons of 10-23 and 10-26 |

## History

- The previous working plan was `~/.claude/plans/moonlit-crafting-toucan.md`
  (local). It is kept as history; this file replaces it.
- The 10-22 studies (strings, JSON, runtimes, builtins, calls, memory,
  objects, numbers, vendored code) and the 10-27 studies (memory, Unicode) are
  in `~/.cache/nts-scratch/` (local). Their designs are being written into
  [`foundations/`](foundations).
- [`compiler-delivery-plan.md`](compiler-delivery-plan.md) is the earlier
  delivery log (to 10-04).
