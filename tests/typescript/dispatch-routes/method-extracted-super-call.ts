/*---
description: An extracted override keeps its lexical super target when call gives it a different receiver.
features: [ts-dispatch-route-method-values, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-inheritance, ts-override, ts-interfaces, ts-function-types, ts-this, ts-this-parameter]
---*/
// Route: a SuperBase view selects First, Second or Third; node retains that override and its super target while supplying the foreign this.
interface SuperState { kind: string; amount: number; total: number; }
const log: unknown[] = [];
class SuperBase implements SuperState {
  kind: string = "base"; amount: number = 10; total: number = 0;
  run(this: SuperState, value: number): number { log.push("SuperBase.run", this, value); this.total += value; return this.amount + value; }
}
class First extends SuperBase { override kind: string = "first"; override run(this: SuperState, value: number): number { log.push("First.run", this, value); return super.run(value + 1) * 1; } }
class Second extends SuperBase { override kind: string = "second"; override run(this: SuperState, value: number): number { log.push("Second.run", this, value); return super.run(value + 2) * 2; } }
class Third extends SuperBase { override kind: string = "third"; override run(this: SuperState, value: number): number { log.push("Third.run", this, value); return super.run(value + 3) * 3; } }
for (const input of [-2, 0, 3]) {
  const sources: SuperBase[] = [new First(), new Second(), new Third()];
  for (const source of sources) {
    log.length = 0; const other = new SuperBase();
    const saved: (this: SuperState, value: number) => number = source.run;
    source.amount = 100 + input; other.amount = 50 + input; log.push("ready", source, other);
    const result = saved.call(other, input);
    const factor = source.kind === "first" ? 1 : source.kind === "second" ? 2 : 3;
    const label = source.kind === "first" ? "First.run" : source.kind === "second" ? "Second.run" : "Third.run";
    assert.sameValue(result, (50 + input + input + factor) * factor);
    assert.compareArray(log, ["ready", source, other, label, other, input, "SuperBase.run", other, input + factor]);
    assert.sameValue(source.total, 0); assert.sameValue(other.total, input + factor);
    assert.sameValue(source.amount, 100 + input); assert.sameValue(other.amount, 50 + input);
  }
}
