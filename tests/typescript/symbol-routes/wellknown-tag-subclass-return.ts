/*---
description: A tag getter inherited by a subclass brands objects returned through a base-class type.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-accessors, ts-this, ts-strings, ts-symbols]
---*/
// Symbol.toStringTag: Base and child instances return as TagBase; node uses the inherited tag getter with the actual returned receiver.
const log: unknown[] = [];
class TagBase {
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  get [Symbol.toStringTag](): string { log.push(this, this.tag); return this.tag; }
}
class TagChild extends TagBase { child: boolean = true; }
function make(tag: string, child: boolean): TagBase { return child ? new TagChild(tag) : new TagBase(tag); }
function describe(target: TagBase): string { return Object.prototype.toString.call(target); }
for (const input of ["", "Base", "\u00e9\u4e2d"]) for (const child of [false, true]) {
  log.length = 0; const target = make(input, child);
  assert.sameValue(describe(target), `[object ${input}]`);
  assert.compareArray(log, [target, input]);
  target.tag = "After";
  assert.sameValue(describe(target), "[object After]");
  assert.compareArray(log, [target, input, target, "After"]);
  assert.sameValue(target.tag, "After");
}
