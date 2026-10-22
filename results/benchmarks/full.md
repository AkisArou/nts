# Every case, every column

Written by `nts-bench` from a clean full run only: every case, every lane, nothing else running. The per-target tables beside it (`c.md`, `llvm.md`, `jvm.md`, `wasm.md`) record every run.

| case | C++ | nts (C) | nts (LLVM) | nts (JVM) | Java | nts (Wasm) | C++ (wasm) | AssemblyScript | V8 | Bun | nts/C++ | nts/V8 | nts/Bun | nts (JVM)/Java | nts (Wasm)/V8 | nts (Wasm)/C++ (wasm) | nts (Wasm)/AssemblyScript |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| absences | 191.5 ns | 191.5 ns | **190.9 ns** | 588.5 ns | 460.9 ns | 842.2 ns | 1.10 us | -- | 830.3 ns | 676.3 ns | 1.00x | 0.23x | 0.28x | 1.28x | 1.01x | 0.77x | -- |
| accumulate | 1.19 us | 1.49 us | **1.14 us** | 2.10 us | 2.12 us | 2.84 us | 1.56 us | -- | 2.93 us | 21.64 us | 0.95x | 0.39x | 0.05x | 0.99x | 0.97x | 1.82x | -- |
| array-from (rc) | 527.90 us | 2.14 ms | **2.14 ms** | 1.24 ms | 1.07 ms | 5.18 ms | 630.53 us | -- | 489.36 us | 1.26 ms | 4.06x | 4.37x | 1.70x | 1.16x | 10.58x | 8.21x | -- |
| array-methods | 1.05 us | 1.33 us | **1.31 us** | 1.63 us | 1.41 us | 4.34 us | 787.0 ns | -- | 5.99 us | 7.91 us | 1.25x | 0.22x | 0.17x | 1.16x | 0.72x | 5.52x | -- |
| array-mutations (rc) | 565.5 ns | 707.4 ns | **706.2 ns** | 1.73 us | 2.59 us | 1.13 us | 560.3 ns | -- | 1.76 us | 3.75 us | 1.25x | 0.40x | 0.19x | 0.67x | 0.64x† | 2.01x† | -- |
| array-predicates (rc) | 2.49 us | 2.29 us | **2.24 us** | 3.84 us | 2.18 us | 5.25 us | -- | -- | 4.68 us | 5.43 us | 0.90x | 0.48x | 0.41x | 1.76x | 1.12x | -- | -- |
| arrays | 1.34 us | 1.37 us | **1.43 us** | 1.41 us | 1.34 us | 2.80 us | 3.55 us | -- | 2.53 us | 2.15 us | 1.07x | 0.57x | 0.67x | 1.05x | 1.11x | 0.79x | -- |
| awfy-bounce | 4.40 us | 6.07 us | **6.42 us** | 4.88 us | 4.76 us | 7.26 us | 5.90 us | 28.58 us | 13.47 us | 11.95 us | 1.46x | 0.48x | 0.54x | 1.03x† | 0.54x | 1.23x | 0.25x† |
| awfy-list | 7.88 us | 7.77 us | **7.53 us** | 8.07 us | 8.67 us | 6.90 us | 7.53 us | 25.48 us | 16.66 us | 13.62 us | 0.96x | 0.45x | 0.55x | 0.93x† | 0.41x | 0.92x | 0.27x |
| awfy-mandelbrot | 23.34 ms | 22.68 ms | **23.81 ms** | 23.03 ms | 27.57 ms | 22.67 ms | 26.24 ms | 22.42 ms | 23.11 ms | 23.09 ms | 1.02x | 1.03x | 1.03x | 0.84x | 0.98x | 0.86x | 1.01x |
| awfy-nbody | 7.00 ms | 7.75 ms | **8.05 ms** | 7.97 ms | 7.97 ms | 8.92 ms | 8.67 ms | 38.16 ms | 81.63 ms | 15.36 ms | 1.15x | 0.10x | 0.52x | 1.00x | 0.11x | 1.03x | 0.23x |
| awfy-permute | 10.75 us | 14.33 us | **14.40 us** | 19.10 us | 17.60 us | 20.61 us | 24.04 us | 113.08 us | 21.76 us | 16.99 us | 1.34x | 0.66x | 0.85x | 1.09x | 0.95x† | 0.86x† | 0.18x† |
| awfy-queens | 5.42 us | 11.62 us | **11.04 us** | 16.09 us | 8.98 us | 13.63 us | 9.39 us | 87.92 us | 17.73 us | 14.97 us | 2.03x | 0.62x | 0.74x | 1.79x | 0.77x | 1.45x | 0.15x |
| awfy-sieve | 3.55 us | 6.98 us | **4.74 us** | 5.59 us | 4.66 us | 6.18 us | 5.42 us | 18.64 us | 10.19 us | 10.62 us | 1.34x | 0.47x | 0.45x | 1.20x† | 0.61x | 1.14x | 0.33x |
| awfy-towers | 11.73 us | 20.65 us | **21.12 us** | 21.16 us | 18.77 us | 21.84 us | 20.42 us | 140.99 us | 32.37 us | 21.15 us | 1.80x | 0.65x | 1.00x | 1.13x | 0.67x | 1.07x | 0.15x |
| bigint | 342.4 ns | 359.2 ns | **343.7 ns** | 669.1 ns | 3.77 us | 1.24 us | 758.1 ns | -- | 3.69 us | 3.82 us | 1.00x | 0.09x | 0.09x | 0.18x | 0.33x | 1.63x | -- |
| bytes | 440.03 us | 458.67 us | **468.20 us** | 712.89 us | 688.93 us | 622.77 us | 753.21 us | -- | 512.41 us | 760.49 us | 1.06x | 0.91x | 0.62x | 1.03x | 1.22x | 0.83x | -- |
| case-convert (rc) | 6.12 us | 3.90 us | **3.90 us** | 3.28 us | 3.40 us | 4.01 us | 6.56 us | -- | 3.13 us | 3.73 us | 0.64x | 1.25x | 1.05x | 0.96x | 1.28x | 0.61x | -- |
| checksum | 5.03 us | 5.03 us | **4.80 us** | 5.04 us | 5.04 us | 5.76 us | 5.40 us | -- | 5.60 us | 23.99 us | 0.95x | 0.86x | 0.20x | 1.00x | 1.03x | 1.07x | -- |
| closure-merge | 7.31 us | 19.60 us | **20.09 us** | 32.02 us | 2.13 us | 65.90 us | 9.60 us | -- | 20.59 us | 12.44 us | 2.75x | 0.98x | 1.61x | 15.01x | 3.20x | 6.86x | -- |
| closures | 1.11 us | 1.14 us | **1.14 us** | 1.98 us | 2.34 us | 49.07 us | 1.52 us | -- | 3.22 us | 18.41 us | 1.02x | 0.35x | 0.06x | 0.85x | 15.22x | 32.19x | -- |
| dispatch | 29.31 us | 22.30 us | **29.32 us** | 27.74 us | 25.65 us | 34.23 us | 26.49 us | -- | 40.10 us | 14.30 us | 1.00x | 0.73x | 2.05x | 1.08x† | 0.85x | 1.29x | -- |
| elementwise | 150.88 us | 126.17 us | **126.12 us** | 60.90 us | 56.80 us | -- | 275.43 us | -- | 927.87 us | 596.39 us | 0.84x | 0.14x | 0.21x | 1.07x | -- | -- | -- |
| erasure-stored-typed | 70.65 us | 71.76 us | **74.56 us** | 70.48 us | 72.74 us | 77.07 us | 70.89 us | -- | 117.19 us | 71.82 us | 1.06x | 0.64x | 1.04x | 0.97x | 0.66x | 1.09x | -- |
| erasure-stored-unknown | 70.79 us | 73.80 us | **72.56 us** | 71.77 us | 73.40 us | 92.64 us | 70.86 us | -- | 88.46 us | 72.82 us | 1.03x | 0.82x | 1.00x | 0.98x | 1.05x | 1.31x | -- |
| erasure-typed | 135.13 us | 134.05 us | **136.31 us** | 134.42 us | 138.09 us | 138.23 us | 180.97 us | -- | 137.67 us | 84.26 us | 1.01x | 0.99x | 1.62x | 0.97x | 1.00x | 0.76x | -- |
| erasure-unknown | 136.80 us | 138.10 us | **140.91 us** | 137.57 us | 137.02 us | 495.65 us | 174.77 us | -- | 136.58 us | 86.41 us | 1.03x | 1.03x | 1.63x | 1.00x | 3.63x | 2.84x | -- |
| event-state (rc) | 486.1 ns | 161.8 ns | **156.2 ns** | 138.8 ns | 78.5 ns | 900.6 ns | 531.7 ns | -- | 1.25 us | 158.2 ns | 0.32x | 0.12x | 0.99x | 1.77x† | 0.72x | 1.69x† | -- |
| exceptions | 21.43 us | 35.18 us | **33.62 us** | 34.09 us | 3.15 ms | 56.17 us | 2.75 us | -- | 14.64 ms | 2.61 ms | 1.57x | 0.00x¶ | 0.01x | 0.01x | 0.00x¶ | 20.42x | -- |
| face-fields | 13.82 us | 27.47 us | **28.47 us** | 29.32 us | 32.08 us | 44.15 us | 22.08 us | -- | 9.68 us | 5.31 us | 2.06x | 2.94x | 5.36x | 0.91x | 4.56x | 2.00x | -- |
| fib | 307.14 us | 532.48 us | **531.22 us** | 501.70 us | 479.41 us | 762.60 us | 411.97 us | -- | 1.01 ms | 690.40 us | 1.73x | 0.53x | 0.77x | 1.05x | 0.76x | 1.85x | -- |
| generator | 169.77 us | 179.58 us | **177.73 us** | 170.42 us | 169.80 us | 238.12 us | 616.30 us | -- | 3.29 ms | 3.39 ms | 1.05x | 0.05x | 0.05x | 1.00x | 0.07x | 0.39x | -- |
| generator-dispatched | 585.78 us | 607.41 us | **605.60 us** | 171.99 us | 173.63 us | 599.85 us | 1.08 ms | -- | 3.26 ms | 855.31 us | 1.03x | 0.19x | 0.71x | 0.99x | 0.18x | 0.55x | -- |
| generic-classes | 196.9 ns | 192.9 ns | **198.4 ns** | 1.64 us | 1.46 us | 1.60 us | -- | -- | 1.45 us | 2.00 us | 1.01x | 0.14x | 0.10x | 1.13x | 1.10x | -- | -- |
| growth-fixed | 153.62 us | 157.74 us | **158.05 us** | 168.94 us | 174.14 us | 276.24 us | 155.07 us | -- | 321.07 us | 277.22 us | 1.03x | 0.49x | 0.57x | 0.97x | 0.86x | 1.78x | -- |
| growth-grown | 154.39 us | 631.43 us | **628.19 us** | 219.51 us | 171.31 us | 272.30 us | 162.31 us | -- | 316.19 us | 279.71 us | 4.07x | 1.99x | 2.25x | 1.28x | 0.86x | 1.68x | -- |
| in-narrowing | 1.49 us | 1.51 us | **1.56 us** | 1.44 us | 1.42 us | 13.92 us | 3.03 us | -- | 10.60 us | 11.05 us | 1.05x | 0.15x | 0.14x | 1.02x | 1.31x | 4.59x | -- |
| instanceof | 72.03 us | 46.50 us | **47.17 us** | 51.95 us | 45.05 us | 294.68 us | 109.25 us | -- | 983.52 us | 199.46 us | 0.65x | 0.05x | 0.24x | 1.15x | 0.30x | 2.70x | -- |
| json-build-append (rc) | -- | 24.58 us | **24.53 us** | 16.35 us | -- | 17.35 us | -- | -- | 15.16 us | 7.74 us | -- | 1.62x | 3.17x | -- | 1.14x | -- | -- |
| json-build-join (rc) | -- | 23.11 us | **22.95 us** | 14.90 us | -- | 17.67 us | -- | -- | 21.06 us | 13.11 us | -- | 1.09x | 1.75x | -- | 0.84x | -- | -- |
| json-parse | -- | 1.66 ms | **1.64 ms** | 709.92 us | -- | 1.72 ms | -- | -- | 806.98 us | 1.25 ms | -- | 2.04x | 1.32x | -- | 2.14x | -- | -- |
| json-scan | -- | 1.97 us | **1.83 us** | 2.30 us | -- | 11.04 us | -- | -- | 1.80 us | 1.98 us | -- | 1.02x | 0.92x | -- | 6.12x | -- | -- |
| json-serialize (rc) | -- | 16.74 us | **16.52 us** | 15.37 us | -- | 12.93 us | -- | -- | 12.58 us | 7.29 us | -- | 1.31x | 2.27x | -- | 1.03x | -- | -- |
| json-stringify-doc (rc) | -- | 5.04 ms | **5.22 ms** | 1.15 ms | -- | 1.83 ms | -- | -- | 1.42 ms | 2.95 ms | -- | 3.68x | 1.77x | -- | 1.29x† | -- | -- |
| json-stringify-fused (rc) | -- | 760.41 us | **750.01 us** | 737.84 us | -- | 738.94 us | -- | -- | 715.48 us | 1.78 ms | -- | 1.05x | 0.42x | -- | 1.03x | -- | -- |
| json-stringify-inline (rc) | -- | 1.09 ms | **1.11 ms** | 771.60 us | -- | 894.40 us | -- | -- | 823.80 us | 1.96 ms | -- | 1.34x | 0.56x | -- | 1.09x | -- | -- |
| json-stringify-typed (rc) | -- | 1.40 ms | **1.38 ms** | 926.43 us | -- | 896.36 us | -- | -- | 884.93 us | 899.23 us | -- | 1.56x | 1.54x | -- | 1.01x | -- | -- |
| logical-assignment | 53.17 us | 62.19 us | **53.05 us** | 57.42 us | 61.39 us | 69.14 us | 72.71 us | -- | 347.42 us | 71.99 us | 1.00x | 0.15x | 0.74x | 0.94x | 0.20x | 0.95x | -- |
| loop | 686.8 ns | 695.1 ns | **684.2 ns** | 1.18 us | 1.51 us | 664.0 ns | 667.3 ns | -- | 677.8 ns | 698.8 ns | 1.00x | 1.01x | 0.98x | 0.78x | 0.98x | 1.00x | -- |
| map-and-set (rc) | 19.74 us | 6.08 us | **6.27 us** | 8.76 us | 10.81 us | 5.98 us | 13.50 us | -- | 6.99 us | 5.67 us | 0.32x | 0.90x | 1.11x | 0.81x | 0.85x | 0.44x | -- |
| module-closures | 2.44 us | 2.39 us | **2.37 us** | 4.70 us | 4.37 us | 117.96 us | 3.57 us | -- | 5.35 us | 37.29 us | 0.97x | 0.44x | 0.06x | 1.08x | 22.07x | 33.07x | -- |
| node-utf8 (rc) | -- | 41.37 us | **41.89 us** | 51.18 us | 7.53 us | 119.71 us | -- | -- | 39.66 us | 36.28 us | -- | 1.06x | 1.15x | 6.80x | 3.02x | -- | -- |
| number-format (rc) | 985.3 ns | 670.8 ns | **688.0 ns** | 924.3 ns | 905.0 ns | 2.18 us | 1.39 us | -- | 1.52 us | 874.6 ns | 0.70x | 0.45x | 0.79x | 1.02x | 1.44x | 1.56x | -- |
| number-format-double (rc) | -- | 4.83 us | **4.77 us** | 5.75 us | 5.46 us | 9.65 us | -- | -- | 9.45 us | 5.70 us | -- | 0.50x | 0.84x | 1.05x | 1.02x | -- | -- |
| objects (rc) | 1.82 us | 1.82 us | **1.82 us** | 2.14 us | 2.52 us | 1.68 us | 2.50 us | -- | 1.90 us | 1.49 us | 1.00x | 0.96x | 1.22x | 0.85x† | 0.89x | 0.67x | -- |
| optional-chain | 9.71 us | 89.67 us | **90.13 us** | 45.13 us | 35.50 us | 570.25 us | -- | -- | 377.71 us | 186.64 us | 9.28x | 0.24x | 0.48x | 1.27x | 1.51x | -- | -- |
| pipeline (rc) | 30.29 us | 28.08 us | **27.54 us** | 58.47 us | 58.39 us | 59.25 us | 40.22 us | -- | 123.22 us | 136.17 us | 0.91x | 0.22x | 0.20x | 1.00x | 0.48x† | 1.47x† | -- |
| strings | 355.1 ns | 215.9 ns | **226.5 ns** | 1.58 us | 1.58 us | 14.21 us | 2.29 us | -- | 2.53 us | 2.54 us | 0.64x | 0.09x | 0.09x | 1.00x | 5.62x | 6.21x | -- |
| substrings (rc) | 1.73 us | 1.95 us | **2.45 us** | 3.14 us | 5.44 us | 13.26 us | 7.07 us | -- | 7.11 us | 25.39 us | 1.42x | 0.34x | 0.10x | 0.58x | 1.86x | 1.88x | -- |
| symbol-keyed-map | 14.25 us | 22.75 us | **22.81 us** | 26.45 us | 8.71 us | 31.04 us | 23.68 us | -- | 42.21 us | 8.38 us | 1.60x | 0.54x | 2.72x | 3.04x† | 0.74x | 1.31x | -- |
| symbol-keys | 310.5 ns | 325.1 ns | **324.3 ns** | 337.7 ns | 313.2 ns | 410.0 ns | 361.1 ns | -- | 1.71 us | 509.4 ns | 1.04x | 0.19x | 0.64x | 1.08x | 0.24x | 1.14x | -- |
| upcast | 4.15 us | 5.01 us | **5.66 us** | 8.21 us | 8.09 us | 13.56 us | 10.86 us | -- | 10.10 us | 10.43 us | 1.36x | 0.56x | 0.54x | 1.01x | 1.34x | 1.25x | -- |
| user-iterable | 32.56 us | 674.32 us | **668.34 us** | 360.03 us | 392.26 us | 651.87 us | 57.29 us | -- | 422.60 us | 668.20 us | 20.53x | 1.58x | 1.00x | 0.92x | 1.54x | 11.38x | -- |

