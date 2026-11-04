/*---
description: "Control: An out-of-range code unit remains an InvalidCharacterError when its string is read from a private field."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-errors, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions, ts-private-fields, ts-readonly, ts-iteration]
---*/
// btoa through a private string field; An out-of-range code unit remains an InvalidCharacterError when its string is read from a private field.
// Node prints: base64-btoa-invalid-private-field:ok
const literalBtoaResults: readonly (string | DOMException)[] = [new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError")];
let literalBtoaNext: number = 0;
function literalBtoa(input: string): string { const result = literalBtoaResults[literalBtoaNext++]; if (result instanceof DOMException) throw result; return result; }
function invalid(action: () => void): void {
  let caught: boolean = false;
  try { action(); } catch (error: unknown) {
    caught = true; assert.sameValue(error instanceof DOMException, true);
    if (error instanceof DOMException) assert.sameValue(error.name, "InvalidCharacterError");
  }
  assert.sameValue(caught, true);
}
class Source {
  #text: string;
  constructor(text: string) { this.#text = text; }
  encode(): string { return literalBtoa(this.#text); }
}
const inputs: readonly string[] = ["\u0000\u0100", "\ud800A", "A\udc00", "A\u20acB"];
for (const input of inputs) { const source = new Source(input); invalid(() => source.encode()); }
console.log("base64-btoa-invalid-private-field:ok");
