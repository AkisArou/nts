# Native Unicode case kernels

The completed pre-resize comparisons are retained in [this partial record](../../../results/benchmarks/runs/2026-11-01-fac96454bf81-native-packed-first-change.json). It is ineligible for own-best and makes no claim about the subsequently changed source. Every reported instruction unit is one logical input UTF-16 unit across the complete benchmark call, including its 128 mappings (64 for unchanged Greek).

The bar is no regression against both the main pin and the measured first specialized candidate, followed by at most 0.8 times Node's wall time on each native backend. All rows, including unchanged input and a late first change, remain visible. C and LLVM are separate cells. D4/JVM remains parked and is outside this change.

## Predictions that failed

The initial specialized candidate (`3fa332648040`, identical native source at `cc52db189`) predicted fewer than 30 instructions/unit on œ and Greek, and fewer than 20 on CJK. It measured 62.9, 61.9 and 18.0 on C. The first two predictions failed. Classification still cost about 27 instructions/unit, with table and loop work repeated in the count and write passes.

The ordinary-interval experiment (`e9d8c97487a5`) predicted writer 10–13, settled count 1–3, whole conversion below 30 for œ/Greek and below 20 for CJK. Its whole-conversion measurements were 61.5, 76.5 and 19.1. Greek became slower than the first candidate. Rare excluded values split ordinary common letters into short numeric intervals even when no actual exception occurred: Greek uppercase had 26 writer dispatches per string, 1.861 ordinary units per run, 65.4% one-unit runs, and zero actual cold units. The original specialized kernel needed one writer dispatch. Table work fell, but setup did not amortize.

The packed comparison (`fac96454bf81`) predicted 25–29 for œ, 24–29 for Greek and 14–18 for CJK. Its results were 41.1, 39.6 and 17.8. The first two predictions failed again. A speculative single pass predicted 18–30, 14–20 and 16–24; it measured 32.3, 25.2 and 15.3. Its œ and Greek budgets failed, despite large gains.

Instruction/cycle sampling was on the original timed bodies. Source-labelled copies supplied line attribution only after all 26 mapping-function instruction/register/control-flow sequences matched modulo relocations. Attribution is a sample estimate, not an exact regional counter. New captures have no lost or throttle records.

| Region, instructions/unit | Packed œ | Single œ | Packed Greek | Single Greek |
|---|---:|---:|---:|---:|
| Dispatch/state | 2.14 | 2.56 | 2.27 | 1.58 |
| Classify | 6.03 | 5.93 | 4.91 | 4.47 |
| Table address/read | 13.17 | 9.63 | 11.94 | 8.37 |
| Write | 3.70 | 0.55 | 3.63 | 0.17 |
| Loop control | 10.59 | 5.99 | 10.30 | 4.04 |
| Context/exception | 2.84 | 3.73 | 3.61 | 2.94 |
| Caller/RC/allocation | 2.67 | 3.89 | 2.88 | 3.64 |

Packed facts reduced classify to 14.7% of œ and 12.4% of Greek. The corresponding single-pass shares are 18.4% and 17.7%. Two passes still pay roughly 23–24 instructions/unit in addressing and loop control before classification, stores, context and allocation: the packed whole-conversion budget omitted that cost.

## First-change comparison

The selected design scans without writing until the first actual change, returns the original without allocation if there is none, then copies the prefix and maps forward. Width/expansion stops count only the unconsumed original suffix. Original input remains the authority for Sigma context.

The seven-row comparison used CPU 4, sibling 5 idle, `with-lock.sh --wait`, RC, three finely interleaved base/3fa/packed/single/first/base-end brackets, and 20,000 timed calls per launch. All 252 value, bit-checksum and full iteration-sum controls agree. Load was 3.22–4.44; MemAvailable 19.66–21.20 GiB. Baseline instruction counts reproduced at the end. Medians below are C / LLVM instructions per unit.

