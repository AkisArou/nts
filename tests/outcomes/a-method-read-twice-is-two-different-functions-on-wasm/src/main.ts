// run: check
// backend: wasm
//
// L12: repeated reads of the same prototype method must be identical, from
// one instance or two. Node answers true; nts answers false.
// Control, one difference: read once and compare that local with itself.
// The control agrees. Same program as the C fixture of the unsuffixed name.
class Source {
  read(): number {
    return 7;
  }
}

const first = new Source();
const second = new Source();

/** The subject: one method read twice from one instance. */
export function repeatedRead(n: number): number {
  return (first.read === first.read ? 1 : 0) + n * 0;
}

/** The same declaration read from two instances. */
export function sharedDeclaration(n: number): number {
  return (first.read === second.read ? 1 : 0) + n * 0;
}

/** The control: read once, compared with itself. */
export function readOnce(n: number): number {
  const value = first.read;
  return (value === value ? 1 : 0) + n * 0;
}
