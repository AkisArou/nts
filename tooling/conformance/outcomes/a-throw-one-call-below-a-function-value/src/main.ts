// A throw from a plain function called *by* a function value, inside a `try`
// around the call of that value, must be caught. A guard for the raising copy
// of a function value (the compiler lane's 6a7911652b0e, 2026-09-30): on its
// pin the direct throw is caught and the one a call deeper escapes the handler
// and ends the program ("uncaught Error: deep"), where node catches both --
// an honest refusal turned into a silent wrong answer. Recorded on main, where
// it is still refused ("through a function value, which has no raising copy
// to call"), so that landing the escape reads CHANGED, not green. Found by
// test262's statements/class/classelementname-abrupt-completion.js through
// the census's assert.throws stand-in. The `direct` arm is the control.
function f(): void { throw new Error("deep"); }
function attempt(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    return "caught";
  }
  return "none";
}
observe("direct", attempt(() => { throw new Error("here"); }));
observe("one call deeper", attempt(() => { f(); }));
done();
