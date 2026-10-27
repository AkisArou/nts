# Typed collector visitors A/B

Base d3a1d29fd; candidate ff2426c11ca0a8f6ceeb217a025c0ec5e00aae06. Native RC, shipping ThinLTO/x86-64-v3/32-byte loop alignment. CPU 4 under with-lock, sibling 5 admitted quiet at entry; host load and gate activity are recorded per cell. Five process brackets A/B/A per native row, one code layout. Floor is the maximum of five absolute A-repeat changes (nearest-rank P90 of five). Node and Bun each have five separate launches; their median, minimum and maximum are reported. Native has two pre-hot calls; each host has one checksum call plus a separately calibrated warmup (at most 20,000 calls/300 ms). Every arm of a row has the same N hot calls; counts and checksums are validated. Counters cover only the acknowledged hot window and must run at least 99% of the time. RSS is the peak of each workload process.

| Row | Backend | Base µs | Visitor µs | Wall Δ | Floor | Instructions Δ | Cycles Δ | RSS MiB A/B | /node A→B | /Bun A→B | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| cyclic-churn | c | 103.866 | 94.348 | -11.45% | 4.24% | -7.91% | -12.33% | 4.8/4.8 | 10.19→9.25 | 9.50→8.63 | improves |
| cyclic-churn | llvm | 106.073 | 99.244 | -6.41% | 4.68% | -7.90% | -6.99% | 4.9/4.8 | 10.40→9.73 | 9.71→9.08 | improves |
| release-acyclic | c | 91.744 | 92.018 | -0.67% | 4.38% | 0.00% | -0.52% | 4.0/4.0 | 2.49→2.50 | 2.24→2.24 | inside floor |
| release-acyclic | llvm | 92.450 | 96.014 | 2.14% | 1.31% | 0.00% | 2.39% | 4.0/4.0 | 2.51→2.61 | 2.26→2.34 | REGRESSES |
| sort-objects | c | 54.272 | 54.488 | 0.14% | 4.22% | 0.00% | 0.29% | 4.0/4.0 | 1.20→1.21 | 1.96→1.97 | inside floor |
| sort-objects | llvm | 58.830 | 60.526 | -0.88% | 4.48% | 0.00% | 0.88% | 4.0/4.0 | 1.30→1.34 | 2.12→2.18 | inside floor |
| tree-teardown | c | 29.658 | 30.805 | 3.87% | 10.09% | -0.00% | 5.16% | 4.1/4.1 | 0.60→0.63 | 0.61→0.63 | inside floor |
| tree-teardown | llvm | 31.988 | 32.042 | -0.55% | 15.39% | -0.00% | -0.46% | 4.1/4.1 | 0.65→0.65 | 0.66→0.66 | inside floor |
| immutable-update | c | 72.603 | 72.869 | 0.09% | 1.81% | -0.00% | -0.07% | 4.0/4.0 | 0.73→0.73 | 0.65→0.65 | inside floor |
| immutable-update | llvm | 73.482 | 72.568 | -1.24% | 4.00% | -0.00% | 0.06% | 4.1/4.0 | 0.74→0.73 | 0.66→0.65 | inside floor |
| array-copying-methods | c | 23.263 | 22.737 | 0.15% | 2.54% | -0.00% | 0.14% | 3.7/3.7 | 0.37→0.36 | 0.49→0.48 | inside floor |
| array-copying-methods | llvm | 24.058 | 24.455 | 2.74% | 5.44% | 0.00% | 3.20% | 3.8/3.7 | 0.38→0.39 | 0.51→0.51 | inside floor |
| map-entries-top-k | c | 17.502 | 17.485 | -0.04% | 2.74% | 0.00% | 0.39% | 4.1/4.1 | 0.67→0.67 | 0.85→0.85 | inside floor |
| map-entries-top-k | llvm | 17.804 | 17.707 | 0.28% | 2.51% | 0.00% | 0.89% | 4.1/4.1 | 0.68→0.67 | 0.87→0.86 | inside floor |
| awfy-towers | c | 33.098 | 33.419 | -0.08% | 2.35% | 0.00% | 0.05% | 3.8/3.7 | 0.98→0.99 | 1.19→1.20 | inside floor |
| awfy-towers | llvm | 32.146 | 32.312 | -0.51% | 5.79% | 0.00% | -0.02% | 3.7/3.7 | 0.95→0.96 | 1.16→1.16 | inside floor |
| json-parse | c | 889.285 | 893.679 | 1.88% | 1.63% | 0.04% | 1.70% | 7.6/7.8 | 1.18→1.19 | 1.09→1.09 | REGRESSES |
| json-parse | llvm | 903.915 | 888.458 | -0.17% | 3.60% | 0.04% | 0.16% | 7.8/7.8 | 1.20→1.18 | 1.10→1.09 | inside floor |
| json-build-append | c | 7.969 | 7.776 | -1.26% | 12.41% | -0.00% | -0.26% | 4.0/4.0 | 0.49→0.48 | 1.06→1.04 | inside floor |
| json-build-append | llvm | 8.424 | 8.391 | 1.08% | 2.45% | 0.00% | 0.08% | 4.0/4.2 | 0.51→0.51 | 1.12→1.12 | inside floor |
| json-build-join | c | 12.422 | 12.571 | -0.60% | 4.78% | 0.02% | -0.50% | 4.0/4.2 | 0.57→0.57 | 1.04→1.06 | inside floor |
| json-build-join | llvm | 12.272 | 12.361 | 0.73% | 2.02% | 0.02% | 0.51% | 4.0/4.0 | 0.56→0.56 | 1.03→1.04 | inside floor |
| json-stringify-doc | c | 1071.426 | 1037.904 | -3.13% | 2.10% | 0.00% | -2.93% | 12.0/12.0 | 0.71→0.69 | 0.30→0.29 | improves |
| json-stringify-doc | llvm | 1084.279 | 1077.166 | -1.30% | 3.51% | 0.00% | -1.17% | 12.0/12.0 | 0.72→0.71 | 0.31→0.31 | inside floor |

