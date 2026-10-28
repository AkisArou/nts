# Proved-int32 arithmetic A/B

Base 715b6015bb238257e3187dafd9a2ed7d707dcb08; candidate ca2fe8bf6fafdb6c3d50f1c7f677042480b7d7f5. Native RC, shipping ThinLTO/x86-64-v3/32-byte loop alignment. CPU 4 under with-lock, sibling 5 admitted quiet at entry; host load and gate activity are recorded per cell. Five process brackets A/B/A per native row, one code layout. Wall floor is max(3%, twice the maximum absolute A-repeat change across five brackets). Instruction counts decide regressions; effects smaller than the measured row layout range require seeded-layout means. Node and Bun each have five separate launches; their median, minimum and maximum are reported. Native has two pre-hot calls; each host has one checksum call plus a separately calibrated warmup (at most 20,000 calls/300 ms). Every arm of a row has the same N hot calls; counts and checksums are validated. Counters cover only the acknowledged hot window and must run at least 99% of the time. RSS is the peak of each workload process.

| Row | Backend | Base µs | Integer µs | Wall Δ | Floor | Instructions Δ | Cycles Δ | RSS MiB A/B | /node A→B | /Bun A→B | Wall verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| array-copying-methods | c | 24.214 | 24.835 | 1.24% | 6.39% | 0.00% | -0.00% | 3.9/4.0 | 0.36→0.37 | 0.46→0.47 | inside floor |
| array-copying-methods | llvm | 26.274 | 25.932 | -0.78% | 4.37% | -0.00% | -0.75% | 4.0/3.9 | 0.39→0.38 | 0.50→0.49 | inside floor |
| map-literal-keys | c | 50.132 | 29.324 | -41.94% | 13.81% | -6.97% | -42.85% | 3.9/4.0 | 0.83→0.49 | 3.84→2.25 | improves |
| map-literal-keys | llvm | 50.316 | 31.045 | -37.88% | 38.05% | -8.14% | -38.89% | 3.9/3.9 | 0.83→0.51 | 3.85→2.38 | inside floor |
| map-word-counts | c | 5.036 | 4.999 | -2.48% | 12.25% | 0.00% | -1.85% | 4.0/4.0 | 0.58→0.57 | 0.84→0.83 | inside floor |
| map-word-counts | llvm | 5.028 | 5.021 | 0.67% | 9.27% | 0.00% | -0.49% | 3.9/4.0 | 0.58→0.57 | 0.84→0.83 | inside floor |
| record-word-counts | c | 5.177 | 5.247 | 0.22% | 9.01% | -0.00% | 0.64% | 4.0/3.9 | 0.56→0.57 | 1.19→1.21 | inside floor |
| record-word-counts | llvm | 5.106 | 5.105 | 0.44% | 7.25% | -0.00% | 0.07% | 4.0/3.9 | 0.55→0.55 | 1.18→1.18 | inside floor |
| str-map-keys | c | 4.356 | 4.315 | -0.67% | 6.02% | -0.00% | -0.86% | 4.2/4.0 | 0.70→0.70 | 0.71→0.70 | inside floor |
| str-map-keys | llvm | 4.947 | 4.955 | 0.17% | 7.42% | 0.00% | -0.58% | 4.2/4.2 | 0.80→0.80 | 0.80→0.80 | inside floor |
| symbol-keyed-map | c | 25.594 | 18.407 | -29.63% | 11.91% | -5.52% | -30.00% | 3.9/3.9 | 0.54→0.39 | 2.85→2.05 | improves |
| symbol-keyed-map | llvm | 25.787 | 19.707 | -25.25% | 28.61% | -12.90% | -25.81% | 3.9/3.9 | 0.54→0.42 | 2.87→2.19 | inside floor |
| map-and-set | c | 5.306 | 5.272 | 0.07% | 7.14% | 0.00% | -0.16% | 4.2/4.1 | 0.64→0.64 | 0.80→0.79 | inside floor |
| map-and-set | llvm | 5.337 | 5.279 | -1.94% | 7.29% | 0.00% | -1.44% | 4.2/4.2 | 0.65→0.64 | 0.80→0.79 | inside floor |
| map-entries-top-k | c | 17.969 | 18.008 | 0.27% | 6.22% | -0.00% | 0.16% | 4.2/4.1 | 0.62→0.62 | 0.78→0.78 | inside floor |
| map-entries-top-k | llvm | 18.426 | 18.302 | -0.67% | 5.19% | 0.00% | -0.59% | 4.2/4.3 | 0.64→0.63 | 0.80→0.80 | inside floor |
| checksum | c | 5.406 | 5.408 | -0.02% | 3.00% | -0.00% | -0.00% | 3.9/3.9 | 0.88→0.88 | 0.21→0.21 | inside floor |
| checksum | llvm | 5.392 | 5.357 | 0.09% | 3.00% | 0.00% | -0.00% | 3.9/3.9 | 0.88→0.87 | 0.21→0.21 | inside floor |
| accumulate | c | 1.295 | 1.281 | 0.58% | 3.00% | -0.00% | 0.01% | 3.9/3.8 | 0.31→0.30 | 0.05→0.05 | inside floor |
| accumulate | llvm | 1.089 | 1.077 | -0.05% | 3.00% | 0.00% | -0.03% | 3.9/3.9 | 0.26→0.26 | 0.05→0.05 | inside floor |
| case-convert | c | 1.830 | 1.819 | -0.67% | 3.00% | -0.00% | -0.06% | 3.9/3.9 | 0.52→0.51 | 0.47→0.47 | inside floor |
| case-convert | llvm | 1.824 | 1.810 | -0.47% | 3.00% | 0.00% | 0.15% | 3.9/3.9 | 0.52→0.51 | 0.47→0.46 | inside floor |
| json-parse | c | 937.047 | 934.042 | 0.25% | 3.00% | 0.00% | -0.10% | 7.8/7.8 | 1.23→1.22 | 0.97→0.97 | inside floor |
| json-parse | llvm | 970.362 | 968.414 | 0.08% | 8.42% | -0.00% | -0.05% | 7.8/7.8 | 1.27→1.27 | 1.01→1.01 | inside floor |
| json-build-append | c | 8.244 | 8.192 | -0.15% | 4.43% | 0.00% | 0.07% | 4.2/4.2 | 0.49→0.49 | 1.08→1.07 | inside floor |
| json-build-append | llvm | 8.656 | 8.603 | -0.07% | 3.36% | 0.00% | -0.11% | 4.2/4.2 | 0.51→0.51 | 1.13→1.12 | inside floor |
| json-build-join | c | 12.932 | 13.037 | -0.50% | 12.03% | -0.00% | -0.31% | 4.2/4.1 | 0.58→0.58 | 1.01→1.02 | inside floor |
| json-build-join | llvm | 12.674 | 12.754 | 0.08% | 3.00% | -0.00% | -0.55% | 4.2/4.2 | 0.56→0.57 | 0.99→1.00 | inside floor |
| awfy-bounce | c | 5.330 | 5.306 | 0.12% | 7.00% | -0.00% | -0.55% | 3.9/3.9 | 0.38→0.38 | 0.30→0.30 | inside floor |
| awfy-bounce | llvm | 5.308 | 5.354 | 0.88% | 3.38% | 0.00% | 0.16% | 3.9/3.9 | 0.38→0.38 | 0.30→0.31 | inside floor |
| awfy-list | c | 11.007 | 10.924 | -0.60% | 6.37% | 0.00% | -0.13% | 3.9/3.9 | 0.61→0.61 | 0.72→0.71 | inside floor |
| awfy-list | llvm | 12.145 | 12.166 | -0.02% | 8.27% | -0.00% | -0.06% | 3.9/3.9 | 0.67→0.67 | 0.79→0.79 | inside floor |
| awfy-mandelbrot | c | 24822.563 | 24402.281 | -0.14% | 10.71% | -0.00% | -0.07% | 3.9/3.9 | 1.01→0.99 | 0.99→0.98 | inside floor |
| awfy-mandelbrot | llvm | 24468.422 | 25048.469 | 1.52% | 4.78% | 0.00% | -0.03% | 3.9/3.9 | 1.00→1.02 | 0.98→1.00 | inside floor |
| awfy-nbody | c | 8468.785 | 8521.316 | 0.65% | 3.00% | -0.00% | -0.01% | 3.9/3.9 | 0.09→0.09 | 0.47→0.47 | inside floor |
| awfy-nbody | llvm | 8633.247 | 8572.063 | -0.16% | 4.42% | -0.00% | -0.03% | 3.9/3.9 | 0.10→0.10 | 0.48→0.47 | inside floor |
| awfy-permute | c | 22.910 | 22.901 | -1.20% | 22.90% | -0.00% | -0.24% | 4.0/3.9 | 0.92→0.92 | 0.89→0.89 | inside floor |
| awfy-permute | llvm | 25.927 | 25.920 | -0.02% | 3.34% | -0.00% | -0.27% | 3.9/3.9 | 1.04→1.04 | 1.01→1.01 | inside floor |
| awfy-queens | c | 10.231 | 10.256 | -0.28% | 4.00% | 0.00% | 0.10% | 3.9/4.0 | 0.53→0.53 | 0.63→0.63 | inside floor |
| awfy-queens | llvm | 10.957 | 10.936 | -0.09% | 3.00% | -0.00% | -0.22% | 3.9/3.9 | 0.57→0.57 | 0.67→0.67 | inside floor |
| awfy-sieve | c | 3.714 | 3.703 | -0.19% | 5.12% | -0.00% | 0.09% | 3.9/3.9 | 0.32→0.32 | 0.33→0.33 | inside floor |
| awfy-sieve | llvm | 5.086 | 5.127 | 0.18% | 6.47% | 0.00% | -0.47% | 3.9/3.9 | 0.44→0.44 | 0.45→0.45 | inside floor |
| awfy-towers | c | 35.552 | 35.544 | 0.48% | 3.82% | -0.00% | 0.12% | 3.9/3.9 | 0.95→0.95 | 1.17→1.17 | inside floor |
| awfy-towers | llvm | 34.119 | 33.950 | -0.36% | 3.85% | -0.00% | 0.01% | 3.9/3.9 | 0.92→0.91 | 1.12→1.12 | inside floor |

