/*---
description: "Control for narrowing-assertion-branch-join; An assertion function narrows only its called branch before the paths rejoin."
features: [ts-control-flow-routes, ts-control-flow-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-interfaces, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-errors]
---*/
// A number|string input takes checked and bypass branches; node records assertion success or its original thrown value, the numeric-only read and the surviving join. The control reads separate concrete fields selected by an explicit kind.
interface FlowRow { kind: string; n: number; s: string; }
const rows: FlowRow[] = [{ kind: "number", n: -0, s: "" }, { kind: "string", n: NaN, s: "" },
  { kind: "number", n: NaN, s: "tail" }, { kind: "string", n: -0, s: "tail" }];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function requireNumber(value: FlowRow, log: unknown[]): void {
  if (value.kind !== "number") { log.push("assert:throw", value.s); throw value.s; }
  log.push("assert:number", value.n);
}
function run(value: FlowRow, check: boolean, log: unknown[]): unknown {
  if (check) { log.push("check", value.kind === "number" ? value.n : value.s); requireNumber(value, log); log.push("narrowed", value.n, value.n.toFixed(1)); }
  else log.push("bypass", value.kind === "number" ? value.n : value.s);
  const result: unknown = value.kind === "number" ? value.n : value.s; log.push("join", result); return result;
}
function inspect(row: FlowRow, check: boolean): void {
  const input: unknown = row.kind === "number" ? row.n : row.s, log: unknown[] = [];
  let result: unknown = "unreached", caught = false;
  try { result = run(row, check, log); log.push("returned", result); }
  catch (error: unknown) { caught = true; result = error; log.push("caught", error); }
  const expected: unknown[] = [];
  if (!check) expected.push("bypass", input, "join", input, "returned", input);
  else if (row.kind === "number") expected.push("check", input, "assert:number", row.n, "narrowed", row.n, row.n.toFixed(1), "join", row.n, "returned", row.n);
  else expected.push("check", input, "assert:throw", row.s, "caught", row.s);
  same(result, input); same(caught, check && row.kind === "string"); assert.compareArray(log, expected);
}
for (const row of rows) for (const check of [false, true]) inspect(row, check);
