# nts (llvm): latest results

Historical best-of-five-process result, preserved as measured. This predates the median-and-spread policy: Node/Bun can vary about 2× between launches. These external ratios are not the acceptance evidence for typed release; use [paired.md](paired.md) for its native A/B effect.

8 cases; nts is slower than node on **4**, and refuses 0. Time per call; `x` is nts divided by the column named. Written by `nts-bench`; a row is from its own run.

| case | nts | node | nts/node | C++ | nts/C++ | measured |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| awfy-towers | 34.87 us | 38.46 us | 0.91x | 14.33 us | 2.43x | 2026-10-27 09:21 UTC |
| cyclic-churn | 127.38 us | 25.69 us | 4.96x ▲ | 31.45 us | 4.05x | 2026-10-27 09:21 UTC |
| json-build-append | 8.99 us | 18.03 us | 0.50x | -- | -- | 2026-10-27 09:21 UTC |
| json-parse | 1.07 ms | 748.20 us | 1.43x ▲ | -- | -- | 2026-10-27 09:21 UTC |
| map-entries-top-k | 20.52 us | 32.02 us | 0.64x | 21.77 us | 0.94x | 2026-10-27 09:21 UTC |
| release-acyclic | 102.43 us | 73.60 us | 1.39x ▲ | 195.53 us | 0.52x | 2026-10-27 09:21 UTC |
| sort-objects | 129.38 us | 54.32 us | 2.38x ▲ | 31.92 us | 4.05x | 2026-10-27 09:21 UTC |
| tree-teardown | 31.55 us | 66.33 us | 0.48x | 148.06 us | 0.21x | 2026-10-27 09:21 UTC |

▲ slower than node.
