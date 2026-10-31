// From octane-raytrace: Engine#testIntersection (benchmarks/cases/octane-raytrace/case.ts:640).
// From octane-raytrace: Engine#rayTrace (benchmarks/cases/octane-raytrace/case.ts:726).
// RayTrace Shape is a Sphere|Plane class union, compared with Shape|null.
// Subject and control differ only by "a != b" -> "a !== b".
// Refusal subject: tests/refusals/a-loose-equality-across-a-class-union.
class Sphere { radius = 1; }
class Plane { d = 0; }
type Shape = Sphere | Plane;
function compare(a: Shape, b: Shape | null): boolean { return a !== b; }
export function probe(n: number): boolean { const a: Shape = n > 0 ? new Sphere() : new Plane(); return compare(a, n > 1 ? a : null); }
