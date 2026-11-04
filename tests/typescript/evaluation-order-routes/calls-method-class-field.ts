/*---
description: "A class-field receiver is captured before argument helpers replace that field."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-this, ts-template-literals]
---*/
// A class field carries the receiver; node calls its original method even after the first argument installs another receiver and the second reads the replacement.
const log: string[] = [];
class Actor { label: string = "old"; value: number = 1; method(a: number, b: number): number { log.push(`call:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; } }
class Holder {
  current: Actor = new Actor(); other: Actor = new Actor();
  replace(n: number): number { log.push(`replace:${n}`); this.current = this.other; this.current.value = n; return n + 1; }
  read(): number { log.push(`read:${this.current.label}:${this.current.value}`); return this.current.value + 2; }
  run(n: number): number { log.push("run"); return this.current.method(this.replace(n), this.read()); }
}
for (const n of [0, 5, -2]) {
  const holder = new Holder(); holder.other.label = "new"; const original = holder.current; log.length = 0; const result = holder.run(n);
  assert.compareArray(log, ["run", `replace:${n}`, `read:new:${n}`, `call:old:1:${n + 1}:${n + 2}`]);
  assert.sameValue(result, 100 + (n + 1) * 10 + n + 2); assert.sameValue(holder.current, holder.other); assert.sameValue(original.value, 1); assert.sameValue(holder.other.value, n);
}
