# Typed JSON parser sizing

The purpose of this experiment is **to size the generated parser** (plan phase 2, instruments before mechanisms). The planned design in `docs/foundations/json.md` generates a parser for `JSON.parse(text) as T`, with the native scanner supplied by simdjson and TypeScript parsing serving untyped use. This handwritten TypeScript prototype changes no production parser or compiler mechanism.
Recorded run: [2026-10-30-0038f0fb579b-json-parser-sizing-pmu-r2](../../../results/benchmarks/runs/2026-10-30-0038f0fb579b-json-parser-sizing-pmu-r2.json). This is a diagnostic partial run: its cells are normalized per document, it cannot contribute to own-best, and it does not replace the newest complete official run. The record retains all 160 launches, raw PMU CSV and process output, source and artifact bindings, scripts, semantic qualification, annotations and paired native counters. Its standing columns run the same handwritten parser; explicitly named additional columns hold native parse, validation and mode controls. The ordinary verdict policy applies only to those standing identical-source columns. The fair different-program comparisons and their paired ratios are retained separately.

The standing [json-parse-typed case](../../../benchmarks/cases/json-parse-typed/case.ts) uses the eight-document workload. Its official operation is a complete eight-document batch, while **every timing in this notebook is per document**. In the original experiment the eight-document wrapper was named json-parse-typed-cache and the 1,024-document wrapper json-parse-typed; those historical identities remain in the raw records. The promoted parser, document builder and checksum bodies are unchanged.


**Final protocol:** one matched sitting, CPU 4 under `with-lock.sh --wait`, sibling 5 sampled, nice 19, core dumps disabled. All 32 available arm/pool cells rotate launch by launch; each accepted launch parses exactly 1,024 documents. An 8-document pool runs 128 batches; a 1,024-document pool runs one batch. Pool construction, checksum probe and warmup are outside the PMU bracket. Native warmup is one batch; JS engines warm 8,192 documents; JVM uses the canonical `Bench.measure` warmup/settle before counting. Parsed results feed the verified checksum and a published accumulated sink.

Every document is 136,304 UTF-8 bytes and has 2,000 rows. Pools are 1,090,432 bytes (1.04 MiB) and 139,575,296 bytes (133.11 MiB); this CPU has a shared 36 MiB L3. Only the observed comparison is reported: capacity alone does not establish a DRAM bottleneck.

**Summary estimator:** median of five clean fixed-count launches, with max/min launch spread; ratios are geometric means of the five paired launches. These are diagnostic fixed-count observations, separate from the retained preliminary calibrated best-of-five wall runs. Every accepted launch has zero CPU 5 user/nice ticks. Rejected launches are retained. RSS is whole-process peak, including prebuilt inputs, runtime and warmup.

**Counters:** `cpu_core/cycles/u`, `cpu_core/instructions/u`, `cpu_core/ref-cycles/u`, and `task-clock:u`, enabled after warmup and disabled after the fixed loop. Counter running time must be at least 99%. Task-clock includes kernel CPU on this host, despite the modifier; hardware user GHz is therefore cycles/ref-cycles × 3.1872, from CPUID leaf 0x15 (38.4 MHz × 166 / 2). User cycles/task CPU is retained separately and is not called core frequency. Two timer reads and the counter-disable user work are inside the bracket.

Sitting: 2026-10-30T20:51:31.264Z to 2026-10-30T21:00:17.169Z. One-minute load range 2.66–5.05; MemAvailable 21.31–23.92 GiB. Start: `{"time":"2026-10-30T20:51:31.266Z","load":"2.66 5.30 8.55 5/1984 1216911","memoryAvailableBytes":24868966400,"cpu5":"cpu5 68210 32208 394766 23297941 1159931 48061 16608 0 0 0","landingLockHeld":false}`. End: `{"time":"2026-10-30T21:00:17.171Z","load":"4.50 4.50 6.70 4/2017 1274927","memoryAvailableBytes":25388044288,"cpu5":"cpu5 68210 32208 394791 23350512 1159942 48062 16609 0 0 0","landingLockHeld":false}`.

