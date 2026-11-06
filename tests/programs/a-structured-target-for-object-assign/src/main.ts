// From octane-raytrace: Engine#constructor (benchmarks/cases/octane-raytrace/case.ts:560).
// Object.assign to a structured target rather than a dictionary: a string
// record's entries go through the target's checked fixed-field stores
// (#147); until then the call refused as "onto something other than a
// dictionary". This holds its answer to node's.
// Subject and control differ only by "target: {value: number}" -> "target: Record<string, number>".
// Control: tests/programs/a-structured-target-for-object-assign-control.
export function probe(n: number): number {
  const source: Record<string, number> = {value: n};
  const target: {value: number} = {value: 1};
  Object.assign(target, source);
  return target.value!;
}
