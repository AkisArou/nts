/*---
description: Control for parameters-destructured-object-default; make argument presence explicit.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator]
---*/
// Required argument, object and property flags drive the same two default effects; explicit key records describe the original call.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
const replacement = { id: 99 }; let objectDefaults = 0, propertyDefaults = 0;
function empty(): void { objectDefaults++; }
function fallback(): AbsentArgumentValue { propertyDefaults++; return replacement; }
function inspect(input: { argument: boolean; object: boolean; property: boolean; value: AbsentArgumentValue }): ArgumentSnapshot {
  if (!input.object) empty();
  const value = !input.property || input.value === undefined ? fallback() : input.value;
  const json = !input.object ? "{}" : !input.property || input.value === undefined ? '{"0":{}}' : '{"0":{"p":' + JSON.stringify(input.value) + '}}';
  return { value, count: input.argument ? 1 : 0, present: input.argument, own: input.argument, keys: input.argument ? ["0"] : [], json };
}
const point = { id: 7 };
const rows: [number, AbsentArgumentValue, AbsentArgumentValue, string][] = [
  [0, undefined, replacement, "{}"], [1, undefined, replacement, "{}"], [2, undefined, replacement, '{"0":{}}'],
  [3, undefined, replacement, '{"0":{}}'], [3, null, null, '{"0":{"p":null}}'], [3, 0, 0, '{"0":{"p":0}}'],
  [3, -0, -0, '{"0":{"p":0}}'], [3, "", "", '{"0":{"p":""}}'], [3, NaN, NaN, '{"0":{"p":null}}'],
  [3, false, false, '{"0":{"p":false}}'], [3, point, point, '{"0":{"p":{"id":7}}}']
];
for (const [mode, value, expected, json] of rows) {
  objectDefaults = 0; propertyDefaults = 0;
  const result = inspect({ argument: mode !== 0, object: mode >= 2, property: mode === 3, value });
  const present = mode !== 0;
  same(result.value, expected); same(result.count, present ? 1 : 0);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0"] : []); same(result.json, json);
  same(objectDefaults, mode < 2 ? 1 : 0); same(propertyDefaults, expected === replacement ? 1 : 0);
}
