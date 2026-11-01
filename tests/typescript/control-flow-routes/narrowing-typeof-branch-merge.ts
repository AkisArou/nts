/*---
description: "A conditional branch assignment joins changed and preserved primitive narrowings."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-unions, ts-narrowing]
---*/
// A number|string parameter may change member inside its narrowed arm; the log records each write or keep and node reads the actual member at the join.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: number | string, row: FlowRow, change: boolean): void {
  const log: unknown[] = [];
  if (typeof value === "number") {
    log.push("before:number", value, value.toFixed(1));
    if (change) { value = row.s; log.push("write:string", value); } else log.push("keep:number", value);
  } else {
    log.push("before:string", value, value.length);
    if (change) { value = row.n; log.push("write:number", value); } else log.push("keep:string", value);
  }
  if (typeof value === "number") log.push("joined:number", value, value.toFixed(1));
  else log.push("joined:string", value, value.length);
  const before = row.kind === "number", after = change ? !before : before;
  const expected: unknown[] = before ? ["before:number", row.n, row.n.toFixed(1)] : ["before:string", row.s, row.s.length];
  expected.push((change ? "write:" : "keep:") + (after ? "number" : "string"), after ? row.n : row.s);
  expected.push(after ? "joined:number" : "joined:string", after ? row.n : row.s, after ? row.n.toFixed(1) : row.s.length);
  same(value, after ? row.n : row.s); assert.compareArray(log, expected);
}
for (const row of rows) for (const change of [false, true]) inspect(row.kind === "number" ? row.n : row.s, row, change);
