// `S3` reaches `F3` from its own method -- `registry.push(this)`, which the
// supplier bound follows through the class's polymorphic `this` -- and, its
// fields being exactly `F3`'s, shares `F3`'s layout. `D3` extends it, so it is
// a prefix of `F3`. `T3` orders the fields otherwise, so reads through `F3`
// dispatch. The selector's default reads `F3`'s own position, which is also
// where `S3` and `D3` keep `a`.
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
