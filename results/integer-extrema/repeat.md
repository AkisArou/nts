# Native control repeat

Five A/B/A rounds at the initial run's exact counts, CPU 4 under with-lock, same frozen binaries and hot-window protocol. No new host ratio is derived across sittings. Full branches and branch-misses counts run at least 99% of the enabled window. The floor is the maximum absolute baseline repeat spread across five rounds.

| Row | Backend | Wall delta | Floor | Instructions delta | Branches delta | Branch misses per call A/B |
|---|---|---:|---:|---:|---:|---:|
| integer-extrema-control | c | 5.97% | 13.30% | -1.50% | -1.99% | 0.0014/0.0021 |
| integer-extrema-control | llvm | 10.79% | 1.18% | 4.88% | 3.14% | 0.0012/0.0021 |
| string-sort-control | c | -4.75% | 17.78% | 0.37% | -0.00% | 0.0039/0.0011 |
| string-sort-control | llvm | 1.19% | 1.75% | 3.42% | 1.00% | 0.0042/0.0014 |
| map-entries-top-k | c | -4.40% | 1.86% | -0.28% | -2.34% | 68.7965/66.9756 |
| map-entries-top-k | llvm | 3.92% | 3.54% | 0.23% | -1.35% | 68.8129/70.1583 |

LLVM integer-extrema control +10.8% (floor 1.2%): its integer shape saves and restores six callee-saved GPRs instead of four in an approximately 75 ns function. C +6.0% is inside its 13.3% repeat floor. This is a measured loss, retained beside the primary wins. Map-top-k LLVM +3.9% on a 3.5% floor remains a borderline loss, with instructions +0.23%. Small string-sort LLVM repeats +1.19% within a 1.75% floor, despite instructions +3.42%; the initial result remains in paired.md.