## All brackets and conditions

| Row | Backend | Round | Wall Δ | Instructions Δ | Cycles Δ | A-repeat floor | Load (A/B/A) | Gate(s) |
|---|---|---:|---:|---:|---:|---:|---|---|
| array-copying-methods | c | 1 | 6.71% | 0.00% | 7.02% | 0.32% | 18.15→17.26; 17.26→17.26; 17.26→17.26 | none |
| array-copying-methods | c | 2 | 1.24% | 0.00% | -0.00% | 0.34% | 13.68→13.68; 13.68→13.68; 13.68→13.68 | none |
| array-copying-methods | c | 3 | 0.58% | -0.00% | 0.70% | 3.20% | 15.13→15.13; 15.13→24.97; 24.97→24.97 | none |
| array-copying-methods | c | 4 | 1.86% | 0.00% | -1.53% | 0.02% | 21.01→21.01; 21.01→19.73; 19.73→19.73 | none |
| array-copying-methods | c | 5 | 0.67% | -0.00% | -0.23% | 1.92% | 14.08→14.08; 14.08→14.08; 14.08→14.08 | none |
| array-copying-methods | llvm | 1 | -0.78% | -0.00% | -0.41% | 1.18% | 17.26→17.26; 17.26→17.26; 17.26→17.26 | none |
| array-copying-methods | llvm | 2 | 0.02% | 0.00% | 0.12% | 0.36% | 13.68→13.68; 13.68→13.68; 13.68→13.68 | none |
| array-copying-methods | llvm | 3 | -1.53% | -0.00% | -1.32% | 0.42% | 24.97→24.97; 24.97→24.97; 24.97→24.97 | none |
| array-copying-methods | llvm | 4 | -0.73% | 0.00% | -0.75% | 1.73% | 19.73→19.73; 19.73→19.73; 19.73→19.73 | none |
| array-copying-methods | llvm | 5 | -1.20% | -0.00% | -1.46% | 2.18% | 14.08→14.08; 14.08→14.32; 14.32→14.32 | none |
| map-literal-keys | c | 1 | -41.94% | -6.97% | -42.78% | 6.48% | 17.26→17.26; 17.26→17.26; 17.26→17.26 | none |
| map-literal-keys | c | 2 | -40.86% | -6.97% | -42.82% | 6.91% | 13.46→13.46; 13.46→13.46; 13.46→13.46 | none |
| map-literal-keys | c | 3 | -43.67% | -6.97% | -44.71% | 0.99% | 24.97→24.97; 24.97→24.97; 24.97→24.97 | none |
| map-literal-keys | c | 4 | -43.67% | -6.97% | -44.64% | 1.36% | 19.73→19.73; 19.73→19.73; 19.73→19.73 | none |
| map-literal-keys | c | 5 | -41.51% | -6.97% | -42.85% | 6.43% | 14.32→14.32; 14.32→14.32; 14.32→14.32 | none |
| map-literal-keys | llvm | 1 | -38.43% | -8.14% | -40.75% | 0.47% | 17.26→17.26; 17.26→17.26; 17.26→17.26 | none |
| map-literal-keys | llvm | 2 | -39.39% | -8.14% | -40.75% | 0.05% | 13.46→13.46; 13.46→13.46; 13.46→13.46 | none |
| map-literal-keys | llvm | 3 | -11.59% | -8.14% | -20.78% | 19.03% | 24.97→24.97; 24.97→24.97; 24.97→24.97 | none |
| map-literal-keys | llvm | 4 | -37.88% | -8.14% | -38.89% | 5.24% | 19.73→19.73; 19.73→19.73; 19.73→19.73 | none |
| map-literal-keys | llvm | 5 | -35.41% | -8.14% | -36.91% | 0.05% | 14.32→14.32; 14.32→14.32; 14.32→14.32 | none |
| map-word-counts | c | 1 | -3.12% | 0.00% | -2.92% | 6.13% | 17.26→17.26; 17.26→17.26; 17.26→17.26 | none |
| map-word-counts | c | 2 | -2.89% | 0.00% | -3.60% | 2.13% | 13.46→13.46; 13.46→13.46; 13.46→13.46 | none |
| map-word-counts | c | 3 | 2.89% | 0.00% | 3.18% | 3.24% | 24.97→24.97; 24.97→24.97; 24.97→24.97 | none |
| map-word-counts | c | 4 | -2.48% | -0.00% | -1.85% | 2.11% | 19.73→19.73; 19.73→19.73; 19.73→19.73 | none |
| map-word-counts | c | 5 | 10.27% | 0.00% | 9.76% | 1.70% | 14.32→14.32; 14.32→14.32; 14.32→14.32 | none |
| map-word-counts | llvm | 1 | -2.00% | -0.00% | -0.78% | 1.46% | 17.26→17.26; 17.26→17.26; 17.26→17.26 | none |
| map-word-counts | llvm | 2 | 0.67% | -0.00% | -0.49% | 0.81% | 13.46→13.46; 13.46→13.46; 13.46→13.46 | none |
| map-word-counts | llvm | 3 | 0.93% | 0.00% | 0.44% | 0.70% | 24.97→24.97; 24.97→24.97; 24.97→24.97 | none |
| map-word-counts | llvm | 4 | -0.84% | 0.00% | -1.65% | 4.64% | 19.73→19.73; 19.73→19.73; 19.73→19.73 | none |
| map-word-counts | llvm | 5 | 3.87% | 0.00% | 3.82% | 0.92% | 14.32→14.32; 14.32→14.32; 14.32→14.32 | none |
| record-word-counts | c | 1 | 4.32% | -0.00% | 6.49% | 0.55% | 17.26→17.26; 17.26→17.26; 17.26→17.26 | none |
| record-word-counts | c | 2 | 1.34% | -0.00% | 1.27% | 4.42% | 13.46→13.46; 13.46→13.46; 13.46→13.46 | none |
| record-word-counts | c | 3 | 0.22% | -0.00% | 0.37% | 0.02% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| record-word-counts | c | 4 | -0.95% | 0.00% | 0.64% | 2.63% | 19.73→19.73; 19.73→19.73; 19.73→19.73 | none |
| record-word-counts | c | 5 | -2.83% | 0.00% | -2.77% | 4.50% | 14.32→14.32; 14.32→14.32; 14.32→14.32 | none |
| record-word-counts | llvm | 1 | -0.01% | -0.00% | 0.59% | 1.26% | 17.26→17.26; 17.26→16.44; 16.44→16.44 | none |
| record-word-counts | llvm | 2 | -1.22% | -0.00% | -0.65% | 1.60% | 13.46→13.46; 13.46→13.46; 13.46→13.46 | none |
| record-word-counts | llvm | 3 | 0.84% | 0.00% | 0.07% | 0.88% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| record-word-counts | llvm | 4 | 0.44% | -0.00% | -0.42% | 3.62% | 19.73→19.73; 19.73→19.73; 19.73→18.63 | none |
| record-word-counts | llvm | 5 | 3.35% | 0.00% | 3.52% | 1.89% | 14.32→14.32; 14.32→14.32; 14.32→13.81 | none |
| str-map-keys | c | 1 | -0.95% | -0.00% | -0.86% | 1.15% | 16.44→16.44; 16.44→16.44; 16.44→16.44 | none |
| str-map-keys | c | 2 | -0.12% | 0.00% | -0.39% | 0.74% | 13.46→13.26; 13.26→13.26; 13.26→13.26 | none |
| str-map-keys | c | 3 | 0.16% | 0.00% | -0.47% | 0.73% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| str-map-keys | c | 4 | -0.67% | -0.00% | -1.76% | 3.01% | 18.63→18.63; 18.63→18.63; 18.63→18.63 | none |
| str-map-keys | c | 5 | -1.66% | -0.00% | -1.13% | 0.46% | 13.81→13.81; 13.81→13.81; 13.81→13.81 | none |
| str-map-keys | llvm | 1 | -1.49% | -0.00% | -1.39% | 2.69% | 16.44→16.44; 16.44→16.44; 16.44→16.44 | none |
| str-map-keys | llvm | 2 | 0.17% | 0.00% | -0.58% | 3.71% | 13.26→13.26; 13.26→13.26; 13.26→13.26 | none |
| str-map-keys | llvm | 3 | 3.16% | 0.00% | 3.00% | 0.12% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| str-map-keys | llvm | 4 | -2.18% | -0.00% | -1.58% | 2.48% | 18.63→18.63; 18.63→18.63; 18.63→18.63 | none |
| str-map-keys | llvm | 5 | 1.81% | 0.00% | 1.99% | 1.89% | 13.81→13.81; 13.81→13.81; 13.81→13.81 | none |
| symbol-keyed-map | c | 1 | -34.42% | -10.57% | -33.94% | 1.75% | 16.44→16.44; 16.44→16.44; 16.44→16.44 | none |
| symbol-keyed-map | c | 2 | -9.70% | 21.22% | -9.68% | 0.39% | 13.26→13.26; 13.26→13.26; 13.26→13.26 | none |
| symbol-keyed-map | c | 3 | -30.59% | -12.41% | -30.00% | 5.57% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| symbol-keyed-map | c | 4 | -22.47% | 3.34% | -22.70% | 5.95% | 18.63→18.63; 18.63→18.63; 18.63→18.63 | none |
| symbol-keyed-map | c | 5 | -29.63% | -5.52% | -30.42% | 4.93% | 13.81→13.81; 13.81→13.81; 13.81→13.81 | none |
| symbol-keyed-map | llvm | 1 | -25.25% | -12.90% | -25.81% | 0.98% | 16.44→16.44; 16.44→16.44; 16.44→16.44 | none |
| symbol-keyed-map | llvm | 2 | -28.36% | -21.98% | -29.04% | 14.31% | 13.26→13.26; 13.26→13.26; 13.26→13.26 | none |
| symbol-keyed-map | llvm | 3 | -22.79% | -9.56% | -23.59% | 0.31% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| symbol-keyed-map | llvm | 4 | -18.30% | -5.78% | -18.63% | 2.23% | 18.63→18.63; 18.63→18.63; 18.63→18.63 | none |
| symbol-keyed-map | llvm | 5 | -26.32% | -19.16% | -26.66% | 3.57% | 13.81→13.81; 13.81→13.81; 13.81→13.81 | none |
| map-and-set | c | 1 | 0.08% | -0.00% | 0.08% | 0.92% | 16.44→16.44; 16.44→16.44; 16.44→16.44 | none |
| map-and-set | c | 2 | 1.23% | 0.00% | 1.15% | 1.15% | 13.26→13.26; 13.26→13.26; 13.26→13.26 | none |
| map-and-set | c | 3 | 0.07% | 0.00% | -0.16% | 0.94% | 26.97→26.97; 26.97→26.97; 26.97→26.97 | none |
| map-and-set | c | 4 | -1.71% | -0.00% | -0.79% | 3.57% | 18.63→18.63; 18.63→18.63; 18.63→18.63 | none |
| map-and-set | c | 5 | -1.89% | 0.00% | -2.09% | 0.85% | 13.81→13.81; 13.81→13.81; 13.81→13.81 | none |
| map-and-set | llvm | 1 | -1.54% | 0.00% | -1.31% | 0.68% | 16.44→16.44; 16.44→16.44; 16.44→16.44 | none |
| map-and-set | llvm | 2 | -2.82% | -0.00% | -2.86% | 0.49% | 13.26→13.26; 13.26→13.26; 13.26→13.26 | none |
| map-and-set | llvm | 3 | 0.17% | 0.00% | -0.21% | 0.09% | 25.69→25.69; 25.69→25.69; 25.69→25.69 | none |
| map-and-set | llvm | 4 | -2.38% | 0.00% | -1.44% | 0.10% | 18.63→18.63; 18.63→18.63; 18.63→18.63 | none |
| map-and-set | llvm | 5 | -1.94% | -0.00% | -2.44% | 3.65% | 13.81→13.81; 13.81→13.81; 13.81→13.81 | none |
| map-entries-top-k | c | 1 | 0.14% | -0.00% | 0.07% | 1.41% | 16.00→16.00; 16.00→16.00; 16.00→16.00 | none |
| map-entries-top-k | c | 2 | -0.79% | -0.00% | -0.38% | 0.71% | 13.26→13.26; 13.26→15.24; 15.24→15.24 | none |
| map-entries-top-k | c | 3 | 0.28% | -0.00% | 1.08% | 3.11% | 25.69→25.69; 25.69→25.69; 25.69→25.69 | none |
| map-entries-top-k | c | 4 | 0.27% | 0.00% | 0.16% | 0.30% | 17.70→17.70; 17.70→17.70; 17.70→17.70 | none |
| map-entries-top-k | c | 5 | 1.89% | 0.00% | 1.03% | 0.86% | 13.35→13.35; 13.35→13.35; 13.35→13.35 | none |
| map-entries-top-k | llvm | 1 | -0.67% | 0.00% | -0.70% | 0.21% | 16.00→16.00; 16.00→16.00; 16.00→16.00 | none |
| map-entries-top-k | llvm | 2 | -1.47% | 0.00% | -1.55% | 2.60% | 15.24→15.24; 15.24→15.24; 15.24→15.24 | none |
| map-entries-top-k | llvm | 3 | -1.50% | 0.00% | -0.59% | 0.24% | 25.69→25.69; 25.69→25.69; 25.69→25.69 | none |
| map-entries-top-k | llvm | 4 | -0.06% | 0.00% | 0.14% | 0.32% | 17.70→17.70; 17.70→17.70; 17.70→17.70 | none |
| map-entries-top-k | llvm | 5 | 1.12% | 0.00% | 0.99% | 0.47% | 13.35→13.35; 13.35→13.35; 13.35→13.35 | none |
| checksum | c | 1 | 0.05% | -0.00% | -0.00% | 0.67% | 16.00→16.00; 16.00→16.00; 16.00→16.00 | none |
| checksum | c | 2 | -0.05% | -0.00% | -0.00% | 0.42% | 15.24→15.24; 15.24→15.24; 15.24→15.24 | none |
| checksum | c | 3 | -0.25% | -0.00% | -0.01% | 0.37% | 25.69→25.69; 25.69→25.69; 25.69→25.69 | none |
| checksum | c | 4 | 0.69% | 0.00% | 0.00% | 0.17% | 17.70→17.70; 17.70→17.70; 17.70→17.70 | none |
| checksum | c | 5 | -0.02% | -0.00% | -0.00% | 0.19% | 13.35→13.35; 13.35→13.35; 13.35→13.35 | none |
| checksum | llvm | 1 | 1.05% | 0.00% | 0.00% | 0.47% | 16.00→16.00; 16.00→16.00; 16.00→16.00 | none |
| checksum | llvm | 2 | 0.38% | 0.00% | -0.00% | 0.99% | 15.24→15.24; 15.24→15.24; 15.24→15.24 | none |
| checksum | llvm | 3 | 0.09% | -0.00% | -0.00% | 1.46% | 25.69→25.69; 25.69→25.69; 25.69→25.69 | none |
| checksum | llvm | 4 | -0.65% | -0.00% | -0.01% | 1.07% | 17.70→17.70; 17.70→17.70; 17.70→17.70 | none |
| checksum | llvm | 5 | -0.65% | 0.00% | -0.00% | 0.32% | 13.35→13.35; 13.35→13.35; 13.35→13.35 | none |
| accumulate | c | 1 | -1.83% | -0.00% | 0.01% | 1.19% | 16.00→16.00; 16.00→16.00; 16.00→16.00 | none |
| accumulate | c | 2 | -0.24% | -0.00% | -0.10% | 0.04% | 15.63→15.63; 15.63→15.63; 15.63→15.63 | none |
| accumulate | c | 3 | 3.62% | 0.00% | 0.01% | 0.18% | 25.69→25.69; 25.69→23.87; 23.87→23.87 | none |
| accumulate | c | 4 | 1.47% | -0.00% | 0.00% | 0.32% | 16.76→16.76; 16.76→16.76; 16.76→16.76 | none |
| accumulate | c | 5 | 0.58% | 0.00% | 0.17% | 0.36% | 13.35→13.35; 13.35→13.35; 13.35→13.35 | none |
| accumulate | llvm | 1 | -1.30% | 0.00% | -0.10% | 0.64% | 16.00→16.00; 16.00→16.00; 16.00→16.00 | none |
| accumulate | llvm | 2 | -0.31% | -0.00% | -0.09% | 0.20% | 15.63→15.63; 15.63→15.63; 15.63→15.63 | none |
| accumulate | llvm | 3 | 0.03% | 0.00% | 0.07% | 0.24% | 23.87→23.87; 23.87→23.87; 23.87→23.87 | none |
| accumulate | llvm | 4 | 1.75% | 0.00% | 0.30% | 0.69% | 16.76→16.76; 16.76→16.76; 16.76→16.76 | none |
| accumulate | llvm | 5 | -0.05% | 0.00% | -0.03% | 1.04% | 13.35→13.35; 13.35→13.35; 13.35→13.35 | none |
| case-convert | c | 1 | 0.19% | -0.00% | -0.02% | 0.39% | 15.28→15.28; 15.28→15.28; 15.28→15.28 | none |
| case-convert | c | 2 | -1.01% | -0.00% | -0.06% | 0.22% | 15.63→15.63; 15.63→15.63; 15.63→15.63 | none |
| case-convert | c | 3 | 0.35% | -0.00% | -0.06% | 0.95% | 23.87→23.87; 23.87→23.87; 23.87→23.87 | none |
| case-convert | c | 4 | -0.87% | -0.00% | -0.63% | 1.10% | 16.76→16.76; 16.76→16.76; 16.76→16.76 | none |
| case-convert | c | 5 | -0.67% | -0.00% | -0.38% | 0.20% | 13.96→13.96; 13.96→13.96; 13.96→13.96 | none |
| case-convert | llvm | 1 | -0.78% | 0.00% | 0.32% | 0.95% | 15.28→15.28; 15.28→15.28; 15.28→15.28 | none |
| case-convert | llvm | 2 | 0.07% | 0.00% | 0.20% | 1.21% | 15.63→15.63; 15.63→15.63; 15.63→15.63 | none |
| case-convert | llvm | 3 | 0.82% | 0.00% | 0.15% | 0.05% | 23.87→23.87; 23.87→23.87; 23.87→23.87 | none |
| case-convert | llvm | 4 | -0.47% | -0.00% | 0.05% | 0.48% | 16.76→16.76; 16.76→16.76; 16.76→16.76 | none |
| case-convert | llvm | 5 | -0.63% | -0.00% | 0.07% | 1.42% | 13.96→13.96; 13.96→13.96; 13.96→13.96 | none |
| json-parse | c | 1 | 0.40% | 0.00% | -0.38% | 0.04% | 15.28→15.28; 15.28→15.28; 15.28→15.28 | none |
| json-parse | c | 2 | 1.05% | 0.00% | 0.54% | 0.80% | 15.63→15.63; 15.63→15.63; 15.63→15.63 | none |
| json-parse | c | 3 | -0.38% | 0.00% | -0.11% | 0.99% | 23.87→23.87; 23.87→23.87; 23.87→23.87 | none |
| json-parse | c | 4 | 0.25% | -0.00% | 0.20% | 0.47% | 16.76→16.76; 16.76→16.76; 16.76→16.76 | none |
| json-parse | c | 5 | -0.77% | -0.00% | -0.10% | 0.23% | 13.96→13.96; 13.96→13.96; 13.96→13.96 | none |
| json-parse | llvm | 1 | 0.35% | -0.00% | -0.05% | 0.39% | 15.28→15.28; 15.28→15.28; 15.28→15.28 | none |
| json-parse | llvm | 2 | 0.30% | 0.00% | -0.23% | 0.84% | 15.63→15.63; 15.63→15.63; 15.63→15.63 | none |
| json-parse | llvm | 3 | -2.43% | -0.00% | 0.17% | 4.21% | 23.87→23.87; 23.87→23.87; 23.87→22.20 | none |
| json-parse | llvm | 4 | 0.08% | -0.00% | 0.20% | 1.99% | 16.76→16.76; 16.76→16.76; 16.76→16.76 | none |
| json-parse | llvm | 5 | -1.09% | -0.00% | -0.27% | 0.54% | 13.96→13.96; 13.96→13.96; 13.96→13.96 | none |
| json-build-append | c | 1 | 1.12% | 0.00% | 0.20% | 1.91% | 14.62→14.62; 14.62→14.62; 14.62→14.62 | none |
| json-build-append | c | 2 | -0.15% | 0.00% | 0.07% | 0.30% | 15.33→15.33; 15.33→15.33; 15.33→15.33 | none |
| json-build-append | c | 3 | -1.36% | 0.00% | -0.29% | 2.22% | 22.20→22.20; 22.20→22.20; 22.20→22.20 | none |
| json-build-append | c | 4 | 0.57% | -0.00% | 0.44% | 0.98% | 15.90→15.90; 15.90→15.90; 15.90→15.90 | none |
| json-build-append | c | 5 | -0.66% | -0.00% | -0.27% | 1.02% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| json-build-append | llvm | 1 | -0.07% | 0.00% | -0.29% | 0.64% | 14.62→14.62; 14.62→14.62; 14.62→14.62 | none |
| json-build-append | llvm | 2 | 0.31% | 0.00% | -0.11% | 0.36% | 15.33→15.33; 15.33→15.33; 15.33→15.33 | none |
| json-build-append | llvm | 3 | 0.69% | 0.00% | 0.29% | 0.23% | 22.20→22.20; 22.20→22.20; 22.20→22.20 | none |
| json-build-append | llvm | 4 | -0.10% | -0.00% | -0.15% | 0.93% | 15.90→15.90; 15.90→15.90; 15.90→15.90 | none |
| json-build-append | llvm | 5 | -0.62% | -0.00% | -0.11% | 1.68% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| json-build-join | c | 1 | -0.32% | 0.00% | 0.05% | 2.82% | 14.62→14.62; 14.62→14.62; 14.62→14.62 | none |
| json-build-join | c | 2 | -3.15% | -0.00% | -3.64% | 6.01% | 15.33→15.33; 15.33→15.33; 15.33→15.33 | none |
| json-build-join | c | 3 | -0.50% | -0.00% | -0.31% | 0.98% | 22.20→22.20; 22.20→22.20; 22.20→22.20 | none |
| json-build-join | c | 4 | 3.04% | 0.00% | 0.52% | 1.03% | 15.90→15.90; 15.90→15.90; 15.90→15.90 | none |
| json-build-join | c | 5 | -2.05% | -0.00% | -0.80% | 2.02% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| json-build-join | llvm | 1 | 0.08% | 0.00% | -0.55% | 0.85% | 14.62→14.62; 14.62→14.62; 14.62→14.62 | none |
| json-build-join | llvm | 2 | -7.17% | -0.00% | -7.32% | 0.70% | 15.33→15.33; 15.33→15.33; 15.33→15.33 | none |
| json-build-join | llvm | 3 | 2.65% | -0.00% | -0.70% | 1.22% | 22.20→22.20; 22.20→22.20; 22.20→22.20 | none |
| json-build-join | llvm | 4 | 0.63% | -0.00% | 0.12% | 0.53% | 15.90→15.90; 15.90→15.90; 15.90→15.90 | none |
| json-build-join | llvm | 5 | -1.27% | -0.00% | -0.21% | 0.62% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-bounce | c | 1 | 0.79% | -0.00% | 0.29% | 0.19% | 14.62→14.62; 14.62→14.62; 14.62→14.62 | none |
| awfy-bounce | c | 2 | -2.68% | -0.00% | -0.64% | 1.49% | 15.33→15.33; 15.33→15.33; 15.33→15.33 | none |
| awfy-bounce | c | 3 | 9.08% | 0.00% | -0.55% | 0.84% | 22.20→22.20; 22.20→22.20; 22.20→22.20 | none |
| awfy-bounce | c | 4 | -0.45% | 0.00% | -0.95% | 3.50% | 15.90→15.90; 15.90→15.90; 15.90→15.90 | none |
| awfy-bounce | c | 5 | 0.12% | -0.00% | 0.44% | 0.08% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-bounce | llvm | 1 | 1.03% | 0.00% | 0.16% | 1.69% | 14.62→14.62; 14.62→14.62; 14.62→14.62 | none |
| awfy-bounce | llvm | 2 | 0.98% | 0.00% | 0.41% | 0.90% | 15.33→15.33; 15.33→15.33; 15.33→15.33 | none |
| awfy-bounce | llvm | 3 | 0.24% | 0.00% | -0.33% | 0.21% | 22.20→22.20; 22.20→22.20; 22.20→22.20 | none |
| awfy-bounce | llvm | 4 | -0.79% | 0.00% | -0.03% | 0.42% | 15.90→15.90; 15.90→15.90; 15.90→15.90 | none |
| awfy-bounce | llvm | 5 | 0.88% | -0.00% | 0.29% | 0.60% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-list | c | 1 | 1.24% | 0.00% | 0.41% | 1.29% | 14.25→14.25; 14.25→14.25; 14.25→14.25 | none |
| awfy-list | c | 2 | -0.30% | -0.00% | -0.13% | 0.82% | 15.87→15.87; 15.87→15.87; 15.87→15.87 | none |
| awfy-list | c | 3 | -1.66% | -0.00% | -0.62% | 2.52% | 20.66→20.66; 20.66→20.66; 20.66→20.66 | none |
| awfy-list | c | 4 | -0.60% | 0.00% | 0.54% | 3.18% | 15.19→15.19; 15.19→15.19; 15.19→15.19 | none |
| awfy-list | c | 5 | -0.76% | 0.00% | -0.75% | 2.67% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-list | llvm | 1 | -0.04% | 0.00% | 0.22% | 0.05% | 14.25→14.25; 14.25→14.25; 14.25→14.25 | none |
| awfy-list | llvm | 2 | -0.12% | -0.00% | -0.48% | 0.14% | 15.87→15.87; 15.87→15.87; 15.87→15.87 | none |
| awfy-list | llvm | 3 | 0.76% | 0.00% | 0.63% | 0.40% | 20.66→20.66; 20.66→20.66; 20.66→20.66 | none |
| awfy-list | llvm | 4 | 2.79% | -0.00% | -0.06% | 2.79% | 15.19→15.19; 15.19→15.19; 15.19→15.19 | none |
| awfy-list | llvm | 5 | -0.02% | -0.00% | -1.40% | 4.13% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-mandelbrot | c | 1 | 0.30% | -0.00% | -0.07% | 1.34% | 14.25→14.25; 14.25→14.25; 14.25→14.25 | none |
| awfy-mandelbrot | c | 2 | 0.26% | 0.00% | -0.10% | 0.59% | 15.87→15.87; 15.87→15.87; 15.87→15.87 | none |
| awfy-mandelbrot | c | 3 | -1.69% | -0.00% | -0.01% | 5.35% | 20.66→20.66; 20.66→20.66; 20.66→20.66 | none |
| awfy-mandelbrot | c | 4 | -0.14% | 0.00% | -0.01% | 0.26% | 15.19→15.19; 15.19→15.19; 15.19→15.19 | none |
| awfy-mandelbrot | c | 5 | -2.09% | -0.00% | -0.08% | 1.82% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-mandelbrot | llvm | 1 | -1.18% | 0.00% | -0.00% | 2.39% | 14.25→14.25; 14.25→14.25; 14.25→14.25 | none |
| awfy-mandelbrot | llvm | 2 | 0.04% | 0.00% | -0.00% | 0.12% | 15.87→15.87; 15.87→15.87; 15.87→15.87 | none |
| awfy-mandelbrot | llvm | 3 | 3.34% | 0.00% | -0.03% | 2.30% | 20.66→20.66; 20.66→20.66; 20.66→20.66 | none |
| awfy-mandelbrot | llvm | 4 | 2.87% | -0.00% | -0.28% | 2.17% | 15.19→15.19; 15.19→15.19; 15.19→15.19 | none |
| awfy-mandelbrot | llvm | 5 | 1.52% | 0.00% | -0.04% | 2.04% | 14.04→14.04; 14.04→14.04; 14.04→14.04 | none |
| awfy-nbody | c | 1 | 0.65% | -0.00% | -0.04% | 0.20% | 13.91→13.91; 13.91→13.91; 13.91→13.91 | none |
| awfy-nbody | c | 2 | 0.87% | -0.00% | -0.01% | 0.03% | 15.87→15.87; 15.87→15.87; 15.87→15.40 | none |
| awfy-nbody | c | 3 | 0.71% | -0.00% | -0.01% | 1.21% | 19.97→19.97; 19.97→19.97; 19.97→19.97 | none |
| awfy-nbody | c | 4 | -0.07% | 0.00% | -0.02% | 0.06% | 15.19→15.19; 15.19→15.19; 15.19→15.19 | none |
| awfy-nbody | c | 5 | -0.05% | 0.00% | 0.07% | 0.26% | 13.39→13.39; 13.39→13.39; 13.39→13.39 | none |
| awfy-nbody | llvm | 1 | -1.13% | 0.00% | -0.03% | 0.63% | 13.91→13.91; 13.91→13.91; 13.91→13.91 | none |
| awfy-nbody | llvm | 2 | -0.71% | -0.00% | -0.06% | 1.51% | 15.40→15.40; 15.40→15.40; 15.40→15.40 | none |
| awfy-nbody | llvm | 3 | 0.40% | 0.00% | -0.01% | 2.21% | 19.97→19.97; 19.97→19.97; 19.97→19.97 | none |
| awfy-nbody | llvm | 4 | 0.57% | -0.00% | -0.00% | 0.53% | 15.19→15.19; 15.19→14.61; 14.61→14.61 | none |
| awfy-nbody | llvm | 5 | -0.16% | -0.00% | -0.05% | 0.32% | 13.39→13.39; 13.39→13.39; 13.39→13.39 | none |
| awfy-permute | c | 1 | -1.20% | 0.00% | 0.06% | 0.61% | 13.91→13.91; 13.91→13.91; 13.91→13.91 | none |
| awfy-permute | c | 2 | 0.46% | 0.00% | -0.24% | 0.05% | 15.40→15.40; 15.40→15.40; 15.40→15.40 | none |
| awfy-permute | c | 3 | -5.25% | -0.00% | -5.43% | 11.45% | 19.97→19.97; 19.97→19.97; 19.97→19.97 | none |
| awfy-permute | c | 4 | -0.85% | -0.00% | -0.62% | 0.24% | 14.61→14.61; 14.61→14.61; 14.61→14.61 | none |
| awfy-permute | c | 5 | -1.76% | -0.00% | 0.20% | 2.20% | 13.39→13.39; 13.39→13.39; 13.39→13.39 | none |
| awfy-permute | llvm | 1 | 0.45% | 0.00% | -0.27% | 1.67% | 13.91→13.91; 13.91→13.91; 13.91→13.91 | none |
| awfy-permute | llvm | 2 | -0.02% | -0.00% | -0.39% | 0.40% | 15.40→15.40; 15.40→15.40; 15.40→15.40 | none |
| awfy-permute | llvm | 3 | 0.61% | 0.00% | 0.55% | 1.17% | 19.97→19.97; 19.97→19.97; 19.97→19.97 | none |
| awfy-permute | llvm | 4 | -0.29% | -0.00% | -0.39% | 0.13% | 14.61→14.61; 14.61→14.61; 14.61→14.61 | none |
| awfy-permute | llvm | 5 | -0.63% | -0.00% | -0.20% | 1.32% | 13.39→13.39; 13.39→13.39; 13.39→13.39 | none |
| awfy-queens | c | 1 | -0.28% | -0.00% | 0.05% | 1.52% | 13.91→13.91; 13.91→13.91; 13.91→13.91 | none |
| awfy-queens | c | 2 | -0.32% | 0.00% | 0.10% | 1.99% | 15.40→15.40; 15.40→15.40; 15.40→15.40 | none |
| awfy-queens | c | 3 | 1.06% | -0.00% | 0.65% | 0.33% | 19.97→19.97; 19.97→19.97; 19.97→19.97 | none |
| awfy-queens | c | 4 | 0.45% | 0.00% | 0.11% | 0.17% | 14.61→14.61; 14.61→14.61; 14.61→14.61 | none |
| awfy-queens | c | 5 | -0.59% | 0.00% | 0.03% | 2.00% | 13.39→13.39; 13.39→13.39; 13.39→13.39 | none |
| awfy-queens | llvm | 1 | -1.45% | -0.00% | -0.30% | 1.20% | 13.91→13.91; 13.91→13.91; 13.91→13.91 | none |
| awfy-queens | llvm | 2 | 0.55% | 0.00% | 0.13% | 1.37% | 15.40→15.40; 15.40→15.40; 15.40→15.13 | none |
| awfy-queens | llvm | 3 | 0.77% | -0.00% | -0.38% | 0.65% | 19.97→21.01; 21.01→21.01; 21.01→21.01 | none |
| awfy-queens | llvm | 4 | -0.09% | 0.00% | -0.03% | 0.11% | 14.61→14.61; 14.61→14.61; 14.61→14.61 | none |
| awfy-queens | llvm | 5 | -0.17% | -0.00% | -0.22% | 0.03% | 13.39→12.80; 12.80→12.80; 12.80→12.80 | none |
| awfy-sieve | c | 1 | -1.78% | -0.00% | 0.09% | 1.61% | 13.68→13.68; 13.68→13.68; 13.68→13.68 | none |
| awfy-sieve | c | 2 | -0.19% | 0.00% | 0.19% | 1.74% | 15.13→15.13; 15.13→15.13; 15.13→15.13 | none |
| awfy-sieve | c | 3 | -0.19% | -0.00% | -0.24% | 2.56% | 21.01→21.01; 21.01→21.01; 21.01→21.01 | none |
| awfy-sieve | c | 4 | -0.39% | -0.00% | -0.01% | 0.63% | 14.08→14.08; 14.08→14.08; 14.08→14.08 | none |
| awfy-sieve | c | 5 | 0.18% | -0.00% | 0.19% | 0.65% | 12.80→12.80; 12.80→12.80; 12.80→12.80 | none |
| awfy-sieve | llvm | 1 | -0.67% | -0.00% | -1.71% | 1.46% | 13.68→13.68; 13.68→13.68; 13.68→13.68 | none |
| awfy-sieve | llvm | 2 | 0.18% | 0.00% | 0.14% | 0.02% | 15.13→15.13; 15.13→15.13; 15.13→15.13 | none |
| awfy-sieve | llvm | 3 | -1.02% | 0.00% | -1.72% | 0.32% | 21.01→21.01; 21.01→21.01; 21.01→21.01 | none |
| awfy-sieve | llvm | 4 | 1.89% | 0.00% | 1.76% | 0.95% | 14.08→14.08; 14.08→14.08; 14.08→14.08 | none |
| awfy-sieve | llvm | 5 | 0.37% | 0.00% | -0.47% | 3.23% | 12.80→12.80; 12.80→12.80; 12.80→12.80 | none |
| awfy-towers | c | 1 | 0.74% | -0.00% | 0.12% | 0.41% | 13.68→13.68; 13.68→13.68; 13.68→13.68 | none |
| awfy-towers | c | 2 | 0.56% | 0.00% | -0.42% | 1.91% | 15.13→15.13; 15.13→15.13; 15.13→15.13 | none |
| awfy-towers | c | 3 | -1.19% | -0.00% | -0.02% | 1.05% | 21.01→21.01; 21.01→21.01; 21.01→21.01 | none |
| awfy-towers | c | 4 | 0.48% | 0.00% | 0.74% | 1.36% | 14.08→14.08; 14.08→14.08; 14.08→14.08 | none |
| awfy-towers | c | 5 | 0.24% | -0.00% | 0.41% | 0.91% | 12.80→12.80; 12.80→12.80; 12.80→12.80 | none |
| awfy-towers | llvm | 1 | 1.40% | 0.00% | 0.05% | 1.60% | 13.68→13.68; 13.68→13.68; 13.68→13.68 | none |
| awfy-towers | llvm | 2 | -0.28% | -0.00% | -0.03% | 1.76% | 15.13→15.13; 15.13→15.13; 15.13→15.13 | none |
| awfy-towers | llvm | 3 | -1.28% | -0.00% | 0.05% | 1.92% | 21.01→21.01; 21.01→21.01; 21.01→21.01 | none |
| awfy-towers | llvm | 4 | -0.78% | -0.00% | -0.72% | 1.06% | 14.08→14.08; 14.08→14.08; 14.08→14.08 | none |
| awfy-towers | llvm | 5 | -0.36% | 0.00% | 0.01% | 0.90% | 12.80→12.80; 12.80→12.80; 12.80→12.80 | none |

