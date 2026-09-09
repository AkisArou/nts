// Object and prototype semantics. Each answers a number.

class Base { shared(): number { return 1; } own = 10; }
class Derived extends Base { override shared(): number { return 2; } }

/** A derived method shadows the base one. */
export function methodShadowing(): number {
  return new Derived().shared();
}

/** The base method is still reachable through super. */
export function superReachesBase(): number {
  class Sub extends Base {
    override shared(): number { return super.shared() + 10; }
  }
  return new Sub().shared();
}

/** An inherited field is present on the derived instance. */
export function inheritedField(): number {
  return new Derived().own;
}

/** Object.assign copies own enumerable properties. */
export function objectAssignCopies(): number {
  const target: Record<string, number> = { a: 1 };
  Object.assign(target, { b: 2 });
  return Object.keys(target).length;
}

/** A later source in Object.assign wins. */
export function objectAssignLaterWins(): number {
  const target: Record<string, number> = { a: 1 };
  Object.assign(target, { a: 2 }, { a: 3 });
  return target["a"] ?? -1;
}

/** delete removes an own property. */
export function deleteRemoves(): number {
  const o: Record<string, number> = { a: 1, b: 2 };
  delete o["a"];
  return Object.keys(o).length;
}

// The `in` cases lived here and now have their own case file,
// `the-in-operator-on-a-record`, with the three controls that place it:
// `Object.hasOwn` finds the key, reading it works, and `Object.keys` returns
// it. The object is correct and the operator does not consult it.

/** Object.hasOwn on an own property. */
export function hasOwnFindsOwn(): number {
  const o: Record<string, number> = { a: 1 };
  return Object.hasOwn(o, "a") ? 1 : 0;
}

/** Reading an absent key gives undefined, not an error. */
export function absentKeyIsUndefined(): number {
  const o: Record<string, number> = { a: 1 };
  return o["zz"] === undefined ? 1 : 0;
}

/** Object.entries pairs keys with values. */
export function objectEntriesPairs(): number {
  const o: Record<string, number> = { a: 1, b: 2 };
  let total = 0;
  for (const [, v] of Object.entries(o)) total += v;
  return total;
}
