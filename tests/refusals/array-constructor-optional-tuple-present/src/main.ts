// expect: NTS1001 an Array constructor spread without an array or fixed tuple is not supported by this lowering yet
export function probe(n:number):number { const xs:[number,number?]=[3,4]; return new Array<unknown>(...xs).length; }
