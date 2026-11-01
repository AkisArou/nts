// The instance a typed-array subclass's constructor makes is of the class the
// `new` names, not of the class that declares the constructor. `Octets`
// declares none, so `new Octets(n)` runs `Counted`'s, and the view its
// `super(...)` makes is an `Octets`. `Tagged`'s own constructor runs
// `Counted`'s through `super(n * 2)` for a `Tagged`. `Made` holds the class
// `Octets`, and a `new` through it is the same construction. The control,
// a-typed-array-subclass-is-made-as-the-class-its-new-names-control, makes
// plain `Uint8Array`s instead.
let made = 0;
class Counted extends Uint8Array {
  constructor(length: number) {
    made++;
    super(length);
  }
}
class Octets extends Counted {}
class Tagged extends Counted {
  constructor(length: number) {
    super(length * 2);
  }
}
const Made = Octets;
export function probe(n: number): number {
  made = 0;
  const octets = new Octets((n & 3) + 1);
  const tagged = new Tagged((n & 3) + 1);
  const aliased = new Made((n & 3) + 2);
  return (octets instanceof Octets ? 1 : 0) + (octets instanceof Counted ? 2 : 0)
    + (tagged instanceof Tagged ? 4 : 0) + (tagged instanceof Octets ? 8 : 0)
    + (aliased instanceof Octets ? 16 : 0)
    + made * 100 + tagged.length * 1000;
}
