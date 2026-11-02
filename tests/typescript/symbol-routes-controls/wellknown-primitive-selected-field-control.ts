/*---
description: Plain string-hook record control for A stored typed primitive hook selected at runtime receives each requested hint through an interface field.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-interfaces, ts-function-types, ts-tuples, ts-unions, ts-conversions, ts-numbers, ts-strings, ts-record]
---*/
// String hook record: A Holder field carries an object with a selected conversion callback; node supplies number, string and default hints and the exact object receiver.
type Hint = "number" | "string" | "default";
const hookKey = "hook:primitive", log: unknown[] = [];
interface PrimitiveValue { amount: number; label: string; keys: string[]; hooks: Record<string, (self: PrimitiveValue, hint: Hint) => number | string>; }
interface Holder { value: PrimitiveValue; }
function numeric(self: PrimitiveValue, hint: Hint): number | string {
  log.push(self, hint, "numeric"); return hint === "number" ? self.amount : hint === "string" ? `N:${self.label}` : self.amount + 1;
}
function textual(self: PrimitiveValue, hint: Hint): number | string {
  log.push(self, hint, "textual"); return hint === "number" ? self.amount * 2 : hint === "string" ? `S:${self.label}` : `D:${self.label}`;
}
function make(amount: number, label: string, wordMode: boolean): PrimitiveValue {
  return { amount, label, keys: [hookKey], hooks: { [hookKey]: wordMode ? textual : numeric } };
}
function invoke(target: PrimitiveValue, hint: Hint): number | string {
  if (!target.keys.includes(hookKey)) throw new TypeError("hook"); return target.hooks[hookKey](target, hint);
}
function convert(holder: Holder): unknown[] {
  return [Number(invoke(holder.value, "number")), String(invoke(holder.value, "string")), String(invoke(holder.value, "default")) + "!"];
}
const inputs: [number, string][] = [[-0, ""], [NaN, "x"], [7, "\u00e9"]];
for (const [amount, label] of inputs) for (const wordMode of [false, true]) {
  log.length = 0; const holder: Holder = { value: make(amount, label, wordMode) }, mode = wordMode ? "textual" : "numeric";
  assert.compareArray(convert(holder), wordMode ? [amount * 2, `S:${label}`, `D:${label}!`] : [amount, `N:${label}`, `${amount + 1}!`]);
  assert.compareArray(log, [holder.value, "number", mode, holder.value, "string", mode, holder.value, "default", mode]);
  assert.sameValue(holder.value.amount, amount); assert.sameValue(holder.value.label, label);
}
