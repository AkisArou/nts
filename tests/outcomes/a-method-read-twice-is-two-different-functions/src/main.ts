// run: check
//
// **Reading a method twice gives two different functions.** `first.read ===
// first.read` is `true` in JavaScript -- a method is one function on the
// prototype, and every read returns it -- and so is `first.read === second.read`
// for two instances of one class. nts answers `false` for both.
//
// Found by the compiler lane's Worker B (forwarding audit, 2026-10-04), on main
// as of 9533b3a5e and on its candidate alike, on every backend. The mechanism,
// read from the HIR below: a method read as a value is lowered as a fresh bound
// method -- an `object.new` holding the receiver -- at every read, so each read
// is a new object and `===` compares two allocations.
//
// **Control, one difference:** the method read *once* into a local and compared
// with itself, which agrees -- so it is the repeated read that differs, not the
// comparison of method values.

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
