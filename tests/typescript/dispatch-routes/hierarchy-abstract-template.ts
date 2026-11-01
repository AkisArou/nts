/*---
description: A concrete abstract-base template method dispatches successive calls to the same concrete abstract implementation.
features: [ts-dispatch-route-hierarchies, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-this, ts-functions, ts-arrays, ts-abstract]
---*/
// DispatchAbstract holds Alpha, Beta or Gamma; inherited run calls its step twice with the same receiver and successive state.
const log: unknown[] = [];
abstract class DispatchAbstract {
  kind: string = "abstract"; state: number = 0;
  abstract step(value: number): number;
  run(value: number): number { log.push("Abstract.run", this, value); return this.step(value) + this.step(value + 1); }
}
class DispatchAlpha extends DispatchAbstract {
  override kind: string = "alpha"; alpha: string = "alpha";
  override step(value: number): number { log.push("Alpha.step", this, value, this.state); this.state += value; log.push("write", this, this.state); return this.state + 1; }
}
class DispatchBeta extends DispatchAbstract {
  padding: number[] = []; override kind: string = "beta";
  override step(value: number): number { log.push("Beta.step", this, value, this.state); this.state += value * 10; log.push("write", this, this.state); return this.state + 10; }
}
class DispatchGamma extends DispatchAbstract {
  override kind: string = "gamma"; gamma: boolean = true;
  override step(value: number): number { log.push("Gamma.step", this, value, this.state); this.state += value * 100; log.push("write", this, this.state); return this.state + 100; }
}
function invoke(receiver: DispatchAbstract, value: number): number { return receiver.run(value); }
for (const input of [-3, 0, 4]) {
  const rows = [{ receiver: new DispatchAlpha(), kind: "alpha", method: "Alpha.step", weight: 1 },
    { receiver: new DispatchBeta(), kind: "beta", method: "Beta.step", weight: 10 },
    { receiver: new DispatchGamma(), kind: "gamma", method: "Gamma.step", weight: 100 }];
  for (const row of rows) {
    log.length = 0; const result = invoke(row.receiver, input); const first = input * row.weight, last = (2 * input + 1) * row.weight;
    assert.sameValue(result, first + last + 2 * row.weight); assert.sameValue(row.receiver.state, last); assert.sameValue(row.receiver.kind, row.kind);
    assert.compareArray(log, ["Abstract.run", row.receiver, input, row.method, row.receiver, input, 0, "write", row.receiver, first,
      row.method, row.receiver, input + 1, first, "write", row.receiver, last]);
  }
}
