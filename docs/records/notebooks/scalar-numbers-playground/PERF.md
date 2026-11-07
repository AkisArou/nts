# Checking time, v19

The baseline is unpatched tsgo, the parent of the scalar commits (`0034463f2`).
Each row is a hyperfine mean with `--singleThreaded`, measured on 2026-10-08 on
this machine; σ is 2-15%. `test.sh` repeats three rows as tripwires (with the library, 2000 expressions, 1000 comparisons), and diffs the diagnostics of the second.

| program | unpatched | v19 | ratio |
|---|---|---|---|
| TypeScript's own compiler sources (plain code, no library) | 1.24 s | 1.21 s | 0.98 |
| the same, with `scalars.d.ts` added to the program | 1.39 s | 1.41 s | 1.01 |
| the tour (`scalars/`: every case, 7 platforms) | 43 ms | 48 ms | 1.11 |
| 2000 scalar expressions mixing `+ - * & \| ^ << >> >>>` | 191 ms | 213 ms | 1.11 |
| one function of 1000 `if (x >= i && x < i + 5)` on a scalar `x` | 206 ms | 667 ms | 3.2 |

The diagnostics of TypeScript's compiler sources with the library added are
identical to unpatched tsgo's (86 errors, from the missing node types).

**The last row is the narrowing feature's own cost.** Comparisons become flow
conditions, and every reference to `x` walks back through all of them, as
TypeScript's own narrowing does for a union. Each condition's narrowing is
computed once per input type and then read from a cache; what remains is the
walk. A plain number's references step over these conditions.

## What measuring found

Three defects that no correctness test saw (the tests are small programs):

- **A quadratic walk: 21x on a plain program with the library added** (34.4 s
  against 1.6 s). The lossy-operand check asked `getTypeOfExpression` for each
  operand. For a binary operand that re-checks the whole subexpression, so a
  `TypeFlags.A | TypeFlags.B | ...` chain went quadratic. Operand types are now
  the caller's, and a sum's true range is remembered when the sum is checked.
- **A stack overflow on the same program.** Reading an operand's checked type
  from inside flow analysis (`checkExpressionCached` under TypeOnly) re-entered
  the flow condition being evaluated. Exact ranges are now remembered bottom-up
  when each expression is checked, in any mode, so nothing is checked twice.
- **A crash on an intersection-typed generic parameter** (`b: T & {...}`): the
  syntax walk read it as a union.

Then two speedups, 11.5 s down to 0.67 s on the comparisons row:
- values and kinds that don't differ by target are computed in one column, not
  17;
- each comparison's narrowing is memoised per input type.
