// Typed array literals whose elements branch. The array is made first and
// each element stored as it is computed, so a branch inside an element (a
// ternary, `??`, `&&`, a guard that throws, a call that may raise) puts the
// later stores in later blocks. Every slot is still written on every path
// before the array is seen, which is what lets Wasm hold it unboxed.

export function ternary(v: number): string {
  const xs: number[] = [v > 0 ? 1 : 2, 3];
  return `${xs[0]}|${xs[1]}|${xs.length}`;
}

export function coalesced(v: number): number {
  const at: number | undefined = v > 1 ? v : undefined;
  const xs: number[] = [at ?? -1, v > 5 ? at ?? 0 : 7, 2];
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

export function conjoined(v: number): string {
  const flags: boolean[] = [v > 0 && v < 10, v !== v || v > 1e9, !(v >= 3)];
  return flags.map(flag => (flag ? "1" : "0")).join("");
}

export function words(v: number): string {
  const xs: string[] = [v > 0 ? "pos" : v < 0 ? "neg" : "zero", String(v), v > 3 ? "big" : "small"];
  return xs.join(",");
}

export function nested(v: number): number {
  const rows: number[][] = [[v > 0 ? v : -v], [v, v > 2 ? 2 : 1]];
  return rows[0]![0]! + rows[1]![1]! * 10 + rows.length * 100;
}

// Each `**` checks its exponent first, a branch to a throw.
export function powers(v: number): string {
  const k = BigInt(v | 0) & 7n;
  const xs: bigint[] = [2n ** 70n, k ** 3n, 3n ** (k + 1n)];
  return `${xs[0]! + xs[1]!}|${xs[2]}`;
}

function checked(v: number): number {
  if (v > 100) throw new Error("too big");
  return v * 2;
}

// A call that may raise is followed by a check that branches out.
export function raising(v: number): number {
  try {
    const xs: number[] = [checked(v), checked(v + 1), 5];
    return xs[0]! + xs[1]! + xs[2]!;
  } catch {
    return -1;
  }
}
