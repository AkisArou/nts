# The reason outlived the condition it described

`provided_layout` built the four provided error classes with `base: None`, and
said why:

> The provided error classes are not declarations in this program, so the
> hierarchy has no base for them — and giving them one from the checker would be
> **worse than none**: all four would carry `Error` and merge on identical
> fields, methods *and* base, which is the defect `0074` names.

That was true when it was written. It is not true now, and nothing said so.

`collect_layouts` grew a nominal guard for exactly this family — `two_errors`,
which refuses to merge two differently-named error layouts whatever their shape
says. Once that existed, a base stopped being dangerous. The condition the
comment described had been removed and the comment stayed, reading as a reason.

**Third stale comment this week.** 0090's was `examples/closures` describing a
base-first layout that was never built; 0092's was `omitted_after` saying a rest
parameter is refused at the declaration, months after rest parameters landed.
All three were true when written, all three were load-bearing in the reader's
head, and none of them was checkable.

## What it cost

`TypeError extends Error` is a fact the compiler holds — `lower_instanceof`
spells it through `provided_errors_under`, because `e instanceof Error` inside a
`catch` is the reason `instanceof` is worth having. `Layout.base` never got it.

Invisible on this lane. An upcast is a pointer cast, so storing a `TypeError`
where an `Error` is declared is a no-op that C has no opinion about. On the JVM
it is a nominal relation checked at class load, and `nts/gen/TypeError`
extending `Object` does not verify:

    NTS4001 storing a `TypeError` where a `Error` is declared

Two lines, and `examples/exceptions` and `examples/errors` now agree with node
through the JVM backend as well as C and LLVM.

## The assertion that could break

A base is a *fourth* identical thing about four classes that already share
their fields, their method tables and their emptiness. 0074 found that shape
merged them into one layout with one descriptor, and `e instanceof TypeError`
answered true for a `RangeError` — the answers were wrong and nothing could see
it until `instanceof` existed.

So `examples/errors` gained a case that throws each of the three and asks node
about all three tests, and `error_hierarchy.rs` asserts no two of the four share
a type id. Removing the base fails the first test and reproduces the JVM's
NTS4001; giving `Error` a base of its own fails it too.

The second test was wrong on its first run and the fix is worth recording:
I asserted each error layout carries **one** type id, and `TypeError` carries
two. That is not a merge of two classes — `collect_layouts` unifies layouts
naming the same type however they were built, so one class reached twice is one
layout with two ids. The property is that no two of them *share* an id, which is
what a merge would look like from the other side.

## Ratchets

- `examples/errors` — 122 cases against node on C, LLVM and under counting, with
  `acrossTheHierarchy` throwing each of three and asking `instanceof` three
  times.
- `compiler/core/tests/error_hierarchy.rs` — two tests, two mutations, each
  failing the right one.
- No new example, benchmark or memory case: the emitted C is unchanged and the
  instrument is the other backend, exactly as in 0096.
