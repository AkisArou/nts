# A string enum member is the literal it already was

`Label.Short = "s"` was refused, with a reason that turned out to describe the
answer:

> a constant too, and a *managed* one — it wants the interned static a string
> literal gets rather than an immediate, which is a different emission and not
> this one.

Everything in that sentence is true except the last clause. It is the same
emission. The checker gives `Label.Short` the identical
`Literal(String("s"))` type it gives the literal `"s"`, so reading the text out
of it is what `lower_string` already does — and the two do not merely produce
equal constants, they **share one**:

    static const struct { ... } nts_str_0 = { ..., { 115, 0 } };   // "s"

    fromEnum:     v3 = (NtsString *)(void *)&nts_str_0;
    fromLiteral:  v3 = (NtsString *)(void *)&nts_str_0;

Three statics for three distinct texts, not four. The interning that already
existed for literals had nothing to learn.

The change is one match arm and a `String` on an enum variant that used to be a
unit. The refusal it replaces had been written carefully enough to say what to
do, and the estimate of what it would cost was the only part that was wrong.

## The mutation that could not fail, and how it was caught

`a_string_member_is_its_value` and four siblings passed against a build where
the member's value was **uppercased** — `Label.Short` lowering to `"S"` — and
**the differential agreed on every case too**.

That is impossible, and being impossible is what caught it. A wrong constant
cannot agree with node.

The pattern I substituted on,

    "                    OpKind::ConstString(text),"

occurs **twice** in `lower.rs` at that exact indentation, and `replace(..., 1)`
took the other one. The knob never moved. Re-aimed at the enum arm with an
anchor asserted unique, the same mutation fails three tests and **180
differential cases**.

Sixth of this stretch, and the first where the *differential* was the thing
reporting a green that could not be green. The tell was not a failing check; it
was a passing one that had no way to pass. **A control that verifies the knob
moved is cheaper than noticing the result is impossible** — and the noticing
only works when you know what the answer must be.

## The numeric half is the half a naive change breaks

Routing every enum member through the string path fails two tests, and it is
worth having a fixture that makes it fail: `both` uses `Colour.Red` and
`Label.Short` in one function, so a lowering that lost the distinction builds a
string where an immediate belongs and types a number as a pointer. The
differential agrees on every case for that mutation — the *answers* are still
right, because `"1"` and `1` concatenate the same — which is why the unit test
exists.

## Measured

    string-enum (memory)   ideal 0   allocated 0   actual 0   alloc 0

Argued before measuring and right: a string constant is an interned static in
the binary with `NTS_IMMORTAL` in its count word, so choosing one in a loop
sixteen times builds nothing and counts nothing.

**No benchmark row, and the reason is the finding.** `Label.Short` and `"s"`
emit the same reference to the same static, so there is no code to time that
`benches/cases/strings` does not already time. Confirmed rather than assumed —
the emitted C is above.

## Ratchets

- `examples/string-enum` — 406 cases against node on C, LLVM and under
  counting, across fourteen functions: comparison, `switch`, concatenation, a
  template, the **empty** member, a `const enum`, a member defined as another
  member, through a call, through a field, in an array, and beside a numeric
  enum.
- `compiler/core/tests/string_enum.rs` — five tests, two mutations. Uppercasing
  the value fails three of them and 180 differential cases; sending numeric
  members through the string path fails two, and the differential does not
  notice.
- `tooling/memory/cases/string-enum` — 0 / 0, argued before measuring.
- No benchmark row, for the reason above.
