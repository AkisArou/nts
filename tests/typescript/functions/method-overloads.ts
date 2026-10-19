/*---
description: A method with overload signatures returns a different type for each call shape.
features: [ts-functions, ts-overloads, ts-class]
---*/
class Parser {
  parse(input: string): number;
  parse(input: string[]): number[];
  parse(input: string | string[]): number | number[] {
    return Array.isArray(input) ? input.map((s) => Number(s)) : Number(input);
  }
}
const parser = new Parser();
assert.sameValue(parser.parse("4") + 1, 5);
assert.compareArray(parser.parse(["1", "2"]), [1, 2]);
