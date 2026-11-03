/*---
description: "A namespace function alias passed to a generic callback retains its original target after replacement."
features: [ts-type-form-routes, ts-type-form-route-values, ts-import-alias, ts-namespace, ts-generics, ts-function-types, ts-tuples, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// import saved = Actions.run crosses invoke<T>; node calls the saved negation function and the replacement increment function in the asserted order.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
namespace Actions {
  export let run: (value: number) => number = function(value: number): number { log.push("saved", value); return -value; };
}
import saved = Actions.run;
const original = Actions.run;
function invoke<T>(callback: (value: T) => T, value: T): T { return callback(value); }
Actions.run = function(value: number): number { log.push("new", value); return value + 1; };
const rows: [number, number, number][] = [[-0, 0, 1], [2.5, -2.5, 3.5], [NaN, NaN, NaN]];
for (const row of rows) {
  log.length = 0;
  same(invoke(saved, row[0]), row[1]); same(invoke(Actions.run, row[0]), row[2]);
  same(saved, original); same(saved === Actions.run, false); same(typeof saved, "function");
  exact(log, ["saved", row[0], "new", row[0]]);
}
