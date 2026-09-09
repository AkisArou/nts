# The JVM lane's rows, and what has already been asked of them

**This file is the state; the goal is the method.** A goal text that carries row
numbers goes stale the first time a row moves, and then it sends the next
session to redo finished work. So the numbers live here, and whoever moves a row
updates this in the same commit.

Two numbers per row: `jvm/Java` **at or under 1.00x** against the hand-written
`ref.java`, and **decisively** faster than node. 0.9x node is not a win.

## What is in here

Thirty-odd sections and rising, because every one of them is a measurement
that changed somebody's mind and the goal says to keep those where a reader
meets them. This is the map; the row table below it is the current state.

- Where the rows stand
- bytes/op, re-taken from the current tree
  - `arrays`: the only row where we allocate and the reference allocates nothing
- Asked and answered -- do not spend a second evening on these
  - The worktree these numbers were taken from was eight hours stale
  - `absences` is the `uirem` residual, and it is 34%
  - `in-narrowing`, characterised: everything matches except the slot traffic
  - The `uirem` residual, measured on all four rows rather than inferred
  - `generic-classes` has a cause at last, and our codegen is not it
  - The noise band, measured -- and six rows that were not losing
  - `awfy-sieve` is bimodal rather than noisy, and the reference is not
  - `node-utf8` moved 6.69x to 6.43x between two sittings, and the fix landed in between did not do it
  - Neither `counted.sh` nor a single bench sitting can resolve a 4% question here
  - And the row itself is stable, which was worth checking rather than assuming
  - `awfy-queens`: a cause filed as incidental -- WITHDRAWN two sections below, it is not most of the gap
  - `awfy-queens`: six hypotheses dead, and the residual is not reproducible by transcription
  - `awfy-queens` in the assembly: 37% more instructions and 6% more code, which do not reconcile
  - A row can be stable to 1% within a sitting and move 4% between them
  - `node-utf8` cannot reach the bar, and its own reference says why
  - Rule 4 applied to every losing row, which partitions the table
  - `array-from`'s bytes/op gap is a representation floor, and the arithmetic closes to three decimals
  - `symbol-keyed-map`, re-profiled: the 52% is 50.5% and the mechanism is the accumulator
  - `array-methods`: our helpers beat hand-written Java, and the coercion is worth 8.9% (I first said 24.8%)
  - `array-methods` read in the bytecode: three of my four claims about it were wrong
  - `symbol-keyed-map` reads the same way, so the hand-over was wrong on both rows
  - `fib`: the reference's `int` is justified by a claim about us that is false, and the rule would make the row worse
  - Every reference checked for width at once, and 48 of 51 agree
  - `instanceof`, priced the same way: the width is invisible here, and the row is still `uirem`
  - `module-closures`: the `(D)D` closure ABI is real in the bytecode and free at runtime
  - `module-closures` is 1.058x for no reason I can find, and three mechanisms are dead
  - `array-from`'s set walk, checked on the runtime side rather than inferred
  - There are 60 cases, not 51, and nine of them cannot be held to the bar
- Open, and whose

**Read this file newest-claim-first within a row.** It is written by appending,
so a row investigated three times has three sections and the *last* one is the
one that stands -- twice tonight an earlier section's heading asserted something
its own body later withdrew, and a reader meeting the first would have taken a
retracted number as current. Headings now say when they have been withdrawn.
The row table below is always current; the sections behind it are a history.

## Where the rows stand

**Re-taken 2026-09-09 at `bf066859`, from a worktree pinned to that hash, all
51 cases *that carry a `ref.java`*.** Rows in the 0.95x-1.05x band and rows the
harness flagged were run **twice** and carry both readings; where the two
disagree that is the finding, not an average. `*not clean*` is `nts-bench`'s own
flag -- either the same binary varied by more than 10% across its five internal
runs, or another session's compiler was running -- and those rows may not be
quoted. There are 60 cases; the nine `json-*` ones have
no Java reference and so have never appeared here at all -- see below.
The previous table was read from `~/.cache/nts-jvm-sweep`, which is pinned at
`f071672b` from 08:41 and so predates this morning's `uirem` fix -- see the
stale-worktree section below. `->` marks a row this lane has moved. A row marked
*busy* or *jit* is one `nts-bench` itself flagged: another compiler was running,
or the same binary varied by more than 10% across five runs. **Those four are
not measured clean and should not be quoted.**

**Two runs changed which rows are which, and one of them by 50%.** `dispatch`
read **0.64x** and then **0.97x**; both runs carried the JIT-variance flag. A
single sweep would have published a third of a row's ratio as a win. That is
rule 4 -- distrust favourable numbers hardest -- earning its place on the
largest apparent improvement in the table.

**What moved, and it is the other lane's work rather than this one's:**

    substrings    0.95x -> 0.40x    clean, both runs
    map-and-set   0.86x -> 0.79x    clean
    objects       0.99x -> bimodal  1.00x and 0.91x, both lanes varying

**What looked like it moved against us, and did not.** I published
`symbol-keys` 0.98x -> 1.04x, `upcast` 0.99x -> 1.03x/1.05x and `generator`
0.99x -> 1.01x as real regressions on the strength of each reading twice.
**Both of those runs were in the same sitting.** Two runs an hour apart do not
establish a change from a number taken on a different day, and rule 4 says so
in the words "compare MINIMA across runs rather than an effect within one".

Two checks, either of which is enough:

    emitted bytecode, e7342345 against HEAD -- 106 commits apart
        symbol-keys   IDENTICAL
        upcast        IDENTICAL
        generator     IDENTICAL

and this file, 200 lines further down, already carrying the number:

    Run-to-run movement on the same binary was 0.20x on `awfy-sieve`,
    0.07x on `symbol-keys`, 0.05x on `growth-grown`, 0.04x on `generator`.

**`symbol-keys` moves 0.07x between sittings and I called a 0.06x change a
regression. `generator` moves 0.04x and I called 0.02x one.** Byte-identical
code cannot regress; what changed is which sitting the number came from.

**Ten rows sit at 1.01x-1.05x on both runs.** That band is not noise around
parity -- it reproduces. They are losing by a little, consistently, which is a
different problem from the four rows losing by a lot.

