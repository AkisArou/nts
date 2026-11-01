/*---
description: "Control for narrowing-after-early-return; Successive early returns leave a number for a member-only operation."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined]
---*/
// A declared five-member union returns on absence, object and string branches; node logs the sole surviving numeric arm or the exact early-return value and identity. The control reads separate concrete fields selected by an explicit kind.
interface Marker { id: number; }
interface FlowRow { kind: string; n: number; s: string; ref: Marker; nil: null; absent: undefined; }
const first = { id: 7 }, second = { id: 7 };
function makeRow(kind: string, n: number, s: string, ref: Marker): FlowRow { return { kind, n, s, ref, nil: null, absent: undefined }; }
const rows: FlowRow[] = [makeRow("number", -0, "", first), makeRow("number", NaN, "tail", second), makeRow("string", 1, "", first),
  makeRow("string", 1, "tail", second), makeRow("null", 1, "", first), makeRow("undefined", 1, "", second), makeRow("object", 1, "", first), makeRow("object", 1, "", second)];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function run(value: FlowRow, log: unknown[]): unknown {
  if (value.kind === "null") { log.push("return:null", value.nil); return value.nil; }
  if (value.kind === "undefined") { log.push("return:undefined", value.absent); return value.absent; }
  if (value.kind === "object") { log.push("return:object", value.ref, value.ref.id); return value.ref; }
  if (value.kind === "string") { log.push("return:string", value.s, value.s.length); return value.s; }
  log.push("after-returns:number", value.n, value.n.toFixed(1)); return value.n;
}
function inspect(row: FlowRow): void {
  const input: unknown = row.kind === "number" ? row.n : row.kind === "string" ? row.s : row.kind === "object" ? row.ref : row.kind === "null" ? row.nil : row.absent;
  const log: unknown[] = [], result = run(row, log); log.push("returned", result);
  const expected: unknown[] = [];
  if (row.kind === "number") expected.push("after-returns:number", row.n, row.n.toFixed(1));
  else if (row.kind === "string") expected.push("return:string", row.s, row.s.length);
  else if (row.kind === "object") expected.push("return:object", row.ref, row.ref.id);
  else expected.push("return:" + row.kind, input);
  expected.push("returned", input); same(result, input); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row);
