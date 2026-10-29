# Benchmark results

Newest complete run: [2026-10-28-6bb2c6217755-full](runs/2026-10-28-6bb2c6217755-full.json). Compiler 6bb2c6217755da22e340a60e1b7ac13fdbb8572c; source 6bb2c6217755da22e340a60e1b7ac13fdbb8572c. Harness legacy-report-artifact-sha256:b32b58d965514f32cd531dc06dc8e8bc7fb1c7142f065477c715a5390dea0fb1; contract unknown (historical). Verdict policy v1, [The bar](../../docs/README.md#the-bar).

- **nts C**: node: 11 UNAVAILABLE, 74 WON, 11 LOSS, 9 SHORT; Bun JIT: 11 UNAVAILABLE, 68 WON, 19 LOSS, 7 SHORT; Bun AOT: 11 UNAVAILABLE, 94 NOT_COMPARABLE; ScriptC: 11 UNAVAILABLE, 94 NOT_COMPARABLE.
- **nts LLVM**: node: 11 UNAVAILABLE, 73 WON, 11 LOSS, 10 SHORT; Bun JIT: 11 UNAVAILABLE, 68 WON, 18 LOSS, 8 SHORT; Bun AOT: 11 UNAVAILABLE, 94 NOT_COMPARABLE; ScriptC: 11 UNAVAILABLE, 94 NOT_COMPARABLE.
- **nts JVM**: node: 11 UNAVAILABLE, 57 WON, 16 LOSS, 21 SHORT; Bun JIT: 11 UNAVAILABLE, 9 SHORT, 54 WON, 31 LOSS; Bun AOT: 11 UNAVAILABLE, 94 NOT_COMPARABLE; ScriptC: 11 UNAVAILABLE, 94 NOT_COMPARABLE.

Conditions: {"availability":"not retained"}. Per-row conditions and sibling samples are retained in the run JSON. All ratios are within this run. Each backend is held separately to the bar: node and Bun JIT require 0.80×; Bun AOT/ScriptC ties use max(1.05, the two cells' observed spread). A refusal is not a timing.

Own-best values are per backend, using compatible machine, workload/input and harness contracts. Unknown historical identities and invalid cells are excluded. A slower-than-best flag is a cross-run observation with provenance, beside the current value. Historical runs with unknown completion times sort by the date recorded in their filename.

| Case | nts C | nts LLVM | nts JVM | C++ | Java | node | Bun JIT | Bun AOT | ScriptC | nts C/node | nts C/Bun JIT | nts C/Bun AOT | nts C/ScriptC | nts LLVM/node | nts LLVM/Bun JIT | nts LLVM/Bun AOT | nts LLVM/ScriptC | LLVM versus C | nts C own best | nts LLVM own best | nts JVM own best |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|absences|93.5 ns (legacy unverified)|95.4 ns (legacy unverified)|657.4 ns (legacy unverified)|91.8 ns (legacy unverified)|504.1 ns (legacy unverified)|889.2 ns (legacy unverified)|724.4 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.105× WON|0.129× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.107× WON|0.132× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.020× **LLVM TRAILS C**|not established|not established|not established|
|accumulate|1.33 µs (legacy unverified)|1.10 µs (legacy unverified)|2.42 µs (legacy unverified)|1.10 µs (legacy unverified)|2.42 µs (legacy unverified)|3.23 µs (legacy unverified)|24.32 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.413× WON|0.055× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.341× WON|0.045× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.826×|not established|not established|not established|
|array-copying-methods|24.41 µs (legacy unverified)|26.58 µs (legacy unverified)|42.90 µs (legacy unverified)|17.64 µs (legacy unverified)|13.71 µs (legacy unverified)|83.18 µs (legacy unverified)|65.27 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.293× WON|0.374× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.320× WON|0.407× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.089× **LLVM TRAILS C**|not established|not established|not established|
|array-from|317.17 µs (legacy unverified)|315.33 µs (legacy unverified)|847.97 µs (legacy unverified)|595.84 µs (legacy unverified)|1.35 ms (legacy unverified)|1.14 ms (legacy unverified)|1.60 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.277× WON|0.199× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.276× WON|0.197× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.994×|not established|not established|not established|
|array-methods|2.45 µs (legacy unverified)|2.69 µs (legacy unverified)|1.81 µs (legacy unverified)|2.56 µs (legacy unverified)|1.58 µs (legacy unverified)|6.79 µs (legacy unverified)|9.20 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.360× WON|0.266× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.396× WON|0.293× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.100× **LLVM TRAILS C**|not established|not established|not established|
|array-mutations|918.2 ns (legacy unverified)|904.3 ns (legacy unverified)|3.28 µs (legacy unverified)|421.7 ns (legacy unverified)|3.99 µs (legacy unverified)|2.19 µs (legacy unverified)|4.32 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.419× WON|0.213× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.412× WON|0.209× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.985×|not established|not established|not established|
|array-predicates|2.48 µs (legacy unverified)|2.45 µs (legacy unverified)|4.85 µs (legacy unverified)|2.72 µs (legacy unverified)|2.66 µs (legacy unverified)|5.16 µs (legacy unverified)|6.83 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.481× WON|0.363× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.474× WON|0.358× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.987×|not established|not established|not established|
|arrays|1.48 µs (legacy unverified)|1.50 µs (legacy unverified)|1.58 µs (legacy unverified)|1.49 µs (legacy unverified)|1.46 µs (legacy unverified)|2.68 µs (legacy unverified)|2.29 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.552× WON|0.647× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.560× WON|0.656× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.015× **LLVM TRAILS C**|not established|not established|not established|
|awfy-bounce|5.20 µs (legacy unverified)|5.20 µs (legacy unverified)|4.88 µs (legacy unverified)|4.82 µs (legacy unverified)|4.99 µs (legacy unverified)|13.66 µs (legacy unverified)|12.29 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.381× WON|0.423× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.381× WON|0.423× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.000× **LLVM TRAILS C**|not established|not established|not established|
|awfy-list|10.89 µs (legacy unverified)|10.94 µs (legacy unverified)|8.71 µs (legacy unverified)|7.69 µs (legacy unverified)|9.21 µs (legacy unverified)|17.93 µs (legacy unverified)|14.51 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.607× WON|0.750× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.610× WON|0.754× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.005× **LLVM TRAILS C**|not established|not established|not established|
|awfy-mandelbrot|24.60 ms (legacy unverified)|24.85 ms (legacy unverified)|23.26 ms (legacy unverified)|24.59 ms (legacy unverified)|28.59 ms (legacy unverified)|24.18 ms (legacy unverified)|23.88 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.018× LOSS|1.030× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.028× LOSS|1.040× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.010× **LLVM TRAILS C**|not established|not established|not established|
|awfy-nbody|8.81 ms (legacy unverified)|8.93 ms (legacy unverified)|8.92 ms (legacy unverified)|7.47 ms (legacy unverified)|8.90 ms (legacy unverified)|97.53 ms (legacy unverified)|18.76 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.090× WON|0.469× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.092× WON|0.476× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.014× **LLVM TRAILS C**|not established|not established|not established|
|awfy-permute|23.46 µs (legacy unverified)|26.48 µs (legacy unverified)|14.12 µs (legacy unverified)|11.93 µs (legacy unverified)|19.24 µs (legacy unverified)|25.68 µs (legacy unverified)|19.86 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.913× SHORT|1.181× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.031× LOSS|1.333× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.129× **LLVM TRAILS C**|not established|not established|not established|
|awfy-queens|10.94 µs (legacy unverified)|11.09 µs (legacy unverified)|18.95 µs (legacy unverified)|6.36 µs (legacy unverified)|10.19 µs (legacy unverified)|19.81 µs (legacy unverified)|16.87 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.552× WON|0.648× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.560× WON|0.657× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.014× **LLVM TRAILS C**|not established|not established|not established|
|awfy-sieve|4.04 µs (legacy unverified)|5.20 µs (legacy unverified)|5.17 µs (legacy unverified)|3.99 µs (legacy unverified)|5.42 µs (legacy unverified)|12.37 µs (legacy unverified)|11.75 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.327× WON|0.344× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.420× WON|0.442× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.286× **LLVM TRAILS C**|not established|not established|not established|
|awfy-towers|36.63 µs (legacy unverified)|35.18 µs (legacy unverified)|30.63 µs (legacy unverified)|14.22 µs (legacy unverified)|22.29 µs (legacy unverified)|38.53 µs (legacy unverified)|24.76 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.951× SHORT|1.479× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.913× SHORT|1.421× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.961×|not established|not established|not established|
|bigint|403.7 ns (legacy unverified)|404.3 ns (legacy unverified)|1.03 µs (legacy unverified)|389.3 ns (legacy unverified)|5.91 µs (legacy unverified)|4.40 µs (legacy unverified)|4.19 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.092× WON|0.096× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.092× WON|0.096× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.001× **LLVM TRAILS C**|not established|not established|not established|
|bytes|503.37 µs (legacy unverified)|502.91 µs (legacy unverified)|821.05 µs (legacy unverified)|494.05 µs (legacy unverified)|753.18 µs (legacy unverified)|590.42 µs (legacy unverified)|838.92 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.853× SHORT|0.600× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.852× SHORT|0.599× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.999×|not established|not established|not established|
|case-convert|1.90 µs (legacy unverified)|1.86 µs (legacy unverified)|3.80 µs (legacy unverified)|6.97 µs (legacy unverified)|3.68 µs (legacy unverified)|3.99 µs (legacy unverified)|6.31 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.476× WON|0.301× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.466× WON|0.295× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.980×|not established|not established|not established|
|case-convert-cjk|38.87 µs (legacy unverified)|40.73 µs (legacy unverified)|6.88 µs (legacy unverified)|NOT_PROVIDED|6.89 µs (legacy unverified)|7.75 µs (legacy unverified)|10.20 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|5.014× LOSS|3.811× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|5.254× LOSS|3.993× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.048× **LLVM TRAILS C**|not established|not established|not established|
|case-convert-greek|85.95 µs (legacy unverified)|86.79 µs (legacy unverified)|18.28 µs (legacy unverified)|NOT_PROVIDED|17.94 µs (legacy unverified)|21.39 µs (legacy unverified)|27.52 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|4.018× LOSS|3.123× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|4.057× LOSS|3.153× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.010× **LLVM TRAILS C**|not established|not established|not established|
|case-convert-latin1|45.72 µs (legacy unverified)|46.65 µs (legacy unverified)|12.85 µs (legacy unverified)|NOT_PROVIDED|11.82 µs (legacy unverified)|24.93 µs (legacy unverified)|28.24 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.834× LOSS|1.619× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.872× LOSS|1.652× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.020× **LLVM TRAILS C**|not established|not established|not established|
|case-convert-unchanged|2.12 µs (legacy unverified)|2.15 µs (legacy unverified)|2.81 µs (legacy unverified)|9.12 µs (legacy unverified)|2.39 µs (legacy unverified)|4.07 µs (legacy unverified)|5.55 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.520× WON|0.382× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.529× WON|0.388× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.017× **LLVM TRAILS C**|not established|not established|not established|
|checksum|5.54 µs (legacy unverified)|5.58 µs (legacy unverified)|5.57 µs (legacy unverified)|5.57 µs (legacy unverified)|5.60 µs (legacy unverified)|6.38 µs (legacy unverified)|26.57 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.868× SHORT|0.208× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.875× SHORT|0.210× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.007× **LLVM TRAILS C**|not established|not established|not established|
|clbg-binary-trees|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-fannkuch-redux|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-fasta|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-k-nucleotide|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-mandelbrot|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-reverse-complement|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-spectral-norm|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|closure-merge|518.6 ns (legacy unverified)|514.3 ns (legacy unverified)|2.98 µs (legacy unverified)|7.38 µs (legacy unverified)|2.39 µs (legacy unverified)|23.64 µs (legacy unverified)|13.70 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.022× WON|0.038× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.022× WON|0.038× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.992×|not established|not established|not established|
|closures|447.1 ns (legacy unverified)|447.9 ns (legacy unverified)|2.21 µs (legacy unverified)|452.7 ns (legacy unverified)|2.53 µs (legacy unverified)|7.54 µs (legacy unverified)|21.04 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.059× WON|0.021× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.059× WON|0.021× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.002× **LLVM TRAILS C**|not established|not established|not established|
|cyclic-churn|104.67 µs (legacy unverified)|96.24 µs (legacy unverified)|14.55 µs (legacy unverified)|29.74 µs (legacy unverified)|9.25 µs (legacy unverified)|9.83 µs (legacy unverified)|10.06 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|10.649× LOSS|10.407× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|9.791× LOSS|9.569× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.919×|not established|not established|not established|
|dispatch|20.53 µs (legacy unverified)|10.67 µs (legacy unverified)|19.99 µs (legacy unverified)|22.06 µs (legacy unverified)|27.12 µs (legacy unverified)|46.98 µs (legacy unverified)|15.92 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.437× WON|1.290× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.227× WON|0.670× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.520×|not established|not established|not established|
|elementwise|81.65 µs (legacy unverified)|82.22 µs (legacy unverified)|69.36 µs (legacy unverified)|81.51 µs (legacy unverified)|68.12 µs (legacy unverified)|1.09 ms (legacy unverified)|695.16 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.075× WON|0.117× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.075× WON|0.118× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.007× **LLVM TRAILS C**|not established|not established|not established|
|erasure-stored-typed|79.19 µs (legacy unverified)|78.87 µs (legacy unverified)|82.69 µs (legacy unverified)|79.27 µs (legacy unverified)|83.93 µs (legacy unverified)|144.91 µs (legacy unverified)|81.82 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.546× WON|0.968× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.544× WON|0.964× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.996×|not established|not established|not established|
|erasure-stored-unknown|78.73 µs (legacy unverified)|78.58 µs (legacy unverified)|82.61 µs (legacy unverified)|78.96 µs (legacy unverified)|84.30 µs (legacy unverified)|105.63 µs (legacy unverified)|82.02 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.745× WON|0.960× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.744× WON|0.958× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.998×|not established|not established|not established|
|erasure-typed|150.89 µs (legacy unverified)|154.57 µs (legacy unverified)|154.67 µs (legacy unverified)|154.58 µs (legacy unverified)|154.81 µs (legacy unverified)|157.09 µs (legacy unverified)|94.24 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.961× SHORT|1.601× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.984× SHORT|1.640× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.024× **LLVM TRAILS C**|not established|not established|not established|
|erasure-unknown|154.55 µs (legacy unverified)|146.61 µs (legacy unverified)|155.87 µs (legacy unverified)|154.24 µs (legacy unverified)|149.66 µs (legacy unverified)|156.88 µs (legacy unverified)|95.88 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.985× SHORT|1.612× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.934× SHORT|1.529× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.949×|not established|not established|not established|
|event-state|116.7 ns (legacy unverified)|113.3 ns (legacy unverified)|114.0 ns (legacy unverified)|546.9 ns (legacy unverified)|86.8 ns (legacy unverified)|1.47 µs (legacy unverified)|171.3 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.079× WON|0.681× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.077× WON|0.661× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.971×|not established|not established|not established|
|exceptions|6.83 µs (legacy unverified)|6.80 µs (legacy unverified)|12.70 µs (legacy unverified)|5.25 µs (legacy unverified)|3.59 ms (legacy unverified)|16.90 ms (legacy unverified)|3.00 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.000× WON|0.002× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.000× WON|0.002× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.996×|not established|not established|not established|
|face-fields|3.63 µs (legacy unverified)|3.66 µs (legacy unverified)|10.54 µs (legacy unverified)|15.96 µs (legacy unverified)|34.14 µs (legacy unverified)|11.21 µs (legacy unverified)|5.96 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.324× WON|0.609× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.326× WON|0.613× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.006× **LLVM TRAILS C**|not established|not established|not established|
|fib|566.58 µs (legacy unverified)|606.02 µs (legacy unverified)|568.58 µs (legacy unverified)|342.31 µs (legacy unverified)|553.87 µs (legacy unverified)|1.10 ms (legacy unverified)|730.80 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.516× WON|0.775× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.552× WON|0.829× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.070× **LLVM TRAILS C**|not established|not established|not established|
|generator|178.82 µs (legacy unverified)|186.76 µs (legacy unverified)|194.81 µs (legacy unverified)|190.66 µs (legacy unverified)|196.31 µs (legacy unverified)|3.71 ms (legacy unverified)|681.62 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.048× WON|0.262× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.050× WON|0.274× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.044× **LLVM TRAILS C**|not established|not established|not established|
|generator-dispatched|190.42 µs (legacy unverified)|187.69 µs (legacy unverified)|196.33 µs (legacy unverified)|676.89 µs (legacy unverified)|199.37 µs (legacy unverified)|3.83 ms (legacy unverified)|1.01 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.050× WON|0.189× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.049× WON|0.187× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.986×|not established|not established|not established|
|generic-classes|3.76 µs (legacy unverified)|3.54 µs (legacy unverified)|5.33 µs (legacy unverified)|3.75 µs (legacy unverified)|4.24 µs (legacy unverified)|5.03 µs (legacy unverified)|5.02 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.747× WON|0.749× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.704× WON|0.706× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.943×|not established|not established|not established|
|growth-fixed|176.81 µs (legacy unverified)|178.37 µs (legacy unverified)|193.29 µs (legacy unverified)|177.82 µs (legacy unverified)|193.25 µs (legacy unverified)|359.02 µs (legacy unverified)|308.76 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.492× WON|0.573× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.497× WON|0.578× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.009× **LLVM TRAILS C**|not established|not established|not established|
|growth-grown|179.66 µs (legacy unverified)|173.63 µs (legacy unverified)|196.50 µs (legacy unverified)|176.56 µs (legacy unverified)|191.12 µs (legacy unverified)|359.66 µs (legacy unverified)|307.02 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.500× WON|0.585× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.483× WON|0.566× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.966×|not established|not established|not established|
|immutable-update|78.83 µs (legacy unverified)|80.53 µs (legacy unverified)|105.51 µs (legacy unverified)|25.81 µs (legacy unverified)|80.04 µs (legacy unverified)|128.00 µs (legacy unverified)|144.69 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.616× WON|0.545× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.629× WON|0.557× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.022× **LLVM TRAILS C**|not established|not established|not established|
|in-narrowing|695.6 ns (legacy unverified)|707.4 ns (legacy unverified)|1.58 µs (legacy unverified)|694.2 ns (legacy unverified)|1.46 µs (legacy unverified)|11.85 µs (legacy unverified)|9.77 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.059× WON|0.071× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.060× WON|0.072× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.017× **LLVM TRAILS C**|not established|not established|not established|
|instanceof|34.01 µs (legacy unverified)|33.46 µs (legacy unverified)|60.28 µs (legacy unverified)|34.00 µs (legacy unverified)|51.13 µs (legacy unverified)|1.09 ms (legacy unverified)|347.02 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.031× WON|0.098× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.031× WON|0.096× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.984×|not established|not established|not established|
|json-build-append|9.13 µs (legacy unverified)|9.02 µs (legacy unverified)|15.64 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|18.39 µs (legacy unverified)|11.41 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.496× WON|0.800× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.490× WON|0.790× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.988×|not established|not established|not established|
|json-build-join|13.24 µs (legacy unverified)|13.09 µs (legacy unverified)|18.47 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|26.22 µs (legacy unverified)|16.04 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.505× WON|0.826× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.499× WON|0.816× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.989×|not established|not established|not established|
|json-parse|1.04 ms (legacy unverified)|1.11 ms (legacy unverified)|557.32 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|740.91 µs (legacy unverified)|1.23 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.406× LOSS|0.848× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.497× LOSS|0.902× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.064× **LLVM TRAILS C**|not established|not established|not established|
|json-quote|2.64 µs (legacy unverified)|2.64 µs (legacy unverified)|38.28 µs (legacy unverified)|4.67 µs (legacy unverified)|NOT_PROVIDED|10.09 µs (legacy unverified)|20.45 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.261× WON|0.129× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.262× WON|0.129× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.001× **LLVM TRAILS C**|not established|not established|not established|
|json-scan|1.40 µs (legacy unverified)|1.81 µs (legacy unverified)|2.47 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|2.20 µs (legacy unverified)|2.35 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.635× WON|0.593× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.824× SHORT|0.770× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.298× **LLVM TRAILS C**|not established|not established|not established|
|json-serialize|7.04 µs (legacy unverified)|7.04 µs (legacy unverified)|14.23 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|14.94 µs (legacy unverified)|9.90 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.471× WON|0.711× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.471× WON|0.711× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|json-stringify-builtin|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|json-stringify-doc|976.31 µs (legacy unverified)|1.03 ms (legacy unverified)|1.04 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.50 ms (legacy unverified)|3.30 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.649× WON|0.296× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.685× WON|0.312× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.056× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-fused|402.58 µs (legacy unverified)|417.52 µs (legacy unverified)|714.33 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|867.65 µs (legacy unverified)|1.36 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.464× WON|0.296× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.481× WON|0.307× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.037× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-inline|383.50 µs (legacy unverified)|394.30 µs (legacy unverified)|785.32 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.05 ms (legacy unverified)|1.12 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.365× WON|0.343× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.375× WON|0.352× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.028× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-typed|377.99 µs (legacy unverified)|389.73 µs (legacy unverified)|1.20 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.07 ms (legacy unverified)|1.27 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.353× WON|0.298× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.364× WON|0.307× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.031× **LLVM TRAILS C**|not established|not established|not established|
|LICENSE-benchmarks-game|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|logical-assignment|45.96 µs (legacy unverified)|36.99 µs (legacy unverified)|66.28 µs (legacy unverified)|36.58 µs (legacy unverified)|68.81 µs (legacy unverified)|402.48 µs (legacy unverified)|79.95 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.114× WON|0.575× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.092× WON|0.463× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.805×|not established|not established|not established|
|loop|757.1 ns (legacy unverified)|745.4 ns (legacy unverified)|1.54 µs (legacy unverified)|761.9 ns (legacy unverified)|1.72 µs (legacy unverified)|758.4 ns (legacy unverified)|763.9 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.998× SHORT|0.991× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.983× SHORT|0.976× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.985×|not established|not established|not established|
|map-and-set|5.17 µs (legacy unverified)|5.15 µs (legacy unverified)|7.90 µs (legacy unverified)|22.07 µs (legacy unverified)|14.11 µs (legacy unverified)|9.41 µs (legacy unverified)|7.68 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.549× WON|0.673× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.548× WON|0.671× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.997×|not established|not established|not established|
|map-entries-top-k|17.70 µs (legacy unverified)|17.89 µs (legacy unverified)|18.74 µs (legacy unverified)|21.07 µs (legacy unverified)|14.77 µs (legacy unverified)|32.05 µs (legacy unverified)|24.41 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.552× WON|0.725× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.558× WON|0.733× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.011× **LLVM TRAILS C**|not established|not established|not established|
|map-literal-keys|29.57 µs (legacy unverified)|31.48 µs (legacy unverified)|67.25 µs (legacy unverified)|128.95 µs (legacy unverified)|17.18 µs (legacy unverified)|58.99 µs (legacy unverified)|13.06 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.501× WON|2.264× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.534× WON|2.410× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.064× **LLVM TRAILS C**|not established|not established|not established|
|map-word-counts|5.11 µs (legacy unverified)|5.08 µs (legacy unverified)|6.78 µs (legacy unverified)|10.87 µs (legacy unverified)|6.34 µs (legacy unverified)|9.49 µs (legacy unverified)|6.15 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.539× WON|0.831× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.536× WON|0.826× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.994×|not established|not established|not established|
|module-closures|913.9 ns (legacy unverified)|933.2 ns (legacy unverified)|5.25 µs (legacy unverified)|931.0 ns (legacy unverified)|4.94 µs (legacy unverified)|6.07 µs (legacy unverified)|41.97 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.151× WON|0.022× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.154× WON|0.022× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.021× **LLVM TRAILS C**|not established|not established|not established|
|node-utf8|37.98 µs (legacy unverified)|37.71 µs (legacy unverified)|44.77 µs (legacy unverified)|NOT_PROVIDED|11.30 µs (legacy unverified)|50.75 µs (legacy unverified)|65.77 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.748× WON|0.577× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.743× WON|0.573× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.993×|not established|not established|not established|
|number-format|758.4 ns (legacy unverified)|801.1 ns (legacy unverified)|1.19 µs (legacy unverified)|1.06 µs (legacy unverified)|1.15 µs (legacy unverified)|1.69 µs (legacy unverified)|1.07 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.448× WON|0.710× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.473× WON|0.750× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.056× **LLVM TRAILS C**|not established|not established|not established|
|number-format-double|5.06 µs (legacy unverified)|5.07 µs (legacy unverified)|6.38 µs (legacy unverified)|NOT_PROVIDED|6.04 µs (legacy unverified)|11.07 µs (legacy unverified)|6.87 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.457× WON|0.736× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.458× WON|0.738× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.003× **LLVM TRAILS C**|not established|not established|not established|
|objects|1.77 µs (legacy unverified)|1.76 µs (legacy unverified)|3.21 µs (legacy unverified)|1.74 µs (legacy unverified)|2.29 µs (legacy unverified)|2.12 µs (legacy unverified)|1.69 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.835× SHORT|1.048× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.833× SHORT|1.045× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.997×|not established|not established|not established|
|optional-chain|30.84 µs (legacy unverified)|30.33 µs (legacy unverified)|75.79 µs (legacy unverified)|30.70 µs (legacy unverified)|39.01 µs (legacy unverified)|442.59 µs (legacy unverified)|385.46 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.070× WON|0.080× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.069× WON|0.079× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.983×|not established|not established|not established|
|pipeline|29.34 µs (legacy unverified)|29.47 µs (legacy unverified)|59.96 µs (legacy unverified)|32.58 µs (legacy unverified)|60.38 µs (legacy unverified)|159.08 µs (legacy unverified)|163.88 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.184× WON|0.179× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.185× WON|0.180× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.004× **LLVM TRAILS C**|not established|not established|not established|
|printer-erased|10.68 µs (legacy unverified)|10.97 µs (legacy unverified)|6.26 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|18.71 µs (legacy unverified)|30.45 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.571× WON|0.351× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.586× WON|0.360× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.027× **LLVM TRAILS C**|not established|not established|not established|
|record-word-counts|5.56 µs (legacy unverified)|5.33 µs (legacy unverified)|7.01 µs (legacy unverified)|15.39 µs (legacy unverified)|3.70 µs (legacy unverified)|9.88 µs (legacy unverified)|4.68 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.563× WON|1.189× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.539× WON|1.138× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.958×|not established|not established|not established|
|release-acyclic|101.28 µs (legacy unverified)|103.38 µs (legacy unverified)|59.51 µs (legacy unverified)|195.09 µs (legacy unverified)|34.71 µs (legacy unverified)|79.39 µs (legacy unverified)|44.89 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.276× LOSS|2.256× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.302× LOSS|2.303× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.021× **LLVM TRAILS C**|not established|not established|not established|
|sort-objects|60.10 µs (legacy unverified)|64.50 µs (legacy unverified)|105.93 µs (legacy unverified)|32.18 µs (legacy unverified)|13.38 µs (legacy unverified)|55.88 µs (legacy unverified)|32.50 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.076× LOSS|1.849× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.154× LOSS|1.984× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.073× **LLVM TRAILS C**|not established|not established|not established|
|str-append-length|12.79 µs (legacy unverified)|13.05 µs (legacy unverified)|24.13 µs (legacy unverified)|12.68 µs (legacy unverified)|NOT_PROVIDED|21.71 µs (legacy unverified)|12.46 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.589× WON|1.027× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.601× WON|1.047× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.020× **LLVM TRAILS C**|not established|not established|not established|
|str-append-loop|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|INVALID|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|str-compare|5.29 µs (legacy unverified)|5.14 µs (legacy unverified)|3.72 µs (legacy unverified)|7.99 µs (legacy unverified)|NOT_PROVIDED|5.25 µs (legacy unverified)|10.04 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.006× LOSS|0.526× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.979× SHORT|0.512× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.973×|not established|not established|not established|
|str-concat-pair|2.97 µs (legacy unverified)|2.94 µs (legacy unverified)|4.17 µs (legacy unverified)|2.76 µs (legacy unverified)|NOT_PROVIDED|21.15 µs (legacy unverified)|26.29 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.140× WON|0.113× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.139× WON|0.112× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.992×|not established|not established|not established|
|str-equal|1.30 µs (legacy unverified)|1.33 µs (legacy unverified)|1.46 µs (legacy unverified)|1.11 µs (legacy unverified)|NOT_PROVIDED|2.54 µs (legacy unverified)|1.92 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.511× WON|0.675× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.526× WON|0.696× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.030× **LLVM TRAILS C**|not established|not established|not established|
|str-index-of|10.04 µs (legacy unverified)|9.69 µs (legacy unverified)|5.70 µs (legacy unverified)|8.40 µs (legacy unverified)|NOT_PROVIDED|10.11 µs (legacy unverified)|5.58 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.993× SHORT|1.800× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.958× SHORT|1.737× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.965×|not established|not established|not established|
|str-index-read|1.42 µs (legacy unverified)|1.53 µs (legacy unverified)|3.09 µs (legacy unverified)|291.2 ns (legacy unverified)|NOT_PROVIDED|3.32 µs (legacy unverified)|4.59 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.429× WON|0.310× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.462× WON|0.334× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.078× **LLVM TRAILS C**|not established|not established|not established|
|str-join|1.14 µs (legacy unverified)|1.20 µs (legacy unverified)|2.43 µs (legacy unverified)|1.38 µs (legacy unverified)|NOT_PROVIDED|4.51 µs (legacy unverified)|6.83 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.252× WON|0.167× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.267× WON|0.176× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.060× **LLVM TRAILS C**|not established|not established|not established|
|str-map-keys|4.24 µs (legacy unverified)|4.16 µs (legacy unverified)|5.02 µs (legacy unverified)|8.42 µs (legacy unverified)|NOT_PROVIDED|6.06 µs (legacy unverified)|6.08 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.700× WON|0.697× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.687× WON|0.685× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.982×|not established|not established|not established|
|str-slice-keep|3.23 µs (legacy unverified)|3.10 µs (legacy unverified)|5.14 µs (legacy unverified)|2.45 µs (legacy unverified)|NOT_PROVIDED|2.99 µs (legacy unverified)|6.40 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.079× LOSS|0.505× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.035× LOSS|0.484× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.959×|not established|not established|not established|
|str-split|14.92 µs (legacy unverified)|14.57 µs (legacy unverified)|9.89 µs (legacy unverified)|3.50 µs (legacy unverified)|NOT_PROVIDED|14.29 µs (legacy unverified)|18.08 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.044× LOSS|0.825× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.020× LOSS|0.806× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.977×|not established|not established|not established|
|str-template|7.03 µs (legacy unverified)|6.86 µs (legacy unverified)|8.21 µs (legacy unverified)|4.86 µs (legacy unverified)|NOT_PROVIDED|24.11 µs (legacy unverified)|48.67 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.291× WON|0.144× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.284× WON|0.141× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.976×|not established|not established|not established|
|str-to-number|3.17 µs (legacy unverified)|3.12 µs (legacy unverified)|5.90 µs (legacy unverified)|1.71 µs (legacy unverified)|NOT_PROVIDED|4.25 µs (legacy unverified)|2.90 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.746× WON|1.092× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.734× WON|1.074× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.983×|not established|not established|not established|
|strings|387.2 ns (legacy unverified)|387.0 ns (legacy unverified)|1.53 µs (legacy unverified)|482.3 ns (legacy unverified)|1.56 µs (legacy unverified)|2.53 µs (legacy unverified)|2.57 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.153× WON|0.151× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.153× WON|0.150× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.999×|not established|not established|not established|
|substrings|1.50 µs (legacy unverified)|1.43 µs (legacy unverified)|2.84 µs (legacy unverified)|1.86 µs (legacy unverified)|6.04 µs (legacy unverified)|7.16 µs (legacy unverified)|26.29 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.210× WON|0.057× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.200× WON|0.055× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.952×|not established|not established|not established|
|symbol-keyed-map|16.09 µs (legacy unverified)|17.23 µs (legacy unverified)|15.22 µs (legacy unverified)|14.44 µs (legacy unverified)|8.70 µs (legacy unverified)|41.46 µs (legacy unverified)|6.80 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.388× WON|2.364× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.416× WON|2.532× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.071× **LLVM TRAILS C**|not established|not established|not established|
|symbol-keys|318.7 ns (legacy unverified)|320.0 ns (legacy unverified)|435.3 ns (legacy unverified)|318.5 ns (legacy unverified)|352.6 ns (legacy unverified)|1.85 µs (legacy unverified)|547.0 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.172× WON|0.583× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.173× WON|0.585× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.004× **LLVM TRAILS C**|not established|not established|not established|
|tree-teardown|29.17 µs (legacy unverified)|27.19 µs (legacy unverified)|29.34 µs (legacy unverified)|132.65 µs (legacy unverified)|28.91 µs (legacy unverified)|46.63 µs (legacy unverified)|47.52 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.626× WON|0.614× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.583× WON|0.572× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.932×|not established|not established|not established|
|uniform-callback|400.1 ns (legacy unverified)|405.8 ns (legacy unverified)|2.96 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|2.42 µs (legacy unverified)|966.4 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.165× WON|0.414× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.168× WON|0.420× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.014× **LLVM TRAILS C**|not established|not established|not established|
|uniform-callback-arguments|838.1 ns (legacy unverified)|842.7 ns (legacy unverified)|2.97 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|3.25 µs (legacy unverified)|1.33 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.258× WON|0.632× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.259× WON|0.635× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.005× **LLVM TRAILS C**|not established|not established|not established|
|uniform-callback-default|474.9 ns (legacy unverified)|487.4 ns (legacy unverified)|2.78 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|2.48 µs (legacy unverified)|932.4 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.192× WON|0.509× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.197× WON|0.523× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.026× **LLVM TRAILS C**|not established|not established|not established|
|upcast|4.58 µs (legacy unverified)|5.27 µs (legacy unverified)|8.10 µs (legacy unverified)|3.96 µs (legacy unverified)|7.92 µs (legacy unverified)|9.73 µs (legacy unverified)|8.44 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.471× WON|0.543× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.541× WON|0.625× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.149× **LLVM TRAILS C**|not established|not established|not established|
|user-iterable|28.12 µs (legacy unverified)|28.30 µs (legacy unverified)|51.93 µs (legacy unverified)|33.81 µs (legacy unverified)|373.34 µs (legacy unverified)|406.83 µs (legacy unverified)|495.75 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.069× WON|0.057× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.070× WON|0.057× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.006× **LLVM TRAILS C**|not established|not established|not established|
|utf8-encode|REFUSED|REFUSED|REFUSED|2.27 µs (legacy unverified)|NOT_PROVIDED|17.06 µs (legacy unverified)|5.38 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|

- LICENSE-benchmarks-game, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, node: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- LICENSE-benchmarks-game, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- absences, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- absences, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- absences, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- accumulate, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- accumulate, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- accumulate, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- array-copying-methods, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-copying-methods, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-copying-methods, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- array-from, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-from, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-from, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- array-methods, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-methods, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-methods, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- array-mutations, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-mutations, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-mutations, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- arrays, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- arrays, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- arrays, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-bounce, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-bounce, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-bounce, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-list, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-list, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-list, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-mandelbrot, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-mandelbrot, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-mandelbrot, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-nbody, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-nbody, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-nbody, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-permute, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-permute, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-permute, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-queens, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-queens, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-queens, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-sieve, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-sieve, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-sieve, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- awfy-towers, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-towers, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-towers, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- bigint, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- bigint, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- bigint, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- bytes, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- bytes, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- bytes, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-cjk, C++: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-cjk, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-cjk, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-cjk, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-greek, C++: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-greek, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-greek, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-greek, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-latin1, C++: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-latin1, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-latin1, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-latin1, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-unchanged, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-unchanged, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- case-convert-unchanged, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- case-convert, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- case-convert, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- case-convert, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- checksum, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- checksum, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- checksum, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- clbg-binary-trees, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-binary-trees, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fannkuch-redux, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-fasta, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-k-nucleotide, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-mandelbrot, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-reverse-complement, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, node: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- clbg-spectral-norm, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- closure-merge, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- closure-merge, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- closure-merge, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- closures, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- closures, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- closures, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- cyclic-churn, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- cyclic-churn, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- cyclic-churn, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- dispatch, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- dispatch, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- dispatch, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-typed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-typed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-typed, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-unknown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-unknown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-unknown, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- erasure-typed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-typed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-typed, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- erasure-unknown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-unknown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-unknown, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- event-state, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- event-state, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- event-state, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- exceptions, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- exceptions, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- exceptions, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- face-fields, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- face-fields, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- face-fields, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- fib, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- fib, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- fib, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- generator-dispatched, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- generator-dispatched, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- generator-dispatched, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- generator, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- generator, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- generator, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- growth-fixed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- growth-fixed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- growth-fixed, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- growth-grown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- growth-grown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- growth-grown, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- immutable-update, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- immutable-update, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- immutable-update, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- in-narrowing, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- in-narrowing, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- in-narrowing, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- instanceof, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- instanceof, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- instanceof, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-quote, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-quote, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-quote, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-quote, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-builtin, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, node: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-builtin, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- json-stringify-doc, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- logical-assignment, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- logical-assignment, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- logical-assignment, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- loop, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- loop, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- loop, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- map-and-set, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- map-and-set, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- map-and-set, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- map-entries-top-k, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- map-entries-top-k, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- map-entries-top-k, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- map-literal-keys, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- map-literal-keys, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- map-literal-keys, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- map-word-counts, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- map-word-counts, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- map-word-counts, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- module-closures, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- module-closures, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- module-closures, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, C++: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, C++: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- number-format, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- number-format, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- number-format, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- objects, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- objects, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- objects, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- pipeline, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- pipeline, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- pipeline, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- printer-erased, C++: NOT_PROVIDED: Column was not provided in this historical run
- printer-erased, Java: NOT_PROVIDED: Column was not provided in this historical run
- printer-erased, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- printer-erased, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- printer-erased, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- record-word-counts, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- record-word-counts, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- record-word-counts, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- release-acyclic, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- release-acyclic, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- release-acyclic, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- sort-objects, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- sort-objects, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- sort-objects, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-append-length, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-append-length, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-append-length, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-append-length, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-append-loop, nts C: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, nts LLVM: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, nts JVM: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, C++: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, Java: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, node: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, Bun JIT: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, Bun AOT: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, ScriptC: INVALID: Historical run rejected this row; no accepted timing was retained
- str-append-loop, nts f64: INVALID: Historical run rejected this row; no accepted timing was retained
- str-compare, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-compare, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-compare, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-compare, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-concat-pair, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-concat-pair, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-concat-pair, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-concat-pair, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-equal, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-equal, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-equal, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-equal, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-index-of, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-index-of, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-index-of, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-index-of, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-index-read, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-index-read, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-index-read, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-index-read, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-join, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-join, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-join, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-join, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-map-keys, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-map-keys, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-map-keys, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-map-keys, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-slice-keep, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-slice-keep, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-slice-keep, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-slice-keep, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-split, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-split, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-split, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-split, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-template, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-template, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-template, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-template, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- str-to-number, Java: NOT_PROVIDED: Column was not provided in this historical run
- str-to-number, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- str-to-number, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- str-to-number, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- strings, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- strings, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- strings, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- substrings, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- substrings, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- substrings, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keyed-map, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keyed-map, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keyed-map, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keys, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keys, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keys, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- tree-teardown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- tree-teardown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- tree-teardown, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-arguments, C++: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-arguments, Java: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-arguments, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-arguments, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-arguments, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-default, C++: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-default, Java: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-default, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-default, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback-default, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback, C++: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback, Java: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- uniform-callback, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- upcast, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- upcast, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- upcast, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- user-iterable, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- user-iterable, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- user-iterable, nts f64: NOT_PROVIDED: Column was not provided in this historical run
- utf8-encode, nts C: REFUSED: Historical compile refusal
- utf8-encode, nts LLVM: REFUSED: Historical compile refusal
- utf8-encode, nts JVM: REFUSED: Historical compile refusal
- utf8-encode, Java: NOT_PROVIDED: Column was not provided in this historical run
- utf8-encode, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- utf8-encode, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- utf8-encode, nts f64: NOT_PROVIDED: Column was not provided in this historical run
