/*---
description: Template interpolation invokes the declared conversion hook through a generic constrained to Hook.
features: [ts-implicit-conversion, ts-conversions, ts-class, ts-class-fields, ts-interfaces, ts-to-primitive, ts-generics, ts-generic-constraints, ts-to-string, ts-template-literals]
---*/
// Route: template interpolation through a generic constrained to Hook; node preserves every hook call, its effect and the result.
interface Hook { toString(): string; }
const log: string[] = [];
let state = 10;
class Box implements Hook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += this.value + 7; log.push(`toString:${this.value}:${state}`); return `text:${this.value}`; }
}
function convert<T extends Hook>(value: T): string { return `prefix:${value}`; }
for (const n of [-2, 0, 3]) {
  state = 10; log.length = 0;
  const value: Hook = new Box(n);
  const result = convert(value);
  assert.sameValue(result, `prefix:text:${n}`);
  assert.sameValue(state, n + 17);
  assert.compareArray(log, [`toString:${n}:${n + 17}`]);
}
