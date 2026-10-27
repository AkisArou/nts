# Count-free comparator sort A/B

Base 1612a840bb06; candidate 3f25d11da5015ff9228c2173f895fc9040e216a2. Native RC, shipping ThinLTO/x86-64-v3/32-byte loop alignment. CPU 4 under with-lock, sibling 5 admitted quiet at entry; host load and gate activity are recorded per cell. Five process brackets A/B/A per native row, one code layout. Floor is the maximum of five absolute A-repeat changes (nearest-rank P90 of five). Node and Bun each have five separate launches; their median, minimum and maximum are reported. Native has two pre-hot calls; host warmup is calibrated separately (at most 20,000 calls/300 ms). Every arm of a row has the same N hot calls; counts and checksums are validated. Counters cover only the acknowledged hot window and must run at least 99% of the time. RSS is the peak of each workload process.

| Row | Backend | Base µs | Indices µs | Wall Δ | Floor | Instructions Δ | Cycles Δ | RSS MiB A/B | /node A→B | /Bun A→B | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| sort-objects | c | 157.793 | 131.150 | -16.12% | 2.15% | -41.64% | -16.08% | 4.2/4.0 | 2.92→2.43 | 4.92→4.09 | improves |
| sort-objects | llvm | 125.919 | 84.017 | -32.25% | 1.29% | -42.37% | -31.99% | 4.2/4.0 | 2.33→1.55 | 3.92→2.62 | improves |
| map-entries-top-k | c | 21.070 | 19.387 | -8.20% | 2.94% | -11.41% | -7.37% | 4.2/4.0 | 0.69→0.64 | 0.88→0.81 | improves |
| map-entries-top-k | llvm | 19.881 | 18.105 | -9.48% | 2.73% | -11.79% | -8.78% | 4.1/4.2 | 0.65→0.59 | 0.83→0.75 | improves |
| array-copying-methods | c | 33.520 | 33.548 | 0.08% | 2.96% | 0.00% | 0.02% | 3.9/3.9 | 0.46→0.46 | 0.60→0.60 | inside floor |
| array-copying-methods | llvm | 33.922 | 33.567 | -0.81% | 1.52% | -0.00% | -0.77% | 3.9/3.8 | 0.47→0.46 | 0.61→0.60 | inside floor |
| release-acyclic | c | 99.532 | 99.386 | -0.49% | 4.27% | -0.00% | -0.61% | 4.0/4.0 | 1.51→1.50 | 2.06→2.06 | inside floor |
| release-acyclic | llvm | 100.398 | 98.822 | -1.54% | 4.33% | -0.00% | -1.88% | 4.2/4.0 | 1.52→1.49 | 2.08→2.05 | inside floor |
| cyclic-churn | c | 119.044 | 120.210 | -1.07% | 3.54% | 0.00% | -0.37% | 4.9/4.8 | 5.63→5.68 | 7.23→7.30 | inside floor |
| cyclic-churn | llvm | 118.942 | 118.703 | -0.20% | 5.03% | -0.00% | -0.72% | 4.7/4.8 | 5.62→5.61 | 7.22→7.21 | inside floor |
| tree-teardown | c | 31.982 | 32.948 | -1.51% | 7.72% | 0.00% | -1.42% | 4.1/4.1 | 0.49→0.50 | 0.53→0.55 | inside floor |
| tree-teardown | llvm | 34.215 | 33.148 | -1.21% | 16.76% | 0.00% | -1.23% | 4.1/4.1 | 0.52→0.51 | 0.57→0.55 | inside floor |
| awfy-towers | c | 36.423 | 36.395 | -0.12% | 1.03% | -0.00% | -0.03% | 3.8/3.7 | 0.96→0.96 | 1.17→1.17 | inside floor |
| awfy-towers | llvm | 34.905 | 34.689 | -0.58% | 2.56% | -0.00% | -0.24% | 3.9/3.9 | 0.92→0.91 | 1.12→1.11 | inside floor |
| string-sort-control | c | 0.149 | 0.144 | -3.62% | 2.17% | -8.28% | -3.97% | 3.9/3.7 | 0.64→0.62 | 1.34→1.29 | improves |
| string-sort-control | llvm | 0.146 | 0.138 | -4.47% | 9.75% | -7.42% | -4.72% | 3.8/3.7 | 0.63→0.59 | 1.31→1.24 | inside floor |

