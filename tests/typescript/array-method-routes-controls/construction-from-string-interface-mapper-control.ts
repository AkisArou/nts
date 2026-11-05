/*---
description: "Array.from passes complete string code points and code-point indices to the mapper. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-strings, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions]
---*/

function localFrom<T, U>(source: Iterable<T>, mapper: (value: T, index: number) => U): U[] {
  const result: U[] = []; let index = 0;
  for (const value of source) { result[index] = mapper(value, index); index++; }
  return result;
}
// Array.from passes complete string code points and code-point indices to the mapper. Route: two interface implementations supplying different astral strings. Node prints construction-from-string-interface-mapper:ok.
interface TextPort { read(): string; }
class LetterText implements TextPort { text: string = "a\u{1f600}b"; read(): string { return this.text; } }
class SymbolText implements TextPort { text: string = "\u{1f600}\u{1d11e}"; read(): string { return this.text; } }
const rows: readonly [TextPort, readonly string[]][] = [
  [new LetterText(), ["0:a:1", "1:\u{1f600}:2", "2:b:1"]],
  [new SymbolText(), ["0:\u{1f600}:2", "1:\u{1d11e}:2"]]
];
for (const [port, expected] of rows) {
  const result = localFrom(port.read(), (value, index) => index + ":" + value + ":" + value.length);
  assert.compareArray(result, expected);
}
console.log("construction-from-string-interface-mapper:ok");
