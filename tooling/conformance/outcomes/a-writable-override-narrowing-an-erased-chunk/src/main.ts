// child_process's `ChildWritable._write(chunk: Uint8Array, ...)` overrides a
// base `_write(chunk: unknown, ...)` and is called through the base, so the
// chunk arrives erased and the override reads it as a view. The JVM backend
// declines exactly this by name -- NTS4009, "the JVM would treat these as two
// unrelated methods and dispatch would silently reach the wrong one" -- and C
// and LLVM have no such check. `an-override-reading-an-erased-argument` is the
// same shape with a record; this is the runtime's instance, in child_process
// and cluster (jvm-verifies cause E: the declined class is referenced and
// never written).
//
// **Expected, confirmed under node:**
//
//     written bytes                3
//     base (control): calls        1
//
// The control is a subclass that keeps the base's `unknown` parameter.
class Writable {
  calls = 0;
  _write(chunk: unknown, encoding: string, callback: () => void): void {
    this.calls++;
    callback();
  }
  write(chunk: unknown): void {
    this._write(chunk, "buffer", () => {});
  }
}
class ChildWritable extends Writable {
  bytes = 0;
  _write(chunk: Uint8Array, encoding: string, callback: () => void): void {
    this.bytes += chunk.length;
    callback();
  }
}
class Plain extends Writable {}

const child = new ChildWritable();
child.write(new Uint8Array([1, 2, 3]));
observe("written bytes", String(child.bytes));
const plain = new Plain();
plain.write(new Uint8Array([1, 2, 3]));
observe("base (control): calls", String(plain.calls));
done();
