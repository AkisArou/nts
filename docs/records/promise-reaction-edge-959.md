# A promise leads to its reactions in the cycle graph

Issue #959. A frame or a `then` closure that holds a pending promise is held
back by that promise through its reactions: the promise's reaction list holds
the frame suspended on it, or the closure passed to `then`. The cycle graph
(`compiler/core/src/hir/cycles.rs`) had no edge from a promise to its
reactions, so it called those types acyclic. Their descriptors were not marked
cyclic, and under `--rc` such a cycle was never collected.

## Change

- Every `Promise<T>` slot reaches one **reactions** node, as well as its
  payload. That node reaches the slot of each layout that a `Suspend` (with a
  promise) or a `PromiseSubscribe` subscribes in the prepared program
  (`SlotSources::reactions`, collected in `Program::slot_sources`).
- The oracle (`cycles_oracle.rs`) models the same edge, and stays equivalent
  to the graph.
- A reaction state with no layout leads to every layout (`any_layout`).
  Guard 4 asked how often that happens: never in a prepared program.
  `verify::check_subscriptions` requires every `PromiseSubscribe` reaction to
  be an object with a layout, and `suspend` builds a layout for every frame.
  The arm is kept for soundness.
- Why one node rather than one per element type: a frame's `awaited` slot is
  a `Promise<void>` whatever it awaits, and adoption and `Promise.all` move
  reactions across promise types. The module documentation states this and
  what would narrow it.

## Fixture and control

`tests/memory/a-reaction-that-holds-its-own-promise` has both shapes: an
`async` frame and a `then` closure, each holding a promise that never settles
and whose reaction holds it back. Its control
`tests/memory/a-reaction-that-holds-its-own-promise-control` is the same
program with every promise settled. Before is pin `7a8d56696981`; after is
this change.

| case | compiler | leaked | candidates (elided / naive) | allocated |
|---|---|---|---|---|
| fixture | before | 10 | 4 / 5 | 18 |
| fixture | after | 0 | 8 / 10 | 18 |
| control | before | 0 | 6 / 8 | 16 |
| control | after | 0 | 10 / 14 | 16 |

The retain and release counts are the same on both compilers. In the fixture,
the user callbacks (`Closure2`, `Closure3`), the `then` reactions (`Closure4`,
`Closure5`) and `plusOne_frame` become cyclic, and each is on a real cycle.

The rest of the memory suite is unchanged: all other 82 cases are identical
in every counter, candidates included.

## Cyclic types, per corpus

Each program was emitted by both compilers, and the descriptors' cyclic flags
were compared.

| corpus | descriptors | cyclic before | cyclic after | new: frames | new: closures | new: other |
|---|---|---|---|---|---|---|
| tests/programs | 3888 | 881 | 1077 | 195 | 1 | 0 |
| tests/memory | 109 | 34 | 44 | 2 | 8 | 0 |
| benchmarks/cases | 804 | 268 | 269 | 1 | 0 | 0 |

- No type loses its flag, and no type other than a frame or a closure gains
  one.
- tests/programs: the changes are in 36 programs. The one closure is
  `promise-reactions`' `Closure75`.
- benchmarks/cases: the one frame is `event-loop-promises`' `work_frame`,
  which awaits a pending `Promise.all`. `task_frame` stays acyclic, because
  each of its awaits is settled before the await reads it.
- Not measured, on either compiler:
  - `jetstream-lebab-wtb`: its emit passed 900 s;
  - `jetstream-offline-assembler` and `tests/programs/invalid`: they do not
    emit.

## Instruction counts

`nts-bench --count`: net user instructions per op, on CPU 0, with node
26.13.0. Band: 1 bp for nts C and nts LLVM.

| row | column | before | after | ratio | verdict |
|---|---|---|---|---|---|
| event-loop-promises | nts C | 287321 | 287398 | 1.00027 | regression (+2.7 bp) |
| event-loop-promises | nts LLVM | 285947 | 286028 | 1.00028 | regression (+2.8 bp) |
| event-state | nts C | 1754 | 1754 | 1 | unchanged: identical emitted C |
| event-state | nts LLVM | 1752 | 1752 | 1 | unchanged: identical emitted C |
| event-loop-files | all nts | -- | -- | -- | refused by both (NTS1001 `join`) |
| event-loop-timers | all nts | -- | -- | -- | refused by both (NTS1001, an array of `Timeout`) |

- The only difference in `event-loop-promises`' emitted C is the cyclic flag
  on `work_frame`'s descriptor. The collector now tracks that frame, which
  costs about 80 instructions per call; one call runs 2,577 async functions.
