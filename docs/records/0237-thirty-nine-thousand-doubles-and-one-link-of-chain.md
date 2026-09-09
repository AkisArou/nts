# Thirty-nine thousand doubles, and one link of chain

`Number.prototype.toString(radix)` lowers now. It agrees with node on **39,994
random doubles across every radix from 2 to 36**, and on 209 differential cases
in `examples/number-tostring-radix`.

It moved the chain it was aimed at by **one link**, and published **one name**
across twenty-two modules. Both of those are the finding.

## Why it looked bigger than it was

The blocker fixture had the chain written out, and it was correct:

    path.normalize(p)
      validateString(p, "path")
        new ERR_INVALID_ARG_TYPE(name, "string", value)
          inspectString(value)
            `\u${code.toString(16)}`

`ERR_INVALID_ARG_TYPE` renders the offending value into its message, rendering a
control character means a hex escape, and that escape is the refused construct.
A module cannot validate an argument without it, and validating arguments is
what node's entry points do first.

All true, and `inspectString` compiles now. `inspectValue` still does not:

    inspectValueWithin -> inspectPropertyName    errors.ts:505
    function inspectPropertyName(name: string): string {
      return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : inspectString(name);
    }

    NTS1001 a regular expression literal, which needs a regular expression engine

One regex literal, one line below the one that was fixed, and it is the **sole**
remaining refusal in that function -- checked rather than assumed, by reading
every diagnostic in the file's 500-570 range. Behind it sit `ERR_OUT_OF_RANGE`,
`ERR_INVALID_ARG_VALUE`, `ERR_UNKNOWN_ENCODING` and
`ERR_INVALID_ARG_VALUE_RANGE`, and behind those `validateInt32`,
`validateInteger`, `validateNumberRange` and `os.getPriority` / `setPriority`.

The Node lane said this in advance and in general -- *"three chain heads is not
three fixes"* -- and their `last-mile.mjs` records its own falsification of the
same hope. Measuring the published count before and after is what makes it a
number instead of a feeling: **86 to 87**, `querystring` gaining one.

## What the differential found that nothing else would have

The first run of the example failed nine cases:

    nts  inRadix 38  str 1,48
    node inRadix 38  threw

`(5).toString(38)` is a `RangeError` in node -- *"toString() radix must be
between 2 and 36"* -- and was a string here. Nothing in the source says the
argument has a domain; nothing in the fixture asked; the runtime function was
correct for every radix it was given and wrong about which radixes exist. The
harness feeds arbitrary numbers, so it asked nine times in one run.

The bound is emitted by the lowering rather than checked in the runtime, because
a provided `RangeError` is a **class** and the runtime has no way to construct
one. That asymmetry is what `throw_provided_error_text` is for, and
`String.fromCodePoint`'s "Invalid code point" guard is the same shape.

## The two corrections inside the algorithm, both from comparing

V8's `DoubleToRadixCString`, and it was wrong twice before it was right. Both
were found by diffing against node rather than by reading.

**The leading zero.** `(0.5).toString(2)` printed `.1` where node prints `0.1`.
The guard was `if (integer_cursor == fraction_cursor)`, and `fraction_cursor`
has already moved past the `.`, so the two are never equal when a fraction
exists. It has to compare against the buffer's *middle* -- the position both
cursors started from. 39 of 161 cases, every one of them a value below 1.

**The trailing zeros.** `(1e21).toString(3)` printed
`...2022201202222111` where node prints `...20222` followed by eleven zeros. A
double whose unit in the last place exceeds one cannot represent consecutive
integers, so `fmod` on it returns a remainder built from bits the value does not
have -- and the digit loop happily prints them. V8 divides the exponent out
first, writing the zeros it stands for: `ilogb(v) > 52` is the test, because the
significand is 53 bits.

That second one is the interesting error. The digits were not noise; they were a
faithful rendering of what the double's bit pattern would mean if it meant
anything down there. **A correct algorithm applied below the precision of its
input produces confident wrong answers, and no amount of checking the algorithm
finds it** -- only checking the output against something that knows where the
information stops.

## The instrument

Two harnesses, both linking `runtime/c/nts_runtime.c` directly and comparing
each line to `Number(v).toString(r)` in node: 161 hand-chosen values including
`5e-324`, `1e300`, `-2147483648` and `1e21`, then 40,000 random ones drawn four
ways -- arbitrary bit patterns, integers, small fractions, and large integers.
The hand-chosen set found both defects. The random set confirmed the fix and
found nothing new, which is the outcome that says the first set was the right
shape.
