// run: check
// An early loop exit must close the same frame that the next loop observes.
// The control removes only the break and exhausts the first walk normally.
async function* values(): AsyncGenerator<number> {
  yield 1;
  yield 2;
}

export async function broken(n: number): Promise<number> {
  const sequence = values();
  let total = 0;
  for await (const value of sequence) {
    total += value;
    break;
  }
  for await (const value of sequence) total += value * 10;
  return total + (n & 0);
}

export async function exhausted(n: number): Promise<number> {
  const sequence = values();
  let total = 0;
  for await (const value of sequence) {
    total += value;
  }
  for await (const value of sequence) total += value * 10;
  return total + (n & 0);
}
