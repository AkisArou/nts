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
  - Is the harness itself the band? No, and the 18% it was built around is narrower than it reads
  - The machine is hybrid, nothing pins, and an E-core run is 1.8x slower
  - More warmup does not settle the flagged rows, and `objects` was never unsettled
  - Six runs each of the flagged rows, and three of the four were never losing
  - The band is real: three rows reproduce to two decimals across six runs
  - `closure-merge`'s 1.01x is not the closure ABI either, at a bimorphic site
  - `array-from`'s set walk priced at 6.5x, and it is the cursor being an `f64`
  - `array-from` moved: 2.12x to 0.95x, and the cursor was the whole of it
  - Re-measured after fourteen of the other lane's commits: nothing moved, and I nearly said two rows did
  - A fixture added in the same commit as its fix cannot be run against an older binary
  - ART, measured: seven of eight allocate the same, and the eighth is 43.7x
  - `array-methods` on ART: 6288 bytes/op to 144, and the fix is free on HotSpot
  - The ART allocation survey, twenty-four cases: three diverge and one instrument lied
  - The ART allocation axis, closed: one was ours, two are parity, one we win
  - A class file the JVM loads, `d8` refuses, and node disagrees with -- three rules, and the mangler knew one
  - And widening it found something already wrong, with no Android in it
  - `symbol-keyed-map` answered 32768 on ART where node answers 10240, and my own script wrote the bug
  - 59 of 60 driven on ART, and the last one is not a driver problem
  - The eight rows printing 1.0, checked rather than assumed
  - `symbol-keyed-map` on ART: 196,912 bytes/op to 304, and the box was the key rather than the answer
  - Substituting the call moved nothing, because the box has two halves
  - The sentence for the whole day, and it is the Node lane's
  - The ART allocation axis, actually closed: seven parities to the byte, four wins, five ours
  - `node-utf8` allocates 4.22x its reference on ART, and nothing on HotSpot says so
  - `node-utf8`: the fusion built the string it was written to avoid, and C2 hid it
  - The object count beside the byte count, and why it should have been there first
  - `growth-grown` is at its floor, and the count proves it in one line
  - `number-format-double`: the placement buffer was a `byte[]`, and ART decodes
  - The seven headers, read: six of them argue, and one row is genuinely missing a reference -- WITHDRAWN below
  - WITHDRAWN: `json-serialize` should not have a `ref.java` either, and its own header said so
  - The bar's second number, read at last: eight rows lose to node and six of them are the platform
  - The partition, re-measured at a fresh pin: same eight rows, same six and two
  - The published table against a fresh sweep: one of fifty-one rows is stale, and it is `array-from`
  - `loops.rs` exists, my rows are not waiting on it, and the row table said they were
  - A rule written for the only instance of a category is a rule about that instance
  - `cargo test --release` is the gate's test with the assertions removed
  - The interface cliff is at three, it is per call site, and my first number was the cliff quoted as the function
  - And the cliff is per call site, not per interface
  - Every number in that exchange is HotSpot, in a goal about Android
  - ART has no cliff and no free case: the dispatch curve is flat at 2x
  - `invokevirtual` is the same story, and it is this lane's own closure path
  - Bar 1 on ART: 51 rows, and the lane loses the bar by going to Android
  - `closure-merge` is the `(D)D` closure ABI, and it is 2.6x on ART and free here
  - And it reaches four rows, none of them a bar 1 row, so it is not next
  - The store/load round trip is 7.8% on ART and 0% here, which answers the plan and is not the lever
  - Three fixes priced tonight and none of them built
  - The eight AWFY rows on the allocation axis: bar 3 holds, and two rows stand out
  - `queenRows` is `[f64]` because the storage analysis gives up when an array crosses into the runtime
  - And the element type is worth 9.1% on ART, which is a fourth thing that is not the lever
  - Four mechanisms priced, four that are not it
  - `widen` does not invert on ART. It is worth more there, and I expected the opposite
  - The dex ratchet, made to fail on purpose
  - The two worst bar 1 rows, method by method: over half of what we emit is slot traffic
  - What a stack peephole would actually reach: 19% and 8%, not the 58%
  - Slot traffic is 1.4% on ART, the 7.8% was conflated, and instruction count is not the currency
  - The night's ledger, and what it rules out
  - A second sitting: 36 of 43 reproduce, seven do not, and it is the ART half that moves
  - Bar 1 on ART, confirmed across two sittings: two of eight, twice
  - `awfy-sieve`: two harnesses that should agree, differing by 40%, twice
  - Which other references are the unstable half: two, and four that are the machine
  - The control: the harnesses agree, and both halves of `awfy-sieve` are bimodal
  - `erasure-stored-unknown` is a `long[]` where the JVM wants a `double[]`: 3.5x on ART, 0% here
  - Generators as values: what this lane already has, and the two numbers that bear on it
  - And the settled shape has one consequence: a prefix is not a subtype here
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
| `symbol-keyed-map` | 2.87x | **not an accumulator problem -- that claim is withdrawn below.** `work$whole(I)I` and the slot is an `int`; the `f64` is the map *value*, `events.get(key) ?? 0` arriving as `NtsValue.num`. **ART 196,912 -> 304 B/op**: the key box, below |
| `array-from` | 2.12x -> **0.96x** | the cursor is held as an `int`. Thirteen runs across two sittings, 0.94x-0.97x. **Moved.** Below |
| `array-predicates` | 1.73x | at its floor: every helper inlines; the wrapper is the row |
| `absences` | 1.28x | blocked: **34%** is `uirem` over an `l2i` counter |
| `optional-chain` | 1.27x | the same `uirem` residual |
| `awfy-queens` | 1.23x; **ART 1.98x** | 20.6% is codegen and MINE -- ladder below. **The worst bar 1 row on ART.** One named cause found and priced at 9.1%: `queenRows` is `[f64]` where the reference is `int[]`, because `hir::runtime` has a `nts_array_fill_bool` and no `_i32`. The rest is still unfound |
| `generic-classes` | 1.13x | **cause found**: monomorphisation, not codegen -- below |
| `array-methods` | 1.17x, **ART 6288 -> 144 B/op** | helpers beat the reference by 18%; `toInt32` against the reference's `d2i` is **8.9%**, measured; the `NtsValue` from `at()` is scalar-replaced (144 B/op is the array literal, which the reference also pays) |
| `number-format-double` | **0.92x-1.15x across three sittings -- the reference is the moving half**; ART 12,464 -> 6,624 B/op | was published 1.15x from six runs inside 1.7%, promoted *because* "the reference varied, not us" -- which is backwards for a ratio and is retracted below. Two later sittings read 0.92x and 1.07x with the reference moving 13% and our side not moving at all. The formatter is 54% of the profile |
| `elementwise` | 1.05x / 1.02x | at its floor: both lanes vectorise |
| `instanceof` | 1.09x | 60% of the profile is `uirem`; bounded at 8%. Reference is narrower than the program, priced at ~0 -- below |
| `in-narrowing` | 1.01x / 1.02x | re-measured; was listed at 1.07x from a contaminated run |
| `module-closures` | 1.10x | measured clean at last, identical checksums. Three mechanisms priced dead (ABI 0.1%, non-final global 0.1%, inline size 0%); **no cause found** -- below |
| `awfy-sieve` | **0.79x-1.33x, and BOTH halves are bimodal -- OPEN** | `tooling/bench` publishes 0.94x from six runs, five under 1.00x. `tooling/android/times-on-device.sh` reads **1.32x and 1.33x** on two separate sittings, with every other shared row agreeing. Two instruments that are meant to measure the same thing differ by 40% on this row, reproducibly, and neither is known to be the wrong one -- so **the published number is not corroborated** and the row's ART figure (1.14x / 1.15x) is uncertified with it. Not chased; named. Section below |
| `bytes` | 1.05x | the `uirem` residual |
| `objects` | **0.99x** | six runs at two warmup lengths, all 0.99x. The variance note is spread *within* a run; the minimum does not move. **Not losing** |
| `generator` | 1.01x | 1.01x twice against 0.99x from another sitting; this row moves 0.04x between them and the bytecode is identical |
| `symbol-keys` | 1.04x | reads 1.04x twice against a 0.98x from another sitting -- and this row's own between-sitting movement is **0.07x**. Bytecode identical across the window; not a regression |
| `arrays` | 1.03x / 1.02x | both runs above; small and real |
| `fib` | 1.04x / 1.03x | the reference is `int` against a `number`; correcting it per the rule would move this **against** us by 3-4%, measured -- below |
| `upcast` | 1.03x / 1.05x | bytecode identical to the tree that measured 0.99x; a between-sitting difference, not a change |
| `checksum` | 1.00x | parity, twice |
| `closure-merge` | **1.01x**; **ART 3.33x** | six runs, all 1.01x here. **The largest ART regression in the table**, and found: the `(D)D` closure ABI, five conversions a call, worth **2.6x on ART and 0% on HotSpot**. Not allocation (128 B/op each side, to the byte) and not the trampoline. Below |
| `growth-grown` | **1.01x** | six runs, all 1.01x |
| `substrings` | **0.40x** | was 0.95x. **The largest real movement in the table** and unflagged |
| `map-and-set` | **0.79x** | was 0.86x |
| `dispatch` | 0.67x-1.14x *not clean*; **ART 1.03x** | six runs land in two places on HotSpot -- eight more make it *tri*modal, 17.8us to 34.0us, all of it in our half against a reference stable to 2.7%. **Not a number here and a number there**: eight ART runs span 0.6%. The bimorphic-inlining reason offered for it is retracted below -- `javap` says this case emits no virtual call at all |
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
`substrings` **0.40**, `array-mutations` 0.67, `awfy-permute` 0.72, `loop` 0.75,
`map-and-set` **0.79**, `awfy-mandelbrot` 0.84, `closures` 0.85,
`user-iterable` 0.90, `awfy-list` 0.93, `awfy-sieve` **0.94**,
`logical-assignment` 0.94, `case-convert` **0.955**, `array-from` **0.96**,
`erasure-stored-unknown` 0.96, `awfy-bounce` 0.99, `awfy-towers` 0.98,
`erasure-stored-typed` 0.98, `objects` **0.99**, `pipeline` 0.99, and at 1.00
exactly: `accumulate`, `awfy-nbody`, `erasure-typed`, `erasure-unknown`,
`growth-fixed`, `number-format`, `strings`.

**`dispatch` is not in that list and is not in the losing one either.** Six runs
put it between 0.67x and 1.14x and neither pinning nor thirteen times the warmup
narrows it; record 0132 has the rest. It is the one row in the table with no
number.

**The count, recounted from the table rather than carried forward.** The
headline below says 25 above 1.00x and it was true when it was written. It is
**21 above, 13 at or under and one unquotable** now -- `objects`, `case-convert`,
`awfy-sieve` and `awfy-bounce` came off the losing side by being measured six
times instead of two, `array-from` came off by being fixed, and
`number-format-double` went the other way from 1.08x to 1.15x. Every one of
those is a paragraph below rather than a number changed quietly.

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

> **RETRACTED 2026-09-12, and the reasoning above is backwards.** The bar is
> jvm over Java. A *ratio* is unquotable when **either** half moves, so "the
> reference varied, not us" is not a reason to promote the number -- it is the
> reason not to. Six readings inside 1.7% are six readings taken while the
> reference sat in one mode; nothing in them says how many modes there are.
>
> Measured since, on two sittings against an md5-frozen compiler: the reference
> moved **13%** between them while our side did not move at all, and the ratio
> read **0.92x** and then **1.07x**. With the 1.15x above that is three sittings
> giving 0.92, 1.07 and 1.15 -- a spread of **1.25x**, entirely from the half
> this paragraph dismissed.
>
> So `number-format-double` is not 1.15x and was never "the best-supported number
> in the table". It is somewhere in 0.92x-1.15x depending on which mode its
> reference lands in, and the compiler lane's spread table now carries it as
> `Moved`, cause unknown. What this cost is not the row: **the effort spent
> between 1.08x and 1.15x was spent on a movement that was possibly the
> reference's**, and any conclusion drawn from that movement inherits the doubt.

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

### `closure-merge`'s 1.01x is not the closure ABI either, at a bimorphic site

The most tractable row in the table: 1.01x, the same two decimals six times, on
a case small enough to read whole. Our merge emits

    140: invokevirtual  nts/gen/Fn3__3.call:(D)D

against the reference's `invokeinterface IntFn.apply:(I)I` -- both bimorphic
between two implementations, both allocating a capture per round.

**The `(D)D` had been priced at 0.1% on `module-closures` and that did not
settle it here.** There the call is `invokestatic`, which C2 inlines and folds
the conversions through. Here it is a *guarded* bimorphic call, where the
conversions sit either side of a type check and have no obvious reason to fold.
Different enough to be worth its own measurement.

One variable -- the reference's `IntFn` becomes `double apply(double)` with the
widening and narrowing our emission does, arithmetic unchanged:

    minimum   CmI 2124    CmD 2101    the double ABI is 1.1% FASTER

**Twelfth zero.** And the second time the closure ABI has been priced and come
back at nothing, in the two places its shape differs most.

So `closure-merge` loses one percent, reproducibly, and the difference is not
the dispatch, not the ABI, not the allocation shape and not anything else in the
emission that anyone has named. It is the clearest statement of where this lane
actually stands: **the codegen is not what is losing, and nobody can say what
is.**

### `array-from`'s set walk priced at 6.5x, and it is the cursor being an `f64`

The bulk helper the "Open, and whose" section has been asking for is written and
measured. Same map, same output, one variable -- whether the walk goes through
the cursor protocol per element or one pass inside the runtime:

    walked 918 ns    bulk 140 ns
    walked 918 ns    bulk 144 ns
    walked 945 ns    bulk 159 ns

**6.5x**, and `benches/cases/array-from` spends about **1.84ms of its 2.09ms**
in that walk -- 2000 rounds at 918ns -- against a reference at 986us. The row is
mostly this and not code generation.

**It is not call overhead, which was the obvious reading.** Rule 1, and both
helpers inline:

    NtsMap::next  (93 bytes)   inline (hot)   x12
    NtsMap::keyAt (54 bytes)   inline (hot)   x13

each preceded by exactly one `callee is too large` from before the site was hot,
which is the reading that has misled me twice tonight already.

**So what is left after inlining is the protocol's arithmetic, and the cursor is
a `double`.** `nts_map_next(map, from)` takes and returns an `f64` because
`hir::runtime` types it that way, so per element the inlined walk computes
`(double) base + at`, the caller adds `1.0` to it, and `keyAt` casts it back
with `(int) at` -- a double round trip and two bounds-and-null tests, where the
bulk pass carries an `int` slot and tests nothing twice.

That is a sharper hand-over than "the walk is 5.9x": the cost is not the calls
and not the `NtsValue` (C2 scalar-replaces it, as it does on `array-methods`),
it is an `f64` cursor round-tripping through `int` on every element of a
256-element set, 2000 times an operation.

**And that is worth 3.05x on its own, which changes whose the row is.** Same
protocol, same two calls an element, same tests, same output -- only the
cursor's representation:

    walked (f64 cursor)      919 ns
    walkedInt (int cursor)   301 ns
    bulk (no protocol)       149 ns

**672 of the 770ns is the cursor**, which is 87% of what removing the protocol
entirely would buy, for a change that keeps it. Carried through the row: the
walk is ~1.84ms of 2.09ms, so at 301/919 it becomes 0.60ms and the row lands
near **0.85ms against a reference at 986us -- about 0.86x**.

**This needs no lowering change.** It is `intcall`'s exact business -- the pass
that already decides `nts_array_index_of`'s answer is exact in an `int` and
rewrites the call to `arrayIndexOfI`. `NtsMap.nextI` and `keyAtI` are landed as
the targets, measured, and agreeing element for element with the `f64` pair.

**The pass is the harder half and is not written.** `intcall` holds a value as
an `int` when *every* use converts it to an integral type; a cursor's uses are
`+ 1.0` and being handed back to `next`, neither of which is a conversion, and
the value flows in a **cycle** through the loop's block parameter. This file has
twice predicted that extension would be needed -- "a backend-local extension of
`intcall` from a single value to a cycle" -- and this is the first measurement
saying what it would be worth.

So `array-from` moves from "the lowering's, 5.9x, hand it over" to **mine, 3.05x
of it, and priced before building**, which is the first time tonight a row's
cost has landed on this side of the line.

`NtsMap.keysIntoDoubles` is landed, documented with this number, and agrees with
the walk on seven cases including deletions, head advancement, refill and past
the linear limit. **It is unreachable until the lowering emits one call instead
of the open-coded loop**, which is `hir`'s. Filed with MainClaude with the
number and the reproducer.

### `array-from` moved: 2.12x to 0.95x, and the cursor was the whole of it

Priced first at 3.05x on the walk, then built. Eight `nts-bench` runs after,
each already a best-of-five:

    0.96  0.96  0.95  0.96      before the pass was simplified
    0.94  0.97  0.96  0.94      after

**0.94x-0.97x, from 2.12x.** Checksums agree across variants, floor 134,
46 tests, clippy clean.

`intcall` now finds a **cursor class**: values seeded by `nts_map_next`, closed
over block-parameter edges in both directions, over addition by a whole
constant, and over the three literals such a loop carries -- the one the cursor
starts from, the one it is compared against, and the one it steps by. The class
is refused whole unless every use of every member is one of the four shapes the
pass understands.

**Four sites had to learn that a value can be held narrower than its declared
type**, and finding them is the story:

    conversion's result     widened `nextI`'s `I` straight back to a double
    place's discard         popped `types::kind` words, not what is on the stack
    load's rematerialisation spelled a cursor's literal as a double
    the call site           `or_else` on an already-Some table entry, so the
                            override never ran at all

**Three of the four I guessed at and fixed without confirming, and none was the
one that mattered.** What found it was printing `code.depth()` around the call:

    nts_map_next -> nextI(Lnts/rt/NtsMap;I)I   depth 0 -> 3 -> 2

Three words pushed where the descriptor declares two. That named the argument in
one run, after three rounds of reasoning about which pass had claimed the value.
It is the same lesson as reading `javap` on `array-methods` this morning: **the
artefact says in one look what inference takes three rounds to get wrong.**

The `place` fix is worth keeping separately from all of this -- a discarded
value popped its *declared* width rather than its held one, which was right by
accident for as long as the only narrowing was of results somebody wanted.

### Re-measured after fourteen of the other lane's commits: nothing moved, and I nearly said two rows did

`dd57ceb5` carries a `width_of` miscompile fix -- a remainder's width was read
off its own result, so a 3.1e10 dividend was truncated to `int32_t` before the
modulus. That is exactly the `uirem` family's arithmetic, so the rows were
re-taken.

    array-from       0.97  0.96  0.95  0.96  0.97      five runs, held
    absences         1.26  1.26  1.26                  was 1.28
    optional-chain   1.27  1.27  1.27                  unchanged
    bytes            1.10  1.10                        was 1.05
    instanceof       1.13  1.13                        was 1.09

**`bytes` and `instanceof` look like regressions and are not.** Their emitted
arithmetic is unchanged -- `bytes` still has four `uirem:(II)I` and `instanceof`
two, the same counts as before the landing -- so the code those rows run did not
move and the numbers are between-sitting difference. The earlier 1.05x and 1.09x
were each a single reading from the big sweep; 1.10x and 1.13x are two apiece.

That is the **fourth** time tonight a between-sitting difference has presented
as a regression, after `symbol-keys`, `upcast` and `generator`. The difference
is that this time the artefact was checked before anyone was told: two `javap`
greps, and the report changed from "their fix cost us 5%" to "nothing moved".

**`array-from` held through all fourteen commits** at 0.95x-0.97x across five
runs. One earlier reading of 1.04x was an outlier and is why five were taken.

So the honest answer to "did their landing move a row" is **no**, on every row it
could have -- and the useful part is that saying so cost two greps rather than
an evening of bisecting a regression that was not there.

### A fixture added in the same commit as its fix cannot be run against an older binary

