/*---
description: A static block can call a private method declared later in the class body.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-class-fields, ts-class-static-block, ts-accessors, ts-tuples, ts-typeof-type, ts-this, ts-private-fields]
---*/
// OrderedStatic crosses constructor tuple slots; node installs a later private method before the static block, yielding the complete method/set/get log.
for (const seed of [-2, 0, 3, 9]) {
  const log: string[] = [];
  class OrderedStatic {
    static #value: number = seed;
    static get #current(): number { log.push("get"); return this.#value; }
    static set #current(value: number) { log.push("set"); this.#value = value; }
    static { this.#current = this.#double(); }
    static #double(): number { log.push("method"); return this.#value * 2; }
    static read(): number { return this.#current; }
  }
  const pair: [typeof OrderedStatic, typeof OrderedStatic] = [OrderedStatic, OrderedStatic];
  assert.compareArray(log, ["method", "set"]);
  for (const receiver of pair) assert.sameValue(receiver.read(), seed * 2);
  assert.sameValue(pair[0], pair[1]); assert.compareArray(log, ["method", "set", "get", "get"]);
}
