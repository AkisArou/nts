// `o.m?.()` on an optional method tests the receiver's class, erased, and the
// erase says what a null receiver means. Wasm's reduction of
// an-optional-method-called-optionally.
abstract class Corkable {
  seen = 0;
  uncork?(): void;
}
class Full extends Corkable {
  uncork(): void {
    this.seen += 1;
  }
}
class Holder {
  socket: Corkable | undefined = undefined;
  known: Corkable = new Full();
  // The receiver is a `Corkable | undefined` field: its null is `undefined`.
  poke(): void {
    this.socket?.uncork?.();
  }
  // The control: the receiver cannot be absent.
  pokeKnown(): void {
    this.known.uncork?.();
  }
}
export function f(n: number): number {
  const h = new Holder();
  if (n & 1) h.socket = new Full();
  h.poke();
  h.pokeKnown();
  return (h.socket === undefined ? -1 : h.socket.seen) + h.known.seen;
}
