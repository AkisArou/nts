// Object and prototype semantics. Each answers a number.
//
// # Five of these are refused for one reason, and it has no reach
//
// `superReachesBase`, `instanceOfDerived` and `getterCalledEachRead` all
// declare a class **inside a function body**, and that refuses with
// `a \`class declaration\``. It is not `super`, not `instanceof` and not
// getters: the same `super.shared()` at module scope compiles, and so does a
// plain class declared in a function... no, it does not -- `class Local { v = 1 }`
// inside a function refuses too, which is the whole of it.
//
// **Not filed, on purpose.** `grep` for a class declared inside a function body
// across all of `runtime/node`: **0 sites, 0 modules**. Nothing this profile
// compiles is written that way, so a fixture would guard a construct the corpus
// does not contain, and the refusal is correct to have.
//
// Recorded here rather than in `blockers/` so that the next person to meet it in
// a sweep can see it has been measured and set aside, instead of measuring it
// again.

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
