/*---
description: Plain string-hook record control for A tag getter inherited by a subclass brands objects returned through a base-class type.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-this, ts-function-types, ts-strings, ts-record]
---*/
// String hook record: Base and child instances return as TagBase; node uses the inherited tag getter with the actual returned receiver.
const hookKey = "hook:tag", log: unknown[] = [];
class TagBase {
  tag: string; keys: string[] = [hookKey];
  constructor(tag: string) { this.tag = tag; }
}
class TagChild extends TagBase { child: boolean = true; }
const hooks: Record<string, (self: TagBase) => string> = { [hookKey]: self => { log.push(self, self.tag); return self.tag; } };
function make(tag: string, child: boolean): TagBase { return child ? new TagChild(tag) : new TagBase(tag); }
function describe(target: TagBase): string {
  const tag = target.keys.includes(hookKey) ? hooks[hookKey](target) : undefined;
  return `[object ${typeof tag === "string" ? tag : "Object"}]`;
}
for (const input of ["", "Base", "\u00e9\u4e2d"]) for (const child of [false, true]) {
  log.length = 0; const target = make(input, child);
  assert.sameValue(describe(target), `[object ${input}]`);
  assert.compareArray(log, [target, input]);
  target.tag = "After";
  assert.sameValue(describe(target), "[object After]");
  assert.compareArray(log, [target, input, target, "After"]);
  assert.sameValue(target.tag, "After");
}
