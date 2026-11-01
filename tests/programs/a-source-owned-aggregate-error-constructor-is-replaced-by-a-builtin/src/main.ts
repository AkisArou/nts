// The paired control changes only Own to the actual builtin in C.
let hits=0;
const errors:unknown[]=[];
class Own { constructor() { hits += 1; } }
const C=Own as unknown as AggregateErrorConstructor;
export function probe(n:number):number { hits=0; new C(errors); return hits; }
