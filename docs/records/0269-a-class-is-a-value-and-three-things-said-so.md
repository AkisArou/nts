# A class is a value, and three things said so

    this.#IncomingMessage = opts.IncomingMessage ?? IncomingMessage;

node's documented `createServer({ IncomingMessage, ServerResponse })` option — a
caller substituting the message class. It is the single `NTS1001` in
`http.Server`'s constructor, which `createServer` waits on, which the Node lane
ranks at **274 failing test files**: the largest item on the compiled axis.

## The message covered three unlike constructs

The Node lane separated them before I started, and that saved a wrong first
move:

    WithStatic.double(3)     a static method call        lowers already
    WithStatic.limit         a static field read         refused
    ?? IncomingMessage       the bare class as a value   refused

Only the third is `http`'s. Had I begun from `WithStatic.limit` — which is a
reduction that exists, reproduces, and is by far the commonest of the three in
the corpus at about ten per module — I would have cleared a shape and found
`Server`'s constructor exactly where it was.

That the static *method call* already lowers is the useful half of the split: it
says the lowering can resolve a member through a class name when the result is
immediately consumed, and what it cannot do is produce a value for the name.
`blockers/a-static-field-read` carries that one now, with the method call as its
control so the fixture reports the field rather than the class name.

**This is the same lesson as 0264's, one level up.** There, one message had
three causes and a census ranked the text. Here a message names a *construct*,
and the constructs behind it are unlike — so a fixture that matches the text is
not necessarily a fixture for the item.

## Most of it was already built, for the classes this compiler provides

`err.constructor === TypeError` is how a program asks which error it caught, and
`runtime/node` writes it 88 times. So a token already existed for the built-in
error classes: one immortal object per class, the same one wherever the name is
written, `typeof` `"function"`, comparable — `ClosureStatic` at a type in a
reserved band.

All a user class needed was where the index comes from. A provided error's is
its position in a compile-time list; a user class's has to be decided once for
the whole program, because a builder is made fresh per function and every one of
them must produce the *same* object. That is what `Naming` is for, and
`class_tokens` is its fourth field.

The band needed splitting. `is_closure_type` decides a value's *tag*, and a class
token answers `"function"` there correctly, so it belongs among the closures.
But `has_a_closure_body` must answer no — nothing dispatches a `call` to a token
— and that question is answered by the band rather than by a flag. So the
closures' 2^19 became two halves: bodies below, tokens above.

## The merge that would have made it a silent wrong answer

A token is an **empty** layout. `Layout::same_shape` cannot tell two apart, so
`collect_layouts` would have merged `Ctor_IncomingMessage` with
`Ctor_ServerResponse` — and a program asking which class it was given would have
been told the wrong one, with nothing emitted to say so.

`nominal_name` already states the rule for exactly this, and record 0096
predicted the family. The token arm's guard just had to stop asking whether the
name was an *error's*.

`examples/a-class-stored-and-compared` controls it, and it was measured rather
than argued. With `is_constructor_name` reverted to the error-only form:

    nts  distinctTokens  405bc00000000000   (111)
    node distinctTokens  405b800000000000   (110)
    85 case(s) disagree

The other cases in that file agree under the same sabotage, because they compare
a token against *itself* and one merged token is still equal to itself. A
fixture about identity needs two identities.

## A second omission, found because the first one surfaced it

`Other` inside an arrow still refused after the arm was in. The closure-body
builder copies the program-wide naming field by field, and it was copying two of
the four.

So `written_order` was missing there too — meaning an object literal written
inside a closure took the checker's field order rather than the program's, and
`Object.keys` on it disagreed with node. **Silently**: the layout is otherwise
correct and no diagnostic is involved. Nobody was looking for that; it came out
because a different missing field made a noise.

Both sites now call one `wire_naming`, which is the durable form: a site that
copies part of a side table has the same bug for the rest of it, and says
nothing.

## What still refuses

`new this.#Message(n)` — "a computed constructor" — for a user class. Producing
the class object and constructing through one are different features; the second
needs the token to carry something that allocates and runs a constructor, which
is record 0096's closure-base dispatch with a different member.

Both refusals appear on a single probe, so this is half of a known two rather
than a cleared root revealing a new one. `blockers/class-as-value` becomes a
guard and says exactly which half it certifies — its own `new Ctor("x")` lowers
only because that class extends `Error`, and a fixture that reads as covering
more than it does has stopped being a guard.

## What it revealed, which was mine and older

Clearing this took `console` from building to not building: seven
`incompatible pointer types assigning to 'NtsObj_Console *' from
'NtsObj_GlobalConsole *'`.

A closure's layout is built by two builders and merged, and they must agree on
the captured `this`'s type. The body reads it at the class that *declares* the
arrow; the allocation side wrote whatever receiver was in hand. Those were the
same thing for as long as a closure could only be allocated inside a method,
where the receiver is the declaring class -- and record 0266 changed that this
morning, by lowering a field initializer's `this` as the object being
constructed. That is what let `console`'s arrow fields lower at all.

**So the defect landed with 0266 and appeared two commits later**, when this
change let enough of `console` lower to carry the assignment into the emitted C.
The Node lane's pin bisection named the window correctly and the commit inside
it was innocent; I reverted two innocent things before reading the C, where
`v2 = v0->this` has both types spelled out three lines apart.

## The first control for it was vacuous

A derived class inheriting a base's arrow field passed with the fix removed. The
reproducing condition is narrower: **the base must never be constructed on its
own.** While it is allocated anywhere, its own type wins the layout merge and
the defect hides. `Console` is never constructed directly, which is why it was
`console` and nothing else in twenty-two modules.

`examples/this-in-a-field-initializer` carries `OnlyBase`/`OnlyDerived` now, and
it was checked by removing the fix: the struct member becomes
`NtsObj_OnlyDerived *` and `nts check` fails with the clang error.

A control that has not been seen to fail is not a control, and this one had to
be written twice to become one.

## And HEAD did not compile for an hour

`18760619` committed eleven paths and `Field::declared_by` had reached thirteen.
`suspend.rs` and `builtin.rs` were both missed, so every checkout of `main`
failed with E0063 while the shared working tree was fine -- and three sessions
all build the tree rather than the commit, so nobody could have noticed.

`commit-mine.sh` did exactly what it promises. Naming the paths is the part a
wrapper cannot do, and a mechanical edit driven by rustc's error locations
touches files a hand-written list forgets. The check is
`git worktree add --detach ~/.cache/x HEAD` and a build: 70ms, and the only
thing that answers *does what I pushed compile* rather than *does what I have*.
It found the second file after the first had already been "fixed".

160 of 160 examples agree with node, 147 blockers as expected.
