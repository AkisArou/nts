// expect: `then` on a promise, which has no method table here
//
// `.then` on a promise, which had no row in `typescript.md` at all until
// 2026-09-14 while `async`/`await` and `new Promise(executor)` sat green
// beside it.
//
// A promise is a **frame** here, not an object with a method table, so
// everything routed through `await` works and everything routed through the
// object refuses. That asymmetry is why this was invisible.
//
// Refuses on every receiver -- a settled promise, a constructed one, an async
// function's return, and a `Promise<T>` parameter -- and `.catch`/`.finally`
// refuse identically. **Reachability does not save it**: `unreached` below is
// called by nothing and still refuses, which is the arm that rules out
// "pruning would have removed it".
//
// Demand: 51 `.then(`, 7 `.catch(`, 1 `.finally(` in `runtime/node`, mostly
// `stream` and `fs` -- both of which build addons, so those sites refuse
// individually while the module still emits.
//
// Closing it is a desugar rather than a method table: `p.then(f)` is
// `(async () => f(await p))()`, and `await`, `try`/`catch` and `finally` over
// an `await` are all already answered.
async function make(n: number): Promise<number> {
  return n + 1;
}

function unreached(n: number): Promise<number> {
  return make(n).then((v) => v * 2);
}

export function run(n: number): Promise<number> {
  return Promise.resolve(n).then((v) => v + 1);
}
