# TypeScript's own tests, compiled as programs

<sub>Written by `nts-suite`, compiled in `/home/akisarou/Projects/nts-lanes/tsrs`. It writes that tree's `results/suite/corpus.md` wherever it is run from, including a sealed worktree — the destination is chosen when the binary is built, not when it runs. Regenerate with `cargo run --release -p nts-suite`.</sub>

184 single-file cases from TypeScript's own test suite, compiled as ordinary programs.

| outcome | files |
| --- | ---: |
| lowered completely | **61** |
| refused a construct | 37 |
| rejected by the typechecker | 86 |
| **the frontend fell over** | **0** |
| **invalid HIR or a panic** | **0** |
| **compiler process crashed** | **0** |

Of the 98 that typecheck, **62%** lower completely. The typechecker rejects the rest by design — a compiler's test suite is largely programs that are supposed to fail.

Frontend failures, invalid HIR, compiler crashes, uncompilable C and unverifiable classes must stay at zero. The full corpus runs each compilation in a child process: a signal is attributed to its source file, the worker restarts, and the remaining cases still run.

What is stopping the rest, in order — and **read this table as breadth rather than as a work queue.** A refusal count and the lowered count are different currencies and do not convert: a file refused for three reasons does not lower when one of them is fixed. Default parameters cleared seven files out of this table in one commit and moved *lowered completely* by zero. The Node session watched the same thing at a larger scale — twenty-five name collisions cleared, two functions gained, and thirty-five *new* refusals, as functions that had stopped at the collision were walked further and refused for their real reasons.

So a tall row means a construct many files use, which is worth knowing. It does not mean that fixing it moves the number above it.

| refused | files |
| --- | ---: |
| foreign function `foo`'s return (which wants a kind from `@nts/scalars` (`Int32`, `c_int`, `Float64` ...), a boolean, or a string, or void), a type with no native ABI | 10 |
| `x`, a name from an enclosing scope | 6 |
| a module declaration, which has code in it | 5 |
| a tagged template whose tag is not a plain declared function | 5 |
| `x`, captured above its own declaration, where it has no value yet | 3 |
| a class expression | 3 |
| a function returning the type parameter `T` | 3 |
| an exported generic function this program never instantiates, so there is no copy for the export to name | 3 |
| destructuring something with no fields | 3 |
| foreign function `f`'s parameter `opts` (which wants a kind from `@nts/scalars` (`Int32`, `c_int`, `Float64` ...), a boolean, or a string), a type with no native ABI | 3 |
| `a`, which `an anonymous type` does not declare | 2 |
| a parameter of unrepresentable type (a union of `RegExp` | null | number | undefined) | 2 |

This is a work queue ordered by evidence rather than intuition, which is most of why it exists.