## All brackets and conditions

| Row | Backend | Round | Wall Δ | Instructions Δ | Cycles Δ | A-repeat floor | Load (A/B/A) | Gate(s) |
|---|---|---:|---:|---:|---:|---:|---|---|
| cyclic-churn | c | 1 | -14.49% | -7.91% | -14.39% | 4.24% | 11.40→11.40; 11.40→11.40; 11.40→11.40 | none |
| cyclic-churn | c | 2 | -12.25% | -7.91% | -12.33% | 2.27% | 13.11→13.11; 13.11→13.11; 13.11→13.11 | none |
| cyclic-churn | c | 3 | -6.98% | -7.91% | -11.32% | 1.00% | 10.34→10.34; 10.34→10.34; 10.34→10.34 | none |
| cyclic-churn | c | 4 | -11.45% | -7.91% | -11.88% | 0.96% | 9.21→9.21; 9.21→9.21; 9.21→9.21 | none |
| cyclic-churn | c | 5 | -8.40% | -7.91% | -12.47% | 0.76% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| cyclic-churn | llvm | 1 | -6.41% | -7.90% | -6.39% | 2.46% | 11.40→11.40; 11.40→11.40; 11.40→11.40 | none |
| cyclic-churn | llvm | 2 | -3.92% | -7.90% | -6.99% | 0.36% | 13.11→13.11; 13.11→13.11; 13.11→13.11 | none |
| cyclic-churn | llvm | 3 | -8.71% | -7.90% | -8.59% | 0.10% | 10.34→10.34; 10.34→10.34; 10.34→10.34 | none |
| cyclic-churn | llvm | 4 | -9.33% | -7.90% | -7.87% | 4.68% | 9.21→9.21; 9.21→9.21; 9.21→9.21 | none |
| cyclic-churn | llvm | 5 | -3.66% | -7.90% | -6.32% | 0.10% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| release-acyclic | c | 1 | -1.09% | 0.00% | -1.31% | 1.05% | 13.53→13.53; 13.53→13.53; 13.53→13.53 | none |
| release-acyclic | c | 2 | 2.38% | 0.00% | -0.52% | 0.65% | 12.54→12.54; 12.54→12.54; 12.54→12.54 | none |
| release-acyclic | c | 3 | -1.01% | 0.00% | -1.21% | 4.38% | 10.34→10.34; 10.34→10.34; 10.34→10.34 | none |
| release-acyclic | c | 4 | -0.67% | 0.00% | 0.21% | 2.25% | 9.21→9.21; 9.21→9.21; 9.21→9.21 | none |
| release-acyclic | c | 5 | 1.64% | 0.00% | 1.01% | 1.02% | 7.08→7.08; 7.08→7.08; 7.08→7.08 | none |
| release-acyclic | llvm | 1 | 1.13% | 0.00% | 1.24% | 1.00% | 13.53→13.53; 13.53→13.53; 13.53→13.53 | none |
| release-acyclic | llvm | 2 | 8.87% | 0.00% | 3.35% | 1.31% | 12.54→12.54; 12.54→12.54; 12.54→12.54 | none |
| release-acyclic | llvm | 3 | 4.64% | 0.00% | 4.82% | 0.09% | 10.34→10.34; 10.34→10.34; 10.34→10.34 | none |
| release-acyclic | llvm | 4 | 2.14% | 0.00% | 1.89% | 0.71% | 9.21→9.21; 9.21→9.21; 9.21→9.21 | none |
| release-acyclic | llvm | 5 | 2.13% | 0.00% | 2.39% | 0.61% | 7.08→7.08; 7.08→7.08; 7.08→7.08 | none |
| sort-objects | c | 1 | -1.01% | 0.00% | -0.97% | 3.31% | 13.53→13.53; 13.53→13.53; 13.53→13.53 | none |
| sort-objects | c | 2 | 0.40% | 0.00% | 0.29% | 0.05% | 12.54→12.54; 12.54→12.54; 12.54→12.54 | none |
| sort-objects | c | 3 | -0.11% | 0.00% | 0.07% | 3.23% | 9.67→9.67; 9.67→9.67; 9.67→9.67 | none |
| sort-objects | c | 4 | 0.93% | 0.00% | 0.76% | 4.22% | 9.21→9.21; 9.21→9.21; 9.21→9.21 | none |
| sort-objects | c | 5 | 0.14% | 0.00% | 0.80% | 1.75% | 7.08→7.08; 7.08→7.08; 7.08→7.08 | none |
| sort-objects | llvm | 1 | -1.47% | 0.00% | -1.46% | 2.97% | 13.53→13.53; 13.53→13.53; 13.53→13.53 | none |
| sort-objects | llvm | 2 | -0.99% | 0.00% | 1.03% | 1.43% | 12.54→12.54; 12.54→12.54; 12.54→12.54 | none |
| sort-objects | llvm | 3 | 4.40% | 0.00% | 2.26% | 4.48% | 9.67→9.67; 9.67→9.67; 9.67→9.67 | none |
| sort-objects | llvm | 4 | -0.22% | 0.00% | 0.88% | 2.42% | 9.21→9.21; 9.21→9.21; 9.21→9.21 | none |
| sort-objects | llvm | 5 | -0.88% | 0.00% | -0.57% | 3.06% | 7.08→7.08; 7.08→7.08; 7.08→7.08 | none |
| tree-teardown | c | 1 | 6.77% | -0.00% | 6.77% | 4.62% | 13.53→13.53; 13.53→13.53; 13.53→13.53 | none |
| tree-teardown | c | 2 | -3.22% | -0.00% | -1.78% | 1.01% | 12.54→12.54; 12.54→12.54; 12.54→12.54 | none |
| tree-teardown | c | 3 | 11.00% | 0.00% | 12.60% | 6.27% | 9.67→9.67; 9.67→9.67; 9.67→9.67 | none |
| tree-teardown | c | 4 | 3.87% | 0.00% | 5.16% | 3.60% | 8.63→8.63; 8.63→8.63; 8.63→8.63 | none |
| tree-teardown | c | 5 | -9.94% | -0.00% | -10.12% | 10.09% | 7.08→7.08; 7.08→7.08; 7.08→7.08 | none |
| tree-teardown | llvm | 1 | -0.55% | -0.00% | -0.46% | 0.60% | 13.53→13.53; 13.53→13.53; 13.53→13.53 | none |
| tree-teardown | llvm | 2 | 0.59% | 0.00% | -0.43% | 5.60% | 12.54→12.54; 12.54→12.54; 12.54→12.54 | none |
| tree-teardown | llvm | 3 | 6.16% | 0.00% | 5.66% | 6.42% | 9.67→9.67; 9.67→9.67; 9.67→9.67 | none |
| tree-teardown | llvm | 4 | -5.42% | -0.00% | -5.40% | 0.12% | 8.63→8.63; 8.63→8.63; 8.63→8.63 | none |
| tree-teardown | llvm | 5 | -7.87% | -0.00% | -7.64% | 15.39% | 7.08→7.08; 7.08→7.08; 7.08→7.08 | none |
| immutable-update | c | 1 | -1.37% | -0.00% | -1.30% | 1.81% | 14.05→14.05; 14.05→14.05; 14.05→14.05 | none |
| immutable-update | c | 2 | 0.37% | 0.00% | 0.21% | 0.25% | 11.86→11.86; 11.86→11.86; 11.86→11.86 | none |
| immutable-update | c | 3 | 0.09% | 0.00% | -0.07% | 0.29% | 9.67→9.67; 9.67→9.67; 9.67→9.67 | none |
| immutable-update | c | 4 | -1.93% | -0.00% | -0.57% | 1.27% | 8.63→8.63; 8.63→8.63; 8.63→8.63 | none |
| immutable-update | c | 5 | 0.37% | -0.00% | -0.02% | 1.02% | 6.59→6.59; 6.59→6.59; 6.59→6.59 | none |
| immutable-update | llvm | 1 | 0.56% | 0.00% | 0.43% | 0.20% | 14.05→14.05; 14.05→14.05; 14.05→14.05 | none |
| immutable-update | llvm | 2 | -1.41% | -0.00% | 0.06% | 3.02% | 11.86→11.86; 11.86→11.86; 11.86→11.86 | none |
| immutable-update | llvm | 3 | -1.24% | -0.00% | -0.24% | 3.63% | 9.67→9.67; 9.67→9.67; 9.67→9.67 | none |
| immutable-update | llvm | 4 | 1.43% | 0.00% | 0.35% | 0.35% | 8.63→8.63; 8.63→8.63; 8.63→8.63 | none |
| immutable-update | llvm | 5 | -1.35% | -0.00% | -0.05% | 4.00% | 6.59→6.59; 6.59→6.59; 6.59→6.59 | none |
| array-copying-methods | c | 1 | 0.29% | -0.00% | 0.29% | 0.19% | 14.05→14.05; 14.05→14.05; 14.05→14.05 | none |
| array-copying-methods | c | 2 | 0.15% | -0.00% | 0.14% | 0.26% | 11.86→11.86; 11.86→11.86; 11.86→11.86 | none |
| array-copying-methods | c | 3 | -2.81% | -0.00% | -1.45% | 2.54% | 9.67→9.67; 9.67→9.30; 9.30→9.30 | none |
| array-copying-methods | c | 4 | -3.14% | -0.00% | -2.06% | 2.34% | 8.63→8.63; 8.63→8.63; 8.63→8.63 | none |
| array-copying-methods | c | 5 | 0.87% | 0.00% | 1.29% | 0.63% | 6.59→6.59; 6.59→6.59; 6.59→6.59 | none |
| array-copying-methods | llvm | 1 | 2.96% | 0.00% | 4.28% | 0.48% | 14.05→14.05; 14.05→14.05; 14.05→14.05 | none |
| array-copying-methods | llvm | 2 | 2.74% | 0.00% | 3.42% | 0.09% | 11.86→11.86; 11.86→11.86; 11.86→11.86 | none |
| array-copying-methods | llvm | 3 | -0.84% | -0.00% | 2.99% | 5.44% | 9.30→9.30; 9.30→9.30; 9.30→9.30 | none |
| array-copying-methods | llvm | 4 | 1.65% | 0.00% | 3.14% | 0.68% | 8.63→8.63; 8.63→8.63; 8.63→8.63 | none |
| array-copying-methods | llvm | 5 | 2.76% | 0.00% | 3.20% | 0.33% | 6.59→6.59; 6.59→6.59; 6.59→6.59 | none |
| map-entries-top-k | c | 1 | 1.61% | 0.00% | 2.02% | 0.96% | 14.05→14.05; 14.05→14.05; 14.05→14.05 | none |
| map-entries-top-k | c | 2 | -0.04% | 0.00% | 1.03% | 2.74% | 11.86→11.86; 11.86→11.86; 11.86→11.86 | none |
| map-entries-top-k | c | 3 | -0.15% | 0.00% | 0.39% | 2.12% | 9.30→9.30; 9.30→9.30; 9.30→9.30 | none |
| map-entries-top-k | c | 4 | -0.09% | 0.00% | 0.38% | 1.20% | 8.10→8.10; 8.10→8.10; 8.10→8.10 | none |
| map-entries-top-k | c | 5 | 1.04% | 0.00% | -0.07% | 0.45% | 6.59→6.59; 6.59→6.59; 6.59→6.59 | none |
| map-entries-top-k | llvm | 1 | -0.20% | 0.00% | -0.40% | 1.65% | 14.05→14.05; 14.05→13.65; 13.65→13.65 | none |
| map-entries-top-k | llvm | 2 | 2.98% | 0.00% | 3.02% | 0.30% | 11.86→11.86; 11.86→11.86; 11.86→11.86 | none |
| map-entries-top-k | llvm | 3 | 16.06% | 0.00% | 15.62% | 2.43% | 9.30→9.30; 9.30→9.30; 9.30→9.30 | none |
| map-entries-top-k | llvm | 4 | -0.79% | 0.00% | -0.09% | 2.51% | 8.10→8.10; 8.10→8.10; 8.10→8.10 | none |
| map-entries-top-k | llvm | 5 | 0.28% | 0.00% | 0.89% | 0.16% | 6.59→6.59; 6.59→6.59; 6.59→6.59 | none |
| awfy-towers | c | 1 | -0.39% | 0.00% | 0.05% | 2.35% | 13.65→13.65; 13.65→13.65; 13.65→13.65 | none |
| awfy-towers | c | 2 | -0.50% | 0.00% | -0.04% | 0.40% | 11.86→11.86; 11.86→11.07; 11.07→11.07 | none |
| awfy-towers | c | 3 | -0.08% | 0.00% | 0.12% | 0.63% | 9.30→9.30; 9.30→9.30; 9.30→9.30 | none |
| awfy-towers | c | 4 | 0.97% | 0.00% | 0.08% | 0.37% | 8.10→8.10; 8.10→8.10; 8.10→8.10 | none |
| awfy-towers | c | 5 | 1.68% | 0.00% | -0.02% | 0.03% | 6.59→6.59; 6.59→6.23; 6.23→6.23 | none |
| awfy-towers | llvm | 1 | -0.08% | 0.00% | -0.02% | 0.73% | 13.65→13.65; 13.65→13.65; 13.65→13.65 | none |
| awfy-towers | llvm | 2 | -1.77% | 0.00% | -0.06% | 4.12% | 11.07→11.07; 11.07→11.07; 11.07→11.07 | none |
| awfy-towers | llvm | 3 | -0.51% | 0.00% | -0.08% | 1.08% | 9.30→9.30; 9.30→9.30; 9.30→9.30 | none |
| awfy-towers | llvm | 4 | 53.35% | 0.00% | 55.77% | 0.18% | 8.10→8.10; 8.10→8.10; 8.10→8.10 | none |
| awfy-towers | llvm | 5 | -2.18% | 0.00% | 0.01% | 5.79% | 6.23→6.23; 6.23→6.23; 6.23→6.23 | none |
| json-parse | c | 1 | 1.37% | 0.04% | 1.70% | 0.42% | 13.65→13.65; 13.65→13.65; 13.65→13.65 | none |
| json-parse | c | 2 | 1.88% | 0.04% | 0.92% | 1.50% | 11.07→11.07; 11.07→11.07; 11.07→11.07 | none |
| json-parse | c | 3 | 3.05% | 0.04% | 1.87% | 0.19% | 9.30→9.30; 9.30→9.84; 9.84→9.84 | none |
| json-parse | c | 4 | 0.49% | 0.04% | 0.97% | 1.63% | 8.10→8.10; 8.10→8.10; 8.10→8.10 | none |
| json-parse | c | 5 | 4.34% | 0.04% | 1.72% | 1.51% | 6.23→6.23; 6.23→6.23; 6.23→6.23 | none |
| json-parse | llvm | 1 | -0.50% | 0.04% | 0.39% | 1.65% | 13.65→13.65; 13.65→13.65; 13.65→13.65 | none |
| json-parse | llvm | 2 | -0.17% | 0.04% | 0.14% | 0.28% | 11.07→11.07; 11.07→11.07; 11.07→11.07 | none |
| json-parse | llvm | 3 | -2.71% | 0.04% | 0.16% | 1.99% | 9.84→9.84; 9.84→9.84; 9.84→9.84 | none |
| json-parse | llvm | 4 | 1.07% | 0.04% | 0.51% | 3.60% | 8.10→8.10; 8.10→8.10; 8.10→8.10 | none |
| json-parse | llvm | 5 | 0.10% | 0.04% | 0.08% | 0.34% | 6.23→6.23; 6.23→6.23; 6.23→6.23 | none |
| json-build-append | c | 1 | -1.26% | -0.00% | -0.34% | 0.50% | 13.65→13.65; 13.65→13.65; 13.65→13.65 | none |
| json-build-append | c | 2 | -0.49% | -0.00% | -0.26% | 0.45% | 11.07→11.07; 11.07→11.07; 11.07→11.07 | none |
| json-build-append | c | 3 | -2.28% | -0.00% | -0.23% | 2.29% | 9.84→9.84; 9.84→9.84; 9.84→9.84 | none |
| json-build-append | c | 4 | -7.01% | -0.00% | -6.50% | 12.41% | 8.10→8.10; 8.10→8.10; 8.10→7.61 | none |
| json-build-append | c | 5 | 0.67% | 0.00% | -0.23% | 0.48% | 6.23→6.23; 6.23→6.23; 6.23→6.23 | none |
| json-build-append | llvm | 1 | 1.08% | -0.00% | 0.95% | 0.89% | 13.65→13.65; 13.65→13.11; 13.11→13.11 | none |
| json-build-append | llvm | 2 | 0.46% | 0.00% | 0.31% | 0.40% | 11.07→11.07; 11.07→11.07; 11.07→11.07 | none |
| json-build-append | llvm | 3 | -1.91% | -0.00% | -0.29% | 1.25% | 9.84→9.84; 9.84→9.84; 9.84→9.84 | none |
| json-build-append | llvm | 4 | 1.09% | 0.00% | 0.08% | 2.45% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| json-build-append | llvm | 5 | 2.59% | 0.00% | -0.11% | 0.08% | 6.23→6.23; 6.23→6.23; 6.23→6.23 | none |
| json-build-join | c | 1 | -0.68% | 0.02% | -0.71% | 0.33% | 13.11→13.11; 13.11→13.11; 13.11→13.11 | none |
| json-build-join | c | 2 | 3.41% | 0.02% | -0.23% | 0.89% | 11.07→11.07; 11.07→11.07; 11.07→11.07 | none |
| json-build-join | c | 3 | -0.60% | 0.02% | -1.14% | 1.78% | 9.84→9.84; 9.84→9.84; 9.84→9.84 | none |
| json-build-join | c | 4 | 2.28% | 0.02% | 0.17% | 2.99% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| json-build-join | c | 5 | -2.88% | 0.02% | -0.50% | 4.78% | 6.23→6.23; 6.23→6.23; 6.23→6.23 | none |
| json-build-join | llvm | 1 | 2.77% | 0.02% | -0.30% | 0.12% | 13.11→13.11; 13.11→13.11; 13.11→13.11 | none |
| json-build-join | llvm | 2 | -0.21% | 0.02% | -0.19% | 1.32% | 11.07→11.07; 11.07→11.07; 11.07→10.34 | none |
| json-build-join | llvm | 3 | 0.68% | 0.02% | 0.51% | 1.17% | 9.84→9.84; 9.84→9.84; 9.84→9.84 | none |
| json-build-join | llvm | 4 | 0.73% | 0.02% | 0.80% | 2.02% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| json-build-join | llvm | 5 | 0.73% | 0.02% | 0.53% | 0.12% | 6.23→6.23; 6.23→6.23; 6.23→5.89 | none |
| json-stringify-doc | c | 1 | -2.74% | 0.00% | -2.84% | 0.45% | 13.11→13.11; 13.11→13.11; 13.11→13.11 | none |
| json-stringify-doc | c | 2 | -3.13% | 0.00% | -2.90% | 0.30% | 10.34→10.34; 10.34→10.34; 10.34→10.34 | none |
| json-stringify-doc | c | 3 | -3.59% | 0.00% | -3.07% | 2.10% | 9.84→9.84; 9.84→9.84; 9.84→9.84 | none |
| json-stringify-doc | c | 4 | -2.00% | 0.00% | -2.97% | 0.86% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| json-stringify-doc | c | 5 | -3.28% | 0.00% | -2.93% | 0.26% | 5.89→5.89; 5.89→5.89; 5.89→5.89 | none |
| json-stringify-doc | llvm | 1 | -1.30% | 0.00% | -1.41% | 1.02% | 13.11→13.11; 13.11→13.11; 13.11→13.11 | none |
| json-stringify-doc | llvm | 2 | -0.04% | 0.00% | -0.78% | 0.29% | 10.34→10.34; 10.34→10.34; 10.34→10.34 | none |
| json-stringify-doc | llvm | 3 | -0.64% | 0.00% | -1.17% | 3.51% | 9.84→9.84; 9.84→9.84; 9.84→9.21 | none |
| json-stringify-doc | llvm | 4 | -2.16% | 0.00% | -1.20% | 2.77% | 7.61→7.61; 7.61→7.61; 7.61→7.61 | none |
| json-stringify-doc | llvm | 5 | -2.38% | 0.00% | -0.83% | 3.47% | 5.89→5.89; 5.89→5.89; 5.89→5.89 | none |