## All brackets and conditions

| Row | Backend | Round | Wall Δ | Instructions Δ | Cycles Δ | A-repeat floor | Load (A/B/A) | Gate(s) |
|---|---|---:|---:|---:|---:|---:|---|---|
| sort-objects | c | 1 | -17.32% | -41.64% | -16.93% | 0.02% | 50.24→50.24; 50.24→50.24; 50.24→50.24 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | c | 2 | -16.19% | -41.64% | -16.49% | 1.11% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | c | 3 | -16.12% | -41.64% | -16.08% | 2.15% | 38.67→38.67; 38.67→38.67; 38.67→38.67 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | c | 4 | -14.96% | -41.64% | -14.72% | 0.00% | 35.49→35.49; 35.49→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | c | 5 | -14.90% | -41.64% | -14.52% | 0.53% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | llvm | 1 | -33.52% | -42.37% | -33.00% | 1.18% | 50.24→50.24; 50.24→50.24; 50.24→50.24 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | llvm | 2 | -33.28% | -42.37% | -32.90% | 0.70% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | llvm | 3 | -32.02% | -42.37% | -31.53% | 0.92% | 38.67→38.67; 38.67→38.67; 38.67→38.67 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | llvm | 4 | -30.92% | -42.37% | -30.98% | 0.52% | 35.49→35.49; 35.49→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| sort-objects | llvm | 5 | -32.25% | -42.37% | -31.99% | 1.29% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | c | 1 | -7.14% | -11.41% | -6.57% | 0.05% | 50.24→50.24; 50.24→50.24; 50.24→50.24 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | c | 2 | -8.20% | -11.41% | -8.01% | 0.72% | 43.27→43.27; 43.27→43.27; 43.27→43.27 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | c | 3 | -6.70% | -11.41% | -6.69% | 2.29% | 38.67→38.67; 38.67→38.67; 38.67→38.67 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | c | 4 | -8.81% | -11.41% | -7.46% | 2.94% | 35.49→35.49; 35.49→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | c | 5 | -8.72% | -11.41% | -7.37% | 2.00% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | llvm | 1 | -9.83% | -11.79% | -9.76% | 1.81% | 50.24→50.24; 50.24→50.24; 50.24→50.24 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | llvm | 2 | -9.48% | -11.79% | -8.78% | 0.69% | 43.27→43.27; 43.27→43.27; 43.27→43.27 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | llvm | 3 | -7.88% | -11.79% | -7.95% | 2.73% | 38.67→38.67; 38.67→38.67; 38.67→38.67 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | llvm | 4 | -9.12% | -11.79% | -8.70% | 0.70% | 35.49→35.49; 35.49→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| map-entries-top-k | llvm | 5 | -10.38% | -11.79% | -9.05% | 0.99% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | c | 1 | 0.08% | -0.00% | 0.28% | 0.24% | 47.58→47.58; 47.58→47.58; 47.58→47.58 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | c | 2 | -0.06% | 0.00% | -0.01% | 0.67% | 43.27→43.27; 43.27→43.27; 43.27→43.27 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | c | 3 | 0.78% | 0.00% | -0.06% | 0.84% | 38.67→38.67; 38.67→38.67; 38.67→38.67 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | c | 4 | 0.46% | -0.00% | 0.86% | 2.96% | 35.49→35.49; 35.49→35.49; 35.49→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | c | 5 | -0.06% | 0.00% | 0.02% | 0.27% | 29.99→29.99; 29.99→29.99; 29.99→29.99 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | llvm | 1 | -0.81% | 0.00% | -0.76% | 1.52% | 47.58→47.58; 47.58→47.58; 47.58→47.58 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | llvm | 2 | -1.06% | -0.00% | -0.94% | 1.01% | 43.27→43.27; 43.27→43.27; 43.27→43.27 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | llvm | 3 | -1.06% | -0.00% | -1.04% | 1.49% | 38.67→38.67; 38.67→38.67; 38.67→38.67 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | llvm | 4 | -0.39% | -0.00% | 1.75% | 0.62% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| array-copying-methods | llvm | 5 | -0.73% | -0.00% | -0.77% | 0.79% | 29.99→29.99; 29.99→29.99; 29.99→29.99 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | c | 1 | -0.49% | -0.00% | -0.66% | 0.38% | 47.58→47.58; 47.58→47.58; 47.58→47.58 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | c | 2 | -1.58% | -0.00% | -1.54% | 4.27% | 43.27→43.27; 43.27→43.27; 43.27→43.27 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | c | 3 | -0.68% | -0.00% | -0.61% | 0.20% | 38.67→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | c | 4 | 3.32% | -0.00% | 3.31% | 0.81% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | c | 5 | 2.17% | 0.00% | -0.05% | 1.27% | 29.99→29.99; 29.99→29.99; 29.99→29.99 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | llvm | 1 | -3.74% | -0.00% | -3.73% | 0.98% | 47.58→47.58; 47.58→47.58; 47.58→47.58 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | llvm | 2 | 1.34% | -0.00% | 0.96% | 1.02% | 43.27→43.27; 43.27→43.27; 43.27→43.27 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | llvm | 3 | -1.57% | 0.00% | -1.88% | 2.88% | 37.01→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | llvm | 4 | 0.56% | -0.00% | 0.72% | 1.65% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| release-acyclic | llvm | 5 | -1.54% | -0.00% | -2.73% | 4.33% | 29.99→29.99; 29.99→29.99; 29.99→29.99 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | c | 1 | -2.80% | -0.00% | -2.41% | 2.96% | 47.58→47.58; 47.58→47.58; 47.58→47.58 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | c | 2 | 1.26% | -0.00% | 1.70% | 2.33% | 43.27→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | c | 3 | -1.07% | 0.00% | -0.37% | 3.54% | 37.01→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | c | 4 | 1.87% | 0.00% | 0.55% | 0.81% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | c | 5 | -1.59% | 0.00% | -1.09% | 1.67% | 29.99→29.99; 29.99→29.99; 29.99→29.99 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | llvm | 1 | -1.42% | 0.00% | -1.75% | 2.25% | 47.58→47.58; 47.58→47.58; 47.58→47.58 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | llvm | 2 | -0.20% | 0.00% | 0.08% | 0.90% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | llvm | 3 | 0.09% | -0.00% | 0.20% | 2.17% | 37.01→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | llvm | 4 | 0.35% | -0.00% | -1.20% | 5.03% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| cyclic-churn | llvm | 5 | -1.36% | -0.00% | -0.72% | 3.57% | 29.99→29.99; 29.99→29.99; 29.99→29.99 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | c | 1 | 6.10% | 0.00% | 6.96% | 5.04% | 47.58→47.58; 47.58→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | c | 2 | -4.36% | -0.00% | -4.52% | 6.55% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | c | 3 | -1.51% | 0.00% | -1.70% | 2.32% | 37.01→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | c | 4 | 3.02% | 0.00% | 2.25% | 7.72% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | c | 5 | -1.75% | -0.00% | -1.42% | 4.65% | 29.99→29.99; 29.99→28.55; 28.55→28.55 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | llvm | 1 | -0.06% | 0.00% | -0.31% | 0.91% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | llvm | 2 | -6.72% | 0.00% | -6.66% | 16.76% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | llvm | 3 | -4.17% | -0.00% | -4.11% | 0.79% | 37.01→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | llvm | 4 | -1.21% | -0.00% | -1.23% | 6.04% | 33.53→33.53; 33.53→33.53; 33.53→33.53 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| tree-teardown | llvm | 5 | -0.40% | 0.00% | -0.49% | 1.61% | 28.55→28.55; 28.55→28.55; 28.55→28.55 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | c | 1 | -0.12% | -0.00% | -0.07% | 0.33% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | c | 2 | -0.09% | -0.00% | -0.22% | 0.46% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | c | 3 | 0.02% | 0.00% | -0.03% | 0.96% | 37.01→37.01; 37.01→37.01; 37.01→37.01 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | c | 4 | -0.81% | -0.00% | 0.17% | 1.03% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | c | 5 | -0.16% | -0.00% | -0.03% | 0.07% | 28.55→28.55; 28.55→28.55; 28.55→28.55 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | llvm | 1 | -0.05% | 0.00% | 0.05% | 0.43% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | llvm | 2 | -0.36% | 0.00% | -0.24% | 0.22% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | llvm | 3 | -0.58% | -0.00% | -0.40% | 0.99% | 37.01→37.01; 37.01→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | llvm | 4 | -2.84% | -0.00% | -0.54% | 2.56% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| awfy-towers | llvm | 5 | -0.62% | -0.00% | -0.05% | 0.53% | 28.55→28.55; 28.55→28.55; 28.55→28.55 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | c | 1 | 1.46% | -8.28% | -3.97% | 0.35% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | c | 2 | -6.12% | -8.28% | -5.76% | 0.55% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | c | 3 | -3.19% | -8.28% | -3.85% | 2.17% | 35.49→35.49; 35.49→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | c | 4 | -5.56% | -8.28% | -5.77% | 0.19% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | c | 5 | -3.62% | -8.28% | -3.55% | 1.78% | 28.55→28.55; 28.55→28.55; 28.55→28.55 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | llvm | 1 | -8.13% | -7.42% | -4.34% | 9.75% | 45.21→45.21; 45.21→45.21; 45.21→45.21 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | llvm | 2 | -6.07% | -7.42% | -5.70% | 0.13% | 41.17→41.17; 41.17→41.17; 41.17→41.17 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | llvm | 3 | -4.38% | -7.42% | -4.72% | 0.85% | 35.49→35.49; 35.49→35.49; 35.49→35.49 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | llvm | 4 | -3.13% | -7.42% | -5.57% | 1.24% | 31.65→31.65; 31.65→31.65; 31.65→31.65 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |
| string-sort-control | llvm | 5 | -4.47% | -7.42% | -4.47% | 0.33% | 28.55→28.55; 28.55→28.55; 28.55→28.55 | land fb8ad42ac014 2026-10-27T11:29:06.114Z pid 4135193 |

