// expect: a closure in `connect` calls `a function value`, whose own `throw` cannot be carried
//
// **A call made directly on a cast holds the program-global raising gate off.** The
// closure in `connect` calls the handler a slot keeps as `unknown`, as
// `(slot.handler as (n: number) => void)(7)`. That one closure sets
// `closures_carry` false for the whole program (`every_raising_body_can_carry`), so the
// unrelated `try` in `run`, around a call through a function value, is refused.
//
// **The control differs in one thing and compiles, agreeing with node** (`pressed
// 7;caught effect`): the same cast read into a local first,
//
//     const handler = slot.handler as (n: number) => void;
//     handler(7);
//
// So the callee's *form* decides it, not its type: a call whose callee is a local
// carries; a call whose callee is a cast expression is "a function value" that cannot.
// The two cannot be arms of one file, because the gate is a property of the whole
// program and this arm would hold it off for the other. Typing the slot's field as
// `((n: number) => void) | null`, with the call left a cast, still refuses; that is
// the second control, and it rules out the `unknown`.
//
// **Found by the React lane.** react-gtk's event controllers (`connectController`)
// dispatch exactly this way, so every native React program that links them has the
// gate off. Its scheduler's `task.callback` and its effects' `destroy`, each called
// inside a `try`, are then refused (17 roots in the stand-in counter since ac1533ca4).
// Named by 6c75aade8's instrument: "a closure in `connectController` calls `a function
// value`".
class Slot {
  handler: unknown = null;
}

const slot = new Slot();
let log = "";

function dispatch(call: () => void): void {
  call();
}

function connect(): () => void {
  return () => dispatch(() => (slot.handler as (n: number) => void)(7));
}

function run(callback: () => void): string {
  try {
    callback();
    return "ok";
  } catch (error) {
    return "caught " + (error instanceof Error ? error.message : "?");
  }
}

slot.handler = (n: number) => {
  log += "pressed " + String(n) + ";";
};
connect()();
const answer = log + run(() => {
  throw new Error("effect");
});
if (answer !== "pressed 7;caught effect") throw new Error(answer);
