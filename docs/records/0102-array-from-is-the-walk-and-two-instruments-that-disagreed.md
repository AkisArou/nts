# `Array.from` is the walk, and two instruments that disagreed

`Array.from(xs)` handled one case: `xs` already an array, lowered as `slice`. A
typed array was refused by name, a string was refused, a `Set` was refused — and
those are **eight of the ten `Array.from` calls in `runtime/node`**. The one
case it did handle is the one with `[...xs]` as an alternative.

It is the walk. `walk_of` already knows how to iterate six things, and it is the
same function a `for...of` asks, so this is a loop over it with an append where
the body would be. Generators, which landed this morning, arrived here for
nothing.

## Three numbers, and only one of them said what I expected

**The array fast path stays, and I read its number wrong first.** Removing it
measured 1.05 ms against C++'s 43.19 us and I wrote "24.67x, the walk is 24x a
memcpy". It is not: with the `slice` restored the same row is 782 us, so the
*walk* costs **1.34x** the slice and the 17.7x is the array copy itself, which
predates all of this. The specialization is worth keeping and it is worth
1.34x — a real number, and a fifth of the one I nearly wrote down.

**Sizing the result from a known length changed nothing at all.** Three of the
six shapes know how many elements are coming before they start: an array and a
typed array from their length, a `Map` or `Set` from its live entry count, which
is the same `Length` because a table keeps it in the header field an array uses.
Sizing the result there rather than growing it by doubling:

    Array.from(set), 256 elements x 2000    2.66 ms growing    2.70 ms sized

That is no change. The hypothesis — nine reallocations per round, each copying
everything written so far — was wrong about what it cost: doubling makes the
total copy about one extra pass, and one extra pass over 2 KB is not the
bottleneck.

**The allocation count changed by nearly half.**

    tooling/memory/cases/array-from    9 allocations growing    5 sized

So the change is kept, and it is kept on the second instrument's evidence with
the first one's silence written beside it. This is 0091's finding again from the
other side: there, three costs were each found by an instrument not built for
them; here, one change is invisible to the instrument that would normally
decide it. **A timing harness cannot see four allocations in a warm allocator,
and a counting harness cannot see anything else.**

## The floor I argued was wrong, and being wrong is where the case got its point

Argued before measuring: two allocations — the `Set`, and the array, which *is*
the answer. Measured five.

The three extra are the `Set`'s own table, grown 0 → 8 → 16 → 32, because
`nts_map_rehash` takes `used * 2` with a floor of eight and nothing tells a
`Set` how many elements are coming. Which is precisely the cost the change
removes from the *array* — the same shape, one object over.

So the case is better for having been argued wrong: it says five, and it says
which one of the five is `Array.from`'s.

The operations floor moved too, and in the direction I had not written down.
`closure-capture` states the rule as *an allocation floor of zero forces an
operation floor of zero*. The converse holds and I had not said it: two heap
objects are made here and both die in the function, so **two** is the floor, not
zero. An allocation floor above zero forces an operation floor at least as high.

## The regression I shipped for an hour, and the test that now names it

The fast path guard was `Array(_)`. A `Uint8Array` is `ManagedType::Array` too,
and `slice` moves eight bytes or a word where one holds a byte — so
`lower_array_copy` refuses it by name. `Array.from(u8)`, which the walk had
made work an hour earlier, went back to *a copy of a typed array is not
supported*.

Caught by this feature's own example, in the run after the one that added the
fast path. The guard is now the two element widths `slice` actually reads, and
`a_typed_array_source_walks_instead` asks for the typed source specifically
rather than for "an array" — because "an array" is exactly the word that was
wrong.

## What the row says, including the part that is not good

    case         C++         nts C      nts LLVM   node        bun       nts/C++   nts/node
    array-from   538.30 us   3.65 ms    3.53 ms    492.66 us   1.27 ms   6.56x     7.17x

**Slower than node**, and it is worth saying plainly rather than reporting the
half that improved. Decomposed by building each half alone:

    Array.from(array), sliced    43.11 us C++    782.25 us nts    17.72x
    Array.from(set),   walked   496.54 us C++      2.70 ms nts     5.44x

The array half is the worse ratio and the smaller absolute number.
`nts_array_slice` is already `nts_array_new_uninitialized` plus a `memcpy`, so
there is nothing in the copy to improve: 391 ns per 2 KB array against C++'s
21 ns, where a 2 KB `memcpy` is about 50 ns. **The gap is the allocation, not
the copy**, and that is named work with a number rather than something to fix
inside a change about iteration.

## The ledger went 40 to 41

One ✅ arrived and one ✗ with it: `Array.from` with a mapping callback, or over
an array-like. The two-argument form is two features wearing one name — with an
iterable it is `map` fused into the walk, and with `{ length: n }` it is not an
iteration at all, since an array-like is read by index and
`Array.from({ length: 4 })` builds four `undefined`s out of an object that has
no elements. Both are in `runtime/node`. The `◐` that stood here is now about
the constructors and the spread, which still want an array.

## Ratchets

- `examples/array-from` — 361 cases against node on C, LLVM and under counting:
  an array (and that the copy is not an alias), a typed array, a string whose
  code points outnumber neither its units nor match them, an empty string, a
  `Set`, a `Set` with a hole in it, a `Map`'s keys and values, a user type with
  `[Symbol.iterator]`, a generator, managed elements, three kinds of empty, the
  same source twice, and one `Array.from` inside a loop over another.
- `examples/array-from-unsupported` — the two-argument form, both meanings.
- `compiler/core/tests/array_from.rs` — five tests, four mutations. Widening the
  guard to "an array" fails one; removing the fast path fails another; sizing
  nothing fails a third; and sizing a **string** by its length fails a fourth
  **and 29 differential cases**, which print the surrogate pair split in half.
- `tooling/memory/cases/array-from` — 5 / 2, argued at 2 / 0 and corrected.
- `benches/cases/array-from` — 6.56x C++, 7.17x node, decomposed above.
