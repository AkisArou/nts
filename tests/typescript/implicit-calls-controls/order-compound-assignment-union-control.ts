/*---
description: Control for order-compound-assignment-union; the accessor read, object conversion and accessor write are explicit.
features: [ts-implicit-order, ts-accessors, ts-conversions, ts-to-primitive, ts-class, ts-class-fields, ts-interfaces, ts-unions]
---*/
// Control: ../implicit-calls/order-compound-assignment-union.ts; the accessor read, object conversion and accessor write are explicit.
interface CellView { text: string; stored: string; readText(): string; writeText(value: string): void; }
interface NumberHook { valueOf(): number; }
const log: string[] = [];
let state = 0;
class Cell implements CellView {
  stored: string;
  constructor(value: number) { this.stored = `seed:${value}:`; }
  readText(): string { state++; log.push(`get:${this.stored}:${state}`); return this.stored; }
  writeText(value: string): void { state += 100; this.stored = value; log.push(`set:${value}:${state}`); }
  get text(): string { return this.readText(); }
  set text(value: string) { this.writeText(value); }
}
class Operand implements NumberHook {
  value: number;
  constructor(value: number) { this.value = value; }
  valueOf(): number { state += 10; log.push(`valueOf:${this.value}:${state}`); return this.value * 2; }
}
function append(target: CellView, value: number | NumberHook): string { const result = target.readText() + (typeof value === "number" ? value : value.valueOf()); target.writeText(result); return result; }
for (const n of [-2, 0, 3]) {
  const inputs: (number | NumberHook)[] = [n * 2, new Operand(n)];
  for (const value of inputs) {
    log.length = 0; state = 0;
    const target = new Cell(n), result = append(target, value);
    const called = typeof value === "object", finalState = called ? 111 : 101;
    assert.sameValue(result, `seed:${n}:${n * 2}`); assert.sameValue(target.stored, result);
    assert.sameValue(state, finalState);
    const expected = [`get:seed:${n}::1`];
    if (called) expected.push(`valueOf:${n}:11`);
    expected.push(`set:seed:${n}:${n * 2}:${finalState}`);
    assert.compareArray(log, expected);
  }
}
