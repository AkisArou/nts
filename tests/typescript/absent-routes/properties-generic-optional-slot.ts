/*---
description: A generic optional property distinguishes absence and explicit undefined across four instantiations.
features: [ts-absent-routes, ts-absent-route-properties, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-typeof-operator, ts-generics, ts-optional-properties, ts-destructuring, ts-spread]
---*/
// Generic p?: T storage is absent or written at number, string, boolean and nullable-object instantiations; Node keeps exact payloads and key presence.
type AbsentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect<T>(present: boolean, value: T, json: string): void {
  const source: { p?: T } = present ? { p: value } : {}, key: "p" = "p";
  const expected = present ? value : undefined, copy = { ...source }, { p } = source;
  for (const actual of [source.p, source[key], p, copy.p]) same(actual, expected);
  for (const view of [source, copy]) {
    same("p" in view, present); same(Object.hasOwn(view, key), present);
    assert.compareArray(Object.keys(view), present ? ["p"] : []);
    same(JSON.stringify(view), present ? json : '{}');
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
