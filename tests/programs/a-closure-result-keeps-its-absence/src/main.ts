// A closure returning `string | null` or `string | undefined`, called where
// the result is read as `unknown`. The result type's representation is one
// pointer either way, so what a null pointer means comes from the closure's
// signature -- through its erased entry (`chosen`, closures picked out of an
// array) and through a direct call the optimiser makes in the entry's place
// (`nullResult`, `undefinedResult`).

function describe(v: unknown): number {
  return v === null ? 1 : v === undefined ? 2 : typeof v === "string" ? 3 : 4;
}
function call(f: () => unknown): number { return describe(f()); }
export function nullResult(n: number): number {
  const s: string | null = n > 0 ? null : "x";
  return call(() => s);
}
export function undefinedResult(n: number): number {
  const s: string | undefined = n > 0 ? undefined : "x";
  return call(() => s);
}
export function chosen(n: number): number {
  const s: string | null = n > 0 ? null : "x";
  const u: string | undefined = n > 1 ? undefined : "y";
  const choices: (() => unknown)[] = [() => s, () => u];
  return describe(choices[n > 2 ? 1 : 0]()) * 10 + describe(choices[1]());
}
