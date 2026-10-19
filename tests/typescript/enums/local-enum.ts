/*---
description: An enum declared in a function is a new object on every call.
features: [ts-enum]
---*/
function make() {
  enum Local { A = 1, B }
  return Local;
}
const first = make();
const second = make();
assert.sameValue(first.B, 2);
assert.sameValue(first === second, false);