Source is frozen at `0038f0fb579b` on `helper/json-parse-typed-resume`. Engine is the retained plain release build `0afcc5667e1e`, SHA256 `a17a828facc033c19e3b1b68422c044dfb0d09f801cf7d43f44fcc98610222d4` for nts-bench; engine/runtime/harness source bytes are equivalent. C/LLVM counted relinks use the same ThinLTO objects; normalized `work`, `typedBatch`, `key`, `separator`, `readString` and `readNumber` machine bodies match the original timed executables (hot-helper-binding.json). JVM uses the same generated classes. Pinned node 24.20.0; Bun JIT/AOT share commit `3a9ea0043`; ScriptC is `8971d694b`, native-only, no Node islands. Complete hashes and commands remain in the raw records.

| Arm | 8 docs: µs/doc | Peak RSS MiB | 1,024 docs: µs/doc | Peak RSS MiB |
|---|---:|---:|---:|---:|
| native / Bun AOT | 255.98 (4.4% spread) | 55.17 | 249.72 (5.9% spread) | 292.65 |
| native / Bun JIT | 213.26 (6.6% spread) | 77.13 | 206.82 (1.7% spread) | 307.22 |
| native / node | 418.34 (1.1% spread) | 109.95 | 419.97 (2.4% spread) | 247.05 |
| native / ScriptC | 162.59 (2.8% spread) | 4.43 | 163.46 (7.1% spread) | 136.62 |
| typed / Bun AOT | 349.78 (2.2% spread) | 55.14 | 348.01 (4.1% spread) | 311.94 |
| typed / Bun JIT | 511.48 (3.7% spread) | 83.53 | 492.90 (4.4% spread) | 351.16 |
| typed / C-NoGc | 505.85 (4.3% spread) | 582.27 | OMITTED | — |
| typed / C-RC | 455.75 (4.1% spread) | 6.57 | 457.04 (3.0% spread) | 142.79 |
| typed / JVM | 349.48 (3.3% spread) | 366.66 | 353.01 (3.6% spread) | 500.55 |
| typed / LLVM-NoGc | 547.56 (4.3% spread) | 582.30 | OMITTED | — |
| typed / LLVM-RC | 494.42 (4.2% spread) | 6.55 | 492.43 (4.5% spread) | 142.79 |
| typed / node | 569.71 (2.4% spread) | 215.77 | 724.73 (4.2% spread) | 355.27 |
| typed / ScriptC | 534.76 (3.4% spread) | 4.12 | 533.35 (3.4% spread) | 137.30 |
| validated / Bun AOT | 366.40 (5.0% spread) | 54.68 | 364.51 (6.0% spread) | 291.96 |
| validated / Bun JIT | 230.33 (2.5% spread) | 79.52 | 224.41 (3.1% spread) | 311.23 |
| validated / node | 481.83 (4.0% spread) | 110.31 | 484.33 (5.1% spread) | 247.50 |
| validated / ScriptC | 617.20 (4.0% spread) | 6.68 | 612.28 (2.8% spread) | 139.20 |

Large NoGc is omitted because the mode never reclaims. The retained 2 GiB address-space-bounded run exhausted memory after three completed cases (`out of memory growing an array`), peak RSS 2,060,424 KiB. Small NoGc uses an explicit 2 GiB cap and is a mode control, not the shipping result. Native shipping arms use RC; JVM uses G1 with a fixed 512 MiB heap.

