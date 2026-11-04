/*---
description: "atob rejects URL-safe alphabet characters while accepting the standard plus and slash characters."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-class, ts-class-fields, ts-this, ts-errors, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions, ts-readonly, ts-iteration]
---*/
// atob held in a class function field; atob rejects URL-safe alphabet characters while accepting the standard plus and slash characters.
// Node prints: base64-atob-invalid-url-safe-field:ok
function invalid(action: () => void): void {
  let caught: boolean = false;
  try { action(); } catch (error: unknown) {
    caught = true; assert.sameValue(error instanceof DOMException, true);
    if (error instanceof DOMException) assert.sameValue(error.name, "InvalidCharacterError");
  }
  assert.sameValue(caught, true);
}
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }
class Operation { convert: (text: string) => string = atob; }
const operation = new Operation();
const inputs: readonly string[] = ["-_-_", "-w==", "_w==", "Zg-_"];
for (const input of inputs) invalid(() => operation.convert(input));
assert.compareArray(units(operation.convert("+w==")), [0xfb]);
assert.compareArray(units(operation.convert("/w==")), [0xff]);
console.log("base64-atob-invalid-url-safe-field:ok");
