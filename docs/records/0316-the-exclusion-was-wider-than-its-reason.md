# The exclusion was wider than its reason

`forward_stores` refused every `managed` load. The refusal was right, the reason
for it was right, and it was **wider than its reason** — which is a different
mistake from being wrong, and harder to find, because everything written down
about it is true.

## What the reason said

A reference load *takes*: the slot is overwritten before anything else reaches
it, so the reference moves out rather than being copied and the overwriting
store owes nothing. Forward it and the loaded value is a second live reference
at the moment of the overwrite, so the store now owes a release and the object
can no longer live in the frame. `tooling/memory/cases/subclass-field` went from
**0 allocations to 17**, having agreed with node throughout — which is why the
`memory` step caught it and no differential could have.

Every sentence of that is about a **count**. None of it is about a load.

## Three values have no count

`own.rs::counted_here` already answers `false` for `ConstString`, `ConstNull`
and `ConstUndefined` — static data the runtime treats as immortal, nothing to
retain and nothing to give back. A store of one owes no release because there is
no release to owe. A second live reference to an immortal is not a second
anything.

So the exclusion never needed to cover them, and the pass had been declining a
load it could always have removed.

## Not a second list

The obvious fix is to write the three names into `simplify.rs`. That is exactly
the failure `own.rs` records against itself twelve lines above its own list:
*"two lists deciding one question and disagreeing about three of its cases."*

What went in instead is a strict **subset** of `counted_here`'s answer with the
reason the subset is proper stated at the site. `counted_here` says `false` for
two more — `ClosureStatic` and a frame-placed `Call` — and they are left out
deliberately: a frame-placed result is frame-placed *because*
`place_allocations` proved it does not outlive the frame, and extending its live
range is that pass's reasoning, not a redundant-load rule's. Which is the
ownership paragraph again, one pass over.

## What it removes

Field loads in the prepared HIR. Each count is over that module's **whole cone**,
so these are per-compilation figures and do not sum:

    fs       1995 -> 1778   (-217)     events    1050 ->  928   (-122)
    http     2139 -> 1934   (-205)     os         138 ->   82    (-56)
    process  2089 -> 1873   (-216)     timers     167 ->  144    (-23)
    stream   1596 -> 1413   (-183)     buffer     124 ->   69    (-55)
    util     1064 ->  942   (-122)     path        41 ->   35     (-6)

Ten of ten moved. `tooling/memory` is **green** across every case — nothing
leaked, no answer changed, every case at both floors — which is the step that
refused the previous attempt at this and the only one that could have seen it.

And against the table `examples/a-field-read-after-its-own-write` has carried
since the `memory` step refused "forward every managed load":

    no pass            util 1066    buffer 124    timers 167
    forwarding all     util  931    buffer  68    timers 142   <- refused, 0 -> 17 allocs
    scalars only       util 1064    buffer 124    timers 167
    + immortal consts  util  942    buffer  69    timers 144   <- this

**122 of the 135 the unsound version removed in `util`, 55 of its 56 in
`buffer`, and 23 of its 25 in `timers` — at no allocation cost.** The header's own framing — "216 loads of which
214 were managed references" — is true, and reads as though excluding references
cost nearly all of it. It cost about a tenth. The count that was quoted to
justify the restriction was a count of the *kind* of load, and the restriction
was about ownership, which only some of that kind have.

The `scalars only` row was re-derived before the other two were quoted: 1064,
124 and 167, matching exactly. That is what licenses quoting rows that cannot be
re-derived without reverting the pass twice, and it is the check
[[0309]] says a stale figure needs — row 309 of the ledger quoted 87 cases where
the example ran 116, found the same day by running it instead of reading it.

## The number in the comment was wrong before anyone else saw it

The shape that prompted this is a `throw`: a provided error is built with its
message in field 0 and the message is read straight back out to hand to
`nts_uncaught`, because a descriptor records where an object's references are
and not what they are called, so the runtime cannot read a `message` field and
the compiler can.

The comment first said **717 sites**, which is the number of `throw new X(...)`
in `runtime/node`. The compiler disagreed: a user-defined error class stores its
message inside its own **constructor**, so a `call` sits between the store and
the load and clears the aliasing map — correctly, since a call can write any
field. 608 of the 717 are that shape, 263 of them `ERR_INVALID_ARG_TYPE`. The
pattern is **109**.

717 was a count of the source construct being read as a count of the pattern.
That is the same unit error as the 1597 that started the evening — `nts_uncaught`
occurrences summed over seven module cones, where a throw in `internal/errors.ts`
is counted once per importing module — made twice in two hours, the second time
into a comment that would have outlived the conversation that produced it.

**A load count is not a time**, and none is claimed. On C and LLVM clang removes
most of these itself. What the count buys is `hir::simplify`'s own stated
argument for existing — a load that has to exist is a value liveness tracks,
escape analysis follows and reference counting places — and the one lane where
the instruction is the artefact is the JVM, where this is 2 dex units on the
method that found the pass.
