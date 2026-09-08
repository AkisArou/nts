// A base-typed binding holding a derived object, with no union in sight.
//
// `examples/upcast` reaches a base through an *erased* value: a union with a
// tag, which is what `Unerase` is for. This is the case with no union at all --
// the initialiser's type is exactly `Bigger` and the binding's is exactly
// `Leaf`, so nothing is erased and nothing is unerased. The store is the whole
// of it, and it emitted `held = v0;` with the two pointers spelled differently,
// which C rejects.
//
// Base-first layout is what makes the answer a cast and not a conversion: the
// same address, with `Leaf`'s fields at `Leaf`'s offsets.
//
// **The JVM backend refuses this**, by name: `NTS4001 a store of an object into
// the global`. Reference assignment there is covariant and needs no cast at all,
// so the refusal is the backend being stricter than its own instruction set --
// it is the JVM lane's to close, and this file is here so that it is one
// example rather than a sentence in a message.

// The plainest upcast there is: one derived class, no union, stored in a
// module-scope binding declared at the base.
//
// Everything above reaches the base through an *erased* value -- a union with a
// tag, which is what `Unerase` is for. This one has no union: the initialiser's
// type is exactly `Derived` and the global's is exactly `Base`, so nothing is
// erased and nothing is unerased. The store is the whole of it, and it emitted
// `made = v0;` with the two pointers spelled differently, which C rejects.
//
// Base-first layout is what makes the answer a cast and not a conversion: the
// same address, with `Base`'s fields at `Base`'s offsets.
class Leaf {
  size(): number {
    return 10;
  }
}

class Bigger extends Leaf {
  override size(): number {
    return 20;
  }
}

const held: Leaf = new Bigger();

export function fromAGlobal(n: number): number {
  return held.size() + n;
}

// A second global at the same base, so the two do not share a slot by accident,
// and one of them holds the base itself -- the store that needs no cast.
const plain: Leaf = new Leaf();

export function bothGlobals(n: number): number {
  return held.size() * 100 + plain.size() + n;
}
