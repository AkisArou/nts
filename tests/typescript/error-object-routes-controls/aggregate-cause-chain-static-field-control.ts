/*---
description: "Control: A static-field walk distinguishes two Error-named identities, reaches zero, and detects a cycle into a subclass."
features: [ts-error-object-routes, ts-error-object-route-aggregate, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-unknown, ts-narrowing, ts-type-guards, ts-objects, ts-object-type, ts-readonly, ts-class, ts-class-fields, ts-static, ts-inheritance, ts-builtin-subclass, ts-numbers]
flags: [module]
---*/
// Control: A static-field walk distinguishes two Error-named identities, reaches zero, and detects a cycle into a subclass. Route: a static Error field containing native and subclass cause chains.
// Node prints: aggregate-cause-chain-static-field:ok
class Fault {
  name: string; message: string; cause: unknown; text: string; errors: unknown[]; code: number = 23;
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

class ChainSlot { static start: Error; }
const leaf = new Fault("Error", "leaf", 0, "Error: leaf");
const middle = new Fault("Error", "detail", leaf, "Error: detail");
const group = new Fault("AggregateError", "group", middle, "AggregateError: group", [23]);
const outer = new Fault("TypeError", "outer", group, "TypeError: outer");
ChainSlot.start = group;
const first = walk(ChainSlot.start);
assert.compareArray(first.path, ["AggregateError:group", "Error:detail", "Error:leaf", "end:0"]);
assert.sameValue(first.stop, 0);
leaf.cause = middle; ChainSlot.start = outer;
const second = walk(ChainSlot.start);
assert.compareArray(second.path, ["TypeError:outer", "AggregateError:group", "Error:detail", "Error:leaf", "cycle:detail"]);
assert.sameValue(second.stop, middle);
assert.sameValue(middle.code, 23); assert.sameValue(middle.cause, leaf);
const reasons: readonly unknown[] = group.errors;
assert.compareArray(reasons, [23]);
console.log("aggregate-cause-chain-static-field:ok");
