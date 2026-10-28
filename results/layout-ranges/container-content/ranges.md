# Native layout ranges

Change evidence only. Under a train or capture load, these ranges are upper bounds; future A/Bs consult the separate quiet-reference sitting.

Written by `tooling/bench/layouts-record.ts`. Each row retains every seeded layout from one sitting, with equal weight per layout. The layout range is (maximum − minimum) / mean over layout means; repeat drift is included separately in the decision floor. An effect smaller than its row’s layout range requires layout sampling. These ranges cover only the rows, backend, pins, linker, and layout count recorded here; unmeasured rows have no calibrated range. No cross-sitting host ratios are inferred.

| Row | Backend | Layouts/arm | A mean/min/max µs | B mean/min/max µs | A/B SD µs | A/B layout range | Per-layout delta min/max (span) | Mean delta | Decision floor | Verdict |
|---|---|---:|---|---|---|---|---|---:|---:|---|
| map-literal-keys | c | 5 | 54.412/53.437/56.768 | 53.174/52.000/55.207 | 1.215/1.112 | 6.12%/6.03% | -2.94%/-1.23% (1.71%) | -2.28% | 29.16% | inside layout floor |
| map-literal-keys | llvm | 5 | 55.649/54.909/56.133 | 54.534/54.044/54.931 | 0.464/0.361 | 2.20%/1.63% | -3.38%/-0.77% (2.61%) | -2.00% | 17.85% | inside layout floor |
| map-word-counts | c | 5 | 6.046/5.829/6.193 | 5.539/5.222/6.016 | 0.130/0.263 | 6.03%/14.33% | -13.28%/-2.87% (10.40%) | -8.40% | 14.33% | inside layout floor |
| map-word-counts | llvm | 5 | 5.862/5.754/5.992 | 5.191/5.157/5.237 | 0.097/0.028 | 4.06%/1.55% | -13.66%/-8.98% (4.68%) | -11.44% | 18.81% | inside layout floor |
| record-word-counts | c | 5 | 5.807/5.584/6.255 | 5.457/5.368/5.572 | 0.241/0.094 | 11.55%/3.74% | -13.69%/-3.21% (10.48%) | -6.03% | 11.55% | inside layout floor |
| record-word-counts | llvm | 5 | 5.862/5.642/6.055 | 5.406/5.315/5.541 | 0.161/0.083 | 7.05%/4.18% | -12.22%/-2.94% (9.28%) | -7.78% | 54.89% | inside layout floor |
| str-map-keys | c | 5 | 5.530/5.416/5.604 | 4.835/4.602/5.006 | 0.065/0.132 | 3.40%/8.37% | -17.88%/-9.73% (8.15%) | -12.57% | 13.69% | inside layout floor |
| str-map-keys | llvm | 5 | 5.239/4.710/5.657 | 5.070/4.492/5.305 | 0.420/0.303 | 18.06%/16.04% | -19.06%/11.83% (30.89%) | -3.24% | 18.06% | inside layout floor |
| symbol-keyed-map | c | 5 | 29.585/29.006/30.038 | 26.315/25.657/27.013 | 0.398/0.468 | 3.49%/5.15% | -13.40%/-8.27% (5.12%) | -11.05% | 10.14% | improves |
| symbol-keyed-map | llvm | 5 | 29.834/29.463/30.437 | 27.026/26.496/28.122 | 0.341/0.601 | 3.26%/6.02% | -12.38%/-5.65% (6.73%) | -9.41% | 37.00% | inside layout floor |

Sitting: 2026-10-28T03:03:40.134Z–2026-10-28T03:05:41.168Z; host load 32.51–53. Active train records: land 7e3ac8c8f192 2026-10-28T02:55:54.742Z pid 756137.

Compiler/link provenance is retained in `ranges.json`.
