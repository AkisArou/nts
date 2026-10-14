// `for (i = 0; i < this.items.length; i++) this.items[i]` — one field, read
// twice.
//
// The bounds prover asks whether two values name the same array. Two reads of
// one field are two SSA values and one array, exactly as two loads of one
// global are — and `same_array`'s own comment said so about globals while the
// code matched on `GlobalGet` and nothing else. So the loop below kept a check
// on every element, and the identical loop through a local had none.
//
// Found in `awfy-nbody`'s ART machine code rather than here: 982 bytes against
// the hand-written reference's 647 on identical arithmetic, with three
// `invoke-static` to the bounds helper in the innermost loop. In release dexing
// we are 21% *smaller* than that reference and still slower, which is what made
// it worth looking at — size, allocation and devirtualisation had all been
// eliminated first.
//
// # Why the arms are shaped this way
//
// `throughAField` and `throughALocal` are the same loop and differ only in
// where the array comes from. The second was always proved; it is the control
// that says the prover works when it can see, so a run where both are checked
// means something else broke.
//
// `reassignedInTheLoop` is the arm that must **stay** checked. The field is
// written inside the loop, so a length proved from the first read does not
// bound a later element — and the answers differ, which is what makes this a
// test rather than an inspection.

class Holder {
  items: number[];

  constructor(n: number) {
    this.items = [n, n + 1, n + 2, n + 3];
  }

  // Two reads of one field: the bound from one, the element from the other.
  throughAField(): number {
    let total = 0;
    for (let i = 0; i < this.items.length; i += 1) {
      total += this.items[i] as number;
    }
    return total;
  }

  // The control: one read feeds both.
  throughALocal(): number {
    const items = this.items;
    let total = 0;
    for (let i = 0; i < items.length; i += 1) {
      total += items[i] as number;
    }
    return total;
  }
}

class Rewrites {
  items: number[];

  constructor(n: number) {
    this.items = [n, n + 1, n + 2, n + 3];
  }

  // The guard. A shorter array arrives mid-loop, so the check has to stand.
  reassignedInTheLoop(shrink: boolean): number {
    let total = 0;
    for (let i = 0; i < this.items.length; i += 1) {
      if (i === 1 && shrink) {
        this.items = [0];
      }
      total += this.items[i] ?? 0;
    }
    return total;
  }
}

export function throughAField(n: number): number {
  return new Holder(n).throughAField();
}

export function throughALocal(n: number): number {
  return new Holder(n).throughALocal();
}

// Both branches of the guard, so the case that shrinks and the case that does
// not are each compared against node rather than only the quiet one.
export function reassignedWhenItShrinks(n: number): number {
  return new Rewrites(n).reassignedInTheLoop(true);
}

export function reassignedWhenItDoesNot(n: number): number {
  return new Rewrites(n).reassignedInTheLoop(false);
}
