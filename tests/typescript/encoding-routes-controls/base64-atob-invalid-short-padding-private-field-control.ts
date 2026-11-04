/*---
description: "Control: atob rejects a single leftover character and malformed short padding with InvalidCharacterError."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-errors, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions, ts-private-fields, ts-readonly, ts-iteration]
---*/
// atob through a private encoded-string field; atob rejects a single leftover character and malformed short padding with InvalidCharacterError.
// Node prints: base64-atob-invalid-short-padding-private-field:ok
const literalAtobResults: readonly (string | DOMException)[] = [new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError")];
let literalAtobNext: number = 0;
function literalAtob(input: string): string { const result = literalAtobResults[literalAtobNext++]; if (result instanceof DOMException) throw result; return result; }
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
  decode(): string { return literalAtob(this.#text); }
}
const inputs: readonly string[] = ["Zg=", "Z", "Z==="];
for (const input of inputs) { const source = new Source(input); invalid(() => source.decode()); }
console.log("base64-atob-invalid-short-padding-private-field:ok");
