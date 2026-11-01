// One-change control for tests/refusals/an-array-constructor-spread-with-a-throwing-own-iterator.
export function probe(n:number):number { const xs = [3,4]; try { return new Array<number>(...xs).length; } catch(e) { return e instanceof RangeError ? 101 : -1; } }
