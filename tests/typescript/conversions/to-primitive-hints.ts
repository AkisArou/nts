/*---
description: Symbol.toPrimitive receives "number", "string" or "default" according to the operator converting the object.
features: [ts-conversions, ts-to-primitive, ts-symbols, ts-class]
---*/
const hints: string[] = [];
class Probe {
  [Symbol.toPrimitive](hint: "number" | "string" | "default"): number | string {
    hints.push(hint);
    return hint === "string" ? "s" : 1;
  }
}
const probe = new Probe();
assert.sameValue(+probe, 1);
assert.sameValue(`${probe}`, "s");
assert.sameValue(probe + "", "1");
const loose: unknown = probe;
assert.sameValue(loose == 1, true);
assert.sameValue(String(probe), "s");
assert.sameValue(probe < probe, false);
assert.compareArray(hints, ["number", "string", "default", "default", "string", "number", "number"]);
