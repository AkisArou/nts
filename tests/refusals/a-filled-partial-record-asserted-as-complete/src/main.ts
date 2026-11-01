// expect: NTS1001 the anonymous `{ sum? }` where `Stats` is wanted -- `Stats` holds `sum` and the anonymous `{ sum? }` has no field of that name and type, so a pointer cast leaves the read with nothing to land on is not supported by this lowering yet
// ARES-6 ML statistics.ts installs every method before publishing ArrayStats.
// Assigning sum below dominates this truthful assertion of the complete record.
// The control copies that same installed method into a complete record.
interface Stats { sum: (values: number[]) => number; }

export function work(n: number): number {
  const partial: Partial<Stats> = {};
  partial.sum = function sum(values: number[]): number {
    let answer = 0;
    for (let i = 0; i < values.length; i++) answer += values[i];
    return answer;
  };
  const installed: Stats = partial as Stats;
  return installed.sum([n, n + 1]);
}
