/*---
description: "A false while condition narrows a loop-carried union for the following read."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-route-loop, ts-unions, ts-narrowing]
---*/
// A number|string input takes zero or one while iterations; node exits with a number, preserves signed zero or NaN and performs the post-loop numeric operation.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: number | string, row: FlowRow): void {
  const log: unknown[] = [];
  while (typeof value === "string") {
    log.push("string", value, value.length); value = row.n; log.push("back", value);
  }
  log.push("exit:number", value, value.toFixed(1));
  const expected: unknown[] = [];
  if (row.kind === "string") expected.push("string", row.s, row.s.length, "back", row.n);
  expected.push("exit:number", row.n, row.n.toFixed(1));
  same(value, row.n); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row.kind === "number" ? row.n : row.s, row);
