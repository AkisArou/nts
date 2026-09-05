# 0131 — The cast is the test, and I spent the first hour on the strings

`node-utf8` published **13.58x hand-written Java**, the largest ratio in the
column and the only one nobody had opened. The case compiles
`runtime/node/internal/utf8.ts` -- 176 lines of this repository's Node
implementation, written to be Node and not to be measured -- and runs a UTF-8
encode and decode over text covering every arm of the state machine.

## The prediction, and how it was wrong

The decoder is `out += String.fromCharCode(c)` per code point, which is
quadratic, so I predicted the row was string concatenation and went looking for
a cheaper concat. `NtsRuntime.concat` is `return a + b`, and `--release 8`
compiles `+` to a `StringBuilder`, so the change wrote itself: `a.concat(b)`
allocates one array where a builder allocates itself, its buffer, and again in
`toString`.

The allocation profile refuted it before it was written:

    [ 3] java.lang.StringConcatHelper.simpleConcat
    [ 4] java.lang.String.concat
    [ 5] nts.gen.Program.utf8Decode

**It is already `String.concat`.** javac emits it for a two-operand
concatenation of strings, so the improvement I was about to make was already
there and the diff would have measured nothing.

Allocation *is* where the row goes -- 784,888 bytes/op against the reference's
65,568, a factor of 12.0 against a time ratio of 13.58 -- and 66.8% of it is
`byte[]`. That much was right. But allocation is not the same question as time,
and the CPU profile answered a different one:

       17.60%  nts.rt.NtsRuntime.toInt32
       14.40%  jbyte_disjoint_arraycopy
       13.60%  nts.rt.NtsRuntime.bounds

**A third of the row is in two scalar helpers**, neither of which touches a
string. I had not named either. The surprise landed somewhere I had not
predicted, which is the reason for writing this down.

## One shape, twice

`toInt32` decoded the exponent and shifted the significand -- correct, and the
general answer, because `d2i` saturates where JS wraps. `bounds` asked
`index >= 0.0 && index < length && index == (double) (int) index`.

Both do the cast last. Doing it *first* makes the cast its own test:

    int fast = (int) x;
    if (fast == x) { return fast; }

Saturation is observable only outside int range, and there the clamped value is
not the input, so `fast == x` is false. It is false for a fraction and for NaN.
What survives is an exact integer in range, where `d2i` and ToInt32 are the same
number by definition. `-0.0` returns 0 through it, which is ToInt32's answer.

`bounds` is the same move: cast, then ask `i == index && i >= 0 && i < length`.
Two `d2i`, two `i2d` and three `dcmp` become one, one and one.

Checked rather than argued: 25 million random bit patterns, every integer within
70,000 of zero and around both int boundaries, and the pool of awkward doubles,
against the old body -- identical. For `bounds`, 48 million across eight lengths
including 0 and `Integer.MAX_VALUE`.

## What it moved

    node-utf8      94.44 us -> 87.67 (toInt32) -> 82.62 us   13.58x -> 11.05x
    elementwise   468.49 us -> 446.49 us                      7.95x ->  7.64x

**Both moves were smaller than the profile share, and that was predicted.**
`toInt32` was 17.6% and bought 7.2%; `bounds` was 13.6% and bought 5.8%. The row
is allocation-bound, so removing work from a stalled loop recovers less than its
share -- the stalls absorb it. Saying so before the run is the difference
between a confirmation and a rationalisation.

Afterwards the two helpers are 10.3% of the row together, down from 31.2%.

`toInt32` is the entry point for every `&`, `|`, `^`, `<<` and `>>` on a
`number`, and `toUint32`, `toInt8`, `toUint8`, `toInt16` and `toUint16` all route
through it. A UTF-8 state machine is nothing but those operators, which is why
this row found it, but nothing about the fix is specific to this row.

I then audited every other helper for the same shape and found none: the
growable-array `get` and `set` already cast first, and record 0106's comment
says why. **No change is the right outcome of an audit that finds nothing**, and
it is cheaper than the one I nearly made to `concat`.

## What is left, and why the row stays red

    17.52%  jbyte_disjoint_arraycopy
     8.65%  nts.gen.Program.utf8Write
     7.94%  nts.gen.Program.utf8Decode
     7.04%  nts.rt.NtsRuntime.bounds
     6.21%  java.lang.String.<init>
     6.08%  java.lang.StringConcatHelper.prepend

About 40% is now the quadratic accumulation and the copying under it. A
`StringBuilder` for a loop-carried string accumulator would make it linear, and
the shape is not rare -- 50 sites of `+= "` across twenty `runtime/node`
modules, which is the most realistic TypeScript in the repository.

**It would still not turn this row green.** The reference calls
`String.getBytes(UTF_8)` and `new String(bytes, UTF_8)`, which are HotSpot
intrinsics over a hand-vectorized coder: 7.48 us for 64 rounds is about 0.9 ns
per byte in both directions. We are at roughly 10 ns per byte through a state
machine that reads one code point at a time, because that is what the TypeScript
says. Closing 11x means not compiling the codec, and this row exists to measure
compiling it.

So the row is a loss with a reason, and the reason is a library rather than the
codegen. Keeping it in the table and saying that is worth more than removing it.
