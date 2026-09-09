# The JVM lane's rows, and what has already been asked of them

**This file is the state; the goal is the method.** A goal text that carries row
numbers goes stale the first time a row moves, and then it sends the next
session to redo finished work. So the numbers live here, and whoever moves a row
updates this in the same commit.

Two numbers per row: `jvm/Java` **at or under 1.00x** against the hand-written
`ref.java`, and **decisively** faster than node. 0.9x node is not a win.

## Where the rows stand

**Re-taken from the current tree on 2026-09-08, all 51 cases, nothing refused.**
The previous table was read from `~/.cache/nts-jvm-sweep`, which is pinned at
`f071672b` from 08:41 and so predates this morning's `uirem` fix -- see the
stale-worktree section below. `->` marks a row this lane has moved. A row marked
*busy* or *jit* is one `nts-bench` itself flagged: another compiler was running,
or the same binary varied by more than 10% across five runs. **Those four are
not measured clean and should not be quoted.**

**25 rows above 1.00x, 26 at or under it.**

| row | jvm/Java | note |
| --- | --- | --- |
| `node-utf8` | **6.3-6.6x** | blocked: 62% is `toInt32`; 1% within a sitting, 4% between |
| `symbol-keyed-map` | 2.92x *jit* | blocked: 52% is `toInt32` |
| `array-from` | 2.09x | **priced: 5.9x on the set walk** -- the lowering's, below |
| `array-predicates` | 1.70x | at its floor: every helper inlines; the wrapper is the row |
| `absences` | 2.66x -> **1.29x** | blocked: **34%** is `uirem` over an `l2i` counter |
| `optional-chain` | 3.00x -> **1.26x** *busy* | the same `uirem` residual |
| `awfy-queens` | 1.25x | 20.6% is codegen and MINE -- ladder below |
| `generic-classes` | 1.17x | **cause found**: monomorphisation, not codegen -- below |
| `array-methods` | 1.14x | 25% is `toInt32` on an `f64` accumulator -- blocked |
| `number-format-double` | **1.08x** | the formatter is 54% of the profile and 1.7% of the gap |
| `elementwise` | 1.08x | at its floor: both lanes vectorise |
| `instanceof` | 3.74x -> **1.08x** | 60% of the profile is `uirem`; bounded at 8% |
| `in-narrowing` | **1.01x** | re-measured; was listed at 1.07x from a contaminated run |
| `module-closures` | 1.06x *busy* | closure ABI is `(D)D` where the reference's is `(I)I` |
| `awfy-sieve` | **1.03x or 1.27x** | two modes, and "two JIT shapes" was wrong -- below |
| `bytes` | 1.19x -> **1.05x** | the `uirem` residual |
| `objects` | **0.99x** | re-measured clean: still a win, as it was |
| `generator` | **0.99x** | re-measured clean: not losing |
| `symbol-keys` | **0.98x** | re-measured clean: not losing |
| `arrays` | 1.03x | **not previously listed** |
| `fib` | 1.03x | **not previously listed** |
| `upcast` | 1.07x -> **0.99x** | re-measured clean; no `uirem` in its profile |
| `checksum` | **1.00x** | parity |
| `closure-merge` | **1.00x** | parity |
| `growth-grown` | 1.01x | **not previously listed** |

**Eight rows were losing and unlisted**, all between 1.01x and 1.07x, which is
why they were invisible: a table written from the rows someone had already
looked at is a record of attention rather than of the lane. `in-narrowing` at
1.07x is the largest of them.

At or under 1.00x, best first: `exceptions` 0.01, `bigint` 0.17,
`array-mutations` 0.67, `awfy-permute` 0.72, `loop` 0.75, `awfy-mandelbrot`
0.84, `closures` 0.85, `map-and-set` 0.86, `user-iterable` 0.90, `awfy-list`
0.93, `case-convert` 0.94, `logical-assignment` 0.94, `substrings` 0.95,
`erasure-stored-unknown` 0.96, `awfy-bounce` 0.97, `awfy-towers` 0.98,
`erasure-stored-typed` 0.98, `dispatch` 0.99, `pipeline` 0.99, and at 1.00
exactly: `accumulate`, `awfy-nbody`, `erasure-typed`, `erasure-unknown`,
`growth-fixed`, `number-format`, `strings`.

**Five AWFY rows at or under hand-written Java, one at 1.05 pending a clean
run, two above.** `loop` at 0.75x is worth noting against its own history: it
was 1.93x when this lane started and the cause was number specialization
rather than codegen.

## bytes/op, re-taken from the current tree

**Deterministic, so unlike the timings these are unaffected by a busy machine**
-- `getThreadAllocatedBytes` counts bytes, not nanoseconds. Run by executing the
emitted classes directly under `NTS_BENCH_ALLOC=1`; through the runner it fails
as "measuring two different programs", because bytes/op replaces the checksum
line the runner compares. 43 of the 51 cases have both halves built.

