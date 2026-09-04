# 0052 — The operations axis of array, closed

The array primitive's audit closed its representation and memory axes in 0038.
Its **operations** axis did not: methods went in as they were wanted and each
was checked against node, which is one ratchet of three. Correct and unmeasured
is not done, and eleven of them were exactly that.

This closes it. What follows is the second and third ratchet for `shift`,
`unshift`, `splice`, `concat`, `[...xs]` and `Array.from` — the six added
recently with correctness alone.

## Memory: `tooling/memory/cases/array-mutations`

Argued first, then measured, and the argument was right:

    ideal 5    allocated 9

Five, because five arrays exist at the end and each is released once. The
elements are numbers, so filling the array, moving its elements about and
copying them into four more costs no operation at all.

**Not `shift` and not `unshift`.** Both move elements within an array that
already exists — `shift` takes the first and slides the rest down, `unshift`
slides them up and writes the front — so neither makes anything and neither
counts anything. The case exists to say that in a number rather than in a
comment, and `unshift` is the one that could have been otherwise: it needs room
at the front, the array is contiguous, and the obvious way to write it allocates
a longer block. It does not, because `nts_array_reserve` has already made room
at the *end* and moving the elements up one is the same `memmove` either way.

Nine allocations: five for `xs` — one header and the four blocks a `push` loop
grows through, the same four `array-of-objects` pays — and one each for
`splice`, `concat`, spread and `Array.from`. One each is the claim: every one of
them hands back a new array and so must allocate, and every one allocates the
whole result at its final length, so the elements live inline and there is no
growth and no second block.

## Speed: `benches/cases/array-mutations`

A queue with a window — appended at the back and taken from the front, inserted
at the front and cut out of the middle, and the state copied twice — against
`std::vector` with `erase(begin())`, `insert(begin(), v)` and the constructions.

The row opened at **1.34x** that vector, and profiling found two things.

**A `memset` of the whole answer, thrown away.** `slice`, `splice` and `concat`
allocated with `nts_array_new`, which zeroes, and then wrote every slot. Five
sites moved to `nts_array_new_uninitialized`: 811.7ns to 717.3.

That the slots really are all written is *checked* rather than argued.
`NTS_POISON` fills an uninitialized allocation with `0xA5` instead of leaving it
zero, precisely so that "every slot is written" stops being a sentence, and the
whole example suite agrees with node under it — 86 of 86.

**A function call to ask whether an array was full.** `nts_array_reserve` was
12.5% of the row. It is two things wearing one name: a *check*, which runs on
every append and is a load and a compare, and a *growth*, which is a `malloc`
and a copy of everything and happens log n times. Split, with the check inlined
and `nts_array_grow` marked `NTS_NOINLINE`: 717.3ns to 606.3.

The split is the whole of it, and 0048 has the evidence for why: marking the
*whole* of `nts_array_reserve` `noinline` was tried there and made
`array-predicates` worse than leaving the compiler alone — because that forced
the check out of line too, and the check is what runs every time.

    before   811.7ns   1.34x C++   0.46x node   0.22x bun
    after    606.3ns   1.05x C++   0.36x node   0.17x bun

`array-predicates` came along for the second change: 1.13x C++ to 1.09x.

## Where the ceiling is

1.05x `std::vector` is close enough to be worth naming rather than chasing. What
is left is the header: our array is a header and a pointer to its elements, and
a `std::vector` on the stack is three pointers with its elements in one
allocation the caller made. The remaining 5% is that indirection, and removing
it is a representation change rather than an operation one — which is axis 1,
and 0038 argued it the other way for a reason that still holds: an array object
that never moves is what lets it grow under a reference someone else is holding.
