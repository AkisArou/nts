# Two control repeats

Five fresh A/B/A brackets for the two original wall losses, with the exact original binaries, counts and checksums. CPU 4 under with-lock; 30 of 30 rows pass, hot counters run at least 99%. No source or allocator decision changes. Every round is retained below, including the large final parse repeat spread. These observations supplement the original table.

| Row | Backend | Median wall Δ | Maximum A-repeat floor | Instructions Δ | Extra instructions/call | Cycles Δ |
|---|---|---:|---:|---:|---:|---:|
| release-acyclic | llvm | 0.252% | 4.406% | 0.002% | 32.00 | 0.454% |
| json-parse | c | 0.286% | 21.623% | 0.038% | 8010.00 | 0.375% |

| Row | Round | Wall Δ | A-repeat floor | Instructions Δ | Cycles Δ | Load A/B/A |
|---|---:|---:|---:|---:|---:|---|
| release-acyclic | 1 | 0.252% | 0.764% | 0.002% | 0.454% | 50.41→50.41; 50.41→50.41; 50.41→50.41 |
| release-acyclic | 2 | -0.407% | 4.406% | 0.002% | -0.627% | 50.41→50.41; 50.41→50.41; 50.41→50.41 |
| release-acyclic | 3 | 1.175% | 2.951% | 0.002% | 0.856% | 50.41→50.41; 50.41→50.41; 50.41→50.41 |
| release-acyclic | 4 | 1.441% | 2.142% | 0.002% | 1.390% | 48.37→48.37; 48.37→48.37; 48.37→48.37 |
| release-acyclic | 5 | -0.435% | 0.190% | 0.002% | -0.381% | 48.37→48.37; 48.37→48.37; 48.37→48.37 |
| json-parse | 1 | 0.526% | 0.088% | 0.038% | 0.537% | 50.41→50.41; 50.41→50.41; 50.41→50.41 |
| json-parse | 2 | -0.419% | 2.499% | 0.038% | -0.335% | 50.41→50.41; 50.41→50.41; 50.41→50.41 |
| json-parse | 3 | 0.286% | 0.810% | 0.038% | 0.375% | 50.41→50.41; 50.41→48.37; 48.37→48.37 |
| json-parse | 4 | 2.251% | 1.265% | 0.038% | 2.345% | 48.37→48.37; 48.37→48.37; 48.37→48.37 |
| json-parse | 5 | -10.943% | 21.623% | 0.038% | -11.011% | 48.37→48.37; 48.37→48.37; 48.37→48.37 |

The original release-acyclic LLVM +2.14% (1.31% floor) becomes +0.25% on a 4.41% repeat floor. The original json-parse C +1.88% (1.63% floor) becomes +0.29%; this repeat has a 21.62% maximum floor and is inconclusive in wall time. Original losses remain in paired.md; the repeat does not prove zero cost.

The instruction differences are real and tiny: +32 instructions/call for release-acyclic and +8,010 for json-parse. Static assembly identifies an extra mode test and branch before the new traced dispatch when the generic walker serves ordinary array destruction. release-acyclic creates 16 batches/arrays at seed zero, matching two instructions per generic owned walk. This is outside nts_release and nts_value_release, whose inline sizes are unchanged. No trace callback appears among either control profile’s significant symbols. The release profile retains the same destroy/allocate/owned-callback shares; parse remains dominated by parseJsonText.
