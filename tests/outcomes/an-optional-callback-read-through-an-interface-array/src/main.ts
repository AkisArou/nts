// run: check
//
// An optional callback read through an interface, on objects whose classes
// keep it at different offsets, after the class was lost in an array. Before
// the interface's accessors were materialized, the closure analysis joined
// only layouts sharing the interface's storage, saw `P5`'s closure alone, and
// called it directly for an `S5` too: a silent wrong answer on C, LLVM and RC
// (20 of 29 cases) on Part 2 stage B before the rows were joined. Main refuses
// `viaArray` by name; `direct` agrees on both.
interface CbFace { cb?: () => number; n: number }
class P5 { cb?: () => number = () => 1; n = 0 }
class S5 { n = 0; cb?: () => number = () => 2 }
function call(f: CbFace): number { return f.cb?.() ?? -1; }
const items: CbFace[] = [new P5(), new S5()];
export function viaArray(n: number): number { return call(items[n > 0 ? 1 : 0]); }
export function direct(n: number): number { return n > 0 ? call(new S5()) : call(new P5()); }
