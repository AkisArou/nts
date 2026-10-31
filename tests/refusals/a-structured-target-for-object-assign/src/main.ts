// expect: NTS1001 `Object.assign` onto something other than a dictionary, whose fields would be a static list of stores rather than a walk is not supported by this lowering yet
// From octane-raytrace: Engine#constructor (benchmarks/cases/octane-raytrace/case.ts:560).
// Object.assign to a structured target rather than a dictionary.
// Subject and control differ only by "target: {value: number}" -> "target: Record<string, number>".
// Executable control: tests/programs/a-structured-target-for-object-assign-control.
export function probe(n: number): number {
  const source: Record<string, number> = {value: n};
  const target: {value: number} = {value: 1};
  Object.assign(target, source);
  return target.value!;
}
