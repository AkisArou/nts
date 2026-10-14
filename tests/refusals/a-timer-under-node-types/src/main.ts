// expect: NTS1001 a timer whose id is not a number
//
// **Every `setTimeout` refuses when the program includes Node's types**, even
// one whose id nothing reads. With `@types/node` in `types`, the checker
// resolves `setTimeout` to Node's overload, which returns `NodeJS.Timeout`, an
// object, and the lowering refuses a timer whose id is not a number.
//
// **The control differs in one thing and compiles, agreeing with node**: the
// same program under `"types": []`, where `setTimeout` is the DOM's and returns
// a number, prints `set timer`. The two cannot share a file, since the
// difference is the tsconfig.
//
// **Found by the React lane.** runtime/react/tsconfig.native.json asks for
// Node's types, and React's last resort for an error that must not throw is
// `setTimeout(() => { throw e; })` (ReactFiberErrorLogger.ts:123), so
// `logUncaughtError` is refused. Once the `this`-receiver work clears the two
// `this` sites, it is the next thing between the native demos' `main` and
// running.
function report(error: unknown): void {
  setTimeout(() => {
    throw error;
  });
}

let log = "start";
setTimeout(() => {
  if (log !== "set") throw new Error(log);
});
log = "set";
if (log === "never") report(new Error("x"));
