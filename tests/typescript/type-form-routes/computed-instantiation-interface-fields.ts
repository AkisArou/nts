/*---
description: "Number and string instantiation expressions stored simultaneously in interface fields retain one function identity and exact results."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-instantiation-expression, ts-generics, ts-interfaces, ts-function-types, ts-objects, ts-tuples, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// echo<number> and echo<string> cross distinct Echoes fields; node keeps both equal to echo and calls the same body with each exact payload kind.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
function echo<T>(value: T): T { log.push("echo", value); return value; }
interface Echoes { number: (value: number) => number; text: (value: string) => string; }
const numberEcho = echo<number>, stringEcho = echo<string>;
const route: Echoes = { number: numberEcho, text: stringEcho };
const rows: [number, string][] = [[-0, ""], [NaN, "word"], [2.5, "0"]];
for (const row of rows) {
  log.length = 0;
  same(route.number, echo); same(route.text, echo); same(route.number, route.text);
  same(typeof route.number, "function"); same(typeof route.text, "function");
  same(route.number(row[0]), row[0]); same(route.text(row[1]), row[1]);
  exact(log, ["echo", row[0], "echo", row[1]]);
}
