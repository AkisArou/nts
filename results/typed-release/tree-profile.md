# Tree-teardown C follow-up

Base 785f5c161; typed 9eb11bff1. The five-round confirmation reports +5.00% median wall, −0.10% instructions, and a 4.62% maximum baseline-repeat spread. The cause is unproved: no hot-loop boundary moved, and no added destruction work accounts for it. Keep the loss as measured.

CPU 4 under with-lock, 8 GiB scope without swap, one layout. Flat cycles profiles have zero lost samples. Build, sum and nts_alloc account for 98.85%/98.74% of base/typed samples; nts_destroy is 0.28%/0.34%. The profile workloads take 30.512/30.732 µs per call. Samples do not show a new teardown bottleneck.

| Hot function | Base address | Typed address | Static instructions A/B | Finding |
|---|---:|---:|---:|---|
| work | 0x2c20 | 0x2c20 | 241/241 | identical after relocation normalization |
| build__region | 0x3040 | 0x3040 | 54/54 | identical after relocation normalization |
| sum | 0x3100 | 0x3100 | 25/25 | identical after relocation normalization |
| nts_alloc | 0x3470 | 0x3530 | 53/53 | identical after relocation normalization; same offsets modulo 32 and 64 |

The longer hot-window A/B/A counters below use 65,640 calls per process, three rounds, the original checksum and accumulator guard, and at least 99% counter time. Retired critical DSB misses do not correlate with the wall changes. Branch misses rise 3–5%; this does not establish that they cause the wall difference. These data do not prove a layout or cache explanation.

| Round | Wall Δ | Instructions Δ | Cycles Δ | Branch misses Δ | DSB misses Δ | A-repeat spread |
|---|---:|---:|---:|---:|---:|---:|
| 1 | -0.60% | -0.10% | -0.42% | 3.10% | 217.65% | 2.86% |
| 2 | 14.65% | -0.10% | 14.81% | 5.31% | 13.36% | 8.15% |
| 3 | 11.31% | -0.10% | 11.56% | 5.18% | -65.86% | 9.91% |
