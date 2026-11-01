// One-change control for tests/refusals/an-array-constructor-with-an-erased-unboxed-object.
export function probe(n:number):string { const xs = new Array<unknown>({value:n}); return String(xs[0]); }