| Arm | 8 docs: Mcycles/doc; Minstr/doc; hardware GHz | 1,024 docs: Mcycles/doc; Minstr/doc; hardware GHz |
|---|---:|---:|
| native / Bun AOT | 1.394; 5.088; 5.571 [5.459–5.672] | 1.397; 5.009; 5.668 [5.407–5.675] |
| native / Bun JIT | 1.191; 5.065; 5.573 [5.389–5.688] | 1.163; 4.974; 5.678 [5.524–5.688] |
| native / node | 2.356; 9.114; 5.660 [5.625–5.688] | 2.362; 9.113; 5.660 [5.635–5.688] |
| native / ScriptC | 0.911; 4.744; 5.686 [5.541–5.688] | 0.921; 4.744; 5.686 [5.508–5.688] |
| typed / Bun AOT | 1.967; 9.148; 5.663 [5.559–5.688] | 1.948; 9.100; 5.674 [5.481–5.688] |
| typed / Bun JIT | 2.870; 12.435; 5.653 [5.629–5.686] | 2.773; 12.228; 5.680 [5.538–5.688] |
| typed / C-NoGc | 2.299; 9.352; 5.632 [5.469–5.687] | — |
| typed / C-RC | 2.575; 10.982; 5.663 [5.478–5.684] | 2.579; 10.982; 5.667 [5.488–5.688] |
| typed / JVM | 1.963; 8.686; 5.621 [5.483–5.684] | 1.971; 8.710; 5.612 [5.503–5.687] |
| typed / LLVM-NoGc | 2.521; 9.587; 5.622 [5.484–5.686] | — |
| typed / LLVM-RC | 2.780; 11.281; 5.635 [5.450–5.684] | 2.780; 11.281; 5.634 [5.447–5.686] |
| typed / node | 3.209; 13.653; 5.648 [5.588–5.688] | 4.008; 16.224; 5.622 [5.467–5.660] |
| typed / ScriptC | 2.988; 11.397; 5.610 [5.447–5.641] | 2.989; 11.397; 5.630 [5.487–5.675] |
| validated / Bun AOT | 2.020; 6.754; 5.647 [5.467–5.671] | 2.011; 6.670; 5.607 [5.532–5.672] |
| validated / Bun JIT | 1.290; 5.537; 5.679 [5.517–5.688] | 1.252; 5.441; 5.688 [5.485–5.688] |
| validated / node | 2.702; 10.606; 5.635 [5.472–5.672] | 2.712; 10.604; 5.645 [5.441–5.685] |
| validated / ScriptC | 3.477; 14.664; 5.640 [5.453–5.653] | 3.465; 14.680; 5.681 [5.496–5.688] |

## Ratios and verdicts

The fair denominator is native parse plus the same shape validator; bare parse is a lower bound. Ratios below 1 are faster. FASTER/TIE/LOSS here compare experiment arms with the larger of 5% and observed spread; this is distinct from the official must-beat policy for identical-source rows.

| Typed arm / validated host | 8 docs: wall ratio | 1,024 docs: wall ratio |
|---|---:|---:|
| typed / node vs same engine validated | 1.178× LOSS | 1.478× LOSS |
| typed / Bun JIT vs same engine validated | 2.225× LOSS | 2.211× LOSS |
| typed / Bun AOT vs same engine validated | 0.961× TIE within spread | 0.958× TIE within spread |
| typed / ScriptC vs same engine validated | 0.862× FASTER | 0.864× FASTER |
| typed / C-RC vs node validated | 0.947× FASTER | 0.941× FASTER |
| typed / C-RC vs Bun JIT validated | 1.982× LOSS | 2.040× LOSS |
| typed / C-RC vs Bun AOT validated | 1.258× LOSS | 1.257× LOSS |
| typed / C-RC vs ScriptC validated | 0.737× FASTER | 0.744× FASTER |
| typed / LLVM-RC vs node validated | 1.030× TIE within spread | 1.016× TIE within spread |
| typed / LLVM-RC vs Bun JIT validated | 2.155× LOSS | 2.203× LOSS |
| typed / LLVM-RC vs Bun AOT validated | 1.369× LOSS | 1.358× LOSS |
| typed / LLVM-RC vs ScriptC validated | 0.801× FASTER | 0.803× FASTER |
| typed / JVM vs node validated | 0.724× FASTER | 0.723× FASTER |
| typed / JVM vs Bun JIT validated | 1.516× LOSS | 1.569× LOSS |
| typed / JVM vs Bun AOT validated | 0.963× TIE within spread | 0.967× TIE within spread |
| typed / JVM vs ScriptC validated | 0.564× FASTER | 0.572× FASTER |
| typed / C-NoGc vs node validated | 1.045× TIE within spread | — |
| typed / C-NoGc vs Bun JIT validated | 2.187× LOSS | — |
| typed / C-NoGc vs Bun AOT validated | 1.389× LOSS | — |
| typed / C-NoGc vs ScriptC validated | 0.813× FASTER | — |
| typed / LLVM-NoGc vs node validated | 1.132× LOSS | — |
| typed / LLVM-NoGc vs Bun JIT validated | 2.369× LOSS | — |
| typed / LLVM-NoGc vs Bun AOT validated | 1.504× LOSS | — |
| typed / LLVM-NoGc vs ScriptC validated | 0.881× FASTER | — |

