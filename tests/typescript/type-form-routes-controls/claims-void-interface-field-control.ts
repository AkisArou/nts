/*---
description: A void callback field returns exact numeric values through an unknown observation without discarding the result. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-interfaces, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator]
---*/
// A void signature crosses an interface callback field into unknown; node retains the returned number and the complete call history. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
interface NumberSink { accept: (value: number) => number; }
for (const input of [-0, 0, NaN, Infinity, 7.25]) {
  const log: unknown[] = [];
  const sink: NumberSink = {
    accept(value) { log.push("call", value); return value; }
  };
  const value: unknown = sink.accept(input);
  same(value, input);
  same(Number.prototype.valueOf.call(value), input);
  log.push("observed", value);
  const expected: unknown[] = ["call", input, "observed", input];
  assert.compareArray(log, expected);
  for (let index = 0; index < log.length; index++) same(log[index], expected[index]);
}
