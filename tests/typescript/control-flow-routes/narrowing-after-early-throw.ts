/*---
description: "An early throw removes every nonnumeric member before a numeric read."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-errors, ts-null-undefined, ts-type-aliases, ts-unions, ts-narrowing]
---*/
// A five-member union either throws its exact original value or reaches a numeric operation after the guard; node logs every throw, catch and return and preserves NaN, signed zero and object identity.
interface Marker { id: number; }
interface FlowRow { kind: string; n: number; s: string; ref: Marker; nil: null; absent: undefined; }
const first = { id: 7 }, second = { id: 7 };
function makeRow(kind: string, n: number, s: string, ref: Marker): FlowRow { return { kind, n, s, ref, nil: null, absent: undefined }; }
const rows: FlowRow[] = [makeRow("number", -0, "", first), makeRow("number", NaN, "tail", second), makeRow("string", 1, "", first),
  makeRow("string", 1, "tail", second), makeRow("null", 1, "", first), makeRow("undefined", 1, "", second), makeRow("object", 1, "", first), makeRow("object", 1, "", second)];
type FlowValue = number | string | Marker | null | undefined;
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function run(value: FlowValue, log: unknown[]): number {
  if (typeof value !== "number") { log.push("throw", value); throw value; }
  log.push("after-throw:number", value, value.toFixed(1)); return value;
}
function inspect(row: FlowRow): void {
  const input: FlowValue = row.kind === "number" ? row.n : row.kind === "string" ? row.s : row.kind === "object" ? row.ref : row.kind === "null" ? row.nil : row.absent;
  const log: unknown[] = []; let result: unknown = "unreached", caught = false;
  try { result = run(input, log); log.push("returned", result); }
  catch (error: unknown) { caught = true; result = error; log.push("caught", error); }
  const expected: unknown[] = row.kind === "number" ? ["after-throw:number", row.n, row.n.toFixed(1), "returned", row.n] : ["throw", input, "caught", input];
  same(result, input); same(caught, row.kind !== "number"); assert.compareArray(log, expected);
}
for (const row of rows) inspect(row);
