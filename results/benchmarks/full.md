# Benchmark results

Newest complete run: [2026-10-23-1d91ace6da2b-full-table](runs/2026-10-23-1d91ace6da2b-full-table.json). Compiler null; source 1d91ace6da2bc71a64c1cab2d20686e271002cc3. Harness legacy-report-artifact-sha256:a548cc06079611e9f352e015139b9c6f89f3a2708bf08d3a26be3140af215585; contract unknown (historical). Verdict policy v1, [The bar](../../docs/README.md#the-bar).

- **nts C**: node: 38 WON, 17 LOSS, 8 SHORT; Bun JIT: 34 WON, 21 LOSS, 8 SHORT; Bun AOT: 63 NOT_COMPARABLE; ScriptC: 63 NOT_COMPARABLE.
- **nts LLVM**: node: 38 WON, 18 LOSS, 7 SHORT; Bun JIT: 35 WON, 21 LOSS, 7 SHORT; Bun AOT: 63 NOT_COMPARABLE; ScriptC: 63 NOT_COMPARABLE.
- **nts JVM**: node: 33 WON, 16 LOSS, 14 SHORT; Bun JIT: 9 SHORT, 34 WON, 20 LOSS; Bun AOT: 63 NOT_COMPARABLE; ScriptC: 63 NOT_COMPARABLE.

Conditions: {"availability":"not retained"}. Per-row conditions and sibling samples are retained in the run JSON. All ratios are within this run. Each backend is held separately to the bar: node and Bun JIT require 0.80×; Bun AOT/ScriptC ties use max(1.05, the two cells' observed spread). A refusal is not a timing.

Own-best values are per backend, using compatible machine, workload/input and harness contracts. Unknown historical identities and invalid cells are excluded. A slower-than-best flag is a cross-run observation with provenance, beside the current value. Historical runs with unknown completion times sort by the date recorded in their filename.

| Case | nts C | nts LLVM | nts JVM | C++ | Java | node | Bun JIT | Bun AOT | ScriptC | nts C/node | nts C/Bun JIT | nts C/Bun AOT | nts C/ScriptC | nts LLVM/node | nts LLVM/Bun JIT | nts LLVM/Bun AOT | nts LLVM/ScriptC | LLVM versus C | nts C own best | nts LLVM own best | nts JVM own best |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|absences|191.5 ns (legacy unverified)|190.9 ns (legacy unverified)|588.5 ns (legacy unverified)|191.5 ns (legacy unverified)|460.9 ns (legacy unverified)|830.3 ns (legacy unverified)|676.3 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.231× WON|0.283× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.230× WON|0.282× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.997×|not established|not established|not established|
|accumulate|1.49 µs (legacy unverified)|1.14 µs (legacy unverified)|2.10 µs (legacy unverified)|1.19 µs (legacy unverified)|2.12 µs (legacy unverified)|2.93 µs (legacy unverified)|21.64 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.509× WON|0.069× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.389× WON|0.053× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.765×|not established|not established|not established|
|array-from|2.14 ms (legacy unverified)|2.14 ms (legacy unverified)|1.24 ms (legacy unverified)|527.90 µs (legacy unverified)|1.07 ms (legacy unverified)|489.36 µs (legacy unverified)|1.26 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|4.373× LOSS|1.698× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|4.373× LOSS|1.698× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|array-methods|1.33 µs (legacy unverified)|1.31 µs (legacy unverified)|1.63 µs (legacy unverified)|1.05 µs (legacy unverified)|1.41 µs (legacy unverified)|5.99 µs (legacy unverified)|7.91 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.222× WON|0.168× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.219× WON|0.166× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.985×|not established|not established|not established|
|array-mutations|707.4 ns (legacy unverified)|706.2 ns (legacy unverified)|1.73 µs (legacy unverified)|565.5 ns (legacy unverified)|2.59 µs (legacy unverified)|1.76 µs (legacy unverified)|3.75 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.402× WON|0.189× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.401× WON|0.188× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.998×|not established|not established|not established|
|array-predicates|2.29 µs (legacy unverified)|2.24 µs (legacy unverified)|3.84 µs (legacy unverified)|2.49 µs (legacy unverified)|2.18 µs (legacy unverified)|4.68 µs (legacy unverified)|5.43 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.489× WON|0.422× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.479× WON|0.413× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.978×|not established|not established|not established|
|arrays|1.37 µs (legacy unverified)|1.43 µs (legacy unverified)|1.41 µs (legacy unverified)|1.34 µs (legacy unverified)|1.34 µs (legacy unverified)|2.53 µs (legacy unverified)|2.15 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.542× WON|0.637× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.565× WON|0.665× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.044× **LLVM TRAILS C**|not established|not established|not established|
|awfy-bounce|6.07 µs (legacy unverified)|6.42 µs (legacy unverified)|4.88 µs (legacy unverified)|4.40 µs (legacy unverified)|4.76 µs (legacy unverified)|13.47 µs (legacy unverified)|11.95 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.451× WON|0.508× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.477× WON|0.537× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.058× **LLVM TRAILS C**|not established|not established|not established|
|awfy-list|7.77 µs (legacy unverified)|7.53 µs (legacy unverified)|8.07 µs (legacy unverified)|7.88 µs (legacy unverified)|8.67 µs (legacy unverified)|16.66 µs (legacy unverified)|13.62 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.466× WON|0.570× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.452× WON|0.553× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.969×|not established|not established|not established|
|awfy-mandelbrot|22.68 ms (legacy unverified)|23.81 ms (legacy unverified)|23.03 ms (legacy unverified)|23.34 ms (legacy unverified)|27.57 ms (legacy unverified)|23.11 ms (legacy unverified)|23.09 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.981× SHORT|0.982× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.030× LOSS|1.031× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.050× **LLVM TRAILS C**|not established|not established|not established|
|awfy-nbody|7.75 ms (legacy unverified)|8.05 ms (legacy unverified)|7.97 ms (legacy unverified)|7.00 ms (legacy unverified)|7.97 ms (legacy unverified)|81.63 ms (legacy unverified)|15.36 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.095× WON|0.505× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.099× WON|0.524× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.039× **LLVM TRAILS C**|not established|not established|not established|
|awfy-permute|14.33 µs (legacy unverified)|14.40 µs (legacy unverified)|19.10 µs (legacy unverified)|10.75 µs (legacy unverified)|17.60 µs (legacy unverified)|21.76 µs (legacy unverified)|16.99 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.659× WON|0.843× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.662× WON|0.848× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.005× **LLVM TRAILS C**|not established|not established|not established|
|awfy-queens|11.62 µs (legacy unverified)|11.04 µs (legacy unverified)|16.09 µs (legacy unverified)|5.42 µs (legacy unverified)|8.98 µs (legacy unverified)|17.73 µs (legacy unverified)|14.97 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.655× WON|0.776× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.623× WON|0.737× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.950×|not established|not established|not established|
|awfy-sieve|6.98 µs (legacy unverified)|4.74 µs (legacy unverified)|5.59 µs (legacy unverified)|3.55 µs (legacy unverified)|4.66 µs (legacy unverified)|10.19 µs (legacy unverified)|10.62 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.685× WON|0.657× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.465× WON|0.446× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.679×|not established|not established|not established|
|awfy-towers|20.65 µs (legacy unverified)|21.12 µs (legacy unverified)|21.16 µs (legacy unverified)|11.73 µs (legacy unverified)|18.77 µs (legacy unverified)|32.37 µs (legacy unverified)|21.15 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.638× WON|0.976× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.652× WON|0.999× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.023× **LLVM TRAILS C**|not established|not established|not established|
|bigint|359.2 ns (legacy unverified)|343.7 ns (legacy unverified)|669.1 ns (legacy unverified)|342.4 ns (legacy unverified)|3.77 µs (legacy unverified)|3.69 µs (legacy unverified)|3.82 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.097× WON|0.094× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.093× WON|0.090× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.957×|not established|not established|not established|
|bytes|458.67 µs (legacy unverified)|468.20 µs (legacy unverified)|712.89 µs (legacy unverified)|440.03 µs (legacy unverified)|688.93 µs (legacy unverified)|512.41 µs (legacy unverified)|760.49 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.895× SHORT|0.603× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.914× SHORT|0.616× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.021× **LLVM TRAILS C**|not established|not established|not established|
|case-convert|3.90 µs (legacy unverified)|3.90 µs (legacy unverified)|3.28 µs (legacy unverified)|6.12 µs (legacy unverified)|3.40 µs (legacy unverified)|3.13 µs (legacy unverified)|3.73 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.246× LOSS|1.046× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.246× LOSS|1.046× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|checksum|5.03 µs (legacy unverified)|4.80 µs (legacy unverified)|5.04 µs (legacy unverified)|5.03 µs (legacy unverified)|5.04 µs (legacy unverified)|5.60 µs (legacy unverified)|23.99 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.898× SHORT|0.210× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.857× SHORT|0.200× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.954×|not established|not established|not established|
|closure-merge|19.60 µs (legacy unverified)|20.09 µs (legacy unverified)|32.02 µs (legacy unverified)|7.31 µs (legacy unverified)|2.13 µs (legacy unverified)|20.59 µs (legacy unverified)|12.44 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.952× SHORT|1.576× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.976× SHORT|1.615× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.025× **LLVM TRAILS C**|not established|not established|not established|
|closures|1.14 µs (legacy unverified)|1.14 µs (legacy unverified)|1.98 µs (legacy unverified)|1.11 µs (legacy unverified)|2.34 µs (legacy unverified)|3.22 µs (legacy unverified)|18.41 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.354× WON|0.062× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.354× WON|0.062× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|dispatch|22.30 µs (legacy unverified)|29.32 µs (legacy unverified)|27.74 µs (legacy unverified)|29.31 µs (legacy unverified)|25.65 µs (legacy unverified)|40.10 µs (legacy unverified)|14.30 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.556× WON|1.559× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.731× WON|2.050× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.315× **LLVM TRAILS C**|not established|not established|not established|
|elementwise|126.17 µs (legacy unverified)|126.12 µs (legacy unverified)|60.90 µs (legacy unverified)|150.88 µs (legacy unverified)|56.80 µs (legacy unverified)|927.87 µs (legacy unverified)|596.39 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.136× WON|0.212× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.136× WON|0.211× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|erasure-stored-typed|71.76 µs (legacy unverified)|74.56 µs (legacy unverified)|70.48 µs (legacy unverified)|70.65 µs (legacy unverified)|72.74 µs (legacy unverified)|117.19 µs (legacy unverified)|71.82 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.612× WON|0.999× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.636× WON|1.038× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.039× **LLVM TRAILS C**|not established|not established|not established|
|erasure-stored-unknown|73.80 µs (legacy unverified)|72.56 µs (legacy unverified)|71.77 µs (legacy unverified)|70.79 µs (legacy unverified)|73.40 µs (legacy unverified)|88.46 µs (legacy unverified)|72.82 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.834× SHORT|1.013× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.820× SHORT|0.996× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.983×|not established|not established|not established|
|erasure-typed|134.05 µs (legacy unverified)|136.31 µs (legacy unverified)|134.42 µs (legacy unverified)|135.13 µs (legacy unverified)|138.09 µs (legacy unverified)|137.67 µs (legacy unverified)|84.26 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.974× SHORT|1.591× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.990× SHORT|1.618× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.017× **LLVM TRAILS C**|not established|not established|not established|
|erasure-unknown|138.10 µs (legacy unverified)|140.91 µs (legacy unverified)|137.57 µs (legacy unverified)|136.80 µs (legacy unverified)|137.02 µs (legacy unverified)|136.58 µs (legacy unverified)|86.41 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.011× LOSS|1.598× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.032× LOSS|1.631× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.020× **LLVM TRAILS C**|not established|not established|not established|
|event-state|161.8 ns (legacy unverified)|156.2 ns (legacy unverified)|138.8 ns (legacy unverified)|486.1 ns (legacy unverified)|78.5 ns (legacy unverified)|1.25 µs (legacy unverified)|158.2 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.129× WON|1.023× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.125× WON|0.987× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.965×|not established|not established|not established|
|exceptions|35.18 µs (legacy unverified)|33.62 µs (legacy unverified)|34.09 µs (legacy unverified)|21.43 µs (legacy unverified)|3.15 ms (legacy unverified)|14.64 ms (legacy unverified)|2.61 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.002× WON|0.013× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.002× WON|0.013× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.956×|not established|not established|not established|
|face-fields|27.47 µs (legacy unverified)|28.47 µs (legacy unverified)|29.32 µs (legacy unverified)|13.82 µs (legacy unverified)|32.08 µs (legacy unverified)|9.68 µs (legacy unverified)|5.31 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|2.838× LOSS|5.173× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|2.941× LOSS|5.362× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.036× **LLVM TRAILS C**|not established|not established|not established|
|fib|532.48 µs (legacy unverified)|531.22 µs (legacy unverified)|501.70 µs (legacy unverified)|307.14 µs (legacy unverified)|479.41 µs (legacy unverified)|1.01 ms (legacy unverified)|690.40 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.527× WON|0.771× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.526× WON|0.769× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.998×|not established|not established|not established|
|generator|179.58 µs (legacy unverified)|177.73 µs (legacy unverified)|170.42 µs (legacy unverified)|169.77 µs (legacy unverified)|169.80 µs (legacy unverified)|3.29 ms (legacy unverified)|3.39 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.055× WON|0.053× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.054× WON|0.052× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.990×|not established|not established|not established|
|generator-dispatched|607.41 µs (legacy unverified)|605.60 µs (legacy unverified)|171.99 µs (legacy unverified)|585.78 µs (legacy unverified)|173.63 µs (legacy unverified)|3.26 ms (legacy unverified)|855.31 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.186× WON|0.710× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.186× WON|0.708× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.997×|not established|not established|not established|
|generic-classes|192.9 ns (legacy unverified)|198.4 ns (legacy unverified)|1.64 µs (legacy unverified)|196.9 ns (legacy unverified)|1.46 µs (legacy unverified)|1.45 µs (legacy unverified)|2.00 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.133× WON|0.096× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.137× WON|0.099× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.029× **LLVM TRAILS C**|not established|not established|not established|
|growth-fixed|157.74 µs (legacy unverified)|158.05 µs (legacy unverified)|168.94 µs (legacy unverified)|153.62 µs (legacy unverified)|174.14 µs (legacy unverified)|321.07 µs (legacy unverified)|277.22 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.491× WON|0.569× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.492× WON|0.570× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.002× **LLVM TRAILS C**|not established|not established|not established|
|growth-grown|631.43 µs (legacy unverified)|628.19 µs (legacy unverified)|219.51 µs (legacy unverified)|154.39 µs (legacy unverified)|171.31 µs (legacy unverified)|316.19 µs (legacy unverified)|279.71 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.997× LOSS|2.257× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.987× LOSS|2.246× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.995×|not established|not established|not established|
|in-narrowing|1.51 µs (legacy unverified)|1.56 µs (legacy unverified)|1.44 µs (legacy unverified)|1.49 µs (legacy unverified)|1.42 µs (legacy unverified)|10.60 µs (legacy unverified)|11.05 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.142× WON|0.137× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.147× WON|0.141× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.033× **LLVM TRAILS C**|not established|not established|not established|
|instanceof|46.50 µs (legacy unverified)|47.17 µs (legacy unverified)|51.95 µs (legacy unverified)|72.03 µs (legacy unverified)|45.05 µs (legacy unverified)|983.52 µs (legacy unverified)|199.46 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.047× WON|0.233× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.048× WON|0.236× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.014× **LLVM TRAILS C**|not established|not established|not established|
|json-build-append|24.58 µs (legacy unverified)|24.53 µs (legacy unverified)|16.35 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|15.16 µs (legacy unverified)|7.74 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.621× LOSS|3.176× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.618× LOSS|3.169× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.998×|not established|not established|not established|
|json-build-join|23.11 µs (legacy unverified)|22.95 µs (legacy unverified)|14.90 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|21.06 µs (legacy unverified)|13.11 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.097× LOSS|1.763× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.090× LOSS|1.751× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.993×|not established|not established|not established|
|json-parse|1.66 ms (legacy unverified)|1.64 ms (legacy unverified)|709.92 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|806.98 µs (legacy unverified)|1.25 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|2.057× LOSS|1.328× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|2.032× LOSS|1.312× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.988×|not established|not established|not established|
|json-scan|1.97 µs (legacy unverified)|1.83 µs (legacy unverified)|2.30 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.80 µs (legacy unverified)|1.98 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.094× LOSS|0.995× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.017× LOSS|0.924× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.929×|not established|not established|not established|
|json-serialize|16.74 µs (legacy unverified)|16.52 µs (legacy unverified)|15.37 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|12.58 µs (legacy unverified)|7.29 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.331× LOSS|2.296× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.313× LOSS|2.266× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.987×|not established|not established|not established|
|json-stringify-doc|5.04 ms (legacy unverified)|5.22 ms (legacy unverified)|1.15 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.42 ms (legacy unverified)|2.95 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|3.549× LOSS|1.708× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|3.676× LOSS|1.769× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.036× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-fused|760.41 µs (legacy unverified)|750.01 µs (legacy unverified)|737.84 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|715.48 µs (legacy unverified)|1.78 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.063× LOSS|0.427× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.048× LOSS|0.421× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.986×|not established|not established|not established|
|json-stringify-inline|1.09 ms (legacy unverified)|1.11 ms (legacy unverified)|771.60 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|823.80 µs (legacy unverified)|1.96 ms (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.323× LOSS|0.556× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.347× LOSS|0.566× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.018× **LLVM TRAILS C**|not established|not established|not established|
|json-stringify-typed|1.40 ms (legacy unverified)|1.38 ms (legacy unverified)|926.43 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|884.93 µs (legacy unverified)|899.23 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.582× LOSS|1.557× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.559× LOSS|1.535× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.986×|not established|not established|not established|
|logical-assignment|62.19 µs (legacy unverified)|53.05 µs (legacy unverified)|57.42 µs (legacy unverified)|53.17 µs (legacy unverified)|61.39 µs (legacy unverified)|347.42 µs (legacy unverified)|71.99 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.179× WON|0.864× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.153× WON|0.737× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.853×|not established|not established|not established|
|loop|695.1 ns (legacy unverified)|684.2 ns (legacy unverified)|1.18 µs (legacy unverified)|686.8 ns (legacy unverified)|1.51 µs (legacy unverified)|677.8 ns (legacy unverified)|698.8 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.026× LOSS|0.995× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|1.009× LOSS|0.979× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.984×|not established|not established|not established|
|map-and-set|6.08 µs (legacy unverified)|6.27 µs (legacy unverified)|8.76 µs (legacy unverified)|19.74 µs (legacy unverified)|10.81 µs (legacy unverified)|6.99 µs (legacy unverified)|5.67 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.870× SHORT|1.072× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.897× SHORT|1.106× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.031× **LLVM TRAILS C**|not established|not established|not established|
|module-closures|2.39 µs (legacy unverified)|2.37 µs (legacy unverified)|4.70 µs (legacy unverified)|2.44 µs (legacy unverified)|4.37 µs (legacy unverified)|5.35 µs (legacy unverified)|37.29 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.447× WON|0.064× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.443× WON|0.064× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.992×|not established|not established|not established|
|node-utf8|41.37 µs (legacy unverified)|41.89 µs (legacy unverified)|51.18 µs (legacy unverified)|NOT_PROVIDED|7.53 µs (legacy unverified)|39.66 µs (legacy unverified)|36.28 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.043× LOSS|1.140× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.056× LOSS|1.155× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.013× **LLVM TRAILS C**|not established|not established|not established|
|number-format|670.8 ns (legacy unverified)|688.0 ns (legacy unverified)|924.3 ns (legacy unverified)|985.3 ns (legacy unverified)|905.0 ns (legacy unverified)|1.52 µs (legacy unverified)|874.6 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.441× WON|0.767× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.453× WON|0.787× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.026× **LLVM TRAILS C**|not established|not established|not established|
|number-format-double|4.83 µs (legacy unverified)|4.77 µs (legacy unverified)|5.75 µs (legacy unverified)|NOT_PROVIDED|5.46 µs (legacy unverified)|9.45 µs (legacy unverified)|5.70 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.511× WON|0.847× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.505× WON|0.837× SHORT|NOT_COMPARABLE|NOT_COMPARABLE|0.988×|not established|not established|not established|
|objects|1.82 µs (legacy unverified)|1.82 µs (legacy unverified)|2.14 µs (legacy unverified)|1.82 µs (legacy unverified)|2.52 µs (legacy unverified)|1.90 µs (legacy unverified)|1.49 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.958× SHORT|1.221× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.958× SHORT|1.221× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.000×|not established|not established|not established|
|optional-chain|89.67 µs (legacy unverified)|90.13 µs (legacy unverified)|45.13 µs (legacy unverified)|9.71 µs (legacy unverified)|35.50 µs (legacy unverified)|377.71 µs (legacy unverified)|186.64 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.237× WON|0.480× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.239× WON|0.483× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.005× **LLVM TRAILS C**|not established|not established|not established|
|pipeline|28.08 µs (legacy unverified)|27.54 µs (legacy unverified)|58.47 µs (legacy unverified)|30.29 µs (legacy unverified)|58.39 µs (legacy unverified)|123.22 µs (legacy unverified)|136.17 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.228× WON|0.206× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.224× WON|0.202× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.981×|not established|not established|not established|
|strings|215.9 ns (legacy unverified)|226.5 ns (legacy unverified)|1.58 µs (legacy unverified)|355.1 ns (legacy unverified)|1.58 µs (legacy unverified)|2.53 µs (legacy unverified)|2.54 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.085× WON|0.085× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.090× WON|0.089× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.049× **LLVM TRAILS C**|not established|not established|not established|
|substrings|1.95 µs (legacy unverified)|2.45 µs (legacy unverified)|3.14 µs (legacy unverified)|1.73 µs (legacy unverified)|5.44 µs (legacy unverified)|7.11 µs (legacy unverified)|25.39 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.274× WON|0.077× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.345× WON|0.096× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.256× **LLVM TRAILS C**|not established|not established|not established|
|symbol-keyed-map|22.75 µs (legacy unverified)|22.81 µs (legacy unverified)|26.45 µs (legacy unverified)|14.25 µs (legacy unverified)|8.71 µs (legacy unverified)|42.21 µs (legacy unverified)|8.38 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.539× WON|2.715× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.540× WON|2.722× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.003× **LLVM TRAILS C**|not established|not established|not established|
|symbol-keys|325.1 ns (legacy unverified)|324.3 ns (legacy unverified)|337.7 ns (legacy unverified)|310.5 ns (legacy unverified)|313.2 ns (legacy unverified)|1.71 µs (legacy unverified)|509.4 ns (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.190× WON|0.638× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.190× WON|0.637× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.998×|not established|not established|not established|
|upcast|5.01 µs (legacy unverified)|5.66 µs (legacy unverified)|8.21 µs (legacy unverified)|4.15 µs (legacy unverified)|8.09 µs (legacy unverified)|10.10 µs (legacy unverified)|10.43 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|0.496× WON|0.480× WON|NOT_COMPARABLE|NOT_COMPARABLE|0.560× WON|0.543× WON|NOT_COMPARABLE|NOT_COMPARABLE|1.130× **LLVM TRAILS C**|not established|not established|not established|
|user-iterable|674.32 µs (legacy unverified)|668.34 µs (legacy unverified)|360.03 µs (legacy unverified)|32.56 µs (legacy unverified)|392.26 µs (legacy unverified)|422.60 µs (legacy unverified)|668.20 µs (legacy unverified)|NOT_PROVIDED|NOT_PROVIDED|1.596× LOSS|1.009× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|1.581× LOSS|1.000× LOSS|NOT_COMPARABLE|NOT_COMPARABLE|0.991×|not established|not established|not established|

- absences, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- absences, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- absences, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- accumulate, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- accumulate, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- accumulate, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- array-from, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-from, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-from, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- array-methods, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-methods, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-methods, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- array-mutations, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-mutations, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-mutations, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- array-predicates, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- arrays, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- arrays, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- arrays, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- awfy-bounce, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-bounce, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-list, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-list, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-mandelbrot, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-mandelbrot, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-nbody, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-nbody, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-permute, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-permute, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-queens, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-queens, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-sieve, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-sieve, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- awfy-towers, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- awfy-towers, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- bigint, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- bigint, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- bigint, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- bytes, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- bytes, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- bytes, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- case-convert, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- case-convert, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- case-convert, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- checksum, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- checksum, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- checksum, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- closure-merge, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- closure-merge, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- closure-merge, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- closures, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- closures, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- closures, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- dispatch, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- dispatch, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- dispatch, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, nts Wasm: NOT_PROVIDED: Column was not provided in this historical run
- elementwise, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-typed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-typed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-typed, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-unknown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-unknown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-stored-unknown, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- erasure-typed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-typed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-typed, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- erasure-unknown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- erasure-unknown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- erasure-unknown, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- event-state, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- event-state, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- event-state, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- exceptions, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- exceptions, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- exceptions, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- face-fields, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- face-fields, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- face-fields, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- fib, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- fib, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- fib, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- generator, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- generator, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- generator, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- generator-dispatched, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- generator-dispatched, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- generator-dispatched, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- generic-classes, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- growth-fixed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- growth-fixed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- growth-fixed, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- growth-grown, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- growth-grown, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- growth-grown, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- in-narrowing, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- in-narrowing, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- in-narrowing, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- instanceof, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- instanceof, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- instanceof, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-build-append, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-build-join, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-parse, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-scan, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-serialize, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-doc, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-fused, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-inline, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, C++: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, Java: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- json-stringify-typed, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- logical-assignment, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- logical-assignment, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- logical-assignment, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- loop, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- loop, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- loop, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- map-and-set, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- map-and-set, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- map-and-set, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- module-closures, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- module-closures, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- module-closures, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, C++: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- node-utf8, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- number-format, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- number-format, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- number-format, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, C++: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- number-format-double, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- objects, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- objects, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- objects, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, C++ Wasm: NOT_PROVIDED: Column was not provided in this historical run
- optional-chain, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- pipeline, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- pipeline, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- pipeline, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- strings, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- strings, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- strings, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- substrings, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- substrings, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- substrings, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keyed-map, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keyed-map, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keyed-map, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keys, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keys, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- symbol-keys, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- upcast, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- upcast, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- upcast, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
- user-iterable, Bun AOT: NOT_PROVIDED: Column was not provided in this historical run
- user-iterable, ScriptC: NOT_PROVIDED: Column was not provided in this historical run
- user-iterable, AssemblyScript: NOT_PROVIDED: Column was not provided in this historical run
