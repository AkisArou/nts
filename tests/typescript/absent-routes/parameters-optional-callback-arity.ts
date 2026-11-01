/*---
description: A callback stored in a typed field reads an omitted optional argument without losing the required argument.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-optional-parameters, ts-function-types, ts-closures, ts-tuples, ts-expressions]
---*/
// A function-typed field is called without its optional second argument; node supplies undefined while the actual first argument retains identity.
type AbsentArgumentValue = number | string | boolean | null | undefined | { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type ArgumentSnapshot = { value: AbsentArgumentValue; count: number; present: boolean; own: boolean; keys: string[]; json: string };
const point = { id: 7 }, first = { id: 9 };
const rows: [AbsentArgumentValue, string][] = [[undefined, '{"0":{"id":9}}'], [null, '{"0":{"id":9},"1":null}'],
  [0, '{"0":{"id":9},"1":0}'], [-0, '{"0":{"id":9},"1":0}'], ["", '{"0":{"id":9},"1":""}'],
  [NaN, '{"0":{"id":9},"1":null}'], [false, '{"0":{"id":9},"1":false}'], [point, '{"0":{"id":9},"1":{"id":7}}']];
let calls = 0;
const holder: { callback: (first: AbsentArgumentValue, second?: AbsentArgumentValue) => ArgumentSnapshot } = {
  callback: function (head: AbsentArgumentValue, second?: AbsentArgumentValue): ArgumentSnapshot {
    calls++; same(head, first);
    return { value: second, count: arguments.length, present: 1 in arguments, own: Object.hasOwn(arguments, 1),
      keys: Object.keys(arguments), json: JSON.stringify(arguments) };
  }
};
for (const [value, json] of rows) for (const present of [true, false]) {
  const result = present ? holder.callback(first, value) : holder.callback(first);
  same(result.value, present ? value : undefined); same(result.count, present ? 2 : 1);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0", "1"] : ["0"]); same(result.json, present ? json : '{"0":{"id":9}}');
}
same(calls, 16);