## Linked size

Descriptor bytes sum the linked nts_desc_* symbols; absent functions were inlined or eliminated. Every size is from the same binary measured above.

| Row | Backend | Arm | .text B | Descriptors B | Descriptor symbols | nts_release B | nts_value_release B |
|---|---|---|---:|---:|---:|---:|---:|
| array-copying-methods | c | base | 39680 | 520 | 5 | 81 | absent/inlined |
| array-copying-methods | llvm | base | 39488 | 520 | 5 | 81 | absent/inlined |
| map-literal-keys | c | base | 57248 | 520 | 5 | 81 | 120 |
| map-literal-keys | llvm | base | 57408 | 520 | 5 | 81 | 120 |
| map-word-counts | c | base | 83616 | 520 | 5 | 81 | 120 |
| map-word-counts | llvm | base | 82880 | 520 | 5 | 81 | 120 |
| record-word-counts | c | base | 84064 | 520 | 5 | 81 | 120 |
| record-word-counts | llvm | base | 83872 | 520 | 5 | 81 | 120 |
| str-map-keys | c | base | 92224 | 520 | 5 | 81 | 120 |
| str-map-keys | llvm | base | 92384 | 520 | 5 | 81 | 120 |
| symbol-keyed-map | c | base | 45248 | 416 | 4 | 81 | absent/inlined |
| symbol-keyed-map | llvm | base | 45568 | 416 | 4 | 81 | absent/inlined |
| map-and-set | c | base | 55104 | 312 | 3 | 81 | 120 |
| map-and-set | llvm | base | 54912 | 312 | 3 | 81 | 120 |
| map-entries-top-k | c | base | 82240 | 728 | 7 | 81 | 120 |
| map-entries-top-k | llvm | base | 81984 | 728 | 7 | 81 | 120 |
| checksum | c | base | 7760 | 0 | 0 | absent/inlined | absent/inlined |
| checksum | llvm | base | 7920 | 0 | 0 | absent/inlined | absent/inlined |
| accumulate | c | base | 9984 | 0 | 0 | absent/inlined | absent/inlined |
| accumulate | llvm | base | 8016 | 0 | 0 | absent/inlined | absent/inlined |
| case-convert | c | base | 42202 | 416 | 4 | 81 | absent/inlined |
| case-convert | llvm | base | 42330 | 416 | 4 | 81 | absent/inlined |
| json-parse | c | base | 124992 | 1248 | 12 | 81 | 120 |
| json-parse | llvm | base | 125920 | 1248 | 12 | 81 | 120 |
| json-build-append | c | base | 47696 | 416 | 4 | 81 | absent/inlined |
| json-build-append | llvm | base | 47888 | 416 | 4 | 81 | absent/inlined |
| json-build-join | c | base | 45056 | 416 | 4 | 81 | absent/inlined |
| json-build-join | llvm | base | 45216 | 416 | 4 | 81 | absent/inlined |
| awfy-bounce | c | base | 27792 | 624 | 6 | 81 | absent/inlined |
| awfy-bounce | llvm | base | 27792 | 624 | 6 | 81 | absent/inlined |
| awfy-list | c | base | 23712 | 624 | 6 | 81 | absent/inlined |
| awfy-list | llvm | base | 23680 | 624 | 6 | 81 | absent/inlined |
| awfy-mandelbrot | c | base | 8160 | 0 | 0 | absent/inlined | absent/inlined |
| awfy-mandelbrot | llvm | base | 7840 | 0 | 0 | absent/inlined | absent/inlined |
| awfy-nbody | c | base | 29104 | 624 | 6 | 81 | absent/inlined |
| awfy-nbody | llvm | base | 29168 | 624 | 6 | 81 | absent/inlined |
| awfy-permute | c | base | 28944 | 520 | 5 | 81 | absent/inlined |
| awfy-permute | llvm | base | 28880 | 520 | 5 | 81 | absent/inlined |
| awfy-queens | c | base | 36064 | 728 | 7 | 81 | absent/inlined |
| awfy-queens | llvm | base | 36000 | 728 | 7 | 81 | absent/inlined |
| awfy-sieve | c | base | 27696 | 520 | 5 | 81 | absent/inlined |
| awfy-sieve | llvm | base | 27568 | 520 | 5 | 81 | absent/inlined |
| awfy-towers | c | base | 32256 | 728 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | base | 32224 | 728 | 7 | 81 | absent/inlined |
| array-copying-methods | c | integers | 39680 | 520 | 5 | 81 | absent/inlined |
| array-copying-methods | llvm | integers | 39488 | 520 | 5 | 81 | absent/inlined |
| map-literal-keys | c | integers | 56704 | 520 | 5 | 81 | 120 |
| map-literal-keys | llvm | integers | 56800 | 520 | 5 | 81 | 120 |
| map-word-counts | c | integers | 83616 | 520 | 5 | 81 | 120 |
| map-word-counts | llvm | integers | 82880 | 520 | 5 | 81 | 120 |
| record-word-counts | c | integers | 84064 | 520 | 5 | 81 | 120 |
| record-word-counts | llvm | integers | 83872 | 520 | 5 | 81 | 120 |
| str-map-keys | c | integers | 92224 | 520 | 5 | 81 | 120 |
| str-map-keys | llvm | integers | 92384 | 520 | 5 | 81 | 120 |
| symbol-keyed-map | c | integers | 44512 | 416 | 4 | 81 | absent/inlined |
| symbol-keyed-map | llvm | integers | 44832 | 416 | 4 | 81 | absent/inlined |
| map-and-set | c | integers | 55104 | 312 | 3 | 81 | 120 |
| map-and-set | llvm | integers | 54912 | 312 | 3 | 81 | 120 |
| map-entries-top-k | c | integers | 82240 | 728 | 7 | 81 | 120 |
| map-entries-top-k | llvm | integers | 81984 | 728 | 7 | 81 | 120 |
| checksum | c | integers | 7760 | 0 | 0 | absent/inlined | absent/inlined |
| checksum | llvm | integers | 7920 | 0 | 0 | absent/inlined | absent/inlined |
| accumulate | c | integers | 9984 | 0 | 0 | absent/inlined | absent/inlined |
| accumulate | llvm | integers | 8016 | 0 | 0 | absent/inlined | absent/inlined |
| case-convert | c | integers | 42202 | 416 | 4 | 81 | absent/inlined |
| case-convert | llvm | integers | 42330 | 416 | 4 | 81 | absent/inlined |
| json-parse | c | integers | 124992 | 1248 | 12 | 81 | 120 |
| json-parse | llvm | integers | 125920 | 1248 | 12 | 81 | 120 |
| json-build-append | c | integers | 47696 | 416 | 4 | 81 | absent/inlined |
| json-build-append | llvm | integers | 47888 | 416 | 4 | 81 | absent/inlined |
| json-build-join | c | integers | 45056 | 416 | 4 | 81 | absent/inlined |
| json-build-join | llvm | integers | 45216 | 416 | 4 | 81 | absent/inlined |
| awfy-bounce | c | integers | 27792 | 624 | 6 | 81 | absent/inlined |
| awfy-bounce | llvm | integers | 27792 | 624 | 6 | 81 | absent/inlined |
| awfy-list | c | integers | 23712 | 624 | 6 | 81 | absent/inlined |
| awfy-list | llvm | integers | 23680 | 624 | 6 | 81 | absent/inlined |
| awfy-mandelbrot | c | integers | 8160 | 0 | 0 | absent/inlined | absent/inlined |
| awfy-mandelbrot | llvm | integers | 7840 | 0 | 0 | absent/inlined | absent/inlined |
| awfy-nbody | c | integers | 29104 | 624 | 6 | 81 | absent/inlined |
| awfy-nbody | llvm | integers | 29168 | 624 | 6 | 81 | absent/inlined |
| awfy-permute | c | integers | 28944 | 520 | 5 | 81 | absent/inlined |
| awfy-permute | llvm | integers | 28880 | 520 | 5 | 81 | absent/inlined |
| awfy-queens | c | integers | 36064 | 728 | 7 | 81 | absent/inlined |
| awfy-queens | llvm | integers | 36000 | 728 | 7 | 81 | absent/inlined |
| awfy-sieve | c | integers | 27696 | 520 | 5 | 81 | absent/inlined |
| awfy-sieve | llvm | integers | 27568 | 520 | 5 | 81 | absent/inlined |
| awfy-towers | c | integers | 32256 | 728 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | integers | 32224 | 728 | 7 | 81 | absent/inlined |

