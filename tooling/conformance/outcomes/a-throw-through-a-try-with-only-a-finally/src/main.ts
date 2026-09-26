// A throw raised by a callback inside the callee's `try { fn(); } finally { ... }`
// -- a `try` with a `finally` and **no `catch`** -- must run the `finally` and then
// reach the caller's `catch`. nts runs neither: the throw escapes as
// `uncaught TypeError`. The same from a method (`class Box { poke(fn) { try {
// fn(); } finally {...} } }`). The control is the same callee with a `catch` that
// rethrows beside the `finally`, and it agrees with node -- so the gap is the
// finally-only path of the raising copies landed in c4c2619bb / 9d2c2b0dd, which
// the compiler lane named as the one to look at hardest. A `catch` that rethrows,
// with or without `await`, agrees.
let log = "";
function call(fn: () => void): void {
  try {
    fn();
  } finally {
    log += "finally;";
  }
}
try {
  call(() => { throw new TypeError("a"); });
} catch (e) {
  log += "caught;";
}
observe("log", log);
done();
