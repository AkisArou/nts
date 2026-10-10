# Structural dispatch recovers bodies and widens dense tables

Measured on 2026-10-10, main `9df56eb9a790` against Part 1 + 1b
`8d0f320279f1`, with the same tsgo frontend
`4ec6b1a5235e473fe20e6cef4972dfc867b6ea1b9fad1351a31d8557d66e7776`.
The compiler binaries were pinned from clean commits.

Class methods can serve an interface without a written `implements`, including
through an adapter that drops arguments, erases a wider input or narrower
result, or makes a free base-chain upcast. The declaration shell preserves the
interface contract. Existing class-return bridges and these adapters share one
cache. The JVM uses the same filled table to plan forwarders, including
inherited entries, and declines conflicting bodies for one JVM member by name.

An interface root also needs a slot when a subclass serves it with an inherited
method whose base does not implement that interface. Numbering that slot makes
correct dispatch possible, but every dense table gains a column. The number of
compiled functions alone misses this cost.

## Coverage and behavior

All 29 runtime projects emit valid C HIR. Prepared HIR contains 51,590 functions
on main and 51,679 on the candidate, a gain of 89, with no module decreasing.
The literal-owner guard costs two definitions in isolation; the inherited-slot
refinement recovers two. The guard keeps a named literal without a table from
licensing a new class-only dispatch root. Existing written edges still expose
that separate defect, recorded by the named-literal outcome for Part 1c.

Across 494 differential examples, each of C, LLVM, JVM and C with reference
counting reports 491 unchanged, three fixed and zero regressed. All 305 blocker
fixtures and 134 outcome fixtures give their expected results. Runtime integrity
has no new violations. A prepared-HIR comparison of all 496 example projects
(two are intentional invalid programs) finds no existing same-target direct
call changing to virtual. The new inherited `TaggedSink#take` call is virtual
on the candidate and refused on main.

Representative new edges name `ReadableByteStreamHost`,
`ReadableStreamBYOBHost`, `TransformReadableAlgorithms`,
`DispatchDiagnosticObserver`, `OriginDispatcher`, `MaxListenerSource` and
`MaxListenerTarget`. Newly emitted adapter families include `MaxListenerTarget`
and `WritableWebStreamLike`.

Normalizing generated type identifiers, the refusal-site diff removes 369 lines
and adds 358. New roots are the optional boolean contract versus the defaulted
boolean implementation at `streams/readable.ts:1849,2097`, and interface calls
that cannot carry throws inside `try` at `dispatch/diagnostics.ts:220,223`.
`stream/src/add-abort-signal.ts:40` is an existing root whose union arm count
changes. These are named unsupported conversions or throw paths, not unchecked
adapters.

Both React GTK and libadwaita drivers report C and LLVM OK. The canonical
GTK counter and state programs emit 843 and 856 JVM classes respectively, with
no invalid HIR or conflicting dispatch bodies. The counter's refusal chain
still stops at `Wakeable#then`; object-literal implementers remain Part 1c.

## Table and object bytes

Each project was emitted with `nts emit-c <tsconfig> --napi`. Table bytes count
all emitted nonempty `nts_vtable_*` rows, including zero padding, at eight bytes
per column on this x86-64 machine. Columns are the emitted width, not the number
of occupied entries. The object is `program.c` alone, compiled with the native
CLI's `-std=c11 -O2 -ffunction-sections -fdata-sections -fPIC` flags. Object bytes
are ELF allocated text + data + bss from `size`, excluding debug information,
symbols and relocation-file overhead. Shared runtime and addon objects are
excluded, so this measures the compiler's generated program consistently.