## Linked size

Descriptor bytes sum the linked nts_desc_* symbols; absent functions were inlined or eliminated. Every size is from the same binary measured above.

| Row | Backend | Arm | .text B | Descriptors B | Descriptor symbols | nts_release B | nts_value_release B |
|---|---|---|---:|---:|---:|---:|---:|
| sort-objects | c | base | 32480 | 480 | 5 | 81 | absent/inlined |
| sort-objects | llvm | base | 32768 | 480 | 5 | 81 | absent/inlined |
| map-entries-top-k | c | base | 81888 | 576 | 6 | 81 | 120 |
| map-entries-top-k | llvm | base | 81696 | 576 | 6 | 81 | 120 |
| array-copying-methods | c | base | 39200 | 480 | 5 | 81 | absent/inlined |
| array-copying-methods | llvm | base | 39392 | 480 | 5 | 81 | absent/inlined |
| release-acyclic | c | base | 28736 | 576 | 6 | 81 | absent/inlined |
| release-acyclic | llvm | base | 28864 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | c | base | 34976 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | llvm | base | 35104 | 576 | 6 | 81 | absent/inlined |
| tree-teardown | c | base | 18256 | 288 | 3 | 81 | absent/inlined |
| tree-teardown | llvm | base | 18448 | 288 | 3 | 81 | absent/inlined |
| awfy-towers | c | base | 32128 | 672 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | base | 32096 | 672 | 7 | 81 | absent/inlined |
| string-sort-control | c | base | 31136 | 384 | 4 | 81 | absent/inlined |
| string-sort-control | llvm | base | 31424 | 384 | 4 | 81 | absent/inlined |
| sort-objects | c | indices | 33248 | 576 | 6 | 81 | absent/inlined |
| sort-objects | llvm | indices | 33504 | 576 | 6 | 81 | absent/inlined |
| map-entries-top-k | c | indices | 82080 | 672 | 7 | 81 | 120 |
| map-entries-top-k | llvm | indices | 82144 | 672 | 7 | 81 | 120 |
| array-copying-methods | c | indices | 39200 | 480 | 5 | 81 | absent/inlined |
| array-copying-methods | llvm | indices | 39392 | 480 | 5 | 81 | absent/inlined |
| release-acyclic | c | indices | 28736 | 576 | 6 | 81 | absent/inlined |
| release-acyclic | llvm | indices | 28864 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | c | indices | 34976 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | llvm | indices | 35104 | 576 | 6 | 81 | absent/inlined |
| tree-teardown | c | indices | 18256 | 288 | 3 | 81 | absent/inlined |
| tree-teardown | llvm | indices | 18448 | 288 | 3 | 81 | absent/inlined |
| awfy-towers | c | indices | 32128 | 672 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | indices | 32096 | 672 | 7 | 81 | absent/inlined |
| string-sort-control | c | indices | 31328 | 480 | 5 | 81 | absent/inlined |
| string-sort-control | llvm | indices | 31616 | 480 | 5 | 81 | absent/inlined |

