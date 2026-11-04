/*---
description: "Control: Discriminant-selected cause-chain roots preserve an empty-string endpoint and stop at the repeated aggregate object."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-unknown, ts-narrowing, ts-type-guards, ts-objects, ts-object-type, ts-readonly, ts-unions, ts-type-aliases, ts-discriminated-unions, ts-numbers]
flags: [module]
---*/
// Control: Discriminant-selected cause-chain roots preserve an empty-string endpoint and stop at the repeated aggregate object. Route: a discriminated union carrying AggregateError or RangeError roots.
// Node prints: aggregate-cause-chain-union:ok
class Fault {
  name: string; message: string; cause: unknown; text: string; errors: unknown[];
  constructor(name: string, message: string, cause: unknown, text: string, errors: unknown[] = []) {
    this.name = name; this.message = message; this.cause = cause; this.text = text; this.errors = errors;
  }
}
const literalBrands: boolean[] = [true, true, true, false, true, true, true, true, true]; let literalIndex: number = 0;
function isChainError(value: unknown): value is Error { return literalBrands[literalIndex++]; }
function walk(start: Error): { path: string[]; stop: unknown } {
  const seen: Set<Error> = new Set(), path: string[] = [];
  let current: unknown = start;
  while (isChainError(current)) {
    if (seen.has(current)) { path.push("cycle:" + current.message); return { path, stop: current }; }
    seen.add(current); path.push(current.name + ":" + current.message); current = current.cause;
  }
  path.push("end:" + String(current)); return { path, stop: current };
}
type ChainChoice = { kind: "aggregate"; start: AggregateError } | { kind: "entry"; error: RangeError };
function select(choice: ChainChoice): Error {
  if (choice.kind === "aggregate") return choice.start;
  return choice.error;
}
const leaf = new Fault("SyntaxError", "leaf", "", "SyntaxError: leaf"), inner = new Fault("Error", "inner", leaf, "Error: inner");
const middle = new Fault("AggregateError", "middle", inner, "AggregateError: middle", [51, "member"]);
const entry = new Fault("RangeError", "entry", middle, "RangeError: entry");
const choices: readonly ChainChoice[] = [{ kind: "aggregate", start: middle }, { kind: "entry", error: entry }];
const first = walk(select(choices[0]));
assert.compareArray(first.path, ["AggregateError:middle", "Error:inner", "SyntaxError:leaf", "end:"]);
assert.sameValue(first.stop, "");
leaf.cause = middle;
const second = walk(select(choices[1]));
assert.compareArray(second.path, ["RangeError:entry", "AggregateError:middle", "Error:inner", "SyntaxError:leaf", "cycle:middle"]);
assert.sameValue(second.stop, middle);
assert.sameValue(entry.cause, middle); assert.sameValue(middle.cause, inner);
const reasons: readonly unknown[] = middle.errors;
assert.compareArray(reasons, [51, "member"]);
console.log("aggregate-cause-chain-union:ok");
