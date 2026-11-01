/*---
description: "Control for narrowing-typeof-branch-merge; A conditional branch assignment joins changed and preserved primitive narrowings."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings]
---*/
// A number|string parameter may change member inside its narrowed arm; the log records each write or keep and node reads the actual member at the join. The control reads separate concrete fields selected by an explicit kind.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: FlowRow, row: FlowRow, change: boolean): void {
  const log: unknown[] = [];
  if (value.kind === "number") {
    log.push("before:number", value.n, value.n.toFixed(1));
    if (change) { value.kind = "string"; log.push("write:string", value.s); } else log.push("keep:number", value.n);
  } else {
    log.push("before:string", value.s, value.s.length);
    if (change) { value.kind = "number"; log.push("write:number", value.n); } else log.push("keep:string", value.s);
  }
  if (value.kind === "number") log.push("joined:number", value.n, value.n.toFixed(1));
  else log.push("joined:string", value.s, value.s.length);
  const before = row.kind === "number", after = change ? !before : before;
  const expected: unknown[] = before ? ["before:number", row.n, row.n.toFixed(1)] : ["before:string", row.s, row.s.length];
  expected.push((change ? "write:" : "keep:") + (after ? "number" : "string"), after ? row.n : row.s);
  expected.push(after ? "joined:number" : "joined:string", after ? row.n : row.s, after ? row.n.toFixed(1) : row.s.length);
  same(value.kind === "number" ? value.n : value.s, after ? row.n : row.s); assert.compareArray(log, expected);
}
for (const row of rows) for (const change of [false, true]) inspect({ kind: row.kind, n: row.n, s: row.s }, row, change);
