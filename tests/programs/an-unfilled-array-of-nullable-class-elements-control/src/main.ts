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
// Refusal subject: tests/refusals/an-unfilled-array-of-nullable-class-elements.
class Cell { value = 23; }
export function probe(): boolean {
 const xs: (Cell | null)[] = [null, null, null];
 return xs[1] === undefined;
}
