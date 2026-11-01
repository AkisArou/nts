/*---
description: "Control for narrowing-typeof-closure-reload; A typed reader observes a primitive member replaced by a closure call."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-closures]
---*/
// A number|string local is guarded, replaced through a closure, then reloaded through its declared union return; node logs and returns the current primitive and member-only operation. The control reads separate concrete fields selected by an explicit kind.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function inspect(value: FlowRow, row: FlowRow): void {
  const log: unknown[] = [];
  function read(): FlowRow { log.push("read"); return value; }
  function change(): void { value.kind = row.kind === "number" ? "string" : "number"; log.push("write", value.kind === "number" ? value.n : value.s); }
  let after: FlowRow;
  if (value.kind === "number") {
    log.push("before:number", value.n, value.n.toFixed(1));
    change(); after = read();
    if (after.kind === "number") log.push("after:number", after.n, after.n.toFixed(1));
    else log.push("after:string", after.s, after.s.length);
  } else {
    log.push("before:string", value.s, value.s.length);
    change(); after = read();
    if (after.kind === "number") log.push("after:number", after.n, after.n.toFixed(1));
    else log.push("after:string", after.s, after.s.length);
  }
  const before = row.kind === "number";
  const expected: unknown[] = before ? ["before:number", row.n, row.n.toFixed(1)] : ["before:string", row.s, row.s.length];
  expected.push("write", before ? row.s : row.n, "read", before ? "after:string" : "after:number", before ? row.s : row.n, before ? row.s.length : row.n.toFixed(1));
  same(after.kind === "number" ? after.n : after.s, before ? row.s : row.n); assert.compareArray(log, expected);
}
for (const row of rows) inspect({ kind: row.kind, n: row.n, s: row.s }, row);
