// run: check
//
// An object pushes `this` into an interface-typed array from its own method,
// and a subclass inherits that method, while another class with the fields in
// another order makes the interface's field reads dispatch. Main answers this
// correctly on C, LLVM and the JVM. Part 2 stage B's first candidate
// (71bbfb181) had no table row for `S3` or `D3`, because its supplier bound did
// not follow `this`, and dispatched through NULL: a SIGSEGV on C. Main's RC arm
// crashes here too, separately (queued).
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
