/*---
description: An array-stored shorter callback hides an optional string parameter that map supplies as a numeric index.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-unsound-arity, ts-functions, ts-function-types, ts-optional-parameters, ts-unions, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// The shorter callback array carries hidden into map; node returns indices 0, 1 and 2 as numbers and preserves the visit order.
const log: string[] = [];
function hidden(value: string, index?: string): string | undefined { log.push(value); return index; }
const callbacks: ((value: string) => string | undefined)[] = [hidden];
const inputs: string[][] = [["red", "green", "blue"], ["one"], []];
for (const input of inputs) {
  log.length = 0;
  const result = input.map(callbacks[0]);
  assert.sameValue(result.length, input.length); assert.sameValue(typeof result.length, "number");
  for (let index = 0; index < result.length; index++) {
    assert.sameValue<unknown>(result[index], index); assert.sameValue(typeof result[index], "number");
  }
  assert.compareArray(log, input);
}
log.length = 0;
const missing = callbacks[0]("solo");
assert.sameValue(missing, undefined); assert.sameValue(typeof missing, "undefined");
assert.compareArray(log, ["solo"]);
