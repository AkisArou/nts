# nts (c): latest results

Historical best-of-five-process result, preserved as measured. This predates the median-and-spread policy: Node/Bun can vary about 2× between launches. These external ratios are not the acceptance evidence for typed release; use [paired.md](paired.md) for its native A/B effect.

8 cases; nts is slower than node on **4**, and refuses 0. Time per call; `x` is nts divided by the column named. Written by `nts-bench`; a row is from its own run.

| case | nts | node | nts/node | C++ | nts/C++ | measured |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| awfy-towers | 36.56 us | 38.46 us | 0.95x | 14.33 us | 2.55x | 2026-10-27 09:21 UTC |
| cyclic-churn | 131.78 us | 25.69 us | 5.13x ▲ | 31.45 us | 4.19x | 2026-10-27 09:21 UTC |
| json-build-append | 9.08 us | 18.03 us | 0.50x | -- | -- | 2026-10-27 09:21 UTC |
| json-parse | 1.01 ms | 748.20 us | 1.34x ▲ | -- | -- | 2026-10-27 09:21 UTC |
| map-entries-top-k | 20.98 us | 32.02 us | 0.66x | 21.77 us | 0.96x | 2026-10-27 09:21 UTC |
| release-acyclic | 101.65 us | 73.60 us | 1.38x ▲ | 195.53 us | 0.52x | 2026-10-27 09:21 UTC |
| sort-objects | 158.95 us | 54.32 us | 2.93x ▲ | 31.92 us | 4.98x | 2026-10-27 09:21 UTC |
| tree-teardown | 30.18 us | 66.33 us | 0.46x | 148.06 us | 0.20x | 2026-10-27 09:21 UTC |

▲ slower than node.