I reported that `c269e3bd` broke `string-keyed-table` in both lanes, quoted the
HIR disagreeing with itself, quoted the verifier, and wrote that the JVM lane
had caught what the C lane answered wrongly. **All of it was true of the binary
I ran and none of it is true of the tree.** At HEAD, freshly built, both lanes:

    667 cases across 23 functions, agreed on every case

`c269e3bd` is the commit that **fixed** it -- the missing `PROPERTY_ASSIGNMENT`
arm in `contextual_type`, which is the "the contextual type is not reaching the
literal" I had diagnosed -- **and the same commit added the four cases that
exercise it.** So a binary from before it, run against the example at it,
reproduces exactly the defect it closed.

**This is a new shape and the sharpest one in this file.** The stale-pin entry
above is about numbers being from the wrong tree; those are wrong in a way a
date or a commit count exposes. This is different:

- the failure is *real* -- a genuine VerifyError with a correct backtrace
- the analysis is *correct* -- the HIR I quoted is what that binary produced
- the diagnosis is *right* -- and it names the very bug the commit fixed
- and every word of it is worthless, because the artefact moved

Nothing in the output says so. A stale `nts-bench` says "N commits behind"
because `pin.sh` was made to; a stale `nts` says nothing at all, and the example
it is being run against came from the future.

**The rule: rebuild before diagnosing a failure in an example you did not write.**
Not before measuring -- before *diagnosing*. I had rebuilt several times last
night and the habit that saved me on `array-methods` -- read the artefact -- is
the same habit that betrayed me here, because I read the artefact and never
asked how old it was.

The `verify` argument in the message stands and is the salvageable half: a
producer/consumer mismatch of that shape is checkable now that `Table` is a
variant, and would be caught before any backend runs rather than by one
backend's verifier two layers later.

**And the floor was never red.** 137 at HEAD, matching the committed line. I had
declined to lower it on the grounds that a floor moved for another lane's
in-flight change stops meaning anything -- which was the right call for the
wrong reason, since there was no regression to accommodate.

### ART, measured: seven of eight allocate the same, and the eighth is 43.7x

Twelve optimisations were priced at zero here last night and **every one was
refuted by C2**. ART has no C2 -- no sea-of-nodes JIT, weaker escape analysis,
compilation ahead of time at install -- so the list was never a list of dead
leads, it was a list of unmeasured ones. The device is an x86_64 emulator at API
29, which is the wrong machine for *timings* and the right one for
**allocation**, because allocation counts are deterministic.

**The instrument first, because a counter that has counted nothing is worth
nothing.** `android.os.Debug.startAllocCounting` with `getGlobalAllocSize`,
against known allocations:

    nothing            16 bytes
    1x double[256]   2080          2064 + the 16 above
    100x           206416          100 * 2064 + 16
    1000x         2064016         1000 * 2064 + 16

Exactly linear, exactly 2064 per array. `com.sun.management.ThreadMXBean` does
not exist on Android, so the HotSpot instrument could not come along.

**Same programs, same entries, same iteration count, only the runtime differs:**

    case                     HotSpot      ART
    array-methods                144     6288      43.7x
    symbol-keyed-map             240      208
    erasure-typed                  0        0
    erasure-unknown                0        0
    erasure-stored-typed       16016    16384
    erasure-stored-unknown     16016    16384
    objects                        0        0
    arrays                       272      272

**So the plan's headline question is answered, and the answer is not the one the
worry was about.** "Does the erased representation need scalarising for ART" --
no, in general. ART eliminates the non-escaping erasures exactly as C2 does, and
`objects` is 0 on both, which is the A/B the plan wanted for the constructor
question.

**The one divergence is specific and it is the one I dismissed this morning.**
`array-methods` allocates 6288 against 144, and the difference is
`6144 = 256 * 24` -- one `NtsValue` per round, 24 bytes each, from
`arrayAtValue` returning an erased value that `getfield num` unwraps on the very
next instruction. HotSpot inlines that helper and scalar-replaces the result. ART
does not: it is a call boundary, and that is exactly where the weaker analysis
gives out.

I wrote this morning that the fusion helper "would have bought zero bytes". That
was true, and it was true of one runtime. **On the platform this backend exists
for it buys 6,144 bytes an operation**, and the row is 43.7x on the axis that
matters most on a phone.

Stable across N=500, 2000 and 8000 -- 6288 every time.

### `array-methods` on ART: 6288 bytes/op to 144, and the fix is free on HotSpot

`fuse` is wired. A call to `nts_array_at_value` whose every use is an `Unerase`
to a float now calls the scalar sibling, so the box is never built:

    array-methods    before   HotSpot 144    ART 6288
                     after    HotSpot 144    ART  144

**Both runtimes now allocate exactly the case's `new double[16]` and nothing
else.** The 6,144 bytes an operation -- 256 `NtsValue`s at 24 bytes, one a
round -- are gone from ART, and HotSpot is unchanged because C2 was already
removing them. A change worth nothing on one runtime and 43.7x on the other,
which is the whole argument for having gone to ART.

Nine cases still agree bit-for-bit between `java` and `dalvikvm`. Floor 137,
46 tests, workspace clippy clean.

**The substitution is a name.** `nts_array_at` already has table entries for the
bare and the wrapped array, so rewriting the helper's name before the lookup
picks the right overload for free. And it needs no precondition:
`NtsRuntime.arrayAt` is `at < 0 ? NaN : a[at]` and `arrayAtValue(...).num` is
the same expression with `ABSENT_NUMBER` being NaN.

**What it cost was the fifth and sixth site that had to learn a value can be
held differently from its declaration.** The verifier named both:

    nth(D)D @9: checkcast
    Type double_2nd is not assignable to 'java/lang/Object'

`narrow_result` reconciles a descriptor's return with the HIR type, and a fused
answer is declared `Erased` while being a `double` -- so it emitted a
`checkcast NtsValue` against a double on the stack. The StackMapTable had the
matching problem and called the slot a reference.

**Both were found by reading the listing at the offset the verifier named**, one
run each, against three wrong guesses on the cursor pass. The six sites are now
asked in one place -- `held_differently` in `body.rs` -- because a value loaded
as one representation and stored as another is not a wrong number, it is a frame
the verifier rejects, and six passes answering that separately is how it took a
night to learn once.

### The ART allocation survey, twenty-four cases: three diverge and one instrument lied

`tooling/android/bytes-on-device.sh` runs the same program under both counters.
Twice for the rows that differ.

    case                     HotSpot        ART
    in-narrowing                   0      81920      <- and so does ref.java
    generator                      0      80000      <- and so does ref.java
    case-convert               10232      23152      +126%
    number-format               4608       6456      +40%
    map-and-set                65952      74144      +12%
    growth-fixed               16400      20480      +25%
    growth-grown               32896      36992      +12%
    array-from               8280864    8342832      agree, and see below
    pipeline                  533520     533520      agree exactly
    array-methods                144        144      agree, since `fuse`
    arrays / objects / closures / strings / substrings / module-closures
    erasure-typed / erasure-unknown          0 and 0 on both

**`in-narrowing` looked like the finding and is not.** HotSpot allocates nothing
an operation and ART allocates eighty kilobytes, which is the `array-methods`
shape exactly -- so the hand-written reference was asked the same question, on
the same device, with the same counter:

    in-narrowing   ours 81920    ref.java 81920

**Byte for byte.** ART does not scalar-replace the shape objects and the
reference creates the same ones, so it pays the identical price. We are at
parity and there is nothing here to fix.

The arithmetic says why it is exact rather than close. `which = i & 3` gives one
`Circle` and one `Square` at 16 bytes and two `Wide` at 24 per four iterations
-- 20 bytes an iteration, times 4096, is 81,920. Both programs allocate the same
objects because they *are* the same objects.

**So the bar's third number needs saying more carefully than I wrote it.**
"bytes/op on ART no worse than on HotSpot" is the wrong comparison for a row:
it flags every case where ART simply lacks an optimisation, whether or not this
backend is responsible. The question that separates them is **no worse than the
reference on the same runtime**, and `array-methods` passed that test where this
one does not:

    array-methods   ours 6288   reference allocates nothing of the kind
    in-narrowing    ours 81920  reference 81920

The first was ours and `fuse` fixed it. The second is ART's and nobody's to fix
here.

**And the instrument lied first, which is worth more than the survey.**
`array-from` read **-247102 bytes/op**. `getGlobalAllocSize` answers an `int`,
the case allocates 8.28MB an operation, and two thousand of those is 16.5GB --
so the counter wrapped, to a plausible-looking negative rather than to anything
that announces itself. The arithmetic checks out: 16.56e9 modulo 4.29e9 is about
3.7e9, which as a signed int is about -0.6e9, over two thousand iterations.

The tool now sizes the device run from the HotSpot figure -- measured first, on
a 64-bit counter -- to keep the total under 1.5e9, and prints `overflow` rather
than a number if one still comes back negative. With that, `array-from` is
8,342,832 against 8,280,864: **they agree, and the 43.7x I would have reported
was the counter.**

### The ART allocation axis, closed: one was ours, two are parity, one we win

Every case the survey flagged has now been asked the only question that
separates a backend defect from a platform one -- **what does the hand-written
reference allocate on the same runtime**:

    case            ours ART    ref.java ART   verdict
    array-methods       6288    nothing of the kind   OURS -- `fuse` closed it, now 144
    in-narrowing       81920           81920          parity, exactly
    generator          80000           80000          parity, exactly
    case-convert       23152           29304          we allocate 21% LESS
    array-from       8342832    (agrees with HotSpot)  the counter had wrapped

**One of four was ours.** The other three are ART not doing escape analysis,
which costs the reference exactly what it costs us -- `in-narrowing` and
`generator` agree to the byte, because both programs allocate the same objects
for the same reason. `case-convert` we win, because our case tables allocate
less than `String.toLowerCase(Locale.ROOT)` does.

**So the ART finding is smaller than it first looked and better founded.** The
headline "ART allocates 43.7x more" was one real defect and three cases where
the platform is simply weaker at everyone's expense. The real defect is fixed
and the survey is the instrument that would find the next one.

**And the bar's third number should read "no worse than the reference on the
same runtime", not "no worse than on HotSpot".** The HotSpot comparison is how
the case was *found* -- it is a good screen, because a case that allocates on
one runtime and not the other is always worth a look. It is not the verdict,
and three of four times here it would have been the wrong one.

**And the three that were left are screened now, by a tool rather than by hand.**
`tooling/android/ref-bytes-on-device.sh` compiles the case's own `ref.java`
against a stub `Bench` carrying only the abstract `Work`, so the reference's
source is measured unmodified instead of transcribed. It reproduced both hand
transcriptions exactly -- 81920 and 80000 -- which is what earns it.

    case               ours ART    ref ART
    case-convert          23152      29304    we win 21%
    array-mutations       21600      36600    we win 41%
    number-format          6456       6456    parity, exactly
    growth-fixed          20480      20480    parity, exactly
    map-and-set           74144      68016    +9%
    array-predicates      25136      18792    +34%

`number-format` and `growth-fixed` are **exactly** the reference, so their
HotSpot-to-ART jump was the platform and nothing else.

**And the two we lose are not ART's doing.** `array-predicates` is 1.34x here
and the bytes/op table above already records it at **1.33x on HotSpot** --
24,992 against 18,792, the same ratio on both runtimes. An allocation gap that
travels unchanged between two collectors is a property of what this backend
emits, not of either one.

**So the ART allocation axis has no ART-specific defect left.** `array-methods`
was the only one, and `fuse` closed it. Everything else is either parity, a win,
or a gap that HotSpot has in the same proportion and that the existing bytes/op
section already carries.

### A class file the JVM loads, `d8` refuses, and node disagrees with -- three rules, and the mangler knew one

`symbol-keys` was green in every instrument this lane has. It verified under
`-Xverify:all`, it agreed with node, it ran on ART, and it could not reach
Android:

    Field name '__@kCount@2' cannot be represented in dex format.

`jvm_member_name` mapped six characters and kept the rest, on an argument its
own doc comment spelled out: the JVM's rule for a member name is much looser
than C's rule for an identifier, so applying C's would rename functions for a
constraint that does not exist. That argument is correct. **It is answering a
question with two answers when there are three** -- and the third is the one
that decides whether this backend is worth building, since Android is the
platform the other two lanes cannot reach.

I fixed the one character and wrote in the commit message that `@` was "the
whole of the difference in practice, not merely the first of a family". The
sixty-case sweep supported that: it was the only one of the sixty.

**The ratchet written to hold the fix refuted it on its first run.**

    `a b` mangles to `a b`, which d8 refuses -- add ' ' to jvm_member_name

Twenty-two more, and the sweep could not have found them because no case
contains one. Four lines of legal TypeScript does:

    class Holder { "a b": number = 1 }   ->   public int a b;

So the `match` is a predicate now. A list can be short by one; a predicate
cannot. That is the whole lesson and it generalises past this file: **sixty
programs is a fact about sixty programs.** Non-ASCII still passes through
untouched, because `SimpleName` admits it and a TypeScript identifier may
legitimately be spelled that way.

### And widening it found something already wrong, with no Android in it

    class C { "a.b": number = 1; "a$b": number = 2 }
    -> public int a$b;   public int a$b;
    -> ClassFormatError: Duplicate field name "a$b" with signature "I"

The mapping is not injective and never was. Two distinct properties, one field,
and a class file the JVM refuses at load -- this is the corpus's `unverifiable
class` row, which is a hard zero, reached from six lines. Where the descriptors
happen to differ it is worse: the class loads and the two properties are told
apart by their *types*.

`c_identifier` on the C lane names exactly this hazard and solves it, giving
`#`, `.` and `@` each their own spelling "so that two different qualified names
cannot become one C name". I did not have that and should have read it.

Refused by name as NTS4013 rather than fixed by escaping. The injective
mangling costs every generated name its readability -- `module$hinit` rather
than `module$init` -- for a shape that has never occurred outside the test that
found it, and the refusal says where the fix goes if a real program hits it.

**And the same reading found it on the C lane, where it is not refused.**
`c_identifier`'s injective branch only runs `if name.contains(['#','.','<','>','@'])`.
A space is in none of those, so `"a b"` takes the `else` and is returned
verbatim:

    program.c:8:14: error: expected ';' at end of declaration list
        8 |     int32_t a b;

Uncompilable C, from the same four lines, plus a matching `offsetof` in a
`_Static_assert`. Handed to MainClaude with the reproducer. LLVM is unaffected:
fields are offsets there.

`tooling/android/dexes.sh` is the ratchet, and it needs no device -- `d8` is a
compiler, so whether it accepts a class file is a question about the class file.
It covers the 137 examples, which nothing had ever dexed: the jar test only ever
sees hand-written Java, and `agrees-on-device.sh` needs an emulator.

    209 dexed, 0 refused, 1 declined by the backend

Neither defect came from it. Both came from asking the rule.

### `symbol-keyed-map` answered 32768 on ART where node answers 10240, and my own script wrote the bug

Chasing why `elementwise` failed `javac` in the ART sweep -- a two-parameter
entry my driver could not spell, which is all it was -- I read the driver
`tooling/bench` generates and found a static block mine does not have:

    static { nts.gen.Program.module$init(); }

with a comment saying it was added because forty-nine cases did not need it and
the fiftieth answered `4096 x 8` instead of `4096 x 2.5`. **That is the bit
pattern my ART sweep had been printing for `symbol-keyed-map` for two days:**

    ART sweep      40e0000000000000   32768   my driver
    node           40c4000000000000   10240   the oracle

Five module-level `const` symbols stayed null, five distinct map keys collapsed
into one, and every lookup hit it. The sweep reported `agree`, and it was
telling the truth: `java` and `dalvikvm` agree exactly, on a program that is not
the benchmark.

**The cause is not the driver, it is the flag.** `nts emit-jvm --entry work`
does not emit `module#init` at all, so no driver could have called it.
`tooling/bench` roots at `Entry(["work", "module#init"])`; the CLI's
`named_entry()` roots at `Entry(["work"])`, and the CLI's own doc comment
asserts these are the same thing. Two parsers sit twenty lines apart and
disagree: `requested_entry()` splits `--entry a,b` on commas, `named_entry()`
does not and instead collects repeated flags. So the fix is a repeated flag, not
a comma:

    --entry work --entry 'module#init'      ->   10240   matches node

Both scripts now root that way and emit the static block when `javap` shows the
method. `symbol-keyed-map` moved to `40c4000000000000`; `objects`, also on the
init list, did not move, so its module state never reached its answer.

**What this does and does not touch.** The allocation survey's conclusions
stand: `in-narrowing`, `generator`, `case-convert`, `array-mutations`,
`array-predicates` and `array-methods` have no module initialisation, so none of
them was running the degenerate program. The agreement sweep's *claim* was
always the narrow one -- `java` against `dalvikvm`, not against node -- and it
held. What it lacked was any reason to believe the program under both was the
right program, and "the bench cross-checks that emission against node" is now
the reason, which requires my emission to be the bench's.

**The instrument agreed with itself.** Two runtimes, one artefact, bit-identical
-- and identical is what a wrong program is too. This is the third time on this
lane that a comparison passed because both sides shared an assumption, and the
first two are above: an A/B against a binary that predated the fixture, and a
regression published from two runs in one sitting. A control that cannot fail
independently of the thing it is controlling is not a control, and neither
`agree` nor `0 refused` is evidence until something in the loop can say no.

### 59 of 60 driven on ART, and the last one is not a driver problem

`elementwise` spent two days as "javac failed" and then, briefly, as an honest
skip. Both were wrong about what mattered, which is *which* case it is: it is
the only one of the sixty where an array crosses the generated boundary. Bounds
checks, a different collector and no C2 make that the shape ART is most likely
to diverge on, so it was the single worst case to leave uncovered -- and it was
uncovered because my driver could not write down a `number[]` argument.

The case had already answered this. `driver.java` exists because `workload`
cannot synthesise a call for it -- the same buffer goes to every call and is
refilled in place, so there is state to reset rather than an expression to write
-- and `driver.cpp` and `driver.mjs` are the same escape hatch on the other two
lanes. What was missing was a `Bench` for it to run against.

A one-shot `Bench`: `run()` once, print the bit pattern, no warmup. The same
reasoning `ref-bytes-on-device.sh` already uses for its stub -- this asks what
the program answers, and warmup would only make it answer more times. Any case
shipping a `driver.java` is driven now, rather than this one being special.

    elementwise    node 40000035b03f1bc9
                   jvm  40000035b03f1bc9
                   art  40000035b03f1bc9

Checked against node rather than resting on the agreement, for the reason the
section above exists.

`json-serialize` is the remaining one and it is not a driver gap: `case.ts`
exports nothing at all, and its workload comes from `provider`.

### The eight rows printing 1.0, checked rather than assumed

The re-swept table has eight `awfy-*` rows printing `3ff0000000000000` and two
rows printing `0`, which is exactly what the degenerate-program signature looked
like an hour earlier. All three were checked:

    awfy-*             `return benchmark.innerBenchmarkLoop(n) ? 1 : 0`
    generic-classes    node 0                 an xor total that cancels
    symbol-keys        node 0                 confirmed against node

1.0 is the verification passing, and the two zeros are the answer. Recorded
because "these look degenerate" and "these are degenerate" were one keystroke
apart, and the whole of the preceding section is about having taken agreement
for evidence once already.

### `symbol-keyed-map` on ART: 196,912 bytes/op to 304, and the box was the key rather than the answer

`fuse` exists because a helper's erased *answer* is read as a scalar on the
next instruction, so the box never needs to exist. This is the same sentence
about an *argument*, and it is the larger of the two.

    symbol-keyed-map    HotSpot 368    ART 196,912    before
    symbol-keyed-map    HotSpot 368    ART     304    after

`events.get(key)` lowers to `NtsValue.ofObject(symbol)` and then
`NtsMap.get(map, NtsValue)`, and the first thing `get` does is compare through
the box and discard it. The row looks a symbol up 8,192 times an operation, and
`8192 * 24 = 196,608` is the whole of the difference to within the 304 that
remains -- which is the four `set` calls' own boxes and the map. C2 inlines the
helper and scalar-replaces the key; ART does not reach through the call
boundary that inlining removes. The same mechanism as `array-methods`, one
argument position over.

