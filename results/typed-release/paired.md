# Type-specialized release A/B

Node/Bun ratios from the three-process counted run are withheld. Replaying its exact Node launcher reproduced both fast and slow states with the same instructions. External comparisons need at least five launches, the median and the spread. Raw host measurements remain in the saved run.

Base 785f5c161; candidate 9eb11bff1f95b6ca225271d2adfedcee1534422b. Native RC, shipping ThinLTO/x86-64-v3/32-byte loop alignment. CPU 4 under with-lock, sibling 5 admitted quiet at entry; host load and gate activity are recorded per cell. Three process brackets A/B/A per native row, one code layout. Floor is the maximum of three absolute A-repeat changes (nearest-rank P90 of three). Native has two pre-hot calls; host warmup is calibrated separately (at most 20,000 calls/300 ms). Every arm of a row has the same N hot calls; counts and checksums are validated. Counters cover only the acknowledged hot window and must run at least 99% of the time. RSS is the peak of each workload process.

| Row | Backend | Base µs | Typed µs | Wall Δ | Floor | Instructions Δ | Cycles Δ | RSS MiB A/B | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| release-acyclic | c | 116.468 | 92.243 | -20.80% | 6.55% | -29.73% | -20.63% | 4.2/4.0 | improves |
| release-acyclic | llvm | 115.325 | 90.928 | -22.21% | 5.97% | -29.73% | -20.59% | 4.0/4.0 | improves |
| map-entries-top-k | c | 20.380 | 19.613 | -2.85% | 2.45% | -3.22% | -3.04% | 4.1/4.1 | improves |
| map-entries-top-k | llvm | 20.207 | 18.692 | -9.32% | 9.58% | -3.23% | -8.68% | 4.2/4.0 | inside floor |
| awfy-towers | c | 34.841 | 35.139 | 0.33% | 0.58% | -0.12% | -0.01% | 3.7/3.9 | inside floor |
| awfy-towers | llvm | 32.849 | 32.192 | -0.83% | 2.52% | -0.12% | -0.39% | 3.7/3.9 | inside floor |
| sort-objects | c | 148.406 | 149.140 | 0.49% | 1.51% | -0.51% | 0.49% | 4.2/4.0 | inside floor |
| sort-objects | llvm | 122.199 | 114.994 | -3.90% | 7.43% | -0.52% | -3.99% | 4.0/4.0 | inside floor |
| cyclic-churn | c | 111.154 | 105.011 | -5.27% | 2.60% | -5.29% | -4.54% | 4.9/4.9 | improves |
| cyclic-churn | llvm | 113.726 | 106.813 | -6.08% | 3.12% | -5.29% | -6.30% | 4.8/4.9 | improves |
| tree-teardown | c | 27.929 | 28.596 | 0.28% | 8.76% | -0.10% | 0.28% | 4.1/4.1 | inside floor |
| tree-teardown | llvm | 29.635 | 31.372 | 7.24% | 20.23% | -0.10% | 7.41% | 4.1/4.0 | inside floor |
| json-parse | c | 988.778 | 855.907 | -12.40% | 5.32% | -8.75% | -11.23% | 7.6/7.6 | improves |
| json-parse | llvm | 1005.836 | 910.944 | -10.62% | 2.77% | -8.62% | -11.12% | 7.8/7.6 | improves |
| json-build-append | c | 7.793 | 7.694 | -1.63% | 0.56% | 0.00% | -1.75% | 4.0/4.0 | improves |
| json-build-append | llvm | 8.348 | 8.139 | -2.67% | 3.73% | -0.00% | -2.11% | 4.2/4.2 | inside floor |

## All brackets and conditions

