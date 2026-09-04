# 0043 — Four methods that are loops

`forEach`, `map` and `reduce` were already compiled as the loops they are:
the callback inlined, no closure allocated, no indirect call. `some`, `every`,
`findIndex` and `filter` are the same shape and were refused, and adding them
turned out to be adding one thing — a way to leave early — and then one more
for the only one of the four that allocates.

## What they share, and what they do not

The existing three differ in exactly one thing: what happens to the value the
body produces. `CallbackResult` is that difference, and it is one type rather
than a branch in three places so that a `return` inside a block body works the
same in all of them.

The four new ones need two things the old three did not.

**An early exit.** `some` stops at the first `true`, `every` at the first
`false`, `findIndex` where it finds. All three leave the same way: branch on
what the callback said, write the answer on the side that leaves, and go out
through the block `break` goes out through — carrying what the loop carries, so
the answer merges with the one the header would have reached had it run out of
elements instead. That is `stop_early`, and `exits_on` is the only thing that
differs between them.

**A merge.** `filter`'s two paths disagree about how many have been kept, so
the block they meet in takes the count as a parameter. That is what an `if`
does for any name its arms write, and it is why the cursor cannot be rebound
the way `some`'s answer is: the path that writes it comes back.

## The bug that a flat map makes

`bindings` is one map and not one per block. A name written on a path that ends
in a jump is still written after it, so the loop went on reading a value defined
in a block that no longer dominated it — twelve `NotDominated`s, one per
function in the example. The fix is two lines: remember the binding, put it back
after switching to the block that stays. It is written down beside `stop_early`
because nothing about the code says it, and the next person to add one of these
will reach for the same shape.

## What `filter` costs

One allocation, and that is the claim `tooling/memory/cases/array-methods`
makes. The result is allocated as long as its input, filled from the front, and
shortened by `nts_array_keep_first` — so the elements live inline in the header
block the way every sized array's do.

Growing the result with `push` is the other way to write it and is what a
hand-written loop does. It would pay a block every time it doubled, which for
this case's input is four more.

The array is **zeroed**, which `map`'s is not, and the difference is which slots
get written. `map` fills every one; `filter` fills a prefix. Between the
allocation and the shortening the array is a live object with a length, and a
collection triggered inside the callback would walk slots the loop has not
reached — so zeroing is what makes that walk find nulls instead of whatever the
allocator last left there.

`nts_array_keep_first` hands back the array it was given, so it is named in
`own::RUNTIME_HANDS_BACK` and the caller borrows what it was already holding.
That convention is one commit old; this is the first thing written against it.

## An instrument that could not see an array grow

Building the memory case found the same hole `nts_map_rehash` had.
`nts_array_reserve` never called `nts_note_allocation`, so an array's header was
counted and the block holding its elements was not — the allocation column read
the same number for an array of four and an array of four thousand.

The bytes were already right. The paragraph beside them says they were added
because a leak was invisible without them, which is the same argument one column
over, made once and not twice.

Counting them moved exactly one floor. `array-of-objects` reads 22 rather than
18: seventeen cells, the array, and the four blocks it grew through at
capacities 4, 8, 16 and 32.

**Eighteen is what it should be.** The loop's trip count is `16 + n`, known
before the loop starts and already computed by `hir::loops`. An array filled
once per iteration by a loop of known length could be *made* at that length
instead of grown to it, and its elements would live inline. That is written into
the case's `expected` as an argument rather than left as a number nobody
justified — the floor is 22 because 22 is what runs, and it moves when the
compiler earns it.

## The three ratchets

**Correctness.** `examples/callbacks` grew from 27 functions to 40; 1160 cases
against node, agreeing on every one. Both backends, with reference counting and
without.

**Memory.** `array-methods` at 2 operations against a derived floor of 2, and 6
allocations against 6 — argued before it was measured, and matching.

**Speed.** `benches/cases/array-predicates`, against `std::vector` with
`any_of`, `all_of`, `find_if` and `copy_if`.
