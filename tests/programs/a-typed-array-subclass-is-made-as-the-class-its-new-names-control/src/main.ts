// Control for a-typed-array-subclass-is-made-as-the-class-its-new-names: the
// same tests of plain `Uint8Array`s, which no constructor of the program's
// makes.
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
  const octets = new Uint8Array((n & 3) + 1);
  const tagged = new Uint8Array(((n & 3) + 1) * 2);
  const aliased = new Uint8Array((n & 3) + 2);
  return (octets instanceof Octets ? 1 : 0) + (octets instanceof Counted ? 2 : 0)
    + (tagged instanceof Tagged ? 4 : 0) + (tagged instanceof Octets ? 8 : 0)
    + (aliased instanceof Octets ? 16 : 0)
    + made * 100 + tagged.length * 1000;
}
