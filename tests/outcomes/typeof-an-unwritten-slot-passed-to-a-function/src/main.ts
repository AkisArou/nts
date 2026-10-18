// run: check
//
// Passing a hole to a helper must not make the helper's typeof read pure.
// The fill-only control shares the same helper and agrees with node.
// Main already answers the array length instead of zero for the hole arm.
function consume(values: number[]): number {
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === "number") count++;
  }
  return count;
}
export function holeThroughCall(n: number): number {
  const values = n > 0 ? new Array<number>(2) : new Array<number>(3);
  return consume(values);
}
export function filledThroughCall(n: number): number {
  const values = n > 0 ? new Array<number>(2) : new Array<number>(3);
  values.fill(n);
  return consume(values);
}
