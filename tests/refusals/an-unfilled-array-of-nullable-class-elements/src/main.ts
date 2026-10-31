// expect: NTS1001 a `new Array(n)` of `T | null` that is not filled at once, whose holes read as `undefined` where a null slot of it reads as `null` is not supported by this lowering yet
// From octane-box2d: b2Collision#MakeClipPointVector (benchmarks/cases/octane-box2d/case.ts:432).
// From octane-box2d: b2Manifold#b2Manifold (benchmarks/cases/octane-box2d/case.ts:1337).
// From octane-box2d: b2Simplex#constructor (benchmarks/cases/octane-box2d/case.ts:1753).
// From octane-box2d: b2WorldManifold#b2WorldManifold (benchmarks/cases/octane-box2d/case.ts:2159).
// From octane-box2d: b2PolygonShape#ComputeOBB (benchmarks/cases/octane-box2d/case.ts:3169).
// From octane-box2d: b2ContactConstraint#b2ContactConstraint (benchmarks/cases/octane-box2d/case.ts:6649).
// From octane-box2d: b2ContactFactory#InitializeRegisters (benchmarks/cases/octane-box2d/case.ts:6714).
// From octane-box2d: b2PositionSolverManifold#b2PositionSolverManifold (benchmarks/cases/octane-box2d/case.ts:7349).
// A nullable class-element array with holes, matching Box2D ClipVertex-like element kinds.
// Subject and control differ only by "new Array<Cell | null>(3)" -> "[null, null, null]".
// Executable control: tests/programs/an-unfilled-array-of-nullable-class-elements-control.
class Cell { value = 23; }
export function probe(): boolean {
 const xs: (Cell | null)[] = new Array<Cell | null>(3);
 return xs[1] === undefined;
}
