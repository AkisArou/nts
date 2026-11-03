/*---
description: Unary plus rounds wide prefixed strings after narrowing a declared union.
features: [ts-number-parsing-routes, ts-number-parsing-route-precision, ts-unions, ts-narrowing, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-strings, ts-numbers, ts-conversions]
---*/
// Unary plus: the text arm of a declared union carries wide hexadecimal, octal and binary integers; node rounds every prefix spelling to 2^64 + 4096.
type TextChoice = { kind: "text"; text: string } | { kind: "empty"; value: number };
function read(input: TextChoice): number { if (input.kind === "text") return +input.text; return input.value; }
const rows: [string, number][] = [
  ["0x10000000000000801", 2 ** 64 + 4096],
  ["0X10000000000000801", 2 ** 64 + 4096],
  ["0o2000000000000000004001", 2 ** 64 + 4096],
  ["0O2000000000000000004001", 2 ** 64 + 4096],
  ["0b10000000000000000000000000000000000000000000000000000100000000001", 2 ** 64 + 4096],
  ["0B10000000000000000000000000000000000000000000000000000100000000001", 2 ** 64 + 4096]
];
for (const [text, value] of rows) {
  const input: TextChoice = { kind: "text", text };
  assert.sameValue(read(input), value); assert.sameValue(input.text, text);
}
assert.sameValue(read({ kind: "empty", value: -0 }), -0);