**17 allocate nothing on either side**: `absences`, `accumulate`, `checksum`,
`elementwise`, `erasure-unknown`, `fib`, `generic-classes`, `in-narrowing`,
`instanceof`, `logical-assignment`, `loop`, `module-closures`, `objects`,
`optional-chain`, `strings`, `symbol-keys`, `user-iterable`.

**We allocate less on nine.** `closures` 0 against 16, `substrings` 0 against
24,576, and `exceptions` **0 against 9,100,000** -- Java's `fillInStackTrace`,
and the memory-axis twin of its 0.01x. Then `bigint` 0.20x,
`erasure-stored-unknown` 0.29x, `number-format-double` 0.43x,
`array-mutations` 0.58x, `case-convert` 0.88x, `symbol-keyed-map` 0.90x.

**We allocate more on six**, and one of them is a different kind of finding:

| row | ours | `ref.java` | |
| --- | --- | --- | --- |
| `arrays` | 272 | **0** | see below -- shared with C and LLVM |
| `growth-grown` | 32,896 | 16,400 | 2.01x; the reference preallocates, answered below |
| `node-utf8` | 98,472 | 65,568 | 1.50x; blocked with its timing |
| `array-predicates` | 24,992 | 18,792 | 1.33x |
| `array-from` | 8,280,864 | 6,232,944 | 1.33x |
| `bytes` | 4,176 | 4,112 | 1.02x |

`map-and-set`, `growth-fixed`, `upcast` and `pipeline` are equal to the byte.

### `arrays`: the only row where we allocate and the reference allocates nothing

