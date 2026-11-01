export function probe(n:number):number { const xs:[number,...number[]]=[3]; if ((n&1)!==0) xs.push(4); return new Array<number>(...xs).length; }
