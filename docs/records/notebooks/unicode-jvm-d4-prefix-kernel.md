# JVM Unicode D4 prefix-kernel experiment

Record: [2026-11-01-2df09d90c073-d4-prefix-kernel-final-v2](../../../results/benchmarks/runs/2026-11-01-2df09d90c073-d4-prefix-kernel-final-v2.json). This diagnostic partial is ineligible for own-best. The default trial failed its instruction bar; no placement phase or D4 landing follows.

**Bar.** All twelve directional cells must use no more instructions per conversion than the corresponding 04aa observation range; a passing default table must then survive twelve placement settings with five launches each. A real slow launch counts. The two genuine Latin-1 cells are standing rows; the older row contains œ (U+0153).

**Protocol.** One sitting on CPU 4 under `with-lock.sh --wait`, sibling 5 idle, nice 19, normal JIT, Corretto 21.0.5+11. Perf observes only the actual Java main TID during the fifth retained `Bench.measure` trial. Each Work.run performs 64 conversions; each cell has five launches. Timer and anonymous Work class bytes are identical. All 240 launch checksums agree within their cell. Whole-process/JIT-worker counts and the retired CountStable graph are not used.

Load ranged 18.61–71.44; MemAvailable ranged 11.60–20.33 GiB. The phase admitted at 14.158 GiB and used the standing 12/14 GiB case-admission hysteresis. Two completed baseline launches were retained across an idle-boundary admission correction. Wall clocks are context only.

**Sources.** Baseline `04aa66e873c6`; continuous-fill control `e2700531146d`; final split `2df09d90c073`. The split adds a collision-allocated package-private static synthetic prefix kernel returning the unconsumed original index. The wrapper retains allocation, String construction and cold resume. Template, tables and runtime jar are unchanged by the split. Plain release, model 2/2, Unicode 8/8, Clippy, format and actual CLI emission passed; both compiler/JVM owner reviews cleared the frozen source and focus. Those results establish correctness/source scope, not performance.

## Instructions per conversion

Median [minimum, maximum]; baseline start and end stay separate. No mode is averaged away by reporting just one ratio.

| Cell | 04aa | e270 | 2df | 04aa end |
|---|---:|---:|---:|---:|
| ASCII lower | 827.44 [815.30, 833.12] | 825.25 [818.80, 833.68] | 915.07 [915.06, 915.07] | 830.10 [813.38, 833.69] |
| ASCII upper | 920.90 [862.32, 921.05] | 875.56 [842.77, 921.05] | 920.85 [908.52, 921.42] | 918.03 [876.56, 922.03] |
| latin1-with-oe lower | 1389.90 [1305.84, 1390.21] | 1364.81 [1363.04, 1416.72] | 1516.35 [1474.33, 1516.40] | 1305.84 [1304.84, 1390.22] |
| latin1-with-oe upper | 2058.33 [2057.23, 2139.35] | 2020.50 [2020.49, 2021.62] | 2077.13 [2077.10, 2090.11] | 2065.24 [2065.22, 2066.49] |
| Greek lower | 1955.67 [1910.80, 1957.34] | 1677.56 [1668.56, 1683.00] | 2008.44 [1690.94, 2078.25] | 1955.17 [1911.74, 1955.18] |
| Greek upper | 1515.05 [1459.67, 1665.04] | 1453.29 [1453.29, 1453.30] | 1453.29 [1444.84, 1453.29] | 1516.04 [1515.04, 1868.05] |
| CJK lower | 990.93 [931.90, 991.34] | 888.81 [888.39, 889.09] | 856.80 [855.81, 857.41] | 991.06 [989.94, 991.28] |
| CJK upper | 583.23 [583.23, 589.23] | 585.61 [585.60, 589.23] | 585.61 [585.60, 585.61] | 585.23 [583.23, 589.53] |
| unchanged lower | 426.99 [426.99, 427.00] | 426.99 [426.99, 427.00] | 427.00 [426.99, 427.00] | 426.99 [426.99, 427.00] |
| unchanged upper | 426.99 [426.99, 426.99] | 426.99 [426.99, 426.99] | 426.99 [426.99, 427.00] | 426.99 [426.99, 427.00] |
| true-FF lower | 926.73 [896.77, 939.53] | 919.74 [896.74, 939.52] | 941.17 [926.36, 942.52] | 937.89 [906.00, 939.53] |
| true-FF upper | 1938.76 [1815.71, 1954.26] | 2548.60 [2045.74, 2625.87] | 2148.71 [2099.76, 2463.76] | 1821.10 [1818.07, 1870.73] |

True-FF upper is the decisive miss: 2df uses **2099.76–2463.76** instructions, above every 04aa/04aaEnd launch (**1815.71–1954.26**). ASCII lower and the œ lower cell also exceed the full baseline range; Greek lower retains a slow tail. CJK lower improves, but the bar permits no trade between cells.

**Likely next need:** a compact-input counted kernel whose coder/bounds and growth/context state stay independent in the compiled caller; this wrapper/kernel extraction did not establish that reliably.

## Wall clock context

Selected-trial median ns per conversion; these values do not supply a wall-clock verdict under this sitting’s load.

| Cell | 04aa | e270 | 2df | 04aa end |
|---|---:|---:|---:|---:|
| ASCII lower | 28.68 | 40.45 | 31.10 | 29.83 |
| ASCII upper | 31.41 | 43.20 | 33.30 | 33.55 |
| latin1-with-oe lower | 57.97 | 53.75 | 56.25 | 54.88 |
| latin1-with-oe upper | 92.09 | 98.05 | 94.68 | 99.92 |
| Greek lower | 63.74 | 58.86 | 72.22 | 63.34 |
| Greek upper | 55.01 | 55.11 | 56.40 | 59.29 |
| CJK lower | 43.36 | 46.55 | 45.90 | 49.00 |
| CJK upper | 24.33 | 24.26 | 24.04 | 24.51 |
| unchanged lower | 16.48 | 16.18 | 16.11 | 16.48 |
| unchanged upper | 16.18 | 16.37 | 16.44 | 16.45 |
| true-FF lower | 37.66 | 38.39 | 37.23 | 38.08 |
| true-FF upper | 99.01 | 101.65 | 99.84 | 94.36 |

The record includes every raw PMU counter stream, launch command/conditions/output/checksum, compiler/source binding, the exact emitted classes/runtime jars, timer/Work classes, and harness/project sources. Rebuilding the included harness sources with the pinned JDK reproduced every harness class byte-for-byte. Full compressed JIT logs remain retained with their digests. The failed mmap profile attempts and earlier source/control measurements remain separate historical receipts; none is substituted for this completed trial.

D4 is parked at the committed final candidate. Native case-conversion #150 is the next work item.
