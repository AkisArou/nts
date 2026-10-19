/*---
description: Decorator expressions evaluate top to bottom and apply bottom to top; member decorators apply before the class's.
features: [ts-decorators, ts-class]
---*/
const log: string[] = [];
function trace(label: string) {
  log.push(`evaluate ${label}`);
  return function <T>(target: T, _context: DecoratorContext): T {
    log.push(`apply ${label}`);
    return target;
  };
}
@trace("class outer")
@trace("class inner")
class Traced {
  @trace("method outer")
  @trace("method inner")
  method(): void {}
  @trace("static")
  static helper(): void {}
}
assert.compareArray(log, [
  "evaluate class outer",
  "evaluate class inner",
  "evaluate method outer",
  "evaluate method inner",
  "evaluate static",
  "apply static",
  "apply method inner",
  "apply method outer",
  "apply class inner",
  "apply class outer",
]);
assert.sameValue(typeof Traced, "function");
