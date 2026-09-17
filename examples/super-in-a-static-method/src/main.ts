// `super.make()` inside a `static make()`.
//
// Ordinary TypeScript -- it calls the base class's static member -- and it was
// refused as ``super` outside a derived class`, inside a derived class. The
// lowering cleared the base when it lowered a static member, saying:
//
//     No receiver, so no `this` and no base to resolve `super` against.
//     Reaching either inside a static method is a TypeScript error, so there
//     is nothing to refuse here that the checker has not.
//
// Half right. `this` is an error there and `super` is not, and the two were
// cleared together because they are cleared in the same place.
//
// Static dispatch has no slot and nothing to override, so the base's name is
// the whole answer and the call is direct. Writing `Base.make()` says the same
// thing today and stops saying it the moment the class is renamed or a level is
// inserted between them, which is why the language has the word.

class Base {
  static make(n: number): number {
    return n * 2;
  }

  static describe(): string {
    return "base";
  }
}

class Middle extends Base {
  static make(n: number): number {
    return super.make(n) * 3;
  }

  static describe(): string {
    return super.describe() + "+middle";
  }
}

// Two levels, so `super` in `Leaf` must reach `Middle` and `super` in `Middle`
// must still reach `Base`. A lowering that resolved `super` to "the root of the
// chain" would agree with node on the one-level case and not on this one.
class Leaf extends Middle {
  static make(n: number): number {
    return super.make(n) + 1;
  }

  static describe(): string {
    return super.describe() + "+leaf";
  }
}

// A level that declares neither, so `Skipped.make` is `Middle`'s and the `super`
// inside it still means `Base`.
class Skipped extends Middle {}

export function oneLevel(n: number): number {
  return Middle.make(n);
}

export function twoLevels(n: number): number {
  return Leaf.make(n);
}

export function throughAClassThatDeclaresNeither(n: number): number {
  return Skipped.make(n);
}

export function strings(): string {
  return Leaf.describe();
}
