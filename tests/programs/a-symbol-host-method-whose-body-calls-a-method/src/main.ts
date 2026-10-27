// The control for a-symbol-host-method-whose-body-uses-reflect-apply
// (tests/refusals): the same program with the cancel algorithm invoked
// as a plain method call on a class. Agrees everywhere.

const kCancel: unique symbol = Symbol("cancelInternal");
interface Host {
  [kCancel](reason: unknown): Promise<void>;
}
class Source {
  async cancel(reason: unknown): Promise<void> {}
}
class Stream implements Host {
  #source: Source | null = new Source();
  async [kCancel](reason: unknown): Promise<void> {
    const source = this.#source;
    if (source !== null) {
      await source.cancel(reason);
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
