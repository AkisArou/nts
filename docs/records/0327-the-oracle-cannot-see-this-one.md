# The oracle cannot see this one

```ts
function doubled(target: () => number): () => number {
  return function (): number { return target() * 2 };
}
class Thing { @doubled value(): number { return 5 } }
```

`new Thing().value()` is **10**. The emitted C is:

```c
static int32_t Thing__value(NtsObj_Thing * v0) {
    (void)v0;
    v2 = 5;
    return v2;
}
```

Five. The decorator is not applied, not refused, and not mentioned.

## Every instrument was happy

It compiles, emits, links, runs, and returns a number. The gate is green. The
ledger row said `decorators` and nothing else.

**And the differential cannot see it by construction.** node has no native
decorators, so the harness's form of the program fails to load and `nts check`
reports a node crash rather than a disagreement. The one instrument in this
project that compares against node is blind here *because node is*.

That is a different failure from the ones this file is full of. A stale count is
a number nobody expanded; a truncated table is an instrument that did not say
what it left out. This is a case where **the oracle has no opinion**, and the
whole method rests on the oracle having one.

## Two probes said "handled" and "refused" about a compiler that does neither

The first decorator written was a no-op returning its target. It compiled — and
a no-op answers the same whether it is applied or ignored, so it distinguishes
nothing. Reading that as "decorators work" was one sentence away.

The second took a `ClassMethodDecoratorContext` and refused, as *a parameter of
unrepresentable type*. That reads exactly like "decorators are refused" and is
an accident of the **decorator's own signature** — the context type is
unrepresentable, so the decorator function fails to lower, and the class never
comes into it.

Only the third — behaviour-changing, ordinary parameter types — reaches the
case. Three probes, three different answers, one compiler.

This is the reduction trap ([[0325]]) with an extra turn: it is not only that a
simpler probe passes, it is that a simpler probe can *fail for the wrong
reason* and be read as confirming the row.

## What it needs, and why zero sites is not the reason to leave it

The node does not reach the snapshot. `syntax.rs` carries `(171, "decorator")`
in its name table with no Rust constant, nothing in `compiler/core` mentions
decorators, and `nts frontend` decodes none. **The compiler cannot see what it
is dropping**, so refusing is a frontend change first and a lowering check
second.

No `@` decorator exists anywhere in `runtime/node`, `examples` or `benches`. A
wrong answer that runs is worth refusing at zero sites, because the cost of
finding it again is the cost of finding it this time — and this time it took a
probe written for a different row, on a question that started as "is this ✗
stale?".

## The sweep's arithmetic, at the end of it

Rows probed against the live compiler this session: eight were already true or
true in a narrower form than stated, two were worth building and were built, one
was worth building and was measured as clearing nothing, two were built and
reverted with their measurements, one was a wrong answer that ran and is now
refused, and one is this — a wrong answer that runs, filed, with the oracle
unable to help.

**Fourteen rows, and the compiler was wrong about three of them in a direction
the ledger did not record.** None of the three was found by reading.
