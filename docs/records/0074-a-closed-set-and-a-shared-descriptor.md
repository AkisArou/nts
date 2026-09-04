# 0074 — A closed set, and a descriptor two classes shared

`instanceof` was the largest remaining language gap by what real code asks for:
67 sites in the node profile, and it is what makes 0071's `catch` binding
usable. `catch (e)` is `unknown`, and `e instanceof Error` is how a handler asks
which error it caught.

## It is a comparison, not a walk

JavaScript's `instanceof` walks a prototype chain because a running program can
change one. A compiled program cannot. The classes that satisfy `x instanceof C`
are `C` and everything extending it, that set is known while lowering, and
nothing can be added after the binary is built.

So the operation carries the whole answer:

    InstanceOf { value, classes: Vec<TypeId> }

and the backends emit one `nts_is_class` call per class, or'd. Usually one.
There is no chain, no prototype, and no table to consult at run time.

One new `OpKind` cost three exhaustive matches across the compiler —
`dce`, `simplify`, `verify` — which is what an instruction set that is *closed*
buys: adding to it is a compile error everywhere it matters and nowhere it does
not.

The helper is one call rather than an inline comparison because the LLVM backend
cannot short-circuit the load without branching: the tag has to rule out the
values that have no class before the descriptor is read, and a `select` reads it
either way. One question, one spelling, both backends.

## The right-hand side is a symbol, except when it cannot be

A class is resolved through the **symbol** it declares, not its name — two
modules may each declare a `Point`. The provided error classes are the
exception, and they have to be: `lib.d.ts` declares `TypeError` as a *variable*
of type `TypeErrorConstructor`, so the symbol the right operand resolves to is
the constructor's and never the instance's. There is no symbol the two share.
Name is what `hir::builtin` identifies these four by everywhere else, and they
are global, so there is nothing else they could be.

`TypeError extends Error` is spelled here too. The four are not declarations in
this program, so the hierarchy has never heard of them — and `e instanceof
Error` catching a `TypeError` is most of the point.

## The bug underneath, which this file predicted

§4 already said it, in a section written when nothing could observe it:

> A `Beta` carries Alpha's descriptor and answers `"Alpha"` when asked its name.
> Nothing observable depends on that yet, because neither `instanceof` nor
> `.constructor` is implemented — but it is why neither *can* be.

Two classes of the same shape share one layout, deliberately: TypeScript is
structurally typed, the two are mutually assignable, and sharing the struct is
what makes passing one where the other is expected cost nothing. They share the
descriptor with it.

All four provided error classes hold a `message` and a `name` and nothing else.
So all four were **one layout with one descriptor** — `e instanceof TypeError`
was true of a `RangeError`, and an uncaught `TypeError` printed `RangeError`.
`hir::builtin`'s own comment claims the four exist "because they are
distinguishable at run time". They were not.

### Two wrong fixes before the right one

The first guard refused to merge any two *declared* layouts of different names.
That is the correct nominal rule and it broke `function-values` and `readonly` —
structural typing doing its job, because two interfaces of one shape have to
share a struct or a call cannot pass one where the other is declared.

The second was subtler and is the better story. An anonymous layout is named
`Type` followed by its type id, and the guard asked `name.starts_with("Type")`
to tell a generated name from a declared one. **`TypeError` starts with
`Type`.** So the one class the fix existed for read as anonymous, and the fix
did nothing at all. The predicate now checks that what follows `Type` is
digits — and the *existing* use of that heuristic, which decides whether a
declared name should replace a generated one, had the same bug and now shares
the corrected predicate.

The guard that ships is the narrow one: two differently-named *provided error
classes* do not merge, and nothing else changes. The general case — two user
classes of identical shape — is still one descriptor, is still unable to answer
`instanceof`, and is written down in §4 rather than hidden.

## What it does not close

Of the 67 sites, fifty-nine are `override get ["constructor"]()` returning a
class as a *value*, which is a different feature. `instanceof` against an
ambient `Uint8Array` is a third. What closes here is the eight-site shape that
0071 needed: asking a caught value which error it is.
