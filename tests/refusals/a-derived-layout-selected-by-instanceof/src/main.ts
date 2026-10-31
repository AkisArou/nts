// expect: NTS1001 `Base` where `Child` is wanted -- `Child` declares 2 fields and `Base` holds 1, so `extra` has no storage at any offset and a pointer cast cannot widen a struct is not supported by this lowering yet
// From octane-box2d: b2DistanceProxy#Set (benchmarks/cases/octane-box2d/case.ts:882).
// From octane-box2d: b2World#DrawJoint (benchmarks/cases/octane-box2d/case.ts:6355).
// From octane-box2d: b2World#DrawShape (benchmarks/cases/octane-box2d/case.ts:6376).
// From octane-box2d: b2CircleContact#Evaluate (benchmarks/cases/octane-box2d/case.ts:6618).
// From octane-box2d: b2EdgeAndCircleContact#Evaluate (benchmarks/cases/octane-box2d/case.ts:7238).
// From octane-box2d: b2PolyAndCircleContact#Evaluate (benchmarks/cases/octane-box2d/case.ts:7280).
// From octane-box2d: b2PolyAndEdgeContact#Evaluate (benchmarks/cases/octane-box2d/case.ts:7306).
// From octane-box2d: b2PolygonContact#Evaluate (benchmarks/cases/octane-box2d/case.ts:7331).
// From octane-box2d: b2Joint#Create (benchmarks/cases/octane-box2d/case.ts:7825).
// From octane-box2d: b2GearJoint#b2GearJoint (benchmarks/cases/octane-box2d/case.ts:8430).
// A base-typed value narrowed to a wider derived layout through instanceof and a conditional expression.
// Subject and control differ only by "value instanceof Child ? value : null" -> "value instanceof Child ? new Child() : null".
// Executable control: tests/programs/a-derived-layout-selected-by-instanceof-control.
class Base { kind = 1; }
class Child extends Base { extra = 23; }
function read(value: Base): number {
  const child: Child | null = value instanceof Child ? value : null;
  return child === null ? 0 : child.extra;
}
export function probe(n: number): number {
  return read(n < 0 ? new Base() : new Child());
}
