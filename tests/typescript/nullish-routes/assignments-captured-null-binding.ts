/*---
description: "Nullish assignment observes a binding set to null by a closure. Route: captured let parameter"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment observes a binding set to null by a closure. Route: captured let parameter. Node prints assignments-captured-null-binding:ok.
let state: number | null = 9;
function clear(): void { state = null; }
function read(): number {
  const result = (state ??= 6);
  return result;
}
clear();
assert.sameValue(read(), 6);
assert.sameValue(state, 6);
console.log("assignments-captured-null-binding:ok");
