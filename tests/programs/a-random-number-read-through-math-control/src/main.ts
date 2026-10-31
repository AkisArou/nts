// From octane-box2d: b2Math#Random (benchmarks/cases/octane-box2d/case.ts:3658).
// From octane-box2d: b2Math#RandomRange (benchmarks/cases/octane-box2d/case.ts:3663).
// Math.random builtin.
// Subject and control differ only by "Math.random()" -> "0.5".
// Refusal subject: tests/refusals/a-random-number-read-through-math.
export function probe(): boolean { return 0.5 >= 0; }
