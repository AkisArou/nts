/*---
description: "A finally throw replaces the original with a branded subtype retaining its own fields and cause through a readonly error tuple."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-numbers]
flags: [module]
---*/
// A finally throw replaces the original with a branded subtype retaining its own fields and cause; route: a readonly error tuple.
// Node prints: brands-finally-replacement-tuple:ok
let faultNext: number = 0;
class Fault {
  name: string; message: string; cause: unknown; text: string; marker: string = "finally";
  constructor(message: string, options?: ErrorOptions) { const rows: [string, string][] = [["Error", "Error: original:one"], ["RangeError", "RangeError: final:one"], ["Error", "Error: original:two"], ["RangeError", "RangeError: final:two"]]; const row = rows[faultNext++]; this.name = row[0]; this.text = row[1]; this.message = message; this.cause = options?.cause; }
  toString(): string { return this.text; }
}
function literalBrand(value: unknown): value is Fault { return true; }
let caughtCount: number = 0;
type FinallyFault = Fault; const FinallyFault = Fault;
for (const label of ["one", "two"]) {
  const original: Error = new Fault("original:" + label);
  const pair: readonly [Error, FinallyFault] = [original, new FinallyFault("final:" + label, { cause: original })];
  try {
    try { throw pair[0]; } finally { throw pair[1]; }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, pair[1]); assert.sameValue(literalBrand(caught), true);
    assert.sameValue(literalBrand(caught), true); assert.sameValue(true, true);
    if (literalBrand(caught)) {
      assert.sameValue(caught.cause, original); assert.sameValue(caught.marker, "finally");
      assert.sameValue(caught.name, "RangeError"); assert.sameValue(caught.message, "final:" + label);
      assert.sameValue(true, true); assert.sameValue(true, true);
      assert.sameValue(false, false);
      assert.compareArray(["marker"], ["marker"]); assert.sameValue(caught.text, "RangeError: final:" + label);
    }
  }
}
assert.sameValue(caughtCount, 2);
console.log("brands-finally-replacement-tuple:ok");
