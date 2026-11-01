/*---
description: "Control for parameters-array-from-mapper; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-symbols, ts-computed-keys]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. An Array.from mapper has a typed { value, label } parameter; node completes each next/default/body sequence before requesting another item.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterItem = { value: ParameterValue; label: number };
for (const input of inputs) {
  const log: unknown[] = [], items: ParameterItem[] = [{ value: input, label: 0 }, { value: undefined, label: 1 }, { value: null, label: 2 }]; let position = 0;
  function fallback(): ParameterValue { log.push("default", replacement); return replacement; }
  const cursor: Iterator<ParameterItem, undefined, unknown> = {
    next(): IteratorResult<ParameterItem, undefined> { const step: IteratorResult<ParameterItem, undefined> = position < items.length ? { done: false, value: items[position++] } : { done: true, value: undefined }; log.push("next", arguments.length, step.done, step.value); return step; },
    return(): IteratorResult<ParameterItem, undefined> { log.push("return", arguments.length, true, undefined); return { done: true, value: undefined }; }
  };
  const source: Iterable<ParameterItem, undefined, unknown> = { [Symbol.iterator]() { log.push("iterator", arguments.length, cursor); return cursor; } };
  const convert: (item: ParameterItem, index: number) => ParameterValue = (item, index) => {
    const valueRead = item.value, value = valueRead === undefined ? fallback() : valueRead, label = item.label;
    same(label, index); log.push("body", label, index, value); return value;
  };
  const result = Array.from(source, convert), expected: unknown[] = ["iterator", 0, cursor]; same(result.length, 3);
  for (let index = 0; index < items.length; index++) {
    const payload = items[index].value, wanted = payload === undefined ? replacement : payload; same(result[index], wanted);
    expected.push("next", 0, false, items[index]); if (payload === undefined) expected.push("default", replacement);
    expected.push("body", index, index, wanted);
  }
  expected.push("next", 0, true, undefined); assert.compareArray(log, expected); same(position, 3);
}
