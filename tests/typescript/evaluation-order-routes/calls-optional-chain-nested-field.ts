/*---
description: "A continuous optional chain skips nested getters and arguments, and retains the reached receiver before argument mutation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-type-aliases, ts-function-types, ts-this, ts-objects, ts-accessors, ts-unions, ts-null-undefined, ts-errors, ts-narrowing, ts-template-literals, ts-optional-chaining, ts-this-parameter]
---*/
// A nullable interface field carries a branch; node skips child, method and arguments for nullish roots, otherwise captures the old child before the arguments replace it.
const log: string[] = [];
type Method = (this: Host, a: number, b: number) => number;
interface Host { label: string; value: number; readonly method: Method; }
interface Branch { stored: Host; readonly child: Host; }
interface Slot { current: Branch | null | undefined; }
function body(this: Host, a: number, b: number): number { log.push(`call:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; }
function source(slot: Slot): Branch | null | undefined { log.push("source"); return slot.current; }
function first(slot: Slot, next: Host, n: number): number { log.push("first"); const root = slot.current; if (root === null || root === undefined) throw new Error("missing root"); root.stored = next; next.value = n; return n + 1; }
function second(slot: Slot): number { log.push("second"); const root = slot.current; if (root === null || root === undefined) throw new Error("missing root"); log.push(`read:${root.stored.label}:${root.stored.value}`); return root.stored.value + 2; }
function run(slot: Slot, next: Host, n: number): number | undefined { log.push("run"); return source(slot)?.child.method(first(slot, next, n), second(slot)); }
for (const mode of ["null", "undefined", "live"]) for (const n of [0, 3]) {
  const original: Host = { label: "old", value: 1, get method(): Method { log.push("get:old"); return body; } }, next: Host = { label: "new", value: 9, get method(): Method { log.push("get:new"); return body; } };
  const root: Branch = { stored: original, get child(): Host { log.push(`child:${this.stored.label}`); return this.stored; } }, slot: Slot = { current: mode === "null" ? null : mode === "undefined" ? undefined : root }; log.length = 0; const result = run(slot, next, n);
  const expected = ["run", "source"]; if (mode === "live") expected.push("child:old", "get:old", "first", "second", `read:new:${n}`, `call:old:1:${n + 1}:${n + 2}`);
  assert.compareArray(log, expected);
  assert.sameValue(result, mode === "live" ? 100 + (n + 1) * 10 + n + 2 : undefined); assert.sameValue(root.stored, mode === "live" ? next : original); assert.sameValue(original.value, 1); assert.sameValue(next.value, mode === "live" ? n : 9);
}
