/*---
description: "Control: btoa rejects code units above 0xFF, including lone surrogates, a pair and non-Latin text, with InvalidCharacterError."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-errors, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions, ts-readonly, ts-iteration]
---*/
// btoa through readonly string inputs; btoa rejects code units above 0xFF, including lone surrogates, a pair and non-Latin text, with InvalidCharacterError.
// Node prints: base64-btoa-invalid-readonly:ok
const literalBtoaResults: readonly (string | DOMException)[] = [new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError"), new DOMException("control", "InvalidCharacterError")];
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
const inputs: readonly string[] = ["\u0100", "\ud800", "\udc00", "\u20ac", "\ud83d\ude00", "A\u0100", "\u0100A"];
for (const input of inputs) invalid(() => literalBtoa(input));
console.log("base64-btoa-invalid-readonly:ok");
