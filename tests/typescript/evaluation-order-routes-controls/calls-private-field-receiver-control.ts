/*---
description: "Control for calls-private-field-receiver; A private-field method receiver is retained across arguments that replace the private field."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-calls, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-accessors, ts-template-literals]
---*/
// A private class field carries the receiver; node retains its old method receiver while both argument helpers observe the new private-field value. The control uses ordered temporaries.
const log: string[] = [];
class Actor { label: string = "old"; value: number = 1; method(a: number, b: number): number { log.push(`call:${this.label}:${this.value}:${a}:${b}`); return this.value * 100 + a * 10 + b; } }
class Holder {
  #current: Actor = new Actor(); initial: Actor = this.#current; other: Actor = new Actor();
  get active(): Actor { log.push("active"); return this.#current; }
  replace(n: number): number { log.push(`replace:${n}`); this.#current = this.other; this.#current.value = n; return n + 1; }
  read(): number { log.push(`read:${this.#current.label}:${this.#current.value}`); return this.#current.value + 2; }
  run(n: number): number {
    log.push("run");
    const receiver = this.#current;
    const fn = receiver.method;
    const a = this.replace(n);
    const b = this.read();
    return fn.call(receiver, a, b);
  }
}
for (const n of [0, 5, -2]) {
  const holder = new Holder(); holder.other.label = "new"; log.length = 0; const result = holder.run(n), active = holder.active;
  assert.compareArray(log, ["run", `replace:${n}`, `read:new:${n}`, `call:old:1:${n + 1}:${n + 2}`, "active"]);
  assert.sameValue(result, 100 + (n + 1) * 10 + n + 2); assert.sameValue(active, holder.other); assert.sameValue(holder.initial.value, 1); assert.sameValue(holder.other.value, n);
}
