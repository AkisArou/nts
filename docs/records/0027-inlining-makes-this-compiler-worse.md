# 0027 — Inlining makes this compiler's analysis worse

Written after building the pass, measuring it, and deleting it. The result is
the opposite of the premise, and the reason is worth keeping.

## The premise

Every interprocedural fact in this compiler is a summary of a body it could
have read. `mutating` says a function stores, not what it stores into.
`consumes` says a parameter is taken, not on which path. `stores_into` --
added the day before this -- says one parameter went inside another and hands
the lifetime question to the caller. Each is an approximation, and a copied
body needs none of them, because there is no call left to summarize.

The measurable half was supposed to be allocation. `tooling/memory/early-return`
is a factory called in a loop:

    function maybe(v: number): Box | null {
      const made = new Box(v);
      if (v % 3 === 0) { return null; }
      return made;
    }

The `Box` dies inside the iteration that made it and is on the heap anyway,
because placement runs per function and the allocation is in the wrong one.
`0025` named this as the case needing "the caller's frame to host a callee's
allocation". One body, one frame, one placement.

## The measurement

Direct calls only, to a body that cannot reach itself, at most 32 values and 6
blocks, parameters substituted rather than copied, `Return` rewritten as a jump
to a continuation whose block parameter *is* the call's own value -- so every
existing reader of the result stays correct without being touched. It compiled,
it verified, and the C it produced was right.

    borrowed-call     33 -> 132 operations
    traversal         33 -> 132
    local-anchor      17 ->  68
    shared-tail        3 -> 109
    pile-shuffle       9 -> 137
    early-return      17 ->  17

The last row is the case it was built for.

## Why

Because the facts this compiler proves are **whole-function and
all-or-nothing**, and merging bodies means the worst statement in any of them
decides for all of them.

`stores_are_aimed` returns one `bool` for an entire function: false if *any*
`FieldSet` in it writes through something that is not an allocation or a
parameter. `inert_slots` returns an empty set on the same condition. Both are
preconditions for `still_zero`, which is what proves a store writes over a zero
-- and a store over a zero disconnects nothing, so it needs no release. That
single fact is what lets a list be built without counting, and it is why
`borrowed-call` was at 75% elided.

Inline `chain` into `total` into `work` and one store through a loop-carried
tail -- `tail.next = made`, the ordinary way to build a list -- turns that bool
off for the whole merged function. Every other store in it, every borrow across
every call, pays for that one. Four bodies that each proved their own facts
became one body that proves none.

Small functions are not an obstacle to this compiler's analysis. They are the
unit it reasons in, and each boundary is a place a fact gets to be local.

## What it found on the way

Inlining `borrowed-call` put the list's head in the frame and leaked all 32
links behind it. `rc::release_value` gives a frame object no count to reach
zero, so it walks the reference fields and releases each -- at the point **the
value's live range ends**. Hand that pointer to a block parameter and the duty
is attached to the wrong value: the parameter's release is a release of a
pointer, which returns immediately for immortal storage, and nothing walks the
fields.

The parameter cannot own the duty either. It carries a frame object on one edge
and a heap one on another -- a list walk starting at a local head and
continuing through allocated links is exactly that -- so there is no single
answer for it to have.

Refusing to place an object that is carried on an edge fixes it and costs a
real allocation: `loop-break` hands a frame object to a block parameter today,
does not leak, and would go to the heap for a shape nothing produces. So that
is not the answer either. The answer, if the shape ever becomes reachable, is
to attach the duty to the **frame** rather than to the value -- destruction at
every exit and before every reuse, which is what a scope-bound resource has and
what a live range only approximates.

Nothing produces it today. This is written down so that whoever meets it knows
it was seen, and knows the cheap fix was measured and refused.
