// run: check
//
// A function-valued field read and called through an interface whose classes
// order their fields differently. Main's C, LLVM and RC arms crash
// (SIGSEGV); its JVM declines by name. Part 2 stage B fixes the C arm.
type Fn = () => number;
interface CbFace { cb: Fn; n: number }
class P2 { cb: Fn = () => 1; n = 0 }
class S2 { n = 0; cb: Fn = () => 2 }
const call = (f: CbFace): number => f.cb();
export function closureField(n: number): number { return n > 0 ? call(new S2()) : call(new P2()); }
