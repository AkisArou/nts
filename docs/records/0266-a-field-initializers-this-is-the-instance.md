# A field initializer's `this` is the instance

    class Readable {
      count = 0;
      _read: (size: number) => void = (_size) => { this.count += 1; };
    }

    NTS1001 `this` outside a method

A sentence about the source that is false. The initializer is inside a class
body and its `this` is the object being constructed.

## The cause is where an initializer runs

A field initializer is not lowered in a constructor. It is lowered **at every
allocation site**, because that is where it runs — so `initialize_fields` is
executing inside whatever function wrote `new Readable()`, and for a free
function that is a builder with no receiver at all. The capture asked
`self.this` and got nothing.

The receiver it wanted is the object being allocated, which that same function
is already holding as a value. Saved and restored rather than set, because a
`new` can be written inside a method and the outer receiver has to come back.

Five lines. What took the day was believing the message.

## The refusal that named it was about something else

`blockers/a-method-assigned-per-instance` is node's per-instance override idiom
— `if (typeof options.read === "function") this._read = options.read` — the
extension mechanism of `Readable`, `Writable`, `Duplex` and `Transform`, and
**129 failing test files**, the second-largest item on the compiled axis. Its
refusal reads:

    `_read`, declared by `Readable` with a type that has no representation
    (a function type)

which says a function type cannot be a field. So the fixture's own "what it
would take" section proposed a representation change: a stored slot holding a
closure, decided whole-program like `arrays_can_grow`.

**A field of function type already works.** Probed before designing anything:
a class with `step: (n: number) => number`, assigned in the constructor and
called through `this.step(n)` — nothing refused, 58 of 58 agreeing with node.
The representation was never missing. What was missing was `this` in the
initializer that gives such a field its default, and an arrow written in a class
body captures `this` almost always.

So the reported cause was not the cause, and the fixture that reported it was
pointing at a redesign that was not needed. **Probing the target form rather
than the reported one** is what found it — write the program the fix would
produce and see whether *it* compiles. Three separate findings today came from
that move.

## What the fix did not clear, and the message that hid it

The corpus still refuses `this` in about 170 places, and the fix is not
incomplete — it is a different cause wearing the same words. `console` was the
case that showed it: `count = (label = "default") => { const c =
(this.#counts.get(label) ?? 0) + 1; ... }` still refused, at the `this` **inside
the `const`** rather than at the first one in the body.

The column said so and I read the line instead, twice, and built a wrong
hypothesis about `first_this` missing a traversal. The capture was recorded
correctly; the body failed anyway. What is actually happening is in 0267.

## What shipped

`examples/this-in-a-field-initializer`, 145 cases agreeing with node, with four
controls: an arrow capturing nothing (the case that already worked, which is
what says the refusal was the capture rather than the representation), `this`
read directly in an initializer with no arrow at all, a subclass whose own
initializer replaces the base's slot, and a call through a base-typed binding.

`blockers/an-arrow-class-field-using-this` becomes a guard. It had already
measured what it was worth: `console` declares `log`, `info`, `warn` and `error`
as arrow fields closing over `this`, **5 of that module's 20 own-source roots**,
its largest single item — and its own controls had already established that the
prototype-method rewrite is wrong twice over, because node's `console.log` is an
own property of the instance and survives detachment.

157 of 157 examples agree, 145 blockers as expected, gate green.