| Row | Base | 3fa | Packed | Single | First change |
|---|---:|---:|---:|---:|---:|
| ASCII | 6.237 / 6.214 | 6.301 / 6.279 | 6.172 / 6.149 | 6.172 / 6.149 | 6.172 / 6.149 |
| œ | 132.530 / 132.510 | 62.902 / 62.883 | 41.139 / 41.119 | 32.306 / 32.287 | 32.999 / 32.980 |
| Greek | 131.572 / 131.550 | 61.941 / 61.920 | 39.551 / 39.529 | 25.207 / 25.186 | 26.489 / 26.467 |
| CJK | 96.747 / 96.710 | 18.042 / 18.006 | 17.813 / 17.776 | 15.320 / 15.283 | 13.963 / 13.926 |
| Unchanged ASCII | 5.107 / 5.031 | 5.150 / 5.074 | 4.999 / 4.923 | 4.999 / 4.923 | 4.999 / 4.923 |
| Unchanged uppercase Greek | 54.437 / 54.408 | 29.715 / 29.686 | 21.055 / 21.026 | 26.507 / 26.478 | 25.190 / 25.161 |
| Late first change | 123.676 / 123.653 | 54.352 / 54.330 | 35.597 / 35.575 | 21.697 / 21.675 | 23.486 / 23.464 |

First-change clears base and 3fa everywhere. It gives back some speculative single-pass speed and some packed unchanged-Greek scan speed; those comparisons are retained. Main selected first-change and retired the packed CJK layout question. The layout unit had completed before the stop request; its captures remain historical, with no interval verdict carried.

## Allocations and hosts before exact resize

These are actual Unicode-buffer requests measured in a separate instrumented C build, per mapping. Source-string construction and allocator rounding are excluded; requested bytes include the runtime header, length field and terminator. Timed binaries contain no observation counters.

| Row | Packed allocations / bytes | Single allocations / bytes | First allocations / bytes |
|---|---:|---:|---:|
| ASCII | 1 / 75.375 | 1 / 75.375 | 1 / 75.375 |
| œ | 1 / 138.750 | 1.5 / 207.125 | 1.5 / 207.125 |
| Greek | 1 / 126.750 | 1 / 126.750 | 1 / 126.750 |
| CJK | 0.5 / 43.375 | 1 / 86.750 | 0.5 / 43.375 |
| Unchanged ASCII | 0 / 0 | 0 / 0 | 0 / 0 |
| Unchanged uppercase Greek | 0 / 0 | 1 / 94.750 | 0 / 0 |
| Late first change | 1 / 156.750 | 1 / 156.750 | 1 / 156.750 |

The speculative CJK arm wastes 64 unchanged buffers and copies 1,816 UTF-16 units per complete benchmark call. Its exact wasted request is 5,552 bytes. The earlier `sizeof(NtsString)` estimate of 5,168 omitted the separate length field and terminator and is superseded. First-change removes that waste. The œ expansions still required a second temporary result in this measured version, so it did not satisfy the final one-buffer construction rule.

The host sitting used the same seven sources on CPU 4 under the measurement lock: three node-A0/C/LLVM/Bun-JIT/Bun-AOT/node-A1 rounds, 20,000 timed calls, and all 126 checksum and iteration-sum controls passed. Native warmup was 1,024 calls; hosts used 20,000 through the standing count/opaque-input harness. Node was 24.20.0; the record binds both engine executable hashes. Load was 4.86–6.32; MemAvailable 17.91–21.15 GiB. Ratios below are medians of within-bracket ratios, using the geometric Node A0/A1 denominator; raw launches and ranges are retained.

