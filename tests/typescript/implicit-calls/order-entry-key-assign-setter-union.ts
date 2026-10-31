/*---
description: Object.fromEntries converts a union key before Object.assign reaches an interface setter.
features: [ts-implicit-order, ts-accessors, ts-conversions, ts-to-string, ts-class, ts-class-fields, ts-interfaces, ts-unions, ts-objects]
---*/
// Route: Object.fromEntries key conversion followed by Object.assign setter invocation; node preserves the complete hook order and state.
interface Key { toString(): string; }
interface TargetView { value: number; stored: number; writeValue(value: number): void; }
const log: string[] = [];
let state = 0;
class OrderPropertyKey implements Key {
  input: number;
  constructor(input: number) { this.input = input; }
  toString(): string { state++; log.push(`key:${this.input}:${state}`); return "value"; }
}
class Target implements TargetView {
  stored: number = -99;
  writeValue(value: number): void { state += 10; this.stored = value; log.push(`set:${value}:${state}`); }
  set value(value: number) { this.writeValue(value); }
}
function assign(target: TargetView, key: string | Key, value: number): TargetView {
  return Object.assign(target, Object.fromEntries([[key, value]]));
}
for (const n of [-2, 0, 3]) {
  const keys: (string | Key)[] = ["value", new OrderPropertyKey(n)];
  for (const key of keys) {
    log.length = 0; state = 0;
    const target = new Target(), result = assign(target, key, n);
    const called = typeof key === "object";
    assert.sameValue(result, target); assert.sameValue(target.stored, n);
    assert.sameValue(state, called ? 11 : 10);
    assert.compareArray(log, called ? [`key:${n}:1`, `set:${n}:11`] : [`set:${n}:10`]);
  }
}
