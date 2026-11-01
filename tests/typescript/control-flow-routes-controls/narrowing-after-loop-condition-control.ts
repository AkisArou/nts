/*---
description: "Control for narrowing-after-loop-condition; A false while condition narrows a loop-carried union for the following read."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-route-loop]
---*/
// A number|string input takes zero or one while iterations; node exits with a number, preserves signed zero or NaN and performs the post-loop numeric operation. The control reads separate concrete fields selected by an explicit kind.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: FlowRow, row: FlowRow): void {
  const log: unknown[] = [];
  while (value.kind === "string") {
    log.push("string", value.s, value.s.length); value.kind = "number"; log.push("back", value.n);
  }
  log.push("exit:number", value.n, value.n.toFixed(1));
  const expected: unknown[] = [];
  if (row.kind === "string") expected.push("string", row.s, row.s.length, "back", row.n);
  expected.push("exit:number", row.n, row.n.toFixed(1));
  same(value.n, row.n); assert.compareArray(log, expected);
}
for (const row of rows) inspect({ kind: row.kind, n: row.n, s: row.s }, row);
