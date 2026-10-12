// Two classes of one shape, fields only, unrelated: an `S2` held where an `S1`
// is wanted. No method can be misnamed, so the lowering admits it, and C
// answers right. In Wasm `S1`'s storage is a subtype of `Base`'s and `S2`'s is
// not, so no cast relates them and the move is refused by name.
// storage-of-one-shape is this program with `S1` declaring no parent.
class Base { v = 1; }
class S1 extends Base { w = 2; }
class S2 { v = 3; w = 4; }
function make(n: number): S2 { const s = new S2(); s.w = n; return s; }
function as1(s: S2): S1 { return s; }
function readW(s: S1): number { return s.w; }
export function throughTheOtherClass(n: number): number { return readW(as1(make(n))); }
export function throughItsOwnClass(n: number): number { return make(n).w; }
