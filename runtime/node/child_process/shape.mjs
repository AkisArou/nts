// The public object `node:child_process` publishes, from what `src/main.ts`
// exports.
//
// Node publishes nine names: `ChildProcess`, `_forkChild`, `exec`, `execFile`,
// `execFileSync`, `execSync`, `fork`, `spawn` and `spawnSync`. Eight are here --
// every one but `_forkChild`, which only node's own bootstrap calls.
//
// `_forkChild` is **not stubbed**, deliberately. A name answering true to `in`
// against a function that cannot work sends a feature-detecting program down a
// branch with no way back, and a test that checks for the name before using it
// would report a failure one layer away from its cause.
export function shape(exports) {
  const cp = { ...exports };
  delete cp.default;
  delete cp.SpawnSyncOptions;
  delete cp.SpawnSyncResult;

  // `util.promisify(exec)` resolves `{ stdout, stderr }`, rejects with the error
  // carrying both on it, and hands back a promise with a `child` property. Node
  // installs that as a non-enumerable own property keyed by
  // `util.promisify.custom`, and `fs` and `timers` install theirs here for the
  // same reason: the link is a symbol-keyed property on a function value.
  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
  for (const name of ["exec", "execFile"]) {
    const original = cp[name];
    if (typeof original !== "function") continue;
    const promisified = function (...args) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      promise.child = original(...args, (error, stdout, stderr) => {
        if (error !== null && error !== undefined) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
      return promise;
    };
    // node's `assignFunctionName`: the wrapper answers to the original's name.
    Object.defineProperty(promisified, "name", { value: name, configurable: true });
    Object.defineProperty(original, promisifyCustom, {
      enumerable: false,
      configurable: true,
      writable: true,
      value: promisified,
    });
  }
  return cp;
}
