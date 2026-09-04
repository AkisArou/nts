# The index the callback was never given

`a.forEach((v, i) => ...)` was refused. So was `map`, `filter`, `some`, `every`,
`findIndex`, `find` and `reduce` with an index — every callback method this
compiler inlines. The refusal said why:

> The index and the array are the parameters every callback of these *may*
> take, and a callback taking one is refused rather than bound: the index would
> need the loop counter's identity to survive into the body, and this has no
> test for that yet.

It survives. `at` is read from `self.bindings[&index]` **inside the body block**,
after `begin_loop` has made the carried names block parameters — so it is this
iteration's value, and it is the same value the `ArrayGet` on the line above
indexed with. The element and its position cannot drift apart because they are
the same SSA value.

The whole change is three lines: accept one more parameter than the minimum,
work out where the element is, and bind the counter.

## Where the element is, which stopped being obvious

`names.last()` was the element. That is right for a one-parameter callback and
right for `reduce`'s `(accumulator, element)` — and wrong the moment an index
may follow. `reduce` takes the accumulator first and everything else takes the
element first, so the element is at index 0 or 1 by method, and the index is
always after it.

Getting that wrong does not fail. It swaps `reduce`'s accumulator for its
element and computes a different number, which is why the mutation that restores
`names.last()` is checked against the differential rather than only a unit test.

The **array** parameter is still refused, by count rather than by name:
`a callback taking 3 parameters, where it may take 1 or 2`. Handing the receiver
to the body would let it be stored where the loop cannot see, and the loop is
what proves the array does not escape — which is what keeps `map` and `filter`
free of an allocation for the receiver and lets the bounds check on every
element read be removed.

## A test that could not fail, caught by a mutation

Three mutations, and the third is the one worth recording. Binding the index to
the loop's *starting* value rather than the current one **passed every unit
test** and was caught only by the differential.

The test meant to catch it asserted that "something other than the load reads
the value the `ArrayGet` indexed with" — and the loop's own condition and its
increment both do, so it passed while the body read a constant. It asks a
sharper question now: `forEachWithIndex` computes `value * at`, so find the
multiply whose operand is an element and assert the *other* operand is not a
constant and is the value the load used. That fails on the mutation.

"A check that cannot fail is not one" is in the standing instructions, and this
is the second time today that the mutation pass was the only thing that noticed
— the first was a fixture whose `-0` case could not reach the `-0` rule.

## The memory case took five attempts and each one found something else

The floors were argued first every time, and wrong four times. What is worth
keeping is that **every wrong answer was a real cost belonging to something
else**:

| the case | measured |
| --- | --- |
| a grown array of objects | 22 allocations, 53 operations — `push` reallocates and takes a reference to what it stores |
| a module-scope `const` array | 375 operations — a managed global is a slot the reader borrows from, and every read took a reference |
| the walk inside an outer `for` | 342 — `total` assigned in a callback nested in a loop is boxed into a cell, retained per iteration |
| `forEach` assigning an outer local | 18 — the same cell, without the outer loop |
| `reduce`, whose accumulator is loop-carried | **1 / 1**, and the floor was still wrong at zero |

The last correction is the smallest and the one I should not have needed: **one
heap allocation forces one release.** `closure-capture`'s rule — an allocation
floor of zero forces an operation floor of zero — has a contrapositive, and I
argued zero operations for a case with one allocation on the reasoning that the
*walk* takes no reference. True, and not all of it.

**And the fourth row is a finding rather than a mistake.** A `forEach` that
assigns an outer local boxes that local into a cell — `v40->value` in the
emitted C — although the callback is inlined into the same function and
`carried_across` exists to make exactly that name loop-carried. Every
accumulating `forEach` in the corpus pays for a heap box it does not need. Named
work with a number: 18 operations and one allocation for a single eight-element
walk.

## No benchmark row, measured

The two controls in `examples/callbacks` walk the same literal, one taking the
index and one not: 33 statements against 35. The two extra are the multiply the
body performs and the counter's conversion to a double — the body's own work.
The counter itself already exists for the bounds test and the increment, so
naming it emits nothing.

## The ledger does not move, and that is the other kind of staleness

There is no ✗ row for this. `forEach` and the rest are listed as supported, and
they were supported *for one-parameter callbacks*. A ✅ that overstates is
harder to find than a ✗ that understates — the audit that found default imports
works by trying the ✗ rows, and nothing tries the ✅ rows against the language
rather than against the fixture that exists.

## Ratchets

- `examples/callbacks` — 1624 cases against node on C, LLVM and under counting;
  the index across all seven methods, a callback that reads only the index,
  nested walks with two indices, and a one-parameter control walking the same
  literal.
- `compiler/core/tests/callback_index.rs` — four tests, three mutations, each
  failing a different one, and the third only after the test was strengthened.
- `tooling/memory/cases/callback-index` — 1 / 1.
- No benchmark row, for the reason above.
