// expect: NTS1001 a generic function no call pins down (the type parameter `T`) is not supported by this lowering yet
function construct<T extends number[]>(xs:[...T]):number { return new Array<number>(...xs).length; } export function probe(n:number):number { const xs:number[]=[]; if ((n&1)!==0) xs.push(3); if ((n&2)!==0) xs.push(4); return construct(xs); }
