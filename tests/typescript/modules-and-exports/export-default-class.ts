/*---
description: A default-exported class keeps its local name and is constructed by it.
features: [ts-modules, ts-exports, ts-class]
flags: [module]
---*/
export default class Widget {
  constructor(readonly size: number) {}
  grow(): Widget {
    return new Widget(this.size * 2);
  }
}
const widget = new Widget(3).grow();
assert.sameValue(widget.size, 6);
assert.sameValue(Widget.name, "Widget");
