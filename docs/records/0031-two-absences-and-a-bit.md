# 0031 — Two absences and a bit

The queue's third item: `boolean`, `null`, `undefined`. Written with the Bash
sandbox unavailable, so nothing here is a *new* measurement — every number is one
already on record, and the one piece that needs a fresh run is named at the end
rather than assumed.

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

One gap, named in §7 and still real:

    v?.length directly on a two-absence union is refused — the receiver is
    erased and the present branch does not unerase it.

Narrowing first works in all three forms: `v !== null && v !== undefined`,
`typeof v === "string"`, and plain truthiness. So the refusal is a missing
unerase on one path rather than a representation that cannot answer.

## The three ratchets, from measurements already on record

- **correctness** — `examples/nullable`, `absent`, `unknown-truthiness`,
  `optional-access`, `typeof`, all in the differential, all green at the last
  full gate.
- **memory** — `nulled-field` at its floor; `counted` answering no for both
  constants; `T | null` adding no storage at all.
- **speed** — the four `erasure-*` rows, which measure the representation the
  two-absence union selects, at **1.00x C++** each. `erasure-typed` and
  `erasure-unknown` are 133.74us and 133.72us: the tagged representation costs
  nothing over the concrete one on that workload, which is the whole claim.

## What is not closed

Two things, and neither is a number I may assume.

`boolean` has no `tooling/memory` case of its own. Its answer is "zero, and
nothing to allocate", which the rule accepts — but the rule asks for a case
proving it, and a case is cheap. Not written here because its floor has to be
argued against a measurement and the suite cannot be run.

And the `v?.length` refusal is a change with a number attached that has not been
made: unerasing the present branch of an optional chain. It belongs to this
primitive and is the one item that would move a count.
