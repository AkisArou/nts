# parseInt is not Number with a radix

    Number("")        0        parseInt("")        NaN
    Number("12abc")   NaN      parseInt("12abc")   12
    Number("1e3")     1000     parseInt("1e3")     1

The two disagree at almost every edge, and stopping at the first character the
radix does not admit is the whole of the difference. `nts_str_to_number` could
not be reused with a radix bolted on.

    278 of 279 agree with node
    thirty-one strings, nine radixes

## The default radix is zero, not ten

    parseInt("0x1f")       31
    parseInt("0x1f", 10)   0

Zero is the specification's "decide from the text": a `0x` prefix gives 16 and
everything else 10. Defaulting to ten would answer the second for both, and
`noRadix` against `radixTen` in the example is the pair that says so.

Radix 16 skips the prefix when it is there. Outside 2..36 the answer is NaN
whatever the text says, and `computedRadix` passes `(n % 40) - 2` so the folder
cannot answer for the runtime.

## The one divergence, named rather than hidden

    parseInt("9007199254740993", 36)
    nts   1.989698611603181e+24
    node  1.9896986116031807e+24

Node computes the exact integer and rounds once; this rounds at every
multiply-add. Closing it needs an exact accumulator — the value is past 2^80, so
neither a `uint64_t` nor a long double reaches it — and no call site in this tree
parses a sixteen-digit base-36 number. It is in the runtime header beside the
function.

## `Number.parseInt` is the same function object

So it reaches the same helper rather than a second one, dispatched before the
intrinsic table because every entry there takes exactly one argument and this
takes a radix.

Reaching a *different* helper is how two spellings of one operation come to
disagree, which this compiler has now been bitten by three times — `super.fill`
against `view.fill`, `xs.push` against `xs[xs.length] =`, and `in` on a record
against `in` on a class.

## The example reported agreement over a fifth of its cases

The first version picked its input with `texts[i]!`, and the harness *declines*
every case whose index it cannot prove. It said **"agreed on every case"** over
42 of 203, with 17 declines.

A `switch` instead, and 232 of 232 compare. That is the fifth instrument this
session to report agreement while the interesting cases did not run, and the
third I wrote myself. The shape is always the same: **the cases the instrument
could not run were not counted against the answer it gave.**
