/*---
description: Control for properties-generic-optional-slot; represent presence explicitly.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-generics]
---*/
// Keep the same generic invocations but store presence, required payload and keys explicitly; use guarded reads and manual copying.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect<T>(present: boolean, value: T, json: string): void {
  const source = { present, value, keys: present ? ["p"] : [] }, key: "p" = "p";
  const expected = present ? value : undefined, copy = { present: source.present, value: source.value, keys: source.keys.slice() }, p = source.present ? source.value : undefined;
  for (const actual of [source.present ? source.value : undefined, source.keys.includes(key) ? source.value : undefined, p, copy.present ? copy.value : undefined]) same(actual, expected);
  for (const view of [source, copy]) {
    same(view.keys.includes("p"), present); same(view.keys.includes(key), present);
    assert.compareArray(view.keys, present ? ["p"] : []);
    same(view.present && view.value !== undefined ? '{"p":' + JSON.stringify(view.value) + '}' : '{}', present ? json : '{}');
  }
}
const numberRows: [number, string][] = [[-0, '{"p":0}'], [NaN, '{"p":null}'], [0, '{"p":0}']];
const stringRows: [string, string][] = [["", '{"p":""}'], ["word", '{"p":"word"}']];
const booleanRows: [boolean, string][] = [[false, '{"p":false}'], [true, '{"p":true}']];
const objectRows: [{ id: number } | undefined | null, string][] = [[{ id: 1 }, '{"p":{"id":1}}'], [{ id: 2 }, '{"p":{"id":2}}'], [undefined, '{}'], [null, '{"p":null}']];
for (const present of [false, true]) {
  for (const [value, json] of numberRows) inspect<number>(present, value, json);
  for (const [value, json] of stringRows) inspect<string>(present, value, json);
  for (const [value, json] of booleanRows) inspect<boolean>(present, value, json);
  for (const [value, json] of objectRows) inspect<{ id: number } | undefined | null>(present, value, json);
}
