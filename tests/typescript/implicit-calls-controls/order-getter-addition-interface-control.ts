/*---
description: Control for order-getter-addition-interface; the getter and conversion hooks are invoked explicitly.
features: [ts-implicit-order, ts-accessors, ts-conversions, ts-to-primitive, ts-class, ts-class-fields, ts-interfaces]
---*/
// Control: ../implicit-calls/order-getter-addition-interface.ts; the getter and conversion hooks are invoked explicitly.
interface CellView { readonly x: string; readX(): string; }
interface NumberHook { valueOf(): number; }
const log: string[] = [];
let state = 0;
class Cell implements CellView {
  value: number;
  constructor(value: number) { this.value = value; }
  readX(): string { state++; log.push(`get:${this.value}:${state}`); return `n=${this.value}:`; }
  get x(): string { return this.readX(); }
}
class Operand implements NumberHook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): number { state += 10; log.push(`valueOf:${this.value}:${state}`); return this.value * 2; }
}
function combine(a: CellView, b: NumberHook): string { return a.readX() + b.valueOf(); }
for (const n of [-2, 0, 3]) {
  log.length = 0; state = 0;
  const result = combine(new Cell(n), new Operand(n));
  assert.sameValue(result, `n=${n}:${n * 2}`);
  assert.sameValue(state, 11);
  assert.compareArray(log, [`get:${n}:1`, `valueOf:${n}:11`]);
}
