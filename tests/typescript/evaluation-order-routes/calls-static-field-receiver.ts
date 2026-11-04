/*---
description: "A static-field method call keeps its original receiver across argument-time replacement."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-static, ts-this, ts-template-literals]
---*/
// A static class field carries the receiver; node captures it before the first argument writes the field and the second argument reads that new value.
const log: string[] = [];
class Actor { label: string = "old"; value: number = 2; method(a: number, b: number): number { log.push(`call:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; } }
class Store {
  static current: Actor = new Actor(); static replacement: Actor = new Actor();
  static first(n: number): number { log.push(`first:${n}`); this.current = this.replacement; this.current.value = n; return n + 1; }
  static second(): number { log.push(`second:${this.current.label}:${this.current.value}`); return this.current.value + 2; }
  static run(n: number): number { log.push("run"); return this.current.method(this.first(n), this.second()); }
}
for (const n of [0, 4, -3]) {
  Store.current = new Actor(); Store.replacement = new Actor(); Store.replacement.label = "new"; const original = Store.current; log.length = 0; const result = Store.run(n);
  assert.compareArray(log, ["run", `first:${n}`, `second:new:${n}`, `call:old:2:${n + 1}:${n + 2}`]);
  assert.sameValue(result, 200 + (n + 1) * 10 + n + 2); assert.sameValue(Store.current, Store.replacement); assert.sameValue(original.value, 2); assert.sameValue(Store.replacement.value, n);
}
