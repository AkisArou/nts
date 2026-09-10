# The order was in the IR all along

`Object.keys` walks the layout's field list, because a compiled object has no
insertion order. JavaScript orders own string keys by **insertion**. One layout
is one order, so the two agree only when the layout *is* the order the program
writes — and it was the order the *checker* gives, which for
`interface Extended extends Base { c }` puts the derived member first.

A program writing `{ a, b, c }` everywhere was laid out `c, a, b` and answered
`c, a, b`.

## The second attempt, and the first is why

Record 0258 laid **inherited** fields first, measured it, and reverted it: four
structural-cast refusals cleared and `examples/key-order-through-an-extended-interface`
went from 29 of 29 agreeing with node to 0 of 29. That attempt and this one are
both ordering rules. The difference is where the order comes from — a
declaration in one, the program in the other — and only one of those is what
`Object.keys` is asking about.

Its conclusion was that key order needed to be **recorded per allocation site**,
which read as a representation change: storing something currently thrown away.

## It is not thrown away

The JVM lane read its own emitted bytecode for the failing case and found:

    field.set %0.1 = 7      // a
    field.set %0.2 = 1      // b
    field.set %0.0 = 2      // c

Indices are the layout's; **the sets are in source order**. `{ a: 7, b: 1, c: 2 }`
produces sets at 1, 2, 0 and that sequence *is* the answer `Object.keys` should
give. So the fix is not a representation change. It is taking the same fact
before the layout is decided instead of after.

`Naming::written_order` collects it once for the whole program, beside
`generators`, for the same reason: a builder is made fresh per function and one
cannot see another's.

## Keyed by the field-name set, because the first key found nothing

The collector was right on its first run and the lookup missed every time. An
object literal has a **type of its own** — `{ a: n, b: 1, c: 2 }` written as an
`Extended` is not `Extended`'s id — and the two are merged into one layout later,
structurally. Keying by the literal's id and looking up by the declared type's is
two different questions.

The key is the sorted field-name set, which is the same rule the merge uses. A
literal naming one field twice is dropped: the second write wins in JavaScript
and there is no shape to order.

## Where the program disagrees with itself, nothing is done

A file writing one type `{ a, b, c }` in one function and `{ c, a, b }` in
another has no single layout that satisfies both. Those shapes keep the
checker's order and `agreements/key-order-of-an-extended-interface` runs and
disagrees on purpose — that is a fact about JavaScript, where insertion order is
per **object** and a layout is per type, rather than about this compiler.

## What it cost and what it bought

Nothing and nothing, respectively, outside the thing it was for. 152 of 152
examples agree with node on both LLVM lanes and 151 of 152 on the JVM; tests,
blockers and the refusal ledger unchanged. Neither backend needed a line: the
JVM's key array is a compile-time constant, so it renders whatever the IR hands
it, and it confirmed the identical wrong answer *and* the identical fix from its
own constant pool rather than from the matching number.

**And the claim written into the fixture header first was wrong.** It said this
gets the pointer-cast prefix property for free "where the program happens to
write base-first, which is most of the time":

    75 structural-cast sites   before any ordering change
    71                         under inherited-fields-first (reverted)
    74                         under this

**Once.** The four that inherited-first cleared are types the program builds
through constructors and parameters rather than literals, which an order taken
from literals cannot see. Key order is what this buys. The header says so now,
because the version that did not was written before the survey came back and
would have read as a measurement.
