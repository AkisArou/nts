/*---
description: Three unrelated classes implement two same-name method interfaces with one receiver and state.
features: [ts-dispatch-route-interfaces, ts-interfaces, ts-class, ts-class-fields, ts-functions, ts-arrays]
---*/
// Route: Each class implements DispatchFace and DispatchOther; node uses the same step body through both interface views.
const log: unknown[] = [];
interface DispatchState { kind: "alpha" | "beta" | "gamma"; state: number; bias: number; }
interface DispatchFace extends DispatchState { primary: string; step(value: number): number; }
interface DispatchOther extends DispatchState { secondary: number; step(value: number): number; }
class DispatchAlpha implements DispatchFace, DispatchOther {
  kind: "alpha" = "alpha"; state: number = 0; bias: number = 10; primary: string = "alpha"; secondary: number = 1;
  step(value: number): number { log.push("Alpha.step", this, value, this.state); this.state += value * 1; log.push("write", this, this.state); return this.state + this.bias; }
}
class DispatchBeta implements DispatchFace, DispatchOther {
  padding: string = "beta"; bias: number = 20; kind: "beta" = "beta"; state: number = 0; primary: string = "beta"; secondary: number = 2;
  step(value: number): number { log.push("Beta.step", this, value, this.state); this.state += value * 2; log.push("write", this, this.state); return this.state + this.bias; }
}
class DispatchGamma implements DispatchFace, DispatchOther {
  state: number = 0; flag: boolean = true; kind: "gamma" = "gamma"; bias: number = 30; primary: string = "gamma"; secondary: number = 3;
  step(value: number): number { log.push("Gamma.step", this, value, this.state); this.state += value * 3; log.push("write", this, this.state); return this.state + this.bias; }
}
for (const input of [-3, 0, 4]) {
  log.length = 0;
  const sources: (DispatchAlpha | DispatchBeta | DispatchGamma)[] = [new DispatchAlpha(), new DispatchBeta(), new DispatchGamma()];
  const expected: unknown[] = [], methods = ["Alpha.step", "Beta.step", "Gamma.step"];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]; const first: DispatchFace = source; const second: DispatchOther = source;
    assert.sameValue(first.primary, ["alpha", "beta", "gamma"][i]); assert.sameValue(second.secondary, i + 1);
    const left = first.step(input), right = second.step(input + 1);
    const leftState = input * (i + 1), rightState = (2 * input + 1) * (i + 1);
    assert.sameValue(left, leftState + (i + 1) * 10); assert.sameValue(right, rightState + (i + 1) * 10);
    assert.sameValue(source.state, rightState); assert.sameValue(source.kind, ["alpha", "beta", "gamma"][i]);
    expected.push(methods[i], source, input, 0, "write", source, leftState, methods[i], source, input + 1, leftState, "write", source, rightState);
  }
  assert.compareArray(log, expected);
}
