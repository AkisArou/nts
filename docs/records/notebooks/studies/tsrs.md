# tsrs as nts's TypeScript frontend: investigation and spike

Saved by MainClaude from the tsrs study's final message (2026-10-22); the study could not write files itself. All scratch, logs, the spike and the tsrs clone are beside this file.

## Verdict

tsrs can replace tsgo, called in-process. Recommended in stages, gated on identical snapshots.

tsrs (`oxc-project/tsrs` at 357d1d3e, release 0.18.0) is a function-by-function Rust port of tsgo. Its crates expose the whole checker (`tsrs_compiler::new_program` → `get_type_checker` → `get_type_at_location`, ...). Every question nts asks tsgo has a direct Rust call; none is missing.

Measured:
- **Same answers.** tests/programs: 699/699 byte-identical against tsgo built at tsrs's TypeScript commit, 698/699 against nts's tsgo 7.0.2 (the one difference is a TS 7.1 change). runtime/node/util: 48,482 identifier types identical. test262 sample of 1,000 files: one real tsrs bug (2 files).
- **About 9x faster** on nts's queries for runtime/node/util: 2,864 ms with 146,550 round trips, against 315 ms in-process. That excludes nts's own snapshot building; the estimated end-to-end gain is 4-5x.
- **Less memory:** 107-110 MB in-process, against tsgo 188 MB + nts 65 MB.

