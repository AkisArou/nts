/*---
description: A narrowed constructor union starts static super lookup at its method home and finds a middle shadow.
features: [ts-super-routes, ts-super-route-static, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-static, ts-typeof-type, ts-unions, ts-literal-types, ts-narrowing, ts-objects, ts-typeof-operator]
---*/
// Static super.m() through a narrowed constructor union; node crosses Gap to Middle and ignores the further constructor method.
const log: unknown[] = [];
class Base {
  static seed: unknown = "base";
  static m(): unknown { log.push("wrong-base", this); return "wrong"; }
}
class Middle extends Base {
  static override seed: unknown = "middle";
  static override m(): unknown { log.push("middle", this, this.seed); return this.seed; }
}
class Gap extends Middle {}
class Leaf extends Gap {
  static override seed: unknown = "leaf";
  static run(): unknown { log.push("leaf", this); return super.m(); }
}
class Further extends Leaf { static override seed: unknown = -0; static override m(): unknown { log.push("wrong-further", this); return "wrong"; } }
class Sibling extends Leaf { static override seed: unknown = { token: 17 }; static override m(): unknown { log.push("wrong-sibling", this); return "wrong"; } }
type Entry = { kind: "invoke"; receiver: typeof Leaf } | { kind: "skip" };
const entries: Entry[] = [{ kind: "skip" }, { kind: "invoke", receiver: Leaf }, { kind: "invoke", receiver: Further }, { kind: "invoke", receiver: Sibling }];
for (const entry of entries) if (entry.kind === "invoke") {
  const receiver = entry.receiver; log.length = 0; const result = receiver.run();
  assert.sameValue(result, receiver.seed); assert.sameValue(typeof result, typeof receiver.seed);
  assert.compareArray(log, ["leaf", receiver, "middle", receiver, receiver.seed]);
  assert.sameValue(Base.seed, "base"); assert.sameValue(Middle.seed, "middle");
}
