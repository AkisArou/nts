# size-flight-planner and size-json were refused from the start (#980)

The full check's core run at 0543c12dd787
(`~/.cache/nts-full-check/runs/core-0543c12dd787-20261122T235710Z/launch-agree.log`)
red-flagged launch-agree for size-flight-planner and size-json on C, LLVM and
the JVM: "a whole program is compared whole, and lowering changed what its
module evaluation runs at ...". The task supposed that a compiler commit in
6fd9bf1feae8..0543c12dd787 began refusing them. No commit did.

## The bisect

Each pin built both programs with the project the launch check builds (the
fixtures config including the row's `case.ts`), using `nts emit-c` and reading
its stderr:

| Pin | size-flight-planner | size-json |
|---|---|---|
| b1acfe0bc2ff (added both rows) | 225 module-evaluation cuts | refused: 8:14, 9:16, 11:1 |
| 6fd9bf1feae8 (the records run's commit) | the same, byte for byte | the same, byte for byte |
| 2fb3e0ce9675 (last pin in the range) | the same, byte for byte | the same, byte for byte |

The 225 cut locations at 6fd9bf1feae8 equal the 225 the 0543c12dd787 log
names. The only commit after 2fb3e0ce9675 that touches the compiler is
00fda8b9cb, and since the log names the same cuts, it changed none of them.

- **size-flight-planner** is refused through jetstream-flight-planner. Its
  `module#init` is refused through `work` → `FlightPlan#parseRoute` ("a
  regular expression literal, which needs a regular expression engine").
  `flight-planner.ts:388:5`, the initializer of `faaWaypoints`, is cut because
  `FaaWaypoints#constructor` is refused ("a constructor returning an object,
  which replaces the instance `new` would have answered"). `String#match`
  ("`match`, which a string does not have here") and `Math` read as a value
  are also refused. #991 owns these.
- **size-json** imports startup-builtins, whose refusals #886 owns: 8:14 NTS1001
  "`JSON.stringify` of an erased value", 9:16 NTS1100 "`JSON.parse` (es:JSON)
  is not provided", and 11:1 skipped because its initializer was refused.

## Why the culprit search blamed the records commit

Before 83f0bc8e42 the two rows had no `program` record, and they were pending
and passed: `population()` in `tooling/differential/src/lib.rs` answered
pending before `whole_program::check` read the program's
`module_evaluation_cuts`, so no landing compared them. 83f0bc8e42 wrote node's
answers, measured at 6fd9bf1feae8. The next core run compared both programs
and found the cuts that had been there since b1acfe0bc2. To the culprit search,
the first red commit was the records commit, which it reverted (d8bd62d243).
The compiler cause it could not see is not a regression, only refusals that
landed unseen.

The fix puts the compile-time declines ahead of the pending answer, through
one owner, `whole_program::compile_time_decline`. Both rows are listed in
`LAUNCH_DECLINES` with their owning tasks.

## Evidence

In `~/.cache/nts-scratch/980/` (SHA-256):

| File | SHA-256 |
|---|---|
| `emitc-size-flight-planner-{b1acfe0bc2ff,6fd9bf1feae8,2fb3e0ce9675}.err` | `2ba0499aaa892be98dfb2f15187bcd820439df64c29060e408d1e8fb22368769` (all three) |
| `emitc-size-json-{b1acfe0bc2ff,6fd9bf1feae8,2fb3e0ce9675}.err` | `e1975c2591ccc4c8aba53c436ab48f393edae8b59251ad58c4856b8cf7d25fd1` (all three) |
| `cuts-6fd9.txt`, `cuts-0543.txt` | `bd90bde08367957e0697398afc5b81ba0d7545d147eddff3330b7b3b13fb53de` (both) |

`SHA256SUMS` in the same folder lists them.
