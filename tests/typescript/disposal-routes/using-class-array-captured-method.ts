/*---
description: A class array retains each acquired disposer and receiver
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-class, ts-class-fields, ts-arrays, ts-functions]
---*/
// Class getters expose the dispose method through a typed array; node captures it once and retains its receiver.
class Lease implements Disposable {
  replacement: boolean = false;
  readonly id: string; readonly log: string[];
  constructor(id: string, log: string[]) { this.id = id; this.log = log; }
  get [Symbol.dispose](): () => void {
    this.log.push("get:" + this.id);
    const expected = this;
    if (this.replacement) return () => this.log.push("replacement:" + this.id);
    return function(this: Lease): void {
      assert.sameValue(this, expected);
      this.log.push("close:" + this.id);
    };
  }
}
for (const ids of [[], ["one"], ["a", "b", "c"]]) {
  const log: string[] = ["before"];
  const items: Lease[] = ids.map(id => new Lease(id, log));
  {
    using first = items[0];
    using second = items[1];
    using third = items[2];
    for (const item of items) item.replacement = true;
    log.push("body:last");
  }
  log.push("after");
  const expected = ["before"];
  for (const id of ids) expected.push("get:" + id);
  expected.push("body:last");
  for (let index = ids.length - 1; index >= 0; index--) expected.push("close:" + ids[index]);
  expected.push("after");
  assert.compareArray(log, expected);
}