| row | jvm/Java | note |
| --- | --- | --- |
| `node-utf8` | 6.53x | **a codec against an intrinsic**: floor is 2.40x, below |
| `symbol-keyed-map` | 2.87x | blocked: **50.5%** is `toInt32` on an `f64` accumulator |
| `array-from` | 2.12x | **priced: 5.9x on the set walk** -- the lowering's, below |
| `array-predicates` | 1.73x | at its floor: every helper inlines; the wrapper is the row |
| `absences` | 1.28x | blocked: **34%** is `uirem` over an `l2i` counter |
| `optional-chain` | 1.27x | the same `uirem` residual |
| `awfy-queens` | 1.23x | 20.6% is codegen and MINE -- ladder below |
| `generic-classes` | 1.13x | **cause found**: monomorphisation, not codegen -- below |
| `array-methods` | 1.17x | helpers beat the reference by 18%; `toInt32` against the reference's `d2i` is **8.9%**, measured; the `NtsValue` from `at()` is scalar-replaced (144 B/op is the array literal, which the reference also pays) |
| `number-format-double` | **1.15x** | six runs inside 1.7% -- the *reference* was what varied. Worse than the 1.08x listed, and now the best-supported number here. The formatter is 54% of the profile and 1.7% of the gap |
| `elementwise` | 1.05x / 1.02x | at its floor: both lanes vectorise |
| `instanceof` | 1.09x | 60% of the profile is `uirem`; bounded at 8%. Reference is narrower than the program, priced at ~0 -- below |
| `in-narrowing` | 1.01x / 1.02x | re-measured; was listed at 1.07x from a contaminated run |
| `module-closures` | 1.10x | measured clean at last, identical checksums. Three mechanisms priced dead (ABI 0.1%, non-final global 0.1%, inline size 0%); **no cause found** -- below |
| `awfy-sieve` | **0.94x** | six runs, five of them under 1.00x. The bimodality section below predates this and its two modes did not appear |
| `bytes` | 1.05x | the `uirem` residual |
| `objects` | **0.99x** | six runs at two warmup lengths, all 0.99x. The variance note is spread *within* a run; the minimum does not move. **Not losing** |
| `generator` | 1.01x | 1.01x twice against 0.99x from another sitting; this row moves 0.04x between them and the bytecode is identical |
| `symbol-keys` | 1.04x | reads 1.04x twice against a 0.98x from another sitting -- and this row's own between-sitting movement is **0.07x**. Bytecode identical across the window; not a regression |
| `arrays` | 1.03x / 1.02x | both runs above; small and real |
| `fib` | 1.04x / 1.03x | the reference is `int` against a `number`; correcting it per the rule would move this **against** us by 3-4%, measured -- below |
| `upcast` | 1.03x / 1.05x | bytecode identical to the tree that measured 0.99x; a between-sitting difference, not a change |
| `checksum` | 1.00x | parity, twice |
| `closure-merge` | **1.01x** | six runs, all 1.01x. Losing by one percent, reproducibly |
| `growth-grown` | **1.01x** | six runs, all 1.01x |
| `substrings` | **0.40x** | was 0.95x. **The largest real movement in the table** and unflagged |
| `map-and-set` | **0.79x** | was 0.86x |
| `dispatch` | 0.67x-1.14x *not clean* | six runs land in two places. Neither P-core pinning nor 13x the warmup touches it. **Not a number** |
| `case-convert` | **0.955x** | six runs, 0.92x-1.01x. **Not losing** |
| `awfy-permute` | **0.72x** | |
| `awfy-mandelbrot` | **0.84x** | |
| `awfy-list` | **0.94x** | |
| `awfy-towers` | **0.98x** | |
| `awfy-bounce` | **0.99x** | six runs, 0.97x-1.03x. Parity |
| `awfy-nbody` | **1.00x** | and 7.69 ms against node's 78.25 |

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

**This list is not the whole list, and finding that out cost me two
measurements tonight.** The other two places are:

- **`docs/records/0132`**, *Five hypotheses died and the reference stayed
  still*, on `dispatch`'s modes. Warmup, compilation, SMT placement, address
  randomisation and allocation are all refuted there, and record 0130 refuted
  warmup before it. **I re-tested warmup and core placement anyway**, because I
  read this file first as the goal says and neither was in it.
- **The comment on `SPREAD_WORTH_SAYING` in `tooling/bench/src/main.rs`**, which
  carries the twelve-row spread survey that set the 1.10 threshold, and the fact
  that the modes are chosen once per JVM and held for its life.

A lead that dies belongs wherever the next person will meet it, and for a
benchmark that is sometimes the harness rather than this file. So: **check all
three before pricing anything about variance.** What is written below is what
this lane's rows cost, not everything that has been ruled out about them.

Each cost a measurement. The number in brackets is what the fix was worth.

**Read this class of lead first, because it is now four for four.** "The
emission carries visible redundancy, therefore removing it wins" has been
believed and priced four separate times on this lane, and has come back at
zero every time:

    intcall's i2l/l2i on every helper result        0.04%   built, then measured
    the (D)D closure ABI's i2d/d2i per call          0.1%   priced first
    the store/load round trip on every value           0%   record 0004
    the arrayAtValue allocation per round              0    C2 scalar-replaces it
    1.7x the bytecode blocking a hot inline          0.1%   FreqInlineSize=800

C2 folds identity conversions, sinks stores, and scalar-replaces non-escaping
objects, and it does all three through our emission specifically. **The bytecode
being ugly is not evidence that it is slow**, and on this backend the JIT is the
reason. A redundancy is worth pricing only where something stops C2 seeing it --
a real call it will not inline, an object that genuinely escapes, a value that
crosses a method boundary in the wrong representation *and is not inlined back*.
None of the four were.

The corollary, which is the useful half: **the wins on this lane have all been
representation, never instruction count.** `intcall` itself was worth 22.8% by
changing what a value *is*; `widen` was worth `generator`'s whole 3.41x the same
way. Ask what a value is held as, not how many instructions move it.

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

**And the one argument that survived those two refutations is now dead too.**
Both of them priced the slot traffic's *direct* cost, which C2 removes. Neither
asked what 1.7x the bytecode does to **inlining**, and the numbers make that
look decisive: `work$whole` is **365 bytes against a `FreqInlineSize` of 325**,
so it sits just over the ceiling where the reference's ~110 sits far under, and
`-XX:+PrintInlining` says `hot method too big` about it.

Priced with the ceiling raised past our size, interleaved:

    minimum   default 1313    -XX:FreqInlineSize=800  1314    +0.1%

**Nothing.** Because `work$whole` *is* the hot method rather than a callee
inside one -- inlining it into `work` would move the code, not remove it. The
message names a call site, and a method that C2 compiles on its own account
loses nothing by not being pasted into its caller. That is the same shape as
`module-closures`, where the identical message meant nothing for the identical
reason, and it is the second time tonight `PrintInlining` has offered a precise
mechanistic story that priced at zero.

So the honest position is: **this row is 1.01x/1.02x on two runs -- it was
listed at 1.07x from a contaminated sweep -- the cause is not found, and all
three visible leads are now refuted.** The transcription route is closed as well -- writing a Java version
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

That is a smaller claim than the one it replaces. The lead I wrote down with it
-- that `NtsArrayZ` puts the bytes behind a wrapper where the reference has a
bare array -- **is wrong, and this row does not use the wrapper at all**:

    ours   Sieve$sieve(nts.gen.Sieve, boolean[], int)
    ref    sieve(final boolean[] flags, final int size)

No `NtsArray*` call appears anywhere in the emission. Bare `boolean[]`, an `int`
size, the same signature the reference declares. **The representation is already
at parity**, which is exactly what `array-predicates` is *not* and is why the
wrapper explanation borrowed from it does not transfer.

So `awfy-sieve` has: identical representation, identical compilation, identical
collector behaviour, a sticky mode, and **1.03x in its good mode** -- which is
at the bar. The row's problem is the mode rather than the code, and nothing
found so far says the mode is ours.

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

### `awfy-queens`: a cause filed as incidental -- WITHDRAWN two sections below, it is not most of the gap

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
### `node-utf8` cannot reach the bar, and its own reference says why

