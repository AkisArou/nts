/*---
description: An inherited arrow field survives a passive subclass but is replaced by a later arrow-field override.
features: [ts-dispatch-route-method-values, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-inheritance, ts-override, ts-arrow-functions, ts-this, ts-this-parameter, ts-function-types, ts-interfaces]
---*/
// Route: ArrowBase holds a base, passive child or overriding grandchild; node calls the retained own arrow with its original receiver.
type ArrowKind = "base" | "passive" | "own";
interface ArrowState { kind: string; amount: number; total: number; }
const log: unknown[] = [];
class ArrowBase implements ArrowState {
  kind: ArrowKind = "base"; amount: number = 10; total: number = 0;
  run: (value: number) => number = (value: number): number => { log.push("ArrowBase.run", this, value); this.total += value; return this.amount + value; };
}
class PassiveArrow extends ArrowBase { override kind: ArrowKind = "passive"; padding: boolean = true; }
class OwnArrow extends PassiveArrow {
  override kind: ArrowKind = "own";
  override run: (value: number) => number = (value: number): number => { log.push("OwnArrow.run", this, value); this.total += value * 3; return this.amount + value * 3; };
}
for (const input of [-2, 0, 3]) {
  const sources: ArrowBase[] = [new ArrowBase(), new PassiveArrow(), new OwnArrow()];
  for (const source of sources) {
    log.length = 0; const other = new ArrowBase();
    const saved: (this: ArrowState, value: number) => number = source.run;
    source.amount = 100 + input; other.amount = 50 + input; log.push("ready", source, other);
    const result = saved.call(other, input);
    const factor = source.kind === "own" ? 3 : 1, label = source.kind === "own" ? "OwnArrow.run" : "ArrowBase.run";
    assert.sameValue(result, 100 + input + input * factor);
    assert.compareArray(log, ["ready", source, other, label, source, input]);
    assert.sameValue(source.total, input * factor); assert.sameValue(other.total, 0);
    assert.sameValue(source.amount, 100 + input); assert.sameValue(other.amount, 50 + input);
  }
}
