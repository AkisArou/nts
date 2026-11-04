/*---
description: "Control for calls-method-computed-generic; A generic computed method call captures its receiver before the key and arguments retarget the holder."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-generics, ts-generic-constraints, ts-class, ts-class-fields, ts-accessors, ts-this, ts-function-types, ts-literal-types, ts-computed-keys, ts-objects, ts-template-literals, ts-this-parameter]
---*/
// A constrained generic holder carries the receiver; node evaluates source and key, gets the old receiver method, then reads argument-time updates from the new active receiver. The control uses ordered temporaries.
const log: string[] = [];
interface Host { label: string; value: number; readonly method: (this: Host, a: number, b: number) => number; }
interface Box<T extends Host> { current: T; }
function invoke(this: Host, a: number, b: number): number { log.push(`call:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; }
class Entry implements Host { label: string = "old"; value: number = 1; get method(): (this: Host, a: number, b: number) => number { log.push(`get:${this.label}`); return invoke; } }
function source<T extends Host>(box: Box<T>): T { log.push(`source:${box.current.label}`); return box.current; }
function key<T extends Host>(box: Box<T>, next: T): "method" { log.push("key"); box.current = next; return "method"; }
function first<T extends Host>(box: Box<T>, n: number): number { log.push(`first:${box.current.label}`); box.current.value = n; return n + 1; }
function second<T extends Host>(box: Box<T>): number { log.push(`second:${box.current.value}`); return box.current.value + 2; }
function run<T extends Host>(box: Box<T>, next: T, n: number): number {
  log.push("run");
  const receiver = source(box);
  const name = key(box, next);
  const fn = receiver[name];
  const a = first(box, n);
  const b = second(box);
  return fn.call(receiver, a, b);
}
for (const n of [0, 4, -3]) {
  const original = new Entry(), next = new Entry(); next.label = "next"; const box: Box<Entry> = { current: original }; log.length = 0; const result = run(box, next, n);
  assert.compareArray(log, ["run", "source:old", "key", "get:old", "first:next", `second:${n}`, `call:old:1:${n + 1}:${n + 2}`]);
  assert.sameValue(result, 100 + (n + 1) * 10 + n + 2); assert.sameValue(box.current, next); assert.sameValue(original.value, 1); assert.sameValue(next.value, n);
}
