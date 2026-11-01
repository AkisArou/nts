/*---
description: Control for unknown-duplicate-key-value-kinds; construct the same value from a plain object literal.
features: [ts-json-routes, ts-json-unknown, ts-unknown, ts-narrowing, ts-functions, ts-iteration, ts-objects, ts-typeof-operator, ts-unions, ts-tuples, ts-strings, ts-numbers, ts-null-undefined]
---*/
// Only the parsed source becomes a plain literal; text, narrowing and every observation remain the same.
function check(token: string, expected: string | number | boolean | null): void {
  const text = '{"first":7,"value":"old","last":true,"value":' + token + '}';
  const value: unknown = { first: 7, value: expected, last: true };
  if (typeof value !== "object" || value === null || !("first" in value) || !("value" in value) || !("last" in value)) throw new Error("record");
  assert.sameValue(typeof value, "object");
  assert.compareArray(Object.keys(value), ["first", "value", "last"]);
  assert.sameValue(typeof value.first, "number"); assert.sameValue(Object.is(value.first, 7), true);
  assert.sameValue(typeof value.value, typeof expected); assert.sameValue(Object.is(value.value, expected), true);
  assert.sameValue(typeof value.last, "boolean"); assert.sameValue(Object.is(value.last, true), true);
}
const rows: [string, string | number | boolean | null][] = [["-0", -0], ['"final"', "final"], ["false", false], ["null", null], ["1.25", 1.25]];
for (const [token, expected] of rows) check(token, expected);
