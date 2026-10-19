/*---
description: Shorthand properties and methods build an object from typed locals.
features: [ts-objects]
---*/
function make(width: number, height: number) {
  const area = width * height;
  return {
    width,
    height,
    area,
    scale(by: number) {
      return make(width * by, height * by);
    },
  };
}
const shape = make(2, 3);
assert.sameValue(shape.area, 6);
assert.sameValue(shape.scale(2).area, 24);
assert.sameValue(Object.keys(shape).join(","), "width,height,area,scale");
