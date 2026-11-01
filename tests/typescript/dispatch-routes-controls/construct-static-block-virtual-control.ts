/*---
description: Control for construct-static-block-virtual; stored class tags choose explicit plain calls during initialization.
features: [ts-dispatch-route-construction, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-functions, ts-arrays, ts-static, ts-class-static-block, ts-interfaces]
---*/
// Control: choose the same plain body using the class tag already stored before the call.
const log: unknown[] = [];
interface BuildStaticState { kind: string; input: number; state: number; late: number | undefined; }
function alphaRead(receiver: BuildStaticState): number | undefined { log.push("Alpha.read", receiver, receiver.late); receiver.state += 1; log.push("write", receiver, receiver.state); return receiver.late; }
function betaRead(receiver: BuildStaticState): number | undefined { log.push("Beta.read", receiver, receiver.late); receiver.state += 2; log.push("write", receiver, receiver.state); return receiver.late; }
function gammaRead(receiver: BuildStaticState): number | undefined { log.push("Gamma.read", receiver, receiver.late); receiver.state += 3; log.push("write", receiver, receiver.state); return receiver.late; }
function baseRun(receiver: BuildStaticState): number | undefined { log.push("Base.run", receiver, receiver.input); return receiver.kind === "alpha" ? alphaRead(receiver) : receiver.kind === "beta" ? betaRead(receiver) : gammaRead(receiver); }
for (const input of [-3, 0, 4]) {
  log.length = 0;
  class BuildStaticBase {
    static kind: string = "base"; static input: number = 0; static state: number = 0; static late: number | undefined = undefined; static seen: number | undefined;
    static run(): number | undefined { log.push("Base.run", this, this.input); return this.read(); }
    static read(): number | undefined { log.push("Base.read", this, this.late); return this.late; }
  }
  class BuildStaticAlpha extends BuildStaticBase {
    static override kind: string = "alpha"; static override input: number = input;
    static { log.push("Alpha.block", this, this.input); this.seen = baseRun(this); log.push("seen", this, this.seen); }
    static override late: number = (log.push("Alpha.field", this, this.input), this.input + 10);
    static override read(): number | undefined { log.push("Alpha.read", this, this.late); this.state += 1; log.push("write", this, this.state); return this.late; }
  }
  class BuildStaticBeta extends BuildStaticBase {
    static override kind: string = "beta"; static override input: number = input;
    static { log.push("Beta.block", this, this.input); this.seen = baseRun(this); log.push("seen", this, this.seen); }
    static override late: number = (log.push("Beta.field", this, this.input), this.input + 20);
    static override read(): number | undefined { log.push("Beta.read", this, this.late); this.state += 2; log.push("write", this, this.state); return this.late; }
  }
  class BuildStaticGamma extends BuildStaticBase {
    static override kind: string = "gamma"; static override input: number = input;
    static { log.push("Gamma.block", this, this.input); this.seen = baseRun(this); log.push("seen", this, this.seen); }
    static override late: number = (log.push("Gamma.field", this, this.input), this.input + 30);
    static override read(): number | undefined { log.push("Gamma.read", this, this.late); this.state += 3; log.push("write", this, this.state); return this.late; }
  }
  const types = [BuildStaticAlpha, BuildStaticBeta, BuildStaticGamma], names = ["Alpha", "Beta", "Gamma"], kinds = ["alpha", "beta", "gamma"];
  const expected: unknown[] = [];
  for (let i = 0; i < types.length; i++) {
    const receiver: typeof BuildStaticBase = types[i];
    assert.sameValue(receiver.kind, kinds[i]); assert.sameValue(receiver.seen, undefined); assert.sameValue(receiver.late, input + (i + 1) * 10); assert.sameValue(receiver.state, i + 1);
    expected.push(names[i] + ".block", receiver, input, "Base.run", receiver, input, names[i] + ".read", receiver, undefined, "write", receiver, i + 1, "seen", receiver, undefined, names[i] + ".field", receiver, input);
  }
  assert.sameValue(BuildStaticBase.state, 0); assert.sameValue(BuildStaticBase.late, undefined); assert.compareArray(log, expected);
}
