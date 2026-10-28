/*---
description: An optional numeric argument receives a string through a shorter signature (direct).
features: [ts-unsound-arity, ts-functions, ts-function-types, ts-optional-parameters, ts-typeof-operator, ts-conversions, ts-narrowing, ts-null-undefined]
---*/

// TypeScript forgets the optional numeric parameter when assigning a shorter signature.
// A wider caller then supplies a string; after excluding undefined, node still sees the string.
let visits = 0;
function narrow(first: number, value?: number): void {
  if (value === undefined) throw new Test262Error("missing argument");
  visits++;
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
}
const shorter: (first: number) => void = narrow;
const wider: (first: number, value: string) => void = shorter;
wider(1, "7");
assert.sameValue(visits, 1);
