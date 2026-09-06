# 0168 — A string accumulator is a builder, and the platform's codec is still four times ours

Record 0166 measured the share and left the replacement unpriced. This is the
replacement, in two steps, and the second one was not in the plan.

    node-utf8            time         bytes/op     jvm/Java
    before            91.71 us         784,888       11.27x
    builder           55.42 us         323,016        7.56x
    + appendCharCode  39.08 us          98,760        5.35x
    Java reference     7.31 us          65,568

## The accumulator

`hir::rc` rewrites a `Concat` whose left operand is counted, owned, unborrowed
and dead into `nts_str_append`, which appends in place when the runtime count
says the string is unique. That pass runs only under
`Provider::ReferenceCounting`, so this lane never sees it, and could not use it
if it did -- the mechanism is a mutable string.

The plan concluded from that that the optimisation was C-specific:

> `Call { frame: Some(n) }` has no analogue (`java.lang.String` is immutable,
> there is no fill-this-storage form), so the `_into` placement price is
> C-specific.

The premise is true and the conclusion does not follow. The accumulate pattern
does not need a mutable string; it needs a builder and one materialisation.
`compiler/codegen/jvm/src/builder.rs` finds the classes -- joined by
block-parameter edges and by the concatenation itself -- and keeps one where
every use is either the left operand of a concatenation inside the class or the
function's return.

**The return is the conservative half and is a proof rather than a guess.** A
single read anywhere else would also be correct if it ran once, and nothing in
the backend knows whether it does; a `toString` inside a loop would copy the
accumulator every iteration and reintroduce exactly the quadratic this removes.
A return runs once per call by construction.

## The part I did not predict, and the instrument that pointed at it

The builder took 784,888 bytes an operation to 323,016 and the row to 7.56x --
and the Java reference was at 65,568. **Still five times the allocation, after
the change that was supposed to be about allocation.**

Six `String.concat` became six `StringBuilder.append` and `javap` said where the
rest was: every append but two took a fresh one-character string from
`stringFromCharCode`, appended it and dropped it. About a hundred a decode,
sixty-four decodes an operation. `NtsRuntime.appendCharCode` takes the builder
and the code unit, and the peephole fires where the string has exactly one use.

    98,760 B/op against the reference's 65,568 -- 1.5x, from 12x

**The prediction I would have got wrong if I had made one:** I would have said
the builder was the whole of it. The instrument said otherwise while the change
was still half-finished, which is the argument for measuring allocation beside
time rather than after it.

`appendCharCode` calls `toUint16` rather than casting, because
`stringFromCharCode` does: two spellings of a coercion are two chances to
disagree, and the one thing an append may not do is answer differently.

## Where it stops, and why the reference stays

    nts C 30.46   nts LLVM 34.67   nts JVM 39.08   node 38.02   bun 33.68
    Java 7.31

Every lane compiling this program clusters at 30-39 us and the reference is four
times faster than all of them, node included. That is not a lane to fix. The
reference's own comment already said so before any of this:

> a Java programmer writes `getBytes` and gets the intrinsic, so the reference
> is what a person writes, and the gap is the cost of us implementing a codec
> the platform already has ... it is not answered by pretending the row is
> close.

`String.getBytes` and `new String(bytes, UTF_8)` are HotSpot intrinsics, hand
vectorised, with an ASCII path that moves a machine word at a time. We run
`runtime/node/internal/utf8.ts` compiled, a code point at a time. **5.35x is the
honest remainder and it is a codec question, not a codegen one** -- whether this
lane should call the platform's codec instead of compiling ours is a real
question and it is not this record's.

What changed is that the row is no longer 11.27x, and none of what is left is
allocation.