I put `toInt32` at the top of the other lane's list on the strength of this row
being 6.3x with 62% of its profile in coercions, and told them that share was
"overhead in full" because the reference does no conversion at all. **That is
true and it is not the row.** Reading `ref.java` -- which I should have done
before setting anyone's priorities -- its header states the position exactly:

    ours       runtime/node/internal/utf8.ts compiled: a 176-line state
               machine, one code point at a time, with U+FFFD placement
    reference  String.getBytes(UTF_8) and new String(bytes, UTF_8), which are
               HotSpot *intrinsics* -- hand-vectorized, ASCII fast path, a
               machine word at a time

The reference also allocates a fresh array and copies it every round, which we
do not, and still wins by 6.3x.

**So the ceiling is arithmetic.** Ours is 47.64 us against 7.53:

    every `toInt32` removed        18.10 us    ->  2.40x
    our decoder made entirely free  0.00 us    ->  0.00x

**Removing every coercion leaves the row at 2.40x**, because what remains is a
scalar state machine against a vectorised intrinsic. No codegen work and no
middle-end work reaches 1.00x here; only calling the platform's codec would,
and that is a `runtime/node` replacement rather than a compiler question.

**The `toInt32` work is still worth doing and this does not withdraw it** -- it
withdraws the row I used to justify it. `symbol-keyed-map` at 2.92x compares
against `IdentityHashMap` and `array-methods` at 1.14x against **hand-written
loops** that its reference is explicit about being loops. Those are ordinary
code, they carry 52% and 25% of the same coercion, and they *can* approach the
bar. The case for the fix rests on them.

**And the lesson is rule 4 arriving late.** "Check the reference does the same
work before calling a ratio a gap" is in my goal text, I have applied it to
`array-predicates`, `generic-classes` and `number-format-double`, and I did not
apply it to the largest number in the table -- because 6.3x was too big to look
like a reference artefact. The size of a gap is not evidence about its cause.

- **Pre-sizing the string builder.** Java's default `StringBuilder()` holds 16
  characters and an accumulator that ends up long regrows several times;
  `node-utf8` builds a decoded string 64 times an operation and is the worst
  `bytes/op` row in the table at **1.50x**. **[19% of one row's allocation, and
  refused anyway.]**

  Measured, deterministically, by emitting each case at several capacities and
  reading `NTS_BENCH_ALLOC`:

      row                default    cap=128     cap=512
      node-utf8           98,472     79,528     153,256
      case-convert        10,232     10,232
      number-format        4,608      4,608
      json-serialize     112,216    112,216
      substrings               0          0

  **128 is worth 19% on `node-utf8` -- 1.50x to 1.21x on that axis -- and moves
  nothing else to the byte.** It is still refused, and the two numbers that
  refuse it are in the table: that case decodes to about 110 characters, and 512
  makes the same row **worse than the default**. A constant that helps exactly
  one row, chosen by knowing that row's string length, is fitted to the
  benchmark rather than derived from the program.

  **What would justify one is a bound rather than a guess.** A non-empty seed
  already supplies it -- the builder is constructed from the string and Java
  sizes to `length + 16`. An accumulator with no seed has no hint at the
  emitter, and the place a hint could come from is the middle end knowing what
  the accumulator is built out of. If that ever exists this is worth 19% of
  `node-utf8`'s allocation, and the reasoning is in `ops.rs` beside the `<init>`
  so the next person to notice the default finds the measurement rather than
  repeating it.

### Rule 4 applied to every losing row, which partitions the table

Reading `ref.java`'s header on `node-utf8` cost that row its place at the top of
another lane's queue and cost me an evening's premise. So I read all of them.
**Two rows compare against something the platform implements and the rest do
not**, and that distinction decides which rows the bar can even be asked of.

**Cannot reach 1.00x, because the reference is not code a person wrote:**

    node-utf8             6.33x   String.getBytes / new String(UTF_8) are
                                  HotSpot intrinsics: hand-vectorized, ASCII
                                  fast path, a machine word at a time. Our
                                  176-line state machine against that has a
                                  measured floor of 2.40x with every coercion
                                  removed.
    number-format-double  1.15x   `Double.toString` is `jdk.internal.math`'s
                                  Schubfach. Ours calling *that* formatter is
                                  still 5.8% slower than the reference, so the
                                  formatter is only part of it -- but the digit
                                  generation half is not winnable by codegen.

**Ordinary hand-written Java, so the bar is a fair question:** `optional-chain`
is a null check; `absences` three shapes of absence; `instanceof` is the same
word in both languages; `module-closures` is `static` methods and a `static`
field; `elementwise` is a `double[]` and two loops; `bytes` is `byte[]` with
`& 0xff` per read; `in-narrowing` is one class per arm and `instanceof`;
`array-methods` and `array-predicates` are loops written by hand because Java
gives a `double[]` no such methods; `awfy-queens` is AWFY's own Java;
`generic-classes` is an erased `Box<T>`; `symbol-keyed-map` is
`IdentityHashMap`; `array-from` is `Arrays.copyOf` and `HashSet.toArray`.

**Every one of those is a real target and two of them are not.** That is worth
stating where the bar is stated, because "every losing row at or under 1.00x"
is not a reachable goal for a row whose reference is vectorised assembly the JDK
ships -- and treating it as one is how `toInt32` ended up at the top of a queue
on the strength of a ratio that could not move.

- **Dropping the integrality test from a subscript's bounds check.** `bytes` is
  1.09x and `NtsRuntime.bounds` is **9.95%** of its profile, where the reference
  -- a `byte[]` with `& 0xff` per read -- has no such frame at all. All four
  sites take the *double* overload, which pays `(int) index` and then
  `i == index`, converting back to compare, before two range checks. Seventeen
  sites across the corpus take it and ten take the `int` one. **[-4.3%. The
  guard pays for itself.]**

  Priced by swapping the jar under the same emitted classes, with the check
  removed -- unsound, since `i == index` is what makes `xs[1.5]` answer
  undefined instead of element 1, but that is what makes it a *price* rather
  than a candidate. Five interleaved rounds, identical checksums:

      stock (with the test)      749,653 ns
      without it                 781,617 ns    +4.3% SLOWER
      ref                        659,671 ns

  **Removing work made it slower**, and the reason is that the test is
  load-bearing for the optimiser rather than for the program:
  `i == index && i >= 0 && i < length` lets C2 prove the index is exactly that
  `int` and in range, so it eliminates the *array's own* bounds check on the
  access that follows. Without it C2 cannot relate the two and both survive.

  So the 9.95% is not overhead to remove, and a `whole` fact from the middle end
  would not buy it either -- the fact would let us *skip* the test, which is the
  thing that measured worse. **This is the second guard tonight that looked like
  dead work and was holding something up**, after `NtsArrayD.keepFirst`'s fill,
  which turned out to be hole semantics rather than collector hygiene.

### `array-from`'s bytes/op gap is a representation floor, and the arithmetic closes to three decimals

The row loses **1.33x** on allocation and it is not waste. An allocation profile
says ours is **99.69% `double[]`** where the reference is 66.78% `double[]` and
**32.90% `Object[]`**, which is the whole story: `Array.from(set)` must produce
a `number[]`, and a `number[]` is a `double[]`.

    per round   ours  double[256] from slice   +  double[256] from the set walk
                ref   double[256] from copyOf  +  Object[256] from toArray

    ours  (256*8+16) + (256*8+16)  =  4128 bytes
    ref   (256*8+16) + (256*4+16)  =  3104 bytes      ratio 1.330

    measured bytes/op   8,280,864 against 6,232,944   ratio 1.329

