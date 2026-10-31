/*---
description: Control for order-getter-short-circuit-union; the getter and conversion hooks are invoked explicitly.
features: [ts-implicit-order, ts-accessors, ts-conversions, ts-to-string, ts-class, ts-class-fields, ts-interfaces, ts-unions]
---*/
// Control: ../implicit-calls/order-getter-short-circuit-union.ts; the getter and conversion hooks are invoked explicitly.
interface GateView { readonly text: string; readText(): string; }
interface TextHook { toString(): string; }
const log: string[] = [];
let state = 0;
class Gate implements GateView {
  stored: string;
  constructor(value: string) { this.stored = value; }
  readText(): string { state++; log.push(`get:${this.stored}:${state}`); return this.stored; }
  get text(): string { return this.readText(); }
}
class Text implements TextHook {
  value: string;
  constructor(value: string) { this.value = value; }
  toString(): string { state += 10; log.push(`toString:${this.value}:${state}`); return `converted:${this.value}`; }
}
function render(gate: GateView, value: string | TextHook): string { return gate.readText() && (typeof value === "string" ? value : value.toString()); }
for (const text of ["", "a", "xy"]) {
  const values: (string | TextHook)[] = [`converted:${text}`, new Text(text)];
  for (const value of values) {
    log.length = 0; state = 0;
    const result = render(new Gate(text), value);
    const called = text !== "" && typeof value === "object";
    assert.sameValue(result, text === "" ? "" : `converted:${text}`);
    assert.sameValue(state, called ? 11 : 1);
    assert.compareArray(log, called ? [`get:${text}:1`, `toString:${text}:11`] : [`get:${text}:1`]);
  }
}
