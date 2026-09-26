// A throw raised by a callback inside the callee's `try { fn(); } finally { ... }`
// -- a `try` with a `finally` and **no `catch`** -- must run the `finally` and then
// reach the caller's `catch`.
//
// **Recorded as a refusal, deliberately, as a guard for a re-land.** The raising
// copies (c4c2619bb, 9d2c2b0dd) compiled this and the throw *escaped*: neither the
// `finally` nor the caller's `catch` ran, a refusal turned into a wrong answer.
// `AsyncResource#runInAsyncScope` is this shape, so every hook dispatch in
// runtime/node was affected, and the compiler lane reverted it (50a643d37). On
// main today it refuses ("through a function value, which has no raising copy to
// call"), which is what this records. So: a re-land that gets it right shows
// FIXED (a pass, loudly); one that escapes again shows CHANGED and fails --
// which a record of the wrong answer would have let through as "reproduces".
// The controls agree with node: a `catch` rethrowing beside the `finally`, a
// rethrow, a wrap-and-throw, a rethrow through `await`.
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
