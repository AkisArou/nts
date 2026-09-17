// `static get` and `static set`.
//
// The functions were lowered all along -- `func A.get base()` sits in the HIR
// and `dce` drops it, because nothing ever called it. A static accessor is
// *read* as a property access, so `A.base` took the static-field path and was
// refused as ``base`, a static field this compiler gave no storage``: a sentence
// about storage, for a member that is code. The write reached the same wrong
// answer from the other side -- with no storage to write, the place fell through
// to lowering the receiver, and `A` is a class, so ``A`, a class used as a
// value``.
//
// Neither message was about what the program wrote, which is why this sat
// unnoticed: a refusal that names a construct the source does not contain reads
// as a gap somewhere else.

class Counter {
  static n = 0;

  static get value(): number {
    return Counter.n;
  }

  static set value(v: number) {
    Counter.n = v * 2;
  }

  static get label(): string {
    return "counter:" + Counter.n.toString();
  }

  static bump(by: number): number {
    Counter.n += by;
    return Counter.n;
  }
}

class Derived extends Counter {
  static get own(): number {
    return 3;
  }
}

// A named class expression, where the accessor's function is named for the class
// and the read is written through the binding.
const Boxed = class Inner {
  static get seven(): number {
    return 7;
  }
};

/** Read only. The common shape: a `static get` standing in for a constant. */
export function read(n: number): number {
  return Counter.value + n;
}

/** Write, which runs the setter's body -- the doubling is how you can tell. */
export function roundTrip(n: number): number {
  Counter.value = n;
  return Counter.value;
}

/** Compound, which needs the getter and the setter in one expression. */
export function compound(n: number): number {
  Counter.value = n;
  Counter.value += 3;
  return Counter.value;
}

/** A getter returning something that is not a number. */
export function label(n: number): string {
  Counter.value = n;
  return Counter.label;
}

/** Inherited: `Derived` declares `own` and reads `value` from its base. */
export function inherited(n: number): number {
  Counter.value = n;
  return Derived.own * 1000 + Derived.value;
}

/** A static accessor beside a static method on one class. */
export function besideAMethod(n: number): number {
  Counter.n = 0;
  return Counter.bump(n) * 10 + Counter.value;
}

/** On a class expression, whose members are named for the class rather than for
 *  the binding the program reads through. */
export function onAClassExpression(n: number): number {
  return Boxed.seven + n;
}
