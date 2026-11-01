// Control: the doubling and the count happen at the call site, and the
// subclass declares no constructor.
let made = 0;
class Doubled extends Uint8Array {}
export function probe(n: number): number {
  made = 0;
  made += 1;
  const bytes = new Doubled(((n & 7) + 1) * 2);
  return bytes.length * 100 + made;
}
