# A length was two billion wider than any array, and the loop counter paid for it

`OpKind::Length` had the fact `[0, U32_MAX]`. So a counter compared against a
length was not provably an `int32`, and became an `i64`.

An `i64` induction variable is a shape neither optimiser treats as a counted
loop. No range-check elimination, no unrolling, no vectorisation. The JVM
session priced it by writing the same loop over the same `double[]` twice,
differing in nothing but the counter's type:

    int counter      1,414,434 instructions    0.67 per element
    long counter    18,513,608 instructions    8.8  per element    13.1x

and 32% on `array-predicates` from the same one variable. This lane's own
`optimizations_hold` comment had predicted it in the LLVM vocabulary — an index
wider than an `int32` "makes every index an `fptoui` of a floating-point
induction variable, which LLVM's scalar evolution cannot model."

## The decision, and why it is not a lie

The question was put to me as signed-but-false against unsigned-but-true.
`NtsHeader.length` is a `uint32_t`, so `Int{32, unsigned}` matches the storage
exactly, and `Int{32, signed}` is a claim about an array of three billion
elements that no lane can allocate.

There is a third option and this runtime already uses it everywhere else:
**make the refusal real.** `nts_array_allocate` was

    if (!(length >= 0.0 && length <= 4294967295.0 && ...)) {
      fprintf(stderr, NTS_REFUSED "%g is not a valid array length\n", length);
      abort();
    }

A bound with a message and an abort. Moving the constant turns the type from a
claim into a **consequence** — the same shape as the bigint upper endpoint,
which is refused rather than converted for exactly this reason. Nothing is given
up: 2^31 doubles is 16 GB in one block, and the JVM's own `MAX_ARRAY` has been
`Integer.MAX_VALUE - 8` since before either of us.

Unsigned would have bought precision about a case no lane can reach and paid
`Integer.compareUnsigned` where an `if_icmplt` was.

**`2^31 - 2`, not `2^31 - 1`**, and the two is the JVM session's, from hitting it
twice in an hour. A counter under `i <= xs.length` reaches the length and then
increments, so `length + 1` has to be representable; at `I32_MAX` that lands on
`2^31` and wraps. It is invisible until someone writes `<=`, so it is a
compile-time assertion beside the constant rather than a thing to remember.

## Strings, which are the same operation

`OpKind::Length` covers a string's length as well as an array's, and
`nts_str_raw` took a `uint32_t` with no bound at all. A string built past 2^31
units would have made the fact false — and a false fact about a length is a loop
counter that wraps. The same refusal is there now. Every string is made through
that function, so it is the one place it has to hold.

## What the change broke, and why that was the good news

    the_check_for_a_check_can_see_one ... FAILED

That test is the control for "a proven index costs no check": it asserts that
`const n = xs.length | 0` **does** carry a check, so that the positive test is
known to be able to see one. It failed because the shape it was controlling for
had stopped existing — `| 0` is `ToInt32`, and on a value now proven inside the
int32 range it is the identity, so `simplify` removes it and the connection
survives. The control was correct and the thing it controlled for was gone.

Its replacement is a bound the analysis genuinely cannot connect to the array: a
second parameter. That is a control rather than a coincidence.

## And the ratchet that was not one

Reverting the bound to `U32_MAX` failed **nothing**. `a_length_bounded_counter_is_an_integer`
asserted

    module.contains("phi i64") || module.contains("phi i32")

and passed whichever came out — so the difference between them, which is the
whole of what a counted loop is and is worth 13.1x, was invisible to the test
named after it. Its own docstring said "`xs.length` is a `uint32_t`, so a
counter compared against it is not provably an `int32`", which the change makes
false.

It asserts `phi i32` now, and reverting the bound fails there rather than
nowhere.

That is the third instrument this week that was green while looking at the wrong
thing, after a benchmark step with no cases and `-Xverify:all` on a class with no
methods. This one is the most instructive of the three, because it was not
looking at *nothing* — it was looking at a disjunction that could not
distinguish the two answers it existed to tell apart.

## Ratchets

- `compiler/codegen/llvm/tests/optimizations_hold.rs` — `phi i32` specifically,
  and a control the analysis cannot connect. Reverting the bound fails the
  first; the second fails if the check ever stops being findable.
- `compiler/core/tests/length_bound.rs` — the two constants, checked against
  each other. The fourth pair this session has needed a check for, after the tag
  tables, `NtsValue.java` and the read-only helper lists.
- `hir::facts` — a compile-time assertion that `MAX_LENGTH + 1` is still an
  `int32`.
- No new example: this changes the *width* of a value, and 109 of 109 examples
  agree with node before and after on C and LLVM, 9,889 sweep cases with them.
  A fixture that distinguished the two would be one whose answer depends on an
  array longer than 2^31, which is now refused.
- No memory case: the change moves no allocation and the suite is green at every
  floor either way.
- The benchmark row is `elementwise`, which exists. The JVM session measures
  their backend-local version of this at 7.61x → 1.04x; the number for this lane
  comes when the user lifts the hold on timed runs.
