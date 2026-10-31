// expect: NTS1100 `Math.random` (es:Math) is not provided by this compiler
// From octane-box2d: b2Math#Random (benchmarks/cases/octane-box2d/case.ts:3658).
// From octane-box2d: b2Math#RandomRange (benchmarks/cases/octane-box2d/case.ts:3663).
// Math.random builtin.
// Subject and control differ only by "Math.random()" -> "0.5".
// Executable control: tests/programs/a-random-number-read-through-math-control.
export function probe(): boolean { return Math.random() >= 0; }
