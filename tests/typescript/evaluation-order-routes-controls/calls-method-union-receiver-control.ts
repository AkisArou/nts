/*---
description: "Control for calls-method-union-receiver; A discriminant-narrowed method call keeps its original receiver when its first argument changes the active union."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-this, ts-interfaces, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-literal-types, ts-objects, ts-template-literals]
---*/
// A discriminated union carries the method; node captures the narrowed receiver, keeps its live field update and reads the replacement object in the second argument. The control uses ordered temporaries.
const log: string[] = [];
class Left { kind: "left" = "left"; value: number = 1; method(a: number, b: number): number { log.push(`left:${this.value}:${a}:${b}`); return 1000 + this.value * 100 + a * 10 + b; } }
class Right { kind: "right" = "right"; value: number = 1; padding: boolean = true; method(a: number, b: number): number { log.push(`right:${this.value}:${a}:${b}`); return 2000 + this.value * 100 + a * 10 + b; } }
type Choice = Left | Right;
interface Slot { current: Choice; }
function first(slot: Slot, next: Choice, n: number): number { log.push(`first:${slot.current.kind}`); slot.current.value = n; slot.current = next; return n + 1; }
function second(slot: Slot): number { log.push(`second:${slot.current.kind}:${slot.current.value}`); return slot.current.value; }
function run(slot: Slot, next: Choice, n: number): number {
  log.push("run");
  if (slot.current.kind === "left") {
    const receiver = slot.current;
    const fn = receiver.method;
    const a = first(slot, next, n);
    const b = second(slot);
    return fn.call(receiver, a, b);
  }
  const receiver = slot.current;
  const fn = receiver.method;
  const a = first(slot, next, n);
  const b = second(slot);
  return fn.call(receiver, a, b);
}
for (const original of [new Left(), new Right()]) for (const n of [0, 3]) {
  original.value = 1; const next: Choice = original.kind === "left" ? new Right() : new Left(); next.value = 9; const slot: Slot = { current: original }; log.length = 0; const result = run(slot, next, n);
  assert.compareArray(log, ["run", `first:${original.kind}`, `second:${next.kind}:9`, `${original.kind}:${n}:${n + 1}:9`]);
  assert.sameValue(result, (original.kind === "left" ? 1000 : 2000) + n * 100 + (n + 1) * 10 + 9); assert.sameValue(slot.current, next); assert.sameValue(original.value, n); assert.sameValue(next.value, 9);
}
