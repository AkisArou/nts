# `delete` is sound because four other things refuse

`delete o.x` is a store of the `undefined` tag. That is the entire
implementation, and it is correct only because of what four other features
decline to do.

The ✗ count went **40 to 41**, and the trade is the point: one row closed, one
wrong answer turned into a named refusal.

## Why the implementation is one store

TypeScript permits `delete` only where the property is optional:

    TS2790: The operand of a 'delete' operator must be optional.

So the property being deleted always holds `T | undefined` and always has a slot
with a tag in it. Deleting it is writing that tag — `place_of` and `write_place`,
the same path an ordinary assignment takes, so `coerce_to_slot` builds the
`undefined` at the slot's own representation rather than at a guess. The
expression's value is a constant `true`: in a strict-mode program every
deletable property is configurable and TypeScript refused the rest.

Measured rather than asserted: `delete bag.maybe` and `bag.maybe = undefined`
emit **identical C** once SSA numbering is normalised. That is the written
reason there is no benchmark row — the two are the same store, and the
`delete`'s `true` is dead and eliminated.

## Why that is not a wrong answer

JavaScript distinguishes a deleted property from one set to `undefined`.
`"x" in o` is false after the first and true after the second, and
`Object.keys` differs the same way. **This representation cannot tell them
apart**: an optional slot is zeroed at allocation and zero *is* the `undefined`
tag, so `{}` and `{ maybe: undefined }` are one object here.

The conflation would be a wrong answer, except that every operator which could
observe it refuses on an optional property:

- **`in`** names it, from record 0089 — argued there because an optional slot
  cannot answer a presence question.
- **`for...in`** is refused outright, and has been.
- **`Object.keys` and `Object.hasOwn`** — as of this change, and that is the
  interesting one.

Each of those was argued on its own terms, and together they are what makes this
one correct. If any is ever implemented for an optional property, `delete`
becomes wrong on the same day — which is why they all refuse by naming the
**property** rather than the feature. A refusal that said "`in` is not
supported" would carry none of this.

## The wrong answer found on the way

`Object.keys` was not refusing. It was answering from the layout:

    interface Bag { keep: number; maybe?: number }
    Object.keys({ keep: 1 })      // nts: ["keep", "maybe"]
                                  // node: ["keep"]

Twenty-nine of twenty-nine cases disagreed, the moment a fixture asked. The
same for `Object.hasOwn`, which answered `true` for a property no value had.

This was shipped and silent, and it was found by probing whether `delete` could
be conflated — not by testing `Object.keys`. The feature that exposed it is not
the feature that had it, which is the third time in three records: the `in` bug
came out of the upcast's example, the dead C stub out of the upcast's benchmark,
and this out of `delete`'s soundness argument.

`own_names` now refuses when the type declares an optional property, naming it.
A run-time answer is possible and is a different feature — a loop over the layout
testing each tag, producing an array whose length is not known until it runs —
and nothing in the profile asks for one.

## The memory case that could not be the interesting one

A `delete` of a **reference** field is the case worth measuring: it overwrites a
slot holding the only reference to something, and if the store does not give it
back nothing will. That is exactly why `nulled-field` exists — `x.f = null` took
that shortcut once, because the store branch asked whether the *new* value
needed counting and a constant null does not. `delete` writes a tag, which is a
constant that needs no counting either. Same shortcut, same reasoning, waiting.

Measured, with allocations argued in advance and **exactly right at 17/17**:

    deleted-field   naive 51   actual 51   ideal 17   alloc 17   floor 17

Three operations per box where one is justified. The cause is verified rather
than guessed. The same program with a **required** `Box | null` field — a plain
pointer instead of an erased value — emits **zero retains**: the frame's
reference moves into the field. Make the field optional and it is erased, and
the move becomes a copy.

**Erasure blocks the ownership move.** That is the third sighting of one shape:
0091 found erasure hiding frame-locality from the reference counter, this finds
it hiding ownership transfer, and both live in `own.rs` — the file whose own
comment says it exists because a reference got consumed twice, three times.

Neither number could be written honestly. Seventeen cannot be met; fifty-one
charges the program for a compiler gap. So the shipped case is the **scalar**
one, at 0/0, which is true and says what it checks: a deletion is a store, and a
`delete` lowered as anything else — a runtime call, a rebuild of the object —
would show up there and nowhere else, because the answers would stay right
either way.

The reference case is named work with a number attached: 51 against 17, and a
one-line control that isolates the cause.

## The ledger went up, and that is the right direction

One ✗ closed and two arrived: `void` and comma, which were bundled with `delete`
in one row and are still refused, and `Object.keys`/`Object.hasOwn` over an
optional property. The second is **new**, and it replaced a wrong answer.

A count that only falls is a count measuring the wrong thing. Turning a silent
disagreement with node into a named refusal makes the compiler more honest and
the ledger longer, and the ledger is supposed to say what is true.

## Ratchets

- `examples/delete` — 232 cases against node on C, LLVM and under counting:
  deleted and read back, the expression's value, deleting one never supplied,
  the rest of the object untouched, a class field, through `??`, deleted on one
  path of a branch, and two objects sharing a layout.
- `compiler/core/tests/delete_expression.rs` — four tests, two mutations. Making
  the deletion not store fails one test and 47 differential cases; letting
  `Object` statics answer from the layout fails another.
- `tooling/memory/cases/deleted-field` — 0 / 0, scalar, argued before measuring.
- No benchmark row: `delete o.x` and `o.x = undefined` emit identical C.
