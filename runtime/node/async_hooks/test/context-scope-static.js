"use strict";

// `AsyncLocalStorage`, where the answer is "which store is current, and when".
//
// Node hangs the store off one async-context frame that the runtime carries
// across every scheduling boundary, so upstream a store surviving a microtask
// and surviving a timer are the same mechanism observed twice. Here the
// propagation is built on `nts_async_context_get`/`set` and a hook per boundary,
// and each boundary can be wired independently.
//
// 18 cases, 0 divergences. The scheduling ones:
//
//   the store survives into a `.then()`, a `setTimeout` and a `process.nextTick`
//
// And the scoping ones, which are where a stack discipline goes wrong:
//
//   `run` returns its callback's value, and forwards extra arguments
//   nested `run` shadows, and the outer store is restored on the way out
//   `exit` clears the store inside and restores it afterwards
//   a `run` whose callback **throws** still restores the previous store
//   `enterWith` sets without a callback; `disable` clears it
//
// The throwing case is the one a naive implementation gets wrong: a store
// restored in the normal path but not in a `finally` leaks into everything that
// runs after the exception, and no test that does not throw can see it.
//
// Every expected value read off node v24.20.0. Results are sorted before
// comparing, because three of the cases complete on their own schedules.

const assert = require("node:assert");
const { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId } =
  require("node:async_hooks");

const EXPECTED = [
  ["AsyncResource-runInAsyncScope", "ran"],
  ["AsyncResource-type", "function"],
  ["across-microtask", "micro"],
  ["across-nexttick", "tick"],
  ["across-timer", "timer"],
  ["after-exit", "a"],
  ["after-nested", "a"],
  ["disable-clears", "undefined"],
  ["enterWith-then-get", "e"],
  ["executionAsyncId-type", "number"],
  ["exit", "undefined"],
  ["nested-run", "b"],
  ["outside-store", "undefined"],
  ["run-args", "3"],
  ["run-return-value", "42"],
  ["run-returns", "s"],
  ["run-throws-restores", "undefined"],
  ["snapshot-is-fn", "function"],
  ["triggerAsyncId-type", "number"],
];

const rows = [];
const pending = [];
const record = (label, v) => rows.push([label, String(v)]);

const als = new AsyncLocalStorage();
record("outside-store", als.getStore());
record("run-returns", als.run("s", () => als.getStore()));
record("run-return-value", als.run("s", () => 42));
record("nested-run", als.run("a", () => als.run("b", () => als.getStore())));
record("after-nested", als.run("a", () => { als.run("b", () => {}); return als.getStore(); }));
record("exit", als.run("a", () => als.exit(() => String(als.getStore()))));
record("after-exit", als.run("a", () => { als.exit(() => {}); return als.getStore(); }));
record("run-throws-restores", (() => {
  try { als.run("a", () => { throw new Error("x"); }); } catch {}
  return String(als.getStore());
})());
record("enterWith-then-get", (() => { const a = new AsyncLocalStorage(); a.enterWith("e"); return a.getStore(); })());
record("disable-clears", (() => { const a = new AsyncLocalStorage(); a.enterWith("e"); a.disable(); return String(a.getStore()); })());
record("run-args", als.run("s", (x, y) => x + y, 1, 2));
record("executionAsyncId-type", typeof executionAsyncId());
record("triggerAsyncId-type", typeof triggerAsyncId());
record("AsyncResource-type", (() => { const r = new AsyncResource("T"); return r.type ? r.type : typeof r.asyncId; })());
record("AsyncResource-runInAsyncScope", (() => { const r = new AsyncResource("T"); return r.runInAsyncScope(() => "ran"); })());
record("snapshot-is-fn", typeof AsyncLocalStorage.snapshot);
// Propagation across a microtask and a timer.
pending.push(new Promise((resolve) => {
  als.run("micro", () => { Promise.resolve().then(() => { record("across-microtask", als.getStore()); resolve(); }); });
}));
pending.push(new Promise((resolve) => {
  als.run("timer", () => { setTimeout(() => { record("across-timer", als.getStore()); resolve(); }, 1); });
}));
pending.push(new Promise((resolve) => {
  als.run("tick", () => { process.nextTick(() => { record("across-nexttick", als.getStore()); resolve(); }); });
}));

Promise.all(pending).then(() => {
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
  for (let i = 0; i < EXPECTED.length; i++) {
    assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
    assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
  }
});
