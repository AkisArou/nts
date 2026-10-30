/*---
description: A map result retains the original length while its callback shrinks the source.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// Fact: map starts with source length 4 (docs/foundations/objects.md, Arrays).
// Route: its callback shrinks the source; node keeps result length 4, source 1.
function lengthsAfterMap(n: number): number {
  const source = [10, 20, 30, 40];
  const mapped = source.map((value, index) => {
    if (index === 0 && n > 0) source.length = 1;
    return value;
  });
  return mapped.length * 10 + source.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthsAfterMap(n), n > 0 ? 41 : 44);
}
