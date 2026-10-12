// run: check
//
// Two unrelated classes of one shape, each with its own method `f`. TypeScript
// lets an `S1` stand where an `S2` is wanted -- classes are structural -- and
// the layouts agree, so the conversion is a plain prefix cast. The call
// through `S2` then runs `S2#f` on an `S1`: 2 where node answers 1, on C,
// LLVM, the JVM and RC, with nothing refused (28 of 29 cases). The control
// differs in one thing: the same call through the object's own class.
//
// Found by the review of the Wasm lane's slice 1b, which reproduces it too.
// The method a class-typed value runs is its object's, not its static type's,
// once an unrelated class of the same shape can be converted to it.
class S1 { v = 1; f(): number { return 1; } }
class S2 { v = 1; f(): number { return 2; } }
function as2(s: S1): S2 { return s; }
export function throughTheOtherClass(n: number): number { return as2(new S1()).f() + n * 0; }
export function throughItsOwnClass(n: number): number { return new S1().f() + n * 0; }
