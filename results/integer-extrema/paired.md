# Proved integer extrema A/B

Base e80073590754; candidate 35180fa1eaf8b4f4d61aa7a17935dce868375b6b. Native RC, shipping ThinLTO/x86-64-v3/32-byte loop alignment. CPU 4 under with-lock, sibling 5 admitted quiet at entry; host load and gate activity are recorded per cell. Five process brackets A/B/A per native row, one code layout. Floor is the maximum of five absolute A-repeat changes (nearest-rank P90 of five). Node and Bun each have five separate launches; their median, minimum and maximum are reported. Native has two pre-hot calls; each host has one checksum call plus a separately calibrated warmup (at most 20,000 calls/300 ms). Every arm of a row has the same N hot calls; counts and checksums are validated. Counters cover only the acknowledged hot window and must run at least 99% of the time. RSS is the peak of each workload process.

| Row | Backend | Base µs | Integer µs | Wall Δ | Floor | Instructions Δ | Cycles Δ | RSS MiB A/B | /node A→B | /Bun A→B | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| array-copying-methods | c | 31.637 | 22.781 | -26.30% | 3.76% | -13.48% | -26.28% | 3.8/3.8 | 0.49→0.35 | 0.68→0.49 | improves |
| array-copying-methods | llvm | 31.382 | 24.596 | -24.44% | 1.03% | -1.75% | -25.11% | 3.9/3.9 | 0.49→0.38 | 0.67→0.53 | improves |
| map-entries-top-k | c | 17.975 | 17.535 | -3.59% | 2.11% | -0.28% | -4.37% | 4.1/4.2 | 0.65→0.63 | 0.87→0.84 | improves |
| map-entries-top-k | llvm | 16.679 | 17.300 | 3.62% | 3.51% | 0.23% | 4.05% | 4.2/4.1 | 0.60→0.62 | 0.80→0.83 | REGRESSES |
| sort-objects | c | 122.788 | 54.964 | -55.13% | 0.97% | -9.96% | -55.58% | 4.0/4.0 | 2.60→1.17 | 4.28→1.92 | improves |
| sort-objects | llvm | 76.986 | 61.459 | -23.24% | 1.92% | -1.16% | -23.63% | 4.2/4.1 | 1.63→1.30 | 2.68→2.14 | improves |
| array-mutations | c | 0.850 | 0.851 | -0.23% | 1.66% | 0.00% | -0.16% | 3.9/3.7 | 0.46→0.46 | 0.24→0.24 | inside floor |
| array-mutations | llvm | 0.840 | 0.859 | 0.06% | 1.44% | 0.00% | -0.41% | 3.9/3.8 | 0.45→0.46 | 0.24→0.25 | inside floor |
| array-methods | c | 2.609 | 2.664 | 0.51% | 14.04% | 0.00% | 0.44% | 3.9/3.7 | 0.41→0.42 | 0.31→0.32 | inside floor |
| array-methods | llvm | 2.490 | 2.508 | 0.30% | 11.89% | 0.00% | 0.13% | 3.8/3.7 | 0.39→0.39 | 0.30→0.30 | inside floor |
| release-acyclic | c | 93.140 | 91.429 | 0.99% | 16.48% | 0.00% | 1.04% | 4.0/4.0 | 2.55→2.50 | 2.31→2.27 | inside floor |
| release-acyclic | llvm | 91.291 | 94.158 | 1.35% | 5.21% | 0.00% | 1.32% | 4.1/4.2 | 2.50→2.58 | 2.26→2.34 | inside floor |
| cyclic-churn | c | 110.670 | 108.537 | -0.15% | 2.45% | -0.00% | -0.01% | 4.9/4.8 | 10.75→10.54 | 9.45→9.26 | inside floor |
| cyclic-churn | llvm | 108.839 | 110.921 | 0.38% | 5.41% | 0.00% | 0.02% | 4.9/4.9 | 10.57→10.77 | 9.29→9.47 | inside floor |
| tree-teardown | c | 29.413 | 29.572 | 0.64% | 12.68% | 0.00% | -0.22% | 4.1/4.1 | 0.61→0.61 | 0.60→0.60 | inside floor |
| tree-teardown | llvm | 31.177 | 32.667 | 0.62% | 15.52% | 0.00% | -0.01% | 4.1/4.1 | 0.65→0.68 | 0.64→0.67 | inside floor |
| awfy-towers | c | 33.258 | 33.806 | 0.10% | 0.62% | -0.00% | -0.14% | 3.9/3.8 | 0.95→0.96 | 1.19→1.21 | inside floor |
| awfy-towers | llvm | 32.114 | 32.232 | 0.04% | 39.82% | 0.00% | -0.11% | 3.7/3.7 | 0.91→0.92 | 1.15→1.15 | inside floor |
| string-sort-control | c | 0.131 | 0.128 | -3.57% | 2.57% | 0.37% | -3.93% | 3.9/3.8 | 0.63→0.61 | 1.36→1.33 | improves |
| string-sort-control | llvm | 0.128 | 0.130 | 2.77% | 2.30% | 3.42% | 2.62% | 3.9/3.8 | 0.61→0.62 | 1.32→1.35 | REGRESSES |
| integer-extrema-control | c | 0.075 | 0.082 | 7.51% | 1.46% | -1.50% | 8.83% | 3.8/3.8 | 0.70→0.76 | 0.83→0.91 | REGRESSES |
| integer-extrema-control | llvm | 0.073 | 0.081 | 10.12% | 2.35% | 4.88% | 11.09% | 3.8/3.8 | 0.67→0.75 | 0.81→0.90 | REGRESSES |
| copy-within-control | c | 0.440 | 0.435 | 0.02% | 3.23% | -0.00% | -0.05% | 3.9/3.8 | 0.45→0.45 | 0.75→0.74 | inside floor |
| copy-within-control | llvm | 0.442 | 0.433 | -0.62% | 4.15% | -0.00% | -0.26% | 3.8/3.8 | 0.45→0.45 | 0.75→0.74 | inside floor |

