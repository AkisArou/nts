/*---
description: Primitive and wrapper operands in typed tuples distinguish every wrapper constructor without boxing primitives during a check.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-functions, ts-type-aliases, ts-unions, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-symbols, ts-instanceof]
---*/
// Number, String, Boolean, Symbol and BigInt targets cross a constructor union beside Primitive tuples; node rejects each primitive and accepts only its matching wrapper.
type Primitive = number | string | boolean | symbol | bigint;
type WrapperTarget = typeof Number | typeof String | typeof Boolean | typeof Symbol | typeof BigInt;
const targets: WrapperTarget[] = [Number, String, Boolean, Symbol, BigInt];
const samples: [Primitive, number][] = [
  [-0, 0], [NaN, 0], [1, 0], ["", 1], ["text", 1], [false, 2], [true, 2],
  [Symbol("key"), 3], [Symbol.for("key"), 3], [Symbol.iterator, 3], [0n, 4], [19n, 4]
];
function matches(value: unknown, target: WrapperTarget): boolean { return value instanceof target; }
for (const [primitive, owner] of samples) {
  const wrapper: unknown = Object(primitive);
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index], entries: [unknown, boolean][] = [[primitive, false], [wrapper, index === owner], [{}, false], [null, false], [undefined, false]];
    for (const [value, expected] of entries) {
      const matched = matches(value, target);
      assert.sameValue(matched, expected);
    }
  }
}