| Typed host / bare native lower bound | 8 docs | 1,024 docs |
|---|---:|---:|
| node | 1.365× LOSS | 1.718× LOSS |
| Bun JIT | 2.397× LOSS | 2.401× LOSS |
| Bun AOT | 1.389× LOSS | 1.395× LOSS |
| ScriptC | 3.301× LOSS | 3.225× LOSS |

## nts built-in arms

The built-in bare `JSON.parse` and parse-plus-identical-validator arms are **REFUSED on C, LLVM and JVM, for both pools** (0/4 cases available in every cell): `NTS1100 JSON.parse (es:JSON) is not provided by this compiler`. No source fallback was substituted. Existing gated blocker: `tests/refusals/builtin-study-es-json-parse` with its literal-array one-change control. The typed projection of the host validator is strip-mode AST-identical, bound by `native-validator-binding.json`.

Independent validator finding: `tests/refusals/an-object-has-own-after-a-dynamic-object-guard`, with the one-line `Input=unknown` versus `{id:number}` control `tests/programs/a-struct-has-own-after-an-object-guard`. It reproduces on both benchmark pins/all three backends; the control agrees 29/29 on all six arms with zero refusals and passes all four native RC checks. Canonical blocker owner reproduces. Fixture-only commit `9cd2528c88f6` excludes experimental ancestry; its landing is independent of this experiment.

Semantic source controls: eight valid documents, 17 matching TypeErrors, 13 SyntaxErrors including syntax precedence after an earlier shape error, two unknown-key/depth controls (depth 10,000), all 1,024 documents checked elementwise against native parsing, and checksum/order checks. These detailed semantic controls run on node; C/LLVM RC and JVM additionally agree on all four declared valid workload inputs with zero refusals. Both actual `benches` commands pass.

## Native profile and LLVM/C finding

Flat `cpu_core/cycles/u` profiles use CPU4/with-lock and 1,000 × 8 documents inside the PMU bracket; zero lost samples. HotSpot JIT symbols are retained. C self shares: key 16.93%, separator 16.46%, typedBatch 12.07%, readNumber 7.71%, readString 6.00%, text 5.56%, expectWord 5.20%, destroy 4.12%. JVM: record 32.20%, key 19.23%, readString 15.85%, tags 11.07%, scanNumber 6.56%. Different inlining means these shares are not equivalent per-function costs.

C executes approximately 10.982 million instructions per document, **80.57 instructions/input byte**. Annotated normal key/separator/string loops retain general numeric index handling (float→integer→float), code-unit→double conversion, bounds checks and width dispatch. Per-character operations are inlined; key allocation and a runtime call per character do not dominate. Normal literal keys use the no-allocation fast path. Raw annotations are `profiles-r1/{key,separator,readString}.annotate.txt`.