## All brackets and conditions

| Row | Backend | Round | Wall Δ | Instructions Δ | Cycles Δ | A-repeat floor | Load (A/B/A) | Gate(s) |
|---|---|---:|---:|---:|---:|---:|---|---|
| array-copying-methods | c | 1 | -26.01% | -13.48% | -26.25% | 1.72% | 5.31→5.31; 5.31→5.31; 5.31→5.31 | none |
| array-copying-methods | c | 2 | -26.30% | -13.48% | -26.28% | 1.43% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| array-copying-methods | c | 3 | -25.65% | -13.48% | -26.25% | 0.67% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| array-copying-methods | c | 4 | -28.41% | -13.48% | -27.14% | 3.76% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| array-copying-methods | c | 5 | -26.89% | -13.48% | -26.41% | 0.50% | 5.42→5.42; 5.42→5.42; 5.42→5.42 | none |
| array-copying-methods | llvm | 1 | -25.10% | -1.75% | -25.09% | 0.61% | 5.31→5.31; 5.31→5.31; 5.31→5.31 | none |
| array-copying-methods | llvm | 2 | -23.07% | -1.75% | -25.11% | 0.74% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| array-copying-methods | llvm | 3 | -24.44% | -1.75% | -25.29% | 0.09% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| array-copying-methods | llvm | 4 | -20.53% | -1.75% | -24.51% | 1.03% | 6.77→6.39; 6.39→6.39; 6.39→6.39 | none |
| array-copying-methods | llvm | 5 | -25.56% | -1.75% | -25.29% | 0.62% | 5.42→5.42; 5.42→5.42; 5.42→5.42 | none |
| map-entries-top-k | c | 1 | -2.45% | -0.28% | -4.40% | 0.70% | 5.36→5.36; 5.36→5.36; 5.36→5.36 | none |
| map-entries-top-k | c | 2 | -3.38% | -0.28% | -3.34% | 0.08% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| map-entries-top-k | c | 3 | -4.53% | -0.28% | -4.37% | 0.43% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| map-entries-top-k | c | 4 | -4.80% | -0.28% | -4.50% | 2.11% | 6.39→6.39; 6.39→6.39; 6.39→6.39 | none |
| map-entries-top-k | c | 5 | -3.59% | -0.28% | -3.81% | 1.56% | 5.42→5.42; 5.42→5.42; 5.42→5.42 | none |
| map-entries-top-k | llvm | 1 | 3.83% | 0.23% | 4.34% | 3.51% | 5.36→5.36; 5.36→5.36; 5.36→5.36 | none |
| map-entries-top-k | llvm | 2 | 4.73% | 0.23% | 4.33% | 1.13% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| map-entries-top-k | llvm | 3 | 3.59% | 0.23% | 3.51% | 1.01% | 6.57→6.57; 6.57→7.73; 7.73→7.73 | none |
| map-entries-top-k | llvm | 4 | 3.61% | 0.23% | 4.05% | 1.57% | 6.39→6.39; 6.39→6.39; 6.39→6.39 | none |
| map-entries-top-k | llvm | 5 | 3.62% | 0.23% | 3.43% | 0.93% | 5.42→5.42; 5.42→5.42; 5.42→5.42 | none |
| sort-objects | c | 1 | -55.48% | -9.96% | -55.92% | 0.31% | 5.36→5.36; 5.36→5.36; 5.36→5.36 | none |
| sort-objects | c | 2 | -55.13% | -9.96% | -55.58% | 0.77% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| sort-objects | c | 3 | -54.44% | -9.96% | -55.43% | 0.00% | 7.73→7.73; 7.73→7.73; 7.73→7.73 | none |
| sort-objects | c | 4 | -55.99% | -9.96% | -56.36% | 0.22% | 6.39→6.39; 6.39→6.39; 6.39→6.39 | none |
| sort-objects | c | 5 | -54.78% | -9.96% | -54.87% | 0.97% | 5.42→5.42; 5.42→5.42; 5.42→5.42 | none |
| sort-objects | llvm | 1 | -20.78% | -1.16% | -21.19% | 0.48% | 5.36→5.36; 5.36→5.36; 5.36→5.36 | none |
| sort-objects | llvm | 2 | -17.97% | -1.16% | -21.19% | 0.26% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| sort-objects | llvm | 3 | -24.52% | -1.16% | -24.28% | 1.92% | 7.73→7.73; 7.73→7.73; 7.73→7.73 | none |
| sort-objects | llvm | 4 | -23.24% | -1.16% | -23.63% | 1.06% | 6.39→6.39; 6.39→6.39; 6.39→6.39 | none |
| sort-objects | llvm | 5 | -24.26% | -1.16% | -24.01% | 1.83% | 5.42→5.22; 5.22→5.22; 5.22→5.22 | none |
| array-mutations | c | 1 | -0.23% | 0.00% | -0.16% | 0.32% | 5.36→5.36; 5.36→5.36; 5.36→5.36 | none |
| array-mutations | c | 2 | 0.20% | -0.00% | 0.67% | 1.66% | 7.22→7.22; 7.22→7.22; 7.22→7.22 | none |
| array-mutations | c | 3 | 3.48% | 0.00% | 1.27% | 1.41% | 7.73→7.73; 7.73→7.73; 7.73→7.73 | none |
| array-mutations | c | 4 | -0.38% | 0.00% | -0.33% | 0.69% | 6.39→6.39; 6.39→6.39; 6.39→6.39 | none |
| array-mutations | c | 5 | -0.39% | 0.00% | -0.44% | 0.65% | 5.22→5.22; 5.22→5.22; 5.22→5.22 | none |
| array-mutations | llvm | 1 | 2.26% | 0.00% | 0.13% | 1.20% | 5.36→5.36; 5.36→5.36; 5.36→5.36 | none |
| array-mutations | llvm | 2 | 0.06% | 0.00% | -0.42% | 1.44% | 7.22→7.22; 7.22→7.22; 7.22→7.22 | none |
| array-mutations | llvm | 3 | 0.06% | -0.00% | -0.87% | 0.72% | 7.73→7.73; 7.73→7.73; 7.73→7.73 | none |
| array-mutations | llvm | 4 | -2.01% | 0.00% | -0.41% | 1.44% | 6.39→6.39; 6.39→6.39; 6.39→6.39 | none |
| array-mutations | llvm | 5 | -0.19% | 0.00% | 0.98% | 0.79% | 5.22→5.22; 5.22→5.22; 5.22→5.22 | none |
| array-methods | c | 1 | 0.51% | 0.00% | 0.44% | 1.15% | 5.36→7.66; 7.66→7.66; 7.66→7.66 | none |
| array-methods | c | 2 | 13.07% | 0.00% | 13.32% | 4.54% | 7.22→7.22; 7.22→7.22; 7.22→7.22 | none |
| array-methods | c | 3 | 1.46% | 0.00% | 2.62% | 14.04% | 7.73→7.73; 7.73→7.73; 7.73→7.73 | none |
| array-methods | c | 4 | -5.59% | -0.00% | -3.71% | 0.54% | 6.04→6.04; 6.04→6.04; 6.04→6.04 | none |
| array-methods | c | 5 | -0.77% | -0.00% | -1.60% | 1.16% | 5.22→5.22; 5.22→5.22; 5.22→5.22 | none |
| array-methods | llvm | 1 | 0.30% | 0.00% | 0.13% | 3.86% | 7.66→7.66; 7.66→7.66; 7.66→7.66 | none |
| array-methods | llvm | 2 | 10.54% | 0.00% | 7.58% | 4.98% | 7.22→7.22; 7.22→7.22; 7.22→7.22 | none |
| array-methods | llvm | 3 | -1.56% | -0.00% | -1.19% | 0.01% | 7.73→7.73; 7.73→7.73; 7.73→7.73 | none |
| array-methods | llvm | 4 | 0.55% | 0.00% | 1.23% | 9.30% | 6.04→6.04; 6.04→6.04; 6.04→6.04 | none |
| array-methods | llvm | 5 | -8.12% | -0.00% | -8.38% | 11.89% | 5.22→5.22; 5.22→5.22; 5.22→5.22 | none |
| release-acyclic | c | 1 | 19.60% | 0.00% | 19.58% | 16.48% | 7.66→7.66; 7.66→7.66; 7.66→7.66 | none |
| release-acyclic | c | 2 | 0.99% | 0.00% | 1.04% | 0.07% | 7.22→7.22; 7.22→7.22; 7.22→7.22 | none |
| release-acyclic | c | 3 | -4.39% | -0.00% | -2.58% | 6.85% | 7.19→7.19; 7.19→7.19; 7.19→7.19 | none |
| release-acyclic | c | 4 | -4.07% | -0.00% | -3.88% | 1.27% | 6.04→6.04; 6.04→6.04; 6.04→6.04 | none |
| release-acyclic | c | 5 | 4.41% | 0.00% | 3.94% | 1.87% | 5.22→5.22; 5.22→5.22; 5.22→5.22 | none |
| release-acyclic | llvm | 1 | 10.00% | 0.00% | 10.12% | 5.21% | 7.66→7.66; 7.66→7.66; 7.66→7.66 | none |
| release-acyclic | llvm | 2 | -0.19% | -0.00% | 0.10% | 0.36% | 7.22→7.22; 7.22→7.22; 7.22→7.22 | none |
| release-acyclic | llvm | 3 | -1.67% | -0.00% | -1.08% | 0.17% | 7.19→7.19; 7.19→7.19; 7.19→7.19 | none |
| release-acyclic | llvm | 4 | 3.14% | 0.00% | 2.36% | 0.02% | 6.04→6.04; 6.04→6.04; 6.04→6.04 | none |
| release-acyclic | llvm | 5 | 1.35% | 0.00% | 1.32% | 0.79% | 5.22→5.22; 5.22→5.22; 5.22→5.22 | none |
| cyclic-churn | c | 1 | 0.02% | 0.00% | 0.00% | 0.46% | 7.66→7.66; 7.66→7.66; 7.66→7.66 | none |
| cyclic-churn | c | 2 | -0.15% | 0.00% | -0.14% | 1.59% | 7.22→7.22; 7.22→6.80; 6.80→6.80 | none |
| cyclic-churn | c | 3 | -1.93% | -0.00% | -0.01% | 2.17% | 7.19→7.19; 7.19→7.19; 7.19→7.19 | none |
| cyclic-churn | c | 4 | -1.55% | -0.00% | -0.65% | 2.45% | 6.04→6.04; 6.04→6.04; 6.04→6.04 | none |
| cyclic-churn | c | 5 | 0.24% | -0.00% | 0.78% | 2.19% | 5.77→5.77; 5.77→5.77; 5.77→5.77 | none |
| cyclic-churn | llvm | 1 | 0.38% | 0.00% | -0.12% | 0.10% | 7.66→7.66; 7.66→7.66; 7.66→7.66 | none |
| cyclic-churn | llvm | 2 | -0.97% | -0.00% | 0.02% | 1.82% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| cyclic-churn | llvm | 3 | 1.91% | -0.00% | 0.55% | 5.41% | 7.19→7.19; 7.19→7.19; 7.19→7.19 | none |
| cyclic-churn | llvm | 4 | -0.37% | 0.00% | -0.24% | 1.36% | 6.04→6.04; 6.04→6.04; 6.04→6.04 | none |
| cyclic-churn | llvm | 5 | 2.17% | 0.00% | 3.38% | 4.20% | 5.77→5.77; 5.77→5.77; 5.77→5.77 | none |
| tree-teardown | c | 1 | 7.27% | 0.00% | 7.27% | 4.96% | 7.66→7.66; 7.66→8.16; 8.16→8.16 | none |
| tree-teardown | c | 2 | 0.03% | -0.00% | -0.22% | 12.68% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| tree-teardown | c | 3 | 0.64% | 0.00% | -1.67% | 3.70% | 7.19→7.19; 7.19→7.19; 7.19→7.19 | none |
| tree-teardown | c | 4 | 2.98% | 0.00% | 3.07% | 8.95% | 6.04→6.04; 6.04→5.72; 5.72→5.72 | none |
| tree-teardown | c | 5 | -5.46% | -0.00% | -5.49% | 9.50% | 5.77→5.77; 5.77→5.77; 5.77→5.77 | none |
| tree-teardown | llvm | 1 | -3.26% | -0.00% | -3.10% | 15.52% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| tree-teardown | llvm | 2 | 0.62% | 0.00% | -2.72% | 1.50% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| tree-teardown | llvm | 3 | 17.37% | 0.00% | 18.11% | 1.91% | 7.19→7.19; 7.19→7.19; 7.19→7.19 | none |
| tree-teardown | llvm | 4 | 10.63% | 0.00% | 10.76% | 0.96% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| tree-teardown | llvm | 5 | -4.11% | -0.00% | -0.01% | 2.73% | 5.77→5.77; 5.77→5.77; 5.77→5.77 | none |
| awfy-towers | c | 1 | 0.10% | -0.00% | -0.04% | 0.30% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| awfy-towers | c | 2 | 0.76% | -0.00% | -0.14% | 0.27% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| awfy-towers | c | 3 | 1.65% | 0.00% | -0.24% | 0.49% | 7.19→6.77; 6.77→6.77; 6.77→6.77 | none |
| awfy-towers | c | 4 | -1.71% | -0.00% | -0.53% | 0.62% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| awfy-towers | c | 5 | 0.07% | -0.00% | -0.11% | 0.11% | 5.77→5.77; 5.77→5.77; 5.77→5.77 | none |
| awfy-towers | llvm | 1 | 1.46% | 0.00% | -0.13% | 2.74% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| awfy-towers | llvm | 2 | 0.04% | -0.00% | -0.08% | 0.20% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| awfy-towers | llvm | 3 | 1.25% | 0.00% | -0.11% | 3.30% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| awfy-towers | llvm | 4 | -15.94% | -0.00% | -15.95% | 39.82% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| awfy-towers | llvm | 5 | -0.77% | 0.00% | 0.05% | 0.02% | 5.77→5.77; 5.77→5.77; 5.77→5.77 | none |
| string-sort-control | c | 1 | -2.26% | 0.37% | -3.77% | 2.03% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| string-sort-control | c | 2 | -4.07% | 0.37% | -3.93% | 0.28% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| string-sort-control | c | 3 | -3.57% | 0.37% | -4.30% | 0.64% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| string-sort-control | c | 4 | -5.43% | 0.37% | -4.64% | 2.57% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| string-sort-control | c | 5 | -3.42% | 0.37% | -3.79% | 1.89% | 5.95→5.95; 5.95→5.95; 5.95→5.95 | none |
| string-sort-control | llvm | 1 | 1.92% | 3.42% | 2.33% | 0.94% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| string-sort-control | llvm | 2 | 1.38% | 3.42% | 3.11% | 2.30% | 6.80→6.80; 6.80→6.80; 6.80→6.80 | none |
| string-sort-control | llvm | 3 | 5.14% | 3.42% | 2.48% | 1.05% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| string-sort-control | llvm | 4 | 2.77% | 3.42% | 2.62% | 1.68% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| string-sort-control | llvm | 5 | 4.38% | 3.42% | 2.67% | 2.17% | 5.95→5.95; 5.95→5.95; 5.95→5.95 | none |
| integer-extrema-control | c | 1 | 9.57% | -1.50% | 9.81% | 0.18% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| integer-extrema-control | c | 2 | 6.28% | -1.50% | 7.10% | 0.45% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| integer-extrema-control | c | 3 | 19.91% | -1.50% | 20.74% | 1.46% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| integer-extrema-control | c | 4 | 7.51% | -1.50% | 8.29% | 0.42% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| integer-extrema-control | c | 5 | 7.09% | -1.50% | 8.83% | 0.33% | 5.95→5.95; 5.95→5.95; 5.95→5.95 | none |
| integer-extrema-control | llvm | 1 | 10.79% | 4.88% | 11.23% | 0.54% | 8.16→8.16; 8.16→8.16; 8.16→8.16 | none |
| integer-extrema-control | llvm | 2 | 10.12% | 4.88% | 11.09% | 2.35% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| integer-extrema-control | llvm | 3 | 15.91% | 4.88% | 15.30% | 1.17% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| integer-extrema-control | llvm | 4 | 10.06% | 4.88% | 10.12% | 1.32% | 5.72→5.72; 5.72→5.72; 5.72→5.72 | none |
| integer-extrema-control | llvm | 5 | 9.51% | 4.88% | 11.07% | 2.07% | 5.95→5.95; 5.95→5.95; 5.95→5.95 | none |
| copy-within-control | c | 1 | 0.05% | -0.00% | -0.05% | 0.05% | 8.16→7.67; 7.67→7.67; 7.67→7.67 | none |
| copy-within-control | c | 2 | 0.02% | -0.00% | 0.12% | 0.35% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| copy-within-control | c | 3 | -1.43% | 0.00% | 0.10% | 3.23% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| copy-within-control | c | 4 | -2.61% | -0.00% | -0.50% | 0.96% | 5.72→5.72; 5.72→5.42; 5.42→5.42 | none |
| copy-within-control | c | 5 | 0.06% | 0.00% | -0.24% | 1.76% | 5.95→5.95; 5.95→5.95; 5.95→5.95 | none |
| copy-within-control | llvm | 1 | -0.62% | 0.00% | -0.22% | 0.51% | 7.67→7.67; 7.67→7.67; 7.67→7.67 | none |
| copy-within-control | llvm | 2 | -2.13% | -0.00% | 0.15% | 4.15% | 6.57→6.57; 6.57→6.57; 6.57→6.57 | none |
| copy-within-control | llvm | 3 | -1.50% | -0.00% | -0.26% | 3.86% | 6.77→6.77; 6.77→6.77; 6.77→6.77 | none |
| copy-within-control | llvm | 4 | -0.25% | -0.00% | -0.50% | 0.34% | 5.42→5.42; 5.42→5.42; 5.42→5.42 | none |
| copy-within-control | llvm | 5 | 0.58% | 0.00% | -0.34% | 1.19% | 5.95→5.95; 5.95→5.95; 5.95→5.95 | none |

