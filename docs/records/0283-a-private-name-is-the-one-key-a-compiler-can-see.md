# A private name is the one key a compiler can see

    if (value === null || typeof value !== "object" || !(#list in value))
      throw new ERR_INVALID_THIS("URLSearchParams");

    NTS1001 an `in` whose key is not a literal the compiler can see

It is the opposite. `#list` cannot be computed, cannot be forged, and is scoped
by the language to the class body that declares it. It is the only key whose
declaring class is knowable exactly.

`literal_key` reads the node's *type*, and a private name in this position is
syntax rather than a string literal, so it answered nothing and the refusal
said the key could not be seen. The machinery to answer was already there:
`"k" in value` on an `object` lowers to `InstanceOf` over the classes declaring
`k`, which is what a brand check is.

## The count, and how I got it

Six sites, all this idiom, all in `url`. `URLSearchParams.#brandCheck` alone had
**14 functions cascading on it** — `append`, `get`, `getAll`, `has`, `entries`,
`keys`, `values`, `sort`, `toString`, `get size` among them.

Three sites cleared: `#brandCheck` and `URL`'s two over `#record`. The other
three are `#list in this`, which now reach a *different* refusal — `an `in` on
something that is not an object` — because the guard narrows `this` rather than
a parameter.

**And nothing newly compiles.** The 14 stopped cascading on `#brandCheck` and
now cascade on `ERR_MISSING_ARGS#constructor`, one link further along. Written
that way deliberately: [[0282]] recorded the same mistake twice in one document,
reporting cleared refusals as cleared functions and then cleared functions as
compiling ones. The cone moved one link; that is the whole claim.

## The soundness case, which the fixture found on its first run

Two classes may each write `#list`. They are **different names**, so a brand
check must answer `false` for the other one — and `declares` matches on the
name, so it answered `true` in both directions. 58 cases disagreeing,
`Holder.brands(new Decoy())` true where node says false.

Without a decoy class the fixture would have passed, and the defect would have
been that every brand check in the tree accepts the wrong receiver — the exact
failure a brand check exists to prevent. The fix is to keep only the class
enclosing the `in` and its subclasses, which is the only place the name is in
scope. Sabotaging it back returns all 58.

An empty set after that filter is **refused** rather than folded to `false`. For
a public key an empty set is the honest answer; a private name is always
declared by the class it is written in, so an empty set means the compiler
failed to find something the language guarantees, and `false` would make every
brand check throw on its own instances.

## What the fixture found instead, which is worth more

The first decoy was an exact structural twin, and the fixture kept failing after
the restriction was correct and checked by hand. It was measuring something
else:

    class A { x: number }   class B { x: number }
    new B() instanceof A    // ours: true.  node: false.

**Two classes whose fields match exactly share one layout, and therefore one
descriptor.** `instance_of` resolves each class to a layout and compares
descriptors, so it cannot separate them. The emitted C for all three cases is
one line — `nts_is_class(v3, &nts_desc_NtsObj_A)` — and there is exactly one
descriptor in the program. `class B` does not exist at runtime; it *is* `A`.

Nothing refuses. It compiles, runs, and answers wrongly, which makes it the only
defect this week that announced itself with no diagnostic at all. Filed as
`blockers/two-classes-one-descriptor`, as a `lowers` guard because there is no
refusal to assert on, with the example deliberately absent: an example must
agree with node, and writing one that fails would redden the gate for everyone
over a defect nobody is fixing today.

The fix is a descriptor per class rather than per layout. Sharing the *struct*
is a real economy and is not the problem; sharing the identity is. Both backends
compare descriptors, so it is one decision for both and belongs with the Node
and JVM lanes rather than in a unilateral commit.

**Which pairs collapse, after getting the table wrong once.**

    no base, identical fields                COLLAPSES
    same user base, identical extra field    COLLAPSES
    two field-less siblings of one parent    COLLAPSES
    identical fields, base `TypeError`       COLLAPSES
    ancestor vs descendant                   distinct
    same field name, different type          distinct
    different field name, same type          distinct

The fourth row read `distinct` for an hour. I ran the probe, read `tail -5`,
saw one function's disagreements in those five lines and concluded the error
pair agreed. Counted per function it was `12 qIsNotP` and **`8 twoIsNotOne`** —
disagreeing the whole time, three lines above where I stopped reading. **A tail
is not a summary**, and the emitted C had said so without arithmetic:
`static void ERR_TWO__constructor(NtsObj_ERR_ONE * v0)`.

I told the Node lane the `ERR_*` family was safe *because* of the base, and had
to retract it. Their weaker original claim — latent because nothing asks — was
the true one, and I had talked them out of it. The other six rows were then
re-counted rather than defended; only that one was wrong.

**What is actually merged**, from `tooling/conformance/merged-layouts.mjs`,
which reads the layout out of `nts hir`'s own printing (`this: managed<obj#1>`):
five groups, twelve classes — `ErrnoException`/`UVAddressError`, the
`Primitive`/`Batch` source pairs, `BroadcastConsumer`/its iterator, and
`ERR_SERVER_NOT_RUNNING`/`SocketPeerEndedError`. **No `instanceof` in
`runtime/` names any of them**, confirmed independently by the Node lane. Latent
everywhere, and each one a wrong answer waiting for the first `instanceof`.

`SocketPeerEndedError` merging with `ERR_SERVER_NOT_RUNNING` is a cross-family
pair neither lane would have predicted by inspection, which is the argument
against reasoning about this defect from names.

**How far it reaches, because the first guess was that it reaches a published
surface.** The Node lane raised `util/src/types.ts`, whose sixteen typed-array
predicates are each `value instanceof Uint8Array`, and typed arrays are the
purest same-shape case there is. `util` publishes `types`, so a collapse would
make `isUint8Array(new Int8Array(2))` answer `true` where a program acts on it.

It does not reach them. Typed-array `instanceof` never reaches the layout
lookup — it emits `nts_is_view_kind(v44, v45)`, an element-kind test, because
these are `View`/`AnyView` and never `Object(TypeId)`. Read out of the emitted C
rather than argued from the types.

So the blast radius is **user-declared classes sharing a field shape**, and no
host surface at all. A good question with a wrong conclusion, answered in one
build, and the narrowing is worth more than the original filing: "anything using
`instanceof`" and "two declared classes with identical fields" are different
sizes of problem.

What decides the fix is the Node lane's other point. `X.isX(value)` is
`value instanceof X` throughout this profile — `BlockList.isBlockList`,
`SocketAddress.isSocketAddress`, `AssertionError`, `util.types`' whole surface —
and those are the *documented* predicate rather than an incidental use.
**A profile whose `instanceof` cannot separate two declared classes cannot
implement them.**

## One idiom, two spellings, and only the spelling decided

Three of the six sites are `#list in this` rather than `#list in value`, and
they kept refusing after the fix — with a different message:

    NTS1001 an `in` on something that is not an object, which JavaScript throws for

Said of `this`, inside a class, three lines under `typeof this !== "object"`.

**Inside a class body `this` is a type parameter, not the class.** `declares`
asks for `TypeKind::Object` and a parameter is not one, so it answered
`NotAnObject` — a sentence about a receiver that is provably an object, said of
a type variable. `generics::concrete` already resolves a `this` parameter to its
constraint for the call path, and is bounded the same way: a constraint that is
itself a parameter stays unresolved and keeps refusing.

All three cleared, and `searchparams.ts` went from 10 root refusals to 7 — one
of them because `next()` got *further*, to `{ value: undefined, done: true }` at
line 660. Six sites, one idiom, two spellings, and only the spelling decided
whether it lowered.

## The sabotage, which landed on the other guard this time

Removing the resolution and rebuilding:

    differential   7 function(s) -> 5, "agreed on every case"
    ledger         0 -> 1

**The differential went green while the defect was live**, because the sabotage
makes a function *refuse* rather than answer wrongly, and `nts check` compares
the survivors. The `example-refusals` ledger is what fails.

That is [[0281]]'s pair, third instance, and the first one predicted before it
was run rather than discovered afterwards. Which guard catches a regression is a
property of the *form* the regression takes, not of the invariant — and both
forms are reachable for the same rule.

## The thing to carry

A fixture that fails for a reason other than the one it was written for is the
same trap as one that passes for a reason other than the one it was written for,
and it is **harder to notice**, because failure looks like work to do. I spent
two builds making a correct filter more correct while the fixture was measuring
descriptor identity. What separated them was changing the decoy's shape — one
field — and the question that suggested it was "what else do these two classes
share besides the name I am testing".
