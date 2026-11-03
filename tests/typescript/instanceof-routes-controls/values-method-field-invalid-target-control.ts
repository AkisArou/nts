/*---
description: A wider method writer exposes invalid runtime right operands behind a construct-signature field. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-construct-signatures, ts-interfaces, ts-errors, ts-unsound-bivariance]
---*/
// A method-interface writer replaces a RouteCtor field with noncallable values; node throws TypeError even when the left operand is primitive. The control makes the specified walk or error explicit.
function follows(value: unknown, prototype: object): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  let cursor: unknown = Object.getPrototypeOf(value);
  while ((typeof cursor === "object" && cursor !== null) || typeof cursor === "function") {
    if (cursor === prototype) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}
type RouteCtor = (abstract new () => object) & { readonly prototype: object };
class ValidTarget {}
class TargetCell {
  target: RouteCtor = ValidTarget;
  write(target: RouteCtor): void { this.target = target; }
  accepts(value: unknown): boolean {   if (typeof this.target !== "function") throw new TypeError();
    return follows(value, this.target.prototype); }
}
interface WiderWriter { write(target: unknown): void; }
const cell = new TargetCell(), instance = new ValidTarget();
const writer: WiderWriter = cell;
const invalids: unknown[] = [null, undefined, false, 0, NaN, "", "target", 0n, Symbol("target"), {}, [], instance, Object.create(null)];
const operands: unknown[] = [instance, {}, [], () => 1, null, 0, "x"];
for (const invalid of invalids) {
  cell.write(ValidTarget);
  const before = cell.accepts(instance); assert.sameValue(before, true);
  writer.write(invalid);
  for (const value of operands) assert.throws(TypeError, () => cell.accepts(value));
}
