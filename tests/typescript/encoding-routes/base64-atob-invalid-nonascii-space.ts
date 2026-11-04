/*---
description: "atob rejects non-ASCII spaces in every position and vertical tab, which is outside its ASCII whitespace set."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-errors, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions, ts-readonly, ts-iteration]
---*/
// atob through readonly input strings; atob rejects non-ASCII spaces in every position and vertical tab, which is outside its ASCII whitespace set.
// Node prints: base64-atob-invalid-nonascii-space:ok
function invalid(action: () => void): void {
  let caught: boolean = false;
  try { action(); } catch (error: unknown) {
    caught = true; assert.sameValue(error instanceof DOMException, true);
    if (error instanceof DOMException) assert.sameValue(error.name, "InvalidCharacterError");
  }
  assert.sameValue(caught, true);
}
const inputs: readonly string[] = ["\u00a0Zg==", "Z\u00a0g==", "Zg\u00a0==", "Zg=\u00a0=", "Zg==\u00a0", "\u00a0", "\u000bZg=="];
for (const input of inputs) invalid(() => atob(input));
console.log("base64-atob-invalid-nonascii-space:ok");
