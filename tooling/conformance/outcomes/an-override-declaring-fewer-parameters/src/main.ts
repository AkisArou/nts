// stream's `Transform._read()`, `DuplexSide._read()` and http's
// `IncomingMessage._read()` override `Readable._read(size: number)` with no
// parameter, and are dispatched through the base with the size. The JVM
// declines each (NTS4009: `()V` is not `(D)V`, so it would need a bridge);
// on C a method declaring fewer parameters ignores the rest, as a closure
// does (a-closure-kept-as-unknown-called-at-another-arity). This is that
// claim measured for virtual dispatch, and the guard for a JVM bridge.
//
// **Expected, confirmed under node:**
//
//     fewer (override)   read
//     same (control)     read 16
class Readable {
  log = "";
  _read(size: number): void {
    this.log = `read ${size}`;
  }
  read(): string {
    this._read(16);
    return this.log;
  }
}
class Transform extends Readable {
  _read(): void {
    this.log = "read";
  }
}
class Same extends Readable {}
observe("fewer (override)", new Transform().read());
observe("same (control)", new Same().read());
done();
