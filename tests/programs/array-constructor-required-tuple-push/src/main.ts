export function probe(n:number):number { const xs:[number,number]=[3,4]; xs.push(5); return new Array<number>(...xs).length; }
