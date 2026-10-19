/*---
description: Object literals with an interface's properties in different orders, and with extra ones, are read by name.
features: [ts-interfaces, ts-structural-typing]
---*/
interface Size {
  width: number;
  height: number;
}
function area(size: Size): number {
  return size.width * size.height;
}
const wide = { width: 4, height: 2 };
const tall = { height: 5, width: 1 };
const labelled = { label: "box", height: 3, depth: 9, width: 3 };
const sizes: Size[] = [wide, tall, labelled];
assert.sameValue(sizes.map(area).join(","), "8,5,9");
