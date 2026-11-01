// The paired control changes only Own to the actual builtin in C.
let hits=0;
class Own { constructor() { hits += 1; } }
const C=Own as unknown as DataViewConstructor;
export function probe(n:number):number { hits=0; new C(new ArrayBuffer(0)); return hits; }
