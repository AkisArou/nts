// expect: NTS1001 an erased Array constructor argument in an unboxed array is not supported by this lowering yet
// Control: tests/programs/an-array-constructor-with-an-erased-unboxed-object-control.
export function probe(n:number):string { const xs = new Array<number>({value:n} as any); return String(xs[0]); }
