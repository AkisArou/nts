/*---
description: Control for shapes-number-interface-forms; parse to unknown and narrow before reading.
features: [ts-json-routes, ts-json-shapes, ts-functions, ts-iteration, ts-unknown, ts-narrowing, ts-typeof-operator, ts-interfaces, ts-objects, ts-numbers, ts-strings, ts-tuples]
---*/
// Only parse, holder or return annotations change to unknown; text, runtime guards and assertions are identical.
interface JsonNumberField { number: number; }
function check(token: string, expected: number): void {
  const text = '{"number":' + token + '}';
  const value: unknown = JSON.parse(text);
  assert.sameValue(typeof value, "object");
  if (typeof value !== "object" || value === null || !("number" in value)) throw new Error("number");
  assert.compareArray(Object.keys(value), ["number"]);
  assert.sameValue(typeof value.number, "number"); assert.sameValue(Object.is(value.number, expected), true);
}
const inputs: [string, number][] = [
  ["0", 0], ["-0", -0], ["-0.0", -0], ["-0e+5", -0], ["17", 17], ["-17", -17],
  ["1.25", 1.25], ["-2.5e-3", -0.0025], ["6.02E+2", 602], ["9007199254740993", 9007199254740992],
  ["-9007199254740993", -9007199254740992], ["9007199254740995", 9007199254740996],
  ["1e400", Infinity], ["-1e-400", -0], ["5e-324", 5e-324],
];
for (const [token, expected] of inputs) check(token, expected);
