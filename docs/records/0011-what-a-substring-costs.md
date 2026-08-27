# 0011 — What a substring costs, and what a view would be worth

Every benchmark in the suite sits between 0.43x and 1.85x of hand-written C++.
Slicing sits at 6.64x, which makes it the largest single gap in the project —
and slicing is what a parser, a tokenizer, and a CSV reader do all day.

This records what the gap is made of, because three quarters of it turned out
not to be the thing it looked like.

## The benchmark

`benches/cases/substrings` splits a sentence into words and looks at each one:
`text.substring(start, i)`, its length, its first code unit. Nothing else. The
C++ reference does the same over a `std::string_view`, whose `substr` returns
another view of the same characters and allocates nothing.

## The decomposition

| | ns/op | vs C++ |
| --- | ---: | ---: |
| as found | 22,950 | 10.31x |
| one allocation instead of two | 18,950 | 7.56x |
| under reference counting rather than NoGC | 13,750 | **6.64x** |

**Two allocations became one.** `nts_str_range` allocated a `uint16_t` staging
buffer, filled it a unit at a time through `nts_unit` — which branches on the
string's width for every character — handed that to `nts_str_alloc`, which
scanned it for wide units and narrowed it back, and then freed the buffer. Two
allocations and three passes to copy some bytes. A slice of a narrow string is
narrow and a code unit is one byte in both, so it is one allocation and one
`memcpy`. Worth 17%.

**The provider was wrong for the shape.** Under NoGC nothing is ever freed. A
thousand substrings per call across five thousand calls is a quarter of a
gigabyte of fresh pages, and what the benchmark measured was page faults. A case
that allocates per iteration has to say `rc`, the way `objects` does. Worth
another 27%, and it is a correction to the *measurement* rather than to the
compiler.

What is left is the real thing: **6.64x, and it is the allocation**. Under
reference counting each substring is a `malloc` and a `free` — about 13 ns for
a five-character word. C++ constructs a pointer and a length.

## What a view would be worth

Directly: most of the remaining 6.64x. A slice that aliases its parent allocates
nothing, and the benchmark would approach the C++ column rather than sit at
seven times it. On this evidence a view is the single largest optimisation
available to the project.

Two things make it *sound* rather than merely fast:

- **JavaScript strings are immutable.** Nobody can write through the parent, so
  a view is semantically indistinguishable from a copy. This is not a
  restriction the design has to impose; it is one the language already
  guarantees, and it is why V8 has `SlicedString` and why Java had one.
- **The array decision already set the precedent.** RFC §8.2 was amended so an
  array's elements live in a block it points at rather than inline, and the cost
  was named: *"one load, and that load is loop-invariant"*. A string carrying a
  pointer to its units rather than holding them inline is the same trade, and it
  makes a slice O(1) for the same reason it made `push` possible.

### The shape

```text
NtsString { header, length, const uint16_t *units, NtsString *owner }
```

`units` points just past the header for a string that owns its characters, so a
freshly built string still reads its own contents with no indirection worth
naming and no second allocation. A slice points into its parent's characters and
holds a reference to it, which is what keeps the characters alive — under
reference counting that is the ordinary mechanism, with no new rule.

### The hazard, named

**A view retains its parent.** A three-character word held out of a ten-megabyte
document keeps the document alive. This is exactly why Java removed its
`substring` view in 7u6: a program that parsed large files and kept small pieces
leaked in a way that was invisible in the source.

The two known answers, and both are cheap:

- **A minimum length.** V8 will not make a sliced string below thirteen
  characters. Short slices copy, which costs nothing because they are short.
- **A maximum share.** Refuse the view when the slice is a small fraction of its
  parent — the case where retention is a real hazard — and copy instead.

Both are one comparison at the point of slicing, and both can be tuned against
this benchmark rather than guessed at.

### What it would touch

Every function that reads a string's characters, because `NTS_ELEMENTS` becomes
a load rather than an offset; the static literal emission, which builds string
objects at compile time; and `nts_str_alloc`. That is a contained but genuine
change to the object model, which is why it is written down here and proposed
rather than done.

## An aside worth keeping

V8 is only 1.87x faster than nts on this benchmark, and **not because of sliced
strings**. The words are three to six characters, below V8's thirteen-character
threshold, so V8 copies them too. What V8 has is a nursery: allocating a
six-byte string is a pointer bump and reclaiming it is free.

So there are two independent levers, and it is worth not confusing them:

- a **view** removes the allocation for *long* slices, where it is the whole
  cost, and is what closes the gap to C++;
- a **nursery** makes *short-lived* allocation cheap, which is what closes the
  gap to V8, and is RFC §9.3's MMTk work rather than a string question at all.
