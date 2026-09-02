# 0035 — Five wrong diagnoses, and why this row needs a profiler

`node-utf8` is the last row behind node. Three sessions of hypotheses about it
were wrong; a bisect finally located it, and the location is not where anyone
was looking.

## The bisect, and the control that made it mean anything

Four probes, each adding one piece of the decoder, all with the string building
removed. The first attempt used a synthetic buffer and produced a clean
gradient — `0.01x`, `0.28x`, `0.79x`, `1.32x` — that was **entirely an
artefact**. Node's speed on this workload varies with the byte distribution by
more than the code does, so a synthetic buffer measured that instead.

With the real buffer held constant, and the shared setup (`utf8Length` plus
`utf8Write`, measured separately at 458ns for nts against node's 692ns)
subtracted:

    read a byte and sum it            6.27 us   node 2.07 us    3.03x
    + one branch on the byte          7.39 us   node 3.97 us    1.86x
    + the leading-byte chain          8.03 us   node 7.12 us    1.13x
    + the continuation arm           10.18 us   node 7.83 us    1.30x

**The simplest variant is the worst.** Every piece added after it *narrows* the
gap, because node slows down faster than we do. There is no expensive branch and
no expensive state machine: there is one loop that we compile badly.

## What that loop compiles to

    static int32_t decode(NtsArray *v0, int32_t v1, double v2) {
        v21 = (double)v1;                                  /* start widened   */
    b1: v6 = v4 < v2;                                      /* double compare  */
    b2: v9 = NTS_ITEMS(v0, uint8_t)[nts_index(v0, v4)];    /* double index    */
        v12 = v4 + v18;                                    /* i++ as a float  */

`nts_index` per element on a `double`, and a floating-point increment. Nothing
about that vectorises. 0.87ns an iteration against node's 0.29.

## And then the attribution fell over

The obvious reading of that table is that the byte-sum loop compiles badly. It
does not. The **same loop**, same length of buffer, same `round & 7` call
pattern, in a program that does not import the encoder:

    in `node-utf8`'s program      6.83 us   node 2.66 us    2.57x
    the same loop in isolation    0.38 us   node 2.58 us    0.15x

Eighteen times faster per byte, and *six times faster than node*, from moving
the identical function into a smaller program. Whatever is happening, it is not
the loop: it is what the surrounding program does to the C compiler's inlining
and vectorisation decisions.

Two more hypotheses died on the way to that:

- **`end` being a double.** It is, in that program, because `utf8Write` is an
  exported root whose result is the join of its clone's and its slow path's.
  Two probes differing *only* in that -- confirmed in the prepared HIR as
  `end: i32` against `end: f64` -- measured 377.1ns and 379.5ns. It costs
  nothing.
- **node hoisting a loop-invariant call.** `decode(buffer, 0, written)` is the
  same call every round, so node could have stopped doing the work. Making the
  argument vary with `round & 7` changed our ratio from 3.03x to 2.57x and left
  the shape of the table alone.

`guards::redirect` was built on the first of those, and is reverted: sound,
fires nowhere in this program, and aimed at something that costs nothing anyway.

## What this record is actually worth

An honest account of five wrong diagnoses and the eliminations they bought,
which is less than it set out to be and more than another guess would have been.

The measurement that would settle it is a profile, and this machine has neither
`perf` nor `valgrind`. Every probe built to stand in for one has either folded
to a constant, hoisted out of its loop, changed the byte distribution, or
changed the program's inlining -- each caught, each after it had already
produced a confident-looking number. That is the honest difficulty here, and it
is worth writing down: **this row cannot be attributed with the instruments
available**, and the next person should get a profiler before spending a day on
it as I did.

## Two changes made along the way, and what they were worth

**Kept.** `specialize::width_of` returned `None` for any value that is not a
`Float`, including a parameter `signatures` had just narrowed to `i32` — so the
most integral value in a function sank its class to a double. It fires whenever
a loop counter starts from a parameter, which is every scanning function that
takes an offset. Correct, and worth **six values out of 533** on `node-utf8`
and nothing at all on seven benchmark rows. Kept because the rule it replaced
was wrong, not because it paid.

**Reverted.** `guards::redirect`, the caller-side skip described above. It is
sound and it fires nowhere in this program, so it was an inert pass — deleted
rather than shipped, by the same rule that deleted the inliner in `0027`.

## What was eliminated, so nobody re-runs it

- Not V8's cons strings: the encode half builds no string and is also behind.
- Not the append path: removing the string building makes the ratio *worse*.
- Not the loop counter's representation: fixing that moved nothing.
- Not the loop bound's representation: `end: i32` and `end: f64` measure the
  same to within 3ns.
- Not the state machine's shape: the same machine in a smaller program is
  0.56x node.
- Not naive codegen: a hand-written C decoder over the same runtime measured
  106us per 64 decodes against the generated code's 32.
- Not node hoisting: forcing the call to vary per round left the table's shape
  unchanged.

What is left, and unexplained: the same function is eighteen times faster per
byte when the program around it is smaller.
