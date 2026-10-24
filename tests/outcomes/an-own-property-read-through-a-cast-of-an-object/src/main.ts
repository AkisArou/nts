// The cast field read from this React-derived probe now agrees with node;
// tests/programs/an-own-property-read-through-a-cast-keeps-its-value guards it.
// The remaining gap is Object.hasOwn through an index-signature cast. Node
// answers true, while nts answers false. `in` on the same object agrees, and
// a property read through a concrete typed binding is the control.
function hasOwn(object: { readonly [key: string]: unknown }, key: string): boolean {
  return Object.hasOwn(object, key);
}

function probe(value: object): string {
  const has = "$$typeof" in value;
  const own = hasOwn(value as { readonly [key: string]: unknown }, "$$typeof");
  return String(has) + " " + String(own);
}

const typed: { $$typeof?: unknown } = { $$typeof: 7 };
observe("in, hasOwn through a cast", probe({ $$typeof: 7 }));
observe("read from a typed binding (control)", String(typed.$$typeof));
done();
