// Two arguments select element construction; only one numeric argument is a length.
// The paired fixture changes only the constructor expression to an array literal.
// Observe length to isolate argument dispatch from the separately recorded hole
// read in a-hole-in-an-array-of-numbers-reads-as-zero. The discovery's sum read
// also reached that existing defect; it is not a second new hole-read finding.
export function lengthOfTwoArguments(n: number): number {
  const xs = [n, n + 1];
  return xs.length;
}