| Row | Backend | Round | Wall Δ | Instructions Δ | Cycles Δ | A-repeat floor | Load (A/B/A) | Gate(s) |
|---|---|---:|---:|---:|---:|---:|---|---|
| release-acyclic | c | 1 | -20.80% | -29.73% | -20.63% | 4.91% | 8.65→8.65; 8.65→8.65; 8.65→8.65 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| release-acyclic | c | 2 | -21.96% | -29.73% | -22.33% | 6.55% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| release-acyclic | c | 3 | -20.34% | -29.73% | -19.56% | 1.66% | 9.61→9.61; 9.61→9.61; 9.61→9.61 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| release-acyclic | llvm | 1 | -20.02% | -29.73% | -19.63% | 0.05% | 8.65→8.65; 8.65→8.65; 8.65→8.65 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| release-acyclic | llvm | 2 | -22.45% | -29.73% | -20.59% | 5.97% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| release-acyclic | llvm | 3 | -22.21% | -29.73% | -22.23% | 1.24% | 9.61→9.61; 9.61→9.61; 9.61→9.61 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| map-entries-top-k | c | 1 | -2.85% | -3.22% | -3.04% | 2.45% | 8.65→8.65; 8.65→8.65; 8.65→8.65 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| map-entries-top-k | c | 2 | -1.75% | -3.22% | -1.74% | 0.57% | 7.62→7.62; 7.62→7.62; 7.62→7.62 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| map-entries-top-k | c | 3 | -3.77% | -3.22% | -3.65% | 1.21% | 9.61→9.61; 9.61→9.61; 9.61→9.61 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| map-entries-top-k | llvm | 1 | -10.03% | -3.23% | -8.68% | 9.58% | 8.65→8.65; 8.65→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| map-entries-top-k | llvm | 2 | -9.32% | -3.23% | -9.34% | 7.14% | 7.62→7.62; 7.62→7.62; 7.62→7.62 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| map-entries-top-k | llvm | 3 | -6.64% | -3.23% | -6.85% | 1.66% | 9.61→9.61; 9.61→9.61; 9.61→9.61 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| awfy-towers | c | 1 | 0.33% | -0.12% | -0.01% | 0.26% | 8.28→8.28; 8.28→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| awfy-towers | c | 2 | -0.35% | -0.12% | -0.18% | 0.13% | 7.62→7.62; 7.62→7.62; 7.62→7.62 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| awfy-towers | c | 3 | 2.57% | -0.12% | 1.84% | 0.58% | 9.61→9.61; 9.61→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| awfy-towers | llvm | 1 | -0.83% | -0.12% | -0.29% | 0.36% | 8.28→8.28; 8.28→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| awfy-towers | llvm | 2 | -0.15% | -0.12% | -0.68% | 0.62% | 7.62→7.62; 7.62→7.62; 7.62→7.62 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| awfy-towers | llvm | 3 | -2.00% | -0.12% | -0.39% | 2.52% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| sort-objects | c | 1 | -0.67% | -0.51% | -0.56% | 0.61% | 8.28→8.28; 8.28→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| sort-objects | c | 2 | 14.71% | -0.51% | 13.45% | 1.51% | 7.62→7.62; 7.62→7.62; 7.62→7.62 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| sort-objects | c | 3 | 0.49% | -0.51% | 0.49% | 0.97% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| sort-objects | llvm | 1 | -1.42% | -0.52% | 1.25% | 7.16% | 8.28→8.28; 8.28→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| sort-objects | llvm | 2 | -3.90% | -0.52% | -3.99% | 6.81% | 7.62→7.62; 7.62→7.62; 7.62→7.62 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| sort-objects | llvm | 3 | -5.90% | -0.52% | -4.14% | 7.43% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| cyclic-churn | c | 1 | -5.04% | -5.29% | -4.43% | 0.33% | 8.28→8.28; 8.28→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| cyclic-churn | c | 2 | -5.27% | -5.29% | -4.54% | 2.60% | 9.49→9.49; 9.49→9.49; 9.49→9.49 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| cyclic-churn | c | 3 | -5.53% | -5.29% | -4.85% | 1.62% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| cyclic-churn | llvm | 1 | -7.76% | -5.29% | -6.51% | 2.65% | 8.28→8.28; 8.28→8.28; 8.28→8.28 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| cyclic-churn | llvm | 2 | -5.86% | -5.29% | -6.30% | 2.75% | 9.49→9.49; 9.49→9.49; 9.49→9.49 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| cyclic-churn | llvm | 3 | -6.08% | -5.29% | -5.85% | 3.12% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| tree-teardown | c | 1 | 2.39% | -0.10% | 2.65% | 0.98% | 8.28→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| tree-teardown | c | 2 | -3.49% | -0.10% | -4.51% | 8.76% | 9.49→9.49; 9.49→9.49; 9.49→9.49 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| tree-teardown | c | 3 | 0.28% | -0.10% | 0.28% | 0.05% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| tree-teardown | llvm | 1 | 10.03% | -0.10% | 10.15% | 4.47% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| tree-teardown | llvm | 2 | -6.78% | -0.10% | -7.24% | 7.44% | 9.49→9.49; 9.49→9.49; 9.49→9.49 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| tree-teardown | llvm | 3 | 7.24% | -0.10% | 7.41% | 20.23% | 9.64→9.64; 9.64→9.64; 9.64→9.64 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-parse | c | 1 | -11.58% | -8.75% | -11.81% | 1.65% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-parse | c | 2 | -12.40% | -8.75% | -11.10% | 2.63% | 9.49→9.49; 9.49→9.49; 9.49→9.49 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-parse | c | 3 | -13.44% | -8.75% | -11.23% | 5.32% | 9.19→9.19; 9.19→9.19; 9.19→9.19 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-parse | llvm | 1 | -9.43% | -8.62% | -10.87% | 2.77% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-parse | llvm | 2 | -10.62% | -8.62% | -11.12% | 0.50% | 9.49→9.49; 9.49→9.49; 9.49→9.49 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-parse | llvm | 3 | -11.45% | -8.62% | -11.70% | 0.06% | 9.19→9.19; 9.19→9.19; 9.19→9.19 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-build-append | c | 1 | -1.27% | 0.00% | -1.69% | 0.56% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-build-append | c | 2 | -1.63% | 0.00% | -1.75% | 0.41% | 9.61→9.61; 9.61→9.61; 9.61→9.61 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-build-append | c | 3 | -2.18% | -0.00% | -2.18% | 0.19% | 9.19→9.19; 9.19→9.19; 9.19→9.19 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-build-append | llvm | 1 | -2.67% | -0.00% | -2.59% | 0.16% | 7.93→7.93; 7.93→7.93; 7.93→7.93 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-build-append | llvm | 2 | -4.04% | -0.00% | -2.11% | 3.73% | 9.61→9.61; 9.61→9.61; 9.61→9.61 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |
| json-build-append | llvm | 3 | -2.50% | 0.00% | -1.57% | 1.81% | 9.19→9.19; 9.19→9.19; 9.19→9.19 | land 9b98faf05bc1 2026-10-27T08:57:25.983Z pid 1783778 |

