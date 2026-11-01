/*---
description: Control for hierarchy-abstract-member; stored class tags choose direct plain function calls.
features: [ts-dispatch-route-hierarchies, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-this, ts-functions, ts-arrays, ts-abstract]
---*/
// The same receivers retain their classes; tags select plain functions and lexical super calls name each level explicitly.
const log: unknown[] = [];
abstract class DispatchAbstract {
  kind: string = "abstract"; state: number = 0;
  abstract step(value: number): number;
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
function alphaStep(receiver: DispatchAbstract, value: number): number { log.push("Alpha.step", receiver, value, receiver.state); receiver.state += value; log.push("write", receiver, receiver.state); return receiver.state + 1; }
function betaStep(receiver: DispatchAbstract, value: number): number { log.push("Beta.step", receiver, value, receiver.state); receiver.state += value * 10; log.push("write", receiver, receiver.state); return receiver.state + 10; }
function gammaStep(receiver: DispatchAbstract, value: number): number { log.push("Gamma.step", receiver, value, receiver.state); receiver.state += value * 100; log.push("write", receiver, receiver.state); return receiver.state + 100; }
function invoke(receiver: DispatchAbstract, value: number): number {
  if (receiver.kind === "alpha") return alphaStep(receiver, value);
  return receiver.kind === "beta" ? betaStep(receiver, value) : gammaStep(receiver, value);
}
for (const input of [-3, 0, 4]) {
  const rows = [{ receiver: new DispatchAlpha(), kind: "alpha", method: "Alpha.step", weight: 1 },
    { receiver: new DispatchBeta(), kind: "beta", method: "Beta.step", weight: 10 },
    { receiver: new DispatchGamma(), kind: "gamma", method: "Gamma.step", weight: 100 }];
  for (const row of rows) {
    log.length = 0; const result = invoke(row.receiver, input); const state = input * row.weight;
    assert.sameValue(result, state + row.weight); assert.sameValue(row.receiver.state, state); assert.sameValue(row.receiver.kind, row.kind);
    assert.compareArray(log, [row.method, row.receiver, input, 0, "write", row.receiver, state]);
  }
}
