/*---
description: A base constructor selects three overrides before the derived parameter property is assigned.
features: [ts-dispatch-route-construction, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-functions, ts-arrays, ts-abstract, ts-parameter-properties]
---*/
// Route: BuildBase construction reaches Alpha, Beta or Gamma read before its parameter property is assigned; node observes undefined then the argument value.
const log: unknown[] = [];
type BuildKind = "alpha" | "beta" | "gamma";
abstract class BuildBase {
  abstract late: number; kind: BuildKind; input: number; state: number = 0; seen: number | undefined;
  constructor(kind: BuildKind, input: number) { this.kind = kind; this.input = input; log.push("Base.ctor", this, kind, input);
    this.seen = this.read(); log.push("seen", this, this.seen);
  }
  read(): number | undefined { log.push("Base.read", this, this.late); return this.late; }
}
class BuildAlpha extends BuildBase {
  constructor(public override late: number) { super("alpha", late); log.push("Alpha.ctor", this, this.late); }
  override read(): number | undefined { log.push("Alpha.read", this, this.late); this.state += 1; log.push("write", this, this.state); return this.late; }
}
class BuildBeta extends BuildBase {
  constructor(public override late: number) { super("beta", late); log.push("Beta.ctor", this, this.late); }
  override read(): number | undefined { log.push("Beta.read", this, this.late); this.state += 2; log.push("write", this, this.state); return this.late; }
}
class BuildGamma extends BuildBase {
  constructor(public override late: number) { super("gamma", late); log.push("Gamma.ctor", this, this.late); }
  override read(): number | undefined { log.push("Gamma.read", this, this.late); this.state += 3; log.push("write", this, this.state); return this.late; }
}
for (const input of [-3, 0, 4]) {
  const types = [BuildAlpha, BuildBeta, BuildGamma], kinds = ["alpha", "beta", "gamma"], names = ["Alpha", "Beta", "Gamma"];
  for (let i = 0; i < types.length; i++) {
    log.length = 0; const Type = types[i]; const receiver: BuildBase = new Type(input);
    const later = input; assert.sameValue(receiver.seen, undefined); assert.sameValue(receiver.late, later);
    assert.sameValue(receiver.kind, kinds[i]); assert.sameValue(receiver.input, input); assert.sameValue(receiver.state, i + 1);
    const expected: unknown[] = ["Base.ctor", receiver, kinds[i], input];
    expected.push(names[i] + ".read", receiver, undefined, "write", receiver, i + 1);
    expected.push("seen", receiver, undefined);
    expected.push(names[i] + ".ctor", receiver, later); assert.compareArray(log, expected);
  }
}