| Project | Columns main / 1b | Tables main / 1b (bytes) | Object main / 1b (bytes) | Tables / 1b object | Added tables / 1b object |
|---|---:|---:|---:|---:|---:|
| node/assert | 62 / 72 | 68,448 / 81,792 | 490,566 / 504,364 | 16.22% | 2.65% |
| node/async_hooks | 13 / 13 | 13,104 / 13,104 | 104,926 / 104,926 | 12.49% | 0.00% |
| node/buffer | 10 / 10 | 10,000 / 10,000 | 184,065 / 184,065 | 5.43% | 0.00% |
| node/child_process | 88 / 106 | 119,680 / 148,400 | 735,443 / 771,885 | 19.23% | 3.72% |
| node/cluster | 93 / 111 | 132,432 / 163,392 | 789,819 / 831,383 | 19.65% | 3.72% |
| node/console | 62 / 71 | 71,920 / 85,200 | 499,928 / 512,614 | 16.62% | 2.59% |
| node/crypto | 110 / 137 | 162,800 / 209,336 | 837,299 / 878,773 | 23.82% | 5.30% |
| node/dgram | 91 / 109 | 123,032 / 152,600 | 755,448 / 795,900 | 19.17% | 3.72% |
| node/diagnostics_channel | 10 / 10 | 10,000 / 10,000 | 99,062 / 99,062 | 10.09% | 0.00% |
| node/dns | 12 / 14 | 12,768 / 15,120 | 182,948 / 195,236 | 7.74% | 1.20% |
| node/events | 61 / 71 | 67,344 / 81,792 | 476,224 / 491,234 | 16.65% | 2.94% |
| node/fs | 140 / 169 | 206,080 / 258,232 | 930,579 / 986,039 | 26.19% | 5.29% |
| node/http | 126 / 157 | 188,496 / 244,920 | 933,147 / 996,129 | 24.59% | 5.66% |
| node/net | 91 / 109 | 122,304 / 151,728 | 759,285 / 799,593 | 18.98% | 3.68% |
| node/os | 10 / 10 | 10,000 / 10,000 | 190,637 / 190,637 | 5.25% | 0.00% |
| node/path | 10 / 10 | 10,000 / 10,000 | 116,163 / 116,163 | 8.61% | 0.00% |
| node/perf_hooks | 69 / 79 | 85,560 / 101,752 | 539,202 / 565,336 | 18.00% | 2.86% |
| node/process | 123 / 154 | 181,056 / 236,544 | 928,158 / 990,500 | 23.88% | 5.60% |
| node/punycode | 3 / 3 | 48 / 48 | 8,695 / 8,695 | 0.55% | 0.00% |
| node/querystring | 10 / 10 | 10,640 / 10,640 | 260,069 / 260,069 | 4.09% | 0.00% |
| node/readline | 63 / 74 | 72,576 / 88,208 | 595,070 / 619,084 | 14.25% | 2.53% |
| node/stream | 108 / 135 | 137,376 / 178,200 | 706,146 / 744,316 | 23.94% | 5.48% |
| node/string_decoder | 10 / 10 | 10,000 / 10,000 | 190,043 / 190,043 | 5.26% | 0.00% |
| node/timers | 13 / 15 | 13,208 / 15,360 | 132,724 / 143,331 | 10.72% | 1.50% |
| node/tty | 0 / 0 | 0 / 0 | 118 / 118 | 0.00% | 0.00% |
| node/url | 12 / 13 | 13,152 / 14,248 | 351,010 / 352,066 | 4.05% | 0.31% |
| node/util | 62 / 72 | 68,944 / 82,368 | 498,986 / 512,784 | 16.06% | 2.62% |
| node/zlib | 109 / 136 | 143,880 / 186,048 | 727,457 / 766,739 | 24.26% | 5.50% |
| web-platform | 65 / 75 | 17,680 / 23,400 | not measured | not measured | not measured |

Across the 28 Node modules, tables grow from 2,064,848 to 2,569,032 bytes;
allocated object size grows from 13,023,217 to 13,611,084 bytes. Tables account
for 18.87% of the candidate's object bytes, and the added table bytes alone
account for 3.70%. The largest increment is `node/http`: 56,424 bytes, or 5.66%
of its candidate object. The largest total table share is `node/fs`: 26.19%.

Including web-platform, emitted table bytes grow from 2,082,528 to 2,592,432
(+24.49%). Its optimized object is not measured: both main and the candidate
fail C compilation on the same missing `nts_desc_NtsObj_WebSocketUpgradeAccepted`
and `nts_desc_NtsObj_WebSocketUpgradeRefused` declarations. Valid HIR and an
emitted C file do not establish that the resulting C compiles.

Dense global-slot padding is already costly on main. This increment is the
reason to measure selector coloring next, before adding literal implementers;
the follow-up must keep dispatch and runtime behavior unchanged while measuring
both table bytes and allocated object size against this baseline.

## Execution measurements

The pinned main and candidate `nts-bench` binaries ran with
`NTS_BENCH_LANES=c`, under `tooling/gate/with-lock.sh --wait`, with an explicit
worktree `--root`. The machine was kept quiet for two interleaved pairs:
main, candidate, main, candidate. All 62 workloads were measured in every run,
with matching checksums. Each number uses the runner's minimum across five
processes, each using the common adaptive timing harness.

| Pair | C time, candidate / main geometric mean | Change | C++-normalized geometric mean |
|---|---:|---:|---:|
| First | 0.999268 | -0.073% | 1.000063 |
| Second | 1.000016 | +0.002% | 1.000252 |

Every row is within 3% in each pair; the observed extremes are -2.18% and
+2.06%. No row moves outside that band in both pairs. Generated C, optimized
program objects and native executables are byte-identical between main and the
candidate for all 62 workloads in both pairs. These runs establish no execution
regression in the existing suite; they do not price newly accepted adapter
paths that main cannot compile. The separately measured table-size increase
remains a real cost.
