# The JVM lane's rows, and what has already been asked of them

**This file is the state; the goal is the method.** A goal text that carries row
numbers goes stale the first time a row moves, and then it sends the next
session to redo finished work. So the numbers live here, and whoever moves a row
updates this in the same commit.

Two numbers per row: `jvm/Java` **at or under 1.00x** against the hand-written
`ref.java`, and **decisively** faster than node. 0.9x node is not a win.

## Where the rows stand

Measured on the JVM lane, all 51 cases, nothing refused. `->` marks a row this
lane has moved.

| row | jvm/Java | note |
| --- | --- | --- |
| `node-utf8` | 6.86x | blocked: 62% is `toInt32`, `narrow.rs` owns it |
| `symbol-keyed-map` | 2.95x | blocked: 52% is `toInt32` |
| `array-from` | 2.14x | see below -- the reference does less work |
| `array-predicates` | 1.74x | probed: the reference preallocates, see below |
| `absences` | 2.66x -> **1.32x** | unsigned remainder |
| `optional-chain` | 3.00x -> **1.26x** | unsigned remainder |
| `awfy-sieve` | 1.25x | probed: no single cause, see below |
| `awfy-queens` | 1.24x | probed: no single cause, see below |
| `generic-classes` | 1.13x | probed: no single cause, see below |
| `instanceof` | 3.74x -> **1.12x** | residual 12% is the guard branch |
| `bytes` | 1.19x -> **1.12x** | unsigned remainder |

Won: `exceptions` 0.01x, `bigint` 0.19x, `awfy-permute` 0.71x, `mandelbrot`
0.81x, `awfy-list` 0.93x, `awfy-nbody` 0.99x. Four AWFY rows under hand-written
Java, two at parity, two above.

## bytes/op, all 51 measured against Java

`exceptions` 0 against **9,100,000** -- Java's `fillInStackTrace`, and the
memory-axis twin of its 0.01x. `substrings` and `closures` 0. `bigint` 0.20x,
`number-format-double` 0.43x. **24 cases allocate nothing on either side.**

Losses: `node-utf8` 1.43x, `array-from` and `array-predicates` 1.33x.

Run allocation by executing the emitted classes directly under
`NTS_BENCH_ALLOC=1`. Through the runner it fails as "measuring two different
programs", because bytes/op replaces the checksum line the runner compares.

## Asked and answered -- do not spend a second evening on these

Each cost a measurement. The number in brackets is what the fix was worth.

- **Conversion CSE** on `node-utf8`'s nine `toInt32` of one value. **[8% of a
  2.4x gap.]** The cost is the value living in a double slot, not the count of
  conversions. One conversion per iteration measured 2.20x against 2.39x.
- **Hoisting a loop-invariant `count(view)`** out of `utf8Write`. **[1%.]** C2
  already does it.
- **Removing the view bounds check as redundant with the JVM's.** **[Unsound.]**
  The JVM checks the backing array; ours checks the view window, and a view over
  a shared `ArrayBuffer` is narrower. What *is* doubled is ours against itself --
  `NtsView.at` re-checks and raises a byte-identical refusal -- and dropping the
  front `elements`+`bounds` pair is worth **[~8%]**.
- **Always hashing instead of `findLinear`** on `symbol-keyed-map`, where the
  scan is 20% of the profile. **[2%: 3.35x to 3.29x.]** The comparisons are the
  work and hashing costs the same. Recorded at `NtsMap.LINEAR_LIMIT`.
- **Scalarising `NtsValue`.** **[Not needed.]** C2 scalar-replaces it: 0.00
  bytes/op with five sites still in the bytecode. Ship boxed. `erasure-unknown`
  is the control if narrowing changes anything.
- **The growable-array wrapper's per-access allocation.** **[There is none.]**
  `growth-grown` reads 2.01x on bytes/op because it pushes 2048 times and
  `ref.java` preallocates -- the reference not growing, not our wrapper costing.
- **`array-predicates`' array building**, which is 45% of its profile: `push`
  21%, `of` 15%, `Arrays.copyOf` 9%. **[Nothing left to take.]** `filter`
  already allocates `of(count(source))`, sized to the source length. What
  remains is that `ref.java` writes `new double[n]` for both `xs` and `kept`
  and never grows, where the TypeScript writes `[]` + `push` -- the reference
  doing different work, not a defect. Growing faster than `max(4, current*2)`
  is the only lever left and it trades against bytes/op, where this row already
  loses at 1.33x.

## Open, and whose

**Blocked on `narrow.rs`** (integer arithmetic held in `f64` slots): `node-utf8`
62%, `symbol-keyed-map` 52%. The C lane emits the identical defect, so it is
fixed once, upstream. Do not build a JVM-only half. When it lands, measure the
rows *before* taking any residual -- `narrow.rs` records three earlier attempts
that each read as zero because two changes moved together.

**Mine.** `symbol-keyed-map`'s `findLinear` is *not* open -- see the list
above; it is worth 2%. `array-from`: the array half is already bulk (`slice` ->
`Arrays.copyOfRange`); the set half walks `next`/`keyAt` per element and unboxes
to a `double[]`, where `ref.java` calls `HashSet.toArray()` and never unboxes --
so check how much of that 2.14x is a reference doing less work before treating
it as a gap. `instanceof`'s residual 12% is the `uirem` guard branch; the agreed
fix is `specialize` typing a provably non-negative `rem : u32` as `i32`, which
is the middle end's, so ask rather than re-deriving a range in the backend.

**Probed, no single cause.** `awfy-sieve` (`Sieve$sieve` 70%), `awfy-queens`
(`getRowColumn` 52%) and `generic-classes` (`work$whole`, everything inlined)
are all dominated by *generated code* with no runtime helper standing out. All
three use bare JVM arrays -- `[Z`, `[D` -- with direct loads and the JVM's own
bounds check, which is the fast path: no wrapper, no `NtsRuntime.bounds`, no
`ifnull`.

`awfy-queens`' hot method is byte-for-byte the shape of its original:
`freeRows[r] && freeMaxs[c + r] && freeMins[c - r + 7]` becomes three `baload`
with short-circuit branches off direct fields, which is what `javac` emits.
Closing 1.13-1.25x on these needs an assembly diff against the reference via
`hsdis`, not another profile -- a profile has already said all it can.

One incidental finding, not hot here but the same family as `narrow.rs`'s:
`Queens.queenRows` is emitted `[D` with an `i2d` per store, where AWFY's Java
uses `int[]`. An array's element type is `hir::elements`' decision, so it is
theirs, and both native lanes carry it too.
