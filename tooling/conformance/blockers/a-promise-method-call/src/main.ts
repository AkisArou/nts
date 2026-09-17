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
//
// # Measured against node, 2026-09-18, and it is not uniform
//
// The desugar was asserted here for a year on the strength of adding no runtime
// surface. That is an argument about cost; whether it is *observationally* the
// same is a separate question, and tick counts are observable through
// interleaving -- which is the stated reason `nts_promise_subscribe` refuses to
// run an already-settled reaction inline.
//
// `tooling/conformance/promise-tick-equivalence.mjs` measures both observables,
// when the reaction runs and when the resulting promise settles:
//
//     p.then(f)      vs  (async () => f(await p))()            ran@2 settled@3  same
//     p.catch(g)     vs  try { await p } catch { g() }         ran@2 settled@3  same
//     p.finally(g)   vs  try { await p } finally { g() }       settled@5 vs 3   DIFF
//
// So the desugar is right for `then` and `catch` -- on a pending source and an
// already-settled one alike, and it composes: chaining two `.then`s matches
// nesting two of the async form. It is **wrong for `finally` in that shape**,
// because the spec is `p.then(v => Promise.resolve(g()).then(() => v))`, which
// is two reaction jobs after the body rather than one, and that form does match.
//
// `finally` is 1 textual site in `runtime/node` against 51 `.then(` and 7
// `.catch(`, so the honest scope is to build the two and refuse the third by
// name rather than to desugar all three alike and be two ticks early forever.
async function make(n: number): Promise<number> {
  return n + 1;
}

function unreached(n: number): Promise<number> {
  return make(n).then((v) => v * 2);
}

export function run(n: number): Promise<number> {
  return Promise.resolve(n).then((v) => v + 1);
}