Wall, cycle and instruction deltas are medians of the five paired ratios. Displayed absolute times are separate medians, so dividing those two time columns need not reproduce the paired delta. Native work has N hot calls plus two pre-hot check/warmup calls; host work has the same N hot calls plus one checksum call and its separately reported calibrated warmup. Linked size changes are reported per row.

## Host process spread

| Row | Host | Median µs | Minimum µs | Maximum µs | All five launches, µs |
|---|---|---:|---:|---:|---|
| array-copying-methods | node | 67.753 | 64.972 | 70.379 | 66.903/68.671/70.379/64.972/67.753 |
| array-copying-methods | bun | 52.877 | 48.222 | 56.054 | 52.232/52.877/56.054/48.222/55.210 |
| map-literal-keys | node | 60.431 | 55.201 | 72.218 | 60.431/72.218/61.738/55.201/59.381 |
| map-literal-keys | bun | 13.059 | 12.718 | 13.834 | 13.059/13.100/13.834/12.718/12.852 |
| map-word-counts | node | 8.743 | 8.532 | 9.408 | 9.374/9.408/8.737/8.532/8.743 |
| map-word-counts | bun | 6.021 | 5.967 | 6.391 | 6.021/5.975/6.391/5.967/6.105 |
| record-word-counts | node | 9.235 | 8.763 | 9.852 | 9.235/9.852/9.633/8.763/9.028 |
| record-word-counts | bun | 4.342 | 4.201 | 4.498 | 4.249/4.356/4.498/4.201/4.342 |
| str-map-keys | node | 6.199 | 6.057 | 7.102 | 6.199/6.222/7.102/6.194/6.057 |
| str-map-keys | bun | 6.174 | 5.982 | 6.218 | 5.982/6.209/6.174/6.053/6.218 |
| symbol-keyed-map | node | 47.407 | 44.000 | 53.380 | 47.407/47.539/46.401/44.000/53.380 |
| symbol-keyed-map | bun | 8.994 | 8.635 | 9.288 | 8.635/8.958/8.994/9.288/9.020 |
| map-and-set | node | 8.254 | 7.887 | 9.310 | 8.254/9.310/8.478/7.962/7.887 |
| map-and-set | bun | 6.647 | 6.119 | 7.750 | 6.119/7.750/6.647/6.261/6.660 |
| map-entries-top-k | node | 28.981 | 27.193 | 36.894 | 28.981/36.894/29.279/27.501/27.193 |
| map-entries-top-k | bun | 22.962 | 21.696 | 23.862 | 22.962/23.862/23.825/21.892/21.696 |
| checksum | node | 6.140 | 6.107 | 6.399 | 6.107/6.399/6.132/6.164/6.140 |
| checksum | bun | 25.166 | 24.570 | 26.697 | 25.166/26.697/24.570/24.621/25.473 |
| accumulate | node | 4.200 | 3.986 | 4.356 | 4.200/4.293/3.986/4.119/4.356 |
| accumulate | bun | 23.843 | 22.406 | 24.387 | 24.089/24.387/22.406/23.107/23.843 |
| case-convert | node | 3.532 | 3.310 | 3.616 | 3.616/3.541/3.310/3.459/3.532 |
| case-convert | bun | 3.898 | 3.497 | 3.983 | 3.898/3.983/3.497/3.733/3.917 |
| json-parse | node | 762.630 | 672.831 | 794.331 | 755.736/794.331/672.831/762.630/791.228 |
| json-parse | bun | 962.997 | 817.331 | 1057.268 | 1057.268/962.997/817.331/935.068/1005.672 |
| json-build-append | node | 16.881 | 15.500 | 17.188 | 17.188/17.090/15.500/16.102/16.881 |
| json-build-append | bun | 7.662 | 7.190 | 8.300 | 8.300/7.433/7.662/7.836/7.190 |
| json-build-join | node | 22.464 | 21.569 | 23.499 | 23.476/23.499/21.569/22.437/22.464 |
| json-build-join | bun | 12.807 | 11.410 | 13.712 | 13.712/12.858/11.410/12.807/12.591 |
| awfy-bounce | node | 14.034 | 13.318 | 14.369 | 14.034/14.115/14.369/13.318/13.418 |
| awfy-bounce | bun | 17.545 | 12.055 | 17.936 | 17.793/17.936/16.175/17.545/12.055 |
| awfy-list | node | 18.043 | 16.851 | 18.556 | 18.548/18.556/16.851/17.859/18.043 |
| awfy-list | bun | 15.391 | 13.491 | 16.069 | 15.020/16.069/15.391/13.491/15.540 |
| awfy-mandelbrot | node | 24587.211 | 23466.184 | 25082.965 | 25082.965/24587.211/23466.184/25032.819/23484.629 |
| awfy-mandelbrot | bun | 24947.679 | 23561.522 | 25085.762 | 25026.189/25085.762/24947.679/23630.940/23561.522 |
| awfy-nbody | node | 89915.368 | 86924.959 | 94055.218 | 90018.070/94055.218/89422.684/89915.368/86924.959 |
| awfy-nbody | bun | 18138.862 | 17053.820 | 18319.916 | 18138.862/18145.016/18319.916/17906.165/17053.820 |
| awfy-permute | node | 24.859 | 23.473 | 25.161 | 25.161/24.859/24.990/24.644/23.473 |
| awfy-permute | bun | 25.707 | 24.307 | 25.863 | 25.770/25.144/25.863/25.707/24.307 |
| awfy-queens | node | 19.309 | 18.484 | 19.701 | 18.854/19.445/19.701/19.309/18.484 |
| awfy-queens | bun | 16.347 | 15.830 | 16.627 | 16.627/16.347/16.592/16.312/15.830 |
| awfy-sieve | node | 11.567 | 11.346 | 11.678 | 11.678/11.567/11.346/11.642/11.400 |
| awfy-sieve | bun | 11.356 | 10.470 | 12.189 | 11.768/12.189/10.833/11.356/10.470 |
| awfy-towers | node | 37.260 | 36.331 | 37.653 | 36.710/37.407/37.653/37.260/36.331 |
| awfy-towers | bun | 30.337 | 28.877 | 30.778 | 30.425/30.778/29.287/30.337/28.877 |

