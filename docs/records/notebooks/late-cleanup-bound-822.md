# The late-cleanup controls under a CPU hog (#822)

The three `a late {broker,ledger,diagnostics} cleanup failure is in the
published summary before the tree lock ends` cases in
`tooling/gate/step-scheduling.test.ts` were run repeatedly beside the #818
CPU hog (26 nice-19 busy loops in their own unit). The runs themselves were
Nice=19, CPUWeight=20, on CPUs 0-3 and 6-31. A real landing check and other
agents' work ran on the machine at the same time, so the one-minute load
moved between 35 and 155.

The card's hypothesis was that the late cleanup failure reaches the summary
before publication. It was refuted. In every red run before the fix, the
'before' arm's summary had `scope_cleanup: complete`, so the late failure never
reached the summary. The red came from the fixture's own step. Its `:` payload
had a stated wall bound of 2 s; it ran 4.7 s, was stopped at its bound, and
was recorded as `INSTRUMENT: step exceeded its bound of 2 s`. Report order is
fixed by `CommandLifetime`, which drains closers one at a time, last
registered first. No elapsed time orders it.

| arm | commit | runs | passed | failed | load (1 min) | failure |
|---|---|---|---|---|---|---|
| before fix (bound 2 s), with a diagnostic message | 55b74436d2 | 25 | 23 | 2 | 35.7-138.3 | ledger and diagnostics 'before' arms: step INSTRUMENT at its 2 s bound; cleanup complete |
| after fix (bound 60 s, step verdict asserted first) | cf02253f81 | 64 | 64 | 0 | 35.1-94.4 | none |
| reorder control (real closer order in the 'before' arm) | cf02253f81 + scratch copy | 1 | 0 | 1 | 55.9 | all three fail at "publishing before cleanup hides its failure" |
| bound control (bound 2 s, payload `sleep 3`) | cf02253f81 + scratch copy | 1 | 0 | 1 | 87.0 | all three fail at the new step-PASS assertion, naming the 2 s bound |

With the bound at 2 s and the `:` payload, the control tripped in 0 of 30
stressed runs. That near-quiet bound trip is why the deterministic
`sleep 3` form was used.

The fix's runs were made at 6e14339713. It was rebased onto main as cf02253f81
with the same test file bytes.

Raw output is kept in `~/.cache/nts-scratch/822/`:

| file | SHA-256 |
|---|---|
| before-fix/run-24.log | 18556aff0633517846e4cc5406743da402e8dee25b23680c67b1fcb5f867334e |
| before-fix/run-25.log | 6b5ecc47f1915749f1cc7ec04a11653a9eb41f5533a2b78c90cf9d75ab909483 |
| before-fix/progress | b273e73ac72d63836abf0d80d5a17591558bca1ed1a9a22f2a89c24c01b8942f |
| after-fix/progress | 831c9672b9233ce6f941fdf58e124d3621122fbab2392212b2fb897c2d4e5edc |
| control-reorder/run-1.log | a55eefaee79bfd576a52a02478a193bad0a3cbd1c68ea6ff6309ea64b97ef698 |
| control-bound/run-1.log | 9db317fad2b7dc6ca75ffbdf4a40fa0b246a8361dc0245fce1c4dec0477f752d |

Every other `memoryRun` fixture in the file states a bound of 60 s or more:
60, 120 or 300 (the last equals the fixture unit's `RuntimeMaxSec`). None of
them decides a verdict at this load.