272 bytes/op against **0**, and an allocation profile says `double[]` is 99.44%
of it. The case declares its 32-element table *inside* the function:

    export function convolve(seed: number): number {
      const xs = [0, 37, 74, 10, ...];   // 32 doubles + header = 272 bytes

and `ref.java` writes `private static final double[] XS`, so it allocates once
at class init and we allocate per call. **Rule 4 says that is the reference
doing different work** -- but it is also what a Java programmer writes, which is
the standard `ref.java` is held to, and the hoist is one our compiler could
make: the array's elements are all constants, it is never written, and it never
escapes the function.

**It is not this lane's, because all three backends do it.** The C emission
calls `nts_array_new` per call and then fills the thirty-two elements one at a
time -- so the shared cost is larger there than here, being 32 stores as well as
the allocation. A constant array literal that is never mutated and never
escapes could be a module-level constant in every lane, which is `hir::escape`
and `hir::elements`' question rather than a backend's.

Handed over with the number. The upside is bounded and worth saying so: this
row is **1.03x** on time, so the hoist is worth at most 3% there, and the whole
272 bytes/op on the other axis.

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

- **Removing `NtsArrayD.keepFirst`'s zero-fill of the discarded tail.**
  `filter` calls it eight times an operation on `array-predicates`, and a
  `double` pins nothing, so the fill releases nothing. **[0%, and the premise
  was wrong twice over.]**

  Wrong the first time because **the fill is not garbage-collection hygiene**.
  `runtime_regression` failed in one run -- `array content: 315.0 != 0.0` --
  because its operation 5 writes past the end, and `set` extends `length` over
  whatever the capacity is still holding, where JS says a hole reads as `0`.
  The clear is there so a slot above `length` cannot become *readable* stale.
  `NtsArrayL` has both reasons and keeps it; this class has only the second,
  and the second is enough. No profile could have shown that.

  Wrong the second time because moving it to `set` -- the only moment a hole
  becomes readable, and a thing `array-predicates` never does -- keeps the
  invariant, does strictly less work, and measures as nothing:

      head  min 3980.9   p25 4099.1   median 4233.3   (n=14)
      new   min 3977.4   p25 4128.1   median 4174.2   (n=14)

  **The two earlier readings that said 2.4% and 5.0% were noise**, and the tell
  is that their minima -- 4212 and 4159 -- are *higher* than this run's 3981.
  A run whose floor is worse than another run's floor was more contended, so
  its "effect" was contention landing unevenly on two arms. Comparing minima
  across runs is what caught it; comparing an effect within one run did not.

  Reverted to a comment, because the thing worth keeping is why the fill exists.
  The patch is at `~/.cache/nts-arrayd-fill`.

  **And a trap for anyone editing `runtime/jvm`: this was a comment-only change
  and it still broke `the_jar_matches_the_sources_it_was_built_from`.** Twenty
  four lines of doc comment shift every later method's `LineNumberTable`, so the
  class bytes move. The jar is a function of the file, not of the semantics.
  Regenerate on any source edit.

- **Where `array-predicates` actually stands: at its floor for this backend.**
  Rule 1 first, and it disposed of the obvious reading. The profile shows 37.6%
  of our samples outside `predicates$whole` -- `push` 15.5%, `of` 11.0%,
  `Arrays.copyOf` 6.2%, `fill` 3.0% -- against the reference's **92.6% in one
  frame**, which looks like call overhead and is not. `PrintInlining` says
  `push`, `of`, `keepFirst`, `count` and `Arrays.fill` all inline **hot** into
  `predicates$whole`. The split frames are attribution; the reference's
  allocation and zeroing are inside its 92.6% for the same reason ours are
  outside.

  So what is left is the growable wrapper against a bare `double[]`, which
  `ref.java`'s own comment already settled by writing the program nine ways:
  hand-written Java over `nts.rt.NtsArrayD` lands **within 0.3%** of what we
  emit. There is no codegen gap in this row. It is `arrays_can_grow` being
  whole-program -- one `push` anywhere puts every array behind the wrapper --
  and per-array growability is `hir::elements`', not this lane's.

### The worktree these numbers were taken from was eight hours stale

`~/.cache/nts-jvm-sweep` is pinned at `f071672b`, 08:41, which is an **ancestor
of the `uirem` fix**. Every emission under its `target/bench` predates today.

I found it by measuring `absences` there and getting **2.66x** -- which is this
table's own *pre-fix* value for that row, with `Integer.remainderUnsigned`
sitting in the profile, the fallback that fix removed. Re-emitted from the
current tree it is **1.27x** (560.2 ns against Java's 439.8, node 802.5, so
0.70x node). The table was right and the instrument was behind it.

**A pinned worktree has a shelf life and nothing here records it.** Pinning is
the right answer to "a sweep cannot outlive a moving tree" and it becomes the
wrong answer the moment the tree it is pinned to stops being the one the claims
are about. Whatever re-pins it should write the commit and timestamp beside
`target/bench`, because a stale number looks exactly as authoritative as a
fresh one.

Five rows moved after `f071672b` -- `absences`, `optional-chain`, `instanceof`,
`bytes`, `upcast`, all by the `uirem` fix -- so any of those read from that
worktree is the old value. What survives from today: the `array-from` price
(its harness called the *current* runtime through hand-written arms), the
`awfy-queens` A/B (both arms emitted fresh through `nts-bench`), and the
`array-predicates` jar swap (the classes were held fixed across arms).

### `absences` is the `uirem` residual, and it is 34%

Re-profiled on a current emission. `NtsRuntime.uirem` is **33.89%**, the
largest item after `absences$whole` itself, and the reference has no
counterpart. It inlines hot at every site, so this is not call overhead -- rule
1 checked.

The call sites say what it is:

    172: l2i                     <- the counter is an i64, truncated per use
    173: istore 20
    175: iconst_3
    182: invokestatic NtsRuntime.uirem:(II)I

`i % 3`, `i % 2` and `i % 5`, three an iteration, each an `l2i` of a long
counter feeding a *guarded* unsigned remainder, where `ref.java` has `int i`
and one `irem`. Two causes and both upstream: the counter held wider than it
needs (`narrow.rs`'s `i64 -> i32`) and the operands typed `u32` so the guard
cannot be folded (`specialize` typing a provably non-negative `rem` as `i32`,
which `instanceof`'s residual 12% already asked for).

**So this is the same cause as `instanceof`'s residual with a much larger
number on it** -- 34% against 12% -- which makes `absences` the better
reproducer to hand over. The power-of-two mask would fire on the `% 2` site and
is on the answered list above at 0%; do not take it out again.

### `in-narrowing`, characterised: everything matches except the slot traffic

The first look at one of the eight rows that were losing unlisted, and it is
worth writing down because the *absence* of a cause is the result.

Profile says nothing: **92.59%** in `work$whole` against the reference's
**93.44%** in `Ref.run`, no helper on either side, nothing outside the method.
So it is an emitted-code question, and the emitted code agrees with the
reference everywhere anyone would look first:

- **Our fields are `int`**, not `double` -- `Circle.radius`, `Wide.both` and
  the rest are all `I`, exactly as `ref.java` declares them. Specialization
  narrowed them. This is not the narrowing family.
- **The reference uses `instanceof` and a cast**, which is what we emit for
  `"both" in shape`. Same test, same arm order, same short-circuit.
- Same `new` count, same `putfield` count, same `iand`, `ixor` and `imul`
  counts. The arithmetic is instruction-for-instruction identical.

What differs is one thing:

    ours        187 instructions    44 iload + 35 istore = 79
    ref.java    110 instructions    about 20, and mostly `iload_1`..`iload_3`

**One slot per SSA value is the whole difference.** javac reuses three or four
slots and reaches the one-byte `iload_1`-style forms; we assign a slot per value
and cannot, so the same program is 1.7x the bytecode.

**And the only fix for it is on the answered list twice over.** Record 0004
measured the store/load round trip at C parity and called emitting "simple,
regular, obviously correct" code "measurably free"; a stack-residency
optimisation targeting exactly this traffic was built earlier in this project
and reverted, because C2 already removes it. Slot reuse by live range is the
other route and it costs the eighty-line StackMapTable design, which
`awfy-queens` established this afternoon is not worth paying for a merge.

So the honest position is: **this row is 1.07x, the cause is not found, and the
one visible difference is a lead two separate measurements have already
refuted.** The transcription route is closed as well -- writing a Java version
with redundant locals prices javac's compilation of my transcription, which is
what cost me `awfy-queens`. Building it and measuring is the only honest price,
and three fixes measured 0% today.

### The `uirem` residual, measured on all four rows rather than inferred

I had recorded `optional-chain`, `bytes` and `upcast` as carrying "the same
`uirem` residual" as `absences` on the strength of their having moved together
when that fix landed. That was an inference from a shared history, which is the
weakest kind. Measured, on current emissions:

    instanceof        60.10%     (recorded as 12% before, from the stale tree)
    absences          33.89%
    bytes             19.74%
    optional-chain    19.18%
    upcast            not in the top frames

**What that number is and is not.** It is the share of *our* profile spent in
`NtsRuntime.uirem`, and the reference has no frame for it -- but the reference
does the same remainder, inline, as one `irem`. So the **gap** is the guard,
the `l2i` of a long counter, and the call shape; it is not the whole 60%. The
rows bound the available gain honestly: `instanceof` is 1.08x, so at most 8%
there, and `absences` 1.29x, so at most 29%.

Saying it the other way -- "60% of `instanceof` is a helper the reference does
not have" -- would be the `array-predicates` mistake, where 37.6% "outside the
method" turned out to be attribution rather than extra work. The reference
spending the same time inside its own frame is exactly that shape.

`upcast` at 1.02x has no `uirem` in its top frames at all, so it moved for some
other reason and should come off this list.

- **`ACC_FINAL` on a field, and the construction scheme behind it.** The plan
  has said since it was written that this backend cannot make `readonly` into
  `ACC_FINAL`, because a constructor here is an ordinary method called after
  `new` and `putfield` on a final field outside `<init>` throws
  `IllegalAccessError` since JDK 9. `generic-classes` is 1.17x and `ref.java`'s
  `Box` has `private final T v`, so this was the standing suspect and it had
  never been priced -- the earlier 0.99x measured constructor *inlining*, and
  noted the `ACC_FINAL` consequence without testing it.

  **[0%, and measured on the reference itself rather than a proxy.]** One
  keyword removed from `ref.java`'s `Box`, and the field written by a separate
  `init` call after `new Box<>()` -- which is exactly the shape this backend
  emits. Five samples each:

      ref, final field, set in the constructor    ~1455 ns
      ref, non-final, set by a later call         ~1455 ns
      ours                                        ~1668 ns

  Identical to within 0.2%. **So the construction scheme is not the gap, the
  field flag is not the gap, and the reference wearing our shape is still 1.15x
  faster than we are.**

  Worth noting how this one was priced, because it is the shape today kept
  getting wrong: rather than transcribing our emitted code into Java -- which
  is what cost `awfy-queens` an afternoon -- **the change was made to the
  reference**, one keyword and one call site, leaving a natural Java program on
  both sides. A one-variable experiment on an artefact that already exists beats
  a two-variable one on an artefact you wrote to test it.

### `generic-classes` has a cause at last, and our codegen is not it

Carried the reference to our representation one variable at a time -- the
technique that had just refuted `ACC_FINAL` -- and it landed on our number.

    ref, one generic `Box<T>`, erased `Object` field, boxed values   ~1428 ns
    ref, carried to our shape                                        ~1662 ns
    ours                                                             ~1663 ns

**1662 against 1663, which is 0.06%.** Hand-written Java making the same
representational choices this backend makes is exactly as fast as what this
backend emits. So the row's 1.17x contains **no codegen gap at all**, and the
assembly comparison that found 194 instructions against 214 was right to find
nothing.

The carried reference is natural Java throughout, not a transcription of
bytecode. Four variables moved, together: two monomorphised classes instead of
one generic, primitive fields instead of an erased `Object`, no boxing, and a
trivial constructor with the field written by a later call. `final` had already
been shown to be none of it.

**The finding is the uncomfortable one.** Monomorphising `Box<number>` and
`Box<boolean>` into two classes with `int` and `boolean` fields is **slower on
HotSpot than one erased class holding boxed values** -- and the erased version
is the implementation this feature exists to reject. It allocates nothing
either way, both sides scalar-replace, and the boxed one still wins by 16%.

That is a representation decision, so it is `signatures::specialize`'s and the
middle end's rather than this lane's, and it is worth more than one row: it
questions an assumption the design rests on. Handed over.

**Separated, because rule 6 says so and it took one more variant.** A middle
reference with *two* classes whose fields are still erased `Object` holding
boxed values isolates the two halves:

    A  one generic class, boxed field        ~1386 ns
    B  two classes, boxed fields             ~1390 ns
    C  two classes, primitive fields         ~1641 ns
       ours                                  ~1641 ns

**Monomorphising into two classes costs nothing** -- A and B are 0.3% apart.
**The primitive field is the entire gap.** Confirmed at six samples each with
identical checksums and ranges that do not overlap:

    B  min 1384.3   median 1387.4   max 1394.0
    C  min 1620.8   median 1643.9   max 1670.8

**18.5%, and the mechanism is not allocation.** All three read **0.00
bytes/op**, so C2 scalar-replaces the box in every variant, including the one
holding a boxed `Integer`. So this is not "the boxed version allocates and we
do not"; both vanish, and the one that vanishes into an `Object` field is
faster than the one that vanishes into an `int` field.

That is counterintuitive enough to be worth stating narrowly: **one program,
one shape, one JDK.** What it does establish for this row is complete -- the
cost is the field's representation, monomorphisation is free, and our codegen
for the representation we chose is at parity with hand-written Java making the
same choice.

### The noise band, measured -- and six rows that were not losing

The re-taken table put 25 rows above 1.00x, eight of them newly listed between
1.01x and 1.07x. Those are the rows most likely to be an artefact of the run
rather than a fact about the lane, so the borderline thirteen were measured
**twice**. The second run carried no contamination flag at all; the first
carried seven.

    row              run 1    run 2 (clean)
    checksum         1.00x    1.00x     parity
    closure-merge    1.00x    1.00x     parity
    objects          1.00x    0.99x     wins
    upcast           1.01x    0.99x     wins
    generator        1.03x    0.99x     wins
    symbol-keys      1.05x    0.98x     wins
    in-narrowing     1.02x    1.01x     parity, not the 1.07x it was listed at
    arrays           1.03x    1.02x
    fib              1.03x    1.02x
    elementwise      1.05x    1.04x
    growth-grown     1.01x    1.06x
    bytes            1.10x    1.10x
    awfy-sieve       1.06x    1.26x

**Six of the eight newly-listed rows are at or under 1.00x.** They were listed
because a single contaminated sweep put them a few percent above it.

**So the honest count is nineteen rows losing, not twenty-five** -- and the
useful output is the band rather than the six. Run-to-run movement on the same
binary was 0.20x on `awfy-sieve`, 0.07x on `symbol-keys`, 0.05x on
`growth-grown`, 0.04x on `generator`. **A row between about 0.95x and 1.05x
cannot be called a win or a loss from one run**, and every row in that band
needs two before it is quoted. `nts-bench` says as much itself when the same
binary varies by more than 10% across its five internal runs; what this adds is
that the *between-process* variance is of the same size and nothing was
checking it.

`in-narrowing` is the one that cost something: it was investigated at 1.07x --
profile, bytecode counts, the 187-against-110 comparison -- and it is 1.01x.
The bytecode difference is real and costs one or two percent, not seven. The
investigation's conclusion is unchanged and its motivation was inflated.

`awfy-sieve` moving 1.06x to 1.26x on the same binary is the worst offender in
the table and wants its own careful sitting before anyone reads either number.

### `awfy-sieve` is bimodal rather than noisy, and the reference is not

It swung 1.06x to 1.26x on one binary, which read as contention. It is not. Six
runs on a quiet machine, each `nts-bench`'s own best-of-five:

    run 1   ours 5.74 us   Java 4.50   1.27x
    run 2        5.74            4.48   1.28x
    run 3        5.38            4.29   1.25x
    run 4        4.49            4.32   1.04x
    run 5        4.44            4.33   1.03x
    run 6        4.48            4.32   1.04x

**The Java reference is stable to +/-2% across all six.** Ours lands in one of
two places -- about 5.5 us or about 4.47 us -- with nothing in between, and
`nts-bench` raised its own "varied 1.27x across 5 runs of the same binary" on
five of the six. That flag has been read as "the machine was busy" and on this
row it is not: it is the same binary settling into two different compilations.

**So the row's number depends on which shape the JIT picked, and the good shape
is 1.04x.** Quoting 1.25x is quoting the bad one; quoting 1.04x is quoting the
good one; the median of a single sitting is whichever the run happened to get.
Both are written here because neither alone is the row.

**Chased, and "two JIT shapes" was my phrase and is wrong.** Both candidates
are ruled out and the third reading fits better.

*Not the compilation.* Six runs under `-XX:+PrintCompilation`, which the two
modes survive -- 4264 and 4282 fast against 5329 to 5373 slow. The logs are the
same program compiled the same way: same methods, same tiers, the same `%` OSR
markers, 12 not-entrant events in each, and compilation ids differing by one.

*Not the collector.* Six runs under `-Xlog:gc`, spanning both modes, **three
young collections in every one**.

*And the mode is sticky rather than drawn per run.* Eight consecutive raw runs
came out 5259 to 5450 -- a 3.6% spread, all slow -- where earlier sittings
interleaved fast and slow. A property of the class file would not clump by when
it was measured.

**What fits: one program whose inner loop is about five times more sensitive to
machine state than the reference's.** In the `nts-bench` sitting the Java column
moved 4.50 to 4.32 us, 4%, while ours moved 5.74 to 4.48, **22%**, in the same
direction. So there is a shared environmental component and our code amplifies
it, which is a fact about the emitted loop rather than about the JIT.

That is a smaller claim than the one it replaces and a better lead: the question
is no longer "why two shapes" but "why is our sieve five times more sensitive
than a `boolean[]` loop written by hand", which is answerable by comparing the
two loops. `NtsArrayZ` puts the bytes behind a wrapper with a length field where
the reference has a bare array; that is where I would look first, and it is the
same representation `array-predicates` is at its floor because of.

### `node-utf8` moved 6.69x to 6.43x between two sittings, and the fix landed in between did not do it

The published table read 6.43x where I had 6.69x. The change in between was
`e7342345`, the code-unit retyping, and it was the obvious candidate. **It is
not the cause, and the deterministic half says so without any timing.**

Emitted from the bench tsconfig with a compiler built at `bcad0d7d` -- the
commit before it -- and at HEAD, same entry, same runtime jar:

    before   10 toInt32   2060 instructions
    after    10 toInt32   2052 instructions

**The coercion count does not move.** What moves is nine `dload` becoming nine
`iload`, three more `istore`, one fewer `dconst_0` -- values leaving double
slots for int slots, which is exactly what the change is for and is visible and
real. It is eight bytecodes out of 2060.

`counted.sh` agrees and cannot settle it: 1,433,620 instructions an operation
before against 1,423,281 after, **0.72%**.

### Neither `counted.sh` nor a single bench sitting can resolve a 4% question here

Three `counted.sh` runs on **one unchanged build**:

    ours   1,428,086   1,396,634   1,436,667     spread 2.9%
    java     228,758     232,322     238,491     spread 4.3%

The Java column is an unchanged reference and it moves 4.3%. Its own header says
instructions an operation are load-independent and need no lock -- true of
*load*, and its **calibration** is the loose part: it estimated 35, 45, 48, 78
and 97 us an operation for one program across five runs. A 2.8x spread in how
many operations it decides to measure is what puts the 2.9% into a counter that
should be exact.

**So `counted.sh` is the right instrument for `generic-classes`' 0.91x and the
wrong one for this row.** It resolves a large difference in work; it cannot
resolve four percent.

### And the row itself is stable, which was worth checking rather than assuming

The calibration spread looked like `awfy-sieve`'s bimodality, so I tested it.
Five `nts-bench` runs:

    48.68  48.67  48.81  48.68  49.15 us      ratios 6.60 6.54 6.56 6.62 6.61

**1% spread. `node-utf8` is one of the steadiest rows in the table**, and the
instability was entirely `counted.sh`'s. Two harnesses over one program, one
stable and one not, is worth knowing before either is quoted.

So the row is **~6.58x**. My 6.69x carried a contention flag and the published
6.43x is a single clean sitting; neither is in the band five runs give, and the
difference between them is not the retyping and not resolvable by anything here.

- **Replacing the Grisu port with a better formatter** on
  `number-format-double`. The profile is emphatic: `NtsGrisu.shortest` **42.4%**
  plus `timesHigh` **11.8%**, so 54% of our time is in the formatter, against
  the JDK's `DoubleToDecimal` at 38.6% of the reference's. Since JDK 19 that is
  Schubfach and ours is Grisu2, so this looked like a real algorithm gap and
  the row is 1.08x. **[1.7% of a 7.6% gap. Do not write Schubfach.]**

  Priced without writing it, by the technique the goal names: a prototype
  runtime whose `numberToString` hands the whole question to `Double.toString`
  and strips the `.0` -- which is *exactly* what `ref.java` does -- swapped
  under the same emitted classes. Five interleaved rounds, identical checksums,
  medians:

      grisu (ours)                    5774.1 ns    1.076x
      jdkfmt (the JDK's own Schubfach) 5680.4 ns    1.058x
      ref                             5366.5 ns

  **Our program calling the reference's own formatter is still 5.8% slower than
  the reference.** So the formatter is not the gap; the surrounding program is.
  A large share of a profile is not a large share of a *gap* when the reference
  does the same work -- which is `array-predicates`' lesson arriving on a row
  where the operation is named rather than attributed, and it was still true.

  The prototype is not shippable and was never meant to be: `Double.toString`
  switches to exponential at 1e7 and 1e-3 where JavaScript switches at 1e21 and
  1e-6, and this case's values reach neither. It measures the ceiling, and the
  ceiling is 1.7%.

### `awfy-queens` has a cause for most of its gap, and it was filed as incidental

This row was "no cause found" after the merge was built and refuted at 0.16%.
The cause was already written down here as an aside -- *"`Queens.queenRows` is
emitted `[D` with an `i2d` per store, where AWFY's Java uses `int[]`"* -- filed
under "one incidental finding, not hot here". **It is the majority of the row.**

One keyword changed on the reference, `int[]` to `double[]`, nothing else
touched. Five interleaved rounds, identical checksums:

    ref int[]      median  8704.7 ns    spread 0.7%
    ref double[]   median  9970.5 ns    spread 0.9%
    ours           median 11001.4 ns    spread 2.2%

**The element type alone costs the reference 14.5%.** The whole gap is 1.264x;
`[D` against `int[]` is **1.145x** of it and the remainder is 1.103x, so by
share of the logarithm the array's element type is **58% of this row**.

**It is `hir::elements`', the same owner as `array-predicates`' wrapper**, and
it is not a JVM-only cost -- the note that recorded it says both native lanes
carry it too. A `double[]` is eight bytes an element against four, an `i2d` per
store and a `d2i` per read, and on this row it is worth more than every codegen
question asked about it put together.

**What this corrects about the earlier work.** The merge-threading measurement
was right and the conclusion drawn from it -- "no cause found" -- was too strong:
what it showed was that the *bytecode shape* was not the cause, and I read that
as nothing being the cause. The thing that was already written down two lines
below it, in the same file, was.

**And then a third rung inverted the split, so the 58% above is wrong.** The
other structural difference is that this backend emits
`Queens$getRowColumn(Queens, int, int)` -- a **static taking the receiver**,
which is what `Callee::Direct` becomes here -- where AWFY writes private
instance methods. Carrying that onto the reference too, five interleaved rounds,
spreads that do not overlap:

    A  int[]    + instance methods    median  8752.2 ns    AWFY as written
    B  double[] + instance methods    median  9995.5 ns    +14.2%
    C  double[] + static receiver     median  9095.4 ns    +3.9%
    ours                              median 10970.7 ns    +25.3%

**The static shape is 9% *faster* than instance methods**, so this backend's
choice is a gain and not a cost -- `Callee::Direct` preferring `invokestatic`
is vindicated on the row where it could most have been doubted.

Which means the element type is not 58% of anything. Against a reference wearing
**both** of this lane's representational choices the gap is **1.206x**, and that
is codegen, and it is mine. The `[D` is worth 14.2% on its own and roughly
**half of it is handed back** by the static shape; the two do not add.

**The correction is the point.** One rung said the element type was most of the
row. Two rungs say it is a third of it and that the rest is ours. A ladder
stopped early reads exactly like a ladder that finished, which is the same shape
as reading "the merge is not the cause" as "there is no cause".

**The scope is exactly two arrays, and both are wrong the same way.** Across all
51 bench emissions this lane declares only five bare array fields -- everything
else is behind an `NtsArray*` wrapper because `arrays_can_grow` is
whole-program. Three are `boolean[]`, and **both** of the remaining two are
`double[]` where AWFY's own Java declares `int[]`:

    nts.gen.Queens.queenRows    double[]   AWFY: int[]     58% of a losing row
    nts.gen.Permute.v           double[]   AWFY: int[]     a row we win at 0.71x

Zero `int[]` fields are emitted anywhere. So this is not a case that happened to
be unlucky -- an integer-valued array *always* becomes a `double[]` here, and
the two places it is visible as a bare array are the two places it can be
priced. `awfy-permute` being a win makes it upside on a win rather than a second
losing row, which is worth saying so the item is not oversold.

### `awfy-queens`: six hypotheses dead, and the residual is not reproducible by transcription

Continuing the ladder past the third rung. With the reference wearing both of
this lane's representational choices it sits at 9107 ns and we sit at 10987 --
**20.6%, codegen, mine.** Every structural difference I can name has now been
carried onto the reference and priced, and none of them is it.

    the merge, threaded away in our own emitter          0.16%
    coalescing the merge parameter's slot                0.4%
    static-with-receiver against instance methods        -9%, ours is FASTER
    slot traffic, transcription verified identical       0%   (setRowColumn)
    frame width, locals 3 -> 9 on the recursive method   0%   (9080 vs 9107)
    element type `[D`                                    +14.2%, half handed back

**The slot-traffic test is the one worth keeping**, because it is the answered
list holding up under a better instrument than it was first answered with. I
transcribed our `setRowColumn` into Java and **checked the bytecode matched
instruction for instruction before measuring** -- `aload_0 getfield astore aload
iload_1 iload_3 bastore ...` on both sides, thirty-two opcodes in the same
order. It costs nothing. C2 removes the round trip, record 0004 was right, and
the stack-residency revert was right.

**And frame width is not it either.** Our recursive `placeQueen` carries
`locals=13` where AWFY's carries `locals=3`; a transcription at `locals=9`
measures identically to the one at 3. On a function recursing eight deep, four
times the frame is free.

**So the residual is something transcription cannot express.** Six attempts to
write our shape in Java produced code that runs at the reference's speed, which
means what is left is not a shape a Java programmer could write -- and the next
instrument is the assembly, which is what this file said about this row before
any of this started. `hsdis` is at `~/Projects/hsdis/build/linux-amd64/`.

Not chased tonight. The row is far better posed than it was: 1.25x, of which
14.2% is an element type upstream, roughly half of that is handed back by a
choice of ours that is a *gain*, and 20.6% is ours with six named causes ruled
out.

### `awfy-queens` in the assembly: 37% more instructions and 6% more code, which do not reconcile

The file said the next instrument for this row was the assembly. It is, and it
produced a contradiction rather than an answer -- which is worth more than
another dead hypothesis, because it rules out the whole family of them.

**Per operation, with the count fixed so there is no calibration to vary --
and the first version of this number was wrong.** At N=2000 it read +37%; run
again it read **-5%**, then **+104%**, on the same two programs. Fixing the
operation count removes the *harness's* calibration and leaves the JIT's: below
a few thousand operations, compilation is a large and variable share of the
total, and the N-versus-2N subtraction only cancels a constant. At N=50,000,
three rounds:

    ours   371,008   383,310   375,821     median 375,821   spread 3.3%
    ref    295,051   300,902   278,397     median 295,051   spread 8%

**+27%**, and that one is stable. The 37% is withdrawn; the direction survived
and the magnitude did not, which is the third time tonight a number has
survived being checked in direction only.

Time is +20.6%, so our IPC is *better* and we simply execute more. Prediction
and memory are both excluded: branch misses 3% apart, cache misses 5%.

**But the compiled code is barely bigger.**

    getRowColumn, standalone C2      89 x86 against 91   -- ours is SMALLER
    placeQueen, standalone C2       464 against 438      +6%
      of which mov                  249 against 223      +12%
      stack references              144 against 129      +12%
    inlining decisions              identical, same methods, same depths

`getRowColumn` at parity in machine code is the strongest single fact here: it
is 52% of our profile, 97 bytecodes against 40, and C2 compiles both to the same
thing. **The merge really is free, and this is the third instrument to say so.**

**And per-call work is identical too**, which narrows it further:

    getRowColumn   3 bounds-check branches, 3 loads, on BOTH sides
    placeQueen     13 jae, 6 movzbl, 32 callq, on BOTH sides

**So 6% of code cannot produce 27% of instructions.** Something executes more
often rather than being bigger, and I have not found it. What is excluded:
`setRowColumn` is 1.59x the samples at equal operation counts but exists only
inlined, so its cost is inside `placeQueen`'s 6%; the entry points are the same
program, `new Queens().innerBenchmarkLoop(n)` on both sides; and eight
structural differences have been transcribed onto the reference and each priced
at zero.

**The calls were counted, and they are identical.** A counter in
`getRowColumn` on both sides -- the same instrument doing the same extra work on
each -- reports **8,760 calls an operation on ours and 8,760 on the reference**.
Same algorithm, same search tree, same count, exactly.

So the row now has three facts that cannot all be about the same program:

    call counts        identical, 8,760 = 8,760
    per-call code      identical, 3 bounds checks and 3 loads on both
    instructions/op    +27%

**And the instruction counter is the one to doubt**, because it has already been
wrong once tonight in exactly this way -- it read +37%, then -5%, then +104%,
before N was raised. There is a second reason to doubt it here: the +27% is
measured through `FixedOurs`/`FixedRef`, drivers I wrote, while the 20.6% time
gap is measured through `Case`, the harness the row is defined by. **Those are
two different programs**, and nothing establishes that the instruction ratio
between my drivers is the instruction ratio between the benchmarked ones.

So the honest state of `awfy-queens` is: **1.25x, of which 14.2% is an upstream
element type with roughly half handed back by a choice of ours that is a gain,
and the rest is unexplained.** Nine hypotheses have been priced at zero, the
compiled code is at parity where it is hottest, and the two instruments that
disagree are a stopwatch that has been consistent all evening and a counter that
has not. Not a row to spend a third evening on without a better instrument.

### A row can be stable to 1% within a sitting and move 4% between them

`node-utf8` has now been measured four times over one evening:

    6.69x   mine, flagged busy
    6.60x   mine, five runs, spread 1.2%
    6.43x   the published table, one clean sitting
    6.32x   mine, five runs, spread 1.2%

I read the first two disagreements as instrument problems and spent a
compiler build on the third, comparing emissions at `bcad0d7d` and HEAD to see
whether a landed fix explained it. **The emitted program has not changed at
all**: 10 `toInt32`, 2 `charCodeAt`, 2053 instructions against 2052, across the
whole evening.

So four different numbers describe one unchanged program, and the two five-run
sittings were each internally tight -- 1.2% -- while sitting four percent apart.
Ours moved 48.68 to 47.64 us and the *reference* moved 7.43 to 7.53 in the same
comparison, which is why the ratio moved more than either half.

**Within-sitting tightness is not evidence of stability.** Five runs agreeing to
1% establishes that the machine was consistent for those five minutes and says
nothing about the next hour, and the noise rule already in this file -- two runs
for a row between 0.95x and 1.05x -- is too weak in the wrong dimension. The
band that matters is *between* sittings, and on a 6.3x row it is about 4%.

**What that means for reading this file.** Any two numbers here taken hours
apart differ by a few percent for reasons that have nothing to do with the
compiler, so a row that "moved" by less than about 5% between sittings has not
been shown to have moved at all. The deterministic checks -- coercion counts,
instruction counts, `bytes/op`, call counts -- are the ones that carry across
sittings, and every conclusion in this file that rests on one of those is worth
more than one that rests on a ratio.
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
