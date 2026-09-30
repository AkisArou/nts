// A `throw` raised by a callback inside `try { fn(); } finally { … }` -- a `try`
// with a `finally` and **no `catch`** -- must run the `finally` and then reach the
// caller's `catch`.
//
// **This was `outcomes/a-throw-through-a-try-with-only-a-finally`, recorded as a
// refusal on purpose, as a guard for exactly this re-land.** The first raising
// copies (`c4c2619bb`, `9d2c2b0dd`) compiled it and the throw *escaped*: neither
// the `finally` nor the caller's `catch` ran, and a refusal had become a wrong
// answer. `AsyncResource#runInAsyncScope` is this shape, so every hook dispatch in
// `runtime/node` was affected, and it was reverted (`50a643d37`). The record's
// header said what its two outcomes would mean -- *"a re-land that gets it right
// shows FIXED (a pass, loudly); one that escapes again shows CHANGED and fails"* --
// and it earned that sentence twice in one session:
//
//   1. It read CHANGED -> `aborted`, because the raising variant was skipped for a
//      `Never` return. `verify`'s own rule is `(HirType::Never, _) => true`; the
//      guard was wrong, not the mechanism, and a compile-time refusal had been
//      traded for a run-time abort.
//   2. Then CHANGED -> `wrong-answer`, the escape itself -- `nts: uncaught
//      TypeError`. `call` invokes a *parameter*, and `throwing_symbols` recorded a
//      parameter's symbol as a **resolved** callee, so `call` was in no throwing
//      set, so the caller's `try` compiled with no handler edge. That hole is older
//      than this work: on `69faf9356` the same program with no inner `try` at all
//      emits `call(…)` with no raise test and ends the program where node catches.
//
// So what makes it pass is three things at once, and none of them alone:
// `Hierarchy::raising_call_slot` so the inner call has an entry that records a
// `throw` and returns; `a_copy_can_contain` admitting an indirect callee, so `call`
// gets a raising copy; and `throwing_symbols` seeing a parameter for what it is, so
// the caller's `try` knows `call` can raise.
//
// # The arms
//
//   throughAFinally    the shape. `finally;caught;`, in that order: the `finally`
//                      runs on the way out and the handler is the caller's.
//   noThrow            the same dispatch where the callback returns normally, so
//                      the `finally` runs on the ordinary path and nothing is
//                      caught. Without it a compiler that raised unconditionally
//                      would pass the arm above.
//   aNamedCalleeInside the control that names the variable: the inner `try` calls a
//                      **named** function instead of a callback, which is the path
//                      that already worked by naming its raising copy. Same
//                      `finally`, same caller, one difference.
let log = "";

function call(fn: () => void): void {
  try {
    fn();
  } finally {
    log += "finally;";
  }
}

function named(x: number): void {
  if (x >= 0) {
    throw new TypeError("named");
  }
}

function callNamed(x: number): void {
  try {
    named(x);
  } finally {
    log += "finally;";
  }
}

export function throughAFinally(n: number): string {
  log = "";
  try {
    call((): void => {
      if (n >= 0) {
        throw new TypeError("a");
      }
    });
    log += "returned;";
  } catch {
    log += "caught;";
  }
  return log;
}

export function noThrow(n: number): string {
  log = "";
  try {
    call((): void => {
      if (n < -1000000) {
        throw new TypeError("unreachable for every input the differential feeds");
      }
    });
    log += "returned;";
  } catch {
    log += "caught;";
  }
  return log;
}

export function aNamedCalleeInside(n: number): string {
  log = "";
  try {
    callNamed(n);
    log += "returned;";
  } catch {
    log += "caught;";
  }
  return log;
}
