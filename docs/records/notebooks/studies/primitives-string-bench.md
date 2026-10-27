# String stage 0: the microbenchmark matrix (report)

Saved by MainClaude from the study's final message, 2026-10-22.

**What landed for review:** branch compiler/string-bench (tree ~/.cache/nts-scratch/primitives/string-bench/tree), eight commits on e8abc5730:
- 99706c49f concat-pair, template
- e0f39afac append-loop, append-length
- c1d17e882 slice-keep, index-read
- 678d0a4cc equal, compare
- 4914b3385 map-keys, index-of
- 954320437 split, join
- 6bdfe5bc7 to-number, json-quote
- 192841e8d utf8-encode (refused: `NTS1001 a new of unrepresentable type (TextEncoder)`), plus `REFUSES_TODAY` in tooling/bench and its test

**How the cases are built:** C++ references only. Inputs are built at run time from one LCG, the seed varies each call, and every checksum reads characters (except append-length, by design).

**Gate steps run:**
- benches: 85/85 compile on all three backends;
- bench-agree: 83/83 agree (the floor is still 52, a ratchet 31 behind);
- nts-bench: fmt, clippy and 30/30 tests;
- owed: build clippy tests rustfmt old-paths benches bench-agree dex expect-ir tooling primitives.

**First rows:** CPU 4, with-lock, NTS_BENCH_LANES=c,llvm, Bun run separately under taskset -c 4. Nine cases ran beside another session's compile. Checksums agree everywhere. Logs in logs/; the full table is in report-table.md.

**Seven of the 14 measured rows lose to node or Bun:**

| case | C/C++ | C/node | C/Bun |
|---|---:|---:|---:|
| str-append-length (ropes, by design) | 1.10 | 1.43 | 1.29 |
| str-slice-keep | 1.37 | 1.25 | 0.55 |
| str-index-read | 23.52 | 4.46 | 5.11 |
| str-compare | 0.89 | 1.33 | 0.69 |
| str-map-keys | 1.75 | 2.52 | 2.52 |
| str-index-of | 1.45 | 1.24 | 2.38 |
| str-to-number | 5.66 | 2.32 | 3.51 |

**Causes, read from the emitted C (not profiled):**
- **index-read:** `TEXT[i] === "x"` retains the module global, calls `nts_str_at` with a double index, releases the global, calls out-of-line `nts_string_eq` against the literal, and releases the one-unit result. A core fix: compare the unit directly, and don't count a borrow of an immutable module global.
- **to-number:** a copy plus glibc `strtod`, with no integer fast path (fast_float).
- **map-keys:** FNV recomputed per operation, plus erased boxed keys and values (the cached hash, and the objects study's typed table).
- **index-of:** an out-of-line search, plus global retain/release in the loop.
- **compare:** a unit-at-a-time walk with two width branches per unit, never `memcmp`.
- **slice-keep:** a heap allocation per piece.
- **split:** a heap slice per field, where C++ uses views.
- **template:** a left-folded concatenation chain (n-ary concatenation fixes it).
