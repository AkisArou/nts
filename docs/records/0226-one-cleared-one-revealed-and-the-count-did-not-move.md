# One cleared, one revealed, and the count did not move

`join` is provided now, on a numeric array and on a typed array as well as on
strings. It was the named head of the widest chain in the node profile:

    internal/errors.ts:547   `Uint8Array(${n}) [ ${value.join(", ")} ]`
      -> inspectValueWithin -> inspectValue
      -> ERR_UNKNOWN_ENCODING#constructor -> StringDecoder#constructor

and sixteen validators in `os`'s cone sit behind the same `inspectValue`.

Measured before and after, on the same pair of binaries:

    string_decoder   65 refusals, 0 published  ->  65 refusals, 0 published
    os               71 refusals, 17 published ->  71 refusals, 17 published

**Nothing moved. Not one site.**

## And the work was not wasted

Diffing the two refusal lists rather than their lengths:

    - errors.ts:547:41  `join` on a typed array, which this compiler does not
                        provide yet
    + errors.ts:563:74  `key` on a union, whose members lay their fields out
                        differently

One line out, one line in, sixteen lines further down the same function. The
refusal `join` was blocking is gone and the next one in `inspectValueWithin` took
its place, so the count is *identical* while the chain's head advanced.

`0216` says a refusal count sizes a corpus rather than a feature, and `0220`
records "five cleared and five revealed" on `buffer`. This is the sharpest form
of it: **not an approximate measure, a stationary one.** A count that moves by
zero is indistinguishable from a change that did nothing, and the only
instrument that told the difference was a diff of the two lists.

Which is a rule with a cost, and worth stating as one: the cheap number is the
one everybody quotes, and it was exactly wrong here. Comparing the *sets* is not
much more work and it is the only thing that answers "did this land".

## The new head is harder than the one it replaced

    entries[index] = `${inspectPropertyName(key)}: ${inspectValueWithin(value[key], ancestors)}`;

`value[key]` where `value` is a union whose members lay out differently is a
dynamic property read across layouts -- not a missing method but a
representation question, and a larger one than `join` was. So the chain is not
"one more fix away"; it was not before either, and the count said so by not
moving.

## What `join` cost, since it is not free

Two runtime helpers, `nts_array_join_num` and `nts_view_join`, in the two passes
`nts_array_join_str` already used: the first formats every element to measure it
and the second formats again to write. An element has no length until it is
formatted, and storing the first pass's answers would be an allocation per
element or a second buffer the size of the result. A whole value in the `i32`
range takes the integer path and allocates nothing, which is every element of a
typed array.

`examples/array-join` compares fifteen shapes against node -- the two ECMAScript
thresholds at 21 and -6, the extremes, `-0`, an empty array, an empty view, a
signed view, and the string receiver as a control. All agree.

It is also what found `0225`, a miscompile of `(a * b + c) % m` that had nothing
to do with `join` and was caught by that control disagreeing.
