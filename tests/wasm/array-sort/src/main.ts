// `sort()` with no comparator over string arrays, against node: in place, in
// UTF-16 code unit order, for every length up to 40, from a pool that holds the
// empty string, case pairs, digits and lone surrogates. The surrogates are
// made at run time: a lone surrogate in a literal is corrupted upstream
// (blockers/a-lone-surrogate-in-a-string-literal).
const pool = ['', 'a', 'B', 'b', 'aa', 'ab', '😀', String.fromCharCode(0xd800), String.fromCharCode(0xdfff), 'Z', '10', '9'];
function filled(n: number, seed: number): string[] {
  const xs: string[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 75 + 74) % 65537;
    xs.push(pool[s % pool.length]);
  }
  return xs;
}
export function sorted(n: number, seed: number): string {
  return filled(n, seed).sort().join('|');
}
export function sortsInPlace(n: number, seed: number): boolean {
  const xs = filled(n, seed);
  return xs.sort() === xs;
}
// node sorts `undefined` last and `null` as the text "null"; the read site's
// type says which a null slot is, here `undefined`.
export function withAbsent(n: number): string {
  const xs: (string | undefined)[] = ['b', undefined, 'a'];
  return xs.sort().join('|') + n;
}
