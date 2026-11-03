/*---
description: Overloaded array results stored in interface fields retain boolean elements and independent identities despite number and string array claims.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-unsound-overload, ts-overloads, ts-interfaces, ts-functions, ts-unions, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// Overload results cross the numeric and textual interface fields; node stores separate arrays containing true and false with boolean elements.
const log: string[] = [];
function claim(value: number): number[];
function claim(value: string): string[];
function claim(value: number | string): (number | string | boolean)[] {
  log.push(typeof value); return [true, false];
}
interface Results { numeric: number[]; textual: string[]; }
for (const input of [0, 2, 4]) {
  log.length = 0;
  const result: Results = { numeric: claim(input), textual: claim(String(input)) };
  assert.notSameValue<unknown>(result.numeric, result.textual);
  for (const values of [result.numeric, result.textual]) {
    assert.sameValue(values.length, 2); assert.sameValue(typeof values, "object");
    assert.sameValue<unknown>(values[0], true); assert.sameValue(typeof values[0], "boolean");
    assert.sameValue<unknown>(values[1], false); assert.sameValue(typeof values[1], "boolean");
    assert.compareArray<unknown>(values, [true, false]);
  }
  assert.compareArray(log, ["number", "string"]);
}
