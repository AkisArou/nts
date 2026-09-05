# A generic class was refused because its declaration was never in its own group

`class Box<T>` was refused, one member at a time, with three different messages
and one of them a contradiction:

    a class of unrepresentable type (a representable type)

Every piece of the machinery for lowering it existed and had for a long time.
`copies_of` loops over instantiations, `lower_method_of` takes one,
`Substitution` maps the parameters, `instantiation_suffix` names the copy, and
`generics.rs` opens with a module comment explaining why a copy per
instantiation is the right answer. The ledger row said `✗ generic classes` with
no reason beside it.

**The whole of what was missing was the ability to find the class's type
parameters.** One condition, in one filter.

## The filter

`generics::instantiations` groups the checker's types by declaring symbol, then
looks for the declaration among them so it can zip its arguments against each
instantiation's. That group was built from types that had been **decomposed**:

    if !matches!(record.kind, TypeKind::Object { .. })
        || !snapshot.type_arguments.contains_key(&ty) { continue; }

An instantiation has to be decomposed to be lowered. A declaration does not, and
requiring it of both is what closed the row. `class Holder<T> { v: T }` has a
field with no width, so the frontend leaves `Holder<T>` a `Structured`
placeholder — **correctly**, because that type is never laid out and never
constructed. It is also the only thing that names `T`. Dumping the group made it
one line:

    ty= 1 kind=Structured  args=[T]        <- the declaration, filtered out
    ty= 8 kind=Object      args=[number]   <- the instantiation

With the declaration gone, the search for "the type whose arguments are its own
parameters" found nothing, `continue` abandoned every instantiation with it, and
`copies_of` fell back to lowering the class **as itself** — where `T` has no
representation, so each member was refused separately.

## Three more, each found by pushing on the first

Closing the filter turned a battery of shapes green and left four red. Three of
those were the feature not being finished; the fourth is the ledger's business.

**An instantiation has no base of its own.** The checker answers `getBaseTypes`
for a *declaration*, and `Box<number>` is a reference to one, so
`snapshot.base_types` held `Box<T> → Base` and nothing for the copy. Every copy
was baseless and `b.tag()` found no declaration in the hierarchy. The
declaration's base is the right answer whenever it does not mention a type
parameter; when it does it is `Container<T>`, whose layout is a placeholder, and
the copy is refused for that rather than dispatching through it.

**A `static` member is one function, not one per copy.** It was named
`Factory<86>.of` and called as `Factory.of`, so the call was dropped as calling
something refused. TypeScript forbids a static member from referencing a class
type parameter, so there is nothing for a substitution to change — and a call
site writing `Factory.of(n)` names no instantiation and could not choose between
them if there were several. Named without the suffix and emitted once.

**Which member of the group is the declaration is not decided by shape.** This
is the one that mattered, and it is the one I would have shipped without
noticing.

## The ambiguity that predates the change and had no teeth until it worked

"The declaration is the one whose arguments are its own type parameters" reads
like a definition. It is a heuristic, and the group can contain two:

    ty= 1  args=[K, V]    class Entry<K, V>
    ty= 6  args=[V, K]    the return type of `swapped(): Entry<V, K>`

Both `Object`, both all-parameter, and `find` takes whichever `snapshot.types`
holds first. In that program it is the declaration, by accident of interning
order. A generic *function* moves it:

    function widthOf<A, B>(entry: Entry<B, A>): number   // declared first

Now `Entry<B, A>` is interned before `Entry<K, V>` and is chosen, and the
substitution maps `A` and `B` — parameters belonging to a **function**, which
the class body never mentions. The class's own `K` and `V` resolve to nothing.

The failure is a refusal rather than a wrong answer, which is worth stating
precisely because I checked rather than assumed: to get silence you would need
the wrongly-chosen type to use the *same* parameter symbols in a different
order, and `Entry<V, K>` written inside `Entry` is always interned after the
declaration. So the reversed-substitution disaster is not reachable today. It is
one type-interning order away from being reachable, and nothing downstream could
tell — a reversed map is still a total map.

The fix is to stop guessing. `snapshot.node_types[class_declaration]` is the
class's own type and the type record carries the declaring symbol, so the
authority is available without walking the class's name.

**This ambiguity existed before this change and was unreachable, because the
whole feature was refused.** Closing a refusal does not only add the code the
feature needs; it makes reachable everything that was sitting behind it. That is
the second time this has come up — `delete` was sound only because four other
things refused — and it points the same way: a refusal is load-bearing, and what
it bears is not always written down.

## What the fourth deliverable measured, and what it refuted

The benchmark was supposed to be about monomorphisation. In the emitted C,
`Box<number>` holds an unboxed `f64` and `Box<boolean>` a byte. In JavaScript
there is one class reached from two shapes, so the access site is polymorphic;
in Java the parameter is erased to `Object` and both primitives are boxed. Three
answers to one question, and a row that ought to separate them.

    case               C++       nts C     nts JVM    Java      node      bun
    generic-classes    188.0 ns  188.6 ns  1.43 us    1.38 us   1.39 us   1.90 us
                                                      nts/C++ 1.00x  nts/node 0.14x

**1.00x against a C++ template**, which is the claim worth making: at 4096
iterations in 188 ns — a fifth of a cycle each — both lanes have removed the
objects entirely, and being a copy of a generic did not stop it.

