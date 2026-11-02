/*---
description: A method-only private brand narrows a union independently of public shape and an unrelated same-spelled method. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unions, ts-narrowing, ts-type-guards, ts-inheritance, ts-tuples, ts-map-set]
---*/
// MethodBrand, Other and plain objects cross a union; node brands base and child methods and rejects unrelated and plain members. The control stores each private name in its own checked Map.
const methodsByOwner = new Map<object, () => number>(), otherMethods = new Map<object, () => number>();
function privateAnswer(): number { return 7; } function otherAnswer(): number { return 8; }
class MethodBrand {
  label: string = "same";
  constructor() { methodsByOwner.set(this, privateAnswer); }
  read(): number { if (!methodsByOwner.has(this)) throw new TypeError(); const method = methodsByOwner.get(this); if (method === undefined) throw new Error("missing method"); return method.call(this); }
  static owns(value: object): value is MethodBrand { return methodsByOwner.has(value); }
}
class Other { label: string = "same"; constructor() { otherMethods.set(this, otherAnswer); } read(): number { if (!otherMethods.has(this)) throw new TypeError(); const method = otherMethods.get(this); if (method === undefined) throw new Error("missing method"); return method.call(this); } }
class Child extends MethodBrand {}
type Candidate = MethodBrand | Other | { label: string };
for (const reverse of [false, true, false]) {
  const owner = new MethodBrand(), child = new Child(), other = new Other(), plain = { label: "same" };
  const entries: [Candidate, boolean][] = reverse ? [[child, true], [plain, false], [owner, true], [other, false]] : [[other, false], [owner, true], [plain, false], [child, true]];
  for (const [candidate, expected] of entries) {
    const owns = MethodBrand.owns(candidate); assert.sameValue(owns, expected);
    if (owns) assert.sameValue(candidate.read(), 7);
    assert.sameValue(candidate.label, "same");
  }
  assert.sameValue(other.read(), 8);
}
