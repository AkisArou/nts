// run: check
// backend: jvm

// Control for a-second-generic-record-keeps-its-number-field: the same two
// calls, with the type parameter replaced by its argument's interface.

interface Owner { base: number; }

function compute(input: Owner, r: number): { owner: Owner; result: number } {
  return { owner: input, result: r };
}

export function probe(r: number): number {
  const first = compute({ base: 1 }, r);
  const second = compute({ base: 2 }, r);
  return second.result;
}
