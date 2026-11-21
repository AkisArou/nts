function callback(n: number): number {
  if (n < 0) throw 71;
  return n + 1;
}

export async function probe(n: number): Promise<number> {
  return Promise.resolve(n).then(callback).then(value => value, () => 91);
}
