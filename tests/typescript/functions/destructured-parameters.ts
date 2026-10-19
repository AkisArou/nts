/*---
description: Destructured parameters with defaults read an object and an array argument.
features: [ts-functions, ts-destructuring, ts-default-parameters]
---*/
function box({ width = 1, height = 1 }: { width?: number; height?: number } = {}, [x, y]: [number, number] = [0, 0]): string {
  return `${width}x${height}@${x},${y}`;
}
assert.sameValue(box(), "1x1@0,0");
assert.sameValue(box({ width: 3 }), "3x1@0,0");
assert.sameValue(box({ height: 2 }, [5, 6]), "1x2@5,6");