† one half of this ratio is known to move — see the table below.          **A ratio is unquotable when either half moves**, whichever half it is:          the bar is ours over theirs, so a moving denominator moves the bar.

¶ `exceptions`: node and Java build a stack trace for every throw, which nts does not do, so its ratios against them measure the trace.

**Where `nts (Wasm)` is `--`**, the reason the Wasm backend gave:

| case | reason |
| --- | --- |
| elementwise | its own driver.mjs imports case.ts, so there is no harness to point at the module |

Every ratio is nts divided by the other, so **lower is better and 1.00 is parity**: `nts/C++` under 1.00 beats hand-written C++, and `nts/V8` and `nts/Bun` under 1.00 beat those engines.

There are two backends and both are measured, in the same run on the same machine: `nts (C)` is the C backend and `nts (LLVM)` is the LLVM one, which is the primary target and is still learning constructs. A `--` there is a program it refuses, not a program it gets wrong — every variant that *does* run must produce the same checksum as every other, so a bench run is a cross-backend correctness check as well as a measurement.

**The ratios are the LLVM backend's**, because a ratio is a claim about what a program compiled by this compiler costs, and that is the backend a program will be compiled by. Where it refuses one, the ratio is `--` rather than quietly reporting the other backend's number under the same heading.

The suite also measures the same TypeScript with number specialization switched off — one program compiled two ways, which is what makes a speedup a measurement rather than a claim. `cargo run -p nts-bench` prints it; it is not published here, because it answers a question about this compiler's insides rather than about how fast the result is.

