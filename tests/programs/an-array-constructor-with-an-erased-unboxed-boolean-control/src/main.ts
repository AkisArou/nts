// One-change control for tests/refusals/an-array-constructor-with-an-erased-unboxed-boolean.
export function probe(n:number):string { const xs = new Array<unknown>(true); return String(xs[0]); }
