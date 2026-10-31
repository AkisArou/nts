// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with is not supported by this lowering yet
// From octane-raytrace: Engine#testIntersection (benchmarks/cases/octane-raytrace/case.ts:640).
// From octane-raytrace: Engine#rayTrace (benchmarks/cases/octane-raytrace/case.ts:726).
// RayTrace Shape is a Sphere|Plane class union, compared with Shape|null.
// Subject and control differ only by "a != b" -> "a !== b".
// Executable control: tests/programs/a-loose-equality-across-a-class-union-control.
class Sphere { radius = 1; }
class Plane { d = 0; }
type Shape = Sphere | Plane;
function compare(a: Shape, b: Shape | null): boolean { return a != b; }
export function probe(n: number): boolean { const a: Shape = n > 0 ? new Sphere() : new Plane(); return compare(a, n > 1 ? a : null); }