- `event-state`'s emitted C is byte-identical on both compilers.
- The node count driver fails `event-state` on both builds ("invalid
  one-operation net instructions"), so nts-bench prints no row for it. Its
  nts counts are the column's own retained `net-count.json`. The same driver
  failed `event-loop-promises`' node column in two of four runs. That failure
  is #992.
- The machine's default node is 26.13.1, and nts-bench refuses every row
  when the node it finds differs from the bench pin, 26.13.0. These counts
  ran with 26.13.0 first on PATH.
- The coordinator accepted the event-loop-promises cost as the price of a
  real cycle: `work_frame` is the reaction of the promise it awaits, and it
  leaks without the edge.

## What would narrow it

Two narrowings would make a promise reach fewer types:

- **A typed `awaited` slot and a model of adoption and combinator moves.**
  The slot would be one per element type a frame awaits. With both pieces, a
  promise would reach only the reactions subscribed to promises of its own
  type. This does not remove the cost measured above: `work_frame` is itself
  the reaction to the very promise it awaits.
- **A frame that does not hold what it awaits.** The resumption reads the
  settled value from `frame.awaited`. If the runtime passed the source
  promise to the reaction's `run`, the frame would hold no promise across a
  suspension, and a frame would be cyclic only when one of its locals holds
  the promise. This narrowing removes `work_frame`'s cost.

Both are filed as #993, with this measurement.

## Other proof

- Interop captures, green on both compilers:
  - gtk-values, gtk-async, gtk-cycles, gtk-loop, gtk-actions, gtk-gir and
    gtk-notes;
  - native-promise, native-callback and ts-from-c.

  The macOS and Windows async captures cannot run on this machine.
- The five test262 records, with 0 regressed, changed or missing in each:

  | record | passed |
  |---|---|
  | language | 7014/8401 |
  | built-ins | 888/1085 |
  | annexB | 9/12 |
  | staging | 54/59 |
  | harness | 17/17 |

- `inner.ts --no-agree`: green.

## Raw output

Kept in `~/.cache/nts-scratch/959/`:

| file | SHA-256 |
|---|---|
| census-before.tsv | 6bc1f2bf19a00b5f03e6d41600a52174ccf115bdf7904fba44f0f1cda22cd531 |
| census-after.tsv | 1ac9d978d68269cc599929c8e35bdf1a52a2ff388c7e46262e33df0fb8bef1a6 |
| memory-before.txt | 00641c1f1e3cc83214e31d0681b620009e575e36fb31361b5623551c519a24c0 |
| memory-after.txt | f42abb924e414f2d26bfe7fcf004c252c06a7ebba3f889b4ac4d2ba90758c3a0 |
| count-before.txt | e273b25585634dbe4c410d35ddbdcce8c6463531e8338528a6b5f59421b8e135 |
| count-after.txt | 8b76d4a720d176e27e08b7a2bfdcb3bdba03945a50108be026854959ebe735d5 |
| counts-retained/event-loop-promises-nts/net-count.json | 02e94f694d8330658994c0740048f4f91420896371b795b180d56443fad38e21 |
| counts-retained/event-loop-promises-nts--llvm-/net-count.json | 8bdb9f98858583924f1502253fe4479994a08ae49482202574af6fac20c28467 |
| counts-retained/event-state-nts/net-count.json | 8c1257badd30bffb2c43ca3da55ac99b4d225b2bad158e5ca3ded4e905f5d619 |
| counts-retained/event-state-nts--llvm-/net-count.json | 48593cd830f2abf7a7db5449f2ef0d7f22d1ad72a9397db4ebf7e200988fc79f |
| hostprobe-state.json | f347bf386266ab768c30617aba35c855548141c30d0635ab1421e128d3fbe897 |
| emit/event-loop-promises.before.c | 584cf356570d7468bffa08d307e7e4e4c21a53b4c94eec23efa83d65f2d77871 |
| emit/event-loop-promises.after.c | 20d09c9ce090a7c3dd88589da912ffdc2bbb03ac33522b101f52290da22b4aea |
| emit/event-state.{before,after}.c | 356f57348b25d4529f4465a9e11db17090a9bb056a2ec87cbefa50598c0b4928 |
| inner-3.log | e4fe40193698ea9d9d1c9bcd8e71edfcb2c7e88b8e28f59367e3a6efc82fb4c8 |
| test262-language.log | 6c04889f259f10b56b5af4f7ef19579cd233869f0f8487ecaa3c56147116dfe0 |
| test262-built-ins.log | 4aacc51c013144173c6c75b54ed79b043fe28721b7d328d326af55ebc29411b6 |
| test262-annexB.log | c20b43d5111f893defd18e2bf5ada3404a5fb26545c876087847603def71b17e |
| test262-staging.log | 2c4b7dd15ba8128c936fe57c2db50ff4ab752dc6628ddde59a0e01dc4563829c |
| test262-harness.log | 9b1c3ed8a45d5ae87c564b90cefb08dbe844cd72dd0ae67f075e8862ee1218c3 |
