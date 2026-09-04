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

## The profiler was here all along

I wrote that this machine has neither `perf` nor `valgrind` and that the row
could not be attributed. It has **`gprof`**, which I never checked -- the sixth
thing I got wrong about this row, and the one that made the other five
avoidable. Compile with `-pg`, run, and it answers in a minute what a day of
probes did not:

    23.89%  utf8Decode                       1,280,000 calls
    23.89%  utf8Write                        1,280,000 calls
    17.70%  nts_str_append                 105,000,000 calls
    17.70%  nts_str_raw                     10,280,000 calls
     8.85%  nts_string_from_char_code_into 108,800,000 calls
     1.77%  nts_release / nts_free          10,300,000 frees

**Eight allocations per decoded string**, and the frees to match. The 105 million
appends are nearly free -- they are in place, which is what `0029` built -- but
the string reallocates as it grows: four doublings from the floor of 16 up to
128 units, the one-byte to two-byte widening when the CJK text arrives, and
three `nts_concat` calls for the emoji, because a two-argument
`String.fromCharCode` builds a pair and then appends it.

Nothing that was guessed at appears in this list.

## Raising the growth floor, and why not

The obvious lever, measured across four values:

    floor  16   47.89 us   1.31x node
    floor  32   47.74 us   1.30x
    floor  64   47.21 us   1.29x
    floor 128   46.43 us   1.27x

Three percent, for an eight-fold larger minimum allocation -- every string would
reserve 128 code units, 256 bytes once it is two-byte. Most strings are short,
so that is a bad trade made globally to move one row, and it is **refused**.

The profile also bounds what any allocation work could buy: `nts_str_raw` and
its frees are 19.5% of the run, so removing *every* allocation leaves the row at
roughly 1.07x node. The rest is spread across the compiled decoder and encoder
(47.8% between them) and the append and char-code helpers (26.6%).

## Three of the eight, and they were free

Written here first as "there is no single fix", which was wrong within the hour.
The profile said eight allocations per decoded string; **three of them are the
emoji**, and they cost nothing to remove.

`String.fromCharCode(hi, lo)` -- the surrogate pair every astral character goes
through -- folds an n-ary call into a chain of concatenations. Two things had to
meet for that pair to live in a frame, and neither knew about the other:

- `flow::string_span` had no arm for `nts_string_from_char_code`, so a
  concatenation *of* two of them could not be bounded. `hir::frame_capacity` has
  said "exactly one code unit" about that helper since it was written; the fact
  simply was not where the other pass could read it.
- the fold emitted `BinOp::Concat`, and `frame_capacity` reads a **call's**
  callee. A binary operator has nowhere to put storage. The emitter renders both
  spellings as `nts_concat`, so the call form costs nothing and can carry a
  frame.

    node-utf8    47.89 us -> 43.88 us     1.31x node -> 1.20x

An 8.4% row, from two facts that existed in different modules. Invisible to
every probe built for this record, and obvious in the profile in a minute.

There is still no *second* fix of that size: what remains is the 47.8% in the
compiled decoder and encoder, and that is a codegen question rather than a
string one.

## What this record is actually worth

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
