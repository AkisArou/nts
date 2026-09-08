# A reproduction that agreed with me completely, and about something else

The JVM session profiled `benches/cases/node-utf8` at 6.86x hand-written Java
and found 62% of the row in one cause: an integer quantity living in a double
slot. `NtsRuntime.toInt32` at 296 of 580 samples, and `NtsRuntime.bounds`
emitted as `(ID)I` — the index a double, so the check pays a `d2i` before it
compares. The IR named the value:

    b1(%7: f64, %8: i32):

`%8` is `inputIndex` and it is an integer. `%7` is `outputIndex` and it is not.
Same function, same loop.

Priced against a hand-written reference before anything was proposed:

    code in an int slot          5.67 us   1.00x
    one conversion per iteration 12.46 us   2.20x
    conversion at every use      13.58 us   2.39x

The middle row killed the obvious fix: deduplicating nine conversions to one
recovers 8% of a 2.4x gap. The cost is the value living in a double at all.

## Three mechanisms, and only the third is the answer

**Theirs**: `outputIndex` is compared against `offset + maximum`, and those are
`number` parameters, so the comparison is `f64` and the index follows it. Right
about *which* value and right about *why it differs from `inputIndex`*, and
wrong about the cause.

**Mine**: an `i32` converts to `f64` exactly, so `i < end` can widen one side at
the comparison, and nothing requires the counter to live in a double. True, and
not what was holding it.

**Mine, second attempt**, and this is the one that got committed to and then
reverted. `signatures` narrows a root's parameters through a `#whole` variant,
and `specialize` joins a block parameter with everything passed to it into one
class — a class may be specialized only at the *exact* width of an
already-integer member, because that member's type belongs to whoever decided
it. Two `i32` parameters can sum past `int32`, so a counter bounded by their sum
wants sixty-four bits against a pin of thirty-two, and the disagreement sent the
whole class back to `f64`.

That mechanism is real, and there is a two-function control for it:

    wants32(out, offset)           at < 1000        b1(%4: i32)   integer
    wants64(out, offset, maximum)  at < offset+max  b1(%6: f64)   double

and a second control isolating it to the join rather than the range: `let at =
offset` keeps the counter `f64` where `let at = offset | 0` makes it `i64`,
because a coercion's result is a fresh value with no pinned width.

The repair — widen rather than refuse, signed to signed, wider only, and only
where every pinned member is a parameter — worked exactly as predicted. Four
functions, 203 cases against node on C, LLVM, JVM and under `NTS_RC=1`, all
agreeing. Corpus unchanged on all three zero rows.

## And it does not touch `node-utf8`

    prepared HIR for node-utf8, before and after:   IDENTICAL
    emitted C for node-utf8:                        IDENTICAL
    emitted C, all 55 bench cases:      same 55  differ 0
    emitted C, all 134 examples:        same 134 differ 1   <- the new example
    diagnostics over runtime/node:      27160 either side, identical in every class

Both backends consume the same prepared HIR, so identical HIR is a *proof* that
neither lane could move, without timing anything. The change fires on exactly
one program in this repository: the one written to demonstrate it.

**A synthetic reproduction that behaves exactly as predicted is the most
persuasive possible evidence for the wrong conclusion, because it agrees with
you completely and about something else.** The control proved a mechanism
exists. It did not prove it was *this* one, and the check that would have said
so — read the real function's IR — was five minutes and was not done until after
the claim had been made to another session.

## What is actually holding it

The class of `%7`, reconstructed from the prepared IR, has ten members:

    %7 %11 %200 %201 %202   block parameters
    %64 %85 %130 %189       add ..., 1
    %240                    convert %2

**No parameter.** `%2` is not a member; a `Convert` of it is. So there is no pin
and the widening was never going to fire here, whatever it did elsewhere.
`Convert` being absent from `specialize`'s `usable` set was tested next and is
not it either.

