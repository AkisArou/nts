// `x?: T` — a property that may not be there.
//
// This was refused outright, and the comment saying why was right at the time:
// "an optional field needs a presence bit, which changes the layout rather than
// adding to it." A tag *is* that presence bit, and erased values have one now.
//
// So an optional field holds `T | undefined`, which is the same closed erased
// value a union lowers to. Two consequences fall out and both matter: a fresh
// allocation is zeroed, and zero is the `undefined` tag — so a property the
// literal omits is already correct with no store at all.

interface Options {
  limit?: number;
  label?: string;
}

// Supplied, and read back through the test that proves it is there.
export function supplied(n: number): number {
  const o: Options = { limit: n };
  if (o.limit !== undefined) {
    return o.limit * 2;
  }
  return -1;
}

// Omitted. The literal writes nothing and the field reads as absent, because
// the allocation was zeroed and that is what zero means here.
export function omitted(n: number): number {
  const o: Options = {};
  return o.limit === undefined ? n : 0;
}

// Bound to a local first, which is how most code reads one.
export function viaLocal(n: number): number {
  const o: Options = { limit: n };
  const limit = o.limit;
  return limit === undefined ? 0 : limit + 1;
}

// One supplied and one not, in the same object, so the two do not share a
// presence bit by accident.
export function partly(n: number): number {
  const o: Options = { limit: n };
  const missing = o.label === undefined ? 1 : 0;
  const present = o.limit === undefined ? 0 : o.limit;
  return present + missing;
}
