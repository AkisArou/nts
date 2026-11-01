/*---
description: "Control for assignment-tuple-swap-captured-readers; A typed tuple swaps mixed bindings before retained readers observe both new values."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-tuples, ts-closures, ts-symbols, ts-arrow-functions]
---*/
// Explicit reads keep the same inputs, protocol/default/getter log and observations. Keep the same RHS tuple snapshot, assign its two explicit iterator results in order and close the cursor.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
for (let position = 0; position < inputs.length; position++) {
  const input = inputs[position], other = inputs[(position + 1) % inputs.length], log: unknown[] = [];
  let left: AssignValue = input, right: AssignValue = other;
  const readLeft = (): AssignValue => left, readRight = (): AssignValue => right;
  const pair: [AssignValue, AssignValue] = [right, left], original = pair.values.bind(pair);
  pair[Symbol.iterator] = () => { log.push("iterator"); const cursor = original(), next = cursor.next;
    cursor.next = () => { const step = next.call(cursor); log.push("next", step.done, step.value); return step; };
    cursor.return = () => { log.push("return", true, undefined); return { done: true, value: undefined }; }; return cursor;
  };
  const result = pair, cursor = pair[Symbol.iterator](); left = cursor.next().value; right = cursor.next().value;
  if (cursor.return) cursor.return();
  same(left, other); same(right, input); same(readLeft(), other); same(readRight(), input);
  same(result, pair); same(pair.length, 2); same(pair[0], other); same(pair[1], input);
  assert.compareArray(log, ["iterator", "next", false, other, "next", false, input, "return", true, undefined]);
}
