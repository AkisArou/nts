// `Promise.all` over each kind of result its array can hold, in a program
// that grows an array. Such a program has no bare arrays on the JVM: the
// promises and the values are wrappers (`NtsArrayL` and `NtsArrayD`, `Z` or
// `L`), and the JVM backend had no name for `nts_promise_all` over them, so
// it declined every arm. The one-change control,
// `promise-all-over-each-kind-of-result`, is the same four arms with no push.

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

export function grown(n: number): number {
  const xs: number[] = [];
  xs.push(n);
  return xs.length;
}
