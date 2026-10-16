# 0357 — The fixpoint that never stopped

**Decided 2026-10-16, by the compiler lane.** Applies to
`hir::interprocedural::settle`, the whole-program fixpoint every prepared
program goes through six times.

## What was wrong

`settle` is a Kleene iteration: each round rebuilds every parameter, return,
field, element and global fact from what the last round's analyses found, and
stops when a round changes nothing. `flow`, one level down, widens a loop
header after three visits, because a counter's bound grows by one per round.
Nothing widened here.

So a fact that feeds itself across a call or a field never settled. A counter
field written with its own value plus a step grew by one step per round; so
did a position handed to a callee that returns it one further, and the
argument of a function that calls itself with `c + 1`. The iteration ran into
`ROUND_CAP` (32) and handed on the facts it had then -- a bound true of 32
rounds and of nothing after:

    class Counter { n = 0; bump() { this.n = this.n + 10_000_000; ... } }

    300 calls    nts -1294967296    node 3000000000

`Counter.n` was laid out as an `i32` from a bound of about 32 steps, and
wrapped. `ROUND_CAP`'s own comment said reaching it "means a bug". On main
(b54b3ad15) it was reached by 56 of the 570 programs in `tests/programs/`, 8 of
the 63 benchmark cases (awfy-bounce, -list, -permute, -queens, -towers,
event-state, fib, generator), and the large runtime modules, where every one of
`runtime/node/fs`'s six analyses paid all 32 rounds.

## The decision

1. **Each fact counts the rounds it changed in.** Past three changes it takes
   the widened join of this round and the last, `facts::widen(previous,
   previous.join(next))`. That only grows, and grows by jumps to the thresholds
   `facts::widen` knows -- the `i32`, `u32` and safe-integer boundaries, then
   infinity -- so it stops. An absent entry is TOP at the use, and a widened
   fact that reaches it stays there.
2. **A fixpoint that still is not reached is not handed on.** If the cap is
   reached anyway, which would now be a lattice bug, `settle` answers as
   though nothing crossed between functions: every parameter what its
   declaration admits, every return, field, element and global TOP. Sound
   without a fixpoint, and slow only where something is already wrong.

## Why three

Measured, not borrowed from `flow`. With widening disabled, the facts that do
settle need at most five changes in the corpus (`user-iterable`), and one
counter that climbs to its guard needs nineteen. Widening such a fact early
loses less than it sounds: it jumps to the next threshold, and the thresholds
are where a representation changes. Over all 633 programs and benchmark cases:

| patience | fixpoints still capped | programs whose C changed and that settled on main |
|---|---|---|
| 3 | 0 of 633 | none |
| 8 | 1 (`a-throwing-accessor-inside-a-try`) | -- |

Eight is worse, not safer: a fact that changes once per three-function cycle
spends 24 rounds before it widens, and the cap arrives first.

## What it costs and buys

Compile time, user-space instructions of `emit-c`, main's gate build against
this one:

| module | main | widened | |
|---|---|---|---|
| runtime/node/fs | 373.3 G | 226.3 G | -39% |
| runtime/node/http | 413.4 G | 223.3 G | -46% |
| runtime/node/process | 428.1 G | 235.7 G | -45% |

The benchmark rows whose code changes all never settled on main: a value main
bounded from round 32 is now unbounded, and a double where it was an integer.
That is the price of the bound being true, and it is not small. Measured
2026-10-16 on P-cores under the measurement lock, base (b54b3ad15) and tip
alternated twice, load 4.2 falling to 2.1. Each cell is (tip / node) over
(base / node) within a run, for the two rounds; below 1 is faster:

| row | C | LLVM | JVM | Wasm |
|---|---|---|---|---|
| awfy-list | 0.71 / 0.74 | 0.70 / 0.72 | 1.02 / 1.04 | 0.96 / 0.97 |
| awfy-permute | 0.81 / 0.83 | 0.97 / 0.99 | 1.00 / 1.01 | 0.99 / 1.02 |
| awfy-queens | 1.46 / 1.39 | 1.50 / 1.43 | 1.10 / 1.08 | 1.24 / 1.19 |
| awfy-towers | 1.27 / 1.29 | 1.23 / 1.22 | 1.25 / 1.26 | 2.04 / 2.06 |
| awfy-bounce | 1.02 / 1.12 | 1.03 / 1.14 | 1.73 / 1.80 | 0.97 / 1.00 |
| event-state | 0.95 / 0.94 | 0.98 / 1.01 | 0.98 / 1.05 | 0.96 / 1.00 |
| generator | 0.94 / 0.90 | 0.93 / 0.93 | 0.99 / 1.00 | 2.59 / 2.43 |
| fib, awfy-sieve, loop | 0.96 -- 1.05 | 0.93 -- 1.06 | 0.95 -- 1.02 | 0.96 -- 1.04 |

`awfy-towers` on Wasm goes from 0.67x node to 1.35x: a row that beat node now
loses to it. `awfy-queens` is the plain case of why: `placeQueen(c + 1)` admits
any `int32` at its boundary, so its argument does climb without bound in the
abstract, and main's `i64` rested on where round 32 happened to stop.
`awfy-bounce` is the expensive one. `Ball`'s coordinates -- the four fields
0099 narrowed -- are stored as `this.x += this.xVel` and then clamped to the
box, and a field's fact is the join of every store into it, so the unclamped
store has no bound. Main had them as `int32` from 32 rounds of a step of 300.

None of these is lost for good; each needs a bound that is true. `Ball` needs
a field's fact to be what it holds where another function can see it -- at a
call, a return, the function's exit -- rather than at every store, so that a
value stored and clamped before anything can read it does not count. Wasm's
losses on `generator` and `awfy-towers` are larger than C's for the same
double, which is the Wasm backend's to explain. The full table of all 63 rows,
before and after, is recorded beside this once it lands.

## Found beside it

`guards::retract`, which takes back a boundary test whose `#whole` copy came
out no narrower, rewired the entry and left the test's blocks unreachable for
a later pass that only removes functions. The verifier refused the function and
`emit-c` wrote nothing. Main hit it for a function that calls itself with
`c + 0.5` (`tests/programs/a-boundary-test-that-bought-nothing`); the wider
facts here made four Are We Fast Yet rows hit it too. `retract` now prunes the
blocks it strands.