## Linked size

Descriptor bytes sum the linked nts_desc_* symbols; absent functions were inlined or eliminated. Every size is from the same binary measured above.

| Row | Backend | Arm | .text B | Descriptors B | Descriptor symbols | Trace functions/B | nts_release B | nts_value_release B |
|---|---|---|---:|---:|---:|---:|---:|---:|
| cyclic-churn | c | base | 34976 | 576 | 6 | 0/0 | 81 | absent/inlined |
| cyclic-churn | llvm | base | 35104 | 576 | 6 | 0/0 | 81 | absent/inlined |
| release-acyclic | c | base | 28736 | 576 | 6 | 0/0 | 81 | absent/inlined |
| release-acyclic | llvm | base | 28864 | 576 | 6 | 0/0 | 81 | absent/inlined |
| sort-objects | c | base | 32992 | 576 | 6 | 0/0 | 81 | absent/inlined |
| sort-objects | llvm | base | 33504 | 576 | 6 | 0/0 | 81 | absent/inlined |
| tree-teardown | c | base | 18256 | 288 | 3 | 0/0 | 81 | absent/inlined |
| tree-teardown | llvm | base | 18448 | 288 | 3 | 0/0 | 81 | absent/inlined |
| immutable-update | c | base | 30208 | 480 | 5 | 0/0 | 81 | absent/inlined |
| immutable-update | llvm | base | 30528 | 480 | 5 | 0/0 | 81 | absent/inlined |
| array-copying-methods | c | base | 39584 | 480 | 5 | 0/0 | 81 | absent/inlined |
| array-copying-methods | llvm | base | 39392 | 480 | 5 | 0/0 | 81 | absent/inlined |
| map-entries-top-k | c | base | 82208 | 672 | 7 | 0/0 | 81 | 120 |
| map-entries-top-k | llvm | base | 81984 | 672 | 7 | 0/0 | 81 | 120 |
| awfy-towers | c | base | 32128 | 672 | 7 | 0/0 | 81 | absent/inlined |
| awfy-towers | llvm | base | 32096 | 672 | 7 | 0/0 | 81 | absent/inlined |
| json-parse | c | base | 124672 | 1152 | 12 | 0/0 | 81 | 120 |
| json-parse | llvm | base | 125600 | 1152 | 12 | 0/0 | 81 | 120 |
| json-build-append | c | base | 47696 | 384 | 4 | 0/0 | 81 | absent/inlined |
| json-build-append | llvm | base | 47888 | 384 | 4 | 0/0 | 81 | absent/inlined |
| json-build-join | c | base | 45056 | 384 | 4 | 0/0 | 81 | absent/inlined |
| json-build-join | llvm | base | 45216 | 384 | 4 | 0/0 | 81 | absent/inlined |
| json-stringify-doc | c | base | 116320 | 1152 | 12 | 0/0 | 81 | 120 |
| json-stringify-doc | llvm | base | 116256 | 1152 | 12 | 0/0 | 81 | 120 |
| cyclic-churn | c | visitors | 35104 | 624 | 6 | 2/134 | 81 | absent/inlined |
| cyclic-churn | llvm | visitors | 35264 | 624 | 6 | 2/135 | 81 | absent/inlined |
| release-acyclic | c | visitors | 28800 | 624 | 6 | 1/46 | 81 | absent/inlined |
| release-acyclic | llvm | visitors | 28928 | 624 | 6 | 1/46 | 81 | absent/inlined |
| sort-objects | c | visitors | 32992 | 624 | 6 | 0/0 | 81 | absent/inlined |
| sort-objects | llvm | visitors | 33504 | 624 | 6 | 0/0 | 81 | absent/inlined |
| tree-teardown | c | visitors | 18288 | 312 | 3 | 1/46 | 81 | absent/inlined |
| tree-teardown | llvm | visitors | 18512 | 312 | 3 | 1/46 | 81 | absent/inlined |
| immutable-update | c | visitors | 30208 | 520 | 5 | 0/0 | 81 | absent/inlined |
| immutable-update | llvm | visitors | 30528 | 520 | 5 | 0/0 | 81 | absent/inlined |
| array-copying-methods | c | visitors | 39680 | 520 | 5 | 1/88 | 81 | absent/inlined |
| array-copying-methods | llvm | visitors | 39488 | 520 | 5 | 1/89 | 81 | absent/inlined |
| map-entries-top-k | c | visitors | 82240 | 728 | 7 | 1/12 | 81 | 120 |
| map-entries-top-k | llvm | visitors | 81984 | 728 | 7 | 1/12 | 81 | 120 |
| awfy-towers | c | visitors | 32256 | 728 | 7 | 3/112 | 81 | absent/inlined |
| awfy-towers | llvm | visitors | 32224 | 728 | 7 | 3/113 | 81 | absent/inlined |
| json-parse | c | visitors | 124992 | 1248 | 12 | 4/299 | 81 | 120 |
| json-parse | llvm | visitors | 125920 | 1248 | 12 | 4/300 | 81 | 120 |
| json-build-append | c | visitors | 47696 | 416 | 4 | 0/0 | 81 | absent/inlined |
| json-build-append | llvm | visitors | 47888 | 416 | 4 | 0/0 | 81 | absent/inlined |
| json-build-join | c | visitors | 45056 | 416 | 4 | 0/0 | 81 | absent/inlined |
| json-build-join | llvm | visitors | 45216 | 416 | 4 | 0/0 | 81 | absent/inlined |
| json-stringify-doc | c | visitors | 116672 | 1248 | 12 | 4/345 | 81 | 120 |
| json-stringify-doc | llvm | visitors | 116608 | 1248 | 12 | 4/348 | 81 | 120 |