`C++` is one hand-written reference per case, being what a C++ programmer would actually write for that program; each `ref.cpp` says why in a comment. Every variant returns a checksum and the runner refuses to report a case whose variants disagree, so a backend cannot win by computing the wrong answer quickly.

**The table keeps the cases this compiler loses.** A benchmark suite that held only its wins would be an advertisement rather than an instrument, and the rows above 1.50x are the work queue: each is a shape where the emitted code costs more than the C++ a person would write, and the reason is worth finding rather than hiding.

`nts (JVM)` is the same TypeScript compiled to class files and run by `java`. **`refused` is not `--`**: every case is attempted on every backend, so a missing JVM number is always a construct the lane declines by name, and a blank would be indistinguishable from the `Java` column's blank, which means nobody wrote a reference.

`Java` is a hand-written reference for the same benchmark, on the same JVM in the same run — the only reference here written in the language the column beside it compiles to, which is what makes `nts (JVM)/Java` a statement about codegen with the runtime divided out. Every other ratio in this table mixes a codegen difference with an engine difference and cannot separate them. On the `awfy-*` rows it is Are We Fast Yet's **own** Java, unchanged; everywhere else it is a `ref.java` beside the case, whose comment says what a competent Java programmer would write and why. A reference must decline anything that costs one lane and not the other — no boxing where the subject boxes nothing, no field narrower than the f64 a TypeScript `number` is — and four of these were corrected for exactly that, in both directions.

