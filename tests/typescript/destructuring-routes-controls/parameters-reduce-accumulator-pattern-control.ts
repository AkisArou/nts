/*---
description: "Control for parameters-reduce-accumulator-pattern; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-optional-properties, ts-accessors]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. Typed reduce parameters destructure an accumulator and each item; node orders the initial getters and count default before item extraction.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterAccumulator = { values: ParameterValue[]; count?: number };
type ParameterItem = { payload: ParameterValue };
for (const input of inputs) {
  const log: unknown[] = [], payloads: ParameterValue[] = [input, undefined, marker], stored: ParameterValue[] = [], items: ParameterItem[] = [];
  for (const payload of payloads) items.push({ get payload() { log.push("get:payload", payload); return payload; } });
  const initial: ParameterAccumulator = { get values() { log.push("get:values", stored); return stored; }, get count() { log.push("get:count", undefined); return undefined; } };
  function zero(): number { log.push("default:count", 0); return 0; }
  const append: (acc: ParameterAccumulator, item: ParameterItem, index: number) => ParameterAccumulator = (acc, item, index) => {
    const values = acc.values, countRead = acc.count, count = countRead === undefined ? zero() : countRead, payload = item.payload;
    same(values, stored); same(count, index); same(payload, payloads[index]); log.push("body", index, count, payload);
    values.push(payload); return { values, count: count + 1 };
  };
  const result = items.reduce<ParameterAccumulator>(append, initial);
  same(result.values, stored); same(result.count, 3); same(stored.length, 3); assert.compareArray(stored, payloads);
  for (let index = 0; index < stored.length; index++) same(stored[index], payloads[index]);
  const expected: unknown[] = ["get:values", stored, "get:count", undefined, "default:count", 0];
  for (let index = 0; index < payloads.length; index++) expected.push("get:payload", payloads[index], "body", index, index, payloads[index]);
  assert.compareArray(log, expected);
}
