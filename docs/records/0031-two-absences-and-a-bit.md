# 0031 — Two absences and a bit

The queue's third item: `boolean`, `null`, `undefined`.

Written in two sittings. The first had no working sandbox, so it could only
restate numbers already on record and name the two things that needed a run; the
second ran them, and both turned into changes. What the first sitting got wrong
is worth keeping: it called the audit finished with two items open, which is the
survey this goal names as its failure mode.

## Representation

Answered, and answered well, before this audit started. §7 has it:

- `boolean` is a machine bool. Not managed, not counted, not allocated, and
  nothing in the queue's three questions applies to it beyond saying so.
- `T | null` and `T | undefined` **cost nothing**. A reference has exactly one
  spare bit pattern and the null pointer *is* the tag, so the common case pays
  nothing for the distinction. `examples/nullable` is the proof and the
  `traversal`, `borrowed-call` and `shared-tail` memory cases are `Link | null`
  chains sitting at their floors.
- `T | null | undefined` has **two** absences and a pointer has room for one. It
  used to be given the pointer representation anyway, and answered `11` for
  `(v === null ? 1 : 0) + (v === undefined ? 10 : 0)` — a number JavaScript
  cannot produce. Two absences now select the erased representation, where each
  has a tag. Measured across the node profile at the time: 1,155 refusal sites
  either way, three moving in each direction. The correctness cost nothing in
  reach.
- The two tags sit adjacent to `NTS_TAG_OBJECT` on purpose, because `typeof
  null` is `"object"`: it keeps `typeof x === "object"` one comparison rather
  than a pair.

What the checker knows and we use: the *type*, to answer what the representation
cannot. A `string | null` compared strictly against `undefined` is always false,
and the pointer cannot tell you that — the type can, and does.

## Memory fit

`own::counted` answers **no** for `ConstNull` and `ConstUndefined`, in the same
arm as a static string and a frame-placed one. Neither is an object, both
retain and release return on their first line, and counting them was an
out-of-line call per occurrence to decide nothing. `List#isShorterThan` was the
case that found it: four of its six retains and four of its ten releases were
spent on a constant the compiler had written two lines above.

Storing an absence *into* a slot is a different question and has its own case:
`nulled-field` is `x.f = null`, at its floor at 17 operations, because the store
must still give up whatever the slot was holding. That one was a leak in every
program until it was found — `x.f = null` released nothing, under naive counting
too.

There is nothing to reuse in place, nothing to put in a frame, and no cycle a
`boolean` or an absence can be part of.

## Operations

One gap, named in §7, now closed.

    v?.length directly on a two-absence union is refused — the receiver is
    erased and the present branch does not unerase it.

Narrowing first worked in all three forms — `v !== null && v !== undefined`,
`typeof v === "string"`, plain truthiness — which is exactly what made this
look like a representation problem instead of what it was: a missing unerase on
one path. `Branch::Present`, two arms away in the same `match`, had been reading
the payload back all along.

It was two refusals rather than one, with different sentences and the same
cause. A string receiver came back "`length` of something without one"; an object
receiver came back "`value` on a union, whose members lay their fields out
differently", which is a sentence about a union containing exactly one object.
Neither names the actual problem, and that is how one bug reads as two unrelated
gaps in a histogram.

The read-back needed a licence, and it is not the one `narrowed` has. That
function reads what the *checker* narrowed, and asks `node_types` for the type of
the node it is reading. There is no such node here: the checker narrows nothing
inside `v?.length`, and the only type it records is `number | undefined` for the
whole expression, which says nothing about the receiver. The licence is this
lowering's own — `absence_of` emitted a test of the tag against exactly the
tags the receiver's type admits as absences, so the other arm holds one of the
union's non-absent members. `present_of` says that, and says why it is not the
other function.

It also found a correctness bug that was not its own. The example written to
prove the fix returns a class through two absences, which nothing in ninety-one
examples had ever done — and escape analysis handed the caller a pointer into
a dead frame with the object's fields already freed. Record 0032 has it. Closing
a refusal is how a shape nobody had written finally gets written, which is worth
more than the nine sites.

The `unerase` goes *inside* the arm rather than before the branch, which is the
whole point of having a branch:

    b1:  %10 = const undefined : erased
         jump b3(%10)
    b2:  %11 = unerase %1 : managed<str>
         %12 = array.len %11 : f64

**5,884 -> 5,875 refusal sites across the node profile.** 28 closed —
`err.stack` 15, `res.setHeader` 5, `stream.isTTY` 4, `immediate._onImmediate` 4
— and 19 uncovered directly behind them, where the value that now arrives
meets a second wall: `String()` of an erased type 15 times, and a method with no
declaration in the hierarchy 4 times. Two thirds of a closed refusal was a moved
one. That is the ordinary shape of this work, and the count is the only thing
that says so — the headline alone would have read as a win nine times
larger than it is.

## The three ratchets

- **correctness** — `examples/nullable`, `absent`, `unknown-truthiness`,
  `optional-access`, `typeof`, all in the differential. `absent` gained
  `optionalThroughTwoAbsences` and `optionalStringMember`, which are the `?.`
  fix above against node: 20 functions, 580 cases, agreeing.
- **memory** — `boolean-flags` at `0`/`0`, new and argued above;
  `nulled-field` at its floor; `counted` answering no for both constants;
  `T | null` adding no storage at all.
- **speed** — the four `erasure-*` rows, which measure the representation the
  two-absence union selects, at **1.00x C++** each. `erasure-typed` and
  `erasure-unknown` are 133.74us and 133.72us: the tagged representation costs
  nothing over the concrete one on that workload, which is the whole claim.

## The case `boolean` did not have

Its answer is "zero, and nothing to allocate", which the rule accepts — but the
rule asks for a case proving it, and there was none. `boolean-flags` is it, at
`ideal 0` and `allocated 0`, and it puts a boolean in the four places a value
gets charged rather than in a loop where nothing could have happened anyway: a
field of an object, a parameter, a return, and the payload of an erased slot.
Each of those is a mechanism that fires on a reference. `Gate`'s fields are
bools, so its `reference_fields()` is empty and the store gives up nothing —
which is the seventeen operations `nulled-field` costs, at zero.

## What writing it found

That the row could not have failed.

Being above a floor was a *note*. `run.sh` failed on a leak, on a changed answer,
and on a measurement *below* a floor — which catches an argument written too
optimistically — and printed "N above" in the margin for the opposite. So a
case that doubled its allocations exited green with a number nobody was obliged
to read, and the case above, whose entire value is "it would say so if this
stopped being true", would not have said so.

Above a floor is now a failure. Verified by making one fail: `nulled-field` with
its ideal moved to 16 reports `1 ops above` and the suite exits red.

The suite's own header had already predicted the state that made this matter —
"a suite whose cases are all at their floor on one column has stopped being a
ratchet, which is why there are two" — and both columns have now reached it,
on all 23 cases. So this restores half a ratchet and not a whole one: it refuses
a regression, and it cannot mark progress. The other half needs a question these
two columns no longer ask, and I do not have one. Naming that is the honest end
of this audit rather than something to leave unmentioned.

The cost is real and is written into the header: a case whose floor the compiler
has not yet reached can no longer be committed. `string-append` and
`readonly-anchor` were both written above their floors and closed in the same
sitting, so the workflow survives it — but it constrains the order the work
has to happen in.
