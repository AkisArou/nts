// **A conditional whose two arms are two different classes, returned at an
// interface type: SIGSEGV, with nothing refused.**
//
// The merge parameter is correctly `erased` -- two classes, two layouts -- and then
// the return unerases it to the *interface's own* layout:
//
//     b3(%5: erased):
//       %8 = unerase %5 : managed<obj#1>      <- obj#1 is `Shape`
//       ret %8
//
// `Shape`'s layout has an empty method table, because nothing is ever *built* at it,
// so `.area()` on the result is a jump through a null slot. Nothing refuses at any
// point: the unerase to a managed type is unchecked on C and LLVM.
//
// **The control is the same function written with an `if`**, which returns from each
// arm and so has no merge to unerase: it agrees with node. That is the one
// difference, and it is why this is a lowering defect rather than anything about
// interfaces being called.
//
// # Which failure a program gets depends on the program
//
// The same shape gives a **wrong answer** rather than a crash where the dispatch
// happens to land somewhere readable. With the two values put in an
// `Shape[]` and summed, nts answered 9 -- every element's `area()` returning the
// *second* class's 3 -- where node answered 22. So a census counting refusals sees
// neither face.
//
// # It is the defect the React lane reports at scale
//
// Some forty `fiber.pendingProps as SuspenseProps` sites are the same thing written
// as a cast: an erased value unerased straight to an interface layout. This is a
// six-line reduction of it, found from the other end while probing a narrowing.
//
// # What it wants
//
// Not a checked unerase on its own: the value here is a `Square` or a `Circle` and
// **never** a `Shape`-layout object, so a check would abort every time rather than
// fix it. What it wants is for the slot to stay **erased** -- the interface
// indirection stage, where a type several layouts can inhabit erases and is read per
// arm. A checked unerase is what turns this from a segfault into a sentence in the
// meantime, which is worth having on its own.

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
