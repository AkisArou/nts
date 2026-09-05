# 0125 — The erased field wrapper costs nine percent, not the row

`optional-chain` is 2.12x, down from 3.43x this morning. The obvious remaining
suspect is the erasure: `fn?: (x: number) => number` makes the field `Erased`,
so it holds an `NtsValue` and every read is `getfield .ref` plus a `checkcast`
where the reference holds the function directly.

The fix would be `unbox` extended to *fields* -- the same move that took `widen`
from locals to fields and won `generator`. It is a real piece of work and it
touches the `null`/`undefined` distinction that caused a crash earlier today, so
it was worth pricing first.

    direct field   35.19 us
    erased field   38.40 us     1.09x

**Nine percent.** Not the row. The wrapper is nearly free because C2
scalar-replaces it -- `bytes/op` is 0.00 -- so `.ref` is a register read rather
than a pointer chase, and the tag test is a compare against a constant.

That refutation is worth more than the number: extending `unbox` to fields is
justified by exactness and would have been justified by nothing else. Ten
percent does not pay for a second encoding of absence in a backend that already
has one bug's worth of history with `null` versus `undefined`.

## And a near-miss that explains an earlier row

`run$whole` executes a `drem` per iteration -- `i % 2` on a double counter --
and by the measurement that `instanceof` produced this morning, a `drem` costs
about 5 ns. A hundred thousand of them would be 500 us against a row that
measures 74.

The divisor is **2.0**, a power of two, and C2 strength-reduces that. The
`instanceof` reference divided by **3** and paid 956 us for it. Same
instruction, two orders of magnitude apart, decided entirely by the constant --
which is worth knowing before reading `drem` in a listing as a finding.

## What is left on this row is unattributed

35.19 us for the modelled direct field, 38.40 for the modelled erased one, 74.62
for this backend. About 1.9x is in neither the erasure nor the remainder, and I
do not have it. Recorded as open rather than guessed at.
