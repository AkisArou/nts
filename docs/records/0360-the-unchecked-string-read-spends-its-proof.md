# 0360 — The unchecked string read spends its proof

**Decided 2026-10-18, by the Wasm lane.**

`StringUnitAt.checked=false` means HIR proved the index integral and in range.
Wasm keeps the receiver's null contract and the numeric conversion, then reads
the UTF-16 unit through the engine builtin. It no longer repeats a string
length builtin and a range test for every proven read. Checked `charCodeAt`
and the affix helpers retain their contracts; `startsWith` already checks
its bounds once before its unit loop.

The invariant is internal to the compiler. A false proof is a compiler bug on
every backend. In Wasm an out-of-range converted integer traps; the retained
total conversion can turn NaN, a negative or a fractional input into zero and
read unit zero. The old hand-built arbitrary-f64 unchecked subcase violated
that invariant and was moved out of source-input contract coverage. Seven
false integer bounds trap, 133 checked edge comparisons pass, the null floor
remains, and real ASCII, Latin1 and UTF-16 scans agree on 87 cases. The old
compiler and a committed diagnostic copy both fail the structural assertion
that a proven read adds no length builtin. HIR verification of the index proof
remains a core follow-up.

`NTS_WASM_STRING_UNIT_RECHECK=1` restores the redundant checks at emission.
It stays as a documented developer diagnostic for same-binary measurement,
with no runtime or product setting.

Measurement used a clean plain-release pin `2e6b2ae0a`, the same binary with
the diagnostic flipped, and each row's genuine benchmark entry roots. Work
count and warmup were frozen before the B/F/B/F/B arms. `perf stat` enabled
`instructions:u` after warmup and disabled it after the fixed loop, including
the same timer/control bookkeeping in every arm. All checksums match Node.
Adding 100 million untimed startup iterations changed the smoke count by
−0.011%; increasing measured work raised it more than twentyfold.

Timed children used CPU 4, with nice 19 orchestration on CPUs 16–31 under the
measurement lock. The machine was loaded; this is no quiet-core timing claim.
Admission used at least 14 GiB, ten-second mean swap-out at most 25 pages/s,
and no one-second sample above 200. Earlier completed cells used the stricter
per-sample bound and were retained under the reviewed policy. Every new cell
saves its actual admission window and all cells save CPU-4/5 busy percentages,
load and available memory. Raw wall ratios are secondary observations.

All 67 rows are represented: 66 measured and the existing `elementwise`
source-importing-driver gap. Fifty-two module-plus-glue pairs are byte-identical;
their F/bracketed-B instruction ratios range from 0.998456 to 1.001157
(−0.154% to +0.116%), so their movement is counting or engine variation.
Thirteen changed rows have disjoint lower instruction ranges. `node-utf8`
has lower bracket ratios but overlapping ranges and stays inconclusive.

| changed row | F/B instructions, rounds 1 / 2 | loaded Wasm/node, B/F/B/F/B |
|---|---:|---|
| json-build-append (rc) | 0.974329 / 0.974295 | 1.146 / 1.077 / 1.148 / 1.105 / 1.162 |
| json-build-join (rc) | 0.976503 / 0.976455 | 0.847 / 0.865 / 0.895 / 0.839 / 0.883 |
| json-parse (rc) | 0.990341 / 0.990086 | 1.801 / 2.149 / 1.958 / 1.881 / 1.877 |
| json-scan | 0.957769 / 0.957687 | 3.584 / 3.199 / 2.599 / 3.309 / 4.629 |
| json-serialize (rc) | 0.980246 / 0.980032 | 1.042 / 1.075 / 0.908 / 1.098 / 1.100 |
| json-stringify-doc (rc) | 0.982675 / 0.990603 | 1.501 / 1.316 / 1.459 / 1.406 / 1.487 |
| json-stringify-fused (rc) | 0.975558 / 0.975564 | 1.022 / 1.111 / 1.074 / 0.961 / 1.034 |
| json-stringify-inline (rc) | 0.972635 / 0.974136 | 1.094 / 1.008 / 1.036 / 1.021 / 1.085 |
| json-stringify-typed (rc) | 0.978236 / 0.978237 | 1.116 / 1.084 / 1.119 / 1.115 / 1.118 |
| node-utf8 (rc) | 0.995934 / 0.983022 | 1.767 / 1.651 / 1.147 / 1.931 / 2.000 |
| number-format (rc) | 0.960342 / 0.960450 | 1.527 / 1.238 / 1.370 / 1.265 / 1.666 |
| number-format-double (rc) | 0.969895 / 0.976981 | 1.139 / 0.970 / 0.665 / 1.257 / 0.722 |
| strings | 0.945237 / 0.945145 | 1.949 / 1.836 / 1.901 / 1.539 / 2.161 |
| substrings (rc) | 0.853746 / 0.853831 | 1.060 / 0.796 / 1.054 / 0.848 / 0.860 |

`strings` uses about 5.5% fewer user instructions and `json-scan` about 4.2%.
The emitted `scan#whole` loses one length call and range branch; the scanner
`work#whole` loses two length calls and two whole/range check sequences.
The outer f64 scan cursor remains a core representation follow-up.
`json-stringify-inline` grows 52 module bytes (13,390→13,442) while using
fewer instructions in both rounds; that size loser is retained.
Loaded wall results still lose to Node on several rows and sometimes worsen
despite fewer instructions. Every control and losing wall ratio is retained
in `counted/ALL-ROWS.md`; none is presented as a quiet-core regression/gain.

One-minute load ranged 7.28–84.00. CPU 4 busy including the measured process
ranged 46.15–100%; CPU 5 ranged 0–100%. Memory during a process reached 13.847 GiB;
admission was checked before starting, and running work was never paused.
The 390 cells retaining detailed admission data started at 14.067 GiB or more.
Ten scheduled one-second samples spanned 10.006–16.435 seconds under load.
Their recorded weighted means stay ≤25 pages/s and sample rates ≤199 pages/s.
The conservative exact trailing-ten-second upper bounds for two B3 pairs
are 25.3 and 25.6 pages/s beside the 25 bound. MainClaude accepted these flagged
small deviations (1cb01fe3); original cells remain primary. The four-cell
repeat had already completed and is reported separately, with identical N,
warmup, artifact and checksum, in `AUXILIARY-REPEATS.md`. Both sets are preserved.

On that pin, the program gate stays 614/614 with the same twelve bare and ten
partial entries. All five recorded Wasm test262 slices reconcile: 5,132 rows,
4,858 passes and 274 existing failures, with no changes. The two machine-flagged
large slices were repeated fresh and all 5,070 outcomes and causes matched;
the repeat language run remained globally paging-flagged. This limitation is
retained. The program artifact census has 590 identical emissions, twelve
changed emissions all containing unchecked unit reads, and 26 matching
non-emissions. The 28 individually rooted runtime/node configs did not emit
on either arm; that is matching absence, not runtime agreement.

Evidence: `~/.cache/nts-scratch/wasm/unchecked-string-units-20261018/`,
including `counted/ALL-ROWS.md`, `counted/CELL-CONDITIONS.tsv`,
`counted/REPORT.json`, `counted/INSTRUCTION-AUDIT.json`,
`counted/ADMISSION-AUDIT.json`, `counted/AUXILIARY-REPEATS.md`,
`IDENTITY-SUMMARY.json`, `REPEAT-RECORDS.json`, `BEFORE-CONTROL.json`
and `wasm-gate.log`.
