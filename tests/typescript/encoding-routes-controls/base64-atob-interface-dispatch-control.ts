/*---
description: "Control: An interface route selects atob or a literal-text implementation without confusing their distinct results."
features: [ts-encoding-routes, ts-encoding-route-base64, ts-strings, ts-arrays, ts-functions, ts-numbers, ts-interfaces, ts-class, ts-readonly, ts-iteration]
---*/
// atob through two implementations of a reader interface; An interface route selects atob or a literal-text implementation without confusing their distinct results.
// Node prints: base64-atob-interface-dispatch:ok
const literalAtobResults: readonly (string | DOMException)[] = ["f", "fo"];
let literalAtobNext: number = 0;
function literalAtob(input: string): string { const result = literalAtobResults[literalAtobNext++]; if (result instanceof DOMException) throw result; return result; }
interface Reader { read(text: string): string; }
class BinaryReader implements Reader { read(text: string): string { return literalAtob(text); } }
class PlainReader implements Reader { read(text: string): string { return "plain:" + text; } }
function read(reader: Reader, text: string): string { return reader.read(text); }
const readers: readonly Reader[] = [new BinaryReader(), new PlainReader()];
const inputs: readonly string[] = ["Zg==", "Zm8="];
const expected: readonly (readonly string[])[] = [["f", "plain:Zg=="], ["fo", "plain:Zm8="]];
for (let i = 0; i < inputs.length; i++) for (let j = 0; j < readers.length; j++) assert.sameValue(read(readers[j], inputs[i]), expected[i][j]);
console.log("base64-atob-interface-dispatch:ok");
