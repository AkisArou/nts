# 0036 — A bigint is two words, and that is the whole argument

The queue's fourth primitive. Its representation was decided long before this
audit and argued in `typescript.md`; what was missing is what the argument
*costs*, which is two of the three ratchets.

## Representation

`__int128`. Exact to 128 bits rather than arbitrary precision, which is the one
place the conformance table promises less than the language, and the one value
it cannot spell is `-(2^127)` — the literal is a negation of `2^127`, whose
magnitude does not fit, so it is refused where it is written.

It is not managed. Nothing allocates, nothing is counted, and there is no frame
question because there is no storage of its own to place. It is the only thing
here wider than a word, so it drags an object's alignment to sixteen — a layout
question, checked by a `_Static_assert` per field on every build rather than
trusted.

It is also its own `HirType` rather than a wide integer, and that is not
bookkeeping: `1n << 40n` is 2^40 where `1 << 40` is 256, because a *number*'s
shift masks its count to five bits.

## Operations, and the two gaps

The working surface agrees with node across 435 cases: arithmetic, all five bit
operations, comparisons, fields, parameters, returns, negatives at the extreme,
`String()` and `Number()`.

**`BigInt(x)` was refused** — "a builtin this compiler does not provide", 22
sites. It is `Number(x)`'s mirror and not quite its twin. The identity on a
bigint and `0n`/`1n` on a boolean are both what a cast already is. On a *number*
it is a conversion with a precondition: the specification throws a `RangeError`
when the value is not an integer, so `BigInt(1.5)` is **not** `1n` and a cast
would be a wrong answer rather than a lossy one. `nts_bigint_from_number` checks
and refuses the way an index past the end of an array does, and refuses again
above 2^127 — the same boundary the literals have.

    5,875 -> 5,821 refusal sites

Twenty-two named `BigInt`, and thirty-two more that were behind them.

**Erasing a bigint is refused, and correctly.** `NtsValue` is a tag and a union
of `{ double, bool, NtsHeader * }` — nothing wide enough. So `bigint | undefined`
and a bigint reaching `unknown` are both refused *by name* rather than answered
wrongly, which is the honest consequence of a 128-bit machine value. Widening
`NtsValue` to carry one would make every erased value in every program two words
wider, to hold a type the profile uses 47 times.

## The two ratchets that were missing

**Memory.** `tooling/memory/cases/bigint-arithmetic`, at `ideal 0` and
`allocated 0`, with the bigint in the four places a value gets charged: a field,
a parameter, a return, and a loop-carried accumulator. Argued before measuring
and reached. The point of the case is the counterfactual — *a true bignum would
put one allocation in every operation in that loop*, and this puts none
anywhere.

**Speed.** The new `bigint` row:

    bigint    333.2 ns    C++ 335.2 ns    node 3.67 us    0.99x C++    0.09x node

C++ there is hand-written `__int128`, so this matches the floor exactly. Node's
`BigInt` is arbitrary precision and allocates, and pays eleven times over for a
width that no `readBigUInt64BE`, no hrtime timestamp and no
`0xffffffffffffffffn` needs. That number is the width argument, measured.

## What the second backend caught

`BigInt(true)` needs `Convert(Bool -> BigInt)`, and the LLVM table named
`Bool -> Int` and not `Bool -> BigInt` — because `BigInt` is deliberately not a
wide `Int`. The C backend hid it behind a cast; the `llvm` step, which ratchets
upward, refused to let 80 of 89 become 79. One `zext`.

That is the argument for two backends in one line: a feature the C backend gets
for free from C's type rules is a feature the other one has to be told.
