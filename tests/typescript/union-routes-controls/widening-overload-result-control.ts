/*---
description: Control for widening-overload-result; write the union as an explicit member record.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-interfaces, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-overloads]
---*/
// Retain the overload calls and conditional choices, returning one explicit member record and selecting its concrete payload by kind.
type WidenPoint = { id: number };
interface ExplicitUnion { kind: string; num: number; str: string; ref: WidenPoint; }
function member(kind: string, n: number, text: string, point: WidenPoint): ExplicitUnion { return { kind, num: n, str: text, ref: point }; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: ExplicitUnion, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (value.kind === "number") { log.push("number"); same(value.num, n); }
  else if (value.kind === "string") { log.push("string"); same(value.str, text); }
  else if (value.kind === "object") { log.push("object"); same(value.ref, point); same(value.ref.id, n); }
  else throw new Test262Error("unexpected union member");
}
function choose(object: false, numeric: boolean, n: number, text: string, point: WidenPoint): ExplicitUnion;
function choose(object: true, numeric: boolean, n: number, text: string, point: WidenPoint): ExplicitUnion;
function choose(object: boolean, numeric: boolean, n: number, text: string, point: WidenPoint): ExplicitUnion { return member(numeric ? "number" : object ? "object" : "string", n, text, point); }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const log: string[] = [];
  for (const numeric of [true, false]) {
    const first: ExplicitUnion = choose(false, numeric, n, text, point);
    const second: ExplicitUnion = choose(true, numeric, n, text, point);
    observe(first, n, text, point, log); observe(second, n, text, point, log);
  }
  assert.compareArray(log, ["number", "number", "string", "object"]);
}