The 0.14x against node is *not* evidence about generics, and the control is
what says so. The same loop with two hand-written classes and no generic at all:

    generic-classes    C++ 188.0 ns   nts C 188.6 ns   node 1.39 us
    hand-written       C++ 188.5 ns   nts C 188.5 ns   node 1.41 us

Identical in every lane. V8 escape-analyses the boxes away whether it sees one
class with two shapes or two classes, so the polymorphic-access story does not
materialise — and Java's erased, boxed version comes out *level* with our own
JVM lane rather than behind it, for the same reason. The row keeps its node and
bun columns because the table has them, and the file says in as many words that
the number belongs to the shape rather than to the feature.

Two earlier versions of the loop were discarded on the way, and both were
measuring something other than the subject. The first was independent per
iteration and ran at 0.18 cycles each, which is the auto-vectoriser. The second
carried `total` into the next iteration to stop that, and put every lane within
10% of every other — a serial dependency chain is latency-bound, so the object
representation stops mattering at all. **A benchmark can fail by being too fast
and by being too slow, and neither failure announces itself.**

## The memory case, and the cost that is not this feature's

    generic-copies    naive 0   actual 0   ideal 0   alloc 0   floor 0

Argued before measuring and right: two boxes per iteration, neither escaping,
both scalar, so escape analysis has the same question it had before generic
classes lowered at all and answers it the same way. The implementation this
separates from is the other one — erase `T`, box the field, one class for both
instantiations — which gives identical answers on every input, fails no test
anywhere, and shows up here as 34 allocations.

A zero is only worth having if the same program can be made non-zero, so the
control is the case with one box escaping into a module-scope array:

    zzz-control       naive 68  actual 68            alloc 18            LEAKED 17

Seventeen iterations, seventeen boxes retained, one array. The arithmetic comes
out right rather than the number merely being plausible.

**And a cost found on the way that this row deliberately does not carry.** The
first benchmark draft used a third instantiation at `string`:

    Box<string> in the loop              12288 ops, 0% elided
    a non-generic class, string field    12288 ops, 0% elided

Three reference-counting operations per iteration on a *constant* string stored
into a frame-placed object, and none of them elided — and the non-generic
control measures exactly the same, so it is not this feature's. Hoisting the box
out of the loop still leaves 8193, because the field read retains. Named work,
with a number and a one-line control.

## Measured

    profile refusal sites   2158 -> 2114
    ledger, sections 1-12   40 ✗ -> 43 ✗

Every variant of `a class of unrepresentable type (...)` went to **zero** — 162
sites across ten spellings, of which the largest were `(a function type)` at 94
and the self-contradicting `(a representable type)` at 38. `` `X`, which `X`
does not declare `` fell 73 → 58, and `a method `X` with no declaration in the
hierarchy` 72 → 68.

**129 of the 162 came back under the repaired message**, and reading them is
what produced the last ledger row. They are one refusal per member of a generic
class that `runtime/node` **exports and never instantiates itself**. That class
is not dead — a consumer instantiates it — but a copy needs type arguments, and
only a caller has those. So a library compiled alone emits nothing for its own
generic classes, which is a real limitation and is now written down rather than
being 129 lines that read like a lowering gap.

The net is 44. A handful of sites went *up*, all of them refusals newly exposed:
a member that used to be refused at its first line now lowers far enough to
reach a later one.

**The ledger went up by two and that is the right direction.** One bare `✗
generic classes` with no reason beside it became a `✅` and three rows that name
what is still refused and why — a generic base at a type parameter, a generic
method on a generic class, and a class constructing itself at its own
parameters. Each of those was inside the old row, unnamed and uncounted.

One diagnostic was repaired rather than left. `a class of unrepresentable type
(a representable type)` said its own opposite, because `unrepresentable` reads
the **member**'s type and the member was a getter returning a `string`. What has
no representation is the class, and after this change the refusal is reached by
a generic class that nothing instantiates — which is dead code, and now says so:
`a member of `Holder`, a class this compiler has no type for`.

## Ratchets

- `examples/generic-classes` — 377 cases against node on C, LLVM and under
  counting, over 12 exports: two instantiations at different widths, a class as
  the type argument, `Box<Box<number>>`, a constraint, a generic class extending
  a plain one, an override reached through the base from two copies, a
  **non**-generic class extending a generic one at a concrete argument (the
  shape `runtime/node` is full of), an interface, a generic class as a field, a
  static, and two type parameters.
- `examples/generic-classes-unsupported` — the three shapes that have no copy to
  make, each refused with its reason written beside it in the fixture.
- `compiler/core/tests/generic_classes.rs` — four tests, **five** mutations, and
  every one caught: requiring the declaration to be decomposed (2 tests),
  choosing the declaration by shape (2), naming a static for a copy (1),
  emitting a static per copy (1), and dropping the base fallback (2).
- The fifth mutation is the one worth keeping the note about. It first failed
  only a test whose subject was something else, because the fixture had
  `Labelled` **overriding** the method it reached — so the lookup found it
  without ever consulting a base. `Tagged#origin`, overridden nowhere, is what
  gives that test a subject. A green with no subject is the fourth costume, and
  this is the second time this week it has been mine.
- `tooling/memory/cases/generic-copies` — 0 / 0, argued before measuring, with
  the escape control above.
- `benches/cases/generic-classes` — 1.00x C++, with a `ref.java` whose erasure is
  the implementation this rejects, and a control saying what the node column
  does not mean.
