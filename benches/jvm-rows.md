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
| `array-from` | 2.14x | real gap: rule 4 checked and does NOT excuse it |
| `array-predicates` | 1.74x | probed: the reference preallocates, see below |
| `absences` | 2.66x -> **1.32x** | unsigned remainder |
| `optional-chain` | 3.00x -> **1.26x** | unsigned remainder |
| `awfy-sieve` | 1.25x | narrowing family -- blocked, not an assembly row |
| `awfy-queens` | 1.24x | partly narrowing -- 2 f64 block params, 6 f64 adds |
| `generic-classes` | 1.13x | C2 unrolls the reference's loop and not ours |
| `instanceof` | 3.74x -> **1.12x** | residual 12% is the guard branch |
| `bytes` | 1.19x -> **1.12x** | unsigned remainder |
| `array-methods` | 1.17x | 25% is `toInt32` on an `f64` accumulator -- blocked |
| `number-format-double` | 1.09x | 55% our Grisu port vs the JDK's own formatter |
| `module-closures` | 1.06x | no single cause -- needs `hsdis` |
| `elementwise` | 1.03x | at its floor: both lanes vectorise |
| `upcast` | 1.07x -> **1.01x** | unsigned remainder |

Won: `exceptions` 0.01x, `bigint` 0.19x, `awfy-permute` 0.71x, `mandelbrot`
0.81x, `awfy-list` 0.93x, `objects` 0.96x, `awfy-nbody` 0.99x. `objects` read
1.07x in the first sweep and that was one of the 32 rows measured while another
session compiled -- re-measured quiet, it is a win. Four AWFY rows under hand-written
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
62%, `symbol-keyed-map` 52%, `array-from`'s cursor, and `array-methods` at 25%
-- its `total` is an `f64` accumulator behind `| 0` where `ref.java` writes `int
total`, which is the chain `narrow.rs`' own header names for `i64 -> i32`. The C lane emits the identical defect, so it is
fixed once, upstream. Do not build a JVM-only half. When it lands, measure the
rows *before* taking any residual -- `narrow.rs` records three earlier attempts
that each read as zero because two changes moved together.

**Mine.** `symbol-keyed-map`'s `findLinear` is *not* open -- see the list
above; it is worth 2%. `array-from` **is** open and the obvious excuse for it is
gone: the array half already bulk-copies (`slice` -> `Arrays.copyOfRange`), and
the set half walks `next`/`keyAt` per element and unboxes into a `double[]`
where `ref.java` calls `HashSet.toArray()` and copies references. That looked
like the reference doing less work. It is doing **more** -- unboxing into a
`double[]` measured **0.78-0.81x** of `toArray()`, twice. So `NtsMap.keyAt` at
34% of that profile is a real target, and the shape of a fix is a bulk
`keys-into-array` helper rather than two calls and index arithmetic per element.
The obstacle is that the loop is the *lowering's*, not the runtime's, so the
helper needs someone to call it.

**And there is a second, independent fix, measured: the cursor is a `double`.**
The emitted walk is `next(map, D) -> D` and `keyAt(map, D)`, so every element
pays two `d2i` and an `i2d`, and the base/slot arithmetic twice. The same walk
with an `int` cursor, identical output element by element:

    double cursor   0.987 / 0.983 us   3.24x / 3.25x
    int cursor      0.305 / 0.302 us   1.00x

**3.24x** on the 38% of this row that is `keyAt` plus `next`. Doing it needs
`int` overloads in `NtsMap` and an extension to `intcall`, which today swaps
only a helper's *return* type -- the cursor needs its **argument** narrowed too,
and `narrowed`'s rule ("every use is an integral conversion") does not currently
admit "used as the argument of a helper that has an int overload".

**But the int overloads cannot apply on their own, checked before building
them.** The cursor is an `f64` *block parameter* incremented by an `f64` add:

    b13(%50: f64, %52: f64):
      %58 = call.extern nts_map_key_at(%14, %50) : erased
    b15(%51: f64, %53: f64):
      %64 = add %51, %81 : f64
      %65 = call.extern nts_map_next(%14, %64) : f64

That is the same integer-in-a-double-slot as `node-utf8`'s `%7`, so the 3.24x
above is what the walk costs *once the cursor is an int* -- a hand-written loop
that had already assumed the narrowing. Holding it as one needs a fixpoint over
the cycle {block parameters, `add 1`, `next`'s result}, which is either
`narrow.rs`'s range work or a backend-local extension of `intcall` from a single
value to a cycle.

So this row is blocked on the same thing as `node-utf8` and `symbol-keyed-map`,
and the JVM half is the int overloads, which are worth nothing until the cursor
narrows. **The scope of that upstream fix is wider than one row**: every `for
(const x of set)` in every program lowers to this pair. `instanceof`'s residual 12% is the `uirem` guard branch; the agreed
fix is `specialize` typing a provably non-negative `rem : u32` as `i32`, which
is the middle end's, so ask rather than re-deriving a range in the backend.

**Every row is now probed.** `number-format-double` at 1.09x is 55%
`NtsGrisu.shortest`, against a reference that calls `Double.toString` -- the
JDK's own formatter, the Giulietti algorithm since 19. Being within nine percent
of it with a portable Grisu port is near the floor for this shape; closing it
means a better Grisu, not a better backend.

**Probed, no single cause -- three rows, not five.** I had `awfy-sieve` and
`awfy-queens` here and both are the narrowing family, which a profile could not
show and the IR says in one line. `Sieve#sieve#whole` carries

    b1(%5: f64, %7: i64):
      %16 = add %5, %32 : f64

-- a counter in a double *and* an index in a long where `i32` would do, the
second being what `narrow.rs`'s existing `i64 -> i32` pass is for. `awfy-queens`
has 2 `f64` block parameters and 6 `f64` adds. Counting `f64` block parameters
and adds in the prepared IR is a five-second check that reclassified two rows I
had sent to the assembler.

`generic-classes`, `module-closures` and `elementwise` have **zero** `f64` block
parameters and no `i64` ones, so those three are genuinely about emitted code.
`hsdis` is built at `~/Projects/hsdis/build/linux-amd64/hsdis-amd64.so` and
loads with `LD_LIBRARY_PATH` plus `-XX:+PrintAssembly`.

Two of the three are now answered by an assembly diff:

- **`elementwise` is at its floor.** Both lanes vectorise -- 36 `vmulpd` against
  the reference's 45, an unroll-factor difference on the same SIMD shape. 1.03x
  with both vectorised is not a gap worth opening.
- **`generic-classes` is an unrolling difference, and the instruction counts say
  so backwards.** Our `work$whole` compiles to **284** instructions and the
  reference's `work` to **526** -- and the reference is *faster*. Its body
  carries roughly twice ours (12 `xor` / 18 `add` / 31 `cmp` against 7 / 10 /
  8), which is C2 unrolling its loop and not ours. Re-measured quiet, twice, to
  rule out the contaminated sweep: **1.13x / 1.21x**, so it is real. Why the
  loop is not counted is the open question and it is the only row where fewer
  instructions are the problem. All
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
