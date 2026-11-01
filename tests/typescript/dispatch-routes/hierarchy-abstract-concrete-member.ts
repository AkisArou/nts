/*---
description: A concrete method on an abstract base is inherited by one subclass and overridden by two others.
features: [ts-dispatch-route-hierarchies, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-this, ts-functions, ts-arrays, ts-abstract]
---*/
// DispatchAbstract holds Inherited, Beta or Gamma; run chooses either the abstract base concrete body or the actual override.
const log: unknown[] = [];
abstract class DispatchAbstract {
  kind: string = "abstract"; state: number = 0;
  run(value: number): number { log.push("Abstract.run", this, value, this.state); this.state += value; log.push("write", this, this.state); return this.state + 1; }
}
class DispatchInherited extends DispatchAbstract { override kind: string = "inherited"; padding: string = "inherited"; }
class DispatchBeta extends DispatchAbstract {
  override kind: string = "beta";
  override run(value: number): number { log.push("Beta.run", this, value, this.state); this.state += value * 10; log.push("write", this, this.state); return this.state + 10; }
}
class DispatchGamma extends DispatchAbstract {
  gamma: boolean = true; override kind: string = "gamma";
  override run(value: number): number { log.push("Gamma.run", this, value, this.state); this.state += value * 100; log.push("write", this, this.state); return this.state + 100; }
}
function invoke(receiver: DispatchAbstract, value: number): number { return receiver.run(value); }
for (const input of [-3, 0, 4]) {
  const rows = [{ receiver: new DispatchInherited(), kind: "inherited", method: "Abstract.run", weight: 1 },
    { receiver: new DispatchBeta(), kind: "beta", method: "Beta.run", weight: 10 },
    { receiver: new DispatchGamma(), kind: "gamma", method: "Gamma.run", weight: 100 }];
  for (const row of rows) {
    log.length = 0; const result = invoke(row.receiver, input); const state = input * row.weight;
    assert.sameValue(result, state + row.weight); assert.sameValue(row.receiver.state, state); assert.sameValue(row.receiver.kind, row.kind);
    assert.compareArray(log, [row.method, row.receiver, input, 0, "write", row.receiver, state]);
  }
}
