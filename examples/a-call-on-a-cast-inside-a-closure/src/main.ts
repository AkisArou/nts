// A call made directly on a cast, inside a closure, in a program with a `try`
// around a call through a function value.
//
// A call through a function value inside a `try` dispatches at the raising slot
// only where every closure the program builds can carry what it calls -- a
// program-wide gate. A closure calling `(slot.handler as F)(7)` held it off: the
// census asked the cast expression for the callee's symbol, found none, and so
// read the call as "a function value" no raising entry could carry, where the
// same handler read into a local first was a value held in a field and carried.
// The cast changes the type, not the value, so the question is now asked of
// what is inside it. Found by the React lane -- react-gtk's event controllers
// dispatch exactly this way -- as `blockers/a-call-on-a-cast-in-a-closure-holds-
// the-raising-gate-off`, which this replaces.
//
// What each export pins:
//
//   dispatched  the handler called through the cast ran: "pressed 7;"
//   caught      the unrelated `try` around a call through a function value
//               compiles and catches: "caught effect"
//
// Transcribed from node (v24), each export called with 3:
//
//     dispatched 12    caught 16
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

export function dispatched(n: number): number {
  log = "";
  connect()();
  const length = log.length;
  log = "";
  return length + n * 0 + 3;
}

export function caught(n: number): number {
  return run(() => {
    throw new Error("effect");
  }).length + n * 0 + 3;
}
