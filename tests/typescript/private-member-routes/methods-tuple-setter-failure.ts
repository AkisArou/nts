/*---
description: A private setter reached through tuple receivers preserves ordered logs and leaves its field unchanged when it throws.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-accessors, ts-inheritance, ts-tuples, ts-this, ts-private-fields]
---*/
// CheckedOwner instances cross typed tuple slots; node calls the setter without a getter and preserves the old value on TypeError.
const log: string[] = [];
class CheckedOwner {
  #value: number;
  constructor(value: number) { this.#value = value; }
  get #current(): number { log.push("get"); return this.#value; }
  set #current(value: number) { log.push("set:" + value); if (value < 0) throw new TypeError(); this.#value = value; }
  write(value: number): number { return this.#current = value; }
  read(): number { return this.#current; }
}
class Child extends CheckedOwner {}
for (const initial of [0, 2, 7]) {
  const entries: [CheckedOwner, number, boolean][] = [[new CheckedOwner(initial), 4, false], [new Child(initial), -1, true], [new Child(initial), -0, false]];
  for (const [owner, next, fails] of entries) {
    log.length = 0;
    if (fails) assert.throws(TypeError, () => owner.write(next)); else assert.sameValue(owner.write(next), next);
    assert.compareArray(log, ["set:" + next]);
    assert.sameValue(owner.read(), fails ? initial : next); assert.compareArray(log, ["set:" + next, "get"]);
  }
}
