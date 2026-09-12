# The comment stated the general rule and the code did not

`same_array` decides whether two SSA values name one array, which is what lets
the bounds prover use a length read in one place to bound an index used in
another. Its own doc comment says:

> Two loads of one global are two SSA values and one array.
> `for (i = 0; i < A.length; i++) A[i]` reads a module-level `A` twice, once for
> the length and once for the element, so comparing the ids alone left every
> bounds check standing — while the identical loop over a *parameter* had none,
> because there the array is one value.
>
> Sound while nothing writes that global.

Every sentence of that is about **re-reading one location**. The code matched on
`GlobalGet` and nothing else.

## What it cost

    for (let i = 0; i < this.bodies.length; i += 1) {
      const b = this.bodies[i];

Two `field.get` of one field on one object — the same shape the comment
describes, one storage class over. The prover saw two arrays and kept every
check.

Found by the JVM lane in `awfy-nbody`'s AOT code rather than by anything here:
**982 bytes of machine code against the hand-written reference's 647**, on
identical arithmetic — 19 `mul-double`, 8 `add-double`, 6 `sub-double` on both
sides — with 3 `invoke-static` to `NtsRuntime.bounds` and 2 `pThrowArrayBounds`
in the innermost loop. In release dexing we are 21% *smaller* than the reference
and 1.19x slower, which is what made it worth looking at: not size, not
allocation, and not devirtualisation, all three of which had been eliminated
first.

## The control was in the same file

`sumThroughALocal` — the identical loop through `const items = this.bodies` —
was already proved. That is what says the prover works when it can see, and it
is why the defect reads as "the prover is weak here" rather than "the prover is
broken".

Measured either side, on the real case:

    HEAD   NBodySystem#advance   1 array read proved of 3
    after                        3 of 3

## The time, on the lane that can be timed here

    awfy-nbody        C++        nts C
    HEAD             7.03 ms    6.59 ms
    after            7.21 ms    6.73 ms
                     +0.18      +0.14

**No measurable change, and the control is what says so.** The C++ column is a
fixed reference binary this change cannot touch, and it moved by *more* than the
nts column did. One pair of sittings with the reference drifting 2.6% is a noise
floor above any signal, so the honest reading is that the native lane does not
show this — not that it shows a small win.

That is the inverse of the trap the JVM lane hit on `outlined2`, where a ratio
improved because its denominator got worse. Here the denominator moved and the
numerator moved with it, and only the absolute columns say so.

## And on ART it is the whole gap

    NBodySystem$advance, AOT machine code

                            before      after     reference
    code size            982 bytes   647 bytes    647 bytes
    calls                       16          8            8
      pThrowArrayBounds          2          0            0
      call [rdi + 32]            2          0            0
      pResolveType               1          0            0
      pInitializeStaticStorage   1          0            0

    timing            JIT 1.19x -> 1.00x     AOT 1.22x -> 1.00x

The hot method is now **the same size as the hand-written Java's, to the byte,
with the same call profile.** Not close — equal.

**It also answers a claim that had stood unmeasured.** `subscript`'s doc has
said since it was written that `checked: false` leaves the JVM's own mandatory
check as the only one, "eliminated in a counted loop, which is where this lane
is cheaper than the native one". Nobody had checked the second half. Zero
`pThrowArrayBounds` in the emitted code is ART doing exactly that: the two
checks were never additive — **ours was preventing the elimination of the one it
duplicated.**

And four of the eight calls that vanished were not bounds at all.
`NtsRuntime.bounds` is a static on another class, so removing the call took its
class-initialisation check with it: `pResolveType` and
`pInitializeStaticStorage` were the guard's shadow rather than the guard.

So the native measurement above is not the row being small — it is the native
lane being the wrong place to look, which the 6.59-against-7.03 control already
said.

The result is the proof count, established by two independent instruments —
`hir --prepared` here and `oatdump` there. Whether the space it leaves is worth
time is a second question and belongs on ART, where the guard is three
`invoke-static` and two `pThrowArrayBounds` in the innermost loop and where
removing ours lets the platform's own mandatory check be the only one. That is
the half `subscript`'s doc promises and nobody has measured; it is not
answerable on this lane, because here the guard is already a compare and a
branch the hardware predicts.

Worth noting what the control also shows: on this case **nts C is faster than
the hand-written C++** — 6.59 against 7.03 — before the change. The native lane
was never where this row was losing.

## What it is not

A general redundant-load elimination, which is the other thing this shape asks
for and which would serve `lower_throw`'s `detail` read as well. That is a
bigger change. This one extends a predicate that already existed to the storage
class its own comment describes, which is the smallest thing that is also the
right thing.

## Soundness, and where it is narrower than the global arm

`nothing writes that field` is asked of the whole function, not of the span
between the reads — the coarser question the global arm already chose, and it
needs no ordering.

Two differences from that arm, both deliberate:

**Narrowed by the holder's type.** A slot number means nothing alone: `body.vx =
…` writes field 0 of a `Body`, and without the type test it would veto a proof
about field 0 of an `NBodySystem` — which is every interesting loop, since the
array being walked and the elements being mutated are the common shape.

**The object must not reach a call.** A callee could write the field from the
other side. The global arm does not ask this and *is* exposed to the same thing
through a callee; this one asks because the shape it exists for is a receiver in
a loop, and a receiver is passed to things far more often than a module global
is assigned.

The guard is a fixture rather than an argument: a loop that reassigns the field
inside itself stays checked, and it is in the example beside the two that do not.

## The general form

This is the sixth time in one session that one fact had two derivations and they
disagreed — after `owns`/`hands_over`, the C and LLVM frame headers,
`cyclic_layouts` following declared types where values are stored, two LLVM
floors from one number, and `presence::of` against the checker's property order.

But it is the first where **the general rule was already written down, in the
right place, above the code that did not implement it**. The others needed
someone to notice a fact was being derived twice. This one needed someone to
read four lines of comment and then four lines of code.
