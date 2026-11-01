/*---
description: "Dependent object defaults run lazily and mutate the state observed by later getter bindings."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-accessors, ts-destructuring]
---*/
// Pattern first/second/third crosses OrderView; node interleaves each getter and undefined-only default before reading the next property.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface OrderView { first: OrderValue; second: OrderValue; third: OrderValue; }
for (const input of orderInputs) {
  const log: unknown[] = [], state: OrderView = { first: input, second: undefined, third: input };
  const source: OrderView = {
    get first(): OrderValue { log.push("get.first", state.first); return state.first; },
    get second(): OrderValue { log.push("get.second", state.second); return state.second; },
    get third(): OrderValue { log.push("get.third", state.third); return state.third; }
  };
  function firstDefault(): OrderValue { state.second = orderMarker; log.push("default.first", orderFallback, "write.second", orderMarker); return orderFallback; }
  function secondDefault(value: OrderValue): OrderValue { state.third = value; log.push("default.second", value, "write.third", value); return value; }
  function thirdDefault(value: OrderValue): OrderValue { log.push("default.third", value); return value; }
  const { first = firstDefault(), second = secondDefault(first), third = thirdDefault(second) } = source;
  same(first, input === undefined ? orderFallback : input); same(second, input === undefined ? orderMarker : input); same(third, input === undefined ? orderMarker : input);
  same(state.second, input === undefined ? orderMarker : undefined); same(state.third, input);
  const expected: unknown[] = ["get.first", input];
  if (input === undefined) expected.push("default.first", orderFallback, "write.second", orderMarker, "get.second", orderMarker, "get.third", undefined, "default.third", orderMarker);
  else expected.push("get.second", undefined, "default.second", input, "write.third", input, "get.third", input);
  assert.compareArray(log, expected);
}
