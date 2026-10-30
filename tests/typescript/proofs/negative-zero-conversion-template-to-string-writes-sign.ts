/*---
description: Template conversion can invalidate a captured positive-zero fact.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-template-literals, ts-to-string]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the template calls the toString writer; node retains its -0 at the later read.
function afterConversion(n: number): number {
  let value = 0;
  const object = {
    toString(): string {
      if (n > 0) value = -0;
      return "ok";
    }
  };
  `${object}`;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? -0 : 0);
}
