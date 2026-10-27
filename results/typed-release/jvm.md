# nts (jvm): latest results

Historical best-of-five-process result, preserved as measured. This predates the median-and-spread policy: Node/Bun can vary about 2× between launches. These external ratios are not the acceptance evidence for typed release; use [paired.md](paired.md) for its native A/B effect.

8 cases; nts is slower than node on **1**, and refuses 0. Time per call; `x` is nts divided by the column named. Written by `nts-bench`; a row is from its own run.

| case | nts | node | nts/node | Java | nts/Java | measured |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| awfy-towers | 30.68 us | 38.46 us | 0.80x | 22.12 us | 1.39x | 2026-10-27 09:21 UTC |
| cyclic-churn | 18.33 us | 25.69 us | 0.71x | 14.51 us | 1.26x | 2026-10-27 09:21 UTC |
| json-build-append | 15.01 us | 18.03 us | 0.83x | -- | -- | 2026-10-27 09:21 UTC (varied 110%) |
| json-parse | 575.26 us | 748.20 us | 0.77x | -- | -- | 2026-10-27 09:21 UTC |
| map-entries-top-k | 19.87 us | 32.02 us | 0.62x | 14.69 us | 1.35x | 2026-10-27 09:21 UTC |
| release-acyclic | 55.94 us | 73.60 us | 0.76x | 34.64 us | 1.62x | 2026-10-27 09:21 UTC |
| sort-objects | 128.09 us | 54.32 us | 2.36x ▲ | 13.40 us | 9.56x | 2026-10-27 09:21 UTC |
| tree-teardown | 34.76 us | 66.33 us | 0.52x | 34.47 us | 1.01x | 2026-10-27 09:21 UTC |

▲ slower than node.
