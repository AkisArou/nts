// Is a promise method the same thing as the `async`/`await` shape it would be
// desugared into? Asked of node, which is the oracle.
//
// `typescript.md`'s `.then`/`.catch`/`.finally` row offers two routes, and
// prefers the desugar because it adds no runtime surface. That argument is
// about cost. This instrument answers the other half: whether the desugar is
// *observationally* the same. It is not a formality -- tick counts are
// observable through interleaving, which is the stated reason
// `nts_promise_subscribe` will not run an already-settled reaction inline.
//
// Two observables per arm, because one is not enough: **when the reaction
// runs**, and **when the resulting promise settles**. A desugar can get the
// first right and the second wrong, and `finally` does exactly that.
//
// Run: node tooling/conformance/promise-tick-equivalence.mjs

// Drain to quiescence. The first version of this file omitted it and every arm
// read the *previous* arm's marker chain, which is the instrument measuring
// itself rather than its subject.
async function drain() {
  for (let i = 0; i < 64; i++) await Promise.resolve();
}

// A free-running chain of microtasks. `state.n` is how many turns have elapsed.
function counter() {
  const state = { n: 0, stop: false };
  const spin = () => {
    if (state.stop) return;
    state.n++;
    Promise.resolve().then(spin);
  };
  spin();
  return state;
}

async function arm(build) {
  await drain();
  const c = counter();
  let ranAt = -1;
  const settledAt = await build((v) => {
    ranAt = c.n;
    return v;
  }).then(
    () => c.n,
    () => c.n,
  );
  c.stop = true;
  return { ranAt, settledAt };
}

const ok = () => Promise.resolve(1);
const bad = () => Promise.reject(new Error("x"));

// Every arm must call the callback exactly once and differ from the baseline in
// one thing only. An earlier run reported a DIFF for chained `then` that was
// entirely an arm calling it twice on one side.
const GROUPS = [
  [
    "then, against the async shape",
    [
      ["p.then(f)                                  [node]", (f) => ok().then(f)],
      ["(async () => f(await p))()", (f) => (async () => f(await ok()))()],
    ],
  ],
  [
    "then on an already-settled source",
    [
      ["p.then(f)                                  [node]", (f) => { const p = ok(); return p.then(f); }],
      ["(async () => f(await p))()", (f) => { const p = ok(); return (async () => f(await p))(); }],
    ],
  ],
  [
    "then chained -- does the desugar compose",
    [
      ["p.then(f).then(v => v)                     [node]", (f) => ok().then(f).then((v) => v)],
      ["await (async () => f(await p))()", (f) => (async () => await (async () => f(await ok()))())()],
      ["const v = f(await p); return v", (f) => (async () => { const v = f(await ok()); return v; })()],
    ],
  ],
  [
    "catch, on a rejected source",
    [
      ["p.catch(g)                                 [node]", (f) => bad().catch(() => f(1))],
      ["try { return await p } catch { return g() }", (f) => (async () => { try { return await bad(); } catch { return f(1); } })()],
    ],
  ],
  [
    "finally, on a fulfilled source",
    [
      ["p.finally(g)                               [node]", (f) => ok().finally(() => f(1))],
      ["try { return await p } finally { g() }", (f) => (async () => { try { return await ok(); } finally { f(1); } })()],
      ["try { return await p } finally { await g() }", (f) => (async () => { try { return await ok(); } finally { await f(1); } })()],
      ["p.then(v => Promise.resolve(g()).then(() => v))", (f) => ok().then((v) => Promise.resolve(f(1)).then(() => v))],
    ],
  ],
  [
    "finally, on a rejected source",
    [
      ["p.finally(g)                               [node]", (f) => bad().finally(() => f(1))],
      ["try { return await p } finally { g() }", (f) => (async () => { try { return await bad(); } finally { f(1); } })()],
      ["try { return await p } finally { await g() }", (f) => (async () => { try { return await bad(); } finally { await f(1); } })()],
    ],
  ],
];

let differing = 0;
for (const [title, arms] of GROUPS) {
  const measured = [];
  for (const [name, build] of arms) measured.push([name, await arm(build)]);
  const [, base] = measured[0];
  console.log(`\n${title}`);
  for (const [name, r] of measured) {
    const same = r.ranAt === base.ranAt && r.settledAt === base.settledAt;
    if (!same) differing++;
    console.log(
      `  ${same ? "same" : "DIFF"}  ${name.padEnd(48)}` +
        ` ran@${String(r.ranAt).padStart(2)} settled@${String(r.settledAt).padStart(2)}`,
    );
  }
}

console.log(
  `\n${differing} arm(s) differ from their baseline. The expected shape, as of` +
    ` 2026-09-18: 0 for then and catch, and for finally every arm but the` +
    ` spec's own \`then(v => Promise.resolve(g()).then(() => v))\`.`,
);
