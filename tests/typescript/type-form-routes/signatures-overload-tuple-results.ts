/*---
description: Accepted number and string overloads preserve boolean and bigint results that no overload declares in a typed tuple.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-unsound-overload, ts-overloads, ts-functions, ts-unions, ts-arrays, ts-tuples, ts-iteration, ts-typeof-operator]
---*/
// Overload calls populate a declared number/string tuple; node preserves false and 9n and their boolean/bigint runtime kinds.
const log: string[] = [];
function claim(value: number): number;
function claim(value: string): string;
function claim(value: number | string): number | string | boolean | bigint {
  log.push(typeof value);
  return typeof value === "number" ? false : 9n;
}
const entries: [number, string][] = [[0, ""], [-0, "seven"], [NaN, "0"]];
for (const [numeric, text] of entries) {
  log.length = 0;
  const result: [number, string] = [claim(numeric), claim(text)];
  assert.sameValue(result.length, 2); assert.sameValue(typeof result.length, "number");
  assert.sameValue<unknown>(result[0], false); assert.sameValue(typeof result[0], "boolean");
  assert.sameValue<unknown>(result[1], 9n); assert.sameValue(typeof result[1], "bigint");
  assert.compareArray(log, ["number", "string"]);
}
