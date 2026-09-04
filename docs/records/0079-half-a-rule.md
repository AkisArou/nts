# Half a rule, and the cell that was not in the product

`a < b` on two strings compared their **addresses**, in both backends, for as
long as both backends have existed. So `"a" < "b"` answered whatever the
allocator had done that run, and `("a" + "b") <= "ab"` was false for two strings
the language calls equal.

Found by the JVM session while surveying refusals for its own plan -- not by a
test, and not by me, and the reason no test found it is the more useful half of
this record.

## The shape of the defect

`===` on strings was correct the whole time. It goes through `nts_string_eq`,
which compares contents, and there is a comment beside it explaining why
`"a" + "b" === "ab"` has to be true across two allocations.

`<` `<=` `>` `>=` were never given the same treatment. `lower.rs` maps them to
`BinOp::Lt/Le/Gt/Ge` with no `is_managed()` branch -- unlike `+`, which becomes
`BinOp::Concat` when the type is managed -- and then the C backend's
`string_comparison` guarded itself with `matches!(bin, BinOp::Eq | BinOp::Ne)`,
so a managed operand fell through to a raw C operator on two pointers. The LLVM
backend did the same thing one representation down.

One half of a rule written, the other half never. Record 0044 found exactly this
in the LLVM backend -- an `icmp eq` on pointers where a contents comparison was
meant -- and the fix there was the equality half. This is its sibling, four
operators wide, and it survived that fix because the fix was to the half that
had a symptom.

## Why nothing caught it

Three gaps, and they line up:

1. **`typescript.md` §9 said ✅** for "relational comparison on numbers and
   strings". The ledger asserted the thing that was false.
2. **No example exercised it.** `examples/strings` and `string-methods` compare
   with `===` and call methods; neither writes `<`. So the differential, which
   is the instrument that would have caught a wrong answer immediately, was
   never handed the expression.
3. **The sweep's operation axis had no relational operators.** It covers
   `typeof`, truthiness, `=== null`, `=== undefined`, `==` and `??` across its
   value kinds. Not `<` `<=` `>` `>=`.

The third is the one worth acting on, and it is this file's own argument turned
on itself. `sweep.mjs` opens by saying that every correctness bug found by hand
has been one cell of a cross-product. This was a cell the product did not have.

## The order the fix went in

The sweep gained the cells **first**, before the lowering was touched, so that
the check failed before the fix existed rather than after. Eleven cells, four
operators each, and the run went from "agreed on every case" to **49 cases
disagree**. Then the fix, and back to agreement across 9889 cases on both
backends.

A check written after the fix passes on its first run and has never been shown
capable of failing. This one was.

The cells are chosen so the operators disagree with each other and with
identity: ordered both ways, equal-content-two-allocations, a prefix against
its extension, upper against lower case, a wide string against a narrow one,
and a pair that separates code-unit order from code-point order. Numbers get a
NaN row, because NaN makes all four operators false and that is the property
that makes `!(a > b)` and `a <= b` different predicates -- the same fact the
JVM session's `sign(NaN)` bug turned on, in record 0077, on the same day.

## Why it is not `strcmp`, and not `memcmp` either

The language orders strings by UTF-16 **code unit**. `nts_string_cmp` therefore
compares code units, and two things make that different from comparing storage:

- **Width.** A narrow string holds one byte per unit and a wide one holds two.
  A mixed pair has to compare a byte against a `uint16_t`, so there is no run of
  bytes to hand to `memcmp` at all. `nts_string_eq` already had this problem and
  solved it the same way, unit by unit, so that equality never allocates.
- **Above the BMP.** A code unit there is a surrogate. `"\u{1F600}"` leads with
  0xD83D, which is below 0xFFFD, so it sorts *before* `"�"` -- while its
  code point, 0x1F600, is far above. Both are defensible readings of "compare
  the strings" and only one is JavaScript.

Four operators, one runtime call, and the answer taken against zero the way
`memcmp`'s is. `<=` is spelled as `cmp <= 0` rather than as `!(a > b)`, and here
that would have been safe -- neither side can be absent. It is not safe on
doubles, which is the whole of 0077.

## What the JVM lane says about this

The JVM backend would have been accidentally correct. `String.compareTo` is a
code-unit comparison because Java strings *are* UTF-16, so that lane inherits
the specification's rule from its representation rather than implementing it.

That is worth more than "the JVM got lucky". A backend whose value model matches
the language's gets some semantics for free and pays elsewhere; the native lanes
have a representation that does not hand them the answer -- two widths, chosen
for density -- which is precisely why they got it wrong and why the rule has to
be written out. The density is not a mistake either. It is the same trade every
runtime with a one-byte string representation makes, and the cost of it is that
comparisons cannot be memcmp.

## What is still open

`docs/conformance/typescript.md` §9 has been split: strict equality and
relational comparison are separate rows now, because they were separate
implementations all along and one row claiming both is how the false ✅ was
able to sit there.

The general lesson has no mechanism yet. A rule that applies to a *family* of
operators and is implemented for one member of it is invisible to every check
here except the sweep, and the sweep only sees the members it enumerates. Both
halves of this defect -- 0044's and this one -- were found by someone reading
code rather than by a check. I do not have a way to ask "which operators does
this guard exclude, and is that deliberate?", and if there is one it is worth
more than either fix.
