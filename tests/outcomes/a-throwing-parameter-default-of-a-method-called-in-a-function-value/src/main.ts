// The control for a-throwing-default-of-a-method-called-in-a-function-value:
// the throwing default is the parameter's own, not an element of a pattern.
// **Two paths, both pinned.** Through `attempt` it agreed all along; written
// as a direct `try` around a function with a throwing own default it escaped
// until cd9d0be4a (the default is evaluated in the caller, and the `try`'s
// walk did not reach the callee's declaration). A control pinned through one
// path is a control for a narrower claim than its name.
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
function f(x: number = thrower()): number { return x; }
let direct = "none";
try {
  f();
} catch (e) {
  direct = "caught";
}
observe("a default that throws", attempt(() => { C.method(); }));
observe("an own default, in a direct try", direct);
done();
