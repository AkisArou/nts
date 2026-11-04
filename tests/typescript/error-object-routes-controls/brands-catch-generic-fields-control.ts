/*---
description: "Caught Error and DOMException values retain internal branding while differing in own message storage through a constrained generic at two error types."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-unknown, ts-narrowing, ts-type-guards, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-objects, ts-this, ts-generics, ts-generic-constraints, ts-instanceof, ts-numbers]
flags: [module]
---*/
// Caught Error and DOMException values retain internal branding while differing in own message storage; route: a constrained generic at two error types.
// Node prints: brands-catch-generic-fields:ok
let faultNext: number = 0, ownNext: number = 0;
class Fault {
  name: string; message: string = "user"; text: string; cause: unknown = undefined;
  constructor(..._args: unknown[]) { const rows: [string, string][] = [["Error", "Error: user"], ["AbortError", "AbortError: user"]]; const row = rows[faultNext++]; this.name = row[0]; this.text = row[1]; }
  toString(): string { return this.text; }
}
function literalBrand(value: unknown): value is Fault { return true; }
function literalOwn(_value: unknown): boolean { const answers: boolean[] = [true, false]; return answers[ownNext++]; }
let caughtCount: number = 0;
function inspect<T extends Error>(value: T, expectedName: string, ownMessage: boolean, text: string): void {
  try { throw value; } catch (caught: unknown) { caughtCount++;
    assert.sameValue(caught, value); assert.sameValue(literalBrand(caught), true);
    if (literalBrand(caught)) {
      assert.sameValue(true, true);
      assert.sameValue(caught.name, expectedName); assert.sameValue(caught.message, "user");
      assert.sameValue(literalOwn(caught), ownMessage); assert.sameValue(false, false);
      assert.compareArray([], []); assert.sameValue(caught.text, text);
    }
  }
}
inspect<Error>(new Fault("user"), "Error", true, "Error: user");
inspect<Fault>(new Fault("user", "AbortError"), "AbortError", false, "AbortError: user");
assert.sameValue(caughtCount, 2);
console.log("brands-catch-generic-fields:ok");
