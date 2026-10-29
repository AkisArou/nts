# Bounds-check placement: ideas for the discussion

Ideas, not decisions. The user asked for smarter choices about where, when and
how bounds checks are placed, using TypeScript's static analysis as much as it
soundly allows (10-29), after the merge-bound fix brought back checks that a
wrong proof had removed. The fix lands first: a check removed by a wrong proof
is a memory-safety hole. The governing design is
[objects.md](../../foundations/objects.md#decisions) ("The bounds rule": every
index is proved in range or checked, and a read out of range gives
`undefined`), under the foundations' rule "the checker first, proofs where
TypeScript is unsound" ([foundations](../../foundations/README.md#the-bar)).

## What nts does today

`hir::bounds` removes a check in three ways:

- **A range:** the index is a whole number, not negative, and below the
  smallest length the array can have. Lengths come from the container's shape
  (the lengths of arrays that fields point at, whole-program; typed views
  whose buffers never move), from a length the program read and a branch
  narrowed, and from the loop's least lengths.
- **A relation:** the block was entered under `i < xs.length` for the same
  array (the same value, or two reads of one global or field that nothing
  writes), and nothing since the top of the block may have changed a length.
- **A whole-program proof that no store grows an array,** after which every
  allocated length is trusted.

An unproved check is one unsigned compare and a branch, inline (`nts_check`),
and it stops the program by name when it fails. L4 changes that failure into
`undefined`, as node answers; that is decided and not built.

**Any call that can run code ends a relation** (`may_move_a_length`), even a
call to a pure function of the program.

## Census

All 104 `benchmarks/cases`, prepared HIR for the C backend, on the compiler of
the 10-29 comparator sitting (main 0a072536b):

| access | checked | unchecked |
|---|---|---|
| array read | 206 | 213 |
| array write | 230 | 307 |
| string code unit | 121 | 66 |

49 of the 104 cases keep at least one check. These are sites in the code, not
executions. The ones that matter are in hot loops, and the backend's own
optimizer removes some of them after inlining. Two examples, seen in the HIR,
then in the machine code of the sitting's own benchmark executables:

- **`clbg-spectral-norm`**, a losing numeric row: in
  `for (let j = 0; j < u.length; ++j) t += A(i, j) * u[j]` the read `u[j]`
  keeps its check in the HIR, because the call to `A` (pure arithmetic, which
  touches no array) ends the guard's relation. `v[i] = t` keeps its check
  because, inside `Au`, nothing relates `v`'s length to `u`'s.
  - In the machine code, the C backend's clang inlines `A`, `Au` and `Atu`
    into `AtAu` and removes the `u[j]` check. Its two unrolled inner loops
    load directly, and only the `v[i]` stores, once per outer iteration,
    keep a check.
  - The LLVM backend keeps a compare and branch to the bounds failure in each
    inner loop, as well as the store checks.
  - The JVM backend gets the same HIR.
- **`awfy-sieve`**: `flags[i - 1]` under `i <= size` and `flags[k - 1]` under
  `k <= size` keep both checks in the HIR. Removing them there needs two
  facts: that `size` is `flags.length` (the only caller passes
  `new Array(5000)` and `5000`), and that `i - 1 < size` follows from
  `i <= size`, an offset relation. In the machine code, both the C and the
  LLVM backend remove both checks after inlining the allocation into the
  caller, so they cost the native backends nothing today.

So a check left in the HIR is a cost only where the backend's optimizer
cannot finish the proof, and whether it can depends on that backend's
inlining. A proof made once in `compiler/core` makes the result the same on
every backend, the rule the foundations set for every fact.

## What the checker gives an index

TypeScript has no numeric ranges. The ranges and relations are nts's own
analysis. What the checker does give:

- **Sound, and useful here:**
  - a `const` binding never changes, which fixes the array's identity (not
    its contents);
  - the function each call resolves to, so the call's effects can be
    summarized;
  - the kind of container: array, tuple or typed array;
  - literal indices.
- **Claims only,** usable only with a proof over every writer:
  - a tuple's length (`push` and `pop` work on a tuple that isn't readonly,
    and casts lie);
  - `readonly` (a mutable alias may exist);
  - the `T | undefined` that `noUncheckedIndexedAccess` gives a read: it
    types the read, it proves nothing about presence.

This matches the
[checker-facts inventory](checker-facts-inventory.md): the reach is in
licensing the facts the checker already gives with proofs over every
supplier and writer, not in asking the checker more.

## Ideas

1. **Calls that cannot change a length keep the relation.** A whole-program
   summary per function: it changes no array's length, and calls nothing that
   does (closures with known targets and runtime helpers included). Writing
   an element is not such an effect; changing a length is (`push`, `pop`,
   `splice`, assigning `length`, resizing or detaching a buffer), and a call
   whose target is unknown stays conservative. This is one fact in
   `compiler/core` that every backend reads. It would remove
   `spectral-norm`'s `u[j]` check.
2. **A relational domain instead of one guard lookup.** Constraints between
   values with offsets (`i + c <= n`), learned from the branches that dominate
   an access and from induction variables. With it, these are proved: `xs[i + 1]`
   under `i < xs.length - 1`, `flags[i - 1]` under `1 <= i <= flags.length`,
   `j < i < xs.length`, and arrays of equal length (`ys = xs.map(f)`, sibling
   `new Array(n)` arrays). Go's `prove` pass and LLVM's constraint
   elimination are the known designs. Idea 1 is this domain's rule for what a
   call removes.
3. **One test at loop entry** (loop versioning, already planned with the
   integral regions). Before the loop, test once that every index stays in
   range (`n <= v.length`), then run a copy of the loop without checks; the
   checked copy runs otherwise. This covers `v[i]` in `Au`, and loops bounded
   by a parameter instead of the array's own length. Only loops whose checks
   cost something are versioned: checks in the body, or checks that block
   vectorization.
4. **Neighbouring checks merge:** `a[i]`, `a[i + 1]` and `a[i + 2]` become one
   test of `i + 2` and one of `i >= 0`. This is the same domain as idea 2.
5. **Facts across calls:** nts compiles the whole program, so when every
   caller of a non-exported function passes an index in range, or arrays of a
   known length, the callee can take the fact at its entry, or be specialized
   per call site (`awfy-sieve`'s `size`).
6. **A cheap failure path once L4 lands.** A read out of range will give
   `undefined`. When every use of the read converts it to a number, the cold
   path can produce NaN directly, and the value stays an unboxed double. When
   the program tests the read for `undefined` itself, that test and the bounds
   check can be one branch (for an array with no holes and no stored
   `undefined`).
7. **The cost is mostly what a check blocks.** A check is already one
   predictable compare. In a hot loop, its branch can stop vectorization and
   keep values out of registers, which is why loops come first, and why this
   meets the numeric rows' machine-code study.
8. **The validation build is the safety net** (A3, being built). It re-checks
   every removed check at run time, with a named trap, so each new proof is
   tested over the corpus and the test262 records before it ships. It caught
   the merge bug by name, where ASan let a read of allocator padding through.

## For the discussion

- **Recommendation:** replace the single guard lookup with the relational
  domain (idea 2), with the whole-program effect summary (idea 1) as its rule
  for what a call removes, and build them in the compiler lane after the flow
  fixes land. Loop versioning (idea 3) follows on the same facts. Every step
  is validated by the A3 build and measured per row by instruction counts.
- **Evidence still to come:**
  - the list of checks the merge fix brings back, by function and benchmark
    (runtime2);
  - which checks reach the machine code of the losing numeric rows (the
    compiler's machine-code comparison).
