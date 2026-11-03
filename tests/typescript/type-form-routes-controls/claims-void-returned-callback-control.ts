/*---
description: A returned void callback keeps its actual return values, RangeErrors and finally order. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-iteration, ts-strings, ts-symbols, ts-objects, ts-unknown, ts-typeof-operator, ts-errors]
---*/
// A void callback signature crosses a declared function return; node keeps successful results and propagates RangeError after the same finally action. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function makeCallback(value: unknown, fail: boolean, log: unknown[]): () => unknown {
  log.push("make", value);
  return () => {
    log.push("enter", value);
    try {
      if (fail) { log.push("throw"); throw new RangeError("callback"); }
      log.push("return", value);
      return value;
    } finally { log.push("finally"); }
  };
}
const values: unknown[] = [{ id: 7 }, () => 9, Symbol("kept"), false, ""];
for (const input of values) {
  for (const fail of [false, true]) {
    const log: unknown[] = [], callback = makeCallback(input, fail, log);
    same(typeof callback, "function");
    if (fail) assert.throws(RangeError, callback);
    else { const value: unknown = callback(); same(value, input); }
    const expected: unknown[] = fail
      ? ["make", input, "enter", input, "throw", "finally"]
      : ["make", input, "enter", input, "return", input, "finally"];
    assert.compareArray(log, expected);
    for (let index = 0; index < log.length; index++) same(log[index], expected[index]);
  }
}
