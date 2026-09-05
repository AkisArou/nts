# 0137 — The profile said eleven percent and the machine was already issuing at width

`map-and-set` is 1.88x hand-written Java and 62.9% of it is inside `NtsMap`.
The two largest entries dispatch on a tag before they can do anything:

    20.30%  NtsMap.set
    11.12%  NtsMap.hash
     8.81%  NtsMap.sameKey

`hash`'s number arm canonicalises `-0` with a select, calls
`Double.doubleToLongBits` -- which canonicalises NaN, so it is a branch and not
a bitcast -- folds the two halves, then multiplies. The reference's
`Integer.hashCode` is `return value`.

Every key a JS map of numbers holds is an integer in practice; `map-and-set`
keys on `i * 7`. For one, `(int) num` is a valid hash, because equal values
narrow to equal ints and that is the whole of what a hash owes `sameKey`. It
gets `-0` for free -- `(int) -0.0` is `0` and `0 == -0.0` holds -- and NaN falls
through to the decode that canonicalises it.

**This is the same cast-first shape that paid on `toInt32` and on `bounds`
today, and it is worth exactly nothing.**

## The measurement

Correct first: 8 million random double pairs, 400,000 integers and a pool of
awkward values, checking that keys the map calls equal hash the same. No
disagreements, both zeroes included.

Then two jars differing in nothing else, interleaved:

    bit-fold (old)   9304  8968  9359  8857  8906  8881
    cast-first       9649  9586  8902  8926  8856  8893

**8857 against 8856.** Nothing.

## Two explanations, both wrong, and the number that killed each

**The profile is attributing stalls, not arithmetic.** Testable: if the samples
in `hash` were its ALU work, removing work would lower its share.

       11.12%  ->  15.28%

It went **up**, on a row whose wall time did not move. That is consistent with
stalls -- and with something else.

**So the row is memory-bound.** `perf` says otherwise, and emphatically:

    map-and-set   16.36e9 instructions / 4.34e9 cycles   IPC 3.77
    checksum       5.06e9 instructions / 3.38e9 cycles   IPC 1.50

**IPC 3.77 is near this core's issue width.** The row is not stalling on memory;
it is issuing about as fast as the machine can. And with the cast-first hash it
is 3.78 -- the same.

## What is actually true, and why the discriminator I wrote this morning is not
## enough

Record 0133 ends with: the changes that paid replaced *work*, the ones that did
not were removing a call something had already removed. This change replaces
work and pays nothing, so that rule does not separate them.

The rule that does: **work costs time only if it is on the dependency chain.**
At IPC 3.8 there are issue slots going spare, and the hash's arithmetic was
filling them. The critical path is the probe loop -- load a bucket, compare,
branch -- and the hash finishes long before the load it feeds does.

`toInt32` and `bounds` paid because their work *was* a serial chain whose result
everything waited on: an exponent decode feeding a shift feeding a result, with
nothing to overlap it with.

**A profile reports attribution, not criticality**, and cannot tell those apart.
Neither can IPC on its own -- it says whether slots are spare, not which
instructions are on the chain. What settles it is building the change, which is
the third time today that has been the only instrument that worked.

Reverted.
