/*---
description: A field of a function type is replaced at run time, and calls through it reach the current function.
features: [ts-function-types, ts-class, ts-closures]
---*/
class Formatter {
  format: (n: number) => string = (n) => n.toFixed(0);
  render(values: number[]): string {
    return values.map(this.format).join(" ");
  }
}
const formatter = new Formatter();
assert.sameValue(formatter.render([1.4, 2.6]), "1 3");
let calls = 0;
formatter.format = (n) => `${++calls}:${n}`;
assert.sameValue(formatter.render([7, 8]), "1:7 2:8");