**Below about 1.10x, this column is at its resolution and should be read with the fixed-count driver rather than from here.** The number is a best-of-five, which is the right statistic against a tight distribution and a kind one against a wide one — and where a JIT settles two ways, ours is the wide one. `tooling/bench/counted.sh` calls a case's own entry point N times and again at 2N and subtracts, which removes startup and warmup and reports a median; records 0154 and 0155 are three rows that read differently under it, in both directions, one of them a loss published as a win. The spread table below catches a row that is unstable *within* one invocation and cannot catch one that settles differently between them.

**The JVM column excludes startup, deliberately and at this lane's own cost.** It is timed inside its own process after the same 20,000 warmup iterations bounded by 300 ms that `V8` and `Bun` get, then calibrated, then best-of-five. A JIT's first iterations measure the compiler rather than the code, so including them would report how long HotSpot took to decide, not what it decided. The honest consequence is that **cold start is absent from this table and is the one number where this lane loses by two orders of magnitude** — it belongs in a column of its own rather than smuggled into these.

`V8` is node and `Bun` is JavaScriptCore, both running the *same* TypeScript source the compiler consumes — the harness imports the `.ts` directly, so there is no second copy of the program to drift. Both are timed inside their own process after 20,000 warmup iterations, so neither startup nor a cold JIT is in either column, and both must produce the same checksum as everything else. Bun is skipped where it is not installed.

