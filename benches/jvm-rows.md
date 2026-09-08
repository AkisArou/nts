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
| `array-from` | 2.14x | **priced: 5.9x on the set walk** -- the lowering's, below |
| `array-predicates` | 1.74x | probed: the reference preallocates, see below |
| `absences` | 2.66x -> **1.32x** | unsigned remainder |
| `optional-chain` | 3.00x -> **1.26x** | unsigned remainder |
| `awfy-sieve` | 1.25x | narrowing family -- blocked, not an assembly row |
| `awfy-queens` | 1.24x | no cause found: the merge was measured and is not it |
| `generic-classes` | 1.13x | no cause found: assembly is comparable |
| `instanceof` | 3.74x -> **1.12x** | residual 12% is the guard branch |
| `bytes` | 1.19x -> **1.12x** | unsigned remainder |
| `array-methods` | 1.17x | 25% is `toInt32` on an `f64` accumulator -- blocked |
| `number-format-double` | 1.09x | 55% our Grisu port vs the JDK's own formatter |
| `module-closures` | 1.06x | closure ABI is `(D)D` where the reference's is `(I)I` |
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
- **Inlining the constructor body into `<init>`**, instead of a trivial
  `<init>()V` followed by a static `$constructor` call. The plan deferred this
  from the start -- "gated on whether the JIT is shown to care" -- and
  `generic-classes` looked like the evidence, since we emit four calls per
  iteration where Java's `new Box<>(v)` emits two. **[0.99x. It does not
  care.]** Priced on a hand-written pair, twice: 2.17 vs 2.14 us, and 2.15 vs
  2.13. C2 inlines both forms equally. So the question the plan left open is
  answered, and the answer is not to do it -- which also keeps `readonly` out of
  `ACC_FINAL` and this backend out of the verifier's `uninitializedThis` corner.
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

- **A mask for an unsigned remainder by a power of two.** `uirem` guards with
  `(left | right) >= 0` and calls `Integer.remainderUnsigned` when either has
  its high bit set; for a power-of-two divisor `x & (d - 1)` is the unsigned
  remainder for every `x`, and `optional-chain` is `i % 2`. Built, correct, and
  it fired -- re-emitting the case gave `uirem=0 iand=1`. **[0%, and the
  microbenchmark said 1.60x.]** On the row: 44,248 / 44,432 ns masked against
  44,409 guarded, with the Java reference at 35,455 / 35,606 as the drift
  control. C2 inlines `uirem`, constant-folds the divisor, proves the guard and
  strength-reduces the remainder itself, so there was nothing there to take.
  **The lesson is narrower than "price it first", which I did.** The
  hand-written pair called the helper with a divisor C2 could see but in a loop
  it could not fold the guard out of; the reference has to do the same work
  *in the same context*, not just the same work. A microbenchmark of a helper
  is a measurement of the helper, not of the call site. Reverted; the patch is
  the diff of `power_of_two_divide` in `ops.rs`, should a lane whose JIT does
  not do this -- ART is the candidate, and is not what `benches/` measures --
  ever want it.

- **Coalescing a block parameter's slot with its argument's.** `getRowColumn`
  emits `istore 7; iload 7; istore 8` where javac emits nothing, so sharing one
  slot between a parameter and the values that feed it looked like the fix, and
  it is the standard out-of-SSA answer. **[0.4%. It is not the copy.]** Priced
  on AWFY's own `Queens` against a copy differing only in `getRowColumn`, five
  samples each, one JVM per arm:

      short-circuit   `freeRows[r] && freeMaxs[..] && freeMins[..]`   9,338 ns
      coalesced       one variable reused across both arms           12,620 ns
      materialised    a fresh variable per arm, copied at the merge  12,666 ns

  Coalesced and materialised are within 0.4% of each other and both are 1.35x
  the short-circuit form -- which said the cost was the value crossing the
  join, not the copy into the slot, and pointed at threading the merge away.

  **Threading was then built, and it is worth 0.16%.** `thread.rs` took a
  merge with no operations whose terminator reads only its parameter and gave
  its terminator to each predecessor, with a branch's arm told what its
  condition was so the one parameter read below the merge became a constant.
  It fired: `getRowColumn` went 55 bytecodes to 46, the join gone, javac's
  shape. Eight interleaved rounds, same checksum:

      before    10990 11067 11004 11440 11325 11282 11461 11227   mean 11,224
      threaded  11212 11117 11078 11415 11162 11121 11517 11311   mean 11,242

  **So the 1.35x was real and did not transfer, and the reason is the same one
  that cost me the power-of-two fix an hour earlier, one level subtler.** There
  I priced a helper in a context C2 could not optimise the way it optimises the
  real call site. Here I transcribed a *bytecode shape* into *Java source* and
  priced javac's compilation of my transcription -- three separate locals live
  at once -- rather than our bytecode, which stores and reloads one slot per
  merge and which C2 sees straight through. **A transcription of emitted code
  into source is not that emitted code.** The proxy has to be the artefact, and
  on this lane that means emitting both ways through `nts-bench` and timing the
  classes, which is what finally answered it.

  Both halves are therefore refuted: coalescing buys nothing, and so does
  removing the join. `awfy-queens` has no cause found, and joins
  `generic-classes` on that short list. The reverted `thread.rs` and its hooks
  are at `~/.cache/nts-merge-threading` -- correct, verified, 250 lines, and
  paid for by nothing.

  One thing it did establish, worth keeping: the `.javaref` for `awfy-queens`
  cannot be run by hand from a bench directory -- `NoClassDefFoundError:
  Queens`, because AWFY's own classes are not on that classpath. That is the
  trap that made the Java column for `awfy-sieve` and `awfy-queens` produce no
  number before, and it is still there.

  Two harness notes, both of which produced a wrong number first. Three arms
  behind one `IntPredicate` made the call site **megamorphic** -- the
  short-circuit arm alone moved 9,436 to 17,330 ns, because C2 stopped inlining
  `innerBenchmarkLoop` and every arm was then measured through a virtual call
  the benchmark does not have. One JVM per arm, chosen by argv, fixed it. And
  the first clean run still had one 21,991 outlier against a 12,620 median, so
  five samples rather than two is what makes this readable.

