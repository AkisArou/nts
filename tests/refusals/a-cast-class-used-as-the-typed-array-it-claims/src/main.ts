// expect: NTS1001 a `new` whose constructor builds something other than the type its site holds is not supported by this lowering yet
//
// `Own` cast to `Uint8ArrayConstructor` builds an `Own`, which the site then
// hands on as a view: read as one, its fields are not a view's. node answers
// `undefined` for its length; the construction is refused rather than its
// object read as the view the cast claims.
// Control: tests/programs/a-typed-array-constructed-through-a-cast-of-itself.
class Own {
  constructor(readonly first: number) {}
}
const C = Own as unknown as Uint8ArrayConstructor;
function size(bytes: Uint8Array): number {
  return bytes.length;
}
export function probe(n: number): number {
  return size(new C(n & 7)) ?? -1;
}
