# Three places that decide one name, and only one of them had a rule

A method keyed by a symbol -- `[kStep]() {}`, and therefore
`[Symbol.iterator]() {}` -- now lowers. A *field* keyed by a symbol has worked
since fields existed, and the difference between them was never a decision.

## What was actually wrong

`[kFlag]` is not a name the program computes. The checker resolves it to
exactly one property and spells it `__@kFlag@2`: the identifier written between
the brackets, and the checker's own id for the symbol. `symbol_keyed` has said
so in a doc comment for months, because the *layout* takes its field names
straight from the checker's members and therefore got the mangled name for
free.

A method takes its name from its **declaration**, and a declaration with a
computed name node has no literal text to read. So `member_name` returned
nothing and the member was refused as "a member whose name the program
computes" -- a refusal that was standing in for a rule nobody had written.

## Three places, not two

The lesson the JVM session spent a day on is *two places that must agree should
not both compute the fact*. This is the same shape with a third site, and each
one failed differently:

1. **The declaration** decides what the function is emitted as.
2. **The hierarchy** decides what a lookup finds.
3. **The call site** decides what is looked up.

Fixing only (1) emits `Counter#__@kStep@2` and leaves every call asking for
`kStep`: a method that exists and cannot be reached, reported by nothing.
Fixing (1) and (3) produces `a method '__@kStep@2' with no declaration in the
hierarchy` -- the emitted name failing to find itself, which at least says so.

All three now go through one resolution: the description written between the
brackets, matched against the type's own property list, and *refused* where two
symbols share a description rather than resolved to whichever came first. That
last rule is `symbol_keyed`'s, restated on the method side for the same reason.

## Two wrong turns worth recording

The instance type was the hard part and both first attempts returned nothing.
A class declaration node in this snapshot carries **no symbol at all**, so
looking the type up by the class's symbol -- which is how `lower_instanceof`
finds a class -- fails here. It is `type_of(class)` that answers, because the
checker gives a class declaration's name the *instance* type; that is where
`this` takes its type from a few lines away, and the two now agree by
construction rather than by coincidence.

## The test that was asserting a belief

`a_name_the_program_computes_is_still_refused` failed, and it was right to.
It asserted that `[kTag]` -- a `unique symbol` -- was refused, and the fixture
beside it said "a name only the running program knows". Both were wrong about
the fact while being right about the hazard: `[kTag]` and `["kTag"]` are
different members, and resolving the first by the identifier's text would put
them in one slot and let one silently win.

So the refusal was deleted and the hazard is now checked directly. The fixture
declares both spellings and the test asserts they are two functions under two
names. That is a stronger check than the one it replaces, and it could not have
been written while the refusal was standing in for the rule -- the fixture had
no reason to contain `["kTag"]` at all.

A test that pins a *refusal* pins the absence of a feature. When the feature
lands, the test fails, and the failure is the test asking to be rewritten
around what it was protecting rather than around what was missing.

## What this unblocks

`[Symbol.iterator]() {}` declares and resolves. `for...of` over a user type is
still refused -- that needs the protocol's loop shape, which is the one walk
with no cursor: the call to `next()` advances the iterator and answers both
"again?" and "with what?", so the result is computed in the header and the
element is read back out of it in the body.

The blocker after that is `IteratorResult<T>`, which lib.d.ts defines as a
union of two object types whose `value` is `T` in one and `any` in the other --
so they lay out differently and the union has no representation. A hand-written
iterator with a concrete `{ value, done }` reaches the loop today; the standard
spelling does not.