**The equality is exact rather than close.** `ofObject` tags a non-null
reference `OBJECT`; `hash` sends that tag to `hashObject`; `sameKey` reaches its
default arm -- `a.ref == b.ref` -- only once `a.tag != b.tag` has ruled out
every other tag. So `getObject` matches a stored key that is tagged `OBJECT` and
holds the same reference, and nothing else moves. `hashObject` is *called* from
`hash`'s default arm rather than transcribed beside it, because two hashes that
must agree and do not would not throw -- the lookup would just stop finding
things, which is the failure mode this file has already been caught by twice.

**Strings are excluded, and that is precisely where the box earns its keep.**
`Managed(String)` erases through `ofString` and tags `STRING`, and `sameKey`
compares a `STRING` by `equals` where an `OBJECT` goes by reference. An unboxed
lookup assuming `OBJECT` would silently stop finding string keys that are equal
without being identical.

### Substituting the call moved nothing, because the box has two halves

The first version emitted `NtsMap.getObject` and measured **exactly what it
measured before**. The `Erase` is a separate operation, and it went on emitting
`ofObject` into a slot with no reader -- so the call took the reference and the
box was built anyway.

`fuse`'s other direction needs no equivalent, because there the call *is* the
producer: not emitting the box and not emitting the call are the same act. That
asymmetry is why I did not expect this one, and it is worth stating as a rule:
**a fusion that removes a consumer has to remove the producer too, and only the
answer-shaped fusions get that for free.**

Found by reading the emission once the number failed to move. Reasoning about
which pass owned the value is what produced the version that did not work.

MainClaude hit the same shape within the hour, from the other side: refusing a
field with no C spelling left the struct two members short with two
`_Static_assert(offsetof(...))` lines still naming them, and `emit.rs` already
carried a comment saying a struct missing a field the reference map points at is
not a smaller object but a wrong one. Two artifacts, two halves, one fix
reaching one half each time.

### The sentence for the whole day, and it is the Node lane's

They found a probe printing `e.code ?? e.name` over twelve cases with zero
differences, on an artifact carrying no `code` at all: the `??` fell through to
`name`, which happens to be the code string. Their words:

> A fallback in a comparison is a place where two different things print the
> same.

`??`, `||`, a default parameter, a catch-all `_ =>` arm -- every one is a join,
and a join is where a distinction goes to die. **My version had the join in the
artifact rather than in the probe**: `module#init` missing, five symbols null,
five map keys collapsing into one, and `java` and `dalvikvm` agreeing to the bit
for two days. Same failure, different half of the loop.

### The ART allocation axis, actually closed: seven parities to the byte, four wins, five ours

I wrote "the ART allocation axis, closed" earlier on eight cases and a broken
instrument. Here it is on **58**, with both drivers calling module
initialisation and both counters retried past the 32-bit wrap.

The screen -- ours on ART against ours on HotSpot -- flags twenty rows. It is
the wrong verdict and the right filter, for the reason recorded above: ART does
no escape analysis on ordinary objects, so a program allocating a shape per
iteration pays here whoever wrote it. The verdict is **ours on ART against
`ref.java` on ART**, same runtime, same question.

    row                     ours       ref     verdict

    instanceof         2,133,336 2,133,336     parity, to the byte
    optional-chain     1,600,000 1,600,000     parity, to the byte
    in-narrowing          81,920    81,920     parity, to the byte
    generator             80,000    80,000     parity, to the byte
    growth-fixed          20,480    20,480     parity, to the byte
    erasure-stored-typed  16,384    16,384     parity, to the byte
    number-format          6,456     6,456     parity, to the byte
    symbol-keys               24        24     parity

    bigint                22,032    78,192     ours is 0.28x
    array-mutations       21,600    36,600     ours is 0.59x
    user-iterable             24        40     ours is 0.60x
    case-convert          23,152    29,304     ours is 0.79x

    node-utf8            285,376    67,632     ours is 4.22x
    growth-grown          36,992    20,480     ours is 1.81x
    number-format-double  12,464     6,952     ours is 1.79x
    array-predicates      25,136    18,792     ours is 1.34x
    map-and-set           74,144    68,016     ours is 1.09x

**Seven rows agree with a hand-written reference to the byte.** `instanceof`
allocating 2,133,336 on ART and *nothing at all* on HotSpot is C2 removing every
allocation in the row; the reference gets the same treatment and loses it the
same way. Two programs allocating the same objects for the same reason is not a
number that can be arrived at by tuning.

**And it corrects the earlier entry rather than extending it.** `instanceof` and
`optional-chain` were not in the eight; they read `overflow`, which I recorded
as an instrument limit and which was the strongest answer available -- the
counter wrapping *is* "this allocates megabytes". `bigint` and `array-mutations`
were not measured at all.

### `node-utf8` allocates 4.22x its reference on ART, and nothing on HotSpot says so

    node-utf8    HotSpot ours 98,472   ART ours 285,376   ART ref 67,632

The row is already the table's worst at 6.53x jvm/Java, and this file says that
is "a codec against an intrinsic" and cannot reach the bar. **The allocation is
a different claim and it is not covered by that argument.** The reference is a
hand-written Java codec doing the same work, on the same runtime, in a fifth of
the garbage.

It is the largest remaining ART number that is ours, and it is *invisible on
HotSpot*: 98,472 against the reference's -- unmeasured there, but the ratio at
1.45x screen level hides what the same comparison on ART shows at 4.22x. This is
precisely the goal's premise. "C2 handles it, therefore it is free" does not
transfer, and this row is where the difference is biggest.

`growth-grown` at 1.81x is the second, and it is a sharper question than it
looks: `growth-fixed` is parity **to the byte** against the same reference. The
same program, the same reference, and the only difference is that one array
grows. So this is not the `NtsArrayD` wrapper as such -- the fixed row proves
the wrapper costs nothing here -- it is the growth strategy inside it, which is
`runtime/jvm` and mine.

`number-format-double` at 1.79x is the third. `number-format` beside it is
parity to the byte, so it is the *double* formatter and not the integer one.
`array-predicates` at 1.34x on ART matches its 1.33x on HotSpot, which is the
growable-wrapper finding already recorded and already upstream.

### `node-utf8`: the fusion built the string it was written to avoid, and C2 hid it

Priced first, on the artefact, and the pricing is the whole story.

The row allocates 285,376 bytes/op on ART against its reference's 67,632. Split
it and `utf8Write` is free on both runtimes -- 680 and 704 -- so `utf8Decode` is
all of it. Counted rather than reasoned about, using ART's own
`getGlobalAllocCount` beside `getGlobalAllocSize`:

    bytes/op 354,496    objects/op 15,366    avg 23

**Two objects per character, at 23 bytes**, which is a `String` and its backing
array. `javap` says where:

    321: invokestatic  NtsRuntime.stringFromCharCode:(D)Ljava/lang/String;
    324: astore        27
    326: aload         9
    328: dload         21
    330: invokestatic  NtsRuntime.appendCharCode:(...)

The string is built, stored to slot 27, and **never read**. `ops` decided at
emission time to fuse `out += String.fromCharCode(c)` into `appendCharCode`, and
`block` did not know, so it emitted the call as well.

**The fusion's own comment claims about a hundred allocations a decode saved.
That saving was C2's.** On HotSpot the dead allocation is deleted and the
measurement looked right; on ART nothing deletes it and the fusion had been
worth nothing since it was written. This is the goal's premise in one site --
"C2 handles it, therefore it is free" -- and it was not a lead that went
nowhere, it was a *fix* that was already in the tree and had never worked.

    node-utf8   ART   285,376 -> 83,136     against the reference's 67,632
    node-utf8   HotSpot 98,472 -> 75,432

4.22x over the reference becomes **1.23x**. And HotSpot moved by 23,040 too, so
C2 was not removing all of it even there -- which is worth saying because I
expected zero on that column and said so before measuring.

**The same omission as the object key, and older.** Both are a fusion that
replaced a consumer and left the producer emitting. `ops` now asks
`builder::char_code_appends` rather than re-deriving the condition, so the two
places cannot disagree again -- which is the rule 0077 states and which this
site had been quietly breaking.

Two of the four `stringFromCharCode` calls in `utf8Decode` fuse; the other two
have real readers and stay.

### The object count beside the byte count, and why it should have been there first

`getGlobalAllocSize` answers *how much*. `getGlobalAllocCount` sits next to it in
the same class and answers *how many*, and their quotient names the type:

    node-utf8              bytes 354,496   objects 15,366   avg 23
    growth-grown            bytes 36,992   objects     11   avg 3,362
    growth-fixed            bytes 20,480   objects      1   avg 20,480
    symbol-keyed-map           bytes 304   objects     11   avg 27
    number-format-double    bytes 12,464   objects    384   avg 32

Every one of those lines is a diagnosis. 23 bytes is an `NtsValue` or a small
`String`; 20,480 with one object is the array itself; 3,362 average over eleven
objects is a doubling ladder. The survey prints both now.

**It should have been there from the first ART measurement.** Two objects per
character told me `node-utf8`'s cause before I read any bytecode, and the
bytecode then took one look to confirm. Bytes alone had been the instrument for
three sittings and every diagnosis from them started with a guess.

### `growth-grown` is at its floor, and the count proves it in one line

Ours 36,992 on ART against the reference's 20,480 -- 1.81x, and `growth-fixed` is
parity **to the byte** against the same reference. The reference is deliberately
the same `double[n]` in both, and says so: a person with `n = 2048` in front of
them writes `new double[n]` either way, the JDK has no growable primitive array,
and an `ArrayList<Double>` would box.

So the gap is growth against no growth. `growCapacity` doubles from a floor of
four, so a push loop to 2048 allocates capacities 4, 8, ..., 2048 -- ten arrays,
4,092 elements:

    10 * 16 header  +  4,092 * 8  =  32,896

which is **exactly** the measured HotSpot figure, and the ART count reads
**eleven objects**: those ten and the `NtsArrayD`. Doubling is 2x the final size
and no growth policy that does not know the final size beats that. There is
nothing here to take.

### `number-format-double`: the placement buffer was a `byte[]`, and ART decodes

    number-format-double   ART 12,464 -> 6,624    reference 6,952
    number-format-double   HotSpot 10,576 -> 10,576

1.79x over its reference becomes **0.95x**, and HotSpot does not move at all.

192 conversions an operation and 384 objects: two each, where ART stores a
string's characters inline in the object and one is the floor. Measured on
device rather than reasoned about, twenty thousand calls each:

    new String(byte[], 0, 17, ISO_8859_1)    objects/call 2.0   bytes/call 88
    new String(char[], 0, 17)                objects/call 1.0   bytes/call 40

`ISO_8859_1` has to *decode*, and ART decodes through a fresh `char[]` before
building the string. **`HotSpot` hides it in the opposite direction from
usual**: compact strings make the ISO-8859-1 path its preferred one, which is
why the buffer was a `byte[]` and why the HotSpot column is unchanged to the
byte. A row where the right answer for one runtime is the wrong one for the
other, rather than one runtime failing to remove what the other does.

`SHORTEST_DIGITS` stays a `byte[]` -- it is Grisu's output buffer and its
contract is with `NtsGrisu`. Only the placement buffer moved, and the five
`System.arraycopy` calls became a `copyDigits` loop of at most seventeen.

Checked against node with the same 98,910-value differential the radix work
used: **0 differing**, and every ART bit pattern identical to the sweep before
the change.

**And I measured it twice, because the first reading said zero.** The jar is
embedded in the compiler by `include_bytes!`, so regenerating
`nts-runtime.jar` and re-running without rebuilding `nts-cli` measures the
runtime you just replaced. `nts-bench does not follow the CLI` is the same
sentence one level down.

### The seven headers, read: six of them argue, and one row is genuinely missing a reference

This file said of the nine JSON rows that two had a written argument against a
reference and "the remaining seven say nothing either way, which is the honest
state: unexamined, not argued". Reading them, that is wrong in the direction
that costs least but is still wrong. **Six of the seven argue**, and the
arguments are better than the one I would have made for them.

**`json-build-append` and `json-build-join` are a pair, and the pair is the
measurement.** Their headers say so outright -- "Read the pair, not either row.
The number that means something is the ratio between them" -- because the two
produce identical output from identical input and differ only in `+=` against
`join`. A host answers with a shrug, since V8 and JavaScriptCore rope their
concatenations; a flat-string target does not. A `ref.java` would answer a third
question nobody asked.

**`json-stringify-doc`, `-typed`, `-inline` and `-fused` are a series of four**,
meant to be read against each other -- 7.20ms, 1.26ms, 0.99ms, 0.707ms, byte-
identical output, no compiler change at any step. And they already have an
outside reference that is not a `ref.java`: `native.mjs` beside them times
node's and bun's *built-in* `JSON.stringify` on the same document, because the
harness's own `node` column runs our TypeScript rather than the engine's JSON.
That is the distinction a reference exists for, and it is already made.

**`json-serialize` is the one that is genuinely missing one**, and its own
header is what says so: "Real TypeScript, timed. Like `node-utf8`, nobody
writing this was thinking about a benchmark." `node-utf8` is its stated sibling
and `node-utf8` **has** a `ref.java`. Same argument, same shape of workload -- a
character-at-a-time scan with a branchy classification and a number formatter --
and one of the two is priced against a person while the other is not.

It is also the only one of sixty not driven on ART, because `case.ts` exports
nothing and its workload comes from `provider`. Two instruments are blind to the
same row for two unrelated reasons, which is the kind of coincidence worth
naming rather than fixing twice.

So the count is **eight of nine argued and one open**, not two and seven. Mine,
and the actionable half is one file. **WITHDRAWN two sections below: it is nine
of nine, and the one file should not be written.**

### The bar's second number, read at last: eight rows lose to node and six of them are the platform

**Stale numbers, and they are enough to settle the shape** -- confirmed at a
fresh pin two sections below. These come from the pinned worktree at `bf066859`, so `array-from` is still 2.12x here and its fix
has since landed. A clean sitting is owed. But the partition does not depend on
any single row being current, and it has never been done at all.

The bar says "decisively faster than node". The table sorts by `jvm/Java`, so a
row at parity with its hand-written reference while **both** lose to V8 reads as
finished. The absolute `nts JVM`, `Java` and `node` columns are all in the
table, so `Java/node` is a division and not an inference.

**Eight of the forty-three rows with a reference lose to node.** Six of those
eight, the hand-written Java loses too:

    row                jvm/node   Java/node
    array-from             4.28        2.02   platform
    loop                   1.59        2.12   platform
    bytes                  1.42        1.35   platform
    map-and-set            1.27        1.62   platform
    objects                1.11        1.11   platform
    case-convert           1.01        1.15   platform

    node-utf8              1.31        0.20   OURS
    generic-classes        1.12        0.99   OURS

**Thirty-three rows beat node on both lanes**, and several by an order of
magnitude -- `instanceof` 0.05, `generator` 0.05, `elementwise` 0.06,
`closure-merge` 0.10, `optional-chain` 0.10.

So the second number is **two rows**, not twenty. That is the whole value of
doing the division: `loop` at 1.59x of node has been readable as a defect since
the column existed, and a person writing Java gets 2.12x -- worse than we do.
Reporting those six as a queue would be reporting the JVM's distance from V8 as
though it were our codegen's.

**`node-utf8` is the sharpest row in the table and it is sharp in both
directions.** Its reference is **five times faster than node** (0.20) while we
are 1.31x slower -- a 6.5x gap against a hand-written Java codec that is itself
crushing V8. This file already says the row "compares against a platform
intrinsic and cannot reach the bar". Against *node* that is true. Against
`ref.java` it is not, and the reference is the bar's first number. The two
readings have been filed under one sentence and they are different claims.

`bigint` is the case that shows why `Java/node` alone is not the test: its
reference loses to node at 1.02, and we are at **0.17** -- six times faster than
the reference and six times faster than node. A row is only a question when
`jvm/node` is above one.

### The partition, re-measured at a fresh pin: same eight rows, same six and two

The section above was measured on a worktree **480 commits behind**, which is
the exact failure `pin.sh` exists to prevent, and I said so at the time. Re-pinned
to HEAD and re-swept under the gate lock:

    row                jvm/node  Java/node  jvm/Java
    array-from             2.02       2.13      0.95   platform
    loop                   1.68       2.23      0.76   platform  *
    objects                1.42       1.39      1.02   platform  *
    bytes                  1.41       1.28      1.10   platform
    map-and-set            1.26       1.56      0.81   platform  *
    node-utf8              1.21       0.20      6.15   OURS
    generic-classes        1.18       0.99      1.19   OURS
    case-convert           1.10       1.14      0.96   platform

    51 rows with a reference; 8 slower than node; 6 of those the
    reference is slower too; 43 faster than node on both lanes.

**Identical partition across two sittings 480 commits apart** -- same eight
rows, same six and two. `array-from` is the row that moved most between them
(jvm/node 4.28 to 2.02, because the cursor fix landed in between) and it stays a
platform ceiling, because a hand-written Java `Array.from` is 2.13x of node
either way.

`*` marks the three measured while another session's compiler was running, and
they are named rather than dropped: `loop`, `objects` and `map-and-set`. A busy
machine inflates our column and the reference's together, so a *ratio* survives
it better than an absolute -- but for `objects` at `Java/node` 1.39 the margin
is not large, and it is the one of the eight whose classification a clean
sitting could in principle move. It landed platform in both sittings, at 1.11
and 1.39.

**`array-from` at 0.95x is a third sitting on the cursor pass** -- 0.96x over
thirteen runs, then 2.12x on the stale tree because that pin predated the fix,
now 0.95x at HEAD. The stale reading is the useful one: it is what a pin 480
commits old does to a row whose fix is 400 of them ago.

Of the rows this session touched, `node-utf8` (6.54 to 6.15), `array-methods`
(1.17 to 1.14) and `generic-classes` (1.13 to 1.18) all moved inside the band
this file spent a night establishing is not a verdict, so **none of them moved**.
`symbol-keyed-map` and `number-format-double` were both contaminated and are not
quotable from this sitting at all.

### WITHDRAWN: `json-serialize` should not have a `ref.java` either, and its own header said so

Two sections above I wrote that `json-serialize` is "the one genuinely missing"
a reference, on the argument its header makes -- "Like `node-utf8`, nobody
writing this was thinking about a benchmark" -- and that `node-utf8` is its
stated sibling and has one.

**Priced before writing it, and the price is a second number formatter.** The
case serializes ten doubles a round through `numberText`, which is
`String(value)`. On those ten values:

    value                   Double.toString        String(value)
    0                       0.0                    0
    42                      42.0                   42
    1e21                    1.0E21                 1e+21
    1e-7                    1.0E-7                 1e-7
    123456789012345678      1.2345678901234568E17  123456789012345680
    5e-324                  4.9E-324               5e-324
    -0                      -0.0                   0

`number-format-double/ref.java` handles this family with one rule -- strip a
trailing `.0` -- and its own comment says exactly why that is enough *there*:
"the two languages also disagree about when to switch to exponential -- Java at
1e7 and 1e-3, JavaScript at 1e21 and 1e-6 -- and this case's values run from
0.0029296875 to 99, so neither side reaches either threshold". **This case's
values cross both**, so that fix-up does not transfer.

And one of them is not a formatting rule at all. `Double.parseDouble("5e-324")`
**is** `Double.MIN_VALUE`, so JavaScript's one-digit answer round-trips and
Java's `4.9E-324` is simply not the shortest. Reproducing it means generating
digits, not reshaping a string.

**So the reference would be a second Grisu to keep correct**, which is precisely
the argument this case's header already makes against a `ref.cpp`: "a second
implementation to keep correct rather than a reference to divide by". I read
that paragraph, recorded that it argued about the *escaper*, and did not notice
it applies at least as strongly to the number form.

**And the sibling does not transfer because of what it is.** `node-utf8`'s
reference formats **no numbers at all** -- it is a codec, bytes in and a string
out. Same shape of workload in the sense the header means, and a different
problem for a reference.

