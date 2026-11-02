/*---
description: "Control for extremes-empty-typed-return; Direct zero-argument max and min calls cross an interface numeric return."
features: [ts-math-routes, ts-math-route-extremes, ts-numbers, ts-arrays, ts-iteration, ts-functions, ts-interfaces, ts-unions, ts-literal-types, ts-strings, ts-typeof-operator]
---*/
// An interface method returns a direct zero-argument extremum selected by a literal union; Node returns -Infinity for max and Infinity for min.
function same(actual: number, expected: number): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, "number"); }
const choices: ("max" | "min")[] = ["max", "min", "min", "max"];
const expected: number[] = [-Infinity, Infinity, Infinity, -Infinity];
const table: number[] = [-Infinity, Infinity, Infinity, -Infinity];
interface EmptyBound { read(choice: "max" | "min", position: number, log: string[]): number }
const route: EmptyBound = { read(choice, position, log) {
  log.push(choice);
  return choice === "max" ? table[position] : table[position];
} };
for (let position = 0; position < choices.length; position++) {
  const log: string[] = [];
  const actual: number = route.read(choices[position], position, log);
  assert.compareArray(log, [choices[position]]);
  same(actual, expected[position]);
}
