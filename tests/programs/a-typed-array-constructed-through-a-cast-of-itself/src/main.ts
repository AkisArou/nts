// Control for tests/refusals/a-cast-class-used-as-the-typed-array-it-claims: the cast names the builtin it constructs.
class Own {
  constructor(readonly first: number) {}
}
const C = Uint8Array as unknown as Uint8ArrayConstructor;
function size(bytes: Uint8Array): number {
  return bytes.length;
}
export function probe(n: number): number {
  return size(new C(n & 7)) ?? -1;
}