## Unmeasured native controls

- utf8-encode: both emitters on both compiler arms refuse the entry with the same diagnostic: /home/akisarou/Projects/nts-lanes/runtime-content/benchmarks/cases/utf8-encode/case.ts:42:19: NTS1001 a `new` of unrepresentable type (`TextEncoder`) is not supported by this lowering yet. The workload was not changed and no native ratio is claimed.

## Branch work per hot call

| Row | Backend | Median branches A/B | Median branch misses A/B |
|---|---|---:|---:|
| array-copying-methods | c | 103309.1/103309.1 | 362.539/362.877 |
| array-copying-methods | llvm | 105389.1/105389.1 | 285.702/287.317 |
| map-literal-keys | c | 270552.1/229592.1 | 1.113/1.058 |
| map-literal-keys | llvm | 278744.1/205016.1 | 1.123/1.089 |
| map-word-counts | c | 33078.0/33078.0 | 8.265/8.223 |
| map-word-counts | llvm | 32288.0/32288.0 | 8.603/8.183 |
| record-word-counts | c | 33654.0/33654.0 | 14.369/14.315 |
| record-word-counts | llvm | 33759.0/33759.0 | 9.192/8.356 |
| str-map-keys | c | 31434.0/31434.0 | 6.525/6.522 |
| str-map-keys | llvm | 31498.0/31498.0 | 7.472/7.760 |
| symbol-keyed-map | c | 112822.4/98511.0 | 1.713/2.055 |
| symbol-keyed-map | llvm | 132041.2/87239.0 | 2.136/3.039 |
| map-and-set | c | 25202.0/25202.0 | 5.833/6.557 |
| map-and-set | llvm | 25202.0/25202.0 | 6.178/4.728 |
| map-entries-top-k | c | 98585.0/98585.0 | 67.643/74.303 |
| map-entries-top-k | llvm | 98462.0/98462.0 | 74.906/75.076 |
| checksum | c | 522.0/522.0 | 1.003/1.003 |
| checksum | llvm | 522.0/522.0 | 1.002/1.002 |
| accumulate | c | 520.0/520.0 | 1.001/1.001 |
| accumulate | llvm | 522.0/522.0 | 1.001/1.001 |
| case-convert | c | 7965.0/7965.0 | 9.605/9.462 |
| case-convert | llvm | 7964.0/7964.0 | 9.572/9.985 |
| json-parse | c | 5458087.4/5458087.4 | 2783.931/2778.476 |
| json-parse | llvm | 5672957.5/5672957.4 | 2782.284/2801.427 |
| json-build-append | c | 44903.0/44903.0 | 9.346/9.314 |
| json-build-append | llvm | 44903.0/44903.0 | 9.633/9.677 |
| json-build-join | c | 61511.0/61511.0 | 9.746/9.100 |
| json-build-join | llvm | 61511.0/61511.0 | 9.448/9.139 |
| awfy-bounce | c | 37238.0/37238.0 | 7.521/5.840 |
| awfy-bounce | llvm | 37238.0/37238.0 | 7.985/8.158 |
| awfy-list | c | 63221.0/63221.0 | 55.188/53.801 |
| awfy-list | llvm | 63221.0/63221.0 | 48.029/48.239 |
| awfy-mandelbrot | c | 17043799.1/17043798.8 | 101775.694/103240.250 |
| awfy-mandelbrot | llvm | 17043797.8/17043798.0 | 50200.381/49696.250 |
| awfy-nbody | c | 5250259.2/5250259.1 | 27.676/23.500 |
| awfy-nbody | llvm | 7750260.3/7750260.3 | 24.066/20.000 |
| awfy-permute | c | 44774.1/44774.0 | 50.637/50.624 |
| awfy-permute | llvm | 44773.1/44773.1 | 50.346/50.325 |
| awfy-queens | c | 66166.0/66166.0 | 9.558/9.659 |
| awfy-queens | llvm | 66164.0/66164.0 | 9.980/10.197 |
| awfy-sieve | c | 19729.0/19729.0 | 33.731/34.226 |
| awfy-sieve | llvm | 19728.0/19728.0 | 310.734/305.179 |
| awfy-towers | c | 236344.1/236344.1 | 307.690/306.426 |
| awfy-towers | llvm | 228138.1/228138.1 | 306.664/306.620 |

## Comparator versions

| Tool | Executable | Version |
|---|---|---|
| node | /home/akisarou/.asdf/installs/nodejs/24.20.0/bin/node | v24.20.0 |
| bun | /home/akisarou/.bun/bin/bun | 1.4.0 |
| clang | /usr/bin/clang-23 | clang version 23.1.3 |
| clang++ | /usr/bin/clang-23 | clang version 23.1.3 |

Host options: {"NODE_OPTIONS":"--max-old-space-size=8192 --disable-warning=ExperimentalWarning","BUN_OPTIONS":null}. Versions were checked before and after the sitting.
