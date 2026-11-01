/*---
description: "Control for parameters-for-each-object-rest; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-function-types, ts-arrow-functions, ts-index-signatures, ts-accessors, ts-expressions, ts-record]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. A Record-shaped forEach parameter binds take as selected and gathers rest; node excludes take and copies integer and ordinary keys in order.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterItem = { [key: string]: ParameterValue; take: ParameterValue; 2: ParameterValue; tail: ParameterValue };
for (const input of inputs) {
  const log: unknown[] = [], payloads: ParameterValue[] = [input, undefined, false], items: ParameterItem[] = []; let calls = 0;
  function fallback(): ParameterValue { log.push("default", replacement); return replacement; }
  for (const payload of payloads) items.push({ get take() { log.push("get:take", payload); return payload; }, get 2() { log.push("get:2", marker); return marker; }, get tail() { log.push("get:tail", -0); return -0; } });
  const visit: (item: ParameterItem, index: number) => void = (item, index) => {
    const selectedRead = item.take, selected = selectedRead === undefined ? fallback() : selectedRead, rest: Record<string, ParameterValue> = {};
    for (const key of Object.keys(item)) if (key !== "take") rest[key] = item[key];
    const wanted = payloads[index] === undefined ? replacement : payloads[index]; same(selected, wanted); log.push("body", index, selected);
    same(typeof rest, "object"); same(Object.is(rest, items[index]), false); same("take" in rest, false);
    assert.compareArray(Object.keys(rest), ["2", "tail"]); same(rest["2"], marker); same(rest.tail, -0); calls++;
  };
  items.forEach(visit); same(calls, 3); const expected: unknown[] = [];
  for (let index = 0; index < payloads.length; index++) {
    const payload = payloads[index], wanted = payload === undefined ? replacement : payload; expected.push("get:take", payload);
    if (payload === undefined) expected.push("default", replacement);
    expected.push("get:2", marker, "get:tail", -0, "body", index, wanted);
  }
  assert.compareArray(log, expected);
}
