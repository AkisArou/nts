/*---
description: Legacy decorator factories evaluate top to bottom and apply bottom to top; parameter decorators apply before their method's, members before the class.
features: [ts-legacy-decorators, ts-class]
---*/
const log: string[] = [];
function trace(label: string) {
  log.push(`evaluate ${label}`);
  return (..._args: unknown[]): void => {
    log.push(`apply ${label}`);
  };
}
@trace("class")
class Traced {
  @trace("method outer")
  @trace("method inner")
  run(@trace("parameter") _value: number): void {}
}
assert.compareArray(log, [
  "evaluate method outer",
  "evaluate method inner",
  "evaluate parameter",
  "apply parameter",
  "apply method inner",
  "apply method outer",
  "evaluate class",
  "apply class",
]);
assert.sameValue(typeof Traced, "function");
