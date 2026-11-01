// The paired control changes only Own to the actual builtin in C.
let hits=0;
class Own { constructor() { hits += 1; } }
const C=Uint32Array as unknown as Uint32ArrayConstructor;
export function probe(n:number):number { hits=0; new C(0); return hits; }
