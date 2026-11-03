/*---
description: "Const type-parameter inference carries a readonly literal tuple into an interface field without freezing its indexed slots. The control uses the explicit readonly tuple parameter and return types."
features: [ts-type-form-routes, ts-type-form-route-literal, ts-interfaces, ts-readonly, ts-tuples, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator, ts-literal-types]
---*/
// A const type parameter infers readonly literal slots before interface storage; node keeps alias writes and identity.
function carry(value: readonly [number, "tail", false]): readonly [number, "tail", false] { return value; }
interface ConstTupleHolder { value: readonly [number, "tail", false] }
for (const amount of [-0, NaN, 4.5]) {
  const inferred = carry([amount, "tail", false]);
  const route: ConstTupleHolder = { value: inferred };
  const tag: "tail" = inferred[1], flag: false = inferred[2];
  assert.sameValue(tag, "tail"); assert.sameValue(typeof tag, "string");
  assert.sameValue(flag, false); assert.sameValue(typeof flag, "boolean");
  const writable: { 0: unknown; 1: unknown } = route.value;
  writable[0] = "changed"; writable[1] = amount;
  assert.sameValue(Object.is(route.value[0], "changed"), true); assert.sameValue(typeof route.value[0], "string");
  assert.sameValue(Object.is(route.value[1], amount), true); assert.sameValue(typeof route.value[1], "number");
  assert.sameValue(route.value[2], false); assert.sameValue(typeof route.value[2], "boolean");
  assert.sameValue(route.value, inferred); assert.sameValue(route.value.length, 3);
}
