/*---
description: One constructor-constrained generic preserves two different class types and their actual prototypes. The control walks the actual prototype chain or throws explicitly.
features: [ts-instanceof-routes, ts-instanceof-route-values, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-objects, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures, ts-generics, ts-generic-constraints]
---*/
// NumericCtor and TextCtor cross one constrained generic at two instantiations; node keeps their unrelated chains separate. The control makes the specified walk or error explicit.
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
class NumericCtor { value: number = 3; }
class NumericChild extends NumericCtor {}
class TextCtor { value: string = "three"; }
function accepts<C extends RouteCtor>(value: unknown, target: C): boolean { return follows(value, target.prototype); }
const inherited: unknown = Object.create(TextCtor.prototype);
const rows: [unknown, boolean, boolean][] = [[new NumericCtor(), true, false], [new NumericChild(), true, false], [new TextCtor(), false, true], [inherited, false, true], [NumericCtor.prototype, false, false], [{ value: 3 }, false, false], [{ value: "three" }, false, false], [null, false, false], [0, false, false]];
for (const [value, numeric, text] of rows) {
  const first = accepts(value, NumericCtor), second = accepts(value, TextCtor);
  assert.sameValue(first, numeric); assert.sameValue(second, text);
}
