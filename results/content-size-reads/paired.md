# Intrinsic size-read content contracts

Old/new emitted code changed only on map-and-set and map-entries-top-k: the other 95 benchmark rows have byte-identical C/LLVM source sets. Whole-work checksums, exact N, repeated-addition sinks, exit/stderr and hot-window PMU running time ≥99% passed in all 376 observations.

Five seeds per arm/backend (101, 307, 509, 701, 907), five interleaved A/B/A brackets per layout, rotating/reversing layouts; one matched N per row. Native A is the geometric bracket anchor; each arm is the mean of its five layout means. The floor is the larger complete layout range or worst A-repeat drift. Shipping and lld hot bodies match, with only unambiguous ThinLTO module suffixes and resolved addresses normalized; literal constants are compared by bytes.

CPU 4 under with-lock, sibling 5 admitted idle; orchestration off 4–5, nice 19, 8 GiB/no swap. Load 33.97–41.92. This is change evidence; loaded layout ranges are not quiet reference calibration. Pins: b89824d9c → 79c2d556a. Old compiler nts-dev, candidate release; native program flags match shipping ThinLTO in both arms.

| Row | Backend | Old µs | New µs | Wall | Instructions | Cycles | Floor | New/Node | New/Bun | Wall verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| map-and-set | c | 5.704 | 5.405 | -5.24% | -2.58% | -5.00% | 40.05% | 0.57× | 0.67× | noise |
| map-and-set | llvm | 5.685 | 5.519 | -2.92% | -2.22% | -2.89% | 14.60% | 0.58× | 0.68× | noise |
| map-entries-top-k | c | 19.478 | 18.507 | -4.99% | -3.67% | -4.75% | 11.61% | 0.53× | 0.70× | noise |
| map-entries-top-k | llvm | 20.059 | 19.599 | -2.29% | -3.29% | -2.56% | 21.54% | 0.56× | 0.74× | noise |

## Host launches

Five fresh launches each; native has checksum plus one untimed warmup call, while host warmup is calibrated separately and recorded. Only N hot full calls are compared. No forced GC or per-call process launch.

| Row | Host | Median µs | Min–max µs | N | Warmup |
|---|---|---:|---|---:|---:|
| map-and-set | node | 9.518 | 9.428–9.637 | 18359 | 20000 |
| map-and-set | bun | 8.071 | 7.924–8.326 | 18359 | 20000 |
| map-entries-top-k | node | 35.058 | 34.403–58.324 | 4787 | 8236 |
| map-entries-top-k | bun | 26.524 | 25.774–27.267 | 4787 | 10427 |

## Layout and repeat limits

| Row / backend | Per-layout B/A span | A layout range | B layout range | Worst A-repeat |
|---|---|---:|---:|---:|
| map-and-set / c | -8.91% to -2.15% | 5.00% | 2.44% | 40.05% |
| map-and-set / llvm | -6.51% to +4.33% | 3.23% | 11.62% | 14.60% |
| map-entries-top-k / c | -6.25% to -3.47% | 1.97% | 2.79% | 11.61% |
| map-entries-top-k / llvm | -6.01% to +1.84% | 4.11% | 5.62% | 21.54% |

Compiler and comparator versions, every round, counters, RSS, branches, raw streams, exact argv and train markers are retained beside summary.json. Instructions and cycles are reported independently of wall noise; a wall verdict of noise does not erase a measured instruction change.

## Comparator versions and active train

- node: v24.20.0
- bun: 1.4.0
- clang: clang version 23.1.3
- clang++: clang version 23.1.3

land d283612e61b1 2026-10-28T12:50:51.529Z pid 30372
