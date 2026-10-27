// expect: emit-c --napi -> no declaration for `Host#@symbol0@raises` to take a signature from
//
// One of the web-platform blocker's six backend declines, reduced
// (2026-10-27): `ReadableStreamBYOBHost#@symbol11@raises` (reached from
// ReadableStreamBYOBReader#cancel). The implementing async symbol
// method invokes the source's cancel algorithm through Reflect.apply,
// which lowering refuses; the caller's try makes it the @raises copy,
// and the backend declines that copy for want of a declaration
// (NTS2006) instead of lowering refusing the caller. Invoking a method
// directly is the control: a-symbol-host-method-whose-body-calls-a-method.
// A plain extracted-function call is refused in the body too ("a call of
// a function value in a program with no closures"), same cascade.

const kCancel: unique symbol = Symbol("cancelInternal");
interface Host {
  [kCancel](reason: unknown): Promise<void>;
}
interface Source {
  cancel?: (reason: unknown) => Promise<void>;
}
class Stream implements Host {
  #source: Source | null = null;
  async [kCancel](reason: unknown): Promise<void> {
    const source = this.#source;
    const algo = source?.cancel;
    if (source !== null && algo !== undefined) {
      await Reflect.apply(algo, source, [reason]);
    }
  }
}
class Reader {
  readonly #host: Host;
  constructor(host: Host) { this.#host = host; }
  cancel(reason: unknown = undefined): Promise<void> {
    try {
      return this.#host[kCancel](reason);
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
export async function callIt(seed: number): Promise<number> {
  await new Reader(new Stream()).cancel(seed);
  return (seed | 0) & 1;
}
