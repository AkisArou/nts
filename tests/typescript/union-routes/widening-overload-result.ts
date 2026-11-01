/*---
description: Two truthful overloads return different unions whose members remain exact after the call.
features: [ts-union-routes, ts-union-route-widening, ts-functions, ts-iteration, ts-arrays, ts-typeof-operator, ts-type-aliases, ts-unions, ts-narrowing, ts-numbers, ts-strings, ts-objects, ts-tuples, ts-overloads]
---*/
// Overloads expose number|string and number|object results from one implementation; both branch choices retain Node's payload and identity.
type WidenPoint = { id: number };
type Payload = number | string | WidenPoint;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: Payload, n: number, text: string, point: WidenPoint, log: string[]): void {
  if (typeof value === "number") { log.push("number"); same(value, n); }
  else if (typeof value === "string") { log.push("string"); same(value, text); }
  else if (typeof value === "object" && value !== null) { log.push("object"); same(value, point); same(value.id, n); }
  else throw new Test262Error("unexpected union member");
}
function choose(object: false, numeric: boolean, n: number, text: string, point: WidenPoint): number | string;
function choose(object: true, numeric: boolean, n: number, text: string, point: WidenPoint): number | WidenPoint;
function choose(object: boolean, numeric: boolean, n: number, text: string, point: WidenPoint): Payload { return numeric ? n : object ? point : text; }
const rounds: [number, string][] = [[-0, ""], [NaN, "tail"], [0, "0"]];
for (const [n, text] of rounds) {
  const point = { id: n };
  const log: string[] = [];
  for (const numeric of [true, false]) {
    const first: number | string = choose(false, numeric, n, text, point);
    const second: number | WidenPoint = choose(true, numeric, n, text, point);
    observe(first, n, text, point, log); observe(second, n, text, point, log);
  }
  assert.compareArray(log, ["number", "number", "string", "object"]);
}