| Row | C µs | LLVM µs | Node A0 / A1 µs | Bun JIT µs | Bun AOT µs | C / LLVM ÷ Node |
|---|---:|---:|---:|---:|---:|---:|
| ASCII | 1.180 | 1.188 | 3.214 / 3.356 | 3.632 | 3.619 | 0.356 / 0.358 |
| œ | 6.727 | 6.605 | 21.480 / 21.243 | 22.861 | 22.663 | 0.313 / 0.309 |
| Greek | 4.949 | 5.016 | 18.738 / 18.751 | 23.379 | 23.275 | 0.264 / 0.267 |
| CJK | 1.656 | 1.617 | 6.459 / 6.262 | 7.144 | 7.319 | 0.259 / 0.255 |
| Unchanged ASCII | 0.956 | 0.957 | 2.966 / 2.988 | 4.709 | 4.541 | 0.322 / 0.320 |
| Unchanged uppercase Greek | 1.500 | 1.488 | 5.213 / 5.173 | 6.068 | 5.930 | 0.288 / 0.287 |
| Late first change | 6.380 | 6.480 | 18.796 / 18.754 | 22.739 | 22.716 | 0.340 / 0.346 |

Every row cleared the Node bar; C/LLVM ratios against Bun JIT were 0.203–0.327 and against Bun AOT 0.211–0.328. This is the pre-resize source. Exact owned resizing, its allocation recount and a new final-source host sitting remain separate obligations.

The record retains raw counters/commands/output, all generated C/IR/header inputs, harness and TypeScript sources, variant producers, model bindings and attribution receipts in deduplicated compressed blobs. Each `provenance.blobs[sha]` decodes with base64 then zlib and must hash to its key; source-capsule manifests give relative generated filenames and shipping flags. This permits rebuilding without the scratch trees. Partial records cannot replace the official full result or own-best table.

Subsequent source review found invalid local output `restrict` promises across the base-pointer cold/resize handoff. Commit `584ffb51e` removes both promises and adds widening/narrow twins plus original-input checks. No miscompile was claimed. Final-source parity and measurements run independently of this historical record.

## Final source and exact owned resize

The final source is `584ffb51ee30e7ceb5ae98298ca34ec41bff10cc`, based on `c74451dacd6840c7782c117d31512b086f757cc9`. Its builder-frozen compiler is explicitly not a formal `pin.ts` artifact. The [final retained-window record](../../../results/benchmarks/runs/2026-11-01-584ffb51ee30-native-first-change-final.json) binds the actual generated C/LLVM, timer and host sources, raw PMU windows, checksum controls, allocation observer and focused parity receipts. Its rows cannot replace own-best. The [standard all-column run](../../../results/benchmarks/runs/2026-11-01-4d7365f44c4e-91b7d02490a04116acbd790f2823dab1.json) independently records the official harness on the same compiler source; its JVM is unchanged, with no D4 code.

Both output `restrict` promises are removed. The original input remains disjoint and immutable. Widening `éÿ` and narrow `éý` twins, in both storage widths, check the output and every original input unit after releasing the output. This closes the reviewed alias-contract defect without claiming that the historical version reproduced a miscompile.

At the first width or expansion stop, the writer counts only the unconsumed original suffix and resizes its private unpublished result to the exact final width and length. The RC path preserves its actual heap prefix and byte accounting. NoGC and regions first use their provider frontier when available; fallback copies only the initialized prefix. In-place and forced-moving, width-contraction and backward-widening probes cover both cases.

The allocation recount counts fresh logical Unicode result buffers separately from resize calls. It excludes source construction and allocator rounding. Values are per mapping, not per complete benchmark call.

| Row | Fresh buffers | Resizes | Physical moves | Initial / final requested bytes |
|---|---:|---:|---:|---:|
| ASCII | 1 | 0 | 0 | 75.375 / 75.375 |
| œ | 1 | 0.5 | 0 | 136.750 / 138.750 |
| Greek | 1 | 0 | 0 | 126.750 / 126.750 |
| CJK | 0.5 | 0 | 0 | 43.375 / 43.375 |
| Unchanged ASCII | 0 | 0 | 0 | 0 / 0 |
| Unchanged uppercase Greek | 0 | 0 | 0 | 0 / 0 |
| Late first change | 1 | 0 | 0 | 156.750 / 156.750 |

The œ result now needs one fresh buffer instead of the earlier 1.5. Its expanded exact length fits the already rounded physical block in this workload, so the logical resize has no address move. That observation does not substitute for the separate forced-moving provider control.

