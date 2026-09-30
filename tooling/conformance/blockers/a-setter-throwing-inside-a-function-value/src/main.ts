// expect: NTS1001 a call inside a `try` whose `throw` would not reach this handler: through a closure, and some closure in this program calls something whose own `throw` cannot be carried
//
// A setter's throw, reached by an assignment inside a function value that a
// `try` calls. On ac1533ca4 it escaped the handler and ended the program
// (an outcomes record); 8f18d73ba counts an accessor read or write as a call
// and refuses where the closure cannot carry the throw. Found by test262's
// dstr *-put-prop-ref-user-err.js and class/elements/private-static-
// {getter,setter}-abrupt-completition.js. It moves back to a passing example
// when an accessor has a raising copy.
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
attempt(() => { x.y = 23; });
