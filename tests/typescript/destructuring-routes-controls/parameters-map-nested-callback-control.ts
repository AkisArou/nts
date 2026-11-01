/*---
description: "Control for parameters-map-nested-callback; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-optional-properties, ts-accessors]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. A typed map callback takes { nested: { value } }; node reads both getters once, then defaults only undefined before the callback body.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterInner = { value?: ParameterValue };
type ParameterItem = { nested: ParameterInner };
for (const input of inputs) {
  const log: unknown[] = [], payloads: ParameterValue[] = [input, undefined, null], items: ParameterItem[] = [], inners: ParameterInner[] = [];
  function fallback(): ParameterValue { log.push("default", replacement); return replacement; }
  for (const payload of payloads) {
    const inner: ParameterInner = { get value() { log.push("get:value", payload); return payload; } }; inners.push(inner);
    items.push({ get nested() { log.push("get:nested", inner); return inner; } });
  }
  const convert: (item: ParameterItem, index: number) => ParameterValue = (item, index) => {
    const nested = item.nested, valueRead = nested.value, value = valueRead === undefined ? fallback() : valueRead;
    log.push("body", index, value); return value;
  };
  const result = items.map(convert), expected: unknown[] = [];
  same(result.length, 3); same(Array.isArray(result), true);
  for (let index = 0; index < payloads.length; index++) {
    const payload = payloads[index], wanted = payload === undefined ? replacement : payload; same(result[index], wanted);
    expected.push("get:nested", inners[index], "get:value", payload); if (payload === undefined) expected.push("default", replacement);
    expected.push("body", index, wanted);
  }
  assert.compareArray(log, expected);
}
