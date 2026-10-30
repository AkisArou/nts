/*---
description: Template fallback conversion can invalidate a captured positive-zero fact.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-numbers, ts-conversions, ts-to-primitive, ts-objects, ts-closures, ts-template-literals]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a non-primitive toString result makes the template call valueOf; node later reads -0.
function afterConversion(n: number): number {
  let value = 0;
  const object = {
    toString(): object { return {}; },
    valueOf(): number {
      if (n > 0) value = -0;
      return 0;
    }
  };
  `${object}`;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterConversion(n), n > 0 ? -0 : 0);
}
