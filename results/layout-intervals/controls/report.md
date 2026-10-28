# Randomized layout A/B intervals

Independent joint code/heap draws have equal weight. Repeated hot brackets are not independent samples. Verdicts use the configured empirical cluster-bootstrap interval. Its scope is the chosen sampler and observed sitting.

| Control / row | Backend | Layouts/arm | Metric | Mean delta | Confidence interval | A/B layout range | Per-layout delta range | Verdict |
|---|---|---:|---|---:|---|---|---|---|
| str-map-keys-noop | llvm | 30 | cycles | -0.38% | 99.00% [-5.25%, 4.99%] | 23.23% / 22.65% | -18.33% to 20.86% | noise |
| str-map-keys-noop | llvm | 30 | instructions | 0.00% | 99.00% [-0.05%, 0.05%] | 0.28% / 0.28% | -0.25% to 0.22% | noise |
| str-map-keys-noop | llvm | 30 | nanoseconds | -0.70% | 99.00% [-5.46%, 4.55%] | 22.70% / 23.21% | -18.55% to 19.84% | noise |
| map-word-counts-cleanup | llvm | 30 | cycles | -10.74% | 99.00% [-11.65%, -9.72%] | 4.81% / 7.62% | -14.70% to -5.25% | improvement |
| map-word-counts-cleanup | llvm | 30 | instructions | -8.04% | 99.00% [-8.05%, -8.03%] | 0.03% / 0.03% | -8.07% to -8.01% | improvement |
| map-word-counts-cleanup | llvm | 30 | nanoseconds | -10.67% | 99.00% [-11.59%, -9.65%] | 4.67% / 7.96% | -14.73% to -5.24% | improvement |

All draws remain in the record. Heap padding is live startup placement; native hot windows exclude it. Peak RSS includes it and is not an unperturbed memory baseline.

Sitting 2026-10-28T20:05:34.939Z–2026-10-28T20:08:12.186Z; load 10–90.32. Train state and input/control provenance remain in summary.json.
