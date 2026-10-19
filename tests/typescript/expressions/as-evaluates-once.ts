/*---
description: An `as` assertion is erased; its operand is evaluated exactly once.
features: [ts-type-assertions]
---*/
let reads = 0;
function source(): unknown {
  reads++;
  return { size: 3 };
}
const sized = source() as { size: number };
const doubled = (source() as { size: number }).size * 2;
assert.sameValue(sized.size, 3);
assert.sameValue(doubled, 6);
assert.sameValue(reads, 2);