**A double is eight bytes and a compressed oop is four.** `toArray` copies 256
pointers to `Double` objects that already exist; we materialise 256 doubles. The
reference's answer is cheaper because it is a weaker answer -- an `Object[]`
whose elements still have to be unboxed to be used, which is the same asymmetry
the timing half of this row turns on.

So this half of `array-from` is **at its floor and should not be chased**. The
timing half is still open and still worth 5.9x, and it is the lowering's; the
allocation half is closed by arithmetic that matches the measurement to three
decimal places, which is a better kind of certainty than a ratio.

### `symbol-keyed-map`, re-profiled: the 52% is 50.5% and the mechanism is the accumulator

The 52% in this file predates the stale-worktree correction, so it was worth
re-taking on a current emission. It holds, and the shape is now pinned:

    ours   toInt32 50.54%   findLinear 19.38%   sameKey 4.76%   get 4.04%   set 2.26%
    ref    Ref.work 81.45%  IdentityHashMap.hash 5.91%   .get 4.84%

The case is `total = (total + (events.get(key) ?? 0)) | 0`, twice an iteration,
4096 iterations -- and the emission holds `total` in an **`f64`**, with `dload`,
`dadd`, `dstore` around each `toInt32`. That is the identical shape
`array-methods` carries, and it is `narrow.rs`'s: an integer accumulator behind
`| 0` living in a double slot. The reference writes `int total` and converts
nothing.

**The map machinery is not the row and is already answered.** Ours totals 30.4%
against the reference's 10.75%, which looks like a gap until the parts are
named: `findLinear`'s 19.38% was measured at **2% removable** -- always hashing
moved 3.35x to 3.29x -- and `sameKey` already fast-paths identity with `a == b`,
which is the only comparison a symbol key ever needs. Nothing there is open.

**The bound, so it is not oversold.** Removing every coercion takes 2.93x to
about **1.45x**, which is a large move on the second-biggest losing row and not
the bar. Unlike `node-utf8` this row *can* reach the bar -- its reference is an
ordinary `IdentityHashMap` -- so the coercion work has somewhere to go here that
it does not have there.

### `array-methods`: our helpers beat hand-written Java, and the coercion is worth 8.9% (I first said 24.8%)

Re-profiled on a current emission, because its 25% predated the stale-worktree
correction. It holds at **24.82%**, and the rest of the profile says something
better than that number does:

    ours   arrayIndexOfI 28.62%  toInt32 24.82%  arrayReverse 18.84%
           arrayLastIndexOfI 10.33%  arrayIndexOf 0.72%
    ref    indexOf 34.48%  lastIndexOf 23.59%  reverse 23.59%

The reference's own header is explicit that Java gives a `double[]` none of
these methods, so a person writes four loops and it writes them. **Ours are
faster than those loops**, and the shares can be turned into units because the
row's ratio is known:

    our helpers      58.51% of a 1.14x row  =  0.667
    their loops      81.66% of a 1.00x row  =  0.817

**18% faster than hand-written Java at the operation this row is named for.**
The row loses anyway, and it loses entirely on the coercion the reference does
not perform.

**And then I predicted "0.86x without the coercion" from that 24.82% share, and
measuring it says 8.9%.** Priced by swapping a jar whose `toInt32` is a bare
`(int) x` -- unsound, since that saturates where JavaScript wraps, and valid
here because the case's values are in range. Five interleaved rounds:

    stock       1688 ns    1.183x
    no-coerce   1537 ns    1.077x
    ref         1427 ns

**The share overstated the removable cost by about three times**, because most
of `toInt32` is the `d2i` that any narrowing must do and only the JS-semantics
guard around it -- `long wide = (long) x; if (wide == x && wide != MAX_VALUE)`
-- is what disappears. A real narrowing fix removes the call and the `d2i` as
well, so the true ceiling is better than 1.077x and I cannot measure it from
here; what I *can* say is that 0.86x was not measured and is withdrawn.

That is the third time tonight a profile share has been read as a removable
cost, after `array-predicates`' 37.6% and `number-format-double`'s 54%. **A
share is what a program spends there, not what it would save by not going.** I
have written that sentence twice already this evening and then predicted 0.86x
from a share anyway.

The row still has no in-lane residual -- the helpers win -- and it is still the
best case for the fix, on a smaller and honest number.

### `array-methods` read in the bytecode: three of my four claims about it were wrong

I had characterised this row from profiles and a jar swap and never once read
what the backend emits. Reading it refutes most of what I filed, including a
hand-over I gave MainClaude.

**1. The accumulator is already an `int`.** I wrote that this row carries "the
identical shape" as `symbol-keyed-map` -- "an integer accumulator behind `| 0`
living in a double slot" -- and handed it to `narrow.rs`. The emission says
`istore_2` / `iload_2`:

    194: iconst_0
    195: istore_2          <- total, an int slot, for the whole loop
    233: iload_2
    234: iload  10
    236: iadd              <- int addition
    366: istore_2

`specialize` already put it there. The one `i2d` per round is not the
accumulator being a double, it is the *other operand*: `xs.at(-1)` yields an
`f64` because the array's element type is `f64`. That is still upstream, but it
is a different question from the one I asked, and `symbol-keyed-map` must now be
re-read rather than assumed to share it.

