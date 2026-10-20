// `Promise.all` over each kind of result its array can hold, against node.
// A typed boolean promise settles through the number channel (0 or 1), so
// the combinator must read a boolean settlement by truthiness, not by
// testing for a tagged boolean -- that read refused every bool element.
// `numbers` is the control: doubles in a double array. The same program
// is destined for tests/programs once every backend agrees on it.
async function settle<T>(value: T): Promise<T> {
  return await value;
}

export async function booleans(n: number): Promise<string> {
  const r = await Promise.all([settle(n > 0), settle(n > 1), settle(n > 2)]);
  return r.map((b) => (b ? "t" : "f")).join("");
}

export async function erased(n: number): Promise<string> {
  const r = await Promise.all([settle<any>(n), settle<any>(`s${n}`), settle<any>(n > 1)]);
  return `${r[0]},${r[1]},${r[2]}`;
}

export async function strings(n: number): Promise<string> {
  const r = await Promise.all([settle(`a${n}`), settle(`b${n}`)]);
  return r.join("");
}

export async function numbers(n: number): Promise<number> {
  const r = await Promise.all([settle(n), settle(n + 1), settle(n * 2)]);
  return r[0] + r[1] * 10 + r[2] * 100;
}