## Open, and whose

**Blocked upstream, and it is TWO fixes rather than one** -- a distinction that
matters when reading a row that does not move.

*The range relation*, a fact about a value inside a function: a loop counter
bounded by something with no constant bound widens to infinity, so `width_of`
refuses the class and it stays `f64`. `node-utf8`'s `outputIndex`, `array-from`'s
cursor, `awfy-sieve`, `awfy-queens`, `array-methods`.

*Signature narrowing*, a decision about a **type across the whole program**:
`module-closures`' `Closure0$call:(...D)D`. `specialize` refuses to narrow a
parameter that a dispatch table names, because every closure of a signature
shares the slot and every call site spells it -- so narrowing one body means
narrowing the signature, and every implementation and caller must agree at once.
No range relation reaches it. Same motive, different machinery.

`queenRows` emitted `[D` is a third home for the same motive -- `hir::elements`
and an array's element type -- which makes it a representation in **four**
places: a counter, a signature, an array element, and a helper's argument.
Only one of them is a loop.

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

**Now priced, and it is the largest number this lane has measured. 5.9x on the
operation, and the bulk form beats the reference by 2.3x.** A prototype
`NtsMap.keysIntoArray(map, out)` -- one loop over `keys[head..used]`, skipping
nulls, writing `key.num` into `out.items` -- against the walk `work$whole`
actually emits, both arms building the same `NtsArrayD`, 2000 rounds of 256
elements, run twice with identical checksums:

    walkArray   `of(size)` then next/keyAt/set per element   2,086,435 / 2,088,315 ns
    bulkArray   one `keysIntoArray` call                       358,671 /   347,256 ns
    toArray     `ref.java`'s HashSet.toArray()                 815,826 /   799,874 ns

So the set half goes from **2.56x the reference to 0.44x**. The profile agrees
about where it sits: `keyAt` 28.7%, `NtsArrayD.set` 9.0%, `next` 5.2% -- 43% of
our profile against the reference's 25% in `keysToArray` plus `toArray`.

**And the ask upstream is smaller than it looks, because half of it is already
there.** `Array.from(xs)` over an *array* lowers to a single bulk
`NtsArrayD.slice`. Only the *set* source walks. So this is not new machinery, it
is the source kind that did not get the treatment the other one has.

Why the walk costs 5.9x, since a bulk loop and a cursor loop do the same reads:
`next` re-derives its position from an absolute cursor every call
(`absolute <= base ? head : max(head, absolute - base)`), the cursor is a
`double` so each element pays a `d2i` and an `i2d`, `keyAt` repeats the same
derivation and bounds test, and the key is reached through an `NtsValue`
pointer. The bulk loop increments an `int` and reads the array.

**Blocked on the lowering, and worth more than anything left in this lane.**
Priced, not built -- the prototype is a scratch copy of `runtime/jvm/src`, and
`runtime/jvm/nts-runtime.jar` is untouched. It also cannot be taken in the
backend: recognising this loop as an idiom is a fragile pattern match over
emitted code, and the honest place for it is where `slice` already is.

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

`generic-classes`, `module-closures` and `elementwise` have zero `f64` *block
parameters*, which is what I counted -- and for `module-closures` that was the
wrong thing to count. Its closure **signature** is
`Closure0$call:(Lnts/gen/Closure0;D)D`, taking and returning a double with a
`d2i` at every call site, where the reference declares `interface IntFn { int
apply(int); }`. Our closure bodies compile to 54 bytes against the reference's
13 and 12. So it is the narrowing family at the closure ABI rather than in a
loop counter, and `signatures::specialize` is where a `number` parameter every
caller passes an integer to would be narrowed. **Seven rows now rest on one
upstream cause.**

That leaves two rows genuinely about emitted code.
`hsdis` is built at `~/Projects/hsdis/build/linux-amd64/hsdis-amd64.so` and
loads with `LD_LIBRARY_PATH` plus `-XX:+PrintAssembly`.

Two of the three are now answered by an assembly diff:

- **`elementwise` is at its floor.** Both lanes vectorise -- 36 `vmulpd` against
  the reference's 45, an unroll-factor difference on the same SIMD shape. 1.03x
  with both vectorised is not a gap worth opening.
- **`generic-classes` has no cause anyone has found, and my first answer was
  wrong.** I reported it as an unrolling difference on the strength of our
  `work$whole` compiling to 284 instructions against the reference's 526. **That
  compared different kinds of compilation.** `PrintAssembly` emits every one, and
  `%` in the header marks on-stack replacement; taking the first match in each
  file gave our C1/OSR block against their C1 block. Comparing the *standard C2*
  compilations of both:

      ours     194 instructions   54 xor    5 cmp
      theirs   214 instructions   33 xor   24 cmp

  Comparable in size, and if anything ours is the more unrolled. The reference
  also carries G1 write barriers -- its erased `Object` field needs them and our
  monomorphised `double`/`boolean` fields do not -- so it is doing strictly more
  work per store and still winning.

  The row is real: **1.13x / 1.21x** re-measured quiet, twice. The split
  constructor is excluded at 0.99x, the assembly is comparable, both scalar
  replace at 0.00 bytes/op. Nothing found. All
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
