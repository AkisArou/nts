# Base-first layout was relied on by three backends and true in neither of two ways

`Layout.base` was added to stop `class Circle extends Shape {}` merging into
`Shape`. It does that. Then the `verify` check that came with it failed **20 of
the 22 `runtime/node` modules** on its first run, and that is the larger half.

## Why the field existed at all

Layouts are structural. Two types with the same fields and the same dispatch
table are one layout, one struct, one descriptor — which is what lets `Point`
and the anonymous `{ x: number; y: number }` of a literal be passed to each
other, and is right.

It is also how an empty subclass became its base. `class Circle extends Shape
{}` adds nothing, so it has `Shape`'s fields and `Shape`'s dispatch table; the
two merged, took one descriptor, and `s instanceof Circle` answered true for a
`Shape`. nts said 3 where node says 2.

`Hierarchy::base` has held the answer since layouts existed and discarded it at
layout construction. `Layout.base` keeps it.

The comparison lives **inside** `same_shape`, as a parameter, rather than beside
it at the two call sites. They must agree; as a parameter, forgetting is a
compile error. That is the fifth time this week the fix has been to make the
second place unable to disagree rather than careful.

## What the check found

Base-first layout — a derived object's fields begin with exactly the base's —
is what makes an upcast free. The C backend spells it as a pointer cast, the
LLVM backend as nothing at all, the JVM backend as a `super_class` its verifier
checks at load time. Three backends depending on it. No pass asserting it.

**Order.** `NodeTypeError` laid out `["message", "name", "code"]`;
`ERR_INVALID_ARG_TYPE` extending it laid out `["code", "name", "message"]`.

There *was* ordering code. It re-derived the base's order by walking
`base_types` and reading each base's properties, then sorted the derived's
fields towards that. It read properties only from records of the `Object` kind
and skipped everything else — and every `abstract class` in that error
hierarchy is a different kind. So the recovered order was **empty**, the sort
was a no-op on an empty key, and the field order fell back to the checker's,
which puts a class's own declarations first.

**Presence.** `ERR_INVALID_ARG_TYPE_FUNCTION` laid out `["message", "name"]`
under a base laid out `["message", "name", "code"]`: *fewer fields than its
base*. `override readonly code = "ERR_INVALID_ARG_TYPE"` has a string literal
type — one value, no storage needed — so the field was elided. An upcast would
have read past the end of the object.

## One fix, and why it is a construction

A derived class's fields **are** the base layout's fields, then its own.

Not sorted towards the base's order: taken from it. The difference is that a
sort towards a re-derived order can silently do nothing, which is exactly what
happened, while taking the base's actual layout cannot disagree with the base's
actual layout. And it fixes presence for free — whatever the base stores, the
derived stores, because the derived's list starts as a copy of it.

`inherited_order` is deleted rather than left beside its replacement.

## The half that stays open

Two empty *siblings*. `Circle` and `Square` both extending `Shape` and adding
nothing share fields, dispatch table **and base**, so they still merge: nts
answers 7 where node answers 6.

That case went into the example expecting to pass. It did not, and I would not
have predicted it — the fix looked complete until the differential disagreed.
A base separates a child from its parent; it cannot separate two children
differing in nothing but their names. That question is *nominal*, which is what
the four provided error classes needed and got a narrow nominal guard for in
0074, and that guard stays. Giving those four a base from the checker would make
them worse: all four would carry `Error` and merge on fields, methods *and*
base.

So the ledger row is narrowed rather than closed, and names which half is left.

## Under-refusing

The JVM session had a stand-in for this field: refuse any program where one
layout's fields are a proper prefix of another's. Their words for why it failed
are the best thing to come out of the week:

> A refusal that over-refuses is safe; mine under-refused.

A refusal is a claim — *I do not handle this*. Over-refusing makes the claim too
often: annoying, visible, and it costs features you could have had.
Under-refusing makes it too rarely, so the program compiles and the claim was
false. Those are not two directions of one error. They are an error and a lie,
and from inside they are indistinguishable, because both are "the check passed".

Their guard was silent on precisely the eight cases it existed for: `class
Bounce extends Benchmark` with zero fields on both sides is a prefix of nothing.
Both of today's layout bugs are the same shape, and so is `same_shape` saying
"these are one class" about two that are not.

## What this is really about

Every other check here reads a running program — the differential, the sweep,
the memory suite, eighty-nine examples. `verify` reads the IR, so it can hold a
property that no program demonstrates.

Base-first layout is exactly that: relied on everywhere, visible nowhere, and
wrong for as long as `runtime/node`'s error hierarchy has existed. It produced
no wrong answer, because nothing had yet upcast one of those objects and read
through it. It was waiting.

The check was asked for by the JVM session, and added expecting it to pass.
