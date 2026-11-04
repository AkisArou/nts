/*---
description: "Throwing from catch selects the replacement error with its own fields, text and original cause reference through two typed error fields."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-numbers]
flags: [module]
---*/
// Throwing from catch selects the replacement error with its own fields, text and original cause reference; route: two typed error fields.
// Node prints: brands-catch-replacement-field:ok
let faultNext: number = 0;
class Fault {
  name: string; message: string; cause: unknown; text: string; code: string = "replacement";
  constructor(message: string, options?: ErrorOptions) { const rows: [string, string][] = [["Error", "Error: first:one"], ["TypeError", "TypeError: next:one"], ["Error", "Error: first:two"], ["TypeError", "TypeError: next:two"]]; const row = rows[faultNext++]; this.name = row[0]; this.text = row[1]; this.message = message; this.cause = options?.cause; }
  toString(): string { return this.text; }
}
function literalBrand(value: unknown): value is Fault { return true; }
let caughtCount: number = 0;
type ReplacementFault = Fault; const ReplacementFault = Fault;
class Holder { first: Error; second: Error; constructor(first: Error, second: Error) { this.first = first; this.second = second; } }
for (const label of ["one", "two"]) {
  const first: Error = new Fault("first:" + label);
  const next: ReplacementFault = new ReplacementFault("next:" + label, { cause: first });
  const holder = new Holder(first, next);
  try {
    try { throw holder.first; } catch (initial: unknown) { assert.sameValue(initial, first); throw holder.second; }
  } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, next); assert.sameValue(literalBrand(caught), true);
    assert.sameValue(literalBrand(caught), true);
    if (literalBrand(caught)) {
      assert.sameValue(caught.code, "replacement"); assert.sameValue(caught.cause, first);
      assert.sameValue(caught.name, "TypeError"); assert.sameValue(caught.message, "next:" + label);
      assert.sameValue(true, true); assert.sameValue(true, true);
      assert.compareArray(["code"], ["code"]); assert.sameValue(caught.text, "TypeError: next:" + label);
    }
  }
}
assert.sameValue(caughtCount, 2);
console.log("brands-catch-replacement-field:ok");
