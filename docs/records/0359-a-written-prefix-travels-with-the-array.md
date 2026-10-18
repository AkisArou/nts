# 0359 — A written prefix travels with the array

**Decided 2026-10-18, by the Wasm lane.**

An incomplete typed array may escape into a field, call, return or CFG edge.
Its identity wrapper carries a mutable i32 initialized-prefix word. A read
keeps the existing index guards, then requires its index below the prefix.
A write exactly at the prefix advances it; whole-array consumers and erasure
require density. Core's local must-proof remains the sole static proof.

The word is separate from flags, represents every prefix through 2^31−1,
and uses unsigned −1 for a statically dense allocation. It adds four logical
payload bytes to ordinary typed-array wrappers in a module needing this
contract. Engine padding and physical allocation-size change are unmeasured.
The switch `NTS_WASM_ARRAY_PREFIX=0` retains the old floor and layout.

On clean `92c28eecd8e4`, P-core4, nice19 and the measurement lock, two rounds
alternated the checked Vector read kernel with a diagnostic copy containing
the same header, stores, prefix updates and index guards but no prefix read
checks. Each cell used five fresh processes; diagnostic and node bracketed
both rounds. E-core work was allowed under MainClaude's affinity rule and
recorded; the monitor observed no foreign compiler thread with P-core affinity.
The canonical full bench uses `NTS_BENCH_ALONE=0` for this known sharing,
with the private affinity monitor enforcing that rule. Full-arm boundary
one-minute loads ranged from 3.43 to 8.23.

| round | checked µs | diagnostic µs | checked / diagnostic | diagnostic head / tail µs | node head / tail µs |
|---|---:|---:|---:|---:|---:|
| 1 | 172.841 | 174.925 | 0.988 | 177.524 / 174.739 | 24.762 / 24.857 |
| 2 | 172.518 | 173.172 | 0.996 | 173.840 / 174.743 | 24.845 / 24.521 |

The read check has no measurable cost in this kernel; the apparent gain is
inside bracket drift. This does not price the header's allocation cost or the
prefix updates, which both arms retain. Three complete read-guard sequences
add 51 module bytes (3,982 versus 3,931); the larger correctness fixture adds
453 bytes for 26 sequences (32,836 versus 32,383). The diagnostic is never a
product or conformance-record input. Removing those guards after committing
the fix makes the real fixture fail at `countWithoutWrite(0)`.

The newly admitted row still loses to node by 6.94–7.04×. Its emitted hot loop
reads i32 elements, with no erased read, boxing, allocation or host call per
element. Across 32,768 reads per call, the diagnostic still spells four struct
loads, two null checks, a floating-point whole/range check and index/value
conversions per read; `count` and the cursor are f64. Three GC objects allocate
outside the loop. These counts identify the remaining work; they do not
decompose CPU time. The kernel is an acceptance row for improving those facts
and retained guards.

The full default sweep used the same binary with the switch flipped, in order
0/1/1/0. All 66 measured rows emit byte-identical Wasm and glue in all four
arms. Generated harnesses differ only in absolute worktree import roots;
normalizing those roots makes them identical, and the imported measurement
source is byte-identical. Their normalized A/B ratios span 0.882–1.082 in
round one and 0.920–1.052 in round two: noise, with no cost attributed to this
change. The separate code shape that needs the prefix is priced above.

Losing rows remain losses. For example, Wasm/node after the change:

| row | round 1 | round 2 |
|---|---:|---:|
| json-scan | 3.607 | 3.617 |
| strings | 3.047 | 3.033 |
| json-parse (rc) | 2.235 | 2.254 |
| awfy-queens | 1.868 | 1.828 |
| array-from (rc) | 1.266 | 1.269 |

The complete before/after table, including every row's verdict, is
`FULL-AB.md` in the evidence directory below. `elementwise` remains the
one unmeasured row: its source-importing driver has no Wasm module harness.
No gap-stop coverage is claimed for the six new AWFY rows: JSON and CD move
past their constructor's typed-holes floor, then stop at length growth and an
unrelated storage cast; the other four remain blocked.

The prefix deliberately retains 87 conservative named stops where node answers:
58 calls across two written-gap shapes, and 29 at a density boundary. A later
gap fill does not recover an earlier out-of-order write. All are NTS5001 stops,
never typed zero answers. The successor is shared written-prefix/per-slot
tracking in core; these fixtures are its acceptance inputs.

Core prerequisites are `67e09b317` (allocation context through choices),
`c6a18fc34` (retain a hole observation after a bounds proof), and `700418944`
(retain observations through unknown-origin parameters, fields and aliases),
replayed here as `b8b30087f`, `f629c34ec` and `6628b9748`.
The two discarded-read regression fixtures remain unchanged from `76211fb15`
and `c4d76f768`. Exact-pin acceptance: 614/614 programs, ten partials unchanged;
all five recorded Wasm test262 slices reconcile with zero deltas. The four
machine-flagged slices were repeated fresh and all 908 outcomes matched row
for row.

Evidence: `~/.cache/nts-scratch/wasm/array-written-prefix-main968-20261018/`:
`TIMING.json`, `TIMING-SUMMARY.json`, `FULL-AB.md`,
`KERNEL-INSTRUCTION-AUDIT.json`, `identity-REPORT.json`,
`AWFY-SUMMARY.json`, `REPEAT-DEGRADED.json` and `wasm-gate.log`.
