# 0048 — An array that is empty and has room

`benches/cases/array-predicates` was 1.72x `std::vector`, the worst ratio on the
board after `substrings`. It is 1.13x now, and 0.60x node, and the two changes
that did it are both about `filter`.

This supersedes what 0043 says about how `filter` allocates. That description
was accurate and is no longer.

## The `memset`

0043 allocated the result as long as the input, filled it from the front, and
shortened it at the end. The array is **zeroed**, and 0043 gives the reason:
between the allocation and the shortening it is a live object with a length, so
a collection triggered inside the callback walks slots the loop has not written,
and zeroing is what makes that walk find nulls rather than whatever the
allocator last left there.

The reason is right. The answer was expensive:

    16,845,232 (16.39%)  __memset_avx2_unaligned_erms

A sixth of the benchmark, to zero an array most of whose slots are about to be
written anyway.

There is a cheaper answer to the same question. Allocate the room and then say
the array is **empty** — capacity is the input's length, length is nothing —
and append. The collector walks the length, so it never sees a slot the loop
has not reached; `push` cannot reallocate, because the capacity is already the
most the result could need; and there is nothing to shorten at the end, because
the length has been right the whole way.

It also deleted a merge. The two paths through the body used to disagree about
how many had been kept, which made the block they meet in take the count as a
parameter. The count is the array's length now and `push` maintains it, so
nothing crosses the join.

## The call that had to return nothing

`nts_array_keep_first` handed the array back, and `own::RUNTIME_HANDS_BACK`
named it so the caller would borrow. The caller could not: `borrows_safely`
gives up at a call, and what follows is the loop. So the result was `Copied` —
a retain and a release, on an array the function had just allocated and owned
outright.

`tooling/memory` said so immediately: 2 operations became 4, against a floor
argued at 2.

The fix is that the call has one job — say the length is zero — and no reason
to produce a value. A `void` function has no result to decide the ownership of.
Worth writing down because "hand the receiver back so calls chain" is a good
default that this is the exception to: the caller here is a lowering, not a
program, and it already has the array in hand.

## The other half

With the `memset` gone the profile read:

    75,867,662 (51.48%)  nts_array_push

Half the benchmark in a function whose whole body is a compare, a store and an
increment. `always_inline` on it: **3.73us to 2.19us**, past the `std::vector`
the row is measured against.

And a wrong turn worth keeping: `nts_array_reserve` is called from inside
`nts_array_push`, and marking it `noinline` — to keep the inlined push small,
which is the textbook move — made the row *worse* than not inlining at all
(4.03us). The compiler knows more about that tradeoff than the attribute does,
and the attribute that helped was the one that said less.

`nts_array_push_ref` is the same function for a reference element and is not
inlined. Nothing on the board reaches it, so there is no number for it, and a
number is what ships a change.

## Where the row sits

    before   3.73us   1.72x C++   0.90x node   0.83x bun
    after    2.17us   1.13x C++   0.60x node   0.53x bun
