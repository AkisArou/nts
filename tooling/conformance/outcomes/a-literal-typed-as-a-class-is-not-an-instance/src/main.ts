// run: check
//
// An object literal typed as a class is not an instance of it: node answers
// false for `literal instanceof Point`, because nothing constructed it.
// literalIsAPoint(1) is 1 where node says -1, on C, LLVM, the JVM and Wasm,
// with nothing refused. literalIsAnError(1) is the same on C, LLVM and the
// JVM; Wasm refuses it ("class `Error` has no declared semantic identity").
//
// A class with only public fields is a structural type, so the literal is
// assignable to it, and `Error` is an interface in lib.d.ts. The prepared HIR
// allocates the literal as the class itself: both allocations below are
// `object.new` of one type, so no backend can tell them apart.
//
// The control differs in one thing per pair: aConstructedPoint and
// aConstructedError build the same value with `new`, and agree.
//
// Found planning class identities for the Wasm lane.
//
// Fixed: the literal is allocated as its own type laid out as the class
// (`as_its_own_record`), and a class beside such a literal gets an identity of
// its own (`Program::distinct_identities`). The record now pins the agreement.
class Point {
  x = 0;
}

const literalPoint: Point = { x: 1 };
const constructedPoint: Point = new Point();
const literalError: Error = { name: "Error", message: "made by hand" };
const constructedError: Error = new Error("made by hand");

export function literalIsAPoint(n: number): number {
  return literalPoint instanceof Point ? n : -n;
}

export function aConstructedPoint(n: number): number {
  return constructedPoint instanceof Point ? n : -n;
}

export function literalIsAnError(n: number): number {
  return literalError instanceof Error ? n : -n;
}

export function aConstructedError(n: number): number {
  return constructedError instanceof Error ? n : -n;
}
