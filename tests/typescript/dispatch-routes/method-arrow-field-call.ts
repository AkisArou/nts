/*---
description: Prototype and overriding arrow fields select different receivers when extracted methods are called with a foreign object.
features: [ts-dispatch-route-method-values, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-inheritance, ts-override, ts-arrow-functions, ts-this, ts-this-parameter, ts-function-types, ts-interfaces]
---*/
// Route: PrototypeBase holds a base, arrow child or arrow grandchild; node uses the supplied receiver only for the prototype method.
type ArrowKind = "prototype" | "arrow" | "grand";
interface ArrowState { kind: string; amount: number; total: number; }
const log: unknown[] = [];
class PrototypeBase implements ArrowState {
  kind: ArrowKind = "prototype"; amount: number = 10; total: number = 0;
  run(this: ArrowState, value: number): number { log.push("PrototypeBase.run", this, value); this.total += value; return this.amount + value; }
}
class ArrowChild extends PrototypeBase {
  override kind: ArrowKind = "arrow";
  override run: (value: number) => number = (value: number): number => { log.push("ArrowChild.run", this, value); this.total += value * 2; return this.amount + value * 2; };
}
class ArrowGrandchild extends ArrowChild {
  override kind: ArrowKind = "grand";
  override run: (value: number) => number = (value: number): number => { log.push("ArrowGrandchild.run", this, value); this.total += value * 3; return this.amount + value * 3; };
}
for (const input of [-2, 0, 3]) {
  const sources: PrototypeBase[] = [new PrototypeBase(), new ArrowChild(), new ArrowGrandchild()];
  for (const source of sources) {
    log.length = 0; const other = new PrototypeBase();
    const saved: (this: ArrowState, value: number) => number = source.run;
    source.amount = 100 + input; other.amount = 50 + input; log.push("ready", source, other);
    const result = saved.call(other, input);
    const factor = source.kind === "prototype" ? 1 : source.kind === "arrow" ? 2 : 3;
    const receiver = source.kind === "prototype" ? other : source;
    const label = source.kind === "prototype" ? "PrototypeBase.run" : source.kind === "arrow" ? "ArrowChild.run" : "ArrowGrandchild.run";
    assert.sameValue(result, (source.kind === "prototype" ? 50 : 100) + input + input * factor);
    assert.compareArray(log, ["ready", source, other, label, receiver, input]);
    assert.sameValue(source.total, source.kind === "prototype" ? 0 : input * factor);
    assert.sameValue(other.total, source.kind === "prototype" ? input : 0);
    assert.sameValue(source.amount, 100 + input); assert.sameValue(other.amount, 50 + input);
  }
}
