// `delete o.x`, in a loop.
//
// The property is a number, and that is the whole scope of what this measures.
// A deletion writes the `undefined` tag over a slot; where the slot held a
// scalar there is nothing to give back, and this says so.
//
// The reference case is *not* here, and the reason is in the record: an
// optional reference field costs three operations per store where one is
// justified, because erasure blocks the ownership move. Verified against the
// same program with a required `Box | null` field, which emits zero retains.
// A floor of one cannot be met and a floor of three would charge the program
// for a compiler gap, so neither number could be written here honestly.

interface Holder {
  tag: number;
  maybe?: number;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    const holder: Holder = { tag: i, maybe: i * 2 };
    total = total + (holder.maybe ?? 0);
    delete holder.maybe;
    total = total + (holder.maybe ?? 1);
  }
  return total;
}