## Linked size

Descriptor bytes sum the linked nts_desc_* symbols; absent functions were inlined or eliminated. Every size is from the same binary measured above.

| Row | Backend | Arm | .text B | Descriptors B | Descriptor symbols | nts_release B | nts_value_release B |
|---|---|---|---:|---:|---:|---:|---:|
| array-copying-methods | c | base | 39200 | 480 | 5 | 81 | absent/inlined |
| array-copying-methods | llvm | base | 39392 | 480 | 5 | 81 | absent/inlined |
| map-entries-top-k | c | base | 82080 | 672 | 7 | 81 | 120 |
| map-entries-top-k | llvm | base | 82144 | 672 | 7 | 81 | 120 |
| sort-objects | c | base | 33248 | 576 | 6 | 81 | absent/inlined |
| sort-objects | llvm | base | 33504 | 576 | 6 | 81 | absent/inlined |
| array-mutations | c | base | 31232 | 384 | 4 | 81 | 121 |
| array-mutations | llvm | base | 31232 | 384 | 4 | 81 | 121 |
| array-methods | c | base | 28784 | 384 | 4 | 81 | absent/inlined |
| array-methods | llvm | base | 28912 | 384 | 4 | 81 | absent/inlined |
| release-acyclic | c | base | 28736 | 576 | 6 | 81 | absent/inlined |
| release-acyclic | llvm | base | 28864 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | c | base | 34976 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | llvm | base | 35104 | 576 | 6 | 81 | absent/inlined |
| tree-teardown | c | base | 18256 | 288 | 3 | 81 | absent/inlined |
| tree-teardown | llvm | base | 18448 | 288 | 3 | 81 | absent/inlined |
| awfy-towers | c | base | 32128 | 672 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | base | 32096 | 672 | 7 | 81 | absent/inlined |
| string-sort-control | c | base | 31328 | 480 | 5 | 81 | absent/inlined |
| string-sort-control | llvm | base | 31616 | 480 | 5 | 81 | absent/inlined |
| integer-extrema-control | c | base | 7728 | 0 | 0 | absent/inlined | absent/inlined |
| integer-extrema-control | llvm | base | 7872 | 0 | 0 | absent/inlined | absent/inlined |
| copy-within-control | c | base | 29680 | 480 | 5 | 81 | absent/inlined |
| copy-within-control | llvm | base | 29968 | 480 | 5 | 81 | absent/inlined |
| array-copying-methods | c | integers | 39584 | 480 | 5 | 81 | absent/inlined |
| array-copying-methods | llvm | integers | 39392 | 480 | 5 | 81 | absent/inlined |
| map-entries-top-k | c | integers | 82208 | 672 | 7 | 81 | 120 |
| map-entries-top-k | llvm | integers | 81984 | 672 | 7 | 81 | 120 |
| sort-objects | c | integers | 32992 | 576 | 6 | 81 | absent/inlined |
| sort-objects | llvm | integers | 33504 | 576 | 6 | 81 | absent/inlined |
| array-mutations | c | integers | 31232 | 384 | 4 | 81 | 121 |
| array-mutations | llvm | integers | 31232 | 384 | 4 | 81 | 121 |
| array-methods | c | integers | 28784 | 384 | 4 | 81 | absent/inlined |
| array-methods | llvm | integers | 28912 | 384 | 4 | 81 | absent/inlined |
| release-acyclic | c | integers | 28736 | 576 | 6 | 81 | absent/inlined |
| release-acyclic | llvm | integers | 28864 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | c | integers | 34976 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | llvm | integers | 35104 | 576 | 6 | 81 | absent/inlined |
| tree-teardown | c | integers | 18256 | 288 | 3 | 81 | absent/inlined |
| tree-teardown | llvm | integers | 18448 | 288 | 3 | 81 | absent/inlined |
| awfy-towers | c | integers | 32128 | 672 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | integers | 32096 | 672 | 7 | 81 | absent/inlined |
| string-sort-control | c | integers | 31360 | 480 | 5 | 81 | absent/inlined |
| string-sort-control | llvm | integers | 31648 | 480 | 5 | 81 | absent/inlined |
| integer-extrema-control | c | integers | 7680 | 0 | 0 | absent/inlined | absent/inlined |
| integer-extrema-control | llvm | integers | 7840 | 0 | 0 | absent/inlined | absent/inlined |
| copy-within-control | c | integers | 29680 | 480 | 5 | 81 | absent/inlined |
| copy-within-control | llvm | integers | 29968 | 480 | 5 | 81 | absent/inlined |

