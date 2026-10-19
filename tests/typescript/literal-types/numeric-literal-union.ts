/*---
description: A numeric literal union types values that are ordinary numbers in arithmetic.
features: [ts-literal-types, ts-unions]
---*/
type Die = 1 | 2 | 3 | 4 | 5 | 6;
function opposite(face: Die): Die {
  return (7 - face) as Die;
}
const faces: Die[] = [1, 2, 6];
assert.compareArray(faces.map(opposite), [6, 5, 1]);
assert.sameValue(faces.reduce((a, b) => a + b, 0), 9);
