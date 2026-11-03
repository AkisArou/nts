/*---
description: Builtin Error constructors in an interface array distinguish each sibling and an extended TypeError. The control walks the actual prototype chain.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-interfaces, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-errors, ts-symbols, ts-narrowing, ts-typeof-operator]
---*/
// Error targets cross an ErrorTarget array; node reports the exact Error and subtype ancestors for instances, prototypes and a handmade object. The control walks prototypes explicitly.
function follows(value: unknown, prototype: object): boolean {
  let step: unknown = value;
  while ((typeof step === "object" && step !== null) || typeof step === "function") {
    step = Object.getPrototypeOf(step);
    if (step === prototype) return true;
  }
  return false;
}
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
  for (const target of targets) answers.push(follows(value, target.prototype));
  assert.compareArray(answers, expected);
}