## Linked size

Descriptor bytes sum the linked nts_desc_* symbols; absent functions were inlined or eliminated. Every size is from the same binary measured above.

| Row | Backend | Arm | .text B | Descriptors B | Descriptor symbols | nts_release B | nts_value_release B |
|---|---|---|---:|---:|---:|---:|---:|
| release-acyclic | c | base | 28224 | 528 | 6 | 81 | absent/inlined |
| release-acyclic | llvm | base | 28352 | 528 | 6 | 81 | absent/inlined |
| map-entries-top-k | c | base | 81440 | 528 | 6 | 81 | 120 |
| map-entries-top-k | llvm | base | 81248 | 528 | 6 | 81 | 120 |
| awfy-towers | c | base | 31296 | 616 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | base | 31264 | 616 | 7 | 81 | absent/inlined |
| sort-objects | c | base | 32128 | 440 | 5 | 81 | absent/inlined |
| sort-objects | llvm | base | 32416 | 440 | 5 | 81 | absent/inlined |
| cyclic-churn | c | base | 34144 | 528 | 6 | 81 | absent/inlined |
| cyclic-churn | llvm | base | 34304 | 528 | 6 | 81 | absent/inlined |
| tree-teardown | c | base | 17712 | 264 | 3 | 81 | absent/inlined |
| tree-teardown | llvm | base | 17936 | 264 | 3 | 81 | absent/inlined |
| json-parse | c | base | 122912 | 1056 | 12 | 81 | 120 |
| json-parse | llvm | base | 123840 | 1056 | 12 | 81 | 120 |
| json-build-append | c | base | 47344 | 352 | 4 | 81 | absent/inlined |
| json-build-append | llvm | base | 47536 | 352 | 4 | 81 | absent/inlined |
| release-acyclic | c | typed | 28736 | 576 | 6 | 81 | absent/inlined |
| release-acyclic | llvm | typed | 28864 | 576 | 6 | 81 | absent/inlined |
| map-entries-top-k | c | typed | 81888 | 576 | 6 | 81 | 120 |
| map-entries-top-k | llvm | typed | 81696 | 576 | 6 | 81 | 120 |
| awfy-towers | c | typed | 32128 | 672 | 7 | 81 | absent/inlined |
| awfy-towers | llvm | typed | 32096 | 672 | 7 | 81 | absent/inlined |
| sort-objects | c | typed | 32480 | 480 | 5 | 81 | absent/inlined |
| sort-objects | llvm | typed | 32768 | 480 | 5 | 81 | absent/inlined |
| cyclic-churn | c | typed | 34976 | 576 | 6 | 81 | absent/inlined |
| cyclic-churn | llvm | typed | 35104 | 576 | 6 | 81 | absent/inlined |
| tree-teardown | c | typed | 18256 | 288 | 3 | 81 | absent/inlined |
| tree-teardown | llvm | typed | 18448 | 288 | 3 | 81 | absent/inlined |
| json-parse | c | typed | 124672 | 1152 | 12 | 81 | 120 |
| json-parse | llvm | typed | 125600 | 1152 | 12 | 81 | 120 |
| json-build-append | c | typed | 47696 | 384 | 4 | 81 | absent/inlined |
| json-build-append | llvm | typed | 47888 | 384 | 4 | 81 | absent/inlined |
