# TypeScript's own tests, compiled as programs


<sub>Written by `nts-suite`, compiled in `/home/akisarou/Projects/nts`. It writes that tree's `results/suite/corpus.md` wherever it is run from, including a sealed worktree — the destination is chosen when the binary is built, not when it runs. Regenerate with `cargo run --release -p nts-suite`.</sub>

184 single-file cases from TypeScript's own test suite, compiled as ordinary programs.

| outcome                     |  files |
| --------------------------- | -----: |
| lowered completely          | **60** |
| refused a construct         |     37 |
| rejected by the typechecker |     87 |
| **the frontend fell over**  |  **0** |
| **invalid HIR or a panic**  |  **0** |

Of the 97 that typecheck, **61%** lower completely. The typechecker rejects the rest by design — a compiler's test suite is largely programs that are supposed to fail.

The last two rows are the ones that must stay at zero: a panic or a rejected SSA form on arbitrary input is a bug however well the hand-written tests do, and so is a query this compiler makes that the typechecker cannot answer.

The second row was counted as a typecheck rejection until it was split out, which is how eight of these hid. Six are now survived: a batched query that crashes tsgo is bisected and retried, so one poisonous location costs its own type rather than the file. The two that remain are an enum member whose value is `NaN`, which tsgo cannot write as JSON at all — and they are reached through queries whose answers are _sets_ rather than positional lists, where dropping the one that failed would quietly change a type rather than leave a hole.

What is stopping the rest, in order — and **read this table as breadth rather than as a work queue.** A refusal count and the lowered count are different currencies and do not convert: a file refused for three reasons does not lower when one of them is fixed. Default parameters cleared seven files out of this table in one commit and moved _lowered completely_ by zero. The Node session watched the same thing at a larger scale — twenty-five name collisions cleared, two functions gained, and thirty-five _new_ refusals, as functions that had stopped at the collision were walked further and refused for their real reasons.

So a tall row means a construct many files use, which is worth knowing. It does not mean that fixing it moves the number above it.

| refused                                                                                                                             | files |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----: |
| foreign function `foo`'s return (which wants a c_int or c_double brand, a boolean, or a string, or void), a type with no native ABI |     7 |
| `x`, a name from an enclosing scope                                                                                                 |     6 |
| a module declaration, which has code in it                                                                                          |     5 |
| a class expression                                                                                                                  |     4 |
| a tagged template whose tag takes a rest parameter, which wants the substitutions as one array                                      |     4 |
| `x`, captured above its own declaration, where it has no value yet                                                                  |     3 |
| a function returning the type parameter `T`                                                                                         |     3 |
| an exported generic function this program never instantiates, so there is no copy for the export to name                            |     3 |
| foreign function `f`'s parameter `opts` (which wants a c_int or c_double brand, a boolean, or a string), a type with no native ABI  |     3 |
| `a`, which `an anonymous type` does not declare                                                                                     |     2 |
| a parameter of unrepresentable type (a union of `RegExp`                                                                            |  null | number  | undefined) | 2   |
| a parameter of unrepresentable type (a union of `RegExp`                                                                            |  null | number) | 2          |

This is a work queue ordered by evidence rather than intuition, which is most of why it exists.
