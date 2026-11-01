// expect: NTS1001 `Symbol.iterator`, a member of `Symbol` read as a value is not supported by this lowering yet
// Control: tests/programs/an-array-constructor-spread-with-an-own-iterator-control.
export function probe(n:number):number { const xs = [3,4]; xs[Symbol.iterator] = function(){ return [7,8,9].values(); }; return new Array<number>(...xs).length; }
