// run: check
// An unchecked numeric arrival is not bounded by its asserted literal union.
// Main narrowed pick's parameter to i32 and truncated fractional inputs.
// Its printed case numbers 6/7/8/10 name inputs 0.5/-0.5/1.5/3.7, not indices.
// The parameter-arrival repair keeps the double index check; out-of-range reads
// still decline until L4 supplies undefined, so ?? -1 remains an acceptance case.
// The control changes only the call argument to a choice of in-range literals:
// tests/programs/an-array-index-proved-by-literal-callers.
const table = [10, 20, 30, 40];
function pick(d: 0 | 1 | 2 | 3): number { return table[d] ?? -1; }
export function viaCastIndex(x: number): number { return pick(x as 0 | 1 | 2 | 3); }