`nts (Wasm)` is the same program as a WebAssembly module, timed by node with node's own harness, importing the function from the module's glue instead of the `.ts`: `nts (Wasm)/V8` holds the engine fixed and compares what this compiler emitted for V8 with what V8's JIT made of the same source. A `--` there is a program the Wasm backend declines, and the table under the main one says why.

`C++ (wasm)` is the hand-written C++ compiled to a WASI module and run on the same engine, node's V8: `nts (Wasm)/C++ (wasm)` is what this compiler's WebAssembly costs against a C++ programmer's, with the engine held fixed. The console also prints it on wasmtime, to say how much is the engine. `AssemblyScript` is the case transcribed to AssemblyScript (`benchmarks/assemblyscript`, AWFY's eight only) and compiled by its own compiler, on V8 too.

**Some `nts/V8` rows are V8 paying for a TypeScript idiom, not this compiler winning.** The cases target ESNext, so a class field declared without an initializer (`x: number;`) is defined as `undefined` when the object is built, and node runs it so, as the semantics say. V8 then types the field for any value rather than for the numbers it will hold, and a double stored into it is a freshly allocated number. The same programs with `declare x: number;` instead -- or as JavaScript, which declares no fields -- run on node 7.5x faster on `awfy-nbody`, 3.4x on `user-iterable`, 1.3x on `instanceof` and 1.2x on `awfy-bounce` (node 24.20, a quiet machine, 2026-10-15). The sources stay as a TypeScript programmer writes them, so those rows' `nts/V8` is quoted twice: as measured, and divided by the factor, against the node a JavaScript programmer would run. The second is the one that says where this compiler stands -- `user-iterable`'s 1.60x as measured is about 5.4x against the declared shape, one of the worst rows rather than a mild one. `objects` is the exception that keeps this from being a rule: declared, node runs it 1.2x *slower*. `awfy-permute` pays 1.07x, and the other ten cases with such fields nothing measurable.

