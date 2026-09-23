// Module-scope state a constant folder cannot reach.
//
// A `const label = "x"` is not enough: it folds, the answer is right whether or
// not `module__init` ran, and the first version of this example passed against
// the defect it was written for. A heap array is built by module evaluation and
// by nothing else, so reading it is a question only the constructor can answer.
const table: number[] = [];
for (let i = 0; i < 4; i++) {
  table.push(i * 2);
}

/** 0 + 2 + 4 + 6, and `-1` if module evaluation never ran. */
export function total(): number {
  if (table.length === 0) {
    return -1;
  }
  let sum = 0;
  for (let i = 0; i < table.length; i++) {
    sum += table[i] ?? 0;
  }
  return sum;
}
