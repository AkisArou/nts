# 0358 — Code placement is a draw, not a cost

**Decided 2026-10-17, by the compiler lane.** Applies to how a benchmark row
that moves without its code changing is read, and to the link flags native
products and the bench are built with.

## What kept happening

Three changes in two days moved rows whose hot code they did not touch:

- slice 3 (printer raises) cost `json-serialize` 5.9% and `json-stringify-typed`
  4.9% on C while their hot functions were instruction-for-instruction
  identical, moved 0x450 bytes by new cold code; and won `printer-erased` 19.9%
  on LLVM the same way;
- 47c07b76d (a dead string freed directly) cost `node-utf8` 3.4% on C while
  `utf8Decode` and `utf8Write` were identical and 0x90 bytes lower, because
  `nts_release` got smaller.

## What was measured

`node-utf8` rebuilt by hand from the bench's own sources, with main's runtime
and with 47c07b76d's, alternated five times on one core: 58.9 and 56.4
microseconds -- the **reverse** of the bench's builds of the same two runtimes,
56.9 and 58.8. The sign of a placement effect is a property of the whole link,
not of the change.

Loop alignment (`-Wl,-plugin-opt=-align-loops=64`, which has to reach the LTO
code generator; at compile time it changes nothing) closed that pair's gap from
4.4% to 0.8%. Over twenty rows in a sitting on P-cores under the measurement
lock, the same `nts-bench` linking with and without it, (aligned / node) over
(plain / node), two rounds:

| row | C | LLVM |
|---|---|---|
| number-format (rc) | 0.82 / 0.84 | 0.85 / 0.81 |
| node-utf8 (rc) | 0.93 / 0.93 | 0.91 / 0.95 |
| upcast | 0.92 / 0.91 | 1.21 / 1.28 |
| awfy-permute | 1.15 / 1.10 | 0.86 / 0.87 |
| awfy-bounce | 1.14 / 1.17 | 1.09 / 1.05 |
| the other fifteen | 0.95 -- 1.06 | 0.90 -- 1.05 |

The JVM and Wasm columns, which the flag cannot reach, moved by up to 11% on
`awfy-bounce` and 29% on `awfy-sieve` in the same sitting -- the noise floor.

## The decision

1. **No alignment flag.** It is a different draw, not a better one: a 16% win
   on one row is a 25% loss on another. A flag that helped on average would
   still make every A/B against the unaligned base a comparison of two draws.
2. **A row that moves by less than about 5% without its code changing is
   placement, and is reported as such.** The check is the one slice 3 and
   47c07b76d both made: the moved row's hot functions, disassembled and
   normalized for addresses, are identical between the two builds. If they
   are, the change is credited and charged nothing for that row.
3. A real fix is statistical rather than a flag: measuring each arm over
   several link orders (randomized layout, as Stabilizer does) so that a row's
   number is the mean over placements rather than one sample of them. Not built
   yet; when an A/B decision ever turns on a row inside this band, that is the
   instrument to build first.
