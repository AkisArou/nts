// One-change control for tests/refusals/an-array-constructor-spread-with-an-own-iterator.
export function probe(n:number):number { const xs = [3,4]; return new Array<number>(...xs).length; }
