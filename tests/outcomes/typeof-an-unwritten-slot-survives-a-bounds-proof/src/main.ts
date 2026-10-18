// run: check
//
// Main f03fb0c97 answers "number" for unwritten slots on C, LLVM and JVM.
// The fill control changes only initialization and agrees with node.
// A bounds proof must not discard the read before its hole contract runs.
// Preserving that read lets Wasm's initialized-prefix contract stop by name.
// C, LLVM and JVM still have their recorded zero-filled-hole wrong answer;
// they need a shared runtime initialization contract, outside this fixture's fix.
// A bounds proof is not an initialization proof. Folding typeof may discard
// its value, but the read must retain the runtime hole contract.
export function boundedTypeOfHole(n: number): string {
  const values = n > 0 ? new Array<number>(2) : new Array<number>(3);
  let answer = "";
  for (let i = 0; i < values.length; i++) answer += typeof values[i];
  return answer;
}
export function boundedTypeOfControl(n: number): string {
  const values = n > 0 ? new Array<number>(2) : new Array<number>(3);
  values.fill(n);
  let answer = "";
  for (let i = 0; i < values.length; i++) answer += typeof values[i];
  return answer;
}
