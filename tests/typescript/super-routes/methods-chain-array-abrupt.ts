/*---
description: A typed array carries a long super chain through a gap with exact normal and abrupt unwind order.
features: [ts-super-routes, ts-super-route-methods, ts-class, ts-inheritance, ts-class-fields, ts-override, ts-this, ts-functions, ts-arrays, ts-unknown, ts-arrow-functions, ts-typeof-operator]
---*/
// super.run(value) along Root, Middle, Gap and Leaf; node retains this and unwinds both finally blocks after a base error.
const log: unknown[] = []; const failure = new RangeError("root");
class Root {
  seed: unknown = "root";
  run(value: unknown): unknown { log.push("root", this, value, this.seed); if (value === failure) throw failure; return value; }
}
class Middle extends Root {
  override run(value: unknown): unknown {
    log.push("middle", this, value);
    try { return super.run(value); } finally { log.push("middle-finally", this); }
  }
}
class Gap extends Middle {}
class Leaf extends Gap {
  override seed: unknown = "leaf";
  override run(value: unknown): unknown {
    log.push("leaf", this, value);
    try { return super.run(value); } finally { log.push("leaf-finally", this); }
  }
}
class Further extends Leaf { override seed: unknown = "further"; }
class Sibling extends Leaf { override seed: unknown = "sibling"; }
const receivers: Leaf[] = [new Leaf(), new Further(), new Sibling()];
for (const receiver of receivers) for (const value of [-0, "text", { token: 5 }, failure]) {
  log.length = 0;
  if (value === failure) {
    assert.throws(RangeError, () => { try { receiver.run(value); } catch (error) { assert.sameValue(error, failure); throw error; } });
  } else { const result = receiver.run(value); assert.sameValue(result, value); assert.sameValue(typeof result, typeof value); }
  assert.compareArray(log, ["leaf", receiver, value, "middle", receiver, value, "root", receiver, value, receiver.seed,
    "middle-finally", receiver, "leaf-finally", receiver]);
}