So the count is **nine of nine argued and none open**, not eight and one. The
useful part of the exercise was the pricing: the measurement that would have
justified writing the file is the one that says not to.

### The published table against a fresh sweep: one of fifty-one rows is stale, and it is `array-from`

`README.md`'s table is what anyone outside these two files reads, and nothing
checks it against the tree. MainClaude found `awfy-towers (rc)` recorded at
**7.82x** C++ and measured it at **1.58x** -- a 5x error that had been sitting
in the published file for weeks because nobody re-ran the table after whatever
moved it.

So I diffed my own 51 rows the same way, against the pinned-at-HEAD sweep:

    row                README      fresh   jvm drift
    array-from          2.09x      0.95x       0.50x   STALE
    objects             1.00x      1.02x       1.39x   contaminated, not stale
    the other 49                               ~1.05x

**One row is stale and it is `array-from`** -- 2.09x against 0.95x, because the
cursor pass landed after the table was written. The other 49 sit inside 5%,
which is the run-to-run band this file has now measured twice.

`objects` is the trap in the list rather than a finding. Its jvm *time* drifts
1.39x, and it was measured while another session's compiler was running; this
file already records it as bimodal across sittings at 1.11x and 1.39x. A row
that varies should say so rather than be re-stamped from whichever sitting is
newest -- correcting it from a contaminated run would be the same error as
leaving `array-from` at 2.09x, in the other direction.

**The check is a diff and it had never been run.** Two files assert numbers
about this lane -- this one and the table -- and only one of them is maintained
by anyone reading it. `array-from` is the third time that row has taught the
same lesson today: 0.96x over thirteen runs, 2.12x from a pin 480 commits old,
2.09x in the published table. The number was right and three different
artefacts disagreed about it.

### `loops.rs` exists, my rows are not waiting on it, and the row table said they were

The accumulator range analysis I have been recording as an upstream blocker is
`compiler/core/src/hir/loops.rs`, and it has been there the whole time. Its own
header states the fact I kept describing as missing -- that the bound is about
*iterations* and nothing in the value domain can express it -- and it is
measured at 4.4x on a dependent chain.

**It runs in `hir`, so its result is already in the IR this backend reads.** An
accumulator it proves is an `int32` in the types I see. Checked on the row I had
filed against it:

    public static int work$whole(int)      symbol-keyed-map
    71 int loads and stores, 26 double

The slot is an `int` and always was. I established that hours ago and withdrew
the claim in a section below -- and **left it standing in the row table**, which
is the artefact anyone reads first. "blocked: 50.5% is `toInt32` on an `f64`
accumulator" sat there while the correction sat three thousand lines lower.

That is the third time this file has done it: a heading outliving its body, a
count outliving its table, and now a withdrawn claim outliving its withdrawal.
The correction is cheap and the habit is not: **a retraction has to reach the
summary, not only the section**, because the summary is what a reader quotes.

**And there are two reasons a descriptor can be wide, which I had as one.**
MainClaude's distinction: the analysis decides the descriptor, *and* a root is a
wall, so an exported function's parameters stay as wide as their declared types
whatever the analysis proves. `(Queens;II)Z` against `(Queens;DD)Z` was the
second reason and I read it as the first. Worth telling them apart before
chasing either.

No bug report against `loops.rs` from this lane. What my rows want is a fact
about a *map value* and an *array element* -- that a `number` arriving from
`events.get(key) ?? 0` or `xs.at(-1)` is integral -- which is a different
analysis over a different domain, and naming it as "range analysis" made it
sound like work already done.

### A rule written for the only instance of a category is a rule about that instance

`SharedFieldGet` took three `VerifyError`s to land, and they are one finding
rather than three fixes.

`crossing_values` decides which slots get a declared verification type, and its
rule is **"a label sits between a definition and a read"**. That rule was
written for a comparison -- until this op, the only thing that puts a label
inside a block -- and a comparison pushes its result *after* its labels and reads
its operands *before* them. An `instanceof` chain does neither:

    Type top (locals[1])     the op was not in `puts_label` at all
    Type top (locals[1])     it is the label AND the write, and a value is
                             never "between" its own labels
    Type top (locals[14])    it reads the receiver once per arm, after each
                             `next` -- so the operand crosses too

So the rule is not *which ops put labels* but **which values are live across
one**, and this is the first op where those differ. The comment above
`crossing_values` says "the part that cost two attempts" about labels inside a
block; it cost two more, in the two places the category had never been tested.

**Nothing could have said so, which is the point.** A fact with two derivations
disagrees the moment both are exercised. A rule with one instance is never
contradicted -- it is simply never asked a second question -- so it reads as
correct for as long as the category has one member. `puts_label` was right about
comparisons and silently wrong about everything else, and the tree contained
nothing else.

Each of the three was found by reading the listing at the offset the verifier
named. Reasoning about which pass owned the slot would have found the first and
would not have separated the second from the third: they name the same local,
one line apart, for opposite reasons.

**Where else this shape is waiting.** Any predicate in this backend whose
`match` has one true arm and a `_ => false` is the same construction --
`scalar_form`, `cursor_helper`, `object_key_form` each name exactly one helper
today. None of them is wrong. Each is untested in the only way that matters.

### `cargo test --release` is the gate's test with the assertions removed

MainClaude shipped an `attempt to subtract with overflow` that four of their own
tests caught -- **in my gate, not theirs**. They had been running
`cargo test --release` all evening; the gate runs `cargo test --workspace`.
Release turns overflow checks **off**, so the subtraction wrapped to a number no
reservation matched, `find` answered `None`, and the answer was right by
accident.

**I had been running `--release` all session too**, for every one of these
sections. So the same blind spot was live on this lane and nothing here had
looked, which is the whole reason to write it down rather than note it.

Checked, and this lane is clean on that axis:

    cargo test, debug, my two crates          74 pass, 0 overflow
    185 examples through a debug compiler      0 panics
    60 bench cases emitted in debug            0 panics

**And the economy the habit was for does not exist.** A debug `nts check` of one
example is **0.5 seconds**; the whole example corpus through a debug compiler is
about fifteen. There was no cost being avoided -- `--release` was a reflex from
benchmarking, carried into a place where the only thing it removes is the
assertions.

The wider net is the point rather than the unit tests. Seventy-four tests cover
what someone thought to write; 185 examples and 60 cases run the emitter over
every construct the corpus has, with the checks live. That is the same argument
as dexing generated classes rather than the runtime jar, and it costs fifteen
seconds.

**Their precondition sentence is the one to keep**, and it is this file's own
lesson one level down: *a precondition nobody can violate is indistinguishable
from no precondition* -- until a caller arrives whose job is to violate it.
`generator_element` subtracted a frame base from a type id that every caller had
already established was a frame. `generator_element_of` asks it of any object
type, which is the whole point of it.

That is the same shape as `puts_label` being right about comparisons and
untested about everything else: a rule with one kind of caller has never been
asked a second question.

### The interface cliff is at three, it is per call site, and my first number was the cliff quoted as the function

I told MainClaude an interface was **3.5x** slower than an `instanceof` chain --
6,213ns against 1,759ns -- and shaped `SharedFieldGet` around it. That number is
correct and it is not the function. It is one point on a curve, measured at the
worst end, and I quoted it as though it were the whole shape.

Measured properly, a *nominal* interface known at compile time, varying only the
implementor count:

    direct field read       1092 ns/pass
    interface, 1 impl       1141 ns/pass     1.04x    free
    interface, 2 impls      1319 ns/pass     1.21x    cheap
    interface, 3 impls      3703 ns/pass     3.39x    the cliff

That is HotSpot's inline cache exactly: monomorphic is a guarded direct call,
bimorphic is two guards, three gives up to an itable walk. My `SharedFieldGet`
measurement was over three *unrelated* classes through a synthesised interface --
the third row -- and for that op the chain is still right, because a union's arms
are by construction more than one type at one site. What was wrong was carrying
the number to a different question.

### And the cliff is per call site, not per interface

    site that sees 1 of 4 implementors     1105 ns/pass
    site that sees all 4                   6519 ns/pass

Four implementors live in the program, and the site that sees one is on the
direct-read row. **The inline cache is attached to the site, not to the type**,
so an interface's population never enters the cost unless a single site actually
sees three or more arrive.

That refuted the statistic I had just handed over. "How many classes implement
this" decides nothing; "how many concrete types arrive at this site" decides
everything. MainClaude then measured the real one across six modules: **63 sites,
63 distinct (site, type) pairs, not one polymorphic** -- so on that corpus an
interface and a specialised copy are both on the top row and the curve does not
choose between them.

### Every number in that exchange is HotSpot, in a goal about Android

Worth stating plainly because it is this file's own thesis pointed at its own
work: **"C2 handles it, therefore it is free" does not transfer, and ART has no
C2.** An inline cache is precisely the mechanism the premise distrusts, and I
produced four figures resting on one without saying so until the end.

The half that survives any runtime is specialisation, because a monomorphic call
needs no cache to be fast. The interface figures are unmeasured on the runtime
this lane exists for, and should not be quoted as 1.04x until they are.

### ART has no cliff and no free case: the dispatch curve is flat at 2x

I said the interface figures were unmeasured on the runtime this lane exists for
and should not be quoted until they were. Measured:

    HotSpot                        ART (emulator, x86_64)
    direct field read   1092       direct field read   1085
    interface, 1 impl   1141  1.04x   interface, 1 impl   2134  1.97x
    interface, 2 impls  1319  1.21x   interface, 2 impls  2116  1.95x
    interface, 3 impls  3703  3.39x   interface, 3 impls  2045  1.89x

**Two different shapes, and both halves of the HotSpot result fail to transfer.**
There is no cliff at three -- the ART curve is flat -- and, more importantly,
**monomorphic dispatch is not free**: the case I called 1.04x and described as
"free" costs 1.97x here.

That is the inversion this goal exists to catch, in the cleanest form it has
taken. An inline cache makes the common case free and the uncommon case
expensive; with no inline cache every case costs the same, and the one that was
free is the one that loses most.

**So the reasoning behind a decision made this evening was HotSpot-only, even
though the decision was right.** "All 63 sites are monomorphic, so an interface
and a specialised copy are both on the top row" holds on HotSpot and not here: on
ART those 63 sites would each pay ~2x, because there is no top row to be on.
Specialisation removes the dispatch rather than making it predictable, which is
worth nothing on HotSpot at a monomorphic site and worth about half the call on
ART.

**What this is and is not.** It is a *mechanism* measurement -- flat against
cliffed, and whether the monomorphic case is special -- and a mechanism survives
emulation in a way a figure does not. It is **not** a phone's numbers: this is an
x86_64 emulator, the absolute nanoseconds are this machine's, and a phone is
arm64 with a different AOT profile.

The alternative reading worth stating is that `dalvikvm` on a profile-less dex
might simply not be optimising, which would flatten everything. Against that: the
direct field read is **1085 against HotSpot's 1092**, so the field loop is
compiled and fast. It is the dispatch that costs, uniformly, which is what a
vtable-and-itable walk with no caching looks like.

### `invokevirtual` is the same story, and it is this lane's own closure path

Every closure call this backend emits is `invokevirtual` on an abstract `Fn$`
base. So the interface finding above is only interesting if it stops at
interfaces -- it does not:

    HotSpot                          ART (emulator, x86_64)
    field read              1056     field read              1058
    virtual, 1 subclass     1079     virtual, 1 subclass     2178   2.06x
    virtual, 3 subclasses   4314     virtual, 3 subclasses   1985   1.88x
    interface, 1 impl       1230     interface, 1 impl       2162   2.04x

Same two shapes. On HotSpot a monomorphic virtual call is **free** (1.02x) and
three subclasses is a **4.08x cliff**; on ART every dispatch costs about 2x and
the count does not matter. `invokevirtual` and `invokeinterface` are one
mechanism on each runtime, and a different mechanism between them.

**What saves this lane is something the emitter already does.** With one closure
per signature it devirtualises -- `invokestatic Closure0$call` rather than
`invokevirtual Fn2__2.call` -- so a monomorphic closure site is a static call and
pays nothing on either runtime. The 2x is paid only where a site is genuinely
polymorphic, which is where it cannot be avoided without specialising the caller.

**And it explains a row this file has already given up on.** `dispatch` is the
row whose six runs "land in two places", which neither P-core pinning nor 13x the
warmup moved, and which the table records as **0.67x-1.14x, not a number**. The
plan's reason for expecting a win there was "C2's profile-guided bimorphic
inlining turns a two-implementation site into two guarded direct calls where the
native lane emits a vtable indirect".

I wrote here that two modes is what that mechanism looks like from outside, and
made it falsifiable: **on ART there is no such fork, so `dispatch` should be
unimodal there.** The consequence held and the mechanism did not.

The consequence, eight runs (`nts` half, then `ref` half):

    HotSpot   17814  18086  28356  28447  28508  28809  31857  33958   spread 1.91x
    ART       40443  40487  40512  40601  40616  40656  40666  40680   spread 1.006x
    reference, HotSpot   28035 .. 28809                               spread 1.027x
    reference, ART       38839 .. 39669                               spread 1.021x

So the row is unimodal on ART to **0.6%**, and 1.02x-1.05x eight times, which
makes it quotable there for the first time. On HotSpot it is not bimodal, it is
**trimodal** -- two runs near 17.9us, four near 28.5us, two near 32.9us -- and
the whole of that spread is in *our* half, against a reference stable to 2.7%
in the same eight runs.

**And the mechanism is refused by the artefact.** `javap -c -p nts.gen.Program`
on this case reports **zero `invokevirtual` and zero `invokeinterface`**; the
only `invoke` in the emitted program is the `<init>`'s `invokespecial`. There is
no dispatch site in what this lane emits for `dispatch`, so nothing C2 could
bimorphically inline, so profile-guided bimorphic inlining cannot be what varies.
I had the instruction mix a `javap` away and reasoned from the case's *name* and
from a curve I had measured an hour earlier, which fitted the evidence and was
about a different program.

What survives is the measurement and not the reason: the variance is C2's, it is
entirely in this lane's half, and ART has none of it. What it actually is remains
open -- `-XX:+PrintInlining` across repeated runs would name it, and the emitted
switch is a branch chain rather than a `tableswitch`, which is worth pricing
separately and is not a variance explanation.

What is certain either way, and was the point: whatever `dispatch` scores on
HotSpot, the reason this file offered for it is a C2 reason, on a lane that
exists for a runtime without C2.

The plan predicted exactly this, for a different property: "on ART, where escape
analysis is much weaker, it simply loses that". It is the same sentence about
inline caching rather than escape analysis, and it has now been measured rather
than predicted.

**I am not re-ranking any row on emulator timings.** Absolute nanoseconds here
are not a phone's, and the row table is HotSpot by construction. What is now
known is the *mechanism*, and a mechanism is enough to say which explanations
travel: an allocation C2 removes, an inline cache C2 keeps, and a devirtualised
static call. The first two are HotSpot's; the third is ours and survives.

## Bar 1 on ART: 51 rows, and the lane loses the bar by going to Android

`sh tooling/android/times-on-device.sh`, from a tree pinned at `ea3be8f5`
(the eight `awfy-*` rows at `95599899`), against a compiler frozen by md5
before and after. Every case with a `ref.java` -- 51 of the 60.

**The instrument is its own control and the control is why this is worth
reading.** Each case is measured four times: the compiled program and
`ref.java`, each on HotSpot and on ART, through one harness. The HotSpot pair
has an independently published value in the row table above, measured by
`tooling/bench` through a different code path. It reproduces on **35 of the 40
rows that have one, within 0.10, and 30 of those within 0.05.**

Five do not, and their ART numbers are marked `*` below and are not certified
by anything: `awfy-sieve` (+0.38, and the table already calls that row bimodal),
`node-utf8` (-0.30), `symbol-keyed-map` (-0.28), `array-predicates` (-0.12),
`objects` (-0.12). Four of the five moved *toward* 1.00, which is what a busy
machine does to a ratio -- both halves slow and the fraction compresses -- and
the machine was not quiet: a peer was building node addons throughout. I took
the lock, which stops another *measurement*, and it does not stop a build.

**Why an emulator's nanoseconds are allowed to mean anything.** They are not,
and none are quoted as a time. Bar 1 is jvm over Java: two programs, one
runtime, one harness, one process launch apart, so what the emulator adds it
adds to both halves. The ART times below are uniformly smaller than the HotSpot
ones -- `fib` at 362us against 505us -- which is not ART beating HotSpot at
recursive arithmetic and is a virtualised clock. It cancels.

### Bar 1 on ART: the eight rows the bar names

| case | HotSpot | ART | moved |
| --- | --- | --- | --- |
| `awfy-list` | 0.94x | **0.82x** | -0.12 |
| `awfy-mandelbrot` | 0.83x | **0.89x** | +0.06 |
| `awfy-permute` | 0.71x | **1.04x** | +0.33 |
| `awfy-sieve` * | 1.32x | **1.14x** | -0.18 |
| `awfy-bounce` | 0.96x | **1.15x** | +0.19 |
| `awfy-nbody` | 1.00x | **1.19x** | +0.19 |
| `awfy-towers` | 1.03x | **1.64x** | +0.61 |
| `awfy-queens` | 1.25x | **1.98x** | +0.73 |

### Rows that got worse on ART

| case | HotSpot | ART | moved |
| --- | --- | --- | --- |
| `closure-merge` | 1.02x | **3.33x** | +2.31 |
| `erasure-stored-unknown` | 0.91x | **2.33x** | +1.42 |
| `dispatch` | 0.62x | **1.03x** | +0.41 |
| `bytes` | 1.10x | **1.50x** | +0.40 |
| `map-and-set` | 0.82x | **1.15x** | +0.33 |
| `erasure-typed` | 1.00x | **1.32x** | +0.32 |
| `fib` | 1.03x | **1.34x** | +0.31 |
| `loop` | 0.75x | **0.95x** | +0.20 |
| `logical-assignment` | 0.93x | **1.12x** | +0.19 |
| `optional-chain` | 1.26x | **1.45x** | +0.19 |
| `closures` | 0.84x | **1.01x** | +0.17 |
| `arrays` | 1.03x | **1.19x** | +0.16 |

### Rows that got better on ART

| case | HotSpot | ART | moved |
| --- | --- | --- | --- |
| `node-utf8` * | 6.23x | **2.82x** | -3.41 |
| `generic-classes` | 1.13x | **0.12x** | -1.01 |
| `objects` * | 0.87x | **0.15x** | -0.72 |
| `erasure-unknown` | 1.00x | **0.43x** | -0.57 |
| `symbol-keyed-map` * | 2.59x | **2.08x** | -0.51 |
| `number-format-double` | 0.92x | **0.44x** | -0.48 |
| `array-from` | 1.04x | **0.78x** | -0.26 |
| `number-format` | 0.99x | **0.77x** | -0.22 |
| `substrings` | 0.39x | **0.19x** | -0.20 |
| `user-iterable` | 0.94x | **0.77x** | -0.17 |
| `generator` | 1.00x | **0.84x** | -0.16 |

### Rows ART did not move (20 of them, inside 0.15)

    instanceof 0.97x  elementwise 0.87x  module-closures 0.96x  bigint 0.06x  symbol-keys 0.95x  case-convert 0.94x  in-narrowing 0.99x  strings 0.97x  erasure-stored-typed 0.97x
    pipeline 0.99x  absences 1.25x  exceptions 0.00x  accumulate 1.00x  checksum 1.00x  growth-fixed 1.01x  array-mutations 0.69x  growth-grown 1.06x  array-methods 1.26x
    upcast 1.12x  array-predicates 1.74x

**The verdict on bar 1.** On HotSpot five of the eight are at or under 1.00x. On
ART **two** are. `awfy-queens` goes 1.25x to 1.98x and `awfy-towers` 1.03x to
1.64x -- both more than double their gap. The bar is not met on Android, and the
honest way to say it is that *taking this lane to Android costs bar 1*, on the
eight rows the bar is written about.

### What the survey refuted, and it was two of the three

Predictions were written before the numbers were read
(`scratchpad/prediction.md`), which is the only reason this paragraph can be
written at all.

