# 0107 — A number is an f64, and a Java programmer writes int

All three AWFY rows still above hand-written Java have the same root, and it is
not codegen. A TypeScript `number` is an f64; where the reference's author
wrote `int`, this compiler carries a double. Each row was priced by editing the
*reference* to our shape, one declaration at a time.

| row | the edit | reference | edited | share of the gap |
| --- | --- | ---: | ---: | ---: |
| `awfy-queens` | `int[] queenRows` → `double[]` | 9.08 us | 10.35 us | **1.14x of 1.24x** |
| `awfy-bounce` | `Ball`'s four `int` fields → `double` | 4797 ns | 5409 ns | 1.14x of 1.67x |
| `generator` | `double i` → `int i` | 172.5 us | 588.8 us | **3.41x of 3.41x** |

`generator`'s polarity is reversed and its cost is twenty times larger, for the
reason record 0106 gives: the conversion lands *on* a loop-carried dependency
chain rather than beside one.

## What is fixed and what is not

`awfy-bounce`'s field width **was** fixed -- the self-dependent-field seed in
the interprocedural fixpoint, which took `Ball` to four `int32_t`s. The row
moved 1.67x → 1.60x, or **1.05x**, against the 1.14x the reference edit
predicted. So the lever was worth less on this lane than on the reference, and
the remainder is the codegen residue record 0099 measured and did not
attribute.

`awfy-queens` is **not** fixed: `queenRows` is still `double[]` here and `int[]`
there. Its elements are column indices in `0..7` and `-1`, so an `i32` element
is provable. That is the array analogue of the field case, and `hir::elements`
already works per-array.

## The shape of the general problem

`f64` is the correct default and the only safe one: TypeScript says `number`
and a program may put `0.5` in any of these. Narrowing is a proof obligation,
and the proof lives upstream in `flow` and `facts`.

What this backend can say is what the narrowing is *worth*, per row, by editing
a reference rather than arguing:

- a field is 8 bytes against 4, which is cache density;
- an element is the same, multiplied by the array;
- an operand of a mixed-width comparison or accumulation is a conversion, and
  a conversion on a loop-carried chain is the loop.

The third is the one that does not look like the others. It is one instruction
in every count and 3.4x in every clock.

## Why this is not a JVM finding

The C lane makes the identical choices -- `generator.specialized.c` has the
same `int32_t yielded; double limit;` -- and pays 6% where this lane pays
243%. So the *decisions* are shared, the *prices* are not, and a decision
measured on one backend is not thereby measured.

That is the argument for the `Java` column existing at all. Every other ratio
in the benchmark table divides a program by a program written in another
language for another runtime; this one divides our JVM output by a person's
Java on the same JVM, and it is the only column in which "our codegen costs
this much" is a statement rather than an inference.