It is the range proof. `nts facts`:

    %8   inputIndex   i32  [0, 2147483647] whole
    %7   outputIndex  f64  [-inf, +inf] nan? -0?
    %6   end          f64  [-inf, +inf] nan? -0?

`inputIndex` starts at zero and is bounded by `input.length`, so an interval
proves it. `outputIndex` starts at a parameter and is bounded by `end`, which is
itself parameter-derived — and an interval domain widens a counter with no
constant bound straight to infinity. Unprovable, so every member of the class
fails, so the class stays `f64`.

That is not a defect in the analysis. It is the analysis being asked a question
it does not answer, and the machinery for the question already exists one
question over: `flow::Analysis` keeps relational pairs, `(a, b)` where `a < b`
holds throughout a block, and its own comment says why —

> an index is inside an array whose length is unknown... no interval proves it,
> and the *identity* of the value that guards the loop is the whole of the proof.

Kept for bounds checks. Not consulted for representation. A counter guarded by a
value that is itself bounded is the same question one step out.

### Five hypotheses, and the instrument that should have come first

Each of these was plausible, cheap to test, and wrong:

1. a parameter pin refusing the class — the class has no parameter in it
2. `Convert` missing from `specialize`'s `usable` set
3. `loops::MERGE_DEPTH` too shallow for a four-way branch — raised to 12
4. `loops::MAX_TRIPS` at `1e9` against a loop bounded by `input.length`, plus a
   **chained** step: `out += 1` twice reaches the latch as `(param + 1) + 1`,
   and the inner add is not a copy of the parameter, which `step_of` requires
5. `trip_count` refusing a step that is not a singleton — the input index
   advances by one or two, because a surrogate pair is two code units, so the
   step is `[1, 2]`; the *smallest* step gives the largest trip count, which is
   the sound direction, and the division already used `step.lo.abs()`

Five falsified hypotheses are five real facts. What none of them could be is
**confirmed**: an outcome-checked guess that fails tells you one thing is not the
cause, and an outcome-checked guess that succeeds tells you almost nothing,
because the change might have worked for a reason nobody named.

And every one of them was tested against **the wrong function**. `nts facts`
dumps the lowered program; the function a backend compiles is `utf8Write#whole`,
which `guards` and `signatures` produce and which only exists after `prepare`.
So `nts facts` grew a `--prepared` flag, and it answered in one line what four
hours of guessing had not:

    %6   i64  [-4294967296, 4294967294] whole      <- `end` IS provable
    %7   f64  [-2147483648, +inf]                  <- lower bound known, upper is not

The missing fact is **one bound**. `end` is bounded, `outputIndex` starts at a
bounded value, and the upper end of the accumulator is the whole of what is
absent — including its `whole` flag, because an interval with an infinite end
cannot claim wholeness at all.

The instrument is the deliverable here, not the diagnosis. Build the thing that
answers the question before spending an evening on answers that cannot be
checked.

## What was kept and what came out

The pass change is **reverted**. The rule is measure first and revert if nothing
moves, and nothing moved: zero diagnostics, zero of 55 bench cases, zero of 134
examples. Correct, reproduced, and paid for by nothing.

`examples/offset-counter` is **kept**, with its comment rewritten to describe the
gap rather than a fix. It agrees with node on 203 cases across four lanes and no
other example has the shape, so it is coverage today and the reproduction the day
the relation is read.

Two things came out along the way that were not the point.

A sweep to widen mismatched edge arguments was written, because `specialize`'s
rule is that conversions come from uses and never from edges and the widening
looked like an exception to it. **Removing it changed nothing** — the conversion
is already a member of the class and is retyped with it — and
`verify::check_arguments` already rejects an edge whose argument disagrees with
its parameter, `Invalid::EdgeType`, on every program rather than on one example.
A fixup for an invariant that already has a check, firing zero times. The
sabotage found it: breaking the widening failed two tests with the right message,
and breaking the fixup failed nothing.

And a unit test asserting the new widths came out with the change. What is left
in its place is the example, which asserts agreement with node — a claim that
stays true whatever the compiler decides about representation.
