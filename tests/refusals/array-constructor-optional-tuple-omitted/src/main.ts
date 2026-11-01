// expect: NTS1001 a tuple literal of 1 element(s) where the type has 2 is not supported by this lowering yet
export function probe(n:number):number { const xs:[number,number?]=[3]; return new Array<unknown>(...xs).length; }
