# 0035 — The simplest loop was the slowest

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

## Why `end` is a double, all the way down

    end             is the parameter, f64
      <- written    is `utf8Write(...)`, whose result is TOP
      <- utf8Write  is an exported root, so `guards` wraps it: the result is the
                    join of the clone's and the *slow path's*, and the slow path
                    exists for arguments nothing is known about
      <- so a caller that passes literally whole numbers still learns nothing

A caller that can prove the guard's own test could call the clone directly and
inherit its facts. That was built, and it is **not** the answer here: the test
is `ToInt32(n) == n`, and `utf8Write`'s `max` argument is `utf8Length(str)`,
whose result is at most `4 * str.length` where a string's length is a `u32`. It
genuinely can exceed `int32`, so the redirect correctly refuses.

Bounding it needs the *string's* length to survive a call — the argument is a
concatenation of literals and is 113 characters — and interprocedural facts
carry numbers, not string lengths. `flow::string_span` knows a string's length
locally; nothing carries it across a boundary.

**That is the next change, and it has a number attached: 3.03x on the simplest
loop in the decoder.**

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
- Not the state machine's shape: a synthetic version of the same machine is
  0.56x node, and the difference was the buffer, not the code.
- Not naive codegen: a hand-written C decoder over the same runtime measured
  106us per 64 decodes against the generated code's 32.
