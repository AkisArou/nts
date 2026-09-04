# The walk was already there

`Map#forEach` and `Set#forEach` were refused as *"which needs the iteration
protocol"*. The protocol was there: `for (const [k, v] of map)` has walked a
table since `Walk::Entries` existed, with a cursor that asks the runtime for the
next live entry rather than adding one, because a deleted entry leaves a hole.

So the implementation is the `for...of` loop with the callback's body inlined
where the head's bindings would go — `walk_cursor` for the entry index,
`walk_condition` for the test, `read_element` for the reads, `Step::Walk` for
the advance. Nothing allocated, nothing called indirectly.

## Two things that are easy to get backwards

**`forEach` hands `(value, key)` and the table stores `[key, value]`.**
`read_element` answers key-first because that is what `for (const [k, v] of
map)` binds. The binding is a swap, and swapping it back does not fail — it
computes a different number.

**A `Set` passes the element twice.** `s.forEach((v, k) => ...)` sees `v === k`
for every entry, because a `Set` has no values at all. So the second read is
`nts_map_key_at` again rather than an error.

Both are in `examples/map-and-set` against node, and the first needed a map
whose keys and values are *different* numbers to be checkable at all.

## The third test that could not fail

Swapping value and key passed every unit test I had written. `mapForEach`
computes `value * key`, and one multiply reading both looks identical either
way — only the differential caught it, through a *type* error in the
string-keyed case where `key.length` stopped making sense.

The test that catches it is `mapForEachValueOnly`: one parameter, added to a
total, so exactly one of the two reads reaches the addition and **which one it
is** is the parameter order.

That is the third time this stretch that a mutation revealed a check that could
not fail, and all three were the same shape: an assertion about *whether* a
value is used where the claim is about *which* value. The array callback's index
was the first, the `-0` fixture the second.

## No memory case, and two numbers instead

A `forEach` over a table should cost nothing beyond the table. Isolating that in
a case with a justified floor failed four times, and each failure was a
pre-existing cost the walk does not own:

- **The cell.** A `forEach` assigning an outer local boxes it — `v22->value` in
  the emitted C — and retains it twice per iteration. 0098 records this with its
  own number; here it is 16 of the 18 operations for an eight-entry walk.
- **The erased read.** `nts_map_key_at` and `nts_map_value_at` return an
  `NtsValue`, and each is *released* after use — two per entry, no-ops when the
  payload is a number, and counted all the same. The tag says it is a number;
  nothing needs giving back.

Moving the accumulator to module scope to dodge the first does not compile, so
the fifth attempt was not attempted. Neither floor could be written honestly:
zero is not reachable and eighteen charges the program for two compiler gaps.

**The erased-read release is new and is the more general of the two.** Every
table walk in every program pays it, `for...of` included, and it is invisible to
the differential because releasing a number changes no answer.

## Ratchets

- `examples/map-and-set` — 725 cases against node on C, LLVM and under counting.
  A map whose keys and values differ, a set seeing its element twice, one
  parameter, string keys, a walk after two deletes, a `return` inside the body,
  an empty table, and nested walks with two live cursors.
- `compiler/core/tests/table_for_each.rs` — five tests, two mutations. Swapping
  value and key fails the fifth; making a `Set` read a value it does not have
  fails another.
- No memory case, for the reason above, and two findings with numbers instead.
- No benchmark row: `benches/cases/map-and-set` already times the table, and the
  walk is the loop `for...of` uses, which that row already contains.
