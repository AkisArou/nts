# 0122 — The counter was an int and the target has no integer registers

    generator   588.73 us -> 172.05 us      3.41x -> 1.00x

Predicted at ~172 before the change existed, from mutating the reference: one
variable, everything else identical, checksums equal.

    double counter   172.2 us
    int counter      587.3 us     3.41x

**The reference was never faster because it is Java. It was faster because it
never narrowed.**

## What the row was

Specialization narrows the loop counter to an `i32`, which is the right answer
for a machine with integer registers. This one has none: a JVM local is a slot,
`dadd` and `iadd` cost the same, and the only thing an `i32` buys is an `i2d` at
every use that wants a number -- which, in a loop whose bound and whose product
are both `double`, is every use.

So `widen` holds such values in `double` slots. It is exact: an `i32` is
representable in an f64 without rounding, and HIR typing a value
`Int { bits: 32 }` **is** the claim that it fits, because specialization put it
there by proving the range. The argument covers `+`, `-`, `*` and the
comparisons and nothing else -- shifts and bitwise operations need the bit
pattern, division truncates differently, an unsigned type is not an f64's to
represent -- so a class touched by any of those is refused whole.

## Three wrong turns, and the last is the one worth keeping

**Locals were not enough.** A first version widened only locals and moved two
conversions in the entire suite. The value being converted lives in a *field*:
`upTo$frame.yielded` is declared `I`, because a generator's state survives its
suspension.

**A field cannot be widened alone.** Widening only the read moves the conversion
to the write. The field, the counter feeding it and the arithmetic between them
are one equivalence class spanning several functions, which is why this is a
union-find over the whole program rather than a pass over each body.

**And the analysis was reading a program the backend does not compile.** It
refused `upTo$frame.yielded` because a `yield` used the value -- in
`upTo__resume`, which *is* emitted. But `Yield` is on the emitter's refusal list
and `generator` compiles clean, so the instruction cannot be in the output. It
was sitting in a block nothing reaches: **`func.values` outlives lowering and
dead-code elimination**, and the emitter walks `block_order`.

That is this session's recurring failure in a new place -- the instrument and
the subject looking at two different things -- and the fix is the same shape as
the others: ask the emitter's own answer rather than a parallel one. `live_ops`
calls `block_order`, which is what the emitter calls.

## What it is not

Not a middle-end change. `prepared_program` still runs once and every lane
receives the same program, which is what makes `nts (JVM)` a comparison of
backends rather than of two compilations. What differs is how *this* backend
realises an `i32`, the same latitude it takes deciding an array is a `double[]`.
The frame classes whose descriptors change are generated here and nothing
outside can see them.

The field identity is `(declaring class, field name)` rather than a layout
index, because `field_ref` resolves the owner through `declares_field` while
`object_class` declares by name. Keying on the index would have disagreed at one
of the two sites, which is a wrong descriptor rather than an error.

## Unrelated, and found by the same run

`awfy-bounce` reads 1.03x where it was 0.96x this morning. Measured with this
change stashed: **1.04x**. It is not this, and it is not the stack-scheduling
attempt that was reverted before it. Something upstream moved that row by eight
percent today and nothing here did it.
