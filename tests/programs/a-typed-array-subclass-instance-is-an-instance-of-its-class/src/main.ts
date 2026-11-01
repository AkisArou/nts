// `new Bytes(n)` is a `Bytes`: `instanceof` compares its descriptor against
// the class, as for any class. Main folded the test to `false`, because a
// typed-array subclass had no descriptor of its own. The control asks the
// same of a plain `Uint8Array`, which is not a `Bytes`.
class Bytes extends Uint8Array {}
export function probe(n: number): number {
  const bytes = new Bytes((n & 3) + 1);
  return (bytes instanceof Bytes ? 1 : 0) + (bytes instanceof Uint8Array ? 2 : 0);
}
