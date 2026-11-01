/*---
description: Closures retrieved from a result-widened array reader keep identity and observe their updated shared capture.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-function-types, ts-type-aliases, ts-closures, ts-arrow-functions, ts-numbers]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
type ArrayContentsAction = (value: number) => number;
function check(n: number): void {
  let offset = n, calls = 0;
  const first: ArrayContentsAction = value => { calls++; return offset + value; };
  const second: ArrayContentsAction = value => { calls++; return offset - value; };
  const values: ArrayContentsAction[] = [];
  values.push(first, second, first);
  const reader: readonly ((value: number) => unknown)[] = values;
  offset = n + 10;
  const results: unknown[] = [];
  assert.sameValue(reader.length, 3); assert.compareArray(reader, [first, second, first]);
  for (let i = 0; i < reader.length; i++) {
    const action = reader[i]; assert.sameValue(typeof action, "function");
    const result = action(n + i); results.push(result); assert.sameValue(typeof result, "number");
    assert.sameValue(Object.hasOwn(reader, i), true); assert.sameValue(i in reader, true);
  }
  assert.compareArray(results, [2 * n + 10, 9, 2 * n + 12]); assert.sameValue(calls, 3);
}
for (const n of [-3, 0, 7]) check(n);
