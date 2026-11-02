/*---
description: Plain string-hook record control for An inherited primitive hook receives number, string and default hints after a base-class return.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-this, ts-function-types, ts-tuples, ts-unions, ts-conversions, ts-numbers, ts-strings, ts-record]
---*/
// String hook record: Base and child values return as PrimitiveBase; node invokes the inherited conversion method with the actual receiver for unary plus, a template and addition.
type Hint = "number" | "string" | "default";
const hookKey = "hook:primitive", log: unknown[] = [];
class PrimitiveBase {
  amount: number; label: string; keys: string[] = [hookKey];
  constructor(amount: number, label: string) { this.amount = amount; this.label = label; }
}
class PrimitiveChild extends PrimitiveBase { child: boolean = true; }
const hooks: Record<string, (self: PrimitiveBase, hint: Hint) => number | string> = { [hookKey]: (self, hint) => {
  log.push(self, hint); return hint === "number" ? self.amount : hint === "string" ? `text:${self.label}` : `default:${self.label}`;
} };
function make(amount: number, label: string, child: boolean): PrimitiveBase { return child ? new PrimitiveChild(amount, label) : new PrimitiveBase(amount, label); }
function invoke(target: PrimitiveBase, hint: Hint): number | string {
  if (!target.keys.includes(hookKey)) throw new TypeError("hook"); return hooks[hookKey](target, hint);
}
function convert(target: PrimitiveBase): unknown[] { return [Number(invoke(target, "number")), String(invoke(target, "string")), String(invoke(target, "default")) + "!"]; }
const inputs: [number, string][] = [[-0, ""], [NaN, "x"], [7, "\u00e9"]];
for (const [amount, label] of inputs) for (const child of [false, true]) {
  log.length = 0; const target = make(amount, label, child);
  assert.compareArray(convert(target), [amount, `text:${label}`, `default:${label}!`]);
  assert.compareArray(log, [target, "number", target, "string", target, "default"]);
  assert.sameValue(target.amount, amount); assert.sameValue(target.label, label);
}
