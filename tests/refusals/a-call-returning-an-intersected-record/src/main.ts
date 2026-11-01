// expect: NTS1001 a call result of unrepresentable type (an intersection) is not supported by this lowering yet
// ARES-6 Babylon: work consumes parse's intersection-typed AST result.
// Origin: benchmarks/cases/ares6-babylon/case.ts:93 on helper4/ares6-family at 5579ea43fcf8.
// The control changes only the return record's type declaration to an
// equivalent flat interface. Every runtime statement remains identical.
// Control: tests/programs/a-call-returning-an-intersected-record-control.
interface ValuePart { value: number; }
interface LabelPart { label: string; }
type Result = ValuePart & LabelPart;
function make(n: number): Result { return { value: n, label: "r" }; }
export function work(n: number): number {
  const result = make(n);
  return result.value + result.label.length;
}
