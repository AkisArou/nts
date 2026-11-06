/*---
description: "A generic optional callback works for both number and string type arguments. Route: generic callback parameter"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A generic optional callback works for both number and string type arguments. Route: generic callback parameter. Node prints calls-generic-callback-paired:ok.
function apply<T>(fn: ((x: T) => T) | undefined, value: T): T | undefined {
  const result = fn?.(value);
  return result;
}
assert.sameValue(apply<number>(n => n + 1, 2), 3);
assert.sameValue(apply<number>(undefined, 2), undefined);
assert.sameValue(apply<string>(text => text + "!", "x"), "x!");
console.log("calls-generic-callback-paired:ok");
