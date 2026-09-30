// A setter's throw, reached by a plain assignment inside a function value that
// a `try` calls, escapes the handler and ends the program ("uncaught Error:
// from the setter"); node catches it. ac1533ca4 dispatches such a call at the
// raising slot only where every closure can carry what it calls, and a method
// or accessor turns that off program-wide -- but an assignment to an accessor
// is not a call node, so the gate does not see it and the throw escapes.
// Found by test262's {expressions/assignment,statements/for-of}/dstr/
// *-put-prop-ref-user-err.js (a destructuring target reaches the setter
// the same way) and class/elements/private-static-{getter,setter}-abrupt-
// completition.js: 9 recorded fails ending in a bare uncaught Test262Error.
//
// One arm, no control in this program: the gate is per program, so a control
// arm that refuses (a method throwing) would turn the gate off for this one
// too. `attempt(() => { throw ... })` beside it is
// outcomes/a-throw-one-call-below-a-function-value's `direct` arm.
const x = {
  set y(value: number) {
    throw new Error("from the setter");
  },
};
function attempt(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    return "caught";
  }
  return "none";
}
observe("assignment to a setter", attempt(() => { x.y = 23; }));
done();