**2. The `NtsValue` from `at()` never reaches the heap.** The emission looked
alarming -- an allocation per round, unwrapped on the next instruction:

    314: invokestatic  NtsRuntime.arrayAtValue:([DD)Lnts/rt/NtsValue;
    319: aload  26
    321: getfield      NtsValue.num:D

I was about to add an `arrayAtNumber([DD)D` and fuse the pair. **Measured
first, and there is nothing there.** 256 rounds an op, so a surviving 32-byte
object is ~8 KB/op:

    empty         0 bytes/op     (the harness)
    array only    0 bytes/op     (degenerate -- C2 removed the control too)
    work        144 bytes/op

144 is exactly `new double[16]`: 16 bytes of header and 128 of payload, the
case's array literal, **which `ref.java` allocates identically**. Every one of
the 256 `NtsValue`s is scalar-replaced. So the plan's headline question -- does
C2 scalar-replace what this backend emits -- is answered **yes** on a real row,
and the helper I was about to write would have bought zero bytes.

The `array only` control is worth keeping as a warning rather than as evidence:
it reported 0 because C2 eliminated *it*, so it establishes that a non-escaping
array can vanish, not what an escaping one costs. The number that carried the
argument was the 8 KB that did not appear.

**3. The reference coerces too, so "the coercion the reference does not
perform" is wrong.** It writes:

    total = total + (int) xs[xs.length - 1];

A `d2i`. Ours is a `toInt32` call. The gap is not a coercion against no
coercion, it is **one instruction against a call with a guard** -- which is
exactly the 8.9% the jar swap measured, and makes that number stop being a
surprise. Worth noting the two are not the same function: the reference narrows
the element *before* the addition and JavaScript narrows the sum *after*, so on
data where the sum leaves int range they would disagree. They agree here.

**4. `intcall` leaves an identity pair behind, and it is mine.** The pass holds
the call result in an `int`, and the two `convert`s the HIR chain already had
are then emitted against it:

    218: invokestatic  NtsRuntime.arrayIndexOfI:([DD)I    <- already an int
    223: iload  7
    225: i2l
    226: lstore 8
    228: lload  8
    230: l2i                                              <- identity, always
    231: istore 10

`i2l` sign-extends and `l2i` takes the low 32 bits back: for any `int` the pair
is the identity, with no range precondition. Twice a round here. The pass's own
rule -- a value is held as an `int` only if every use converts it to an integral
type -- already has the machinery; it simply does not walk through the
intermediate `convert : i64` to the `convert : i32` behind it.

**Predicted worth on this row: about zero.** C2 has this exact identity on
`ConvI2L`/`ConvL2I` and folds it, which is the same reason record 0004 found the
store/load round trip free. It is worth doing for ART, which has no C2, and for
the code size -- not for this table, and it is not being claimed for this table.

**Built anyway, because it is four lines and the pass is mine.** `intcall` now
walks through the intermediate `convert : i64` and holds it as an `int` too, and
`conversion` honours the mark on the way out as well as on the way in -- without
the second half it would emit the `i2l` the first half exists to remove and then
store a long into a slot the frame calls an int. The emission goes

    290: iload  16      before:  290: iload  16
    292: istore 17               292: i2l
    294: iload  17               293: lstore 17
    296: istore 18               295: lload  17
    298: iload  11               297: l2i
    300: iload  18               298: istore 19
    302: iadd                    ...

Correctness: 133 of the examples agree through the JVM backend, which is the
floor exactly; `-Xverify:all` accepts it; and `work` answers identically across
seeds -8..8, chosen because -1 is the no-match answer and the value a changed
conversion would spell differently.

**Measured, and the prediction was right: zero.** Under the gate lock, one JVM
per arm, interleaved so a drifting machine drifts through both, best-of-seven
inside each run and identical checksums throughout:

    round      before     after
      1        1643.5    1605.3
      2        1580.3    1628.1
      3        1644.4    1672.3
      4        1579.3    1644.8
      5        1626.7    1578.7
    minimum    1579.3    1578.7      -0.04%

**0.04% on the minima, which is nothing.** C2 folds `ConvI2L`/`ConvL2I` itself,
which is what was predicted in writing before the change was built, and this is
the first prediction tonight that survived its measurement.

What this run can and cannot say, because the spread inside each arm is about
6%: it resolves "is this worth 3% or more" as **no**, and it cannot resolve 1%
either way. That is enough for the decision it was taken for, and not enough to
call the change a small win rather than no win.

**So the row has not moved and is not recorded as moving.** The change stays --
it is correct, it removes two instructions an operation from every emission
using these helpers, and ART has no C2 to fold them -- but it is a code-quality
change and this table is not where it should be argued for. Its value would show
on a DEX lane, which does not exist yet to measure it on.

Not tried, and the honest reason: giving the reference a redundant `(long)`
round trip would have been the cheaper way to learn this, and it was already
built by the time I thought of it.

**What this row still is.** Helpers 18% faster than hand-written loops, a
`toInt32` call where the reference has a `d2i` worth 8.9%, and a residual double
round trip that is the array's element type and upstream. Nothing in it is
in-lane any more, and three of the four things I thought were have now been
measured away.

### `symbol-keyed-map` reads the same way, so the hand-over was wrong on both rows

Same technique, same result. I had written that this row "holds `total` in an
**`f64`**, with `dload`, `dadd`, `dstore` around each `toInt32`", and that
`array-methods` carried "the identical shape". The second half is true. The
first half is not, on either.

    454: iload  27        <- total, an int slot
    456: i2d              <- widened here, for the addition
    459: dload  52
    461: dload  50        <- NtsValue.num, an f64
    463: dadd
    466: dload  54
    468: invokestatic  NtsRuntime.toInt32:(D)I
    471: istore 56        <- and straight back to an int

**The accumulator was never the problem; it is already where I was going to ask
for it to be put.** What forces the widening is the other operand:
`events.get(key) ?? 0` comes out of an `NtsValue.num`, which is an `f64` because
the map's value type is `number`. The addition is genuinely f64 + f64 in the
type system, and the `| 0` genuinely narrows the sum.

So the request to `narrow.rs` is a different one than I made, and harder:

- **What I asked for:** hold an integer accumulator in an int slot instead of a
  double one. Already done, by `specialize`, on both rows.
- **What is actually needed:** prove that an `f64` arriving from a `number`-typed
  map value or array element is integral, so the addition can be an `iadd` and
  the `| 0` can vanish. That is range analysis over values the middle end only
  knows as `number`.

**And no allocation survives here either.** 4096 iterations with an
`NtsValue.ofObject` inside the loop -- if each one reached the heap it would be
about 260 KB/op:

    empty         0 bytes/op
    work        240 bytes/op

240 is the map, its four entries and their symbols, built once per call. The
in-loop `ofObject` is a lookup key that does not escape, and C2 scalar-replaces
it, exactly as it does the `at()` value on `array-methods`. **Two rows, two
shapes of erased value, both eliminated.** That is the plan's headline question
answered twice and it should stop being asked speculatively.

### `fib`: the reference's `int` is justified by a claim about us that is false, and the rule would make the row worse

`fib` is listed at 1.02x and its `ref.java` is `static int fib(int n)`, against a
TypeScript `number`. The suite's rule -- **no field narrower than the f64 a
TypeScript `number` is** -- forbids that, and the header argues an exemption:

> Nobody writes `double fib(double n)`. It is also not a gift to this lane:
> `fib(27)` stays far inside `int`, **this compiler's specialization proves the
> same thing**, and both sides then measure what this case is for.

**The bolded clause is false, and the emission says so.** Specialization narrows
the *parameter* and not the *return*:

    public static double fib$whole(int);
      11: iload_0            <- int argument, int compare, int subtract
      12: iconst_2
      13: if_icmpge  21
      28: invokestatic  fib$whole:(I)D     <- and a double back
      45: dload  5
      47: dload  8
      49: dadd                             <- where the reference has iadd
      54: dreturn

`(I)D`, not `(I)I`. And it is *right* to be: `fib(n-1) + fib(n-2)` is a genuine
f64 sum in JavaScript and narrowing it would change the answer above 2^31.
`work$whole` on `array-methods` **does** return `I`, because that program ends in
`| 0` and the middle end can prove it. `fib` has no such proof available. So the
two sides are not measuring "call overhead and the branch"; one adds doubles and
one adds ints.

**Then the obvious correction was measured, and it went the other way.** Rule 3,
one variable, `int` to `double` in the reference and nothing else:

    run 1     RefI 483470     RefD 462251     RefD faster by 4.4%
    run 2     RefI 466482     RefD 452537     RefD faster by 3.0%

**The `double` reference is faster than the `int` one**, both times, minima
compared across runs. Plausibly register pressure -- doubles live in XMM
registers and leave the general-purpose ones to the recursion's frame work --
but the mechanism is not measured and is not being claimed. What is measured is
the direction.

So the header's *conclusion* survives and its *reason* does not. `int` is not a
gift to the reference; if anything it handicaps it, and obeying the rule here
would move the row **against us**, from 1.02x to about 1.06x.

**Which is why it should probably still be obeyed.** Applying "no field narrower
than an f64" on `array-methods`, where it moved the row 1.67x to 1.18x in our
favour, and declining it here because it moves the other way, is the exact bias
the rule exists to remove. Not changed tonight, because changing a reference
changes a published row and this was measured on a hand-rolled harness rather
than `Bench.java` -- which is also why the 1.08x it reported for ours is not
being used to restate the row. **Flagged as a decision with its measurement
attached, not taken.**

The instrument caveat, per rule 6: 20 calls a timing round on a ~500 us
workload, best of seven, one JVM per arm. Good enough for a consistent 3-4%
direction seen twice; not good enough to publish a ratio from, and one RefD
round came back at 771197 against a 452537 minimum, so the spread is wide.

### Every reference checked for width at once, and 48 of 51 agree

`fib`'s reference was narrower than the program it stands for, which raised the
obvious question about the other fifty. `tooling/bench/ref-widths.sh` answers it
mechanically rather than by eye, and the answer is short.

The check is not "does the Java say `int`" -- `int` is usually right, for a loop
counter or an index. It is **does the reference return a narrower type than the
middle end could prove**. `specialize` gives the whole-number path a signature:
`(I)I` means the program's result really is an int32 and a reference returning
`int` computes the same thing; `(I)D` means it is not, and a reference returning
`int` is a different program.

    exceptions     ours=double  ref=int
    fib            ours=double  ref=int
    instanceof     ours=double  ref=int

Three. **Forty-eight agree**, and that is the useful half: this axis is not a
systematic problem with the suite and does not need doubting case by case again.

Of the three, `exceptions` is at 0.01x and nothing about a reference's width
will trouble it. `fib` is priced above and correcting it moves the row against
us. **`instanceof` at 1.08x is the one that is both losing and unpriced**, and
it should get the same one-variable treatment before anything else is said
about it.

The script reports and does not fail, deliberately: `fib` showed that a
narrower reference can be *slower*, so a mismatch is a question with a
measurement attached and not a defect to ratchet on.

### `instanceof`, priced the same way: the width is invisible here, and the row is still `uirem`

The third width mismatch, and the only one both losing and unpriced. One
variable, exactly the one the emission names: `run$whole` is `(I)D` with `total`
in `dstore_1`, the reference has `int total`, and the loop counter is an `int` on
both sides -- so `int total` became `double total` and nothing else moved.

    run 1     RunI 44115     RunD 42586     -3.5%
    run 2     RunI 44736     RunD 44047     -1.5%

**Two runs that do not agree with each other, over distributions that overlap
almost entirely** -- RunI spans 44115-44775 and RunD 42586-44755, and RunD's
42586 is one sample in ten. Against `fib`, where the wide reference won by 4.4%
and 3.0% with no overlap at all, this is the null result that shape looks like
when it is real.

**Which makes sense, and is the point.** `instanceof`'s round allocates a shape,
takes `i % 3` twice and runs two type tests; `total + 1` is a rounding error
next to that. `fib`'s round is a compare, two subtractions, two calls and *one
addition* -- the accumulator is most of the arithmetic there and almost none of
it here. The same correction is worth 3-4% on one row and nothing on the other,
which is an argument for pricing each rather than applying the rule by analogy.

So the reference here can be made rule-conformant for about nothing, and **it
would still not move the row**, because the row is what it already said it was:
60% `uirem`, bounded at 8%, and waiting on the middle end.

**Neither correction is a win, and neither is being counted as one.** Both make
the reference faster and our ratio worse -- by 3-4% on `fib` and by roughly
nothing here. Obeying the rule is a fairness action, and this is the second time
tonight that reading it as an optimisation was the mistake.

### `module-closures`: the `(D)D` closure ABI is real in the bytecode and free at runtime

The row's note said the cause was the closure ABI -- ours `(D)D` against the
reference's `(I)I` -- and the emission backs the first half completely. Every
call site widens an int in and narrows the result straight back out:

    125: i2d
    132: invokestatic  Closure0$call:(Lnts/gen/Closure0;D)D
    139: d2i

and the body's first instruction is `d2i`, its multiply is already an `imul`.
So the arithmetic is int on both sides of the boundary and the widening exists
only to cross it. `drive$Closure0` is `(Lnts/gen/Closure0;I)I` -- specialization
narrowed the named function and not the closure stub, which is what made this
look like an obvious four-instruction win.

**Priced by rule 3, and it is worth 0.1%.** The reference given our ABI exactly
-- `mix` and `twice` behind a static stub taking a closure reference and a
`double`, callers widening and narrowing, arithmetic character-for-character
unchanged -- against the reference as written, interleaved, identical checksums
throughout:

    round      McI      McD
      1       4417     4273
      2       4273     4367
      3       4273     4272
      4       4267     4315
      5       4277     4529
    minimum   4267     4272     +0.1%

C2 inlines the stub and folds the `i2d`/`d2i` pair, which is the same thing it
did to `intcall`'s `i2l`/`l2i` earlier tonight and the same thing record 0004
found it doing to the store/load round trip. **Three separate leads this
evening, all "the bytecode carries obvious redundancy", all zero.**

So the note was a true statement about the emission offered as an explanation of
a ratio, and it is not one. `module-closures` is also flagged *busy* and has
never been measured clean, so what the row needs is a clean run and not a fix.

### `module-closures` is 1.058x for no reason I can find, and three mechanisms are dead

Measured properly at last -- it had only ever carried a *busy* flag. Our
emission against the reference, interleaved, one JVM per arm, **identical
checksums (2.03397323776E13) between compiled TypeScript and hand-written
Java**, which is worth as much as the timing:

    minimum    ref 4216     ours 4461     1.058x

So the 1.06x is real and not the contamination flag. Then three named
mechanisms, each priced by rule 3 on the reference, one variable at a time:

    the (D)D closure ABI's i2d/d2i        McI 4267  vs McD 4272     +0.1%
    the non-final getstatic in the loop   McD 4209  vs McN 4213     +0.1%
    the callee's size against MaxInline   ours 4447 vs +inl60 4458      0%

**All three zero, and the transcriptions do not reproduce the gap at all** --
every variant lands at 4210-4270 where ours is 4461. This is `awfy-queens`
again: the residual survives every attempt to write it in Java.

**And the inlining one is a misreading worth keeping.** `-XX:+PrintInlining`
says, repeatedly:

    nts.gen.Program::Closure0$call (54 bytes)   callee is too large

against the reference's `McI::mix (13 bytes) inline`, which looked decisive --
54 bytes is past `MaxInlineSize`'s 35, so the ABI conversions would be costing
us the *inlining* rather than the cycles, which would have been a real exception
to the four-for-four rule above. **The same log also says `inline (hot)` for the
same method further down.** The "too large" lines are the site before it is hot;
the steady state inlines. Raising the threshold to 60 confirms it and changes
nothing.

The case's header says the row's question is "whether the load is hoisted out of
the loop and the call devirtualized". Both happen. The call is already
`invokestatic`, the field load hoists, and the closure body inlines when hot.

**So the row is 1.058x with no mechanism, and it goes in this section rather
than into another evening.** What is excluded: the ABI, the global's mutability,
the inline threshold, and any explanation a transcription can express.

### `array-from`'s set walk, checked on the runtime side rather than inferred

The timing half of this row was filed as "5.9x, and it is the lowering's",
which was a classification rather than a check -- the walk runs through
`NtsMap.next` and `NtsMap.keyAt`, and both of those are mine. So they were read.

**`next` is not the problem, and the obvious worry about it is wrong.**

    public static double next(NtsMap map, double from) {
        if (map.count == 0) { return -1.0; }
        int absolute = from < 0.0 ? 0 : (int) from;
        int at = absolute <= map.base ? map.head : Math.max(map.head, absolute - map.base);
        while (at < map.used) {
            if (map.keys[at] != null) { return (double) map.base + at; }
            at++;
        }
        return -1.0;
    }

The `while` looks like a scan and is not one: it resumes at the caller's cursor
and only steps over *deleted* slots. A set built by insertion and never deleted
from has no nulls, so every call returns on its first test. The walk is O(n)
across n elements, not O(n^2), which was the thing worth ruling out before
accepting a 5.9x on a 256-element collection.

**What it actually costs is the protocol, and the protocol is upstream.** Per
element we make two static calls and produce an `NtsValue` -- `next` for the
cursor, `keyAt` for the key, then an unbox -- where `marks.toArray()` is one
bulk copy. That is not something either helper can be made cheaper to avoid;
it is what an index-based `nts_map_next(map, from)` contract *is*, and
`runtime/jvm` implements that contract rather than choosing it.

So the classification stands, and now it stands on having read the code instead
of on where the function happened to live. Filed with the lowering, unchanged.

### There are 60 cases, not 51, and nine of them cannot be held to the bar

Everything in this file, and the goal text it is written against, says "all 51
cases carry a `ref.java`, so a node-only ratio is a choice". The first half is
true and the sentence is not: **`benches/cases` holds 60 directories**, 51 with
a `ref.java` and nine without.

    json-build-append   json-build-join      json-parse
    json-scan           json-serialize       json-stringify-doc
    json-stringify-fused json-stringify-inline json-stringify-typed

All nine are JSON and have no `ref.cpp` either -- only a `case.ts` -- so none of
them has a `jvm/Java` column and none can be measured against the bar's first
number.

**And for two of them that is a decision somebody made and wrote down, which I
did not check before writing the paragraph this replaces.** `json-scan`'s header
says it outright:

> There is no `ref.cpp`. A C++ number scanner is a plausible reference in a way
> the escaper was not -- the grammar is small and unambiguous -- but it would be
> answering "how fast is a hand-written scanner" rather than "what does this
> compiler do with the one we ship", and the `nts f64` column already answers
> the question a reference would be for.

That argument is about C++ and applies to Java unchanged, and `json-parse`
carries it too. So those two are not oversights; they are cases that
deliberately measure the compiler against itself, with `nts f64` as the control
rather than a person. **The remaining seven say nothing either way**, which is
the honest state: unexamined, not argued.

Writing this up as nine invisible rows before reading their headers is the same
mistake as the four profile shares -- a discrepancy assumed to be a defect
because it looked like one.

**They are not idle rows.** From the current sweep:

    json-scan     2.65 us   against node's 1.79 us
    json-parse   805.47 us  against node's 840.84 us

`json-scan` loses to node by 1.48x on the only axis it has. The bar's second
number -- decisively faster than node -- is measurable for these nine today and
nobody has been reading it, because a row with a `--` in the column this file
sorts by does not appear in it.

**What this changes.** The denominator in "every row where the lane loses" is
60 and not 51, and the second half of the bar -- decisively faster than node --
already applies to all nine. What is *not* established is that any of them
should have a `ref.java`: two have a written argument against it, and the other
seven have neither an argument nor a reference. Deciding that is `benches/**`
work and mine. Not done tonight; recorded so the next count starts from 60 and
starts by reading seven headers.

### Is the harness itself the band? No, and the 18% it was built around is narrower than it reads

Ten rows sitting 1-5% above parity with no per-row cause is the signature of one
systematic thing rather than ten separate ones, and the obvious candidate is the
harness. So it was checked, because `benches/common` and `tooling/bench` are
mine and nobody had.

**There is a real asymmetry and it is documented in the tool that creates it.**
`handwritten_java` puts the workload *inside* `Bench.Work.run()` -- `Ref` **is**
the `Work` -- and says why:

> The wrapper was not free. `awfy-sieve`'s reference measured 4.7us with the
> workload inline in `run()` and **5.5us behind one extra static call** -- 18%.
> An 18% tax on the *reference* lane makes this compiler look better, which is
> the one direction a harness must never be wrong in.

Our lane cannot have that. The generated driver is
`Bench.measure(new Bench.Work() { run() { return Program.work(seed); } })`, and
`work` then calls `work$whole` -- **two static frames where the reference has
zero, by construction rather than by choice.** If one call is worth 18%, ten
rows a few percent apart is exactly what two would look like.

**Measured, one variable, on `in-narrowing`'s own reference body:**

    A0   workload inline in run()      1292      what ref.java gets
    A1   one static call behind it     1317      +1.9%
    A2   two, which is our shape       1287      -0.4%

Identical checksums throughout, and `A2` is the *fastest* of the three. **Call
depth costs this row nothing**, so the harness is not taxing our lane and the
band is not its doing.

**And it bounds the 18%.** That number is real and it is about `awfy-sieve`
specifically -- its own comment says AWFY's benchmarks "are already three deep
before the harness adds a fourth", so what was measured is a depth *limit* being
crossed, not a per-call cost. Reading it as general is what made this hypothesis
look strong. It should not be quoted as one.

So: our emission runs 1313 against this body's 1292, about 1.6%, and none of it
is the harness. The gap is in the emitted code, where five leads are now dead.

### The machine is hybrid, nothing pins, and an E-core run is 1.8x slower

Every number in this file was taken unpinned on an **i9-14900K: eight P-cores at
5700-6000MHz and sixteen E-cores at 4400**. `perf stat` gives it away by
reporting each event twice, once for `cpu_core` and once for `cpu_atom`,
because the JVM's threads were on both.

    in-narrowing, same binaries, three runs each

                  ref     ours    ratio
      free       1362     1395    1.024
      P-cores    1340     1401    1.046
      E-cores    2474     2592    1.048

**An E-core run is 1.8x slower than a P-core one** -- more than the 1.295 clock
ratio, so IPC differs too.

**It is not the band.** The ours/ref ratio is 1.02-1.05 whichever way the run is
pinned, because both arms get the same treatment when they run next to each
other. That hypothesis is dead and it is the ninth tonight.

**And it is not the variance either, which I predicted it was and then built
the fix for.** `nts-bench` now confines a timed run to the performance cores --
`/sys/devices/cpu_core/cpus`, with `NTS_BENCH_CPUS` to override or `off` to
disable -- and the flags do not go away:

    objects      unpinned  1.51x / 1.36x       pinned  1.32x / 1.28x
    dispatch                                   pinned  1.23x / 1.56x

Slightly tighter, nowhere near quiet, and both rows still carry the note. So the
1.8x is a real hazard that pinning removes, and **the thing that makes these
rows unquotable is something else.** The variance is *within* one `nts-bench`
invocation -- five runs of one binary in one process set -- and confining them
all to the same core type does not touch whatever varies between them.

The change stays: two arms of one comparison must not be measured on different
hardware, and that was possible until now. It is not a fix for the flagged rows
and is not recorded as one.

**What this does not explain, said plainly:** `awfy-sieve`'s two modes are
1.23x apart and sticky across consecutive runs, which is neither the 1.8x here
nor something placement would clump by time. That section rules out compilation
and the collector by measurement and this does not displace it.

**The pinning that exists is about isolation, not core type.** The session
contract assigns cores 8-15 to this lane, which happen to be P-cores, and the
goal text's warning -- "pinning does not make a benchmark safe, cores share
last-level cache and turbo headroom" -- is about interference between sessions.
Nobody was pinning at all here, and on a hybrid part that is a different and
larger problem: not noise between neighbours but two arms measured on different
hardware.

### More warmup does not settle the flagged rows, and `objects` was never unsettled

`Bench.java` warms for `20000` iterations **or** 300ms, whichever comes first,
and its own comment names the gap: C2 "compiles at roughly five thousand
invocations and does it on a background thread, so a count guarantees the
*request* was made and not that the compiled code is installed". A run that
begins timing with C1 still executing measures C1, and five launches of one
binary would then disagree by whatever C1 costs -- which is the shape of the
1.2x-1.9x those rows carry.

Worth noting which bound actually binds: at about a microsecond an operation the
**count** binds first, so a fast case gets 20,000 iterations and roughly **20ms**
of warmup. A slow one hits the 300ms instead.

Priced with the time bound raised to four seconds, three runs each:

    objects     300ms   0.99x    0.99x FLAG   0.99x FLAG
    objects    4000ms   0.99x FLAG   0.99x    0.99x
    dispatch    300ms   1.02x FLAG   0.67x FLAG   1.08x FLAG
    dispatch   4000ms   0.71x FLAG   1.14x FLAG   1.14x

**The flags do not go away and the hypothesis is dead.** Eleventh tonight.

**But `objects` is 0.99x six times out of six**, at two different warmup
lengths, and that is the useful half. The flag is `nts-bench` reporting spread
*within* a run; the minimum it reports is stable to the second decimal across
six independent processes. This row has been carried as "1.00x / 0.91x *not
clean*" on the strength of two readings, and 0.91x was an outlier. **It is
0.99x and it is not a losing row.**

`dispatch` is the opposite and the reason the two must not be treated alike:
**0.67x, 0.71x, 1.02x, 1.08x, 1.14x, 1.14x**. Not a spread around a value, a
row that lands in two different places. More warmup does not touch it, and
neither did P-core pinning. It stays unquotable and the cause is unfound.

**So a flag is not a verdict.** Six of these rows carry one and at least one of
them has a perfectly stable answer underneath it. The others have to be checked
one at a time rather than dismissed together, which is what carrying them as
*not clean* had been doing.

### Six runs each of the flagged rows, and three of the four were never losing

`objects` turned out to be 0.99x six times under a variance note, so the other
four were asked the same way rather than dismissed together. Six `nts-bench`
invocations each, default settings, each one already a best-of-five:

    case-convert           0.98  1.01  0.95  0.96  0.92  0.95     median 0.955
    awfy-bounce            1.03  0.99  0.97  0.99  1.00  0.97     median 0.99
    awfy-sieve             0.96  1.02  0.95  0.93  0.92  0.93     median 0.94
    number-format-double   1.16  1.17  1.15  1.15  1.15  1.17     median 1.155

**Three of the four are at or under 1.00x and were being carried as
unquotable.** `case-convert` is under on five of six, `awfy-bounce` on four of
six and sits on parity, and `awfy-sieve` -- listed here as "1.03x or 1.27x", the
row that got its own section about being bimodal -- is under on five of six with
a median of 0.94x.

**`number-format-double` is the opposite and the more useful correction.** It
does not vary at all: six readings inside 1.15x-1.17x, a spread of 1.7%. Its
flag was on the *Java* side -- the reference varied, not us -- and a note about
the reference's instability was making our own stable number unquotable. It is
**1.15x**, which is worse than the 1.08x it was listed at and is now the
best-supported number in the table.

**So the flag was answering a different question from the one the table asks.**
`nts-bench` reports a minimum and flags on the spread around it; a minimum can
be reproducible while the spread is wide, and for four of these five rows it
was. `dispatch` is the one where it is not -- 0.67x to 1.14x across six --
and record 0132 already established why: its modes are chosen per JVM and
belong to the code this backend emits.

### The band is real: three rows reproduce to two decimals across six runs

Six rows had just come off the losing list because two runs were not enough to
place them, so the ten sitting at 1.01x-1.05x got the same treatment before
anyone concluded anything about them. The run was killed partway and what it
returned is enough:

    closure-merge    1.01  1.01  1.01  1.01  1.01  1.01
    growth-grown     1.01  1.01  1.01  1.01  1.01  1.01
    fib              1.04  1.03  1.03  1.03  1.03  1.04
    generator        1.01  1.00  0.98  1.02  1.04  1.01
    arrays           0.98  1.04  1.00  1.00  1.02  1.09

**`closure-merge` and `growth-grown` report the same two decimal places six
times, and `fib` moves by one percent.** That is not a row that cannot be
placed; it is a row losing by one to three percent, reproducibly, in six
independent processes. The band survives the treatment that dissolved
`case-convert`, `awfy-sieve`, `awfy-bounce` and `objects`.

`generator` and `arrays` are the other kind -- 0.98x to 1.04x and 0.98x to
1.09x -- and cannot be called from this. They need the six runs the others got,
which this run did not finish.

**So the two questions separate cleanly.** Whether a row loses is now answered
for `closure-merge`, `growth-grown` and `fib`: it does, by a little, and the
number is trustworthy. *Why* is unanswered, and eleven hypotheses died looking
for it -- five in the emission, the harness's call depth, the inline threshold,
core placement, and warmup twice.

`in-narrowing` and `strings` returned one reading each rather than six, so they
are not included above. That is the harness's row-name match rather than the
rows, and it is worth fixing before this is repeated.

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

**Blocked on `narrow.rs`, and the request is not the one written here for most
of a day.** The rows are `node-utf8`, `symbol-keyed-map`, `array-from`'s cursor
and `array-methods`. What this paragraph used to say -- that their `total` is
"an `f64` accumulator behind `| 0` where `ref.java` writes `int total`" -- is
**false on both rows it named**, and I sent it to MainClaude as a request before
reading the emission:

    array-methods       istore_2 / iload_2      an int slot
    symbol-keyed-map    iload 27                an int slot

`specialize` had already put the accumulator where I was asking for it to be
put. The widening is the *other* operand: `events.get(key) ?? 0` and
`xs.at(-1)` arrive as `NtsValue.num`, an f64, because a TypeScript `number` is
one. So the addition really is f64 + f64 and the `| 0` really does narrow a
double, and closing it means **proving an f64 from a number-typed map value or
array element is integral** -- range analysis, not slot selection, and strictly
harder than what was asked for. MainClaude has re-priced it on that basis.

The percentages above are profile *shares* and not savings: `array-methods`'
25% priced at 8.9% when measured, so discount the other two accordingly. The C
lane emits the identical defect, so it is fixed once, upstream. Do not build a JVM-only half. When it lands, measure the
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
