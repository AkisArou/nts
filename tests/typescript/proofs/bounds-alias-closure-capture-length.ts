/*---
description: A captured alias truncates a class field's literal array.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-class, ts-class-fields, ts-null-undefined, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Arrays: the field array guards index 3 before its captured alias is written.
// A captured alias truncates a class field's literal array.
class Box { xs: number[] = [11, 22, 33, 44]; }
function read(change: number): number | undefined {
  const box = new Box();
  const alias = box.xs;
  const mutate = () => { if (change > 0) alias.length = 3; };
  const index = 3;
  if (index < box.xs.length) { mutate(); return box.xs[index]; }
  return -1;
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), change > 0 ? undefined : 44);
