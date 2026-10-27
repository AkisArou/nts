// The control for a-symbol-host-method-whose-body-uses-an-optional-
// computed-call (tests/refusals): the same program with the computed call
// guarded by an explicit null check instead of `?.[]`. Agrees everywhere.

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
    const r = this.#reader; if (r !== null) r[kReaderFail](error);
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
