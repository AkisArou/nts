/*---
description: Static fields run once when the class is defined; instance fields run on each construction, before the constructor body.
features: [ts-class, ts-class-fields, ts-static]
---*/
const log: string[] = [];
function note(entry: string): number {
  log.push(entry);
  return log.length;
}
class Ordered {
  a = note("a");
  static s = note("s");
  b = note("b");
  constructor() {
    note("ctor");
  }
}
note("defined");
new Ordered();
new Ordered();
assert.sameValue(log.join(","), "s,defined,a,b,ctor,a,b,ctor");
