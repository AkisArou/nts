# 0067 — Two of those four were not ours

The backend goal opens with four rows where the LLVM backend trails the C
backend on the same HIR, and calls that "purely code generation" because the
frontend is held fixed. Half of it is not.

## The test the goal did not name

Every hypothesis so far asked what our IR withholds — struct types, `align`,
`inbounds`, TBAA, `nsw`. All refuted, which should have been the hint. The
question nobody asked is whether the **path** costs anything: the C backend's
output is compiled as C, and the LLVM backend's is handed to `clang -x ir`.
Those are not the same pipeline, and it is testable in one step — compile the C
backend's *own program* through the IR path and see which binary it resembles.

```text
row                C as C      C via -x ir   LLVM backend
absences            187.4 ns     186.6 ns      397.9 ns
array-predicates   2146.7 ns    2156.8 ns     2658.2 ns
dispatch          22272   ns   29622   ns    27693   ns
awfy-nbody         6462   us    8174   us     7874   us
```

## What that says

**`dispatch` and `awfy-nbody` are the path, not us.** The C backend's own
program, run through `-x ir`, comes out *slower than the LLVM backend's output*
— 29622 against 27693, and 8174 against 7874. Our IR is not worse than clang's
own IR through that route; it is slightly better. Nothing about our code
generation is being measured by those two rows.

**`absences` and `array-predicates` are ours.** The same program through the IR
path is within noise of the C path — 186.6 against 187.4, and 2156.8 against
2146.7 — so the path costs nothing there and the whole gap is what we emit.

## Why the path costs anything at all

Not established. Compiling identical source two ways gives 86 `<2 x double>`
through `clang -O2` and 47 through `clang -x ir -O2`, with 7 functions surviving
against 16 — so the IR path inlines less and vectorizes less. Whether that is a
different pass pipeline, a different cost model, or attributes the C frontend
adds is a separate question, and it is worth answering only if a row we can
otherwise close is still short afterwards.

## What it changes

The goal says start at `awfy-nbody`. That is now the wrong row: it is one of the
two the path explains. **`array-predicates` is the one to take** — it is ours,
it is 1.24x, and unlike `absences` it has no refuted hypotheses in front of it.
`absences` has six now: the string-length chain, the truthiness call, payload
narrowing, redundant phis, `align`, and — from this record's own work — struct
types, `inbounds` and TBAA.

The lesson is the one the goal already states, applied one level up. Six
hypotheses about our IR were refuted before anyone asked whether the comparison
itself was fair. A diagnosis nothing has contradicted is worth distrusting, and
so is a *framing* nothing has contradicted.
