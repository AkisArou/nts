# Benchmark results

Newest complete run: [2026-10-29-0a072536bf5f-corrected](runs/2026-10-29-0a072536bf5f-corrected.json). Compiler 0a072536bf5f477247bd3339a9bb7cdf71701bf9; source 0a072536bf5f477247bd3339a9bb7cdf71701bf9. Harness daaf5f5777c95bacf03645913dc4deeaf3a8f3baf645bda701552b2227978619; contract opaque-bit-input-v1. Verdict policy v1, [The bar](../../docs/README.md#the-bar).

- **nts C**: node: 75 WON, 14 LOSS, 12 SHORT, 3 UNAVAILABLE; Bun JIT: 66 WON, 22 LOSS, 13 SHORT, 3 UNAVAILABLE; Bun AOT: 54 WON, 34 LOSS, 13 TIE, 3 UNAVAILABLE; ScriptC: 68 WON, 17 LOSS, 13 TIE, 3 NOT_COMPARABLE, 3 UNAVAILABLE.
- **nts LLVM**: node: 74 WON, 15 LOSS, 12 SHORT, 3 UNAVAILABLE; Bun JIT: 64 WON, 22 LOSS, 15 SHORT, 3 UNAVAILABLE; Bun AOT: 50 WON, 33 LOSS, 18 TIE, 3 UNAVAILABLE; ScriptC: 68 WON, 17 LOSS, 13 TIE, 3 NOT_COMPARABLE, 3 UNAVAILABLE.
- **nts JVM**: node: 58 WON, 23 SHORT, 20 LOSS, 3 UNAVAILABLE; Bun JIT: 14 SHORT, 54 WON, 33 LOSS, 3 UNAVAILABLE; Bun AOT: 41 WON, 46 LOSS, 14 TIE, 3 UNAVAILABLE; ScriptC: 27 LOSS, 64 WON, 3 NOT_COMPARABLE, 7 TIE, 3 UNAVAILABLE.

Conditions: {"cpu":4,"sibling":5,"method":"ordinary with-lock --wait; all timed children CPU4; controller/builds exclude4-5; same input; five process launches per comparator; minimum plus spread","minimumMemAvailable":18740682752,"oneMinuteLoadRange":[0,18.52],"gateOverlapRows":["generic-classes","growth-fixed"],"cpu5SampleMilliseconds":100,"clockTicksPerSecond":100,"coreDumps":false}. Per-row conditions and sibling samples are retained in the run JSON. All ratios are within this run. Each backend is held separately to the bar: node and Bun JIT require 0.80×; Bun AOT/ScriptC ties use max(1.05, the two cells' observed spread). A refusal is not a timing.

Own-best values are per backend, using compatible machine, workload/input and harness contracts. Unknown historical identities and invalid cells are excluded. A slower-than-best flag is a cross-run observation with provenance, beside the current value. Historical runs with unknown completion times sort by the date recorded in their filename.

| Case | nts C | nts LLVM | nts JVM | C++ | Java | node | Bun JIT | Bun AOT | ScriptC | nts C/node | nts C/Bun JIT | nts C/Bun AOT | nts C/ScriptC | nts LLVM/node | nts LLVM/Bun JIT | nts LLVM/Bun AOT | nts LLVM/ScriptC | LLVM versus C | nts C own best | nts LLVM own best | nts JVM own best |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|absences|79.7 ns|81.2 ns|559.2 ns|78.5 ns|449.0 ns|810.9 ns|633.2 ns|547.0 ns|789.3 ns|0.098× WON|0.126× WON|0.146× WON|0.101× WON|0.100× WON|0.128× WON|0.148× WON|0.103× WON|1.019× **LLVM TRAILS C**|not established|not established|not established|
|accumulate|1.15 µs|949.3 ns|2.08 µs|943.7 ns|2.09 µs|2.75 µs|5.63 µs|2.75 µs|1.38 µs|0.417× WON|0.204× WON|0.417× WON|0.828× WON|0.345× WON|0.169× WON|0.345× WON|0.686× WON|0.828× **C TRAILS LLVM**|not established|not established|not established|
|array-copying-methods|20.90 µs|22.35 µs|28.65 µs|15.17 µs|8.44 µs|58.75 µs|44.01 µs|59.75 µs|28.68 µs|0.356× WON|0.475× WON|0.350× WON|0.729× WON|0.380× WON|0.508× WON|0.374× WON|0.779× WON|1.069× **LLVM TRAILS C**|not established|not established|not established|
|array-from|269.36 µs|270.23 µs|550.08 µs|508.47 µs|1.05 ms|466.81 µs|1.07 ms|805.38 µs|884.44 µs|0.577× WON|0.252× WON|0.334× WON|0.305× WON|0.579× WON|0.253× WON|0.336× WON|0.306× WON|1.003×|not established|not established|not established|
|array-methods|2.10 µs|2.38 µs|1.56 µs|2.21 µs|1.36 µs|5.75 µs|7.84 µs|5.10 µs|5.00 µs|0.365× WON|0.268× WON|0.412× WON|0.420× WON|0.414× WON|0.303× WON|0.467× WON|0.476× WON|1.133× **LLVM TRAILS C**|not established|not established|not established|
|array-mutations|792.4 ns|782.9 ns|1.69 µs|369.4 ns|2.70 µs|1.56 µs|3.35 µs|1.66 µs|1.21 µs|0.508× WON|0.236× WON|0.478× WON|0.655× WON|0.502× WON|0.233× WON|0.472× WON|0.647× WON|0.988×|not established|not established|not established|
|array-predicates|2.14 µs|2.17 µs|3.92 µs|2.35 µs|2.31 µs|5.84 µs|6.98 µs|2.25 µs|1.56 µs|0.367× WON|0.307× WON|0.952× TIE|1.374× LOSS|0.372× WON|0.311× WON|0.965× TIE|1.392× LOSS|1.013×|not established|not established|not established|
|arrays|1.32 µs|1.32 µs|1.38 µs|1.31 µs|1.31 µs|2.41 µs|2.03 µs|1.34 µs|1.48 µs|0.549× WON|0.652× WON|0.985× TIE|0.891× WON|0.549× WON|0.653× WON|0.986× TIE|0.892× WON|1.001×|not established|not established|not established|
|awfy-bounce|4.66 µs|4.66 µs|4.18 µs|4.39 µs|4.35 µs|11.94 µs|10.65 µs|5.19 µs|6.29 µs|0.391× WON|0.438× WON|0.899× WON|0.742× WON|0.390× WON|0.438× WON|0.898× WON|0.741× WON|0.999×|not established|not established|not established|
|awfy-list|9.68 µs|10.33 µs|10.21 µs|7.29 µs|8.29 µs|15.64 µs|12.91 µs|6.14 µs|9.07 µs|0.619× WON|0.750× WON|1.578× LOSS|1.068× LOSS|0.660× WON|0.800× SHORT|1.684× LOSS|1.139× LOSS|1.067× **LLVM TRAILS C**|not established|not established|not established|
|awfy-mandelbrot|22.38 ms|22.37 ms|21.04 ms|22.28 ms|26.20 ms|22.19 ms|21.95 ms|21.94 ms|22.28 ms|1.009× LOSS|1.019× LOSS|1.020× TIE|1.004× TIE|1.009× LOSS|1.019× LOSS|1.020× TIE|1.004× TIE|1.000×|not established|not established|not established|
|awfy-nbody|7.53 ms|7.66 ms|7.62 ms|6.43 ms|7.62 ms|78.96 ms|14.15 ms|7.07 ms|6.58 ms|0.095× WON|0.532× WON|1.064× LOSS|1.144× LOSS|0.097× WON|0.541× WON|1.083× LOSS|1.164× LOSS|1.017× **LLVM TRAILS C**|not established|not established|not established|
|awfy-permute|19.78 µs|22.51 µs|11.72 µs|9.77 µs|16.30 µs|20.84 µs|17.97 µs|16.45 µs|24.86 µs|0.949× SHORT|1.101× LOSS|1.203× LOSS|0.796× WON|1.080× LOSS|1.252× LOSS|1.368× LOSS|0.905× WON|1.138× **LLVM TRAILS C**|not established|not established|not established|
|awfy-queens|9.40 µs|9.39 µs|16.00 µs|5.28 µs|8.54 µs|16.71 µs|13.46 µs|11.50 µs|50.32 µs|0.563× WON|0.698× WON|0.817× WON|0.187× WON|0.562× WON|0.698× WON|0.817× WON|0.187× WON|0.999×|not established|not established|not established|
|awfy-sieve|3.41 µs|4.48 µs|5.28 µs|3.41 µs|4.34 µs|9.75 µs|7.18 µs|7.07 µs|6.89 µs|0.349× WON|0.474× WON|0.482× WON|0.495× WON|0.460× WON|0.624× WON|0.634× WON|0.651× WON|1.315× **LLVM TRAILS C**|not established|not established|not established|
|awfy-towers|30.06 µs|28.98 µs|25.30 µs|12.08 µs|18.33 µs|31.66 µs|19.62 µs|23.67 µs|80.38 µs|0.949× SHORT|1.532× LOSS|1.270× LOSS|0.374× WON|0.915× SHORT|1.477× LOSS|1.224× TIE|0.361× WON|0.964×|not established|not established|not established|
|bigint|363.5 ns|364.1 ns|708.0 ns|354.0 ns|3.88 µs|3.84 µs|3.25 µs|4.34 µs|1.06 µs|0.095× WON|0.112× WON|0.084× WON|0.343× WON|0.095× WON|0.112× WON|0.084× WON|0.344× WON|1.002×|not established|not established|not established|
|bytes|435.04 µs|435.26 µs|711.68 µs|433.05 µs|661.18 µs|536.54 µs|756.79 µs|594.51 µs|1.54 ms|0.811× SHORT|0.575× WON|0.732× WON|0.283× WON|0.811× SHORT|0.575× WON|0.732× WON|0.283× WON|1.001×|not established|not established|not established|
|case-convert|1.65 µs|1.63 µs|3.34 µs|6.01 µs|3.18 µs|3.06 µs|4.07 µs|1.61 µs|1.68 µs|0.538× WON|0.405× WON|1.022× TIE|0.981× TIE|0.531× WON|0.399× WON|1.009× TIE|0.968× TIE|0.987× **C TRAILS LLVM**|not established|not established|not established|
|case-convert-cjk|33.04 µs|33.29 µs|5.67 µs|NOT_PROVIDED|5.66 µs|5.92 µs|6.74 µs|7.53 µs|41.12 µs|5.583× LOSS|4.901× LOSS|4.391× LOSS|0.804× WON|5.625× LOSS|4.938× LOSS|4.424× LOSS|0.810× WON|1.008×|not established|not established|not established|
|case-convert-greek|72.83 µs|73.66 µs|14.87 µs|NOT_PROVIDED|14.49 µs|17.55 µs|21.09 µs|21.83 µs|62.39 µs|4.151× LOSS|3.454× LOSS|3.337× LOSS|1.167× LOSS|4.198× LOSS|3.493× LOSS|3.375× LOSS|1.181× LOSS|1.011×|not established|not established|not established|
|case-convert-latin1|39.85 µs|39.54 µs|8.93 µs|NOT_PROVIDED|9.50 µs|19.61 µs|21.29 µs|22.14 µs|40.89 µs|2.032× LOSS|1.872× LOSS|1.800× LOSS|0.975× TIE|2.016× LOSS|1.857× LOSS|1.786× LOSS|0.967× TIE|0.992×|not established|not established|not established|
|case-convert-unchanged|1.85 µs|1.84 µs|2.39 µs|8.08 µs|1.89 µs|2.92 µs|4.12 µs|1.55 µs|1.39 µs|0.632× WON|0.449× WON|1.193× LOSS|1.324× LOSS|0.631× WON|0.448× WON|1.192× LOSS|1.323× LOSS|0.999×|not established|not established|not established|
|checksum|5.03 µs|5.03 µs|5.04 µs|4.97 µs|5.04 µs|5.79 µs|7.95 µs|5.91 µs|5.16 µs|0.869× SHORT|0.633× WON|0.851× WON|0.976× TIE|0.870× SHORT|0.633× WON|0.852× WON|0.976× TIE|1.001×|not established|not established|not established|
|clbg-binary-trees|3.09 ms|3.04 ms|2.07 ms|10.65 ms|2.37 ms|3.72 ms|3.27 ms|2.21 ms|2.11 ms|0.831× SHORT|0.944× SHORT|1.398× LOSS|1.466× LOSS|0.817× SHORT|0.928× SHORT|1.375× LOSS|1.441× LOSS|0.983×|not established|not established|not established|
|clbg-fannkuch-redux|ABORTED|ABORTED|ABORTED|1.10 ms|1.21 ms|1.90 ms|2.04 ms|2.24 ms|2.51 ms|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-fasta|1.77 ms|1.78 ms|2.14 ms|331.94 µs|1.08 ms|1.52 ms|1.45 ms|1.23 ms|1.73 ms|1.161× LOSS|1.219× LOSS|1.432× LOSS|1.022× TIE|1.171× LOSS|1.229× LOSS|1.444× LOSS|1.030× TIE|1.009× **LLVM TRAILS C**|not established|not established|not established|
|clbg-k-nucleotide|983.32 µs|983.38 µs|1.15 ms|521.54 µs|874.13 µs|1.55 ms|1.41 ms|1.86 ms|1.08 ms|0.635× WON|0.696× WON|0.528× WON|0.908× WON|0.635× WON|0.696× WON|0.528× WON|0.908× WON|1.000×|not established|not established|not established|
|clbg-mandelbrot|2.54 ms|2.58 ms|2.43 ms|1.38 ms|2.88 ms|2.99 ms|2.54 ms|2.56 ms|2.50 ms|0.848× SHORT|0.998× SHORT|0.990× TIE|1.014× TIE|0.862× SHORT|1.014× LOSS|1.005× TIE|1.030× TIE|1.016×|not established|not established|not established|
|clbg-reverse-complement|REFUSED|REFUSED|REFUSED|508.97 µs|1.27 ms|4.18 ms|2.81 ms|2.13 ms|2.87 ms|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|
|clbg-spectral-norm|527.72 µs|529.70 µs|2.68 ms|439.34 µs|1.40 ms|550.00 µs|731.17 µs|1.03 ms|508.44 µs|0.959× SHORT|0.722× WON|0.515× WON|1.038× TIE|0.963× SHORT|0.724× WON|0.517× WON|1.042× TIE|1.004× **LLVM TRAILS C**|not established|not established|not established|
|closure-merge|463.0 ns|462.9 ns|2.66 µs|6.58 µs|2.14 µs|20.07 µs|4.34 µs|3.30 µs|16.94 µs|0.023× WON|0.107× WON|0.140× WON|0.027× WON|0.023× WON|0.107× WON|0.140× WON|0.027× WON|1.000×|not established|not established|not established|
|closures|410.4 ns|410.3 ns|1.97 µs|419.9 ns|2.32 µs|6.85 µs|3.84 µs|3.17 µs|5.79 µs|0.060× WON|0.107× WON|0.129× WON|0.071× WON|0.060× WON|0.107× WON|0.129× WON|0.071× WON|1.000×|not established|not established|not established|
|cyclic-churn|88.46 µs|86.76 µs|11.67 µs|26.71 µs|9.00 µs|9.31 µs|9.80 µs|7.88 µs|48.93 µs|9.503× LOSS|9.024× LOSS|11.225× LOSS|1.808× LOSS|9.321× LOSS|8.851× LOSS|11.010× LOSS|1.773× LOSS|0.981×|not established|not established|not established|
|dispatch|15.73 µs|9.61 µs|18.26 µs|15.58 µs|24.67 µs|45.91 µs|13.99 µs|19.24 µs|41.37 µs|0.343× WON|1.124× LOSS|0.818× WON|0.380× WON|0.209× WON|0.687× WON|0.499× WON|0.232× WON|0.611× **C TRAILS LLVM**|not established|not established|not established|
|elementwise|68.94 µs|69.74 µs|56.01 µs|68.92 µs|55.86 µs|542.65 µs|583.38 µs|394.56 µs|147.12 µs|0.127× WON|0.118× WON|0.175× WON|0.469× WON|0.129× WON|0.120× WON|0.177× WON|0.474× WON|1.012× **LLVM TRAILS C**|not established|not established|not established|
|erasure-stored-typed|71.07 µs|71.09 µs|74.53 µs|70.53 µs|76.41 µs|112.32 µs|71.58 µs|73.92 µs|72.34 µs|0.633× WON|0.993× SHORT|0.961× TIE|0.982× TIE|0.633× WON|0.993× SHORT|0.962× TIE|0.983× TIE|1.000× **LLVM TRAILS C**|not established|not established|not established|
|erasure-stored-unknown|70.36 µs|70.51 µs|74.21 µs|69.91 µs|74.78 µs|71.54 µs|71.79 µs|72.41 µs|9.19 ms|0.984× SHORT|0.980× SHORT|0.972× TIE|0.008× WON|0.986× SHORT|0.982× SHORT|0.974× TIE|0.008× WON|1.002×|not established|not established|not established|
|erasure-typed|133.88 µs|133.89 µs|133.95 µs|133.86 µs|133.90 µs|133.92 µs|133.92 µs|133.85 µs|OVER_BUDGET|1.000× SHORT|1.000× SHORT|1.000× TIE|NOT_COMPARABLE|1.000× SHORT|1.000× SHORT|1.000× TIE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|erasure-unknown|133.94 µs|133.95 µs|133.91 µs|133.94 µs|133.93 µs|133.92 µs|133.92 µs|133.85 µs|544.74 µs|1.000× LOSS|1.000× LOSS|1.001× TIE|0.246× WON|1.000× LOSS|1.000× LOSS|1.001× TIE|0.246× WON|1.000×|not established|not established|not established|
|event-state|96.0 ns|94.1 ns|98.1 ns|465.6 ns|74.3 ns|1.22 µs|153.3 ns|106.5 ns|118.7 ns|0.079× WON|0.626× WON|0.902× WON|0.809× WON|0.077× WON|0.614× WON|0.884× WON|0.793× WON|0.980× **C TRAILS LLVM**|not established|not established|not established|
|exceptions|6.71 µs|6.68 µs|11.57 µs|5.18 µs|3.12 ms|14.93 ms|1.97 ms|17.62 µs|731.69 µs|0.000× WON|0.003× WON|0.381× WON|0.009× WON|0.000× WON|0.003× WON|0.379× WON|0.009× WON|0.996×|not established|not established|not established|
|face-fields|3.17 µs|3.25 µs|9.37 µs|14.32 µs|30.29 µs|9.95 µs|5.35 µs|2.79 µs|134.72 µs|0.319× WON|0.594× WON|1.140× LOSS|0.024× WON|0.327× WON|0.609× WON|1.168× LOSS|0.024× WON|1.025× **LLVM TRAILS C**|not established|not established|not established|
|fib|501.62 µs|519.09 µs|479.92 µs|289.47 µs|464.00 µs|1.65 ms|752.22 µs|537.17 µs|319.43 µs|0.304× WON|0.667× WON|0.934× WON|1.570× LOSS|0.315× WON|0.690× WON|0.966× TIE|1.625× LOSS|1.035× **LLVM TRAILS C**|not established|not established|not established|
|generator|168.39 µs|169.82 µs|173.54 µs|172.01 µs|172.29 µs|3.12 ms|652.89 µs|144.38 µs|1.28 ms|0.054× WON|0.258× WON|1.166× LOSS|0.131× WON|0.054× WON|0.260× WON|1.176× LOSS|0.132× WON|1.008×|not established|not established|not established|
|generator-dispatched|172.09 µs|169.69 µs|172.57 µs|597.77 µs|176.85 µs|3.36 ms|947.67 µs|131.26 µs|1.45 ms|0.051× WON|0.182× WON|1.311× LOSS|0.119× WON|0.051× WON|0.179× WON|1.293× LOSS|0.117× WON|0.986×|not established|not established|not established|
|generic-classes|3.48 µs|3.22 µs|4.37 µs|3.40 µs|3.86 µs|4.59 µs|4.65 µs|4.46 µs|19.32 µs|0.758× WON|0.748× WON|0.779× WON|0.180× WON|0.702× WON|0.693× WON|0.722× WON|0.167× WON|0.926× **C TRAILS LLVM**|not established|not established|not established|
|growth-fixed|159.84 µs|160.13 µs|174.63 µs|159.38 µs|174.36 µs|320.85 µs|277.36 µs|250.05 µs|272.95 µs|0.498× WON|0.576× WON|0.639× WON|0.586× WON|0.499× WON|0.577× WON|0.640× WON|0.587× WON|1.002×|not established|not established|not established|
|growth-grown|159.87 µs|160.45 µs|181.09 µs|159.66 µs|174.27 µs|324.66 µs|265.84 µs|240.73 µs|273.08 µs|0.492× WON|0.601× WON|0.664× WON|0.585× WON|0.494× WON|0.604× WON|0.666× WON|0.588× WON|1.004×|not established|not established|not established|
|immutable-update|76.35 µs|76.45 µs|93.00 µs|24.75 µs|45.07 µs|99.07 µs|123.79 µs|67.75 µs|35.06 µs|0.771× WON|0.617× WON|1.127× LOSS|2.178× LOSS|0.772× WON|0.618× WON|1.128× LOSS|2.181× LOSS|1.001×|not established|not established|not established|
|in-narrowing|673.4 ns|681.6 ns|1.55 µs|672.5 ns|1.42 µs|11.50 µs|8.41 µs|2.02 µs|12.16 µs|0.059× WON|0.080× WON|0.333× WON|0.055× WON|0.059× WON|0.081× WON|0.337× WON|0.056× WON|1.012× **LLVM TRAILS C**|not established|not established|not established|
|instanceof|32.92 µs|32.92 µs|59.44 µs|33.46 µs|50.57 µs|1.06 ms|198.08 µs|43.95 µs|385.29 µs|0.031× WON|0.166× WON|0.749× WON|0.085× WON|0.031× WON|0.166× WON|0.749× WON|0.085× WON|1.000×|not established|not established|not established|
|json-build-append|8.66 µs|8.61 µs|13.32 µs|NOT_PROVIDED|NOT_PROVIDED|16.41 µs|7.71 µs|16.03 µs|22.52 µs|0.528× WON|1.122× LOSS|0.540× WON|0.384× WON|0.525× WON|1.116× LOSS|0.537× WON|0.382× WON|0.994×|not established|not established|not established|
|json-build-join|12.71 µs|12.61 µs|16.09 µs|NOT_PROVIDED|NOT_PROVIDED|22.84 µs|14.93 µs|15.97 µs|21.47 µs|0.557× WON|0.851× SHORT|0.796× WON|0.592× WON|0.552× WON|0.845× SHORT|0.789× WON|0.587× WON|0.992×|not established|not established|not established|
|json-parse|811.12 µs|874.12 µs|466.94 µs|NOT_PROVIDED|NOT_PROVIDED|558.27 µs|696.83 µs|435.59 µs|987.51 µs|1.453× LOSS|1.164× LOSS|1.862× LOSS|0.821× WON|1.566× LOSS|1.254× LOSS|2.007× LOSS|0.885× WON|1.078× **LLVM TRAILS C**|not established|not established|not established|
|json-quote|2.54 µs|2.53 µs|4.86 µs|4.45 µs|NOT_PROVIDED|8.91 µs|7.97 µs|4.39 µs|15.17 µs|0.285× WON|0.319× WON|0.580× WON|0.168× WON|0.284× WON|0.317× WON|0.577× WON|0.167× WON|0.995×|not established|not established|not established|
|json-scan|1.25 µs|1.61 µs|2.17 µs|NOT_PROVIDED|NOT_PROVIDED|1.97 µs|2.01 µs|1.48 µs|2.47 µs|0.634× WON|0.621× WON|0.839× WON|0.504× WON|0.820× SHORT|0.804× SHORT|1.087× TIE|0.652× WON|1.294× **LLVM TRAILS C**|not established|not established|not established|
|json-serialize|6.31 µs|6.30 µs|12.56 µs|NOT_PROVIDED|NOT_PROVIDED|12.74 µs|6.36 µs|8.03 µs|22.33 µs|0.495× WON|0.992× SHORT|0.785× WON|0.282× WON|0.495× WON|0.992× SHORT|0.785× WON|0.282× WON|1.000×|not established|not established|not established|
|json-stringify-builtin|329.78 µs|319.75 µs|756.16 µs|NOT_PROVIDED|NOT_PROVIDED|739.48 µs|239.99 µs|144.21 µs|REFUSED|0.446× WON|1.374× LOSS|2.287× LOSS|NOT_COMPARABLE|0.432× WON|1.332× LOSS|2.217× LOSS|NOT_COMPARABLE|0.970× **C TRAILS LLVM**|not established|not established|not established|
|json-stringify-doc|977.87 µs|1.04 ms|1.08 ms|NOT_PROVIDED|NOT_PROVIDED|1.46 ms|3.10 ms|860.89 µs|2.01 ms|0.668× WON|0.316× WON|1.136× LOSS|0.487× WON|0.708× WON|0.334× WON|1.203× LOSS|0.516× WON|1.059×|not established|not established|not established|
|json-stringify-fused|370.60 µs|383.97 µs|716.10 µs|NOT_PROVIDED|NOT_PROVIDED|742.84 µs|1.08 ms|345.20 µs|1.11 ms|0.499× WON|0.344× WON|1.074× LOSS|0.333× WON|0.517× WON|0.356× WON|1.112× LOSS|0.345× WON|1.036× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-inline|334.28 µs|340.75 µs|731.84 µs|NOT_PROVIDED|NOT_PROVIDED|852.86 µs|1.14 ms|408.70 µs|1.20 ms|0.392× WON|0.292× WON|0.818× WON|0.278× WON|0.400× WON|0.298× WON|0.834× WON|0.283× WON|1.019× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-typed|326.29 µs|337.86 µs|884.73 µs|NOT_PROVIDED|NOT_PROVIDED|873.10 µs|811.85 µs|620.16 µs|1.04 ms|0.374× WON|0.402× WON|0.526× WON|0.313× WON|0.387× WON|0.416× WON|0.545× WON|0.324× WON|1.035× **LLVM TRAILS C**|not established|not established|not established|
|logical-assignment|39.54 µs|31.80 µs|56.92 µs|31.40 µs|58.91 µs|347.84 µs|68.74 µs|67.53 µs|42.12 µs|0.114× WON|0.575× WON|0.586× WON|0.939× WON|0.091× WON|0.463× WON|0.471× WON|0.755× WON|0.804× **C TRAILS LLVM**|not established|not established|not established|
|loop|649.8 ns|650.1 ns|1.33 µs|653.5 ns|1.49 µs|669.9 ns|715.9 ns|661.4 ns|655.4 ns|0.970× SHORT|0.908× SHORT|0.983× TIE|0.991× TIE|0.971× SHORT|0.908× SHORT|0.983× TIE|0.992× TIE|1.001×|not established|not established|not established|
|map-and-set|4.60 µs|4.57 µs|6.22 µs|19.64 µs|10.94 µs|7.06 µs|5.19 µs|6.81 µs|4.16 µs|0.651× WON|0.885× SHORT|0.675× WON|1.105× LOSS|0.647× WON|0.879× SHORT|0.671× WON|1.097× LOSS|0.993×|not established|not established|not established|
|map-entries-top-k|15.68 µs|16.00 µs|16.11 µs|19.14 µs|12.39 µs|24.44 µs|20.46 µs|16.35 µs|12.50 µs|0.642× WON|0.766× WON|0.959× TIE|1.255× LOSS|0.655× WON|0.782× WON|0.979× TIE|1.280× LOSS|1.020× **LLVM TRAILS C**|not established|not established|not established|
|map-literal-keys|25.39 µs|26.65 µs|59.43 µs|107.99 µs|14.44 µs|48.10 µs|10.46 µs|41.21 µs|45.62 µs|0.528× WON|2.428× LOSS|0.616× WON|0.557× WON|0.554× WON|2.549× LOSS|0.647× WON|0.584× WON|1.050× **LLVM TRAILS C**|not established|not established|not established|
|map-word-counts|4.43 µs|4.48 µs|5.80 µs|9.76 µs|4.45 µs|7.75 µs|5.40 µs|4.66 µs|3.96 µs|0.572× WON|0.820× SHORT|0.950× WON|1.120× TIE|0.578× WON|0.830× SHORT|0.961× TIE|1.132× TIE|1.011×|not established|not established|not established|
|module-closures|829.3 ns|828.6 ns|4.67 µs|840.8 ns|4.43 µs|5.38 µs|6.82 µs|5.10 µs|26.42 µs|0.154× WON|0.122× WON|0.163× WON|0.031× WON|0.154× WON|0.122× WON|0.162× WON|0.031× WON|0.999×|not established|not established|not established|
|node-utf8|33.61 µs|32.70 µs|38.60 µs|NOT_PROVIDED|7.57 µs|39.46 µs|31.18 µs|53.28 µs|73.19 µs|0.852× SHORT|1.078× LOSS|0.631× WON|0.459× WON|0.829× SHORT|1.049× LOSS|0.614× WON|0.447× WON|0.973× **C TRAILS LLVM**|not established|not established|not established|
|number-format|681.5 ns|728.5 ns|877.7 ns|954.5 ns|870.9 ns|1.45 µs|900.7 ns|599.1 ns|1.44 µs|0.471× WON|0.757× WON|1.138× LOSS|0.474× WON|0.503× WON|0.809× SHORT|1.216× LOSS|0.506× WON|1.069× **LLVM TRAILS C**|not established|not established|not established|
|number-format-double|4.33 µs|4.34 µs|5.43 µs|NOT_PROVIDED|4.97 µs|9.26 µs|4.47 µs|4.48 µs|4.56 µs|0.468× WON|0.969× SHORT|0.968× TIE|0.951× TIE|0.469× WON|0.970× SHORT|0.969× TIE|0.952× TIE|1.001×|not established|not established|not established|
|objects|1.50 µs|1.49 µs|2.00 µs|1.50 µs|1.96 µs|1.92 µs|1.96 µs|2.05 µs|1.50 µs|0.782× WON|0.765× WON|0.730× WON|0.997× TIE|0.780× WON|0.762× WON|0.728× WON|0.994× TIE|0.997×|not established|not established|not established|
|optional-chain|26.11 µs|25.90 µs|64.96 µs|26.08 µs|33.50 µs|341.45 µs|139.40 µs|160.87 µs|997.92 µs|0.076× WON|0.187× WON|0.162× WON|0.026× WON|0.076× WON|0.186× WON|0.161× WON|0.026× WON|0.992×|not established|not established|not established|
|pipeline|24.84 µs|24.83 µs|59.16 µs|27.70 µs|58.40 µs|117.03 µs|110.23 µs|72.04 µs|22.11 µs|0.212× WON|0.225× WON|0.345× WON|1.123× LOSS|0.212× WON|0.225× WON|0.345× WON|1.123× LOSS|1.000×|not established|not established|not established|
|printer-erased|8.89 µs|9.64 µs|5.08 µs|NOT_PROVIDED|NOT_PROVIDED|16.68 µs|24.84 µs|32.68 µs|5.84 µs|0.533× WON|0.358× WON|0.272× WON|1.523× LOSS|0.578× WON|0.388× WON|0.295× WON|1.651× LOSS|1.084× **LLVM TRAILS C**|not established|not established|not established|
|record-word-counts|4.50 µs|4.42 µs|5.69 µs|13.02 µs|3.03 µs|7.82 µs|3.80 µs|5.46 µs|16.53 µs|0.575× WON|1.182× LOSS|0.823× WON|0.272× WON|0.564× WON|1.161× LOSS|0.809× WON|0.267× WON|0.982×|not established|not established|not established|
|release-acyclic|85.71 µs|86.37 µs|44.57 µs|166.07 µs|25.23 µs|28.21 µs|32.96 µs|23.68 µs|34.37 µs|3.038× LOSS|2.600× LOSS|3.619× LOSS|2.494× LOSS|3.062× LOSS|2.621× LOSS|3.647× LOSS|2.513× LOSS|1.008×|not established|not established|not established|
|sort-objects|50.23 µs|54.99 µs|88.61 µs|27.04 µs|10.84 µs|42.45 µs|27.05 µs|36.21 µs|66.10 µs|1.183× LOSS|1.857× LOSS|1.387× LOSS|0.760× WON|1.295× LOSS|2.033× LOSS|1.518× LOSS|0.832× WON|1.095× **LLVM TRAILS C**|not established|not established|not established|
|str-append-length|10.34 µs|10.86 µs|24.53 µs|10.53 µs|NOT_PROVIDED|7.45 µs|8.69 µs|5.22 µs|31.78 µs|1.389× LOSS|1.190× LOSS|1.981× LOSS|0.326× WON|1.457× LOSS|1.249× LOSS|2.079× LOSS|0.342× WON|1.049× **LLVM TRAILS C**|not established|not established|not established|
|str-append-loop|10.98 µs|10.89 µs|25.19 µs|9.97 µs|NOT_PROVIDED|41.48 µs|127.86 µs|8.56 µs|50.52 µs|0.265× WON|0.086× WON|1.283× LOSS|0.217× WON|0.263× WON|0.085× WON|1.272× LOSS|0.216× WON|0.992×|not established|not established|not established|
|str-compare|4.50 µs|4.42 µs|3.20 µs|6.94 µs|NOT_PROVIDED|4.27 µs|5.88 µs|2.79 µs|35.18 µs|1.054× LOSS|0.765× WON|1.613× LOSS|0.128× WON|1.036× LOSS|0.752× WON|1.586× LOSS|0.126× WON|0.983× **C TRAILS LLVM**|not established|not established|not established|
|str-concat-pair|2.45 µs|2.53 µs|3.57 µs|2.37 µs|NOT_PROVIDED|17.76 µs|29.01 µs|6.53 µs|9.77 µs|0.138× WON|0.084× WON|0.375× WON|0.250× WON|0.142× WON|0.087× WON|0.387× WON|0.259× WON|1.034× **LLVM TRAILS C**|not established|not established|not established|
|str-equal|1.10 µs|1.11 µs|1.22 µs|936.6 ns|NOT_PROVIDED|1.84 µs|1.19 µs|1.15 µs|1.64 µs|0.594× WON|0.922× SHORT|0.955× TIE|0.668× WON|0.599× WON|0.930× SHORT|0.964× TIE|0.675× WON|1.009×|not established|not established|not established|
|str-index-of|8.88 µs|8.91 µs|5.32 µs|7.52 µs|NOT_PROVIDED|9.28 µs|5.66 µs|4.25 µs|6.72 µs|0.957× SHORT|1.570× LOSS|2.090× LOSS|1.322× LOSS|0.960× SHORT|1.574× LOSS|2.096× LOSS|1.325× LOSS|1.003×|not established|not established|not established|
|str-index-read|1.31 µs|1.38 µs|2.73 µs|264.4 ns|NOT_PROVIDED|2.95 µs|4.45 µs|10.33 µs|11.11 µs|0.442× WON|0.294× WON|0.126× WON|0.118× WON|0.467× WON|0.310× WON|0.133× WON|0.124× WON|1.055× **LLVM TRAILS C**|not established|not established|not established|
|str-join|1.02 µs|1.05 µs|2.08 µs|1.24 µs|NOT_PROVIDED|3.96 µs|7.18 µs|820.5 ns|1.35 µs|0.258× WON|0.143× WON|1.247× LOSS|0.760× WON|0.266× WON|0.147× WON|1.285× LOSS|0.783× WON|1.031×|not established|not established|not established|
|str-map-keys|3.68 µs|3.69 µs|4.44 µs|7.56 µs|NOT_PROVIDED|5.29 µs|5.45 µs|2.79 µs|3.13 µs|0.695× WON|0.675× WON|1.315× LOSS|1.176× LOSS|0.698× WON|0.678× WON|1.320× LOSS|1.180× LOSS|1.004×|not established|not established|not established|
|str-slice-keep|3.01 µs|2.96 µs|4.89 µs|2.34 µs|NOT_PROVIDED|2.90 µs|6.39 µs|1.79 µs|4.42 µs|1.038× LOSS|0.472× WON|1.683× LOSS|0.681× WON|1.020× LOSS|0.463× WON|1.654× LOSS|0.670× WON|0.983×|not established|not established|not established|
|str-split|14.08 µs|14.29 µs|9.09 µs|3.37 µs|NOT_PROVIDED|13.37 µs|16.77 µs|6.66 µs|6.31 µs|1.053× LOSS|0.839× SHORT|2.113× LOSS|2.231× LOSS|1.068× LOSS|0.852× SHORT|2.145× LOSS|2.264× LOSS|1.015×|not established|not established|not established|
|str-template|6.51 µs|6.46 µs|7.72 µs|4.57 µs|NOT_PROVIDED|22.32 µs|26.22 µs|11.14 µs|10.97 µs|0.292× WON|0.248× WON|0.585× WON|0.594× WON|0.290× WON|0.246× WON|0.580× WON|0.589× WON|0.992×|not established|not established|not established|
|str-to-number|2.92 µs|3.01 µs|5.53 µs|1.63 µs|NOT_PROVIDED|4.03 µs|2.86 µs|2.28 µs|4.23 µs|0.725× WON|1.022× LOSS|1.282× LOSS|0.690× WON|0.747× WON|1.053× LOSS|1.321× LOSS|0.710× WON|1.030×|not established|not established|not established|
|strings|368.0 ns|368.0 ns|1.49 µs|458.3 ns|1.49 µs|2.44 µs|2.59 µs|2.34 µs|14.15 µs|0.151× WON|0.142× WON|0.157× WON|0.026× WON|0.151× WON|0.142× WON|0.157× WON|0.026× WON|1.000×|not established|not established|not established|
|substrings|1.44 µs|1.38 µs|2.54 µs|1.77 µs|5.33 µs|7.41 µs|25.51 µs|2.76 µs|9.07 µs|0.195× WON|0.056× WON|0.521× WON|0.159× WON|0.186× WON|0.054× WON|0.498× WON|0.152× WON|0.956× **C TRAILS LLVM**|not established|not established|not established|
|symbol-keyed-map|14.77 µs|16.37 µs|14.59 µs|13.74 µs|8.18 µs|38.17 µs|8.31 µs|18.85 µs|30.65 µs|0.387× WON|1.778× LOSS|0.783× WON|0.482× WON|0.429× WON|1.971× LOSS|0.869× WON|0.534× WON|1.109×|not established|not established|not established|
|symbol-keys|314.9 ns|319.6 ns|396.6 ns|317.5 ns|321.5 ns|1.70 µs|484.2 ns|578.9 ns|1.56 µs|0.185× WON|0.650× WON|0.544× WON|0.201× WON|0.188× WON|0.660× WON|0.552× WON|0.204× WON|1.015× **LLVM TRAILS C**|not established|not established|not established|
|tree-teardown|26.15 µs|27.72 µs|29.24 µs|132.04 µs|27.93 µs|47.26 µs|48.98 µs|28.45 µs|27.43 µs|0.553× WON|0.534× WON|0.919× WON|0.954× TIE|0.586× WON|0.566× WON|0.974× TIE|1.010× TIE|1.060×|not established|not established|not established|
|uniform-callback|392.1 ns|391.8 ns|2.92 µs|NOT_PROVIDED|NOT_PROVIDED|3.55 µs|983.8 ns|365.5 ns|11.54 µs|0.110× WON|0.399× WON|1.073× LOSS|0.034× WON|0.110× WON|0.398× WON|1.072× LOSS|0.034× WON|0.999×|not established|not established|not established|
|uniform-callback-arguments|841.5 ns|843.6 ns|2.97 µs|NOT_PROVIDED|NOT_PROVIDED|4.68 µs|1.26 µs|2.13 µs|29.26 µs|0.180× WON|0.670× WON|0.395× WON|0.029× WON|0.180× WON|0.672× WON|0.396× WON|0.029× WON|1.002×|not established|not established|not established|
|uniform-callback-default|484.6 ns|486.3 ns|2.89 µs|NOT_PROVIDED|NOT_PROVIDED|3.66 µs|1.01 µs|359.6 ns|REFUSED|0.132× WON|0.482× WON|1.348× LOSS|NOT_COMPARABLE|0.133× WON|0.484× WON|1.352× LOSS|NOT_COMPARABLE|1.003×|not established|not established|not established|
|upcast|4.52 µs|5.47 µs|8.37 µs|4.05 µs|8.18 µs|10.13 µs|13.39 µs|2.17 µs|10.60 µs|0.446× WON|0.338× WON|2.081× LOSS|0.426× WON|0.540× WON|0.409× WON|2.519× LOSS|0.516× WON|1.210× **LLVM TRAILS C**|not established|not established|not established|
|user-iterable|29.48 µs|29.63 µs|54.22 µs|35.41 µs|373.65 µs|419.23 µs|181.30 µs|342.29 µs|321.62 µs|0.070× WON|0.163× WON|0.086× WON|0.092× WON|0.071× WON|0.163× WON|0.087× WON|0.092× WON|1.005×|not established|not established|not established|
|utf8-encode|REFUSED|REFUSED|REFUSED|2.36 µs|NOT_PROVIDED|17.71 µs|5.25 µs|2.21 µs|1.37 µs|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|unavailable|not established|not established|not established|

- case-convert-cjk, C++: NOT_PROVIDED: NOT PROVIDED
- case-convert-greek, C++: NOT_PROVIDED: NOT PROVIDED
- case-convert-latin1, C++: NOT_PROVIDED: NOT PROVIDED
- str-index-of, Java: NOT_PROVIDED: NOT PROVIDED
- str-to-number, Java: NOT_PROVIDED: NOT PROVIDED
- str-append-length, Java: NOT_PROVIDED: NOT PROVIDED
- erasure-typed, ScriptC: OVER_BUDGET: timeout: the monitored command dumped core
- json-parse, C++: NOT_PROVIDED: NOT PROVIDED
- json-parse, Java: NOT_PROVIDED: NOT PROVIDED
- json-stringify-builtin, C++: NOT_PROVIDED: NOT PROVIDED
- json-stringify-builtin, Java: NOT_PROVIDED: NOT PROVIDED
- json-stringify-builtin, ScriptC: REFUSED: union conversion has no unambiguous layout mapping: expected 'string', got 'string \| undefined' (each source arm needs an identical destination arm, a unique compatible record/array layout, or a shared literal discriminant selecting compatible layouts)
- clbg-fannkuch-redux, nts C: ABORTED: {"kind":"runtime-abort","termination":{"kind":"signal","signal":6},"stderr":"nts: refused: index 7 is outside [0, 1)\n"}
- clbg-fannkuch-redux, nts LLVM: ABORTED: {"kind":"runtime-abort","termination":{"kind":"signal","signal":6},"stderr":"nts: refused: index 7 is outside [0, 1)\n"}
- clbg-fannkuch-redux, nts JVM: ABORTED: {"kind":"runtime-abort","termination":{"kind":"exit","code":1},"stderr":"Exception in thread \"main\" nts.rt.NtsRefusal: nts: refused: index 7 is outside [0, 1)\n\tat nts.rt.NtsRuntime.outside(NtsRuntime.java:1857)\n\tat nts.rt.NtsRuntime.outOfRange(NtsRuntime.java:1853)\n\tat nts.rt.NtsArrays.writableSlot(NtsArrays.java:32)\n\tat nts.rt.NtsArrayD.set(NtsArrayD.java:95)\n\tat nts.gen.Program.render(nts:21)\n\tat nts.gen.Program.work$whole(nts:3)\n\tat nts.gen.Program.work(nts:1)\n\tat Case$1.run(Case.java:7)\n\tat Bench.measure(Bench.java:39)\n\tat Case.main(Case.java:5)\n"}
- clbg-reverse-complement, nts C: REFUSED: {"outcomes":{},"jvm":null,"cpp":null}
- clbg-reverse-complement, nts LLVM: REFUSED: {"outcomes":{},"jvm":null,"cpp":null}
- clbg-reverse-complement, nts JVM: REFUSED: {"outcomes":{},"jvm":null,"cpp":null}
- json-build-append, C++: NOT_PROVIDED: NOT PROVIDED
- json-build-append, Java: NOT_PROVIDED: NOT PROVIDED
- json-build-join, C++: NOT_PROVIDED: NOT PROVIDED
- json-build-join, Java: NOT_PROVIDED: NOT PROVIDED
- json-quote, Java: NOT_PROVIDED: NOT PROVIDED
- json-scan, C++: NOT_PROVIDED: NOT PROVIDED
- json-scan, Java: NOT_PROVIDED: NOT PROVIDED
- json-serialize, C++: NOT_PROVIDED: NOT PROVIDED
- json-serialize, Java: NOT_PROVIDED: NOT PROVIDED
- json-stringify-doc, C++: NOT_PROVIDED: NOT PROVIDED
- json-stringify-doc, Java: NOT_PROVIDED: NOT PROVIDED
- json-stringify-fused, C++: NOT_PROVIDED: NOT PROVIDED
- json-stringify-fused, Java: NOT_PROVIDED: NOT PROVIDED
- json-stringify-inline, C++: NOT_PROVIDED: NOT PROVIDED
- json-stringify-inline, Java: NOT_PROVIDED: NOT PROVIDED
- node-utf8, C++: NOT_PROVIDED: NOT PROVIDED
- number-format-double, C++: NOT_PROVIDED: NOT PROVIDED
- printer-erased, C++: NOT_PROVIDED: NOT PROVIDED
- printer-erased, Java: NOT_PROVIDED: NOT PROVIDED
- str-append-loop, Java: NOT_PROVIDED: NOT PROVIDED
- str-compare, Java: NOT_PROVIDED: NOT PROVIDED
- str-concat-pair, Java: NOT_PROVIDED: NOT PROVIDED
- str-equal, Java: NOT_PROVIDED: NOT PROVIDED
- str-index-read, Java: NOT_PROVIDED: NOT PROVIDED
- str-join, Java: NOT_PROVIDED: NOT PROVIDED
- str-map-keys, Java: NOT_PROVIDED: NOT PROVIDED
- str-slice-keep, Java: NOT_PROVIDED: NOT PROVIDED
- str-split, Java: NOT_PROVIDED: NOT PROVIDED
- str-template, Java: NOT_PROVIDED: NOT PROVIDED
- uniform-callback, C++: NOT_PROVIDED: NOT PROVIDED
- uniform-callback, Java: NOT_PROVIDED: NOT PROVIDED
- uniform-callback-arguments, C++: NOT_PROVIDED: NOT PROVIDED
- uniform-callback-arguments, Java: NOT_PROVIDED: NOT PROVIDED
- uniform-callback-default, C++: NOT_PROVIDED: NOT PROVIDED
- uniform-callback-default, Java: NOT_PROVIDED: NOT PROVIDED
- uniform-callback-default, ScriptC: REFUSED: functions with optional or defaulted parameters as values, except where the target type spells the completed signature with required parameters (a '(x?: T) => R' function flows into a '(x: T \| undefined) => R' slot, and a package/'any' slot takes any natively representable signature; otherwise call the function directly) are not supported yet
- utf8-encode, nts C: REFUSED: {"outcomes":{},"jvm":null,"cpp":null}
- utf8-encode, nts LLVM: REFUSED: {"outcomes":{},"jvm":null,"cpp":null}
- utf8-encode, nts JVM: REFUSED: {"outcomes":{},"jvm":null,"cpp":null}
- utf8-encode, Java: NOT_PROVIDED: NOT PROVIDED
- json-stringify-typed, C++: NOT_PROVIDED: NOT PROVIDED
- json-stringify-typed, Java: NOT_PROVIDED: NOT PROVIDED