**Refuted: "a row whose gap is codegen is runtime-independent."** Four rows in
the table above are attributed to the same residual, `uirem` over an `l2i`
counter. They do not move together:

    absences        1.26x -> 1.25x   -0.01
    instanceof      1.10x -> 0.97x   -0.13
    optional-chain  1.26x -> 1.45x   +0.19
    bytes           1.10x -> 1.50x   +0.40

A single named cause predicts a single behaviour, and these four span 0.41. So
either the attribution is too coarse -- more than one thing is being called the
`uirem` residual -- or an unsigned remainder costs differently on ART, which is
checkable and has not been checked. Either way the four rows are not one row.

**Refuted: "a row this lane wins because C2 does something loses it on ART."**
Five rows obeyed it -- `dispatch` 0.62 to 1.03, `map-and-set` 0.82 to 1.15,
`closures` 0.84 to 1.01, `loop` 0.75 to 0.95, `logical-assignment` 0.93 to 1.12.
**`substrings` did the opposite**, 0.39x to **0.19x**: the win doubled. That win
is therefore not C2's. It is `hir::substring::elide` declining to build a
substring whose every use asks for its length or a character, plus
`java.lang.String` being immutable so there is nothing to copy -- both of them
ours, and both travel.

**Held: "a row this lane wins because the *reference* allocates wins by more on
ART."** `bigint` 0.16 to 0.06 against a `BigInteger`; `generic-classes` 1.13 to
**0.12**; `objects` 0.87 to 0.15; `number-format-double` 0.92 to 0.44 against
`Double.toString`; `array-from` 1.04 to 0.78. ART charges more for an allocation
and has no escape analysis to take it back, so every reference that allocates
pays, and this compiler's whole-program knowledge is worth more there than here.

### The two rows that are ours, and they are one shape

Everything above is the platform. Two rows are not:

    closure-merge           1.02x -> 3.33x
    erasure-stored-unknown  0.91x -> 2.33x

`closure-merge` is the row this lane's own closure path is about. Every closure
call this backend emits is `invokevirtual` on an abstract `Fn$` base, and this
case is deliberately bimorphic -- two lambdas reaching one site. **But so is the
reference**, whose `IntFn` lambdas d8 desugars into two classes reaching one
`invokeinterface`. Both halves are bimorphic, so ART's flat 2x falls on both and
cannot by itself be a 3.33x. Something else in our half costs 3x on a runtime
without escape analysis, and the instrument that separates allocation from
dispatch already exists: `bytes-on-device.sh` against `ref-bytes-on-device.sh`,
which is how the three allocation fixes above were found. That is the next
measurement and it is not yet made.

`erasure-stored-unknown` is the plan's least-confident question arriving with a
number. The four `erasure-*` rows split cleanly:

    erasure-stored-typed    0.99x -> 0.97x
    erasure-unknown         1.00x -> 0.43x
    erasure-typed           1.00x -> 1.32x
    erasure-stored-unknown  0.91x -> 2.33x

Three of the four are fine or better and one is 2.33x, which is the shape of a
representation that is free until it is *stored* and *unknown* at once. The plan
predicted the reason before any of this existed -- an `NtsValue` merged at a
control-flow join is not scalar-replaced even on HotSpot, and ART does not
scalar-replace at all -- and named the answer, which is to decompose rather than
box. This is the first number that argues for building it.

### `closure-merge` is the `(D)D` closure ABI, and it is 2.6x on ART and free here

Three things it is not, each killed by an instrument rather than by argument.

**Not allocation.** `bytes-on-device.sh` against `ref-bytes-on-device.sh`:

    closure-merge           ours 128 B/op    reference 128 B/op    on ART
    erasure-stored-unknown  ours 16,384      reference 40,016

To the byte on the first, and on the second this lane allocates **less than half**
what the reference does and is still 2.33x slower. The allocation axis is closed
on both rows and it was the first thing I reached for.

**Not the trampoline.** `javap` says every closure call is two hops: the
`invokevirtual Fn3__3.call` lands on a subclass whose entire body is
`invokestatic Program.Closure0$call`. A six-byte method C2 inlines for free and
ART might not, which is a good hypothesis and is wrong. Same shape both ways, one
process each: HotSpot 0.301/0.317/0.500 against 0.301/0.509/0.493, ART
0.585/0.652/0.609 against 0.604/0.662/0.608. Nothing, on either.

*(The first version of that probe measured both shapes in one JVM and reported
the trampoline as three times **faster**, which is not a thing a trampoline can
be. `drive` is one call site; by the time it reached the second shape it had seen
four implementations and was megamorphic, while the first was measured at two. It
was comparing inline-cache states and calling it a trampoline. One process per
shape makes that unavailable rather than remembered.)*

**It is the signature.** `Closure0$call` is `(Lnts/gen/Closure0;D)D` and its body
is entirely `int`: `d2i`, the arithmetic, `i2d`. The call site does `i2d` before
and `d2i` after. **Five conversions a call around an int computation the
hand-written Java does with none** -- and `d2i` is computed *twice* on the same
`dload_1`, at offsets 6 and 17.

Priced apart, because "the conversions" would have said which to build without
saying which is worth it. One process per shape, three runs:

    shape                              HotSpot                ART
    A  ours: (D)D, d2i twice      0.302 0.287 0.293     1.535 1.545 1.535
    C  (D)D, d2i once             0.298 0.291 0.296     1.472 1.475 1.541
    B  reference: (I)I            0.291 0.285 0.310     0.589 0.568 0.578

**On HotSpot the three are one number.** That is the control, and this file
independently says so two hundred lines up: the `(D)D` closure ABI is "real in the
bytecode and free at runtime". It still is -- here.

On ART, A over B is **2.66x**. And the split is not where the bytecode's ugliness
is: removing the duplicated `d2i` is worth **2.5%**, and the signature is worth
**2.59x**. The redundancy I would have fixed first, because it is visibly wrong in
a listing, is a rounding error; the thing that reads as a type-system necessity is
the whole cost.

That accounts for `closure-merge`'s 1.02x to 3.33x almost exactly, and it is the
same cause under `closures` (0.84x to 1.01x), which is smaller only because a
monomorphic closure devirtualises to `invokestatic` -- and still converts, because
devirtualising changes who is called and not what the signature is.

**The fix is a design this lane already has, one level away.** `specialize_numbers`
proves int-exactness whole-program and emits `work$whole:(I)I` in this very
program. Closures are excluded structurally rather than deliberately: every
closure of a TypeScript function type extends one `Fn$` base, and that base
declares `call(D)D`, so no single closure can narrow without the base narrowing.
A per-specialisation base -- `Fn3__3$I` with `call(I)I`, chosen when every closure
merged at a site and every call site are int-exact -- is the shape, and it is
entirely inside `compiler/codegen/jvm`.

It is not built and it is not free: it is a second base class per specialised
descriptor, and `same_shape` merging function-type layouts is the reason one base
exists at all. What is now known is what it is worth, on the runtime this lane is
being taken to, and that the obvious cheaper fix beside it is worth 2.5%.

### And it reaches four rows, none of them a bar 1 row, so it is not next

The fix above is worth 2.6x on the calls it touches. Before building it, how many
calls are there? Every case in the corpus, emitted, counting `Fn*` bases whose
`call` is `abstract double call(double)` and closure bodies that narrow their
parameter and widen their result:

    case               Fn$ bases   int-exact closure bodies
    closure-merge              1                          2
    closures                   0                          1
    module-closures            0                          2
    optional-chain             0                          1
    json-stringify-doc         0                          0
    -- and 55 cases with no closure at all

**One case in sixty emits a closure base.** The other three have int-exact
closure bodies and no base, because a monomorphic closure devirtualises to
`invokestatic Closure0$call` -- which still carries the `(D)D` and still converts,
so the signature cost is theirs too, but the *base class* half of the fix has
nothing to do there.

So the reach is four rows of fifty-one: `closure-merge` 3.33x, `optional-chain`
1.45x, `closures` 1.01x, `module-closures` 0.96x. **And none of the eight
`awfy-*` rows emits a closure at all**, so the entire change moves bar 1 by
nothing.

That is the rule this file keeps relearning -- rank by what clears, not by
reach -- arriving one step before a multi-hour change rather than after. The
measurement that justified it is right and the change is still real: one row is
badly broken and the fix is known and priced. It goes in the queue below its
size, not at the top of it, and the thing bar 1 is actually about is the eight
rows that have no closures in them.

### The store/load round trip is 7.8% on ART and 0% here, which answers the plan and is not the lever

The plan says of slot traffic: this backend gives every HIR value its own slot
and routes every result through it, C2 removes it exactly as `mem2reg` does for
the C lane, and coalescing is **"justified only if a profile disagrees"**. That
was decided on HotSpot. ART is a profile that might disagree, and it is worth
knowing by how much before believing either answer.

What is actually emitted, for `closure-merge`'s `Closure0$call` -- twelve slots
for a three-value computation:

    d2i; istore 4          the parameter, narrowed
    iload 4; imul; istore 5
    dload_1; d2i; istore 6     <-- the SAME d2i again, on the same dload_1
    iload 6; iushr; istore 7
    iload 5; istore 8          <-- a pure copy
    iload 8; iload 7; ixor; istore 9
    iload 9; iload_3; iadd; istore 10
    iload 10; istore 11        <-- a pure copy
    iload 11; i2d; dstore 12; dload 12; dreturn

Transcribed to Java -- **and checked rather than assumed**, because a previous
attempt at exactly this priced javac's compilation of a transcription instead of
the bytecode it claimed to be. `javap` on the transcription: 18 `iload`/`istore`
against the tight form's none, the duplicated `d2i` present, both pure copies
present. javac does not optimise, which is what makes a source transcription
usable here; one declared local is one slot.

One shape per process from the first line, three runs each:

    shape                                    HotSpot                ART
    A  one slot per intermediate    0.488 0.490 0.492     1.057 1.056 1.057
    B  nothing redundant            0.498 0.507 0.496     0.969 0.971 1.002

**HotSpot: nothing**, and A is marginally the faster of the two, which is the
size of the noise. C2 removes the whole of it, as the plan says and as record
0004 measured for the C lane.

**ART: 7.8%.** So the profile disagrees -- but **not by this much, and not for
this reason**. This arm carried a duplicated `d2i` as well as its extra slots, so
it did more work and not merely more slot moves. Re-measured below with the
conversion held equal, slot traffic alone is **1.4%**, and the duplicated
conversion alone is the 2.5% measured separately. Read the 1.4%; this number is
two things added together.

**And it is not the lever.** `awfy-queens` is 1.98x on ART. Nothing that buys
7.8% closes that, and the 7.8% is measured on a body chosen for being unusually
redundant. It goes in the same place as the duplicated `d2i` it contains.

### Three fixes priced tonight and none of them built

    the duplicated `d2i`                2.5% on ART, 0% on HotSpot
    the `(D)D` closure signature        2.6x -- on four rows of 51, none of them a bar 1 row
    slot coalescing                     7.8% on ART, 0% on HotSpot

Each was reached for as *the* explanation of a row, and each is real. None of
them is what `awfy-queens` and `awfy-towers` are, and those are what the bar is
about. The AWFY gaps are now known not to be allocation -- our bytes/op are flat
across the two runtimes on all eight -- and not to be slot traffic, and their
cause is unfound, which is where `awfy-queens` already stood on HotSpot after six
hypotheses. What is new is that ART doubles it, so whatever it is has become
twice as visible.

### The eight AWFY rows on the allocation axis: bar 3 holds, and two rows stand out

| case | ours, HotSpot | ours, ART | reference, ART | ours/ref |
| --- | --- | --- | --- | --- |
| `awfy-queens` | 1712 | 1704 | 1384 | **1.23x** |
| `awfy-towers` | 392 | 272 | 280 | 0.97x |
| `awfy-nbody` | 504 | 424 | 376 | 1.13x |
| `awfy-bounce` | 3616 | 2840 | 2856 | 0.99x |
| `awfy-permute` | 88 | 88 | 72 | **1.22x** |
| `awfy-list` | 760 | 504 | 504 | 1.00x |
| `awfy-mandelbrot` | 16 | 8 | -- | -- |
| `awfy-sieve` | 5016 | 5024 | -- | -- |

**Bar 3 holds on all eight**: bytes/op on ART is never worse than on HotSpot, and
on five of them it is lower. Nothing here is a regression going to Android.

The two references not measured were **stopped rather than failed**, and it is
worth saying which: `awfy-mandelbrot` is 22 ms an operation, so `RefBytes`'s
twenty-thousand-iteration warmup is about nine minutes on ART *per attempt*, and
the counter's halve-and-retry repeats the warmup each time. Our own figure for it
is 8 bytes an operation against 16 on HotSpot, so there was no question there
worth half an hour of emulator.

**And the two rows that allocate more are the same two rows, by the same cause.**
`awfy-queens` and `awfy-permute` are the only AWFY cases whose emitted program
contains `newarray double` where the reference has `newarray int`:

    case              ours                      reference
    awfy-queens       3 boolean, 1 double       3 boolean, 1 int
    awfy-permute      1 double                  1 int
    awfy-towers       1 TowersDisk              1 anewarray
    awfy-bounce       1 Ball                    1 anewarray
    awfy-sieve        1 boolean                 1 boolean

A `double[8]` against an `int[8]` is the 1.2x, and `awfy-queens` is the worst bar
1 row on ART at **1.98x**. The timing consequence is priced in the next section;
the cause is below and it is one missing table row.

### `queenRows` is `[f64]` because the storage analysis gives up when an array crosses into the runtime

`benches/cases/awfy-queens/case.ts` declares `queenRows: number[] | null` and
builds it with `new Array(8).fill(-1)`. AWFY's own Java declares
`private int[] queenRows`. The prepared IR:

    %2  = array.new %1 : managed<[bool]>
    %4  = call.extern nts_array_fill_bool(%2, %3) : managed<[bool]>
    %7  = array.new %6 : managed<[bool]>
    %9  = call.extern nts_array_fill_bool(%7, %8) : managed<[bool]>
    %12 = array.new %11 : managed<[bool]>
    %14 = call.extern nts_array_fill_bool(%12, %13) : managed<[bool]>
    %17 = array.new %16 : managed<[f64]>
    %20 = call.extern nts_array_fill(%17, %19) : managed<[f64]>     <-- queenRows

Three of the four arrays narrow and the fourth does not, and `elements.rs` says
why in its own words: an array "handed to a runtime helper is stored the way that
helper was compiled to expect", which is "a limit on the storage rather than on
the contents". `hir::runtime`'s table has exactly **two** fill entry points:

    ("nts_array_fill",      &[None, Some(HirType::Float { bits: 64 })], None)
    ("nts_array_fill_bool", &[None, Some(HirType::Bool)],               None)

So the narrow variant exists for `bool` and the whole mechanism works there. It
does not exist for `i32`.

**And adding it would change nothing, which is a correction to the paragraph
above rather than a footnote to it.** `elements.rs::representations` filters
narrowable element types through `borrowed` -- **any array passed to any external
call** -- so `queenRows` is not blocked because the fill helper takes an `f64`.
It is blocked because it is handed to a helper *at all*. An `_i32` entry point
leaves it in `borrowed` and leaves it `f64`.

The file names the reason the obvious narrowing was refused, in advance:

> The test is deliberately the crude one: *any* external call taking the array. A
> narrower rule would have to say which helpers read elements and at what width,
> **which is a second, unchecked copy of the runtime's signatures** -- and the
> failure mode of getting it wrong is silently wrong output rather than a compile
> error.

There is a route and it is that hazard avoided rather than accepted: `hir::runtime`'s
table *is* the compiler's single copy of those signatures --
`("nts_array_fill", &[None, Some(Float{64})], None)` already states the width --
so the narrower rule can **read** the table instead of restating it. A helper
constrains an array's element width to what the table says it takes; a helper the
table does not describe keeps today's blanket block. Every array-taking helper
then needs its element expectation stated, and getting one wrong becomes a table
mismatch rather than silent corruption.

That is a change to the analysis every array in every program goes through, for
9.1% on two of eight rows, and it is the compiler lane's. It is **open with a
route**, not a missing table row -- I said "smaller and more local than I
implied" when handing it over and the opposite is true.

**This is not mine to land.** `hir::runtime` is the single answer about
conversions and `runtime/c` is the other lane's. What is mine is the JVM half,
which is one line beside the two that are already there:

    public static int[] arrayFillInt(int[] a, int v) { Arrays.fill(a, v); return a; }
    public static boolean[] arrayFillBool(boolean[] a, boolean v) { ... }   // exists
    public static Object[] arrayFillRef(Object[] a, Object v) { ... }       // exists

Reach: **two of the eight AWFY rows**, and one of them is the worst.

### And the element type is worth 9.1% on ART, which is a fourth thing that is not the lever

Priced on AWFY's own `Queens`, with `queenRows` changed from `int[]` to
`double[]` and **nothing else** -- the conversions a `managed<[f64]>` forces,
around their own algorithm. `javap` diff of the two classes: `[I` becomes `[D`,
`Arrays.fill(int[],int)` becomes `Arrays.fill(double[],double)`, the store gains
its widening, and there is no other difference. One shape per process.

    shape                        HotSpot                    ART
    I  AWFY's int[]      8898.0 8894.2 8933.7    10001.8 9928.2 9876.9
    D  the same, double[] 9250.1 9228.6 9190.4    10820.3 10869.1 10826.8

    D over I                     1.035x                   1.091x

**9.1% on ART and 3.5% on HotSpot.** The row is **1.98x** on ART and 1.23x on
HotSpot, so the element type is about a tenth of the ART gap and about a seventh
of the HotSpot one. It is the largest single named cause this row has, it is
real on both runtimes, and it is not what `awfy-queens` is.

*What this probe is not.* It drops `Benchmark`'s `Object benchmark()` for a
`boolean` one in **both** arms, which removes an autobox per call that the real
reference pays. So the absolute nanoseconds here are not `ref.java`'s -- ours read
~9.9us against a measured reference of 26.1us -- and nothing but the I-over-D
ratio is claimed from them. Both arms carry the identical modification, which is
what makes that ratio the element type and not the harness.

### Four mechanisms priced, four that are not it

    the duplicated `d2i`             2.5% on ART,  0% on HotSpot
    slot coalescing                  7.8% on ART,  0% on HotSpot
    the `[f64]` element type          9.1% on ART, 3.5% on HotSpot -- 2 of 8 AWFY rows
    the `(D)D` closure signature      2.6x        , 0% on HotSpot -- 0 of 8 AWFY rows

Every one of these was reached for as the explanation of a row, every one is a
real number on the runtime this lane is being taken to, and not one of them is
what the bar is failing on. Compounded and assuming they do not overlap, the
three that touch `awfy-queens` are about 20%, against a gap of 98%.

That is worth stating plainly rather than filing as four small wins: **the ART
bar 1 gap is not the sum of the things that look like it.** `awfy-queens` had no
cause found on HotSpot after six hypotheses and it still has none; what ART
bought is that the gap is now twice as large while the four candidates are still
small, which is evidence about them rather than about it.

### `widen` does not invert on ART. It is worth more there, and I expected the opposite

`awfy-towers` emits `movesDone` as a `double` where AWFY's Java declares
`private int movesDone`, and it is the counter incremented once per disk move --
the innermost operation of the benchmark. `getfield D; dconst_1; dadd; putfield D`
against the reference's `getfield I; iconst_1; iadd; putfield I`.

That reads as a defect and is a **decision of this backend**. `widen.rs` holds an
integer field as a double on purpose: a JVM local is a slot, `dadd` and `iadd`
cost the same, and the only thing an `i32` buys is an `i2d` at every use that
wants a number. Its own doc prices it at **3.41x in its favour** on `generator`.

On HotSpot. ART has no C2 and much weaker floating point relative to integer, so
the obvious question is whether a pass built and priced on one runtime survives
the other. AWFY's own Towers with `movesDone` the only thing changed:

    shape                     HotSpot                        ART
    I  int movesDone    19023.8 19475.1 21642.9    29514.3 28979.9 28705.5
    D  double           20325.7 20390.0 20243.8    25659.5 25718.6 25549.2

