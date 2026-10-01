// **Agrees since cd9d0be4a; a guard.** Until then:
// An element default inside a destructured parameter, `{ x = thrower() } =
// {}`, of a static method called inside a function value that a `try` calls:
// its throw escapes the handler ("uncaught Error: from the default"), where
// node catches it. eb92ee8f9 gave methods raising copies; a default is filled
// where the method is called, and an element default inside a pattern is not
// covered. Found by test262's {statements,expressions}/class/dstr/
// meth-static-*-obj-ptrn-*-init-throws.js and -list-err.js (10 files, a bare
// uncaught Test262Error). The escape ends the program, so the control is its
// own fixture: a-throwing-parameter-default-of-a-method-called-in-a-function-
// value, whose default is the parameter's own, and is caught.
function thrower(): number { throw new Error("from the default"); }
class C {
  static method({ x = thrower() }: { x?: number } = {}): number { return x; }
}
function attempt(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    return "caught";
  }
  return "none";
}
observe("a default that throws", attempt(() => { C.method(); }));
done();