**A ratio moving is not this compiler moving.** Every column is measured in the same run, so a row can worsen while the program gets faster — and did: `json-stringify-doc` went from 6.01 ms to 4.78 ms on one change while its `nts/V8` went from 2.24x to **3.00x**, because the same change bought node 1.7x against our 1.26x. Nothing regressed; V8 exploits the streaming shape better than we do, and the ratio reports that gap rather than the program. Compare a row against the previous run's *absolute* numbers before reading its ratio as a direction.

And where two rows are one algorithm written two ways, the hosts disagree about which way is better: on `json-stringify-typed` against `json-stringify-inline`, Bun prefers the factored source and this compiler prefers the inlined one, in opposite directions on the same pair. **No single source is optimal for every column**, so those rows measure a tradeoff rather than a result, and they are kept as a pair for exactly that reason.

Measured at `833fa3016`, one case at a time, on cores pinned away from the other sessions sharing this checkout, with the benchmark lock held so nothing else was running. Written by `nts-bench` built in `/home/akisarou/.cache/nts-parallel-20261004/mainctl/wasm-1b-tree/tooling/bench`, which is also what decided *this* file: the destination is the binary's `CARGO_MANIFEST_DIR`, fixed when it was compiled rather than when it was run.

**These rows disagreed with themselves.** Measured five times from the same binary, their passes did not agree, so each published number says which shape the JIT settled into rather than how fast the program is, and a rerun may land on another shape. They are listed because the table cannot show it: a flipped row and a solid one are the same number on the page.