**On ART the double is 11.0% faster**, comparing minima. Both arms are tight
there -- 2.8% and 0.7% -- so that is outside either one's spread and is the
answer: `widen` is not merely safe on Android, it is worth more there than here.

**The HotSpot column is not claimed.** Minima give the double 6.4% worse, which
would be a small argument against the pass on this field -- but the `I` arm's own
three runs span **13.8%** while the `D` arm's span 0.7%, so a 6.4% gap between
them is inside the noisier arm and I am not reading it. What can be said is that
the pass is not *helping* here, and its doc does not claim it would: `generator`'s
counter feeds a loop whose bound and product are doubles, and `movesDone` feeds
one `i2d` at the `return`, once per 8,191 increments.

That is `widen` behaving exactly as designed -- the equivalence class is real,
`benchmark()` returns `number`, so the field is genuinely read as a double -- on
a program where the trade it makes is worth almost nothing. Being worth almost
nothing and being wrong are different, and only the first is measured.

**So this is a fifth mechanism examined and the first whose answer is "change
nothing".** I went looking for a decision of my own that Android would reverse,
because that is the kind of thing this goal exists to find, and the measurement
said the decision is better on Android than on the runtime it was made for. The
hypothesis is retired rather than pending.

`awfy-towers` at 1.64x is therefore still unexplained.

**And the candidate I reached for next was an instrument reading the wrong
program.** I said its remaining difference was `TowersDisk.size` --
`Float { bits: 64 }` against the reference's `private final int size` -- from
`nts layouts`. The emitted class declares **`public int size;`**. `nts layouts`
prints the *declared* layout type; this backend narrows a field from its uses,
and the prepared IR agrees with the class file rather than with the layout
print: `func TowersDisk#constructor(this, size: i32)`, storing an `i32`.

Checked on the other two rows the same survey flagged: `awfy-list`'s
`Element.val` is `Float { bits: 64 }` in the layout and **`public int val;`** in
the class, so that one was wrong too. `awfy-nbody`'s `Body.x`, `.y`, `.z`, `.vx`
are `Float { bits: 64 }` in both, correctly -- they are physics doubles. Two of
three flagged rows were the instrument.

So the "never narrowed" half of that survey is withdrawn and only the "widened"
half stands, which was checked against the class file rather than the layout.
**The class file is the artefact; `nts layouts` is a different question wearing
similar words.** Read against it rather than through it -- which is the rule I
had already applied to `dispatch` tonight and did not apply here.

One thing worth keeping from being wrong: this backend **does** already narrow a
field from its uses. The machinery I was about to propose exists, which changes
what `queenRows` needs -- that one is blocked on the *storage* following a
runtime helper's signature, not on the analysis being absent.

### The dex ratchet, made to fail on purpose

0295 says a ratchet owes itself a way to go red, so `dexes.sh` was run over the
whole corpus against an impossible floor:

    sabotage worked, exit 1 -- the ratchet goes red. It said:
    4382 method(s) across them
    only 4382 method(s) dexed, against a floor of 999999
    with the expected 1 decline(s), so every target compiled and
    the programs themselves are smaller: functions are being pruned before
    the backend sees them, which is what made this step green over a
    skeleton -- record 0295

The exit status, the count, and the right one of the two branches. This is the
first thing in this lane that has been *shown* to fail rather than trusted to.

### The two worst bar 1 rows, method by method: over half of what we emit is slot traffic

Five mechanisms guessed and none of them the lever, so: stop guessing. The
obvious instrument is a profile, and it is **not available here** -- `simpleperf`
is on the device but the emulator exposes no PMU (`Event type 'cpu-cycles' is not
supported`), only software events, and `cpu-clock` sampling of `dalvikvm`
attributes every JIT frame to `unknown[+42a02435]` because the JIT code cache has
no symbols. `dex2oat` would give symbolized AOT code and is not executable from
the shell user. That is worth writing down rather than leaving as a gap somebody
else re-attempts: **there is no method-level profile of this lane on this
emulator.**

What there is, is the bytecode, and a fair comparison is per method over the
methods *both* sides have -- not the whole-class totals, which compare our
flattened `Program` against two reference classes and said `awfy-nbody` has
16.33x the instructions, which is scope mismatch rather than a finding.

    awfy-queens   hot methods   ours 205 instructions   reference 125   1.64x
                                58% load/store          36%
    awfy-towers   hot methods   ours 212                reference  95   2.23x
                                56% load/store          45%

Per method, and the pattern is the same one twice:

    getRowColumn    55 vs 25   2.20x    istore 13/0  iload 10/0
                                        baload 3/3  getfield 3/3  iadd 2/2
    pushDisk        93 vs 26   3.58x    istore 13/0  aload 12/0  iload 8/0  astore 8/0
                                        aload_1 3/3  iload_2 2/2
    placeQueen      66 vs 42   1.57x    istore 6/0  iload 5/0
    popDiskFrom     61 vs 23   2.65x

**The real work is identical and the difference is entirely the round trip.**
`baload` three against three, `getfield` three against three, `iadd` two against
two -- and then thirteen stores against none. `getRowColumn` is the innermost
function of Queens, called for every row of every placement; `pushDisk` is called
on every one of Towers' 8,191 moves.

**And this is the fix I dismissed at 7.8% four hours ago.** That number was
measured on a body whose real work was a multiply, a shift, an xor and an add --
expensive operations, against which eighteen slot moves are a small share. Here
the real work is three array loads and two adds. **A percentage measured on one
body is not a property of the transformation**, and I treated it as one, which is
the same error as pricing a fix by its reach on one row.

### What a stack peephole would actually reach: 19% and 8%, not the 58%

Reach before building, which is the thing this file keeps relearning. The cheap
version of the fix is a peephole: a value whose single use is the very next
operation, and which is that operation's *first* operand, can stay on the operand
stack instead of being stored and reloaded. That touches neither the slot table
nor the frames -- the stack is still empty at every block boundary and every local
still has one type -- so it does **not** pay the price `body.rs`'s header declines:

> Reusing slots by live range is an optimization whose price is per-block frames

Slot reuse would pay that. The round trip does not, and the two are different
optimizations that the header's sentence is easy to read as one.

Counted in the emitted bytecode, as adjacent `Xstore n` / `Xload n` on one slot:

    Queens$getRowColumn     55 instr   37 slot-ops    7 pairs  (14 instr)
    Queens$placeQueen       66          36            5        (10)
    Queens$setRowColumn     34          23            2         (4)
    Queens$queens           50          23            5        (10)
    awfy-queens                                      38 of 205 instructions -- 19%

    Towers$pushDisk         93 instr   51 slot-ops    6 pairs  (12 instr)
    Towers$popDiskFrom      61          32            1         (2)
    Towers$moveTopDisk      19          12            1         (2)
    Towers$moveDisks        39          24            1         (2)
    awfy-towers                                      18 of 212 instructions -- 8%

**So the cheap fix reaches a third of the slot traffic on one row and a seventh
on the other**, not the 58% and 56% the totals show. The rest is non-adjacent:
a value stored once and loaded later, sometimes more than once, which is inherent
to one-slot-per-SSA-value. Keeping *those* on the stack is stack scheduling --
emitting a block so tree-shaped subexpressions stay on the stack, which is what
javac gets for free because Java expressions *are* trees and our HIR is flat SSA.
That is a much larger change and a different one.

Two numbers, then, not one: what the traffic costs, and what each fix reaches.
The second is measured above; the first is the probe, and the first attempt at it
compared control-flow shapes instead.

### Slot traffic is 1.4% on ART, the 7.8% was conflated, and instruction count is not the currency

Control flow held equal, both arms exiting early three times, checked with `javap`
before the run this time:

    shape                                  HotSpot                    ART
    A  25 slot-ops (as emitted)   0.964 0.956 0.963    1.473 1.557 1.503
    B   5 slot-ops (reference)    0.956 0.951 0.961    1.463 1.452 1.458

    A over B, minima                      1.005x                   1.014x

**Twenty extra slot operations on a 42-instruction method cost 1.4% on ART and
0.5% on HotSpot.** ART's optimizing JIT does its own register allocation and
removes the round trip, exactly as C2 does. The store and the load are in the
bytecode and are not in the executed code.

**And the 7.8% I published earlier for the same thing is withdrawn as a figure
for slot traffic.** That probe's wide arm carried a duplicated `d2i` -- it was
transcribed from `Closure0$call`, which computes the same conversion twice -- so
it did strictly more *work* than its tight arm, not merely more slot moves. 7.8%
was slot traffic plus a redundant conversion; the conversion alone was separately
measured at 2.5%, and the traffic alone is this 1.4%. Two probes of one
transformation disagreeing by 5.6x is what made it worth separating.

**So the instruction-count thread is dead, and that is the useful part.** Our hot
methods in the two worst rows are 1.64x and 2.23x the reference's instruction
count with 58% and 56% of it load/store -- all true, all measured, and **none of
it is where the time goes**, because the JIT removes precisely that. Bytecode
instruction count is not the currency on a runtime that compiles.

A peephole reaching 19% of those instructions, at 1.4% for the whole of them,
would be worth about a quarter of a percent. It is not built and should not be.

### The night's ledger, and what it rules out

    mechanism                        ART        HotSpot     reach
    the duplicated `d2i`             2.5%        0%
    slot traffic                     1.4%        0.5%
    the `[f64]` element type         9.1%        3.5%       2 of 8 AWFY rows
    the `(D)D` closure signature     2.6x        0%         0 of 8 AWFY rows
    `widen`                          helps       --         2 of 8 AWFY rows
    the trampoline                   0%          0%
    allocation                       flat across both runtimes on all 8

`awfy-queens` is 1.98x on ART and `awfy-towers` 1.64x. Everything above that
touches them comes to roughly ten percent. **The gap is not any of the things
that look like it, and it is not their sum.**

What has not been tried is the one instrument that would answer it directly, and
it is unavailable here rather than unconsidered: a method-level profile. The
emulator exposes no PMU, `cpu-clock` sampling cannot symbolize ART JIT frames,
and `dex2oat` -- which would give symbolized AOT code, and is also what a real
Android app actually runs -- is not executable from the shell user. **That is the
next thing, and it needs a real device or a symbolizable AOT build rather than
another hypothesis.**

### A second sitting: 36 of 43 reproduce, seven do not, and it is the ART half that moves

The bar 1 measurement above is one sitting, and this file's own rule is that a
row is not a number until its minima agree across sittings. Re-run identically --
**same pinned tree `ea3be8f5`, same md5-frozen binary `4254f24c`, same 51 cases**
-- so the only thing varying is the sitting.

**36 of the 43 comparable rows land within 0.10**, most of them within 0.02:
`closure-merge` 3.33 and 3.35, `bytes` 1.50 twice, `substrings` 0.19 twice,
`bigint` 0.06 twice, `generic-classes` 0.12 and 0.11, `objects` 0.15 and 0.13,
`dispatch` 1.03 and 1.02. The headline rows hold.

Seven do not, and four of those badly:

    row                   ART 1   ART 2    move      HotSpot control
    instanceof             0.97    1.85   +0.88      1.10 -> 1.11
    growth-fixed           1.01    0.62   -0.39      1.00 -> 0.98
    generator              0.84    0.53   -0.31      1.00 -> 1.00
    number-format          0.77    1.07   +0.30      0.99 -> 1.02
    erasure-unknown        0.43    0.19   -0.24      1.00 -> 1.00
    node-utf8              2.82    2.68   -0.14      6.23 -> 6.10
    in-narrowing           0.99    1.11   +0.12      1.03 -> 1.04

**The HotSpot control on every one of them is stable to 0.03.** Same programs,
same harness, same process shape -- so this is not the machine being loaded and
not the instrument drifting. It is the ART half, and only on some rows.

That is a limit on the ART column that was not visible from one sitting, and it
is worth more than the seven rows it costs: `instanceof` moving 0.88 with its
control moving 0.01 means **a single ART timing is not a row**, and any ART figure
in this file quoted from one run should be read as provisional unless it is one of
the 36. The four large movers are all rows whose ART times are short enough that
`dalvikvm` startup and JIT tier-up are a larger share -- which is a hypothesis and
not measured, and is the kind of thing this file has been wrong about twice
tonight.

**What survives unchanged**: every conclusion drawn above rests on a row in the
stable 36 -- `closure-merge` at 3.33/3.35 for the closure ABI, `dispatch` at
1.03/1.02, `substrings` at 0.19 twice, `objects`, `generic-classes`, `bigint` for
the reference-allocates family. Nothing was concluded from `instanceof`,
`growth-fixed`, `generator` or `number-format`.

### Bar 1 on ART, confirmed across two sittings: two of eight, twice

The eight rows the bar is written about, measured twice against the same
md5-frozen compiler:

| case | ART sitting 1 | ART sitting 2 | move | HotSpot 1 / 2 |
| --- | --- | --- | --- | --- |
| `awfy-list` | 0.82x | 0.75x | -0.07 | 0.94x / 0.94x |
| `awfy-mandelbrot` | 0.89x | 0.89x | +0.00 | 0.83x / 0.84x |
| `awfy-permute` | 1.04x | 1.04x | +0.00 | 0.71x / 0.71x |
| `awfy-sieve` | 1.14x | 1.15x | +0.01 | 1.32x / 1.33x |
| `awfy-bounce` | 1.15x | 1.16x | +0.01 | 0.96x / 0.99x |
| `awfy-nbody` | 1.19x | 1.19x | +0.00 | 1.00x / 1.00x |
| `awfy-towers` | 1.64x | 1.60x | -0.04 | 1.03x / 1.00x |
| `awfy-queens` | 1.98x | 1.95x | -0.03 | 1.25x / 1.25x |

**All eight reproduce, seven of them within 0.04 and the worst at 0.07.**
The count is the same both times: **2 of 8 at or under 1.00x on ART**, against five
of eight on HotSpot. Bar 1 is not met on Android and that is now a result rather
than a reading.

The HotSpot controls reproduce too, each within 0.03 -- and one of them
reproduces a *disagreement*. `awfy-sieve` reads **1.32x and 1.33x** here against
the 0.94x `tooling/bench` publishes. Two sittings agreeing with each other and
disagreeing with the published column means the difference is the **instrument**
rather than the sitting, so this harness and `tooling/bench` do not measure that
row the same way, reproducibly, and its ART figure stays marked uncertified. That
is one row of forty and it is named rather than averaged away.

**The pin held the instrument as well as the corpus, and that cost the first
attempt.** Sitting two was run from the tree pinned at `ea3be8f5` -- which
predates this lane's own `NTS_AWFY` fix, so all eight came back
`javac declined ref.java` exactly as sitting one had, for the same reason and
with the same misleading message. A sitting comparison must hold the **compiler**
constant, which is what the md5 is for; the instrument should be the fixed one.
Re-run from the newer worktree with the identical binary, which is the table
above.

### `awfy-sieve`: two harnesses that should agree, differing by 40%, twice

Not a finding about ART or about a sitting. `tooling/bench` publishes **0.94x**
for this row's jvm/Java on HotSpot, from six runs, five of them under 1.00x.
`tooling/android/times-on-device.sh` measures the same ratio, on the same
machine, on the same HotSpot, and reads **1.32x and 1.33x** across two sittings
hours apart.

Everything around it agrees. Of the 40 rows with a published ratio the second
harness reproduces 35 within 0.10 and 30 within 0.05, and the eight `awfy-*`
HotSpot controls are 0.94/0.94, 0.83/0.84, 0.71/0.71, 0.96/0.99, 1.00/1.00,
1.03/1.00, 1.25/1.25 across the two sittings. One row forks.

**Two sittings agreeing with each other and disagreeing with the published column
is what makes this an instrument difference rather than variance.** I guessed at
classpath ordering, driver shape and warmup tiering, and it is none of them.

**It is the reference, and `tooling/bench` had already written it down.**
`spreads`'s own header records `awfy-sieve`'s `ref.java` at **5.74, 5.74 and 5.38
us on one sitting against 4.49, 4.44 and 4.48 on another, out of one class file**
-- a 1.27x swing in the reference, and its own comment says "whichever the
publishing run happens to get looks entirely plausible in a table".

The arithmetic closes with the numbers already in this file. This harness measured
the reference at **4359.5 and 4440.8 ns** across its two sittings -- squarely and
repeatedly in the *fast* mode -- against our side at 5770.2 and 5887.8, giving
1.32x and 1.33x. For the published 0.94x with our side at about 5.4us, the
reference must have been near **5.74** -- the *slow* mode. Both harnesses are
honest; they habitually catch different modes of a bimodal reference, and the
whole 40% is that.

So the row has no jvm/Java number at all until the reference's bimodality is
understood, which is a stronger statement than "two harnesses disagree". Neither
0.94x nor 1.32x is the row; the row is **0.94x-1.33x depending on which mode its
own reference lands in**, and nothing in either figure says which one it got.

*The defect that let this stand was the reporting, not the measurement.*
`tooling/bench`'s spread table populated `row.varied` from the current run only,
so a row that flips one sitting in six prints a bare number on the other five.
Fixed on the compiler lane as `KNOWN_BIMODAL`, which carries a row's flip whether
or not the current sitting sees it, with entries leaving only when a **cause** is
found rather than when a run comes back clean -- because a clean run is what that
table exists to disbelieve.

**It is open and it is mine.** Both harnesses are: `tooling/bench/**` and
`tooling/android/**` are this lane's, so there is no other session to hand a
disagreement between them to. Recorded in `benches/` rather than left in a
message because the published column is what a reader acts on, and this says the
published 0.94x has a second measurement against it that nobody has adjudicated.
The row's ART figures -- 1.14x and 1.15x -- inherit the doubt and are marked.

**First attempt at adjudicating it, and what it cost.** The emitted classes are
**byte-identical** between the two harnesses (`cmp` on all four), the generated
drivers are the same text, and the JVM flags are the same, which leaves the
harness class -- `benches/common/Bench.java` against this lane's transcription of
its timing arm. Running `tooling/bench`'s own compiled artefact to compare gave
**9806, 11527, 11655 ns** against a published figure implying about 4400, and the
explanation was on the machine rather than in the artefact: `uptime` said **load
average 33.08**. A peer was building. The run is discarded and the comparison is
queued behind `wait-idle` and the lock.

Worth keeping as the reason the two *sittings* are trustworthy where that run was
not: both sittings took the lock, and their HotSpot controls reproduced the
published column on 35 of 40 rows. A number measured at load 33 reproduces
nothing.

### Which other references are the unstable half: two, and four that are the machine

If `awfy-sieve`'s reference is bimodal out of one class file, the question is how
many others are. Two sittings of this survey measured every reference on HotSpot
twice, so the answer is already in the data rather than needing a run.

Six of 51 references moved 8% or more between sittings. **Four of them moved
together with their own program**, which is the machine and not the reference --
and the ratio held, which is the ratio doing its job:

    row                  reference   our side    ratio then / now
    objects                  0.53x      0.52x    0.87x -> 0.85x
    generator                1.11x      1.12x    1.00x -> 1.00x
    growth-fixed             1.10x      1.08x    1.00x -> 0.98x
    growth-grown             1.09x      1.13x    1.02x -> 1.06x

`objects` is the striking one: **both halves ran nearly twice as fast on the
second sitting**, out of identical class files, and the ratio moved by 0.02. A
lane that published absolute times would have reported a 2x improvement.

**Two moved independently of their own program, and those are the candidates:**

    number-format-double     0.87x      1.01x    0.92x -> 1.07x
    symbol-keyed-map         0.88x      1.00x    2.59x -> 2.94x

The reference got 13% and 12% faster while our side did not move at all, which is
the `awfy-sieve` shape: an unstable *reference* swinging the published ratio with
nothing on our side changing. Neither is as large as `awfy-sieve`'s 1.27x and
neither is confirmed bimodal -- two sittings show a move, not two modes -- but
they are where to look, and `number-format-double` is a row this file has spent
effort on at 1.15x and 0.95x, both of which are now suspect from this direction
rather than from ours.

