# Ask what the fact is about

A generator declared as a **method** was not recognised as a generator, and the
message was true of the lowering and false of the source:

    class C { *named() { yield 1 } }           a `yield` outside a generator
    class C { *[Symbol.iterator]() { … } }     the same
    function* plain() { yield 1 }              lowers, and `for...of` walks it

Not about symbol keys, which is the first thing to assume: a plainly named
`*named()` said it too. `generator_indices` walks every node carrying the
`GENERATOR` modifier and always had methods in it. `begin_generator` simply had
one caller.

## The middle half, which is why this took two attempts

The declaration is fifteen lines. It was written, measured, and **thrown away**
the same evening, because the call site could not name what it produced.

A generator's result is its **frame**, not the `Generator<T, …>` the checker
says — that interface describes an object this compiler does not build. The
plain-call path reads the callee's declaration out of `call_targets` and looks
it up in the generator reservations. A *method* call has a receiver type and a
member name, and there was no route from those to a declaration node:
`Hierarchy` holds base, implements and declares, all keyed by `TypeId` and
`String`, and `PropertyRecord` carried a name, a type, `readonly`, `optional`,
`kind` and `own`.

So landing the declaration alone would have emitted a method nothing could call.
**That produces no event at all, in any lane, ever** — not a refusal, not a
wrong answer, not a crash, not a missing symbol, because the symbol is there.
The only observer is a reader, who sees a generator method compile and concludes
the feature works. It is a quieter failure than the `ClassCastException` that
was reverted the same night, which at least happened at run time.

## Where the declaration went, and the rule that is not a rule

`PropertyRecord::declaration`, and the JVM lane argued it against a
`(TypeId, member) -> NodeId` map beside the hierarchy. Their argument is the
thing to keep, because this tree contains **both** answers and they look
contradictory:

    declared_by      on `Field`                   which class declares this field
    ClassIdentity    beside the layout            which class is this

The first went on the record because the subject of "which class declares this"
is the field. The second went beside because a layout is a **merge of several
classes**, so on `Layout` it would have been a field that is sometimes one value
and sometimes many.

So the question is not "on the record or in a map". It is **what is the fact
about**. "Where was this member declared" is about the member, and
`PropertyRecord` *is* the member — a declaration completes it rather than
extending it. A map keyed by `(TypeId, member)` is a second structure keyed by
what the first is already keyed by, and it agrees until somebody adds a member
through one path and not the other.

The map is cheaper to add, and that is the whole of its case.

## The third half: a frame is resumed, not `next`ed

`for (const x of new C())` calls `[Symbol.iterator]()` and gets a frame back. A
frame has no `next` method — `hir::suspend` splits a generator into an entry and
a resumption, and the loop calls the resumption and reads two fields. Asking the
hierarchy for `next` answered *a method `next` with no declaration in the
hierarchy*, a true sentence about a question that should not have been asked.

`protocol_walk` hands off to `generator_walk` when the iterator's type is a
frame, and it has to do so **after** pushing the call: a generator is walked
where it was made, and the resumption's name is derived from the call that made
it.

## What it cost the other lane: nothing

The JVM lane established that before the work started rather than after. A
generator there is already a `<name>$frame` implementing `NtsResumable`, and a
frame captures its parameters as fields — so a method's `this` is one more
field, a reference one rather than a double, which frames already hold. All
three backends agree on every case in
`examples/a-generator-method`.

Knowing that in advance removed the only unknown from the decision to try again.

## Sized before it was built

    Symbol.iterator   26 sites in runtime/node
    function*         29
    yield            117
    decodeURIComponent 8      <- the control, and it gated querystring.parse

The control is the useful part: it makes "is this worth doing" answerable rather
than felt, and it was a helper implemented an hour earlier, so its payoff was
known.

`blockers/a-generator-method` keeps the four shapes that still refuse — `next`
and `return` by hand, `yield*`, and spreading one — and says why three of them
are one decision rather than three lookups: what a generator **value** is when a
program holds one rather than walks it.

## A local check weaker than the gate's

The walk handoff shipped a real panic and four of my own tests caught it — in the
**gate**, not locally. `generator_element` subtracts the frame base from a type
id, which every previous caller had already established was a frame.
`generator_element_of` asks the question of *any* object type, which is the point
of it, and an ordinary object's id is below the base.

    release   wraps to a number no reservation matches, `find` answers None,
              and the answer is right by accident
    debug     attempt to subtract with overflow

I had run `cargo test --release`. The gate runs `cargo test --workspace`, which
is a debug profile with overflow checks on. **My local check was the gate's check
with the assertions removed**, and it had been all evening.

The fix is `checked_sub`, which makes the function total rather than
preconditioned — and the precondition is the interesting part. It was never
written down anywhere, because every caller happened to satisfy it by
construction. That is the JVM lane's *a rule written for the only instance of a
category is a rule about that instance*, in a function's argument rather than in
a pass: a precondition no caller can violate is indistinguishable from no
precondition, until a caller arrives whose whole job is to violate it.
