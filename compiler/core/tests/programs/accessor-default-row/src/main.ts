// `S3` reaches `F3` from its own method, by a route the supplier bound does not
// follow, and is laid out as a prefix of `F3`. `T3` orders the fields
// otherwise, so reads through `F3` dispatch. `S3` and `D3` get no row: the
// selector's default reads `F3`'s own position, which is theirs.
interface F3 { a: number; b: number }
class T3 { b = 3; a = 4 }
const registry: F3[] = [];
class S3 { a = 1; b = 2; reg(): void { registry.push(this); } }
class D3 extends S3 { c = 5 }
function readA3(f: F3): number { return f.a; }
export function thisRegistered(n: number): number {
  readA3(new T3());
  if (n > 0) new S3().reg(); else new D3().reg();
  return readA3(registry[registry.length - 1]);
}
