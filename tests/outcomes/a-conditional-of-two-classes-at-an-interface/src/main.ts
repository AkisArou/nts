// **FIXED by `5ec3fe8a4` (escape: what an unerasure keeps, the parameter it
// unerased keeps) and kept as a guard.** A conditional whose two arms are two
// different classes, returned at an interface type, segfaulted with nothing
// refused; it now agrees with node.
//
// **The cause, read from the C diff across the fix, which is exactly two
// allocations:** `byConditional`'s `Square` and `Circle` were *frame*-allocated
// and returned through erase -> join -> unerase -> return. Escape analysis did
// not follow `Unerase`, so it saw no escape, both objects lived in the callee's
// dead frame, and `.area()` read a header out of a popped stack. With the fix
// both are `nts_object_new`, and the call dispatches through each object's own
// descriptor as it always did.
//
// **What this header said before, and why it was wrong.** It blamed the
// unerase to `Shape`'s layout, "an empty method table, because nothing is ever
// built at it, so `.area()` is a jump through a null slot". No call jumps
// through a `Shape` table: dispatch reads the object's own descriptor, and the
// emitted C has none for `Shape`. A plausible mechanism, verified only as far as
// "the unerase is there", and not the one that crashed -- the fix that cleared
// it does not touch the unerase at all. integrity's `unerase-is-built` rule
// still names the function, so its integrity.known entry is kept, re-worded.
//
// **The control is the same function written with an `if`**, which returns
// from each arm and so has no merge: no erase, no unerase, and escape analysis
// saw the return directly. It agreed with node before the fix too, which is
// consistent with the real cause as well as the old one -- the reason a
// one-difference control finds a defect without explaining it.

interface Shape {
  area(): number;
}
class Square implements Shape {
  area(): number {
    return 16;
  }
}
class Circle implements Shape {
  area(): number {
    return 3;
  }
}

/// The subject.
function byConditional(n: number): Shape {
  return n > 0 ? new Square() : new Circle();
}

/// The control, measured as agreeing: an `if` returns from each arm, so there is no
/// merge to unerase.
function byIf(n: number): Shape {
  if (n > 0) {
    return new Square();
  }
  return new Circle();
}

observe("if", String(byIf(1).area() * 100 + byIf(-1).area()));
observe("conditional", String(byConditional(1).area() * 100 + byConditional(-1).area()));
done();
