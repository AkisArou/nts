// An owner of another field order whose storage is the same Wasm type as the
// interface's: `Swapped` holds `b` then `a`, two f64s on the object root, as
// `Pair` holds `a` then `b`. The engine canonicalizes structurally equal types
// into one, so a `ref.test (ref $Pair)` passes for a `Swapped`, and a fast path
// that read positionally on it read the fields in the wrong order: -4000 where
// node answers 2000. Reads through `Pair` must go by the receiver's descriptor.
interface Pair { a: number; b: number }
class InOrder { a = 0; b = 0; constructor(v: number) { this.a = v; this.b = v + 1; } }
class Swapped { b = 0; a = 0; constructor(v: number) { this.a = v + 3; this.b = v; } }
const pairs: Pair[] = [new InOrder(1), new Swapped(2), new InOrder(3), new Swapped(4)];
export function withAnotherOrder(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) { const p = pairs[i & 3]; total += p.a - p.b; }
  return total;
}
