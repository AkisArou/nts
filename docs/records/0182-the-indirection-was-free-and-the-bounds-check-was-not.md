# The indirection was free and the bounds check was not

I told the other session that a typed array's extra indirection is free in a
loop: the view holds the `NtsBuffer` and reads its `bytes` through it, nothing
in the loop writes that field, so C2 hoists the load. That part was right and
it was not the question anyone should have been asking.

    u8  view   (double index)   0.924 ns/element   5.22x
    u8  byte[]                  0.177 ns/element   1.00x

Five times a bare array. Two guesses at the cause, both wrong, before measuring
the right thing.

## The two wrong guesses

**The division.** `count()` computed the element count as `remaining /
width()`, which is a virtual call *and* an integer division per access. Both
are real costs and neither was this one: replacing them with a field and a
shift moved 5.22x to 5.22x. The element width is always a power of two, so the
shift is right anyway and it stayed.

**The tracking length.** A view built without an explicit length tracks its
buffer, so its bound is read from a mutable field and cannot be hoisted; a view
with a declared length has a `final` bound. That is a true difference and it is
worth zero:

    u8  view   (int index)      0.823 ns/element
    u8  view   (fixed length)   0.823 ns/element

Identical. Whatever costs 0.8 ns is paid by both.

## The measurement that settled it

A second array loop, with a data dependency between iterations so C2 cannot
vectorise it, and the same dependency through the view:

    u8  byte[]                  0.177 ns/element   1.00x   vectorised
    u8  byte[]  (serialised)    0.404 ns/element   2.28x   not vectorised
    u8  view    (serialised)    0.802 ns/element   4.53x
    u8  view    (int index)     0.823 ns/element   4.65x

The view's serialised and counted numbers are the same, which says the view
loop **never vectorises**. And the two serialised numbers differ by 1.98x,
which is the accessor itself.

So 4.65x is not one cost. It is 2.28x of lost vectorisation multiplied by 1.98x
of per-element work — a null check, a branch on whether the length is tracked,
a shift and a bounds compare. Neither factor is the indirection I was asked
about and neither would have been found by reasoning about it.

## What was kept

The `int`-index accessors, worth 11%:

    double index   0.924 ns/element
    int index      0.823 ns/element

`hir::runtime` types every index as a `double`, so the ordinary accessor pays
an `i2d`, a `d2i` and an integrality test per element. `intcall` already
selects `int` forms where the middle end has proved an index integral -- record
0138 made exactly this move for the array subscript and found 4.56x there. Same
shape, much smaller number, and the reason for the difference is that a
subscript's helper was most of its work and a view's is not.

The rest is not built. The vectorisation factor needs the bounds check hoisted
out of counted loops, which is a backend range analysis rather than a runtime
change, and there is no lowering to consume it yet. Recording the number so the
representation decision is made against it rather than against my word.

## The general point

Three explanations, offered in order of how obvious they seemed, and the first
two were things that *are* costs and *were not* this cost. The instrument that
distinguished them was not a profiler -- it was one extra control that removed
a single property from the fast path. When two implementations differ by a
factor, the useful next measurement is usually a third one that differs from
each in exactly one way.
