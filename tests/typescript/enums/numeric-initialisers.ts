/*---
description: A member after an initialised one continues from it.
features: [ts-enum]
---*/
enum E { A = 3, B, C = 10, D }
assert.sameValue(E.A, 3);
assert.sameValue(E.B, 4);
assert.sameValue(E.C, 10);
assert.sameValue(E.D, 11);
