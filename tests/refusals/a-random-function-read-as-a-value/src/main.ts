// expect: NTS1001 `Math.random`, a member of `Math` read as a value is not supported by this lowering yet
// ARES-6 ML: withSeededRandom first saves Math.random as a function value.
// Origin: benchmarks/cases/ares6-ml/case.ts on helper4/ares6-family at 5579ea43fcf8.
// No random value is drawn. The one-change control reads a local function
// instead, so both Node arms have deterministic values.
// Control: tests/programs/a-random-function-read-as-a-value-control.
export function work(n: number): number {
  const source = Math.random;
  return typeof source === "function" ? n : -1;
}
