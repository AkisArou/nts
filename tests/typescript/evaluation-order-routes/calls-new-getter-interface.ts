/*---
description: "A constructor getter is evaluated before arguments replace its backing constructor."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-construct-signatures, ts-class, ts-class-fields, ts-accessors, ts-this, ts-new-target, ts-instanceof, ts-objects, ts-template-literals]
---*/
// An interface getter carries a constructor type; node reads it once, runs both mutating arguments and constructs the original class with its original new.target.
const log: string[] = [];
interface Item { label: string; a: number; b: number; target: Function; }
type Ctor = new(a: number, b: number) => Item;
class First implements Item { label: string = "first"; a: number; b: number; target: Function; constructor(a: number, b: number) { log.push(`first:${a}:${b}`); this.a = a; this.b = b; this.target = new.target; } }
class Second implements Item { label: string = "second"; a: number; b: number; target: Function; constructor(a: number, b: number) { log.push(`second:${a}:${b}`); this.a = a; this.b = b; this.target = new.target; } }
interface Selector { current: Ctor; value: number; readonly C: Ctor; }
function first(slot: Selector, next: Ctor, n: number): number { log.push(`arg1:${n}`); slot.current = next; slot.value = n; return n + 1; }
function second(slot: Selector): number { log.push(`arg2:${slot.value}`); return slot.value + 2; }
function run(slot: Selector, next: Ctor, n: number): Item { log.push("run"); return new slot.C(first(slot, next, n), second(slot)); }
for (const Type of [First, Second]) for (const n of [0, 3, -1]) {
  const next = Type === First ? Second : First, label = Type === First ? "first" : "second"; const slot: Selector = { current: Type, value: 9, get C(): Ctor { log.push("getC"); return this.current; } }; log.length = 0; const result = run(slot, next, n);
  assert.compareArray(log, ["run", "getC", `arg1:${n}`, `arg2:${n}`, `${label}:${n + 1}:${n + 2}`]);
  assert.sameValue(result.label, label); assert.sameValue(result.a, n + 1); assert.sameValue(result.b, n + 2); assert.sameValue(result.target, Type); assert.sameValue(result instanceof First, Type === First); assert.sameValue(result instanceof Second, Type === Second); assert.sameValue(slot.current, next); assert.sameValue(slot.value, n);
}