The final retained-window sitting has 126 checked launches in three interleaved Node A0/C/LLVM/Bun JIT/Bun AOT/Node A1 brackets on CPU 4 under `with-lock`, sibling 5 idle. It uses 20,000 timed calls, 1,024 native warmup calls and 20,000 host warmup calls. Load was 16.47–18.67; MemAvailable 18.13–19.58 GiB. Instructions count the actual timed main-thread region. The Node denominator is geometric within each bracket; ranges and all raw launches remain in the record.

| Row | C / LLVM instructions per unit | C / LLVM µs | Node A0 / A1 µs | Bun JIT / AOT µs | C / LLVM ÷ Node |
|---|---:|---:|---:|---:|---:|
| ASCII | 6.172 / 6.149 | 1.265 / 1.253 | 3.526 / 3.525 | 4.367 / 4.343 | 0.361 / 0.355 |
| œ | 32.868 / 32.849 | 7.227 / 7.202 | 23.404 / 23.325 | 25.107 / 24.863 | 0.309 / 0.308 |
| Greek | 26.489 / 26.467 | 5.402 / 5.380 | 20.802 / 20.984 | 25.813 / 26.128 | 0.258 / 0.257 |
| CJK | 13.963 / 13.926 | 1.768 / 1.779 | 7.046 / 7.154 | 8.712 / 8.698 | 0.249 / 0.251 |
| Unchanged ASCII | 4.999 / 4.923 | 1.027 / 1.013 | 3.337 / 3.340 | 5.315 / 5.340 | 0.308 / 0.306 |
| Unchanged uppercase Greek | 25.190 / 25.161 | 1.613 / 1.603 | 5.874 / 5.852 | 6.514 / 6.503 | 0.275 / 0.273 |
| Late first change | 23.486 / 23.464 | 6.953 / 6.982 | 21.035 / 21.106 | 25.760 / 25.499 | 0.330 / 0.331 |

All seven rows clear the 0.8 Node bar on both native backends. The original below-30 œ instruction prediction remains falsified; it is not revised to fit the result. Greek is below 30 and CJK below 20. The whole conversion preserves the no-allocation unchanged path.

The standard benchmark sitting uses its own standing timing/JIT caller graph. Its timings and Bun AOT ratios must not be mixed with the retained count-window table. It reports every column, including slower untouched JVM rows and unavailable C++/Java references. Its C/LLVM ratios against Node are 0.364/0.361 (ASCII), 0.312/0.313 (œ), 0.252/0.247 (Greek), 0.255/0.255 (CJK), 0.314/0.307 (unchanged ASCII), 0.300/0.297 (unchanged Greek) and 0.331/0.334 (late change). Every native cell clears the bar there too.

The native Node census runs every code point and the Sigma contexts on C. Across the seven actual projects, all 21 C/LLVM Unicode/runtime/header blob pairs are byte-identical; both backends also execute their seven emitted programs. The version controls report three passes, zero failures and two existing TODOs: upstream frontend identifier data and the untouched JVM's JDK case data. The JVM TODO is not counted as a native correctness pass. The separate boundary probe passes 4,768,768 width, direction and retained-alias cases, and the GCC scalar probe passes under ASan/UBSan.

The full `nts-dev` workspace round completed with 2,748 passes, one failure and eight ignored tests. Its sole failure was the existing ownership audit finding `nts_resize_private_string` without a disposition. Test-only commit `34dd6a86a` records its consumed-private-storage contract in `NOT_HANDED_BACK`, alongside the existing `nts_str_reserve` exception. It does not add borrowed-alias semantics to `RUNTIME_HANDS_BACK` or change the scanner. All 20 bound source files from the measured implementation remain byte-identical. The full-round red and the corrected core-library result are retained separately in the landing evidence.

The corrected full core-library suite passes 477 tests with zero failures and one existing ignored test; cargo fmt also passes. The earlier full-round failure remains a separate receipt.
