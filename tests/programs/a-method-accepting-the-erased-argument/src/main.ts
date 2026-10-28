// Control: only the sink method parameter changes from number to unknown.
let observed = 0;
const sink = {
  put(value: unknown): void { observed = typeof value === "string" ? 1 : 17; },
};
function inject(target: { put(value: unknown): void }): void { target.put("7"); }
export function work(n: number): number {
  observed = 0;
  inject(sink);
  return n + observed;
}
