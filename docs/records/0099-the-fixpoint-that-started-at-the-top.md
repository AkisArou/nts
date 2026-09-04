# The fixpoint that started at the top

`Ball` in Are We Fast Yet holds four coordinates that never leave `int32`. The
C++ port declares four `int32_t`, the Java port declares four `int`, and this
compiler declared four `double` — 56 bytes against 40, and floating-point
arithmetic for values that fit in a register.

`hir::fields` exists to narrow exactly that, and its own doc comment names
`Ball` as the case. It could not narrow it.

    awfy-bounce   1.58x C++  ->  1.45x     (6.57 us -> 6.00 us)

Measured before and after on one machine, with `awfy-nbody` and `awfy-queens`
unmoved — which is what says the lever is self-reference and not fields in
general.

## Absent means TOP

    let mut crossing = Crossing {
        ...
        fields: FxHashMap::default(),

`Context::field_facts` answers `Facts::TOP` for a key it does not hold. So round
one of the interprocedural fixpoint read every field as unknown. `this.x +=
this.xVel` computed TOP from two TOPs, published TOP, and every round after
agreed with it. Instrumented rather than deduced:

    BALL field 0: whole=false nan=true negzero=false lo=-inf hi=inf

All four, and not one of them for the reason I expected — I had gone looking for
`-0`, because `this.xVel = 0 - Math.abs(this.xVel)` is `-0` when `xVel` is zero,
which an integer slot genuinely cannot hold. That is true and it is not what was
happening.

**The one field in the same program that *did* narrow is what made this hard to
see.** `Random.seed` is an `int32_t`, and its store is
`(this.seed * 1309 + 13849) & 65535` — bounded whatever its input was. The mask
makes the recursion irrelevant, so the one field that escaped the bug escaped
for a reason that has nothing to do with fields. A bug hiding behind a
coincidence in the same file.

## The fix was already written down, one field away

    /// BOTTOM rather than absent, for the same reason parameters start there:
    /// an absent entry reads as TOP at the use, and a function whose result
    /// depends on its own result then converges to TOP. `fib` returns
    /// `fib(n - 1) + fib(n - 2)`.

That is the comment on `Crossing::returns`, four lines above `fields:
FxHashMap::default()`. Someone hit this exact bug for returns, understood it,
wrote the sentence, fixed that field, and left its neighbour empty.

Fourth staleness of the week, and the first where the **correct text was in the
right file, adjacent to the defect, and did not prevent it**. The other three
were comments that had become false. This one was true, and load-bearing, and
about the line above.

## What the mutation said about my own fix

`fields::initial` gives every number field the allocator's zero. Seeding
`Facts::BOTTOM` instead **changes nothing**: no test fails and all 99 examples
agree, because `analyze` joins that zero in every round anyway.

So the seed's *value* is not the fix. **The fix is that the entry exists**, and
the comment says that now rather than the more satisfying thing I wrote first.
Worth keeping because it is the sharper statement of the bug: not "the fixpoint
started from the wrong value" but "the map had no entry, and absent is the top
of this lattice".

## What the numbers say

| row | before | after |
| --- | --- | --- |
| `awfy-bounce` | 6.57 us, 1.58x C++ | **6.00 us, 1.45x** |
| `awfy-nbody` | 7.95 ms, 1.12x | 7.95 ms, 1.13x |
| `awfy-queens` | 6.87 us, 1.44x | 6.83 us, 1.47x |

One row moved. `nbody` and `queens` store `number` fields too, so the lever is
narrower than "fields": it is fields whose stores read themselves. The JVM lane
reports the same row at 1.72x → 1.55x of hand-written Java on its own measure.

This does not close 0049's `awfy-bounce` row, which is about objects held by
value: the C++ reference stores balls in a `std::array<Ball, N>` and this
compiler stores pointers. It takes 1.60x of that argument off the table — the
part that was field width rather than indirection — and leaves the rest.

## Ratchets

- `examples/field-widths` — 174 cases against node on C, LLVM and under
  counting. A self-referential field that narrows, and five that must not: one
  that halves itself, one that can reach NaN through itself, one that can be
  `-0`, one that doubles past `int32`, and one divided through a shared prefix.
  Each carries a distinct shape, because four classes with one `number` field
  are one layout and the narrowing then joins all their stores — correct, and it
  makes the cases indistinguishable from outside.
- `compiler/core/tests/field_widths.rs` — two tests, two mutations. Emptying the
  seed fails the first; seeding `BOTTOM` fails neither, which is recorded rather
  than papered over.
- No memory case and no benchmark row of its own: the change is a width, the
  memory suite is green either way, and the benchmark evidence is the before and
  after above on an existing row.