| case | column | spread | observed |
| --- | --- | ---: | --- |
| array-mutations (rc) | nts (Wasm) | 1.23x | this run |
| awfy-bounce | nts (JVM) | 1.15x | this run |
| awfy-bounce | AssemblyScript | 1.52x | this run |
| awfy-list | Java | 1.33x | five passes of one binary, against two earlier sittings — confirmed: two modes out of one binary |
| awfy-permute | nts (Wasm) | 1.40x | this run |
| awfy-permute | C++ (wasmtime) | 1.12x | this run |
| awfy-sieve | Java | 1.11x | this run |
| awfy-sieve | nts (JVM) | 1.28x | a control run, both harnesses — confirmed: two modes out of one binary |
| dispatch | nts (JVM) | 1.21x | this run |
| event-state (rc) | Java | 1.12x | this run |
| event-state (rc) | C++ (wasm) | 1.23x | this run |
| json-stringify-doc (rc) | nts (Wasm) | 1.28x | this run |
| json-stringify-typed (rc) | nts (JVM) | 1.72x | this run |
| objects (rc) | nts (JVM) | 1.63x | this run |
| objects (rc) | Java | 1.15x | this run |
| pipeline (rc) | nts (Wasm) | 1.12x | this run |
| symbol-keyed-map | Java | 1.12x | two sittings, reference only — observed to move; cause unknown |
