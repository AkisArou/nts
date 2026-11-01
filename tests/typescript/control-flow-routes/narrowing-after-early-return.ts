/*---
description: "Successive early returns leave a number for a member-only operation."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-unions, ts-narrowing]
---*/
// A declared five-member union returns on absence, object and string branches; node logs the sole surviving numeric arm or the exact early-return value and identity.
interface Marker { id: number; }
interface FlowRow { kind: string; n: number; s: string; ref: Marker; nil: null; absent: undefined; }
const first = { id: 7 }, second = { id: 7 };
function makeRow(kind: string, n: number, s: string, ref: Marker): FlowRow { return { kind, n, s, ref, nil: null, absent: undefined }; }
const rows: FlowRow[] = [makeRow("number", -0, "", first), makeRow("number", NaN, "tail", second), makeRow("string", 1, "", first),
  makeRow("string", 1, "tail", second), makeRow("null", 1, "", first), makeRow("undefined", 1, "", second), makeRow("object", 1, "", first), makeRow("object", 1, "", second)];
type FlowValue = number | string | Marker | null | undefined;
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function run(value: FlowValue, log: unknown[]): FlowValue {
  if (value === null) { log.push("return:null", value); return value; }
  if (value === undefined) { log.push("return:undefined", value); return value; }
  if (typeof value === "object") { log.push("return:object", value, value.id); return value; }
  if (typeof value === "string") { log.push("return:string", value, value.length); return value; }
  log.push("after-returns:number", value, value.toFixed(1)); return value;
}
function inspect(row: FlowRow): void {
  const input: FlowValue = row.kind === "number" ? row.n : row.kind === "string" ? row.s : row.kind === "object" ? row.ref : row.kind === "null" ? row.nil : row.absent;
  const log: unknown[] = [], result = run(input, log); log.push("returned", result);
  const expected: unknown[] = [];
  if (row.kind === "number") expected.push("after-returns:number", row.n, row.n.toFixed(1));
  else if (row.kind === "string") expected.push("return:string", row.s, row.s.length);
  else if (row.kind === "object") expected.push("return:object", row.ref, row.ref.id);
  else expected.push("return:" + row.kind, input);
  expected.push("returned", input); same(result, input); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row);
