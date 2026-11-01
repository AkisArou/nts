/*---
description: Control for construct-base-before-derived-field; stored class tags choose explicit plain calls during initialization.
features: [ts-dispatch-route-construction, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-functions, ts-arrays, ts-abstract]
---*/
// Control: choose the same plain body using the class tag already stored before the call.
const log: unknown[] = [];
type BuildKind = "alpha" | "beta" | "gamma";
abstract class BuildBase {
  abstract late: number; kind: BuildKind; input: number; state: number = 0; seen: number | undefined;
  constructor(kind: BuildKind, input: number) { this.kind = kind; this.input = input; log.push("Base.ctor", this, kind, input);
    this.seen = (this.kind === "alpha" ? alphaRead(this) : this.kind === "beta" ? betaRead(this) : gammaRead(this)); log.push("seen", this, this.seen);
  }
  read(): number | undefined { log.push("Base.read", this, this.late); return this.late; }
}
class BuildAlpha extends BuildBase {
  override late: number = (log.push("Alpha.field", this, this.input), this.input + 10);
  constructor(input: number) { super("alpha", input); log.push("Alpha.ctor", this, this.late); }
  override read(): number | undefined { log.push("Alpha.read", this, this.late); this.state += 1; log.push("write", this, this.state); return this.late; }
}
class BuildBeta extends BuildBase {
  override late: number = (log.push("Beta.field", this, this.input), this.input + 20);
  constructor(input: number) { super("beta", input); log.push("Beta.ctor", this, this.late); }
  override read(): number | undefined { log.push("Beta.read", this, this.late); this.state += 2; log.push("write", this, this.state); return this.late; }
}
class BuildGamma extends BuildBase {
  override late: number = (log.push("Gamma.field", this, this.input), this.input + 30);
  constructor(input: number) { super("gamma", input); log.push("Gamma.ctor", this, this.late); }
  override read(): number | undefined { log.push("Gamma.read", this, this.late); this.state += 3; log.push("write", this, this.state); return this.late; }
}
function alphaRead(receiver: BuildBase): number | undefined { log.push("Alpha.read", receiver, receiver.late); receiver.state += 1; log.push("write", receiver, receiver.state); return receiver.late; }
function betaRead(receiver: BuildBase): number | undefined { log.push("Beta.read", receiver, receiver.late); receiver.state += 2; log.push("write", receiver, receiver.state); return receiver.late; }
function gammaRead(receiver: BuildBase): number | undefined { log.push("Gamma.read", receiver, receiver.late); receiver.state += 3; log.push("write", receiver, receiver.state); return receiver.late; }
for (const input of [-3, 0, 4]) {
  const types = [BuildAlpha, BuildBeta, BuildGamma], kinds = ["alpha", "beta", "gamma"], names = ["Alpha", "Beta", "Gamma"];
  for (let i = 0; i < types.length; i++) {
    log.length = 0; const Type = types[i]; const receiver: BuildBase = new Type(input);
    const later = input + (i + 1) * 10; assert.sameValue(receiver.seen, undefined); assert.sameValue(receiver.late, later);
    assert.sameValue(receiver.kind, kinds[i]); assert.sameValue(receiver.input, input); assert.sameValue(receiver.state, i + 1);
    const expected: unknown[] = ["Base.ctor", receiver, kinds[i], input];
    expected.push(names[i] + ".read", receiver, undefined, "write", receiver, i + 1);
    expected.push("seen", receiver, undefined);
    expected.push(names[i] + ".field", receiver, input);
    expected.push(names[i] + ".ctor", receiver, later); assert.compareArray(log, expected);
  }
}
