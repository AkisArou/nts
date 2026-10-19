/*---
description: In a merged namespace, a class exported by an earlier block is constructed unqualified in a later block.
features: [ts-namespace, ts-declaration-merging, ts-class]
---*/
namespace Shapes {
  export class Square {
    constructor(readonly side: number) {}
  }
}
namespace Shapes {
  export const unit = new Square(1);
}
assert.sameValue(Shapes.unit.side, 1);
assert.sameValue(Shapes.unit instanceof Shapes.Square, true);
