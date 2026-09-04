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

**The array fast path stays, and it is worth 8.7x.** Both numbers below are
under reference counting, which took two goes to get right — see *The benchmark
that measured page faults* below, where the first version of this paragraph
said 1.34x.

    Array.from(array), 256 elements x 2000    C++ 41.65 us
      sliced    53.07 us    1.27x C++    0.45x node
      walked   462.77 us   12.18x C++    3.80x node

A `slice` is a memcpy of one run of memory whose length is known before it
starts; the walk is a bounds check, a load and a store per element, and a
release of the array it replaces. **Sliced, `Array.from(array)` beats node.**

**Sizing the result from a known length changed nothing at all.** Three of the
six shapes know how many elements are coming before they start: an array and a
typed array from their length, a `Map` or `Set` from its live entry count, which
is the same `Length` because a table keeps it in the header field an array uses.
Sizing the result there rather than growing it by doubling:

    Array.from(set), 256 elements x 2000    1.86 ms growing    1.84 ms sized

That is no change. The hypothesis — nine reallocations per round, each copying
everything written so far — was wrong about what it cost: doubling makes the
total copy about one extra pass, and one extra pass over 2 KB is not the
bottleneck. **Measured again under the correct provider afterwards, and it
holds**: this is the one conclusion in this record the provider mistake did not
move.

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

## The benchmark that measured page faults, and the four claims it made me retract

Every number in the first version of this record was measured under a build
**that never frees**. `benches/cases/array-from` allocates an array per
iteration and I did not give it a `provider` file, so it ran under `NoGC` — and
`provider_for` in `tooling/bench/src/main.rs` says exactly what that does:

> A case that allocates per iteration declares `rc` in a file beside its
> `tsconfig.json`; the default is `NoGC`, which never frees, so a run calibrated
> to a hundred milliseconds of work would **measure page faults rather than the
> code**.

The harness documented the trap and I walked into it anyway, because I wrote the
case before I had a reason to think about reclamation. Measured: **2.5 GB peak
RSS and 623,845 page faults** for 1.2 million array allocations, in a program
whose live set is two arrays.

Four things I had written down were wrong, and they were wrong in both
directions:

- **"The gap is the allocation, not the copy."** Retracted entirely. There is no
  gap: `Array.from(array)` is **1.27x C++ and 0.45x node**. It beats node.
- **"The fast path is worth 1.34x."** It is worth **8.7x** — 462.77 us walking
  against 53.07 us slicing. Under `NoGC` both were dominated by page faults,
  which flattened the difference to nothing.
- **"The row is 6.56x C++ and 7.17x node."** It is **3.51x and 3.82x**.
- **"391 ns per 2 KB array against C++'s 21 ns, where the memcpy is 50 ns."**
  That arithmetic was sound and its premise was a leak.

The correction cost two more wrong answers on the way, and both are the same
mistake in miniature. I raised the recycler's ceiling — `NTS_CLASSES 65u`, one
thousand and twenty-four bytes, and the array in question is two thousand — and
measured no change, twice, **on a program where the array copy was a fifth of
the work and then on one where nothing was ever freed**. Then I built with
`NTS_NO_RECYCLE` as a control and got the identical time and the identical page
fault count, which is the reading that finally said the knob had never moved.

That control is the thing to keep. The JVM session had just told me the same
rule from the other lane — *verify the knob moved before trusting what it says*
— after "refuting" an inlining theory with flags that changed no inlining
decision. Two sessions, two instruments, one afternoon.

## What the row actually says

    case              C++         nts C     nts LLVM   node        bun       nts/C++   nts/node
    array-from (rc)   511.00 us   1.80 ms   1.80 ms    470.32 us   1.20 ms   3.51x     3.82x

Still slower than node, and decomposed the cost is not where I looked for it:

    Array.from(array), sliced    41.65 us C++    53.07 us nts    1.27x    0.45x node
    Array.from(set),   walked   476.87 us C++     1.73 ms nts    3.79x    5.16x node

**The table walk is the whole of it**, and `perf` says so directly rather than
by subtraction: `nts_map_key_at` 27.8% and `nts_map_next` 23.3% — **51% of the
program in two runtime calls per element** — against `nts_array_slice` at 0.36%
and `nts_array_allocate` at 0.51%.

Both are `nts_runtime.c` functions called from generated C, so neither inlines
without LTO, and the two of them touch the same slot twice: one scans forward
for a live entry and the other loads its key. That is named work with a number
and a location, which is what the allocation claim above was pretending to be.

The profile took one command and I ran it after four hypotheses rather than
before one.

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
- `benches/cases/array-from` — 3.51x C++, 3.82x node, decomposed above, **with
  a `provider` file** saying `rc`, which is what a case that allocates per
  iteration has to declare.
