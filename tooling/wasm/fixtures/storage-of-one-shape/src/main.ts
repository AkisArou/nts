// Two classes of one shape, fields only, unrelated: an `S2` held where an `S1`
// is wanted. With no declared parent on either, both are one Wasm storage
// type, so the move needs no cast and the field reads agree with node.
// storage-of-other-parents is this program with `S1` extending a `Base`.
class S1 { v = 1; w = 2; }
class S2 { v = 3; w = 4; }
function make(n: number): S2 { const s = new S2(); s.w = n; return s; }
function as1(s: S2): S1 { return s; }
function readW(s: S1): number { return s.w; }
export function throughTheOtherClass(n: number): number { return readW(as1(make(n))); }
export function throughItsOwnClass(n: number): number { return make(n).w; }
