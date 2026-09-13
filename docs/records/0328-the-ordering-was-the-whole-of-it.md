# The ordering was the whole of it

`a > b` between two objects emitted `gt` on two pointers. It answered **true for
every input**, 29 of 29 cases disagreeing with node, and was refused by name a
day ago. It is answered now, and the feature is smaller than the row implied.

`OrdinaryToPrimitive(O, "number")` is: try `valueOf`, take the result if it is a
primitive, otherwise try `toString`, otherwise `TypeError`. For a **typed**
receiver that is a static dispatch — `valueOf` and `toString` are members this
compiler already puts on the descriptor, so "does this object have a `valueOf`"
is a question about the type, not a prototype walk.

The blocker that held it said so:

> a dispatch on a member this compiler does put on the descriptor, so it is
> reachable machinery wanting an ordering rather than missing machinery

**The ordering was literally the whole of it.** The implementation is a loop
over `["valueOf", "toString"]` that takes the first whose return type is a
primitive.

## The arm that is the specification rather than a convenience

```ts
class Boxed {
  valueOf(): Inner { return this.inner }     // legal, and not a conversion
  toString(): string { return "B" + this.inner.tag }
}
```

The specification says to try the next method when the first does not produce a
primitive. A compiler that took the first method it *found* would compare two
pointers again — the exact bug this row started as, reintroduced by a plausible
reading of "call `valueOf`".

Without that arm the example passes under both implementations. With it, the
example distinguishes them. Same rule as `deferredOne` ([[0318]]) and
`sameAsConversion` ([[0324]]): **pick the arm where the two candidate
implementations differ.**

## What the row turned out to be

Five rows share the coercion queue and most of the family cannot be written:

```text
o + 1        TS2365   rejected by the checker
"1" == 1     TS2367   rejected by the checker
`${o}`                refused by its own row
Number(o)             refused by its own row
a > b                 the one a checking program can write
```

So the queue item reads as five features and is one reachable member plus four
that a TypeScript program cannot express. That is why the row it belongs to had
an empty cell ([[0314]]) — and why the first thing to do with a coercion row is
find out which of its members typecheck.

## What is still refused, each for its own reason

An object with **neither** method: JavaScript throws a `TypeError`, this
compiler has no cross-call throw to do it with, so it says so at compile time.

Two sides converting to **different** primitives — `valueOf(): number` against
`toString(): string` — which the specification answers by converting again, and
nothing here is entitled to pick a representation.

Hint **`string`**, which nothing reaches, because the two shapes that would want
it are refused by their own rows.

Three refusals where there was one, and each names a different thing. That is
the same split as `hir::builtin`'s three arms ([[0315]]): a default arm
accumulates, and the way to stop it is to say which case you are in.