Wall, cycle and instruction deltas are medians of the five paired ratios. Displayed absolute times are separate medians, so dividing those two time columns need not reproduce the paired delta. Native work has N hot calls plus two pre-hot check/warmup calls; host work has the same N hot calls plus one checksum call and its separately reported calibrated warmup. The six-element string row is a fixture control. Linked size changes are reported per row.

## Host process spread

| Row | Host | Median µs | Minimum µs | Maximum µs | All five launches, µs |
|---|---|---:|---:|---:|---|
| array-copying-methods | node | 64.472 | 61.457 | 67.696 | 64.472/61.457/66.596/64.400/67.696 |
| array-copying-methods | bun | 46.539 | 46.212 | 55.041 | 46.264/46.539/55.041/46.212/49.975 |
| map-entries-top-k | node | 27.718 | 25.862 | 31.115 | 27.718/25.862/31.115/25.910/28.230 |
| map-entries-top-k | bun | 20.769 | 20.025 | 23.609 | 20.025/20.769/23.609/20.056/21.875 |
| sort-objects | node | 47.177 | 46.231 | 54.470 | 46.231/46.369/54.470/47.177/48.597 |
| sort-objects | bun | 28.673 | 27.660 | 30.135 | 28.321/27.660/29.901/28.673/30.135 |
| array-mutations | node | 1.864 | 1.800 | 1.985 | 1.864/1.800/1.974/1.844/1.985 |
| array-mutations | bun | 3.479 | 3.307 | 3.765 | 3.765/3.309/3.479/3.307/3.600 |
| array-methods | node | 6.363 | 5.955 | 6.869 | 6.869/5.955/6.540/6.044/6.363 |
| array-methods | bun | 8.309 | 5.699 | 9.258 | 9.258/8.331/8.056/8.309/5.699 |
| release-acyclic | node | 36.537 | 32.218 | 67.392 | 67.392/36.537/32.218/36.536/39.117 |
| release-acyclic | bun | 40.309 | 39.526 | 46.000 | 46.000/39.526/40.105/40.309/42.318 |
| cyclic-churn | node | 10.298 | 9.869 | 13.498 | 13.498/10.298/9.940/9.869/10.566 |
| cyclic-churn | bun | 11.716 | 10.916 | 19.067 | 13.884/10.969/11.716/10.916/19.067 |
| tree-teardown | node | 48.179 | 46.829 | 59.046 | 59.046/46.829/51.122/47.418/48.179 |
| tree-teardown | bun | 48.977 | 48.358 | 49.607 | 49.607/48.895/48.358/49.003/48.977 |
| awfy-towers | node | 35.182 | 32.900 | 36.197 | 35.182/33.003/35.459/32.900/36.197 |
| awfy-towers | bun | 27.985 | 27.406 | 28.681 | 27.985/27.444/28.014/27.406/28.681 |
| string-sort-control | node | 0.210 | 0.205 | 0.218 | 0.210/0.209/0.215/0.205/0.218 |
| string-sort-control | bun | 0.096 | 0.096 | 0.106 | 0.096/0.096/0.096/0.099/0.106 |
| integer-extrema-control | node | 0.108 | 0.105 | 0.112 | 0.108/0.106/0.110/0.105/0.112 |
| integer-extrema-control | bun | 0.090 | 0.081 | 0.094 | 0.083/0.091/0.081/0.090/0.094 |
| copy-within-control | node | 0.973 | 0.960 | 1.032 | 0.965/0.960/0.973/1.032/1.020 |
| copy-within-control | bun | 0.586 | 0.583 | 0.621 | 0.599/0.583/0.583/0.586/0.621 |
