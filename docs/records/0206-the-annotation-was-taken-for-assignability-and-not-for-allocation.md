# 0206 — The annotation was taken for assignability and not for allocation

    interface Tagged extends Error { code?: string }
    const warning: Tagged = new Error(message);
    warning.code = code;

    NTS1001 `code`, which `Error` does not declare

One root, and it blocked the whole of `node:punycode`: `emitWarning` refused,
so `module#init` refused, so `delimiter`'s initializer was lost, so `decode` and
`encode` refused, so `mapDomain`, `toUnicode` and `toASCII` refused. Six
cascades from one construct — and the same shape as twenty-one sites in
`internal/errors.ts` that gate twenty of the profile's twenty-two modules.

TypeScript accepts the source: `code` is optional, so an `Error` is assignable
to a `Tagged`. The binding coerced to the declared type, and for two managed
types that is an **upcast** — a no-op pointer cast, which leaves the value's
type alone. So the receiver stayed an `Error`, which declares no `code`.

## The isolation was somebody else's and it was the whole diagnosis

The Node session sent four variants that differ only in how the type arrives:

    const w: Tagged = new Error(m);          refused
    function f(w: Tagged) { w.code = c }     compiles
    interface Tagged { code?: string }       compiles   (no `extends Error`)
    const w = make(m);                       compiles   (make(): Tagged)

The third rules out `Error` being special. The second rules out the annotation
being unsupported. **The fourth is the one that locates it**: it has an
annotation too, and it compiles — because there the *constructed* type is the
declared one, so the allocation was already wide enough.

Which says the repair is not at the write. It is at the allocation.

## Allocating at the declared type is sound, and only because of a fix from
## earlier the same day

A `new` on the right of a declaration now allocates the declared layout when
that widens what is being constructed. That is not a cast: `put_bases_first`
guarantees the base's fields are the prefix, so `Error`'s constructor writes
`message` and `name` at the offsets it always did and `code` is the zero any
fresh field has. Nothing else holds the object — it was allocated a line ago.

Without base-first layout being *enforced* rather than hoped for, this would
have been a silent wrong offset. Record 0199's field-index remap is what makes
it safe, and the two changes are a day apart.

## It broke `instanceof` and the example caught it

Laying the object out as `Tagged` gives it `Tagged`'s descriptor, so
`warning instanceof Error` went **false**.

The set of classes that test accepts is built by walking `hierarchy.base`, and
an interface has no entry there — `base` is filled from class declarations.
There were **two walks over one relation**: `Hierarchy::descends_from`, which
counts an implemented interface since interface dispatch landed, and a private
`FuncBuilder::descends_from` that walked `base` alone. `instanceof` asked the
narrower one.

There is one walk now.

The case that caught it is four lines long and does nothing but ask
`warning instanceof Error`. Without it in the fixture this would have shipped as
a compiler where `e instanceof Error` is false for every widened error in the
profile — and every test that catches an error and checks its class would have
started failing for a reason nothing pointed at.

## What to take

A coercion that is *correct* can still be insufficient. The upcast was right —
an `Error` really is assignable to a `Tagged` — and being right is what made it
invisible: nothing was wrong at the coercion, the wrongness was that the
allocation upstream had already decided something the annotation contradicted.

And a private helper that duplicates a shared one is a fork waiting for the
shared one to grow. `Hierarchy::descends_from` learned about interfaces and its
copy did not, and the copy is the one an unrelated feature happened to call.
Record 0201 deleted a second route to an answer for the same reason; this is the
same lesson found from the failing side rather than from the sabotage side.
