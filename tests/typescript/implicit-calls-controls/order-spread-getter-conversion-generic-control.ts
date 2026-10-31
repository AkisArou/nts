/*---
description: Control for order-spread-getter-conversion-generic; the getter and conversion hooks are invoked explicitly.
features: [ts-implicit-order, ts-accessors, ts-conversions, ts-to-string, ts-spread, ts-class, ts-class-fields, ts-interfaces, ts-generics, ts-generic-constraints, ts-objects]
---*/
// Control: ../implicit-calls/order-spread-getter-conversion-generic.ts; the getter and conversion hooks are invoked explicitly.
interface TextHook { toString(): string; }
interface Source { readonly item: TextHook; readItem(): TextHook; }
const log: string[] = [];
let state = 0;
class OrderTextValue implements TextHook {
  value: number;
  constructor(value: number) { this.value = value; }
  toString(): string { state += 10; log.push(`toString:${this.value}:${state}`); return `text:${this.value}`; }
}
function render<T extends Source>(source: T): string { return String(source.readItem().toString()); }
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  const text = new OrderTextValue(n);
  const source: Source = {
    readItem(): TextHook { state++; log.push(`get:${n}:${state}`); return text; },
    get item(): TextHook { return this.readItem(); }
  };
  const result = render(source);
  assert.sameValue(result, `text:${n}`);
  assert.sameValue(state, 11);
  assert.compareArray(log, [`get:${n}:1`, `toString:${n}:11`]);
}
