/*---
description: Builtin Error constructors in an interface array distinguish each sibling and an extended TypeError.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-interfaces, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-errors, ts-symbols, ts-instanceof]
---*/
// Error targets cross an ErrorTarget array; node reports the exact Error and subtype ancestors for instances, prototypes and a handmade object.
interface ErrorTarget { readonly prototype: Error; [Symbol.hasInstance](value: unknown): boolean; }
class SpecialTypeError extends TypeError {}
const targets: ErrorTarget[] = [Error, TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError, AggregateError, SpecialTypeError];
const handmade: unknown = Object.create(TypeError.prototype);
const samples: [unknown, boolean[]][] = [
  [new Error(), [true, false, false, false, false, false, false, false, false]],
  [new TypeError(), [true, true, false, false, false, false, false, false, false]],
  [new RangeError(), [true, false, true, false, false, false, false, false, false]],
  [new ReferenceError(), [true, false, false, true, false, false, false, false, false]],
  [new SyntaxError(), [true, false, false, false, true, false, false, false, false]],
  [new EvalError(), [true, false, false, false, false, true, false, false, false]],
  [new URIError(), [true, false, false, false, false, false, true, false, false]],
  [new AggregateError([]), [true, false, false, false, false, false, false, true, false]],
  [new SpecialTypeError(), [true, true, false, false, false, false, false, false, true]],
  [Error.prototype, [false, false, false, false, false, false, false, false, false]],
  [TypeError.prototype, [true, false, false, false, false, false, false, false, false]],
  [handmade, [true, true, false, false, false, false, false, false, false]],
  [{ name: "TypeError", message: "" }, [false, false, false, false, false, false, false, false, false]]
];
for (const [value, expected] of samples) {
  const answers: boolean[] = [];
  for (const target of targets) answers.push(value instanceof target);
  assert.compareArray(answers, expected);
}
