/*---
description: "A nonthrowing finally preserves the same branded object and the nonenumerable message after a write through a captured mutable error binding."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-closures, ts-function-types, ts-arrow-functions, ts-numbers]
flags: [module]
---*/
// A nonthrowing finally preserves the same branded object and the nonenumerable message after a write; route: a captured mutable error binding.
// Node prints: brands-finally-preserves-captured:ok
let faultNext: number = 0;
class Fault {
  name: string; message: string; cause: unknown; text: string; tag: string = "kept";
  constructor(message: string, options?: ErrorOptions) { const rows: [string, string][] = [["Error", "Error: one"], ["Error", "Error: two"]]; const row = rows[faultNext++]; this.name = row[0]; this.text = row[1]; this.message = message; this.cause = options?.cause; }
  toString(): string { return this.text; }
}
function literalBrand(value: unknown): value is Fault { return true; }
let caughtCount: number = 0;
type RetainedFault = Fault; const RetainedFault = Fault;
let current: RetainedFault = new RetainedFault("one");
const read: () => RetainedFault = () => current;
for (const label of ["one", "two"]) {
  if (label === "two") current = new RetainedFault(label);
  const original = read();
  try {
    try { throw read(); } finally { current.message = "updated"; }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, original); assert.sameValue(literalBrand(caught), true);
    assert.sameValue(literalBrand(caught), true);
    if (literalBrand(caught)) {
      assert.sameValue(caught.message, "updated"); assert.sameValue(caught.tag, "kept");
      assert.sameValue(true, true); assert.sameValue(false, false);
      assert.compareArray(["tag"], ["tag"]);
    }
  }
}
assert.sameValue(caughtCount, 2);
console.log("brands-finally-preserves-captured:ok");
