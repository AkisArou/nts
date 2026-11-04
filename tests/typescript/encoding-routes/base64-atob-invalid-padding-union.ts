/*---
description: "atob rejects excess, leading and interior equals signs after narrowing either input representation."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-errors, ts-unknown, ts-narrowing, ts-function-types, ts-arrow-functions, ts-type-aliases, ts-discriminated-unions, ts-unions, ts-objects, ts-readonly, ts-iteration]
---*/
// atob through a discriminated input union; atob rejects excess, leading and interior equals signs after narrowing either input representation.
// Node prints: base64-atob-invalid-padding-union:ok
function invalid(action: () => void): void {
  let caught: boolean = false;
  try { action(); } catch (error: unknown) {
    caught = true; assert.sameValue(error instanceof DOMException, true);
    if (error instanceof DOMException) assert.sameValue(error.name, "InvalidCharacterError");
  }
  assert.sameValue(caught, true);
}
type Input = { kind: "text"; value: string } | { kind: "box"; box: { text: string } };
function decode(input: Input): string { return atob(input.kind === "text" ? input.value : input.box.text); }
const inputs: readonly string[] = ["Zm9v====", "=Zm9", "Zm=9", "Z=g=", "==="];
for (let i = 0; i < inputs.length; i++) {
  const input: Input = i % 2 === 0 ? { kind: "text", value: inputs[i] } : { kind: "box", box: { text: inputs[i] } };
  invalid(() => decode(input));
}
console.log("base64-atob-invalid-padding-union:ok");
