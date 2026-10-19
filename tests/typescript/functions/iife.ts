/*---
description: An immediately invoked typed function expression runs once and returns its value.
features: [ts-functions, ts-closures]
---*/
const config = ((base: number): { size: number; label: string } => {
  const size = base * 2;
  return { size, label: `size-${size}` };
})(4);
assert.sameValue(config.size, 8);
assert.sameValue(config.label, "size-8");
