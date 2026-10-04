// **A method value read off a local declared as a base, holding a subclass, is C
// that does not compile.** `const source: Base = new Child(); const f =
// source.step;` emits an assignment of the receiver as an `NtsObj_Child *` to an
// `NtsObj_Base *` slot, which clang rejects ("incompatible pointer types"), so
// nothing runs. node answers 21 for `viaLocal(7)`.
//
// Found while reducing `a-throwing-override-escapes-a-try-through-a-base-that-
// cannot-throw` (2026-10-04, from the compiler lane's Worker B): an arm written
// with a local instead of a parameter stopped the whole program here. Its own
// fixture, because C that does not compile erases every arm beside it.
//
// **Control, one difference:** the same local, the method called directly
// (`source.step(n)`) instead of read as a value first. It agrees -- measured
// separately with `nts check`, because C that does not compile erases every arm in
// its file.

class Base {
  step(n: number): number {
    return n * 2;
  }
}

class Child extends Base {
  override step(n: number): number {
    return n * 3;
  }
}

function viaLocal(n: number): number {
  const source: Base = new Child();
  const callback = source.step;
  return callback(n);
}

observe("a method value read off a base-typed local", String(viaLocal(7)));
done();
