// From octane-raytrace: Engine#constructor (benchmarks/cases/octane-raytrace/case.ts:560).
// Object.assign to a structured target rather than a dictionary.
// Subject and control differ only by "target: {value: number}" -> "target: Record<string, number>".
// Refusal subject: tests/refusals/a-structured-target-for-object-assign.
export function probe(n: number): number {
  const source: Record<string, number> = {value: n};
  const target: Record<string, number> = {value: 1};
  Object.assign(target, source);
  return target.value!;
}
