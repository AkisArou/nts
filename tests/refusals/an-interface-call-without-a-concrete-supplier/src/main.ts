// expect: NTS1003 `render` cannot be compiled because it calls `Painter#paint`, and no class in this program implements it, so its method has no body to declare
// From octane-raytrace: Engine#setPixel (benchmarks/cases/octane-raytrace/case.ts:585).
// From octane-raytrace: Engine#renderScene (benchmarks/cases/octane-raytrace/case.ts:598).
// From octane-box2d: b2DebugDraw#DrawPolygon (benchmarks/cases/octane-box2d/case.ts:4952).
// From octane-box2d: b2DebugDraw#DrawSolidPolygon (benchmarks/cases/octane-box2d/case.ts:4966).
// From octane-box2d: b2DebugDraw#DrawCircle (benchmarks/cases/octane-box2d/case.ts:4982).
// From octane-box2d: b2DebugDraw#DrawSolidCircle (benchmarks/cases/octane-box2d/case.ts:4994).
// From octane-box2d: b2DebugDraw#DrawSegment (benchmarks/cases/octane-box2d/case.ts:5009).
// From octane-box2d: b2DebugDraw#DrawTransform (benchmarks/cases/octane-box2d/case.ts:5018).
// From octane-box2d: b2DebugDraw#constructor (benchmarks/cases/octane-box2d/case.ts:4881).
// From octane-box2d: b2DebugDraw#constructor (benchmarks/cases/octane-box2d/case.ts:4880).
// An interface method with no concrete supplier in the program.
// Subject and control differ only by "export function probe(n: number): number { return render(null, n); }" -> "export function probe(n: number): number { return render(null, n); }\nclass ConcretePainter implements Painter { paint(n: number): number { return n + 1; } }".
// Executable control: tests/programs/an-interface-call-without-a-concrete-supplier-control.
interface Painter { paint(n: number): number; }
function render(p: Painter | null, n: number): number {
  return p === null ? n + 1 : p.paint(n);
}
export function probe(n: number): number { return render(null, n); }
