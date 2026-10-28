# Native layout ranges

Change evidence only. Under a train or capture load, these ranges are upper bounds; future A/Bs consult the separate quiet-reference sitting.

Written by `tooling/bench/layouts-record.ts`. Each row retains every seeded layout from one sitting, with equal weight per layout. The layout range is (maximum − minimum) / mean over layout means; repeat drift is included separately in the decision floor. An effect smaller than its row’s layout range requires layout sampling. These ranges cover only the rows, backend, pins, linker, and layout count recorded here; unmeasured rows have no calibrated range. No cross-sitting host ratios are inferred.

| Row | Backend | Layouts/arm | A mean/min/max µs | B mean/min/max µs | A/B SD µs | A/B layout range | Per-layout delta min/max (span) | Mean delta | Decision floor | Verdict |
|---|---|---:|---|---|---|---|---|---:|---:|---|
| str-map-keys | llvm | 5 | 5.169/4.689/5.515 | 4.999/4.473/5.242 | 0.380/0.273 | 15.99%/15.38% | -17.56%/11.04% (28.60%) | -3.29% | 15.99% | inside layout floor |
| map-and-set | llvm | 5 | 5.433/5.405/5.464 | 5.412/5.391/5.447 | 0.023/0.019 | 1.09%/1.02% | -0.97%/0.17% (1.14%) | -0.39% | 3.43% | inside layout floor |

Sitting: 2026-10-28T02:49:27.990Z–2026-10-28T02:49:45.997Z; host load 31.65–34.31. Active train records: land f40b43390309 2026-10-28T02:40:00.274Z pid 177997.

Compiler/link provenance is retained in `ranges.json`.
