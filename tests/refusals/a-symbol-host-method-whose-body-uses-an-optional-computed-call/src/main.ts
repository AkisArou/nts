// expect: emit-c --napi -> no declaration for `Host#@symbol0` to take a signature from
//
// One of the web-platform blocker's six backend declines, reduced
// (2026-10-27): `ReadableByteStreamHost#@symbol8` (readable.ts, reached
// from ReadableByteStreamController#error). The implementing symbol
// method's body makes an optional-chain computed call
// (`reader?.[kFail](e)`), which lowering refuses ("a computed callee"),
// so the interface dispatch has no compiled body; the plain caller
// survives and the backend declines it (NTS2006). Without the optional
// chain the same program agrees everywhere:
// a-symbol-host-method-whose-body-calls-a-symbol-method-directly.

const kFail: unique symbol = Symbol("fail");
const kReaderFail: unique symbol = Symbol("readerFail");
interface Host {
  [kFail](error: unknown): void;
}
class Reader {
  [kReaderFail](error: unknown): void {}
}
class Stream implements Host {
  #reader: Reader | null = new Reader();
  [kFail](error: unknown): void {
    this.#reader?.[kReaderFail](error);
  }
}
class Controller {
  readonly #host: Host;
  constructor(host: Host) { this.#host = host; }
  error(reason: unknown = undefined): void {
    this.#host[kFail](reason);
  }
}
export function callIt(seed: number): number {
  new Controller(new Stream()).error(seed);
  return (seed | 0) & 1;
}
