# The layout named the function, and two literals became one

```ts
const a = { which(): number { return 1 } }
const b = { which(): number { return 2 } }
a.which() * 10 + b.which()        // node: 12.  nts: 11.
```

On C, on LLVM and on the JVM. No diagnostic on any of them, on the gated
compiler, inside an ordinary function — nothing to do with module scope, nothing
to do with any feature landing that day. `b.which()` returned `1`.

## Two correct decisions, meeting

**A layout is a representation, and identical shapes share one.** That is
deliberate and stated where the merge happens: `class Alpha {}` and
`class Beta {}` print as `Alpha [1 2]`, and the JVM emitter repairs the naming
downstream by giving each type a subclass of the shared base. Sharing storage
between two types with the same fields is not an approximation; it is the same
storage.

**A member is emitted as `{owner}#{member}`, and the owner comes from the
hierarchy where there is one and from the layout where there is not.** Also
right, and load-bearing: a declared class's name is what a call site can ask for,
and an anonymous type has no name of its own to ask for.

Every anonymous object type falls through to the second, so the name it gets is
the *merged* layout's. For `a` and `b` above that is one name, `Type4#which`, and
the program has one function where the source has two. The second definition is
not reported as a duplicate — it is the same function, produced twice from two
literals the compiler has correctly decided share a representation.

A named class never reaches the fallback, which is why this only ever bit
anonymous types, and why it looks like a special case rather than what it is.

## What the coverage could not catch

`examples/a-method-on-an-object-literal` has had an arm for **two literals
declaring the same member name** since the day literal members were first
lowered. It passes, and it always would have:

```ts
const a = { v: n, twice(): number { return this.v * 2 } }
const b = { w: n, twice(): number { return this.w * 3 } }
```

`v` and `w`. Different fields, so different types, different layouts, different
functions — the merge never happens and the fallback never collides. The arm was
written for the collision it *did* catch, `__object#twice` defined twice, and a
fix for that (`Type{id}`, unique per type) reads as covering this one too.

It does not. `Type{id}` is unique per type; the failure is that two types with
one representation are asked for one *name*, and uniqueness per type is exactly
what gets lost in the merge. **The arm and the bug differ in one token**, and
the token is in the part of the fixture nobody was looking at — the field names,
chosen to make the two literals readable rather than to make them distinct.

## The fix

A name for dispatch is not a representation.

Every anonymous object type that declares an implemented member now carries its
own `hierarchy.name` — the identity the checker already gave each literal
separately — and `class_name_for` reads the hierarchy before the layout. The
layouts still merge. Sharing storage was never the bug.

The same sentence fixed the same failure in a class expression an hour earlier,
where it was found the same way: a fixture with two anonymous classes returning
*different values* from a same-named method. That is the shape of test this
needs. Two anonymous things declaring the same member and answering alike cannot
fail, and a count of passing cases cannot tell you that — `a-class-expression`
agreed with node on 264 of 319 cases while dispatching one call to the wrong
function.

## How it surfaced

Not by looking for it. The ledger listed *a method or accessor in an object
literal* as still refused; re-probing the row rather than trusting it showed the
accessor passing at either scope and the method passing inside a function, which
narrowed the row to a module-scope literal. The guard that produced *that*
refusal turned out to justify itself with a sentence that had expired — "the
methods of an object literal are not walked, so they are not lowered and not
refused" — and deleting it published this.

Three steps, and the first was re-reading a claim already written down.
