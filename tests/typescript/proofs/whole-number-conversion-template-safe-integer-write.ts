/*---
description: Template conversion can make a safe integer require double rounding.
features: [ts-proof-whole-number, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-template-literals, ts-to-string]
---*/
// Fact: the binding begins at MAX_SAFE_INTEGER (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the template hook increments it to 2^53; node's subsequent increment has difference 0.
function afterConversion(n: number): number {
  let value = 9007199254740991;
  const object = {
    toString(): string {
      if (n > 0) value++;
      return "ok";
    }
  };
  `${object}`;
  return (value + 1) - value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? 0 : 1);
}
