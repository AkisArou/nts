/*---
description: "A tuple constructor target is captured before a head argument replaces it and a spread completes."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-tuples, ts-type-aliases, ts-construct-signatures, ts-class, ts-class-fields, ts-this, ts-new-target, ts-instanceof, ts-rest-parameters, ts-spread, ts-symbols, ts-objects, ts-null-undefined, ts-template-literals]
---*/
// A typed constructor tuple carries the new target and iterable; node keeps the original constructor, exhausts the middle spread and evaluates the final argument before construction.
const log: string[] = [];
interface Item { values: number[]; target: Function; }
type Ctor = new(...values: number[]) => Item;
type Slot = [Ctor, Iterable<number, undefined, unknown>, number];
class First implements Item { values: number[]; target: Function; constructor(...values: number[]) { log.push(`first:${values.join(",")}`); this.values = values; this.target = new.target; } }
class Second implements Item { values: number[]; target: Function; constructor(...values: number[]) { log.push(`second:${values.join(",")}`); this.values = values; this.target = new.target; } }
function head(slot: Slot, next: Ctor, n: number): number { log.push(`head:${n}`); slot[0] = next; return n + 1; }
function source(slot: Slot): Iterable<number, undefined, unknown> { log.push("spread"); return slot[1]; }
function tail(slot: Slot): number { log.push(`tail:${slot[2]}`); return slot[2]; }
function run(slot: Slot, next: Ctor, n: number): Item { log.push("run"); return new slot[0](head(slot, next, n), ...source(slot), tail(slot)); }
for (const Type of [First, Second]) for (const count of [0, 2]) for (const n of [0, 3]) {
  const next = Type === First ? Second : First, label = Type === First ? "first" : "second"; const slot: Slot = [Type, [], -1];
  slot[1] = { [Symbol.iterator](): Iterator<number, undefined, unknown> { log.push("iterator"); let index = 0; return { next(): IteratorResult<number, undefined> { log.push(`next:${index}`); slot[2] = n + index + 10; if (index === count) return { done: true, value: undefined }; return { done: false, value: n + index++ + 2 }; } }; } };
  log.length = 0; const result = run(slot, next, n); const expected = ["run", `head:${n}`, "spread", "iterator"], values = [n + 1]; for (let i = 0; i <= count; i++) expected.push(`next:${i}`); for (let i = 0; i < count; i++) values.push(n + i + 2); values.push(n + count + 10); expected.push(`tail:${n + count + 10}`, `${label}:${values.join(",")}`);
  assert.compareArray(log, expected);
  assert.compareArray(result.values, values); assert.sameValue(result.target, Type); assert.sameValue(result instanceof First, Type === First); assert.sameValue(result instanceof Second, Type === Second); assert.sameValue(slot[0], next); assert.sameValue(slot[2], n + count + 10);
}