`awfy-sieve` itself did **not** move between these two sittings: 4359.5 and
4440.8, the fast mode twice. That is consistent with a harness that habitually
lands in one mode rather than one that flips, and it is why the fork reproduced.

### The control: the harnesses agree, and both halves of `awfy-sieve` are bimodal

`tooling/bench`'s own compiled artefact against this lane's harness, alternating,
same byte-identical classes, same driver text, same flags, at load 2.03. **Both
arms drive our side**, so this asks only whether the two harnesses measure the
same program the same way:

    bench  5444.1  5685.4  5547.1  4428.3     minimum 4428.3
    mine   4564.2  5586.1  5589.2  5542.8     minimum 4564.2

**The harnesses agree** -- minima within 3% -- so `benches/common/Bench.java` and
this lane's transcription of its timing arm are not the fork, and nor is the
classpath or the driver. That was the question and it is answered.

**And they answer a question nobody asked.** Our own half swings **4428 to 5685
out of one class file**, a 1.28x spread, and *both* harnesses see both ends of
it. So it is not only the reference that is bimodal on this row. It is the
program too, at what look like the same two levels -- roughly 4.4us and 5.6us --
which is also where the compiler lane's recorded reference modes sit
(4.49/4.44/4.48 against 5.74/5.74/5.38).

That revises the account rather than confirming it. `awfy-sieve`'s ratio is the
quotient of **two independently bimodal halves**, so it can land anywhere from
about 0.79x to about 1.28x with neither harness doing anything wrong, and the
three figures on record -- 0.94x, 1.32x, 1.33x -- sit inside that. My two
sittings caught our side slow twice and the reference fast twice, which is why
they agreed with each other at 1.32/1.33 and disagreed with the published 0.94x.

**Two halves at the same two levels is the more interesting fact.** Two different
programs -- our generated one and Are We Fast Yet's hand-written Java -- flipping
between ~4.4us and ~5.6us on the same machine points at something neither program
owns: the workload is a `boolean[5000]` sieve, and a flip that size out of one
class file is the shape of a layout or a JIT decision that is made once per
process. Not chased. Named, with the measurement, because "the reference is the
unstable half" is what I told the compiler lane an hour ago and it is half the
story.

### `erasure-stored-unknown` is a `long[]` where the JVM wants a `double[]`: 3.5x on ART, 0% here

Second-largest ART regression, 2.33x and 2.38x across two sittings against 0.91x
and 1.00x on HotSpot. **Not allocation** -- 16,384 B/op against the reference's
40,016, so this lane allocates less than half what the reference does and is
still slower. So it is the read path, and `javap` on the emitted `$whole` gives
it per element:

    laload; lstore; iconst_2; iconst_2; if_icmpeq   <- the typeof tag
    lload; l2d; dadd                                <- the value

Two candidates in one loop, and they had to be priced apart: an always-taken
branch whose arms are two constants, and a `long[]` needing an `l2d` on every
read. One process per shape, shapes checked with `javap` before running:

    shape                                   HotSpot                        ART
    A  as emitted                 70449.8 70442.1 70537.0   246750.1 234498.6 237253.9
    B  no branch                  70462.1 70543.1 67440.9   235065.6 235524.4 246892.3
    C  `double[]`, no conversion  70424.6 70470.9 70593.2    68733.7  66961.8  70507.6

    the branch (A over B), minima        1.00x                       1.00x
    the representation (B over C)        1.00x                    **3.51x**

**On HotSpot all three are one number** -- 70,450 to within 0.1% -- so C2 makes a
`long[]`, an `l2d` and a dead branch cost exactly what a `double[]` costs. That is
the control, and it is why none of this was visible before Android.

**On ART the branch is free and the representation is 3.51x.** The folded
`2 == 2` with its dead arm, which is the thing that looks wrong in a listing,
costs nothing at all; the element type costs three and a half times.

**Where the `long[]` comes from.** The prepared IR carries both, one per
specialisation:

    %2 = array.new %1 : managed<[f64]>     the guard path
    %2 = array.new %1 : managed<[i64]>     `$whole`
    %33 = array.get unchecked %2[%27] : i64

The narrowing is right for a machine with integer registers and wrong here for
the reason `widen.rs` already states in its own header: *"Specialization narrows a
counter to an `i32` because that is right for a machine with integer registers.
**This one has none.**"* That pass exists to undo exactly this, it is priced at
3.41x for the case it does cover, and it covers **values and fields**. It does not
cover **array element representations**, and that is the whole of this row.

Reach, before building: every bench case **and every example** emitted, counting a
`long[]` or `int[]` allocated in a class that also widens on load.

    benches/cases    2 of 60    dispatch (1.02x on ART), erasure-stored-unknown (2.38x)
    examples         1 of 187   exceptions (0.00x on ART)

**Three of 247 programs, and exactly one of them needs it.** `dispatch` is at
parity on ART and `exceptions` beats its reference by orders of magnitude; neither
would notice.

I expected the corpus to understate this -- an array of integers read as numbers
is an ordinary thing to write, and 60 benchmark cases are not a population. **That
was a hypothesis and the 187 examples refute it.** It is genuinely rare, because
the narrowing needs specialization to prove every element integral *and* the reads
to want a double, and a program that stores integers usually reads them as
integers too.

**So it is not built.** The prize is 3.5x on one row; the cost is extending a
whole-program representation plan to array elements, where the array creation,
every `array.get` and every `array.set` must agree or the verifier rejects the
class at load. That is the same trade declined for the `(D)D` closure signature
four hours earlier -- 2.6x on four rows of 51 -- and declining one and taking the
other on a thinner reach would be choosing by how recently I measured it.

What is bought instead is that the decision is revisitable with numbers rather
than re-derived: **the mechanism is 3.51x on ART and 0% on HotSpot, the fix is an
array-element dimension in `widen.rs`, and the reach is 1 of 247.** If a real
Android program is ever profiled and this shape is in its hot path, all three of
those are already here.

### Generators as values: what this lane already has, and the two numbers that bear on it

The compiler lane is planning a representation for `Generator<T, TReturn, TNext>`
-- 356 refusals in `runtime/node`, of which 305 are async -- as frame pointer plus
resumption pointer, mirroring a closure. Answered from the emitted code rather
than from memory, and recorded here because it will be built later and the code it
was read from can move.

**The representation exists already.** A frame layout any `Suspend` names gets, in
`object_class`:

    implements nts/rt/NtsResumable
    public void resume()V   ->  invokestatic Program.<resume_name>(LFrame;)V

So a generator frame on this lane is a synthesized class with a concrete `resume`
reachable through an interface. And `resumes()` recovers the name by scanning
`Suspend { frame, resume }` **operations** -- not from the call that made the
frame, which is the C and LLVM constraint (`lower.rs`'s
`Callee::Direct(suspend::resume_name(name))`). The name already travels with the
op here.

**So a generator value needs only the frame pointer on this lane.** The resumption
pointer is already a virtual method on the frame's own class, and a generator that
arrived from elsewhere is `invokeinterface NtsResumable.resume()V` with nothing new.

**Two numbers that bear on the design, both from this session.**

*Keeping the direct call where the generator is made locally is worth far more on
ART than the HotSpot measurement says.* Monomorphic dispatch is **free on HotSpot
and is not free on ART**:

    ART      field read 1058   virtual 1 impl 2178 (2.06x)   interface 2162 (2.04x)
    HotSpot  field read 1056   virtual 1 impl 1079 (1.02x)   3 subclasses 4314 (4.08x)

So the indirect path costs about nothing on HotSpot at a monomorphic site and
about 2x on **every resumption** on ART. Interface against abstract class is a
wash there (2.04 against 2.06); `NtsHost` is an abstract class only because
interface *default* methods need API 24, which `NtsResumable` does not use.

*And if the resumption pointer is typed as a signature layout* it goes through the
closure-base machinery (`Layout.base` -> `Fn$`), which is where the `(D)D` tax
lives: a generator whose `next(v)` takes and returns `number` gets `call(D)D` from
its declared type even where every operation is int-exact, measured at **2.6x on
ART and 0% on HotSpot**. Not an argument against the representation -- an argument
that its Android cost will not appear in any HotSpot measurement of it.

**What would break here: nothing, and the checks are cheap to redo.** `widen.rs`
keys on `(class, field)` and its `narrow()` matches only signed ints of at most 32
bits, so a reference field is not a widening candidate. The StackMapTable is a
pure function of the per-function slot table and frame *fields* do not touch it.
`declare_fields` **refuses** (NTS4013) rather than renames when two properties
mangle to one JVM field, so a synthetic `resume` field colliding with a user
property of that name fails loudly.

### And the settled shape has one consequence: a prefix is not a subtype here

The design landed as no function-typed field at all -- C and LLVM dispatch the
resumption through the descriptor's existing `methods` table, this lane needs
nothing -- and `Generator<T>` gets its representation as **the structural prefix
that already exists in the emitted C**, `{header, state: i32, yielded: T}` at
offsets 24 and 28, with the existing prefix cast carrying a concrete frame to it.

**The prefix cast does not carry on this lane.** `object_class` takes a class's
superclass from one place:

    let super_name = program.base_layout(layout)
        .and_then(|at| program.layouts.get(at))
        .map_or_else(|| "java/lang/Object".to_owned(), types::class_name);

So a `Generator<T>` that no frame layout names as its `Layout.base` leaves every
frame `extends java/lang/Object`, and a frame passed where `Generator<T>` is
declared is **NTS4001** -- the same refusal as this lane's one remaining gap.
Fields coinciding at offsets 24 and 28 buys nothing: `getfield Generator.state`
needs the object to *be* a `Generator`.

**And it is the one shape specialisation cannot remove.**
`a-structural-cast-that-is-a-prefix` closed on 2026-09-12 because specialisation
monomorphised the callee. "A generator walked where it was not made" is by
definition the case where the callee cannot know which frame it got, so the
mechanism that closed the last prefix gap is unavailable for this one.

The ask is machinery that already exists: record the abstract generator as the
`Layout.base` of each frame layout, the way every closure names its `Fn$`
signature layout. Then this backend emits `class upTo$frame extends
nts/gen/Generator` on its own and the rest follows. The trap that comes with it is
the one the plan already names -- `same_shape` must refuse to merge two layouts
with different bases, and two generators capturing nothing are structurally
identical from offset 32 on.

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

**Blocked on the lowering -- and NO LONGER A BAR ITEM, since `array-from` is
0.95x.** The operation-level win below is still real and still available; what
has changed is that the row it was for is under the bar, so this is an
optimisation somebody may want rather than a queue entry. The cursor half of it
landed and is what moved the row.

**Originally filed as: blocked on the lowering, and worth more than anything left in this lane.**
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

**Not mine, and reported: the CLI's `--entry` drops module evaluation.**
`nts emit-{c,llvm,jvm} --entry work` roots at `Entry(["work"])` where
`tooling/bench` roots at `Entry(["work", "module#init"])`, so the artefact has
no `module#init` and no driver can call it. The CLI's own doc comment asserts
the two are the same. It is a wrong *answer*, not a link error --
`symbol-keyed-map` gave 32768 against node's 10240 -- and it reaches anyone who
uses the flag to reproduce what a benchmark builds, which is exactly what the
comment recommends it for. `--entry work --entry 'module#init'` is the
workaround; `named_entry()` collects repeated flags and, unlike
`requested_entry()` twenty lines above it, does not split on commas. Both my
Android scripts do that now. MainClaude owns `tooling/cli`.

**Mine, and open.** Two of sixty are not driven on ART: `elementwise` exports
`scale(xs: number[], seed)` and ships its own `driver.java` for `tooling/bench`,
and `json-serialize` exports nothing from `case.ts`. Both are now reported as
skips rather than as failures, and counted apart from disagreements -- the
summary line called them the same thing for two days.

**Mine, and deliberately deferred.** NTS4013 refuses a layout whose properties
mangle to one JVM field name. The fix that would accept it is an injective
mangling -- `$` escaped as `$$`, forbidden characters as `$` plus a letter --
and it costs every generated name its readability in a stack trace, which is the
one place a person reads one. Worth doing the first time a real program is
refused, and not before. `c_identifier` on the C lane is the design to copy.

**Mine -- DONE, and confirmed at a fresh pin: six platform ceilings and two
ours.** See the two sections above. Originally filed as: the bar's second number -- decisively faster than
node -- has never been read row by row, and this file says why: the table sorts
by `jvm/Java`, so a row at parity with its hand-written reference while both
lose to V8 looks finished. `bytes` is the case that proves the distinction
necessary at 1.05x against its reference and **1.42x slower than node**. The
partition is `Java/node`, computed as `(nts/node) / (jvm/Java)`: above 1.00 the
reference loses to node too and the row is a platform ceiling to report; below
it, the reference beats node and we do not, and it is ours. Needs one clean
sitting, which needs the gate lock and a pinned worktree.

**Blocked on housekeeping -- DONE. Re-pinned to HEAD from 480 commits behind,
and the dirt was the worktree's own output.** Originally filed as: `~/.cache/nts-jvm-sweep` and
`~/.cache/nts-jvm-table` are both dirty -- `Cargo.lock` from building and
`README.md` from `nts-bench` writing its own table -- so `pin.sh` refuses to
move either. Neither modification is work; both are output. But the worktrees
are shared, so discarding them wants the gate lock first rather than a
`git checkout --` on a tree someone else may be mid-run in.

**Closed, and worth saying so rather than leaving them on the list.**
`growth-grown` is at its floor: the count reads eleven objects, which is the
doubling ladder and the wrapper, and no policy that does not know the final size
beats 2x. `array-predicates` is `hir::elements` and upstream. `map-and-set` at
1.09x is inside the band this file spent a night establishing is not a verdict.

## Three ways a lint lied on the way to one commit, 2026-09-12

None of these is a benchmark, and all three are the same failure this file keeps
recording about instruments: the thing that answered was not the thing I asked.

**A cached diagnostic names the file you just edited.** `cargo clippy` came back
`Finished in 0.76s` and reported `ops.rs:4226`, 101 lines, *after* the edit that
was supposed to shorten it had landed. It had not rechecked the crate; it
reprinted the previous run's warning. Had I believed it I would have gone
looking for a function that no longer had that shape. **The tell is the
`Checking <crate>` line** -- if the crate you edited is not in the output, the
diagnostics below it are about the tree before your edit. A sub-second clippy
across a workspace this size is not a fast pass, it is not a pass at all.

This is `REBUILD BEFORE DIAGNOSING` arriving somewhere I did not expect it. The
rule was written about a stale *binary*; a stale *diagnostic* reads far more
convincingly, because a warning carries a file and a line number and those are
the two things that look like evidence.

**`too_many_lines` does not count comments, so deleting one costs and buys
nothing.** My first move was to remove a four-line comment explaining why the
four presence helpers are emitted inline rather than called. The count went from
101 to 101. The lint counts lines that carry code, which is the correct design
and the opposite of what I assumed while acting on it -- I traded a written
reason for zero lines. The comment is restored and the code came out instead.

**An extraction placed above a function inherits its attributes.** Putting the
new `integer_to_string` immediately before `fn call` stranded

    #[allow(clippy::too_many_arguments, reason = "...")]

on the *new* function, which takes six arguments and never wanted it, and left
`fn call` bare. Clippy then reported `too many arguments (8/7)` on `fn call` --
which reads as a fresh problem introduced by the refactor, and is the same
suppressed one from before, re-homed. **The tell was that no signature changed.**
A warning about argument count from a change that touched no parameter list is
not about the code; it is about what is attached to it.

Worth stating generally, because the next person to add a method to `ops.rs`
meets it: an attribute belongs to whatever declaration follows it, and "insert a
function before `fn call`" and "insert a function before `fn call`'s attributes"
are different edits that look identical in a diff. Anchor an insertion on the
attribute when there is one.

## The `newarray double` finding does not generalise: 2 of 52, and both were already known

The two AWFY rows that allocate more than their reference on ART are
`awfy-queens` (1.23x) and `awfy-permute` (1.22x), and both are `newarray
double` where the reference writes `newarray int` -- `widen` holding integers
as doubles. The obvious next question is how much of the corpus has that shape,
and it is a question about class files rather than about a device, so it needs
`javac` and `javap` and no emulator at all. 52 bench cases carry a `ref.java`.

**Answer: those two and nothing else.** 34 of 52 rows emit exactly the array
kinds their reference does. Of the 18 that differ, only `awfy-queens` and
`awfy-permute` differ *in element type* the way the finding describes. So
un-widening integer arrays buys two rows in the whole corpus, and the price of
that work should be read against two rows rather than against fifty-two.

The other 16 are three different things, and separating them is most of the
value here:

**Six are the specialisation pair, counted twice.** `pipeline` reads `double:4`
against the reference's `double:2`, `arrays` and `array-methods` and
`growth-fixed` and `erasure-stored-typed` read `double:2` against `double:1`,
and `dispatch` reads `int:2` against `int:1`. Every one is exactly 2x, and
`javap` says why: the allocation appears once in `work(double)` and once in
`work$whole(int)`, which are the general and specialised forms of one function.
One of the two runs. **A static count of `newarray` instructions is not a count
of allocations**, and on this lane it is inflated by a constant factor wherever
specialisation fires. Halved, all six match their reference exactly.

**Eight read `(none)` and that is a blind spot rather than a zero.**
`array-from`, `array-mutations`, `array-predicates`, `bytes`, `case-convert`,
`elementwise`, `growth-grown` and `node-utf8` emit no array instruction at all.
For the growable ones the reason is in the call list: `growth-grown` and
`array-from` call `nts/rt/NtsArrayD`, so the array is allocated **inside the
runtime jar**, which this instrument does not read. `elementwise` calls
`scale$whole:([DI)D` and receives its array from its own driver. So `(none)`
means "not in the emitted classes", and for an `arrays_can_grow` program the
emitted classes are precisely where the array is not.

That is the limit worth stating rather than discovering later: **this instrument
can answer the element-type question completely and cannot answer the volume
question at all.** `bytes-on-device.sh` answers volume, because it counts what
the platform actually allocated at run time, and it is the one that has to run
on the device.

**Two are neither.** `awfy-nbody` emits one reference array where the reference
emits none, and `erasure-stored-unknown` emits `double:1 long:1` where the
reference emits `obj:1` -- ours is the decomposed erased representation against
their `Object[]`, which is a fair trade and not obviously a loss. Both are
single rows and neither is the shape this survey went looking for.

**What refuted me on the way.** The first run of this reported forty-four of
fifty-two references carrying one identical signature, `10:1 112:1 12:5 ... 7:3
boolean:5 int:8`. Two defects, both mine: every reference was compiled with the
whole are-we-fast-yet suite on its source list rather than only the `awfy-*`
ones, so the suite's own arrays were counted as each reference's; and
`anewarray` names a constant-pool index with the class in a trailing comment, so
reading the next token gave `#62` and printed types like `62:1` and `77:1`. **A
column that is constant across forty-four rows is the instrument, every time.**

The control that settled it is the one this file already had: the five rows
whose answers are written down above. `awfy-queens` at `boolean:3 double:1`
against `boolean:3 int:1`, `awfy-permute` at `double:1` against `int:1`,
`awfy-sieve` matching, and `awfy-towers` and `awfy-bounce` both at one reference
array each. An instrument that cannot reproduce the numbers you already have is
not ready to produce ones you do not.

## Bar 3 widened from eight rows to fifty-two, and it fails on twelve

`bytes/op on ART no worse than on HotSpot` was checked on the eight `awfy-*`
rows and held on all eight. That is the set the bar is *written* about and it is
not the set the claim is *about*: every case with a `ref.java` is a program this
lane emits and ships. 52 of them carry one. Frozen binary `18312d3d`, corpus at
`2f8b0211`, one process per case with a per-case timeout so a slow row is a
reported row rather than a dead sweep.

