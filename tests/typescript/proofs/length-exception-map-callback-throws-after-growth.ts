/*---
description: A throwing mapper leaves only the appends performed before its exception.
features: [ts-proof-length, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-closures, ts-arrow-functions]
---*/
// Fact: the target literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: a mapper throws after appending; node retains exactly the partial growth.
function lengthAfterThrowingMap(n: number): number {
  const xs = [10, 20];
  try {
    if (n > 0) {
      [1, 2, 3].map(step => {
        xs.push(step);
        if (step === n) throw new Error('stop mapping');
        return step;
      });
    }
  } catch {
  }
  return xs.length;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(lengthAfterThrowingMap(n), 2 + (n < 3 ? n : 3));
}
