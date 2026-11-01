/*---
description: "An assertion function narrows only its called branch before the paths rejoin."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-assertion-functions, ts-errors, ts-unions, ts-narrowing]
---*/
// A number|string input takes checked and bypass branches; node records assertion success or its original thrown value, the numeric-only read and the surviving join.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function requireNumber(value: number | string, log: unknown[]): asserts value is number {
  if (typeof value !== "number") { log.push("assert:throw", value); throw value; }
  log.push("assert:number", value);
}
function run(value: number | string, check: boolean, log: unknown[]): number | string {
  if (check) { log.push("check", value); requireNumber(value, log); log.push("narrowed", value, value.toFixed(1)); }
  else log.push("bypass", value);
  log.push("join", value); return value;
}
function inspect(row: FlowRow, check: boolean): void {
  const input = row.kind === "number" ? row.n : row.s, log: unknown[] = [];
  let result: unknown = "unreached", caught = false;
  try { result = run(input, check, log); log.push("returned", result); }
  catch (error: unknown) { caught = true; result = error; log.push("caught", error); }
  const expected: unknown[] = [];
  if (!check) expected.push("bypass", input, "join", input, "returned", input);
  else if (row.kind === "number") expected.push("check", input, "assert:number", row.n, "narrowed", row.n, row.n.toFixed(1), "join", row.n, "returned", row.n);
  else expected.push("check", input, "assert:throw", row.s, "caught", row.s);
  same(result, input); same(caught, check && row.kind === "string"); assert.compareArray(log, expected);
}
for (const row of rows) for (const check of [false, true]) inspect(row, check);
