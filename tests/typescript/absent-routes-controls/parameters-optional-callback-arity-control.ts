/*---
description: Control for parameters-optional-callback-arity; make argument presence explicit.
features: [ts-absent-routes, ts-absent-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-type-aliases, ts-typeof-operator, ts-function-types, ts-closures, ts-tuples]
---*/
// The stored callback receives a required second-slot presence record; recorded arity and keys preserve fewer-argument call observations.
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
const holder: { callback: (first: AbsentArgumentValue, second: { present: boolean; value: AbsentArgumentValue }) => ArgumentSnapshot } = {
  callback: function (head: AbsentArgumentValue, second: { present: boolean; value: AbsentArgumentValue }): ArgumentSnapshot {
    calls++; same(head, first);
    const json = '{"0":' + JSON.stringify(head) + (!second.present || second.value === undefined ? '' : ',"1":' + JSON.stringify(second.value)) + '}';
    return { value: second.present ? second.value : undefined, count: second.present ? 2 : 1, present: second.present,
      own: second.present, keys: second.present ? ["0", "1"] : ["0"], json };
  }
};
for (const [value, json] of rows) for (const present of [true, false]) {
  const result = holder.callback(first, { present, value });
  same(result.value, present ? value : undefined); same(result.count, present ? 2 : 1);
  same(result.present, present); same(result.own, present);
  assert.compareArray(result.keys, present ? ["0", "1"] : ["0"]); same(result.json, present ? json : '{"0":{"id":9}}');
}
same(calls, 16);
