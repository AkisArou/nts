// The control for a-throwing-default-of-a-method-called-in-a-function-value:
// the throwing default is the parameter's own, not an element of a pattern.
function thrower(): number { throw new Error("from the default"); }
class C {
  static method(x: number = thrower()): number { return x; }
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
