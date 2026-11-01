export function probe(n:number):number { const xs:number[]=[3,4]; xs.pop(); return new Array<number>(...xs).length; }