Wall, cycle and instruction deltas are medians of the five paired ratios. Displayed absolute times are separate medians, so dividing those two time columns need not reproduce the paired delta. Native work has N hot calls plus two pre-hot check/warmup calls; host work has the same N hot calls plus its separately reported calibrated warmup. The six-element string row is a fixture control. All non-sort controls have unchanged linked text and descriptors. The operation census uses separate instrumented binaries and never supplies a timing cell.

## Host process spread

| Row | Host | Median µs | Minimum µs | Maximum µs | All five launches, µs |
|---|---|---:|---:|---:|---|
| sort-objects | node | 54.079 | 51.995 | 55.046 | 54.079/55.046/53.256/54.213/51.995 |
| sort-objects | bun | 32.089 | 31.946 | 32.241 | 32.032/31.946/32.089/32.241/32.125 |
| map-entries-top-k | node | 30.509 | 29.262 | 31.938 | 31.750/31.938/30.509/29.262/30.205 |
| map-entries-top-k | bun | 23.990 | 22.659 | 24.308 | 24.042/23.889/24.308/23.990/22.659 |
| array-copying-methods | node | 72.340 | 69.372 | 73.069 | 72.585/72.340/73.069/69.615/69.372 |
| array-copying-methods | bun | 55.571 | 51.668 | 57.799 | 55.571/57.799/55.810/52.716/51.668 |
| release-acyclic | node | 66.120 | 40.893 | 66.269 | 66.120/66.269/66.191/42.298/40.893 |
| release-acyclic | bun | 48.269 | 43.387 | 58.315 | 58.315/48.269/48.919/43.387/46.368 |
| cyclic-churn | node | 21.158 | 10.944 | 22.502 | 22.502/21.201/21.158/11.080/10.944 |
| cyclic-churn | bun | 16.471 | 12.266 | 21.211 | 17.857/21.211/16.471/12.694/12.266 |
| tree-teardown | node | 65.493 | 52.280 | 67.249 | 66.162/67.249/65.493/56.242/52.280 |
| tree-teardown | bun | 60.311 | 51.865 | 66.421 | 65.357/66.421/60.311/51.865/57.996 |
| awfy-towers | node | 38.099 | 37.633 | 38.331 | 38.052/38.331/38.307/37.633/38.099 |
| awfy-towers | bun | 31.135 | 30.010 | 31.347 | 30.979/31.347/31.282/30.010/31.135 |
| string-sort-control | node | 0.234 | 0.231 | 0.236 | 0.236/0.234/0.232/0.234/0.231 |
| string-sort-control | bun | 0.111 | 0.106 | 0.114 | 0.112/0.109/0.114/0.106/0.111 |
