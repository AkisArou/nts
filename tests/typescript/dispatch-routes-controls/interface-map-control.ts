/*---
description: Control for interface-map; stored class tags choose the same plain function bodies.
features: [ts-dispatch-route-interfaces, ts-interfaces, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-map-set]
---*/
// Control: resolve each method by the stored class tag and pass its receiver explicitly.
const log: unknown[] = [];
interface DispatchState { kind: "alpha" | "beta" | "gamma"; state: number; bias: number; }
interface DispatchFace extends DispatchState { step(value: number): number; }
class DispatchAlpha implements DispatchFace {
  kind: "alpha" = "alpha"; state: number = 0; bias: number = 10;
  step(value: number): number { log.push("Alpha.step", this, value, this.state); this.state += value * 1; log.push("write", this, this.state); return this.state + this.bias; }
}
class DispatchBeta implements DispatchFace {
  padding: string = "beta"; bias: number = 20; kind: "beta" = "beta"; state: number = 0;
  step(value: number): number { log.push("Beta.step", this, value, this.state); this.state += value * 2; log.push("write", this, this.state); return this.state + this.bias; }
}
class DispatchGamma implements DispatchFace {
  state: number = 0; flag: boolean = true; kind: "gamma" = "gamma"; bias: number = 30;
  step(value: number): number { log.push("Gamma.step", this, value, this.state); this.state += value * 3; log.push("write", this, this.state); return this.state + this.bias; }
}
function alphaStep(receiver: DispatchState, value: number): number { log.push("Alpha.step", receiver, value, receiver.state); receiver.state += value * 1; log.push("write", receiver, receiver.state); return receiver.state + receiver.bias; }
function betaStep(receiver: DispatchState, value: number): number { log.push("Beta.step", receiver, value, receiver.state); receiver.state += value * 2; log.push("write", receiver, receiver.state); return receiver.state + receiver.bias; }
function gammaStep(receiver: DispatchState, value: number): number { log.push("Gamma.step", receiver, value, receiver.state); receiver.state += value * 3; log.push("write", receiver, receiver.state); return receiver.state + receiver.bias; }
for (const input of [-3, 0, 4]) {
  log.length = 0;
  const sources: (DispatchAlpha | DispatchBeta | DispatchGamma)[] = [new DispatchAlpha(), new DispatchBeta(), new DispatchGamma()];
  const registry = new Map<number, DispatchFace>(); for (let i = 0; i < sources.length; i++) registry.set(i, sources[i]);
  const expected: unknown[] = [];
  const kinds = ["alpha", "beta", "gamma"], methods = ["Alpha.step", "Beta.step", "Gamma.step"];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const receiver = registry.get(i); if (receiver === undefined) throw new Test262Error("missing receiver");
    assert.sameValue(receiver, source); assert.sameValue(receiver.kind, kinds[i]);
    log.push("call", source, input);
    const result = (receiver.kind === "alpha" ? alphaStep(receiver, input) : receiver.kind === "beta" ? betaStep(receiver, input) : gammaStep(receiver, input));
    log.push("result", source, result);
    const state = input * (i + 1), answer = state + (i + 1) * 10;
    assert.sameValue(result, answer); assert.sameValue(source.state, state); assert.sameValue(source.bias, (i + 1) * 10);
    expected.push("call", source, input, methods[i], source, input, 0, "write", source, state, "result", source, answer);
  }
  assert.compareArray(log, expected);
}
