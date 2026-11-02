/*---
description: A stored typed primitive hook selected at runtime receives each requested hint through an interface field.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-function-types, ts-this-parameter, ts-this, ts-tuples, ts-unions, ts-to-primitive, ts-conversions, ts-numbers, ts-strings, ts-symbols]
---*/
// Symbol.toPrimitive: A Holder field carries an object with a selected conversion callback; node supplies number, string and default hints and the exact object receiver.
type Hint = "number" | "string" | "default";
const log: unknown[] = [];
interface PrimitiveValue { amount: number; label: string; [Symbol.toPrimitive]: (this: PrimitiveValue, hint: Hint) => number | string; }
interface Holder { value: PrimitiveValue; }
function numeric(this: PrimitiveValue, hint: Hint): number | string {
  log.push(this, hint, "numeric"); return hint === "number" ? this.amount : hint === "string" ? `N:${this.label}` : this.amount + 1;
}
function textual(this: PrimitiveValue, hint: Hint): number | string {
  log.push(this, hint, "textual"); return hint === "number" ? this.amount * 2 : hint === "string" ? `S:${this.label}` : `D:${this.label}`;
}
function make(amount: number, label: string, wordMode: boolean): PrimitiveValue {
  return { amount, label, [Symbol.toPrimitive]: wordMode ? textual : numeric };
}
function convert(holder: Holder): unknown[] { return [Number(holder.value), String(holder.value), holder.value + "!"]; }
const inputs: [number, string][] = [[-0, ""], [NaN, "x"], [7, "\u00e9"]];
for (const [amount, label] of inputs) for (const wordMode of [false, true]) {
  log.length = 0; const holder: Holder = { value: make(amount, label, wordMode) }, mode = wordMode ? "textual" : "numeric";
  assert.compareArray(convert(holder), wordMode ? [amount * 2, `S:${label}`, `D:${label}!`] : [amount, `N:${label}`, `${amount + 1}!`]);
  assert.compareArray(log, [holder.value, "number", mode, holder.value, "string", mode, holder.value, "default", mode]);
  assert.sameValue(holder.value.amount, amount); assert.sameValue(holder.value.label, label);
}
