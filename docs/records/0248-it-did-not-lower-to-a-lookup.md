# It did not lower to a lookup

    const o: Record<string, number> = {};
    o["a"] = 1;
    "a" in o

    node 1      nts 0

The emitted C is the whole diagnosis:

    nts_map_set(v1, v4, v5);      the key goes in
    v7 = false;                   and `in` answers this

Unconditional, with no use of the map after the set. **It did not lower to a
lookup that missed. It did not lower to a lookup.**

## Why an implemented operator answered a constant

`lower_in` is built around the closed world: a compiled program gains no
classes, so "which of the types this value can be declares this key" is
answerable at compile time, and the answer is a test over a known set. That is
right, and it is why `in` on a class instance has always agreed with node.

A `Record<string, V>` declares no members at all. So the set came out empty, the
fold said "no member has it", and the expression became `false`.

The failure is in the frame rather than in the code. Membership in a table is a
*runtime* question — the map knows and the type cannot — and the pass that
answers `in` had one way of answering it.

## The absent case agreed, which is why it survived

`"zz" in o` was right, because `false` is the right answer there. Half the
questions anyone would think to ask returned the correct value, and the other
half returned the same constant.

The Node lane found it with three controls beside it, all of which were already
correct: `Object.hasOwn(o, "a")`, `o["a"]`, and `Object.keys(o).length`. **The
object was right in every respect and one operator was not**, which is what
placed it as one path rather than as a representation. And `in` on a class
instance agreeing is what said it was one *receiver type* rather than the
operator.

`examples/in-on-a-record` pairs every present key with an absent one for exactly
that reason. A fixture asking only about present keys would fail on a constant
`false`; one asking only about absent keys would pass on it. Both directions, or
neither is evidence.

## The fix

A table's `in` lowers to `nts_map_has`, with the key erased on the way in for
the reason every table key is: entries are erased values, and the runtime reads
the tag.

Six exports, 174 cases, all agreeing with node.

## Where it was

`in` is 260 sites across 13 modules in `runtime/node`. Most are on a bare
`object`, which this compiler *refuses* by name -- so the same operator refused
in one type position and silently answered wrong in another, and the wrong
answer was the one that compiled.

That pairing is the thing to take away. A refusal is loud and gets counted; a
constant is neither. Whenever a pass answers a question by enumerating a set,
the case worth checking first is the one where the set is legitimately empty.
