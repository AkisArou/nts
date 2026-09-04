# 0083 — The boxes C2 removed, and the ones it was right not to

The JVM backend erases to a three-field `final class NtsValue`, on the plan's
stated bet that HotSpot's escape analysis would delete it wherever the value
does not escape, and that if it did not, the answer would be to decompose an
erased value into three slots the way `codegen/llvm` already does across a call
boundary. The measurement was supposed to settle which.

It settled something else: **both halves of the prediction were right about the
allocation and wrong about what to do next.**

## The instrument

`-XX:+PrintEscapeAnalysis` does not exist on a JDK anyone ships — it is a
`develop` flag, present in a debug VM and silently absent in a product one. So
the instrument is `com.sun.management.ThreadMXBean.getThreadAllocatedBytes`,
printed as bytes per operation by `Bench.measure` under `NTS_BENCH_ALLOC=1`,
after the ordinary warmup. It is in every HotSpot, it costs nothing, and it
answers the question more directly than the flag would: escape analysis is a
means, and what we want to know is whether the allocation happened.

**Zero means it did not.**

## What the four `erasure-*` probes said

    erasure-typed             0.00 bytes/op
    erasure-unknown           0.00 bytes/op
    erasure-stored-typed      16016.00 bytes/op
    erasure-stored-unknown    16016.00 bytes/op

The first two are the answer to the question as asked. An erased value that
flows through a call and back is **free**: C2 scalar-replaced every `NtsValue`,
and the boxed representation costs nothing at all.

The second two are identical to each other, and that is the finding. 16,016
bytes is `16 + 2000 × 8` — a `double[2000]`, allocated once per operation.
`javap` confirms `newarray double` where the source says `unknown[]`. The
specializer proved every element is a number and narrowed the array's element
type, so **neither "stored" probe contains an erased value any more**, in any
lane. `erasure-stored-unknown`'s own comment predicted this and asked for it:
"specialization should eventually collapse this to the typed case … this
benchmark closing the gap is the evidence". It has closed. The evidence arrived
and retired the instrument that produced it.

So the four probes could not answer the stored half, and a fifth was needed:
an `unknown[1000]` half filled with numbers and half with booleans, which
nothing can narrow.

## The stored case, measured

    mixed erased array, boxed          36016.00 bytes/op      2940.6 ns
    the same, booleans interned        20016.00 bytes/op      1825.7 ns

36,016 is exactly `16 + 1000 × 4` for the reference array plus `1000 × 32` for
the boxes — a twelve-byte header, an `int` tag, a `double` payload and a
reference, padded. Not one was scalar-replaced, and C2 is right: they are stored
into an array that outlives the frame. They escape in the plainest sense.

## Why this does not argue for decomposition

The plan said that a non-zero number would mean decomposing an erased value into
three slots, with JDK 21's missing `ReduceAllocationMerges` as the likely reason
a merge at a control-flow join defeats scalar replacement.

That reasoning does not reach this number. **Decomposition helps exactly the
case that already costs nothing.** Three slots in a frame are free where a box
was already removed; they do nothing for a value stored into an array, because
an array element has to be *something*, and one reference per element is what a
`Ljava/lang/Object;` array holds. The stored cost is not a boxing decision, it
is an array-representation decision — three parallel arrays (`int[]`,
`double[]`, `Object[]`) against one array of boxes — and that is a much larger
change with a whole-program aliasing question attached.

So: **the boxed representation ships, and decomposition is not built.** Not
because the number was zero, but because the case where the number is not zero
is one decomposition does not address. That is a different conclusion from
either branch the plan wrote down, and it is the reason the measurement came
before the build rather than after.

## The one thing worth changing, and it was free

Half of the 36,016 was `ofBoolean`. A boolean has exactly two values, so two
interned instances cover every erasure of one — the same argument already made
for `undefined` and `null`, which were interned from the start on the grounds
that they "carry no payload". A boolean has a payload of one bit, which is
small enough to enumerate.

Interning the two took the stored case to 20,016 bytes per operation and
**1825.7 ns from 2940.6 ns — 38% faster, on the same checksum.**

Numbers are deliberately not interned. There is no small set to cover, a cache
would put a lookup on the hot path to save an allocation C2 already removes
wherever the value does not escape, and where it does escape the array is
holding a distinct number per element by construction.

## What this leaves open

The remaining 20,016 is 1000 real number boxes and the array that holds them.
The parallel-array representation would take it to 12,016 and change every
erased-array access in the backend; nothing measured so far says whether the
16% of bytes is worth it, and the honest next instrument is a row in the
benchmark table rather than a probe. `hir::escape` and `hir::elements` already
work per-array, so the information to decide it per-array exists upstream.

Also open, and cheaper: an erased value that escapes only into a *field* of an
object that does not itself escape is a case C2 handles and this probe does not
exercise.
