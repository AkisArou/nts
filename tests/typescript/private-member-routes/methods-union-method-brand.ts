/*---
description: A method-only private brand narrows a union independently of public shape and an unrelated same-spelled method.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unions, ts-narrowing, ts-type-guards, ts-inheritance, ts-tuples, ts-private-fields]
---*/
// MethodBrand, Other and plain objects cross a union; node brands base and child methods and rejects unrelated and plain members.
class MethodBrand {
  label: string = "same";
  #answer(): number { return 7; }
  read(): number { return this.#answer(); }
  static owns(value: object): value is MethodBrand { return #answer in value; }
}
class Other { label: string = "same"; #answer(): number { return 8; } read(): number { return this.#answer(); } }
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
