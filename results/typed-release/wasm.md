# nts (wasm): latest results

Historical best-of-five-process result, preserved as measured. This predates the median-and-spread policy: Node/Bun can vary about 2× between launches. These external ratios are not the acceptance evidence for typed release; use [paired.md](paired.md) for its native A/B effect.

8 cases; nts is slower than node on **5**, and refuses 0. Time per call; `x` is nts divided by the column named. Written by `nts-bench`; a row is from its own run.

| case | nts | node | nts/node | C++ (wasm) | nts/C++ (wasm) | measured |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| awfy-towers | 43.20 us | 38.46 us | 1.12x ▲ | 23.01 us | 1.88x | 2026-10-27 09:21 UTC |
| cyclic-churn | 31.05 us | 25.69 us | 1.21x ▲ | 49.85 us | 0.62x | 2026-10-27 09:21 UTC (varied 115%) |
| json-build-append | 18.91 us | 18.03 us | 1.05x ▲ | -- | -- | 2026-10-27 09:21 UTC (varied 137%) |
| json-parse | 1.51 ms | 748.20 us | 2.02x ▲ | -- | -- | 2026-10-27 09:21 UTC |
| map-entries-top-k | 30.22 us | 32.02 us | 0.94x | 16.53 us | 1.83x | 2026-10-27 09:21 UTC |
| release-acyclic | 57.32 us | 73.60 us | 0.78x | 100.00 us | 0.57x | 2026-10-27 09:21 UTC |
| sort-objects | 187.05 us | 54.32 us | 3.44x ▲ | 40.40 us | 4.63x | 2026-10-27 09:21 UTC |
| tree-teardown | 54.72 us | 66.33 us | 0.82x | 113.80 us | 0.48x | 2026-10-27 09:21 UTC |

▲ slower than node.