The Verdict column classifies paired wall time against its repeat floor; it does not assign a mechanism. In particular, doc C has flat instructions and its wall-only improvement is not claimed as a field-discovery win. Wall, cycle and instruction deltas are medians of the five paired ratios. Displayed absolute times are separate medians, so dividing those two time columns need not reproduce the paired delta. Native work has N hot calls plus two pre-hot check/warmup calls; host work has the same N hot calls plus one checksum call and its separately reported calibrated warmup. Linked size changes are reported per row.

## Host process spread

| Row | Host | Median µs | Minimum µs | Maximum µs | All five launches, µs |
|---|---|---:|---:|---:|---|
| cyclic-churn | node | 10.195 | 9.519 | 23.682 | 23.682/10.412/10.075/10.195/9.519 |
| cyclic-churn | bun | 10.928 | 10.746 | 26.169 | 26.169/11.179/10.928/10.898/10.746 |
| release-acyclic | node | 36.820 | 35.039 | 69.969 | 69.969/36.800/36.820/40.184/35.039 |
| release-acyclic | bun | 40.997 | 36.908 | 70.508 | 70.508/40.997/40.137/36.908/45.205 |
| sort-objects | node | 45.120 | 44.340 | 54.161 | 54.161/45.120/45.100/47.289/44.340 |
| sort-objects | bun | 27.719 | 26.814 | 32.019 | 32.019/27.719/27.491/29.913/26.814 |
| tree-teardown | node | 49.022 | 45.873 | 66.543 | 66.543/49.687/47.349/49.022/45.873 |
| tree-teardown | bun | 48.671 | 48.157 | 59.639 | 59.639/48.157/48.671/49.171/48.224 |
| immutable-update | node | 99.193 | 94.860 | 112.297 | 112.297/99.193/98.184/99.395/94.860 |
| immutable-update | bun | 111.740 | 107.660 | 129.197 | 129.197/111.740/110.655/115.741/107.660 |
| array-copying-methods | node | 63.446 | 60.925 | 68.070 | 68.070/61.444/63.500/63.446/60.925 |
| array-copying-methods | bun | 47.556 | 45.453 | 56.542 | 51.764/46.381/56.542/47.556/45.453 |
| map-entries-top-k | node | 26.241 | 23.930 | 31.905 | 29.615/25.360/31.905/26.241/23.930 |
| map-entries-top-k | bun | 20.539 | 19.747 | 22.211 | 22.211/19.910/21.968/20.539/19.747 |
| awfy-towers | node | 33.771 | 32.780 | 36.045 | 35.619/32.780/36.045/33.771/32.861 |
| awfy-towers | bun | 27.821 | 26.611 | 29.257 | 29.257/26.971/28.971/27.821/26.611 |
| json-parse | node | 752.666 | 632.911 | 888.610 | 754.222/888.610/752.666/695.534/632.911 |
| json-parse | bun | 818.207 | 810.931 | 930.180 | 930.180/818.207/826.014/811.335/810.931 |
| json-build-append | node | 16.360 | 15.181 | 16.630 | 16.630/15.417/16.499/16.360/15.181 |
| json-build-append | bun | 7.502 | 7.128 | 8.332 | 7.269/7.502/8.332/7.904/7.128 |
| json-build-join | node | 21.936 | 21.410 | 22.428 | 21.936/21.410/22.236/22.428/21.442 |
| json-build-join | bun | 11.902 | 11.408 | 12.540 | 12.479/11.902/11.834/12.540/11.408 |
| json-stringify-doc | node | 1510.324 | 1438.755 | 1605.866 | 1605.866/1502.526/1510.324/1438.755/1514.495 |
| json-stringify-doc | bun | 3522.216 | 3250.675 | 3766.344 | 3766.344/3522.216/3692.088/3250.675/3520.113 |
