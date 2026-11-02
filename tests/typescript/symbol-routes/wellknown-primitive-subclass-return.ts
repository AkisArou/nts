/*---
description: An inherited primitive hook receives number, string and default hints after a base-class return.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-this, ts-tuples, ts-unions, ts-to-primitive, ts-conversions, ts-numbers, ts-strings, ts-symbols]
---*/
// Symbol.toPrimitive: Base and child values return as PrimitiveBase; node invokes the inherited conversion method with the actual receiver for unary plus, a template and addition.
type Hint = "number" | "string" | "default";
const log: unknown[] = [];
class PrimitiveBase {
  amount: number; label: string;
  constructor(amount: number, label: string) { this.amount = amount; this.label = label; }
  [Symbol.toPrimitive](hint: Hint): number | string {
    log.push(this, hint); return hint === "number" ? this.amount : hint === "string" ? `text:${this.label}` : `default:${this.label}`;
  }
}
class PrimitiveChild extends PrimitiveBase { child: boolean = true; }
function make(amount: number, label: string, child: boolean): PrimitiveBase { return child ? new PrimitiveChild(amount, label) : new PrimitiveBase(amount, label); }
function convert(target: PrimitiveBase): unknown[] { return [+target, `${target}`, target + "!"]; }
const inputs: [number, string][] = [[-0, ""], [NaN, "x"], [7, "\u00e9"]];
for (const [amount, label] of inputs) for (const child of [false, true]) {
  log.length = 0; const target = make(amount, label, child);
  assert.compareArray(convert(target), [amount, `text:${label}`, `default:${label}!`]);
  assert.compareArray(log, [target, "number", target, "string", target, "default"]);
  assert.sameValue(target.amount, amount); assert.sameValue(target.label, label);
}
