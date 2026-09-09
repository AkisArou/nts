# The result was not the operation's width

    sum = (sum * 31 + code) % 1000000007;

That is the ordinary polynomial hash. It compiled to

    v14 = (int64_t)((uint64_t)v12 + (uint64_t)v21);   /* the sum, correctly wide */
    v22 = (int32_t)v14;                               /* truncated */
    v16 = v22 % v15;                                  /* and then the modulus */

and the answer was **negative**.

## The rule that was wrong

`specialize::width_of` chose an operation's integer width by asking the range of
the operation's own *result*:

    if integral(id, I32_MIN, I32_MAX) { Some(32) }
    else if integral(id, SAFE_MIN, SAFE_MAX) { Some(64) }

A remainder is bounded by its divisor however large the dividend is. So the `%`
measured as 32 bits, the dividend -- which reaches 3.1e10 -- was converted on
the way in, and the truncation happened *before* the operation that would have
brought the value back into range.

`%` is the systematic case, because its range does not depend on its left
operand at all. `+`, `-` and `*` reach the same shape by cancellation: `a - b`
where both are far outside `i32` and the difference is small. Unary negation
reaches it at exactly one value.

The fix is that an operation is as wide as the widest value it touches, and the
result is only one of those.

Bitwise operations and the coercions are deliberately not in that list. Their
result is `i32` by the language's definition rather than by inference, and their
operands are coerced on the way in -- which is a truncation the source asked for.

## Three versions, and the middle one broke something that was already fixed

**One: does it fit `i32`?** Correct, and it widened what did not need it.
`benches/cases/absences` bounds its loop with `256 + (seed | 0)`, so the counter
reaches 2^31 + 254 -- outside `i32` by 255 and inside `u32` by two billion. Its
`i % 3` was a correct `uint32_t` remainder before this pass was touched, and
this version made it 64-bit: 26 mentions of a 64-bit type became 86, and no
answer changed.

**Two: is thirty-two bits enough, signed or unsigned?** That narrowed `absences`
back and broke `Math.abs`.

    v5 = (int32_t)v2 < 0 ? -(int32_t)v2 : (int32_t)v2;

`Math.abs(x)` over an `i32` has range `[0, 2^31]`, which fits `u32` -- so the
result measured as 32 bits, and the emitter spelled it `int32_t`, in which
negating `INT32_MIN` is signed overflow. `examples/mathops` carries a comment
about that exact answer coming out negative once before: *"Negating before
widening is signed overflow -- in practice `INT32_MIN` again -- and the answer
came out negative. Found by `nts check`, which is the only thing that would
have."* It was found by `nts check` a second time.

**Three: signed for the result, either for an operand.** The result's
representation is this pass's own decision and is signed. An operand's was
decided when it was produced, and the only question here is whether the
operation is wide enough to receive it without truncation -- which `uint32_t`
answers for `absences`'s counter.

    benchmark cases whose 64-bit count changes:  0 of 60
    examples/wide-operand-narrow-result:         232 cases agree
    examples/array-join:                          15 cases agree
    examples/mathops:                            146 cases agree

## The gate was right twice and my re-runs were not

Version two failed `math_intrinsics_follow_javascript_and_not_c` in two
consecutive gate runs, and passed every time I ran it alone -- three times in a
row, and twice more under `cargo test --workspace`. I read that as machine load,
looked for a shared temporary directory, found one that three sessions could
collide in, wrote the fix, and then could not reproduce the collision: cargo
serialises on the build lock, so two `cargo test` processes in one tree never
overlap.

The diagnosis was wrong and the fix went back. What the standalone runs were
actually reporting is not settled -- most likely a debug artifact that had not
been rebuilt -- and the useful part is the rule: **"it passes when I run it
alone" is not evidence, and a green re-run does not overturn a red gate.** The
gate ran the test twice and was right twice.

## What it did not widen

The whole risk of the fix is that it widens everything and quietly costs every
loop in the tree its 32-bit arithmetic. Measured on the same file:

    hash, hashWide, cancels, product, negate     mixed int32_t and int64_t
    counter, smallRemainder, smallProduct        **zero** int64_t

The controls are in `examples/wide-operand-narrow-result` for that reason and
not to make the example look complete. A fix that widened unconditionally would
agree with node on every subject there too.

232 cases across eight functions, compared against node: all agree.

## Found by a control, in a change about something else

This is not what I was doing. `join` on a numeric array and on a typed array had
just been built, and `examples/array-join` checksums the joined text and compares
the checksum against node -- because the differential carries scalars and a
string has to be reduced to one.

Eight of fifteen cases disagreed. Among them was `strings`, which joins
`["alpha", "beta", "gamma"]` through `nts_array_join_str`, a helper this change
did not touch and which had worked for months.

**A control that disagrees is worth more than a subject that agrees.** Had the
checksum been a length instead -- which was the first thing I wrote -- every case
would have passed, `join` would have been reported correct, and the miscompile
would still be in the tree with a new fixture standing on top of it.

The checksum was chosen for a different reason: a length catches a missing
separator and nothing else, so it is too weak to say `join` is right. It turned
out to be exactly strong enough to say something else was wrong.

## Where it could have been reached from

Nothing in the corpus or the benchmarks was miscompiling, which is why it had
not been seen. `(a * b + c) % m` needs three things at once: a product that
leaves `i32`, a modulus that brings it back, and the whole thing proven integral
so specialization takes it at all. A hash is where those three meet, and this
compiler had no hash in its examples.

The instrument that found it is a differential over generated arguments. The
instrument that could not have found it is any count of what compiles.
