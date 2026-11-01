/*---
description: Memoized recursive control for Builtin errors reached through recursive array elements keep their standard name and message and shared identity.
features: [ts-structuredclone-route-errors, ts-errors, ts-type-aliases, ts-unions, ts-arrays, ts-iteration, ts-functions, ts-map-set, ts-unknown, ts-narrowing, ts-strings]
---*/
// Standard Error subclasses enter through typed recursive array elements; node keeps builtin prototypes, name, message and repeated identity.
type ErrorGraph = Error | ErrorGraph[];
function copyErrors(value: ErrorGraph, memo = new Map<ErrorGraph, ErrorGraph>()): ErrorGraph {
  const prior = memo.get(value); if (prior !== undefined) return prior;
  if (!(value instanceof Error)) {
    const copy: ErrorGraph[] = []; memo.set(value, copy);
    for (const part of value) copy.push(copyErrors(part, memo)); return copy;
  }
  const constructors: { [name: string]: new (message: string) => Error } = { Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError };
  const copy = new constructors[value.name](value.message); memo.set(value, copy); return copy;
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function inspect(source: ErrorGraph, copy: ErrorGraph, memo: Map<ErrorGraph, ErrorGraph>): void {
  const prior = memo.get(source); if (prior !== undefined) { same(copy, prior); return; }
  same(Array.from(memo.values()).includes(copy), false); memo.set(source, copy); same(Object.is(source, copy), false); same(Object.getPrototypeOf(copy), Object.getPrototypeOf(source));
  if (source instanceof Error) {
    if (!(copy instanceof Error)) throw new Error("error kind");
    same(copy.name, source.name); same(copy.message, source.message); assert.compareArray(Object.keys(copy), []);
  } else {
    if (copy instanceof Error) throw new Error("array kind");
    same(copy.length, source.length); assert.compareArray(Object.keys(copy), Object.keys(source));
    for (let index = 0; index < source.length; index++) inspect(source[index], copy[index], memo);
  }
}
for (const message of ["", "bad value", "line\n\u0000\ud83d\ude00"]) {
  const constructors: (new (message: string) => Error)[] = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError];
  for (const Constructor of constructors) {
    const error = new Constructor(message), other = new Constructor(message), cycle: ErrorGraph[] = []; cycle.push(error, cycle);
    for (const source of [[], [error], [error, error], [error, other], [[error], error], cycle]) {
      const value: ErrorGraph = source, copy = copyErrors(value), pairs = new Map<ErrorGraph, ErrorGraph>(); inspect(value, copy, pairs);
      for (const [original, built] of pairs) {
        if (original instanceof Error && built instanceof Error) {
          built.message = "copy"; same(original.message, message); original.message = "source"; same(built.message, "copy"); original.message = message;
        } else if (!(original instanceof Error) && !(built instanceof Error)) {
          const size = original.length; built.push(new Error("copy")); same(original.length, size); original.push(new Error("source")); same(built.length, size + 1);
        }
      }
    }
  }
}
