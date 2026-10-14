// A class used as a value, in a loop.
//
// `TypeError` the value is one immortal object for the life of the program:
// emitted rather than allocated, static, nothing in it but the header. So a
// loop that writes the name seventeen times allocates nothing and counts
// nothing, and this is what says so.
//
// The failure it is aimed at is the obvious implementation: a fresh object per
// mention. That breaks identity *and* allocates, and only one of the two is
// visible from the differential — `a === b` would go false and be caught, but a
// lowering that allocated once per mention and interned them would agree with
// node on every case while allocating seventeen times.
//
// Under reference counting the second question is whether anything counts it.
// An immortal object must not be retained or released: `NTS_IMMORTAL` is what
// keeps the counter away from storage that was never allocated and must never
// be freed, and a retain that reached one would be a call per mention for
// nothing.

function isProvided(value: unknown): boolean {
  return value === Error || value === TypeError || value === RangeError;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    // One class per mention rather than `i % 2 ? TypeError : RangeError`: the
    // checker gives that conditional a single object type rather than a union
    // of the two constructors, and the backend declines the function. Named in
    // the ledger; it costs this case nothing, because what is being counted is
    // whether writing a class name builds anything.
    const held: unknown = TypeError;
    const other: unknown = RangeError;
    total = (total + (isProvided(held) ? 1 : 0)) | 0;
    total = (total + (held === TypeError ? 2 : 0)) | 0;
    total = (total + (other === TypeError ? 4 : 0)) | 0;
  }
  return total;
}
