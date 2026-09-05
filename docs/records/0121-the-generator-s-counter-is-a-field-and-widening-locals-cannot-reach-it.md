# 0121 — The generator's counter is a field, and widening locals cannot reach it

**Status: diagnosed, built, measured at nearly nothing, reverted.** The
diagnosis is the part worth keeping and it is exact.

## The row is one conversion, and that is confirmed rather than argued

`generator` is 3.41x hand-written Java. Priced by mutating the reference -- one
variable, everything else identical, checksums equal:

    double counter   172.2 us
    int counter      587.3 us     3.41x

Our lane measures 588.73. **The reference is not faster because it is Java. It
is faster because it never narrowed.** Record 0106 said this and it holds today.

The profile says where, and corrects the standing list while it is at it:

    89.59%  nts.gen.Program.work$whole
     7.63%  nts.gen.Program.upTo__resume

The standing note calls `upTo__resume` "the per-element body" and points every
future reader at it. It is not: the generator body is inlined into the consumer
loop, and `work$whole` has no call to it at all. Ninety percent of this row is
in the method nobody was looking at.

Both frames are **0.00 bytes/op** -- ours and the reference's -- so escape
analysis removes the object on both sides and allocation is not the row either.

## What the conversions actually are

    154: getfield upTo$frame.yielded:I     <- an int field
    157: istore 21
    159: iload  21
    161: i2d

    66:  iload 7                            <- the counter
    68:  i2d

On this target an `i32` buys nothing: a JVM local is a slot, `dadd` and `iadd`
cost the same, and narrowing only adds an `i2d` at every use that wants a
number. So `widen.rs` looked for `i32` values whose uses are all conversions to
f64 and held them in `double` slots -- exact, because an `i32` is representable
in an f64 without rounding and HIR typing a value `Int { bits: 32 }` *is* the
proof it fits.

    awfy-bounce   7 -> 6 conversions
    awfy-nbody    9 -> 8
    everything else unchanged, generator included

**One conversion each on two rows.** The counter is written into the generator
frame, so a `FieldSet` refuses its class, and that is not an accident of my
rule: `upTo$frame.yielded` is declared `I` and `upTo$frame`'s counter likewise.
The value being converted **lives in a field**, and an analysis over locals
cannot reach a field however carefully it is written.

## What the fix would have to be

The frame's *field types*, not its locals. That is a program-level decision --
one function writes the field and another reads it -- where this was
per-function, and it is a layout question rather than a slot question. The frame
class is generated entirely by this backend, so its descriptors are ours to
choose and nothing outside sees them, which makes it tractable and does not make
it small.

Worth stating what it is not: it is not a middle-end change. The IR is
untouched, every lane still receives the same program, and what differs is how
this backend realises an `i32` -- the same latitude it takes deciding an array
is a `double[]`. The invariant `prepared_program` states survives.
