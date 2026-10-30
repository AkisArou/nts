/*---
description: Computed-key conversion shrinks the guarded array before the property value reads it.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-computed-keys, ts-null-undefined]
---*/
// Fact: index 3 is below the literal allocation length (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? undefined : 44; the operation result is checked separately.
function observe(change: number): { [key: string]: number | undefined } {
  const xs = [11, 22, 33, 44];
  const index = 3;
  const key = {
    toString(): string { if (change > 0) xs.length = 3; return "sample"; }
  };
  if (index < xs.length) return { [String(key)]: xs[index] };
  return { sample: -1 };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue("sample" in result, true);
  assert.sameValue(result.sample, change > 0 ? undefined : 44);
}