Five paired C/LLVM rounds in three non-multiplexed event groups retain every observation. Median C→LLVM: IPC 4.258→4.073; instructions 10.982M→11.281M; retired branches 2.767M→3.015M; branch misses 3009→2949; L1D load misses 21511→20623; LLC load misses 5.67→5.50 (low and noisy). Paired cycle geometric means are LLVM/C 1.07324 (branch group), 1.06770 (L1D group, one C outlier retained), 1.07452 (LLC group). Miss counters do not show a broad cache/branch-misprediction cause; higher branch density is a lead, not a proved IPC cause. Runtime owns this measured defect and the #28 proved-integer follow-up. Compiler2 has the profile for information and stays on correctness work.

## Generated-parser targets

- 8-document pool: Bun JIT+validator 230.33 µs/doc. The 0.80× bar requires at most 184.26 µs/doc, about 0.740 GB/s, including validation and building objects.
- 8-document pool: approximate 5% Bun AOT tie ceiling 384.72 µs/doc; row spread can widen the policy tolerance.
- 1024-document pool: Bun JIT+validator 224.41 µs/doc. The 0.80× bar requires at most 179.53 µs/doc, about 0.759 GB/s, including validation and building objects.
- 1024-document pool: approximate 5% Bun AOT tie ceiling 382.74 µs/doc; row spread can widen the policy tolerance.

## Pool-size result

The matched pass shows no broad large-pool slowdown. Typed C, LLVM, JVM, Bun AOT and ScriptC have approximately equal cycles per document across pools. Node running the handwritten parser is different: large/small is approximately 1.27× wall, 1.25× cycles and 1.19× instructions. That is an engine-specific pool-size observation, not proof of a DRAM-bandwidth cause. Native node parse and parse-plus-validator remain approximately unchanged. Bun JIT differences are small relative to launch spread.

| Arm | Large/small median wall | Large/small median cycles | Large/small median instructions |
|---|---:|---:|---:|
| native / Bun AOT | 0.976× | 1.002× | 0.985× |
| native / Bun JIT | 0.970× | 0.976× | 0.982× |
| native / node | 1.004× | 1.002× | 1.000× |
| native / ScriptC | 1.005× | 1.011× | 1.000× |
| typed / Bun AOT | 0.995× | 0.990× | 0.995× |
| typed / Bun JIT | 0.964× | 0.966× | 0.983× |
| typed / C-RC | 1.003× | 1.002× | 1.000× |
| typed / JVM | 1.010× | 1.004× | 1.003× |
| typed / LLVM-RC | 0.996× | 1.000× | 1.000× |
| typed / node | 1.272× | 1.249× | 1.188× |
| typed / ScriptC | 0.997× | 1.000× | 1.000× |
| validated / Bun AOT | 0.995× | 0.996× | 0.987× |
| validated / Bun JIT | 0.974× | 0.970× | 0.983× |
| validated / node | 1.005× | 1.004× | 1.000× |
| validated / ScriptC | 0.992× | 0.997× | 1.001× |

No production mechanism or parser fix follows from this experiment. The retained numeric-index work is runtime #28 proved-integer territory; no fact is inferred merely from a TypeScript declaration or this valid-input corpus. LLVM slower than C is the measured native-backend defect, with runtime retaining the paired counter row.

The immutable run's `provenance.evidence` embeds the original measured records with SHA256s and exact text, including `matched-pmu-r2/results.json`, counted build and hot-body bindings, profile annotations and flat reports, paired native events, and builtin/control qualifications. `provenance.launchStreams` retains every final launch's PMU CSV, stdout, stderr and RSS. Original large executable/perf artifacts and all preliminary calibrated, sequential and interrupted observations remain retained in the source evidence directory named by the binding. The study's machine-readable summary and all scripts are embedded as evidence, rather than relying on the notebook to reconstruct raw measurements.
