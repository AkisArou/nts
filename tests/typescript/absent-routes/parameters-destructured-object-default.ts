/*---
description: A typed destructured parameter distinguishes a missing argument from a missing or undefined property.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-default-parameters, ts-destructuring, ts-optional-properties, ts-expressions]
---*/
// Whole-object and p defaults in a typed destructured parameter run for different absences; node preserves supplied null and falsy p values.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
const replacement = { id: 99 }; let objectDefaults = 0, propertyDefaults = 0;
function empty(): { p?: AbsentArgumentValue } { objectDefaults++; return {}; }
function fallback(): AbsentArgumentValue { propertyDefaults++; return replacement; }
function inspect({ p = fallback() }: { p?: AbsentArgumentValue } = empty()): ArgumentSnapshot {
  return { value: p, count: arguments.length, present: 0 in arguments, own: Object.hasOwn(arguments, 0),
    keys: Object.keys(arguments), json: JSON.stringify(arguments) };
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
  const result = mode === 0 ? inspect() : mode === 1 ? inspect(undefined) : mode === 2 ? inspect({}) : inspect({ p: value });
  const present = mode !== 0;
  same(result.value, expected); same(result.count, present ? 1 : 0);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0"] : []); same(result.json, json);
  same(objectDefaults, mode < 2 ? 1 : 0); same(propertyDefaults, expected === replacement ? 1 : 0);
}
