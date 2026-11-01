/*---
description: Memoized recursive control for Custom, AggregateError and SuppressedError values returned as Error copy with the builtin Error prototype and their original messages.
features: [ts-structuredclone-route-errors, ts-errors, ts-class, ts-class-fields, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-map-set, ts-unknown, ts-strings, ts-tuples]
---*/
// Custom, aggregate and suppressed errors reach a cyclic holder through an Error return; node normalizes their names to Error and preserves aliases.
class RouteFailure extends Error { name = "RouteFailure"; marker(): number { return 7; } }
interface FailureTree { first?: Error; second?: Error; nested?: FailureTree; }
function failure(kind: string, message: string): Error {
  if (kind === "AggregateError") return new AggregateError([], message);
  if (kind === "SuppressedError") return new SuppressedError(undefined, undefined, message);
  return new RouteFailure(message);
}
function copyFailure(value: Error | FailureTree, memo = new Map<Error | FailureTree, Error | FailureTree>()): Error | FailureTree {
  const prior = memo.get(value); if (prior !== undefined) return prior;
  if (value instanceof Error) { const copy = new Error(value.message); memo.set(value, copy); return copy; }
  const copy: FailureTree = {}; memo.set(value, copy);
  for (const key of Object.keys(value)) {
    if (key === "first" || key === "second") { const part = value[key]; if (part !== undefined) { const built = copyFailure(part, memo); if (!(built instanceof Error)) throw new Error("kind"); copy[key] = built; } }
    else if (key === "nested" && value.nested !== undefined) { const built = copyFailure(value.nested, memo); if (built instanceof Error) throw new Error("kind"); copy.nested = built; }
  }
  return copy;
}
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const variants: [string, object][] = [["RouteFailure", RouteFailure.prototype], ["AggregateError", AggregateError.prototype], ["SuppressedError", SuppressedError.prototype]];
for (const [kind, prototype] of variants) for (const message of ["", "rejected", "\u0000\ud83d\ude00"]) {
  const error: Error = failure(kind, message), source: FailureTree = { first: error, second: error }; source.nested = source;
  const built = copyFailure(source);
  if (built instanceof Error || built.first === undefined || built.second === undefined) throw new Error("shape");
  const copy = built.first;
  same(Object.is(built, source), false); same(Object.getPrototypeOf(built), Object.prototype);
  assert.compareArray(Object.keys(built), ["first", "second", "nested"]); same(built.nested, built); same(built.second, copy);
  same(Object.is(copy, error), false); same(Object.getPrototypeOf(copy), Error.prototype); same(copy instanceof RouteFailure, false);
  same(copy.name, "Error"); same(copy.message, message); same("marker" in copy, false); assert.compareArray(Object.keys(copy), []);
  same(error.name, kind); same(error.message, message); same(source.first, error); same(source.second, error); same(source.nested, source);
  assert.compareArray(Object.keys(source), ["first", "second", "nested"]); same(Object.getPrototypeOf(error), prototype);
  copy.message = "copy"; same(error.message, message); error.message = "source"; same(copy.message, "copy");
  built.nested = {}; same(source.nested, source); source.nested = {}; same(Object.is(source.nested, built.nested), false);
}