Costs: Rust 1.99 (nts pins 1.97); TypeScript 7.1-dev (tsrs's pin) instead of 7.0.2; about 368k lines of vendored Rust (+2 min clean release build, 4 jobs); losing tsgo's process isolation; a 3-week-old project with no stable API.

## 1. What nts asks of tsgo

Counted with a proxy on `nts frontend runtime/node/util --decompose --calls --constants` (96 files, 188,747 nodes, 146,550 exchanges at about 13-20 µs each).

| Query | Calls on util |
|---|---:|
| `getTypeAtLocations` | 1,760: 96 batches, 960 failed and were bisected |
| `isArrayType` / `isTupleType` (each asked twice per object type) | 19,158 / 19,130 |
| `getSignaturesOfType` | 11,250 |
| signature parts | about 12k each |
| `getConstantValue` (per property access) | 10,132, of which 0 folded |
| `getResolvedSignature` | 6,994 |
| `getSymbolOfType`, `getTypesOfType`, `getTypeArguments`, `getConstraintOfTypeParameter` | about 2k each |
| properties, index infos, base types | about 2.4k each |
| `getAliasedSymbol` | 902 |
| `getSourceFile`, symbols, diagnostics | per file |

**Fix these whatever is decided:**
- tsgo 7.0.2 crashes inside `getTypeAtLocations` on util: 912 nil-pointer crashes (checker.go:31729) and 48 `AsTupleType` crashes. nts's bisection recovers, but those nodes get no type: nts records 162,438 typed nodes where tsrs types all 162,566.
- nts re-asks for fields `TypeResponse` already carries (`target`, conditional/indexed parts, `elementFlags`, `fixedLength`, `typeParameters`), and asks `isArrayType`/`isTupleType` twice. That's about 40k of the 146k round trips.
- `getConstantValue` costs one round trip per property access.

## 2. What tsrs is

- **TypeScript version:** pinned to microsoft/TypeScript b85298b6a81f (7.1.0-dev.20260929); it tracks main.
- **Conformance** (its docs, not reproduced): 13,458/13,462 error baselines; all 12,779 types/symbols baselines; 13,392 JS emit baselines; a 1,000-repository CI comparison.
- **Type checking:** complete. `tsrs_checker` alone is 108,725 lines.
- **API:** Go-shaped, 703 public checker functions. Types and symbols are 32-bit arena handles with typed views (`t.data()`, `try_as_*`). Also `is_type_assignable_to`, `get_flow_type_of_reference`, `get_contextual_type`.
- **License:** Apache-2.0.
- **People:** mostly Max Schwenk (Owner.com), plus Boshen (Oxc/VoidZero); co-maintained by Cloudflare and VoidZero. **Outside PRs are closed**; issues are open.
- **Age:** first public commit 2026-09-30, 18 releases in 3 weeks.
- **Packaging:** `publish = false`, so it would be vendored.
- **Memory model:** one fixed 32 GiB address reservation per process, aborting when full. Freeing programs needs regions, and `free_program` is `unsafe`. About 330 `unsafe` sites in the crates nts would link.

## 3. Mapping

Every nts query maps to a tsrs call:
- `tsrs_api_codec::encode_source_file` produces the same binary AST (protocol v9; nts decodes v5) plus a node index table.
- **Neither carried tsgo patch is needed:** ObjectFlags come from `t.object_flags()`; unfiltered plain-JS diagnostics come from `bind_diagnostics` + `get_diagnostics_exported`.

## 4. What tsrs gives that tsgo's API does not

1. **The type arguments the checker inferred at every generic call** (`sig.target()`, `sig.mapper`). nts re-derives these today in `core/src/hir/generics.rs` `unify` (1,493 lines).
2. **No patched tsgo fork.**
3. **A typed `TypeData` enum** instead of guessing from flags, and of avoiding the questions that crash tsgo.
4. **Tuple element flags, labels and fixed length; mapped-type parts; alias type arguments.**
5. **Checker services:** flow types, promised and awaited types, contextual types, `is_type_identical_to`, enum values, AST links.
6. **About 0.65-1.4 µs per question in-process,** against 10-20 µs per exchange.
7. **No Go toolchain** and no 39 MB `target/tsgo`.

## 5. The spike

- `spike/src/main.rs` links tsrs and asks what nts's frontend asks; `--dump` writes the untruncated type at every identifier, plus the diagnostics and the inferred type arguments.
- `work/api-probe.ts` asks a tsgo binary the same questions, so the two dumps diff byte for byte.
- `tsgo-b85298b6` is tsgo built at tsrs's commit, used to separate TypeScript-version differences from tsrs differences.

| Corpus | vs tsgo 7.0.2 | vs tsgo at tsrs's commit |
|---|---|---|
| tests/programs (699 fixtures, 68,715 types + diagnostics) | 698 identical | 699 identical |
| util (48,482 types) | identical untruncated | identical |
| test262 sample, 1,000 files, `checkJs` | | 996 identical; 2 are the tsrs bug; 2 are probe artifacts |
| test262 sample, plain JS | 906 identical; 94 differ (47 order only, 29 probe artifacts, 1 hashbang, 2 the tsrs bug, 15 from the raw checker path, which match through the program path) | |

**The real tsrs bug** (reproduced in `work/dstr`):

```ts
export function method({ w: { x, y, z } = { x: 4, y: 5, z: 6 } } = { w: { x: undefined, z: 7 } }) { return [x, y, z]; }
```

Here `y` is `number | undefined` in tsgo and `any` in tsrs.

**Performance** (E-cores, niced; ratios within one sitting):
- util: 2,864 ms against 315 ms (9.1x); a small fixture: 61 ms against 19 ms (3.2x).
- As a server, printing types: 919 ms against 558 ms (1.65x).
- TS 7.1 alone is only about 4% faster than 7.0.2, so the gain comes from tsrs and from having no round trips.

**Build:** 367,794 lines across 22 crates; a clean release build takes 2 min, 1.0 GB peak.

## 6. What is missing (on nts's side)

1. **A TypeScript bump** to tsrs's commit b85298b6 (client to the 7.1 API, encoder v9, the patches, re-recorded corpora), so that tsrs differences aren't TS-version differences.
2. **A query trait** of about 30 methods, shared by both frontends.
3. **A frontend factory:** 174 test files construct `TsgoApi` directly.
4. **An adapter crate allowed `unsafe`:** it owns freeing programs, a 512 MB-stack checking thread, `catch_unwind`, and region lifetime for many programs per process.
5. **Rust 1.99.**
6. **One pinned determinism mode,** recorded in `cache_identity`, with diagnostics sorted canonically.

## 7. Effort

- Stage 0, the TypeScript bump: 1.5-2.5 weeks.
- Stage 1, the trait and factory: 1-1.5 weeks.
- Stage 2, the `TsrsSource` adapter with tsrs vendored as `third_party/tsrs`: 2-3 weeks.
- Stage 3, digest comparison over all corpora and test262 × 4 backends: 1-2 weeks plus triage.
- Stage 4, the switch: 0.5 week.

**About 6-9 weeks.** Stage 0 is useful on its own.

## 8. Risks

- nts moves on tsrs's TypeScript pins.
- More divergences will surface at nts's edges.
- No API stability; PRs closed; a small bus factor.
- Losing process isolation: an arena abort or stack overflow takes nts down. The fallback is the adapter in a helper process.
- The 32 GiB reservation and region-based freeing.
- +2 min and +1 GB on a clean build.
- About 330 `unsafe` sites in-process.

## 9. Recommendation

Go, in stages:
1. Bump tsgo to tsrs's TypeScript commit.
2. Extract the query trait.
3. Add `TsrsSource` as a second `SemanticSource` behind a feature.
4. Compare `SemanticSnapshot::digest` for every corpus, plus the test262 records on all four backends.
5. Switch, keeping tsgo for one cycle.
6. Use the gains one at a time, starting with the checker's inferred type arguments in place of `hir::generics::unify`.

**Cheap today, whatever is decided:** stop re-asking for fields `TypeResponse` carries, the doubled array/tuple queries, and the per-access `getConstantValue`.

## 10. Not verified

- a real `SemanticSnapshot` built from tsrs (so 4-5x is an estimate);
- transforms and generators (the React compiler, objc/gir/winmd overlays);
- the root causes of tsgo 7.0.2's crashes;
- freeing programs in a long-lived process;
- tsrs's own conformance claims.

Timings come from a shared, loaded machine on E-cores.