**Twelve of fifty-one measured rows allocate materially more on ART than on
HotSpot** -- more than 100 bytes an operation and more than 5%, which is the
tolerance this file needs because `bytes-on-device.sh`'s own rule is absolute
and calls 0.7% of an 8MB row a finding.

    row                   HotSpot         ART        ours/ref on ART
    bigint                   8288       22032   +166%        0.28x
    case-convert            10232       23152   +126%        0.79x
    number-format            4608        6456    +40%        1.00x
    growth-fixed            16400       20480    +25%        1.00x
    growth-grown            32896       36992    +12%        1.81x
    map-and-set             65952       74144    +12%        1.09x
    node-utf8               75432       83136    +10%        1.23x
    generator                   0       80000   from zero    1.00x
    generator-dispatched        0       80040   from zero    1.00x
    in-narrowing                0       81920   from zero    1.00x
    optional-chain              0     1600000   from zero    1.00x
    instanceof                  0     2133336   from zero    1.00x

**The third column is the one that matters and it is why the count is not the
finding.** On nine of the twelve we are at or under the hand-written Java
reference *on ART*. A row that allocates nothing on HotSpot and 2MB an operation
on ART, while the reference does the same, is C2's escape analysis being absent
rather than this backend emitting something bad: everyone pays it, including the
person who wrote the reference by hand.

**Three are ours**: `growth-grown` at 1.81x, `node-utf8` at 1.23x and
`map-and-set` at 1.09x rise on ART *and* sit above their reference there. Those
are the queue. The other nine are a platform ceiling and belong in the report
rather than in the work list -- the same partition this file already makes for
bar 2 with `Java/node`.

### And the direction nobody asked about: six rows where we allocate nothing and a Java programmer cannot

    row                   ours on ART    reference on ART
    exceptions                      0           1,600,000
    erasure-unknown                 0           1,052,516
    objects                         0              98,328
    generic-classes                 0              63,488
    substrings                      0              24,576
    closures                        0                  16

Checked in the artefact rather than inferred from the counter. `objects` emits
**zero** allocation instructions against the reference's six;
`erasure-unknown`'s `erasureUnknown` is a hundred instructions with zero against
the reference's four. So this is not the counter failing to see something.

**And the fourth cell of the table says why it holds on ART, which three cells
could not.** `ref-bytes-on-device.sh` measured the reference on ART only, so
"the reference allocates 98,328 and we allocate nothing" left open whether the
reference is simply an allocating program. It is not: the same reference reads
**0 bytes/op on HotSpot** and 98,328 on ART. C2 scalar-replaces its six
allocations and ART cannot. Ours is zero on *both*, because the elimination
happened in this compiler rather than in a JIT -- which is the whole argument
for an ahead-of-time compiler on a platform whose JIT is weaker, stated as a
number on a row instead of as a prediction.

`instanceof` was predicted before it was read and came back as predicted: the
reference is **0 on HotSpot and 2,133,336 on ART**, the same pair as ours, so
that row is C2 and not either compiler. Written down because a prediction that
is only recorded when it is wrong makes the wrong ones look characteristic.

`exceptions` is the largest gap in the survey and was invisible until the
warmup below was fixed: the reference allocates **9,100,000 bytes an operation
on HotSpot and 1,600,000 on ART** where we allocate nothing at all. That is the
`fillInStackTrace` prediction from the original plan arriving as a measurement
-- this compiler knows whole-program whether `.stack` is ever read, and V8 and
a Java programmer both cannot.

**Say which half of the feature that is measured over, every time it is
quoted.** A `throw` that crosses a call is *refused* as of `9b0b609c`, so the
shape that allocates nothing is also the only shape that compiles. The number is
real and it is about same-function throws, which lower to a `Jump` with the
thrown value as a block argument and therefore have no exception table, no
handler frame and nothing to fill in. If that refusal ever lifts, whole-program
knowledge of whether `.stack` is read gets **harder** rather than easier: an
unwinder needs frames this design never builds. MainClaude's point, and it
belongs next to the number rather than in a later correction.

### Two of the worst rows are the fixture, and the reference is doing less work

Worth separating before either becomes a work item, because both read as
codegen gaps and neither is.

**`arrays`, 272 B/op against a reference that allocates nothing.** The
TypeScript declares `const xs = [0, 37, 74, ...]` **inside** `convolve`, so the
language says a fresh 32-element array per call and we emit one. `ref.java`
hoists the identical literal to a `private static final double[] XS` and reads
it. Different programs. Ours is right about the source.

**`growth-grown`, 1.81x.** The TypeScript builds its array with 2,048 `push`es
from empty; `ref.java` writes `new double[2048]` because the programmer knows
`n`. A doubling ladder costs about 2x the final array and 36,992 is exactly
that plus the wrapper. This file already recorded the row as "at its floor --
no policy that does not know the final size beats 2x", which is true and was
answering a smaller question than the row asks.

Both have a real optimisation behind them and **neither is this backend's**:
hoisting a non-escaping, never-mutated constant array literal to a static, and
inferring a growable array's capacity from a provably-constant push count. The
C lane does neither either -- `emit-c` puts `nts_array_new` inside `convolve`
for the first -- so they are middle-end opportunities that all three backends
would get, and they are reported upstream rather than built here. Reach is
modest and measured rather than assumed: the syntactic shape is in 5 of 61 bench
case files, 19 of 228 example files and 4 of 312 `runtime/node` files, and two of the five
bench cases mutate the array and so are ineligible.

### What the sweep could not measure, and why it was the instrument

Three rows of 52 came back short: `elementwise` ships its own driver and neither
allocation driver can call it, and `awfy-mandelbrot` and `exceptions` timed out
on the **reference** side. Two of the three are now measured, and both were
worth having -- `awfy-mandelbrot`'s reference is 16 and 8, exactly ours, and
`exceptions` is the largest gap in the table.

The timeout was not those two programs. `RefBytes` warmed a fixed **20,000
iterations** where its compiled counterpart `H.java` warms by *time* with a five
second cap -- and the halve-and-retry loop repeats the warmup on every attempt.
Twenty thousand iterations of `awfy-mandelbrot` is twenty thousand times
twenty-two milliseconds. The comment justifying the time bound is already in
`bytes-on-device.sh`, written when it cost an hour a row there; it did not reach
the sibling. **A fix belongs to the family and not to the file it was found in**
-- which is the second time that sentence has been written in this file about
these two scripts, the first being `NTS_AWFY`.

## Every ART timing in this file is from the JIT, and a shipped app is worse for us

`times-on-device.sh` and `bytes-on-device.sh` both run `dalvikvm -cp x.dex`. A
raw dex in `/data/local/tmp` has no `.odex`, so that is ART's interpreter and
JIT. **An installed Android application does not run that way**: the system runs
`dex2oat` and the app executes AOT-compiled code. So the bar's first number is
written about Android and has only ever been measured in a mode no product
ships, and a ratio is only fair if both sides are treated the same -- which is
the assumption, not a finding.

`dex2oat` is inaccessible to the shell user here, which is what this file
already records as having stopped the profile. What it does not record, and is
true, is that **`oatdump` runs fine from the shell** -- so the artefact was
never the problem, only something to produce it. `cmd package compile -m speed
-f` is `dex2oat` run by the one user allowed to, and `proxy-app.sh` had already
established every step of getting an APK onto this device.
`tooling/android/aot-on-device.sh` builds one APK per side around the *same*
`Case.main` and the same `benches/common/Bench.java`, captures `System.out` from
an activity rather than reimplementing the warmup, and reports both modes from
one dex.

**Predicted before it was run: the ratio would move by less than 0.10**, because
`Bench.measure` warms up and ART's AOT compiler is the same optimizing backend
as its JIT, so a warm JIT should already be producing comparable code. That is
right on two rows and **wrong on the one that matters**.

    case           JIT ratio          AOT ratio           move
    awfy-queens    1.87 1.92 1.89     1.81 1.98 1.99      -0.07 +0.06 +0.10
    awfy-towers    1.62 1.60 1.61     1.94 1.93 1.95      +0.32 +0.33 +0.34
    awfy-sieve     0.98               1.01                +0.03

`awfy-queens` moves in both directions across three runs and is noise.
**`awfy-towers` reproduces three times within 0.02 and gets worse under AOT,
1.61x to 1.94x** -- and its JIT control is stable to 0.01 across the same three
runs, so this is not the emulator wandering.

A fourth `awfy-towers` run, taken separately rather than in that batch, read
**JIT 1.39x and AOT 1.94x**. The AOT figure is the same to 0.01; the JIT figure
is 0.22 off the other three, and the reason is visible in the absolute numbers
-- the *reference's* JIT time was 29,755 against 25,668 in the batch while ours
barely moved. I cannot prove what that run was competing with, so it is reported
rather than discarded, and it says something worth having on its own: **the AOT
number is stable across four runs and the JIT number is not.** That is what
removing tier-up from the measurement does, and it means the mode this file has
been measuring is also the noisier one.

**And the ratio understates it, because the two sides move in opposite
directions.** In absolute nanoseconds on that row:

    awfy-towers        JIT          AOT
    ours           41,612       44,900      about 8% slower
    reference      25,668       23,180      about 10% faster

AOT *helps* the hand-written Java and *hurts* what this backend emits. That is
the interesting half: it is not that everything is slower ahead of time, it is
that the two programs respond to the same compiler differently. The JIT sees
real types and branches and compiles against them; `dex2oat` with no profile
compiles blind, and our generated code evidently depends on what a profile would
have told it more than the reference's does.

**So the ART column in this file is optimistic, not pessimistic.** Every ratio
quoted from `times-on-device.sh` is the best case, and the mode a product ships
in is the same or worse. Bar 1 on ART is 2 of 8 measured through the JIT, and
nothing here suggests measuring it properly would improve that count.

The next step is the one this file has said for a while it could not take, and
it is now takeable rather than argued: `NTS_AOT_KEEP=1` leaves the package
installed and `oatdump --method-filter` prints the AOT code for one method on
each side. `awfy-towers` is where to point it, because it is the row where the
mode reproducibly matters and therefore the row where the two artefacts differ
for a reason rather than by noise.

### "`dex2oat` is inaccessible" was true, and what this file concluded from it was not

Worth separating, because the same shape has now cost four things in one day.

This file has recorded for a while that a method-level profile is unavailable
here: no PMU, JIT frames unsymbolized, and `dex2oat` not executable from the
shell user. Every clause is true. What followed it -- that the artefact could
not be had, and that the next step needed a real device -- does not follow from
any of them. **`oatdump` runs from the shell.** `cmd package compile -m speed
-f` is `dex2oat`, run by the one user that may run it. So the artefact was never
unavailable; only a way to produce it was, and the note never separated those
two claims.

The other three, all on 2026-09-12:

    growth-grown          "at its floor -- no policy that does not know the
                          final size beats 2x" -- true, and the trip count
                          there is a compile-time constant
    all.sh's jvm()        "that edge was built and reverted" -- true of a
                          token given its OWN typeof's layout, and silent
                          about the layout it is stored into
    token_base's doc      "a base cannot relate two genuinely different
                          signatures" -- true of the union case, and not of
                          the case in front of it

Every one is a correct sentence standing where a narrower one belonged, and a
correct sentence is worse than a wrong one here: it stops the next person
looking. The wrong ones get checked.

The rule that would have caught all four is the same: **say what the sentence is
about.** "`dex2oat` is inaccessible to the shell user" is a fact about a binary
and a uid; "there is no way to see AOT code" is a fact about a whole toolchain,
and the first was written down in place of the second.

**And the sharper statement of it, which is MainClaude's and belongs here rather
than in a message: a measurement is a question plus a configuration, and a
configuration nobody stated is a question nobody asked.** `dex2oat` and
`--release` are the same mistake one step apart in the same pipeline -- one
concluded a whole toolchain was unavailable from a fact about a uid, and the
other measured "the mode a shipped app runs in" while dexing the way a shipped
app is not dexed. Neither was a wrong number. Both were a right number about a
configuration that went unwritten, and a tally of who made which is less useful
than noticing they are one kind.

The `--release` asymmetry is worth reading the same way. It is tempting to call
it a flaw in the harness, and it is more honest to say the harness picked the
mode that bills this backend for a feature at a moment when nobody is using it:
the per-instruction debug attributes are a deliberate decision in this lane, for
the provenance chain, and debug-mode `d8` keeps every one of them alive. The
flag did not create the asymmetry; it priced it.

### It is not devirtualisation. `dex2oat` inlines the reference's helpers and cannot afford ours

The question `awfy-towers` was pointed at: is the AOT gap a devirtualisation the
JIT makes and a blind compile does not? **No.** Both sides emit the same
indirect call, `call [rdi + 32]`, and neither is devirtualised. `oatdump
--method-filter=moveTopDisk` over each side's installed `.odex`:

    Towers.moveTopDisk        ours    reference
    AOT code size              116          344
    inlined frames               0            5
    indirect calls               2            2
    runtime entrypoint calls     0            2
    frame bytes                 48           64

The reference's method is three times larger **because five frames were inlined
into it**. Ours inlined nothing and kept two real calls on the hot path. The
reference is paying for `pAllocObjectInitialized`, two read barriers and a
bounds throw *inside* one method; we are paying two calls to reach the same
work.

**The cause is method size, in bytecode, before ART ever sees it.** ART's
inliner has a size budget, and the helpers `moveTopDisk` calls sit on opposite
sides of it:

    method            ours   reference   ratio
    pushDisk           178          45    4.0x
    popDiskFrom        110          38    2.9x
    buildTowerAt        50          26    1.9x
    moveTopDisk         31          21    1.5x
    moveDisks           60          48    1.25x

(JVM bytecode bytes from `javap -c`; dex encodes differently, so the ratio is
the measurement and the absolute numbers are not the threshold.)

**And half of `popDiskFrom` is a cold path.** Offsets 27 to 82 of 110 -- fifty-five
bytes, exactly half the method -- are the `throw` that runs when a pile is
empty, emitted inline:

    new nts/gen/Error; dup; invokespecial <init>
    ldc "Attempting to remove a disk from an empty pile"; astore
    ldc "Error"; astore
    putfield Error.message; putfield Error.name
    NtsRuntime.uncaught(NtsValue.ofObject(e), e.message)
    NtsRuntime.unreachable(); athrow

The reference spends **ten** bytes on the same throw: `new RuntimeException; dup;
ldc; invokespecial; athrow`. Ours is four instructions of object construction,
two string constants, two field stores, an erase, a field read and two runtime
calls -- all of it on a path that never executes in a passing benchmark, and all
of it counted by the inliner.

The rest of the difference is smaller and named rather than guessed: two
`NtsRuntime.bounds(II)I` calls guarding the `aaload`/`aastore`, which this lane
emits deliberately so an escaping `ArrayIndexOutOfBoundsException` cannot be
read as a refusal by the differential; the prologue's `aconst_null; astore` per
non-parameter slot, which the StackMapTable design depends on; and
`aconst_null; astore; aload; aload; if_acmpne` for a null test where the
reference writes `ifnonnull`.

**So the actionable item is outlining, and it is this lane's rather than the
lowering's.** Emitting a cold `throw` block as a separate static method and
calling it would take `popDiskFrom` from 110 bytes to about 55 and `pushDisk`
from 178 to something near the reference, and the bytes removed are bytes that
never run. Whether that is enough to cross ART's budget is a measurement and not
a certainty -- but it is the first mechanism this file has found for
`awfy-towers` that is about the row rather than about the machine, after a
ledger of six that were not.

**And it explains the direction of the whole AOT result.** The JIT compiles what
is hot and has a profile saying so, which recovers some of an over-budget
method; `dex2oat` compiles blind and does not. That is why the mode that ships
is worse for us and better for the hand-written reference, and it predicts the
gap widens on exactly the rows where our methods are largest.

### `d8` defaults to debug mode, and it charges this lane for it and not the reference

Found while costing the outlining above, and it is a correction to every ART
figure in this file rather than a finding about a row.

`d8` dexes in **debug** mode unless `--release` is passed. Debug mode keeps
local-variable scopes alive and pads with `nop // spacer`. Every Android script
here calls it without the flag: `dexes.sh`, `times-on-device.sh`,
`bytes-on-device.sh`, `agrees-on-device.sh`, and `aot-on-device.sh` -- which was
written *specifically* to measure the mode a shipped application runs in, and
dexed it the way a shipped application is not dexed.

`Towers$popDiskFrom` is 67 code units in debug and 51 in release. Sixteen units
of `nop`, twelve of them on the hot path, and **the class file this backend
emits contains no `nop` at all** -- `d8` put them there.

**The flag is not symmetric, which is the part that matters:**

    method         ours_dbg  ours_rel |  ref_dbg  ref_rel
    popDiskFrom          67        51 |       27       25
    pushDisk             84        66 |       33       33
    moveDisks            49        21 |       21       21
    moveTopDisk          24        15 |       14       14
    buildTowerAt         27        17 |       15       14

The hand-written reference barely moves -- 27 to 25, 33 to 33, 21 to 21, 14 to
14. Ours moves by a quarter to a half.

**Across the whole dex, split by who emitted the class:**

    classes              debug      release    reduction
    nts/gen/*              499          362        27.5%
    the runtime jar
      and javac output  27,925       27,145         2.8%

A tenfold asymmetry, and the method *count* is identical either way -- 1143 in
both -- so this costs `dexes.sh`'s floor nothing and is purely about size. The
reason is a deliberate property of this backend: it emits `LineNumberTable` and `LocalVariableTable` per
instruction for the provenance chain RFC 20 asks for, and debug-mode `d8` keeps
all of it live. `javac`'s output carries far less, so the same flag costs the
two sides very differently.

**So a ratio does not protect against this.** Both sides pass through one `d8`
invocation, which is exactly what makes a flag look fair when it is not -- the
penalty is applied to both and lands on one. That is the same shape as the
`ref-bytes-on-device.sh` missing quadrant: a comparison that cannot see the
thing it is holding constant.

`moveDisks` in release is **21 units, exactly the reference's 21**, and
`moveTopDisk` is 15 against 14. So a good part of the size gap above is the
harness. What survives is concentrated in the two methods with cold `throw`
paths -- `popDiskFrom` 51 against 25, `pushDisk` 66 against 33 -- which is the
outlining item, and better bounded for it: 51 units with a ~25-unit cold block
taken out lands near the reference and under ART's budget.

### Outlining the cold path was priced and is not worth building

The previous section argued for outlining the cold `throw` block, on the
strength of it being 31 of `popDiskFrom`'s 67 code units. Priced before built,
which is the rule, and **it does not clear the bar.**

The arms are three transcriptions of `Towers` differing in one thing each,
dexed with `--release` and run on ART through `cmd package compile -m speed`:

    arm          popDiskFrom   T2.moveTopDisk AOT   inlined frames
    control            25 u            354 bytes                 5
    outlined2          34 u            102 bytes                 0
    bloat              40 u            102 bytes                 0
    ours (real)        51 u            116 bytes                 0

`outlined2` is this lane's hot path -- two explicit `NtsRuntime.bounds` guards
included -- with the cold block replaced by a single static call. It lands at
**34 code units and is not inlined**. So the threshold sits between 25 and 34,
below ART's documented 32 rather than at it, and outlining takes
`popDiskFrom` from 51 to 34 without crossing it.

**The timing says the same thing and says it in a way that could be misread.**
`outlined2`'s AOT ratio is 1.25x against `control`'s 1.83x, which looks like an
improvement and is not: ours barely moved (41,142 against 41,336) and the
*reference* got slower (32,789 against 22,553), because the reference is the
arm that lost its inlining. A ratio improving because the denominator got worse
is the same reading error as `awfy-sieve`'s two harnesses, and the absolute
columns are what stop it.

So the mechanism from the previous section is confirmed -- inlining is the
difference, and method size in code units is what decides it -- and **the fix
that follows from it is not outlining alone.** Getting `popDiskFrom` under the
threshold needs the cold block *and* the two bounds guards *and* the rest, from
51 units to about 25. The guards are deliberate: an escaping
`ArrayIndexOutOfBoundsException` reads as a refusal to the differential, which
is a day of false failures. That trade was made for a reason and this is the
first time it has had a price attached, which is worth more than the
optimisation would have been.

**What this cost: one afternoon of measurement and nothing else.** Built, it
would have been a change to `body.rs`, a new class-file shape, tests for it,
and a row that did not move -- and the row not moving would then have needed
explaining, on top of the six mechanisms already in the ledger that did not
move it either.
