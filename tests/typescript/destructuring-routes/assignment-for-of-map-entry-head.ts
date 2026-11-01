/*---
description: "Map-entry loop patterns retain original values while each body replaces the map entry."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-map-set, ts-symbols, ts-tuples, ts-arrow-functions, ts-destructuring]
---*/
// A Map<string,AssignValue> supplies typed entry tuples to a loop head; node closes each entry iterator, preserves the bound value and advances the map.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
for (const seed of [0, 1, 2]) {
  const log: unknown[] = [], expected: unknown[] = ["outer.iterator"], source = new Map<string, AssignValue>();
  for (let i = 0; i < inputs.length; i++) source.set("k" + i, inputs[(i + seed) % inputs.length]);
  const original = source.entries.bind(source);
  source[Symbol.iterator] = () => { log.push("outer.iterator"); const cursor = original(), next = cursor.next;
    cursor.next = () => { const step = next.call(cursor);
      if (!step.done) { const pair = step.value, values = pair.values.bind(pair), label = pair[0];
        pair[Symbol.iterator] = () => { log.push("inner.iterator", label); const inner = values(), advance = inner.next;
          inner.next = () => { const item = advance.call(inner); log.push("inner.next", label, item.done, item.value); return item; };
          inner.return = () => { log.push("inner.return", label, true, undefined); return { done: true, value: undefined }; }; return inner; }; }
      log.push("outer.next", step.done, step.done ? undefined : step.value[0], step.done ? undefined : step.value[1]); return step; };
    cursor.return = () => { log.push("outer.return", true, undefined); return { done: true, value: undefined }; }; return cursor; };
  function fallback(): AssignValue { log.push("default", replacement); return replacement; }
  let index = 0;
  for (const [key, current = fallback()] of source) {
    const label = "k" + index, input = inputs[(index + seed) % inputs.length], wanted = input === undefined ? replacement : input;
    same(key, label); same(current, wanted); source.set(key, replacement); same(source.get(key), replacement); log.push("body", key, current);
    expected.push("outer.next", false, label, input, "inner.iterator", label, "inner.next", label, false, label, "inner.next", label, false, input);
    if (input === undefined) expected.push("default", replacement);
    expected.push("inner.return", label, true, undefined, "body", label, wanted); index++;
  }
  expected.push("outer.next", true, undefined, undefined); same(index, inputs.length); same(source.size, inputs.length); assert.compareArray(log, expected);
}
